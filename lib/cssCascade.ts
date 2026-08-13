import * as csstree from 'css-tree';

// ============ 类型定义 ============

export interface CssDeclaration {
  property: string;
  value: string;
  important: boolean;
  line: number;
  column: number;
}

export interface CssRule {
  selectorText: string;
  specificity: [number, number, number];
  declarations: CssDeclaration[];
  mediaQuery: string | null;
  ruleIndex: number;
  locStart: { line: number; column: number };
  locEnd: { line: number; column: number };
}

export interface ParseResult {
  rules: CssRule[];
  error: string | null;
}

export interface CascadeHit {
  rule: CssRule;
  declaration: CssDeclaration;
  specText: string;
  origin: 'author' | 'inline';
  /** 层叠排名：0 = 最输，越大越接近赢家（排序后按数组下标重算） */
  rank: number;
  wins: boolean;
  /** 是否由内联 style 产生 */
  isInline: boolean;
}

export interface CascadeProperty {
  property: string;
  hits: CascadeHit[];
  winning: CascadeHit | null;
  /** 该属性最终计算值（winning 的值，若无则 null） */
  computed: string | null;
  /** 可继承属性且无直接命中 → 标记继承 */
  inherited: boolean;
  inheritedSource: string | null;
  /** 同时被非匹配规则覆盖的"可视警告"：比如被 !important 规则覆盖的普通规则 */
}

export interface CascadeResult {
  selectedSelector: string;
  tagName: string;
  properties: CascadeProperty[];
}

// ============ 常量 ============

/** 动态伪类：匹配结果不稳定，瀑布里忽略 */
const DYNAMIC_PSEUDO = new Set([
  'hover', 'active', 'focus', 'focus-visible', 'focus-within',
  'visited', 'link', 'target',
]);

/** 特殊函数伪类：特异性取参数列表中最重 */
const MAX_SPEC_PSEUDO = new Set(['is', 'not', 'has', 'matches', 'any', '-webkit-any', '-moz-any']);
/** where 特异性恒 0 */
const ZERO_SPEC_PSEUDO = new Set(['where', '-webkit-any-link']);

/** 可继承 CSS 属性（用于继承链可视化） */
const INHERITED_PROPS = new Set([
  'azimuth', 'border-collapse', 'border-spacing', 'caption-side', 'color',
  'cursor', 'direction', 'empty-cells', 'font', 'font-family', 'font-size',
  'font-style', 'font-variant', 'font-weight', 'letter-spacing', 'line-height',
  'list-style', 'list-style-image', 'list-style-position', 'list-style-type',
  'orphans', 'quotes', 'text-align', 'text-indent', 'text-transform',
  'visibility', 'white-space', 'widows', 'word-spacing', 'word-break',
  'overflow-wrap', 'word-wrap', 'font-stretch', 'text-rendering',
  'text-shadow', 'text-overflow', '-webkit-font-smoothing', 'writing-mode',
]);

// ============ 特异性计算（自写，基于 css-tree AST） ============

type Spec = [number, number, number];

function specOfNode(node: csstree.CssNode, acc: Spec): void {
  switch (node.type) {
    case 'IdSelector':
      acc[0]++;
      break;
    case 'ClassSelector':
    case 'AttributeSelector':
      acc[1]++;
      break;
    case 'TypeSelector':
      if (node.name !== '*') acc[2]++;
      break;
    case 'PseudoElementSelector':
      acc[2]++;
      break;
    case 'PseudoClassSelector': {
      const name = (node.name || '').toLowerCase();
      if (ZERO_SPEC_PSEUDO.has(name)) {
        // :where() → 0，内部也不计入
        break;
      }
      if (MAX_SPEC_PSEUDO.has(name) && node.children) {
        // :is()/:not()/:has() → 取参数选择器列表中最重的
        const m = specOfSelectorList(node.children);
        acc[0] += m[0]; acc[1] += m[1]; acc[2] += m[2];
        break;
      }
      // 所有普通伪类（含动态伪类）都计 b —— 真实 CSS 中 a:hover 就是 (0,1,1)。
      // 动态伪类只在「匹配阶段」被剥离（无法静态模拟 hover），特异性照常参与层叠。
      acc[1]++;
      break;
    }
    default:
      break;
  }
}

function specOfSelector(selector: csstree.Selector): Spec {
  const acc: Spec = [0, 0, 0];
  const children = (selector as any).children as csstree.List<csstree.CssNode> | undefined;
  if (children) {
    children.forEach((n: csstree.CssNode) => specOfNode(n, acc));
  }
  return acc;
}

function specOfSelectorList(list: csstree.List<csstree.CssNode> | undefined): Spec {
  let best: Spec = [0, 0, 0];
  if (!list) return best;
  list.forEach((n: csstree.CssNode) => {
    let s: Spec;
    if (n.type === 'Selector') s = specOfSelector(n as csstree.Selector);
    else if (n.type === 'SelectorList') s = specOfSelectorList((n as any).children);
    else if (n.type === 'PseudoClassSelector') {
      // :is() 的 children 直接是 SelectorList 内的节点，递归兜底
      s = specOfSelectorList((n as any).children as csstree.List<csstree.CssNode>);
    } else {
      const acc: Spec = [0, 0, 0];
      specOfNode(n, acc);
      s = acc;
    }
    if (compareSpec(s, best) > 0) best = s;
  });
  return best;
}

