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
  layer: string | null;
  ruleIndex: number;
  locStart: { line: number; column: number };
  locEnd: { line: number; column: number };
}

/** @keyframes 的单个帧（如 `0%` / `from, to`） */
export interface CssAtRuleFrame {
  key: string;
  declarations: CssDeclaration[];
}

/** 特殊 at-rule：@keyframes / @font-face / @property / @page（不是「规则」，单独收集展示） */
export interface CssAtRule {
  name: string;
  /** keyframes=动画名；property=--变量名；font-face/page 通常为空 */
  prelude: string;
  frames?: CssAtRuleFrame[];
  declarations?: CssDeclaration[];
  mediaQuery: string | null;
  layer: string | null;
  atRuleIndex: number;
  locStart: { line: number; column: number };
  locEnd: { line: number; column: number };
}

export interface ParseResult {
  rules: CssRule[];
  atRules: CssAtRule[];
  error: string | null;
}

// ============ 常量 ============

/** 特殊函数伪类：特异性取参数列表中最重 */
const MAX_SPEC_PSEUDO = new Set(['is', 'not', 'has', 'matches', 'any', '-webkit-any', '-moz-any']);
/** where 特异性恒 0 */
const ZERO_SPEC_PSEUDO = new Set(['where', '-webkit-any-link']);

/** @keyframes 的所有名称变体（帧块不能当选择器规则） */
const KEYFRAME_NAMES = new Set([
  'keyframes', '-webkit-keyframes', '-moz-keyframes', '-o-keyframes', '-ms-keyframes',
]);
/** 单独收集展示的特殊 at-rule */
const SPECIAL_ATRULES = new Set(['keyframes', 'font-face', 'property', 'page']);

function isKeyframesName(name: string): boolean {
  return KEYFRAME_NAMES.has(name.toLowerCase());
}
function isSpecialAtRule(name: string): boolean {
  const n = name.toLowerCase();
  return SPECIAL_ATRULES.has(n) || KEYFRAME_NAMES.has(n);
}

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

export function parseStylesheet(css: string): ParseResult {
  const rules: CssRule[] = [];
  const atRules: CssAtRule[] = [];
  let error: string | null = null;

  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(css, { positions: true });
  } catch (e: any) {
    return { rules: [], atRules: [], error: `CSS 解析失败: ${e?.message || String(e)}` };
  }

  // walk 时用栈跟踪 @media / @layer / @keyframes 上下文
  const mediaStack: string[] = [];
  const layerStack: string[] = [];
  const keyframesStack: string[] = [];
  let ruleIndex = 0;
  let atRuleIndex = 0;

  const currentMedia = (): string | null =>
    mediaStack.length > 0 ? mediaStack[mediaStack.length - 1] : null;
  const currentLayer = (): string | null =>
    layerStack.length > 0 ? layerStack[layerStack.length - 1] : null;

  /** 从 block 提取声明列表 */
  function buildDeclarations(block: any): CssDeclaration[] {
    const out: CssDeclaration[] = [];
    const children = block?.children as csstree.List<csstree.CssNode> | undefined;
    if (!children) return out;
    children.forEach((n: csstree.CssNode) => {
      if (n.type === 'Declaration' && n.property && n.value) {
        let valueStr = '';
        try {
          valueStr = csstree.generate(n.value);
        } catch {
          valueStr = '';
        }
        out.push({
          property: n.property.toLowerCase(),
          value: valueStr,
          important: n.important === true,
          line: (n.loc as any)?.start?.line || 0,
          column: (n.loc as any)?.start?.column || 0,
        });
      }
    });
    return out;
  }

  function processRule(rule: csstree.Rule) {
    const prelude = rule.prelude as unknown as csstree.SelectorList;
    const selText = csstree.generate(prelude);
    const mediaQuery = currentMedia();
    const layer = currentLayer();

    let selectorList: csstree.SelectorList;
    try {
      selectorList = csstree.parse(selText, { context: 'selectorList' }) as unknown as csstree.SelectorList;
    } catch {
      return; // 选择器解析失败跳过
    }

    const locStart = (rule.loc as any)?.start || { line: 0, column: 0 };
    const locEnd = (rule.loc as any)?.end || { line: 0, column: 0 };

    (selectorList.children as csstree.List<csstree.CssNode>).forEach((selNode) => {
      if (selNode.type !== 'Selector') return;
      const spec = specOfSelector(selNode as csstree.Selector);
      const oneText = csstree.generate(selNode).trim();

      rules.push({
        selectorText: oneText,
        specificity: spec,
        declarations: buildDeclarations(rule.block),
        mediaQuery,
        layer,
        ruleIndex: ruleIndex++,
        locStart,
        locEnd,
      });
    });
  }

  function processAtRule(atrule: csstree.Atrule) {
    const name = (atrule.name || '').toLowerCase();
    const locStart = (atrule.loc as any)?.start || { line: 0, column: 0 };
    const locEnd = (atrule.loc as any)?.end || { line: 0, column: 0 };
    let prelude = '';
    try {
      prelude = atrule.prelude ? csstree.generate(atrule.prelude).trim() : '';
    } catch {
      prelude = '';
    }

    if (isKeyframesName(name)) {
      const frames: CssAtRuleFrame[] = [];
      const children = (atrule.block as any)?.children as csstree.List<csstree.CssNode> | undefined;
      children?.forEach((child: csstree.CssNode) => {
        if (child.type !== 'Rule') return;
        let key = '';
        try {
          key = csstree.generate((child as csstree.Rule).prelude).trim();
        } catch {
          key = '';
        }
        frames.push({ key, declarations: buildDeclarations((child as csstree.Rule).block) });
      });
      atRules.push({
        name,
        prelude,
        frames,
        mediaQuery: currentMedia(),
        layer: currentLayer(),
        atRuleIndex: atRuleIndex++,
        locStart,
        locEnd,
      });
    } else {
      atRules.push({
        name,
        prelude,
        declarations: buildDeclarations(atrule.block),
        mediaQuery: currentMedia(),
        layer: currentLayer(),
        atRuleIndex: atRuleIndex++,
        locStart,
        locEnd,
      });
    }
  }

  try {
    csstree.walk(ast, {
      enter(node) {
        if (node.type === 'Atrule') {
          const name = (node.name || '').toLowerCase();
          if (name === 'media' && node.prelude) {
            mediaStack.push(csstree.generate(node.prelude));
          } else if (name === 'layer' && node.block && node.prelude) {
            // @layer utilities { ... } 块形式
            layerStack.push(csstree.generate(node.prelude).trim());
          } else if (isKeyframesName(name)) {
            keyframesStack.push(node.prelude ? csstree.generate(node.prelude).trim() : '');
          }
          return;
        }
        if (node.type === 'Rule') {
          // @keyframes 帧块（0%, from…）不是选择器规则，跳过
          if (keyframesStack.length > 0) return;
          processRule(node as csstree.Rule);
        }
      },
      leave(node) {
        if (node.type === 'Atrule') {
          const name = (node.name || '').toLowerCase();
          if (name === 'media') mediaStack.pop();
          else if (name === 'layer' && node.block && node.prelude) layerStack.pop();
          else if (isKeyframesName(name)) keyframesStack.pop();
          if (isSpecialAtRule(name)) processAtRule(node as csstree.Atrule);
        }
      },
    });
  } catch (e: any) {
    error = `解析规则时出错: ${e?.message || String(e)}`;
  }

  return { rules, atRules, error };
}