export function compareSpec(a: Spec, b: Spec): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

export function specText(s: Spec): string {
  return `${s[0]},${s[1]},${s[2]}`;
}

export function specificityOfText(selectorText: string): Spec {
  try {
    const ast = csstree.parse(selectorText, { context: 'selectorList' });
    return specOfSelectorList((ast as any).children);
  } catch {
    return [0, 0, 0];
  }
}

// ============ 解析样式表 ============

/** 从 AST 移除动态伪类节点（匹配阶段用，避免 :hover 等不稳定） */
function stripDynamicPseudos(selector: csstree.Selector): csstree.Selector {
  const children = (selector as any).children as csstree.List<csstree.CssNode>;
  if (!children) return selector;
  const filtered = children.filter((n: csstree.CssNode) => {
    if (n.type === 'PseudoClassSelector' && DYNAMIC_PSEUDO.has((n.name || '').toLowerCase())) {
      return false;
    }
    return true;
  });
  (selector as any).children = filtered;
  return selector;
}

export function parseStylesheet(css: string): ParseResult {
  const rules: CssRule[] = [];
  let error: string | null = null;

  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(css, { positions: true });
  } catch (e: any) {
    return { rules: [], error: `CSS 解析失败: ${e?.message || String(e)}` };
  }

  // walk 时用栈跟踪 @media 上下文
  const mediaStack: string[] = [];
  let ruleIndex = 0;

  try {
    csstree.walk(ast, {
      enter(node) {
        if (node.type === 'Atrule' && node.name === 'media' && node.prelude) {
          mediaStack.push(csstree.generate(node.prelude));
        }
        if (node.type === 'Rule') {
          processRule(node as csstree.Rule);
        }
      },
      leave(node) {
        if (node.type === 'Atrule' && node.name === 'media') {
          mediaStack.pop();
        }
      },
    });
  } catch (e: any) {
    error = `解析规则时出错: ${e?.message || String(e)}`;
  }

  function processRule(rule: csstree.Rule) {
    const prelude = rule.prelude as unknown as csstree.SelectorList;
    const selText = csstree.generate(prelude);
    const mediaQuery = mediaStack.length > 0 ? mediaStack[mediaStack.length - 1] : null;

    let selectorList: csstree.SelectorList;
    try {
      selectorList = csstree.parse(selText, { context: 'selectorList' }) as unknown as csstree.SelectorList;
    } catch {
      return; // 选择器解析失败跳过
    }

    const blockChildren = (rule.block as any)?.children as csstree.List<csstree.CssNode> | undefined;

    const locStart = (rule.loc as any)?.start || { line: 0, column: 0 };
    const locEnd = (rule.loc as any)?.end || { line: 0, column: 0 };

    (selectorList.children as csstree.List<csstree.CssNode>).forEach((selNode) => {
      if (selNode.type !== 'Selector') return;
      const spec = specOfSelector(selNode as csstree.Selector);
      const oneSelector = stripDynamicPseudos(selNode as csstree.Selector);
      const oneText = csstree.generate(oneSelector).trim();

      const declarations: CssDeclaration[] = [];
      if (blockChildren) {
        blockChildren.forEach((n) => {
          if (n.type === 'Declaration' && n.property && n.value) {
            let valueStr = '';
            try {
              valueStr = csstree.generate(n.value);
            } catch {
              valueStr = '';
            }
            declarations.push({
              property: n.property.toLowerCase(),
              value: valueStr,
              important: n.important === true,
              line: (n.loc as any)?.start?.line || 0,
              column: (n.loc as any)?.start?.column || 0,
            });
          }
        });
      }

      rules.push({
        selectorText: oneText,
        specificity: spec,
        declarations,
        mediaQuery,
        ruleIndex: ruleIndex++,
        locStart,
        locEnd,
      });
    });
  }

  return { rules, error };
}

// ============ 层叠计算 ============

/**
 * 层叠比较器（升序：输家在前，赢家在后）。
 * 优先级（主 → 次）：
 *  1. !important > 普通
 *  2. 内联 style > 规则（同一 importance 组内）
 *  3. 特异性 (a,b,c) 字典序
 *  4. 源码顺序（ruleIndex 大者赢）
 */
function compareHits(a: CascadeHit, b: CascadeHit): number {
  const impA = a.declaration.important ? 1 : 0;
  const impB = b.declaration.important ? 1 : 0;
  if (impA !== impB) return impA - impB;

  const inlA = a.origin === 'inline' ? 1 : 0;
  const inlB = b.origin === 'inline' ? 1 : 0;
  if (inlA !== inlB) return inlA - inlB;

  const c = compareSpec(a.rule.specificity, b.rule.specificity);
  if (c !== 0) return c;

  return a.rule.ruleIndex - b.rule.ruleIndex;
}

/**
 * 计算目标元素上的层叠结果。
 * @param rules 解析出的全部规则
 * @param el 目标 DOM 元素
 * @param win window 对象（matchMedia）
 */
export function computeCascade(rules: CssRule[], el: Element, win: Window): CascadeResult {
  const propMap = new Map<string, CascadeHit[]>();
  const inlineProps = new Map<string, { value: string; important: boolean }>();

  // 内联样式：读取 el.style（内联比 author 规则强，除 !important）
  const elStyle = (el as HTMLElement).style;
  if (elStyle) {
    for (let i = 0; i < elStyle.length; i++) {
      const prop = elStyle.item(i);
      const val = elStyle.getPropertyValue(prop);
      const imp = elStyle.getPropertyPriority(prop) === 'important';
      inlineProps.set(prop.toLowerCase(), { value: val, important: imp });
    }
  }

  // 收集命中规则
  for (const rule of rules) {
    if (rule.mediaQuery) {
      let mediaOk = false;
      try {
        mediaOk = win.matchMedia(rule.mediaQuery).matches;
      } catch {
        mediaOk = true; // 解析失败默认算生效
      }
      if (!mediaOk) continue;
    }

    let matched = false;
    try {
      matched = el.matches(rule.selectorText);
    } catch {
      matched = false; // 选择器语法错误
    }
    if (!matched) continue;

    for (const decl of rule.declarations) {
      if (!decl.property) continue;
      if (!propMap.has(decl.property)) propMap.set(decl.property, []);
      propMap.get(decl.property)!.push({
        rule,
        declaration: decl,
        specText: specText(rule.specificity),
        origin: 'author',
        rank: 0,
        wins: false,
        isInline: false,
      });
    }
  }

  // 注入内联 hit
  for (const [prop, iv] of inlineProps) {
    if (!propMap.has(prop)) propMap.set(prop, []);
    propMap.get(prop)!.push({
      rule: {
        selectorText: 'inline style',
        specificity: [1, 0, 0],
        declarations: [{ property: prop, value: iv.value, important: iv.important, line: 0, column: 0 }],
        mediaQuery: null,
        ruleIndex: Number.MAX_SAFE_INTEGER,
        locStart: { line: 0, column: 0 },
        locEnd: { line: 0, column: 0 },
      },
      declaration: { property: prop, value: iv.value, important: iv.important, line: 0, column: 0 },
      specText: 'inline',
      origin: 'inline',
      rank: 0,
      wins: false,
      isInline: true,
    });
  }

  // 排序 + 标记胜出者
  const properties: CascadeProperty[] = [];
  for (const [property, hits] of propMap) {
    hits.sort(compareHits);
    hits.forEach((h, i) => { h.rank = i; h.wins = i === hits.length - 1; });
    properties.push({
      property,
      hits,
      winning: hits[hits.length - 1],
      computed: hits[hits.length - 1].declaration.value,
      inherited: false,
      inheritedSource: null,
    });
  }

  // 继承增强：可继承属性未被直接命中 → 向上找祖先
  for (const prop of INHERITED_PROPS) {
    if (propMap.has(prop)) continue;
    let ancestor = el.parentElement;
    let found: { source: string; value: string } | null = null;
    let depth = 0;
    while (ancestor && depth < 6) {
      // 检查祖先是否被规则命中且声明了该属性
      for (const rule of rules) {
        if (rule.mediaQuery) {
          let mediaOk = false;
          try { mediaOk = win.matchMedia(rule.mediaQuery).matches; } catch { mediaOk = true; }
          if (!mediaOk) continue;
        }
        let matched = false;
        try { matched = ancestor.matches(rule.selectorText); } catch { matched = false; }
        if (!matched) continue;
        const d = rule.declarations.find((dd) => dd.property === prop);
        if (d) { found = { source: `${rule.selectorText} (${specText(rule.specificity)})`, value: d.value }; break; }
      }
      if (found) break;
      // 内联
      const av = (ancestor as HTMLElement).style?.getPropertyValue(prop);
      if (av) { found = { source: 'inline style', value: av }; break; }
      ancestor = ancestor.parentElement;
      depth++;
    }
    if (found) {
      properties.push({
        property: prop,
        hits: [],
        winning: null,
        computed: found.value,
        inherited: true,
        inheritedSource: found.source,
      });
    }
  }

  // 属性排序：有竞争/胜出的优先，继承靠后
  properties.sort((a, b) => {
    const aScore = a.winning ? (a.hits.length > 1 ? 2 : 1) : 0;
    const bScore = b.winning ? (b.hits.length > 1 ? 2 : 1) : 0;
    if (aScore !== bScore) return bScore - aScore;
    return a.property.localeCompare(b.property);
  });

  let selectedSelector = el.tagName.toLowerCase();
  const id = el.id;
  const cls = (el as HTMLElement).className;
  if (id) selectedSelector = `#${id}`;
  else if (typeof cls === 'string' && cls.trim()) {
    selectedSelector = `${el.tagName.toLowerCase()}.${cls.trim().split(/\s+/)[0]}`;
  }

  return { selectedSelector, tagName: el.tagName.toLowerCase(), properties };
}
