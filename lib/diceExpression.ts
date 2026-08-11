// 自定义掷骰表达式：支持 NdS（几个几面骰）、+/- 连接多组、括号分组、
// kh/kl 取高/取低修饰符（业界通用写法，比如 2d20kh1 就是"优势骰"）。
// 例：2d20kh1+1d4    (2d20kh1)+1d4    4d6kl1-1
//
// 这里用词法分析+递归下降解析器实现（不用一把大正则硬撑，嵌套括号+kh/kl容易出错），
// 解析出一棵表达式树，同时在解析阶段就把非法输入(括号不闭合/面数非法/kh数量非法等)拦下来，
// 给出具体的报错原因，而不是笼统的"格式错误"。
//
// 引擎（dice-box-threejs）本身不认识kh/kl——它只会老老实实摇每一颗骰子，给出原始点数。
// 所以这里分两步：
// 1) flattenExpression()：把表达式树"摊平"成一份要摇的骰子清单（几个几面骰，不区分kh/kl），
//    交给3D引擎去摇，一次性摇完所有骰子（视觉上跟"多组同时投掷"完全一样）。
// 2) evaluateExpression()：拿到摇骰结果后（按摊平顺序对应），重新按表达式树做一次数学计算，
//    kh/kl组里被丢弃的骰子会被标记出来（用于结果面板划线/变灰展示），算出最终总和。

// 引擎实际支持的骰子面数（见 dice-box-threejs/const/dice.js），面数校验以此为准
export const SUPPORTED_SIDES = [2, 4, 6, 8, 10, 12, 20, 100];

export type ExprNode =
  | { type: 'dice'; count: number; sides: number; keep?: { mode: 'kh' | 'kl'; amount: number } }
  | { type: 'const'; value: number }
  | { type: 'binary'; op: '+' | '-'; left: ExprNode; right: ExprNode };

export interface ParseResult {
  ok: true;
  node: ExprNode;
}
export interface ParseError {
  ok: false;
  error: string;
}

// ---------- 词法分析 ----------

type Token =
  | { kind: 'num'; value: number }
  | { kind: 'd' }
  | { kind: 'kh' | 'kl'; amount: number }
  | { kind: '+' | '-' | '(' | ')' };

function tokenize(input: string): Token[] | { error: string } {
  const s = input.replace(/\s+/g, '').toLowerCase();
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '+' || c === '-' || c === '(' || c === ')') {
      tokens.push({ kind: c });
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9]/.test(s[j])) j++;
      tokens.push({ kind: 'num', value: parseInt(s.slice(i, j), 10) });
      i = j;
      continue;
    }
    if (c === 'd') {
      // 排除 kh/kl 里可能被误吞的情况（d本身不会和kh/kl混淆，这里单独处理d）
      tokens.push({ kind: 'd' });
      i++;
      continue;
    }
    if (s.slice(i, i + 2) === 'kh' || s.slice(i, i + 2) === 'kl') {
      const mode = s.slice(i, i + 2) as 'kh' | 'kl';
      let j = i + 2;
      let k = j;
      while (k < s.length && /[0-9]/.test(s[k])) k++;
      const amount = k > j ? parseInt(s.slice(j, k), 10) : 1; // 没写数字默认取1个
      tokens.push({ kind: mode, amount });
      i = k;
      continue;
    }
    return { error: `无法识别的字符："${c}"` };
  }
  return tokens;
}

// ---------- 递归下降解析：expr := term (('+'|'-') term)* ; term := diceOrConst ----------

class Parser {
  tokens: Token[];
  pos = 0;
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }
  peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  next(): Token | undefined {
    return this.tokens[this.pos++];
  }

  parseExpr(): ExprNode {
    let node = this.parseTerm();
    while (this.peek() && (this.peek()!.kind === '+' || this.peek()!.kind === '-')) {
      const op = this.next() as { kind: '+' | '-' };
      const right = this.parseTerm();
      node = { type: 'binary', op: op.kind, left: node, right };
    }
    return node;
  }

  // term: 括号表达式，或 [数字] [d数字 [kh/kl数字]]
  parseTerm(): ExprNode {
    const tok = this.peek();
    if (!tok) throw new Error('表达式意外结束');

    if (tok.kind === '(') {
      this.next();
      const inner = this.parseExpr();
      const close = this.next();
      if (!close || close.kind !== ')') throw new Error('括号未闭合');
      return inner;
    }

    // 纯数字（可能是常数修正值，也可能是骰子数量，取决于后面有没有跟着'd'）
    let leadingNum: number | null = null;
    if (tok.kind === 'num') {
      leadingNum = tok.value;
      this.next();
    }

    const afterNum = this.peek();
    if (afterNum && afterNum.kind === 'd') {
      this.next(); // 吃掉 'd'
      const sidesTok = this.next();
      if (!sidesTok || sidesTok.kind !== 'num') throw new Error('"d"后面必须跟骰子面数，例如 d20');
      const sides = sidesTok.value;
      const count = leadingNum ?? 1;

      if (count < 1) throw new Error('骰子数量必须大于0');
      if (count > 100) throw new Error('骰子数量不能超过100');
      if (!SUPPORTED_SIDES.includes(sides)) {
        throw new Error(`不支持D${sides}，仅支持 ${SUPPORTED_SIDES.map((s) => 'D' + s).join('/')}`);
      }

      let keep: { mode: 'kh' | 'kl'; amount: number } | undefined;
      const maybeKeep = this.peek();
      if (maybeKeep && (maybeKeep.kind === 'kh' || maybeKeep.kind === 'kl')) {
        this.next();
        if (maybeKeep.amount < 1) throw new Error(`${maybeKeep.kind}后面的数量必须大于0`);
        if (maybeKeep.amount > count) {
          throw new Error(`${maybeKeep.kind}${maybeKeep.amount} 不合法：取的数量不能超过骰子总数(${count})`);
        }
        keep = { mode: maybeKeep.kind, amount: maybeKeep.amount };
      }

      return { type: 'dice', count, sides, keep };
    }

    // 没跟'd'，就是一个纯常数（如 +3、-2）
    if (leadingNum === null) {
      throw new Error('表达式格式不正确：期望数字、骰子(如2d6)或括号');
    }
    return { type: 'const', value: leadingNum };
  }
}

// 校验并解析一段表达式；成功返回表达式树，失败返回具体错误原因
export function parseDiceExpression(input: string): ParseResult | ParseError {
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, error: '请输入表达式' };

  const tokenResult = tokenize(trimmed);
  if ('error' in tokenResult) return { ok: false, error: tokenResult.error };
  if (tokenResult.length === 0) return { ok: false, error: '请输入表达式' };

  try {
    const parser = new Parser(tokenResult);
    const node = parser.parseExpr();
    if (parser.pos < parser.tokens.length) {
      return { ok: false, error: '表达式末尾有多余字符' };
    }
    return { ok: true, node };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '表达式格式不正确' };
  }
}

// ---------- 摊平：把表达式树里所有的骰子节点按深度优先顺序收集成一份"要摇的骰子清单" ----------
// 摊平顺序必须和evaluateExpression()里重新遍历树的顺序完全一致，这样才能用同一个游标对上号。

export interface FlatDiceGroup {
  sides: number;
  count: number;
}

export function flattenExpression(node: ExprNode): FlatDiceGroup[] {
  const groups: FlatDiceGroup[] = [];
  const visit = (n: ExprNode) => {
    if (n.type === 'dice') {
      groups.push({ sides: n.sides, count: n.count });
    } else if (n.type === 'binary') {
      visit(n.left);
      visit(n.right);
    }
  };
  visit(node);
  return groups;
}

// 把表达式树转换成引擎认识的骰子表达式字符串（不含kh/kl，纯粹NdS+NdS...），交给3D引擎去摇
export function toEngineNotation(node: ExprNode): string {
  const groups = flattenExpression(node);
  if (groups.length === 0) return '';
  return groups.map((g) => `${g.count}d${g.sides}`).join('+');
}

// kh/kl组内，每一颗参与运算的骰子的展示信息：是否被丢弃(discarded)，用于结果面板划线/变灰。
// id是这颗骰子在引擎diceList里的全局索引（引擎自己在result.sets[].rolls[].id里给出），
// 用于告诉3D场景"具体是哪一颗骰子"该被高亮(kh=金边发光，kl=红边发光)。
export interface EvaluatedDiceGroup {
  sides: number;
  count: number;
  keep?: { mode: 'kh' | 'kl'; amount: number };
  rolls: { value: number; id: number; discarded: boolean }[];
  total: number; // 这一组经过kh/kl筛选后的小计（始终是正数，符号单独放在sign里）
  sign: 1 | -1; // 这一组在整个表达式里是加还是减（比如 2d20kh1-1d4 里的1d4，sign就是-1）
}

export interface EvaluatedExpression {
  groups: EvaluatedDiceGroup[];
  modifier: number; // 表达式里所有裸常数的代数和（如 +3-1 = +2）
  total: number; // 全部小计 + modifier 的最终总和
}

// 骰子分组的"配方"：面数+数量+kh/kl+这一组在表达式里的正负号，按表达式树深度优先顺序排列。
// 这份配方本身不含任何摇骰结果，只描述"该怎么摇、怎么筛选"，可以在投掷请求发出时就先算好、
// 随WebSocket一起发给主屏幕——这样主屏幕不需要认识完整的表达式语法/语法树，只需要按这份配方
// 和引擎给的原始点数重新算一遍，就能展示同样详细的kh/kl结果，并知道该给哪几颗骰子上高亮特效。
export interface DiceRecipe {
  sides: number;
  count: number;
  keep?: { mode: 'kh' | 'kl'; amount: number };
  sign: 1 | -1;
}

export interface FlattenedRecipe {
  recipes: DiceRecipe[];
  modifierConstant: number; // 表达式里所有裸常数的代数和，跟recipes一起完整还原表达式的计算逻辑
}

// 把表达式树按深度优先顺序拆成一份"配方"：骰子分组(带符号+kh/kl) + 常数修正的代数和
export function flattenToRecipe(node: ExprNode): FlattenedRecipe {
  const recipes: DiceRecipe[] = [];
  let modifierConstant = 0;

  const visit = (n: ExprNode, sign: 1 | -1) => {
    if (n.type === 'dice') {
      recipes.push({ sides: n.sides, count: n.count, keep: n.keep, sign });
    } else if (n.type === 'const') {
      modifierConstant += sign * n.value;
    } else {
      visit(n.left, sign);
      visit(n.right, n.op === '-' ? (sign === 1 ? -1 : 1) : sign);
    }
  };
  visit(node, 1);

  return { recipes, modifierConstant };
}

// 引擎结果里的一组：注意引擎自己的表达式解析器(DiceNotation.js)会把"面数相同"的多个骰子项
// 自动合并成一组一起摇（比如 2d6kh1+3d6 引擎内部会合并成一次摇5颗d6，不区分是哪个词项来的），
// 所以不能简单按配方顺序一一对应骰子结果——必须按"面数"分桶，跟引擎的合并行为保持一致：
// 同面数的骰子结果放进同一个桶，配方按访问顺序从对应面数的桶里依次取出需要的数量，
// 这跟真实的物理投骰完全等价（骰子本身摇出来的点数无差别，谁"记账"给哪个词项只是分账方式）。
export interface EngineResultSet {
  sides: number;
  rolls: { value: number; id: number }[];
}

function buildSidesPools(sets: EngineResultSet[]): Map<number, { value: number; id: number }[]> {
  const pools = new Map<number, { value: number; id: number }[]>();
  for (const set of sets) {
    const existing = pools.get(set.sides);
    pools.set(set.sides, existing ? [...existing, ...set.rolls] : [...set.rolls]);
  }
  return pools;
}

// 按配方 + 引擎给的原始结果，重新计算出每组的kh/kl筛选情况和最终总和。
// 这一步不需要完整表达式树，只需要flattenToRecipe()算出的配方，主屏幕据此就能展示细节+决定高亮哪些骰子。
export function evaluateRecipe(recipe: FlattenedRecipe, sets: EngineResultSet[]): EvaluatedExpression {
  const pools = buildSidesPools(sets);
  const cursors = new Map<number, number>();
  const groups: EvaluatedDiceGroup[] = [];

  for (const r of recipe.recipes) {
    const pool = pools.get(r.sides) || [];
    const cursor = cursors.get(r.sides) || 0;
    const taken = pool.slice(cursor, cursor + r.count);
    cursors.set(r.sides, cursor + r.count);
    const rolls = taken.map((t) => ({ value: t.value, id: t.id, discarded: false }));

    if (r.keep) {
      // 按点数排序找出该丢弃的骰子：kh丢弃"非最高的amount个"之外的，kl反之
      const sorted = [...rolls].sort((a, b) => (r.keep!.mode === 'kh' ? b.value - a.value : a.value - b.value));
      const keptSet = new Set(sorted.slice(0, r.keep.amount));
      rolls.forEach((roll) => {
        if (!keptSet.has(roll)) roll.discarded = true;
      });
    }

    const total = rolls.filter((roll) => !roll.discarded).reduce((sum, roll) => sum + roll.value, 0);
    groups.push({ sides: r.sides, count: r.count, keep: r.keep, rolls, total, sign: r.sign });
  }

  const groupsTotal = groups.reduce((sum, g) => sum + g.sign * g.total, 0);
  return { groups, modifier: recipe.modifierConstant, total: groupsTotal + recipe.modifierConstant };
}

// 兼容旧调用方式：直接传表达式树 + 引擎结果集，内部自动先拆配方再计算
export function evaluateExpression(node: ExprNode, sets: EngineResultSet[]): EvaluatedExpression {
  return evaluateRecipe(flattenToRecipe(node), sets);
}

// 高亮特效目标：kh组里被保留(未丢弃)的骰子描金边发光，kl组里被保留的骰子描红边发光——
// "取最高"意味着这颗骰子是最终计数里被选中的那个/那些，理应被突出显示；kl同理但用警示色红。
export interface DiceHighlight {
  id: number;
  color: 'gold' | 'red';
}

export function computeHighlights(evaluated: EvaluatedExpression): DiceHighlight[] {
  const highlights: DiceHighlight[] = [];
  for (const g of evaluated.groups) {
    if (!g.keep) continue;
    const color: 'gold' | 'red' = g.keep.mode === 'kh' ? 'gold' : 'red';
    for (const roll of g.rolls) {
      if (!roll.discarded) highlights.push({ id: roll.id, color });
    }
  }
  return highlights;
}

// 表达式树 -> 人类可读的展示文本，如 "2D20(取高1) + 1D4"，用于输入框下方的实时预览
export function describeExpression(node: ExprNode): string {
  const parts: string[] = [];
  const visit = (n: ExprNode, isFirst: boolean): string => {
    if (n.type === 'dice') {
      const keepText = n.keep ? `(取${n.keep.mode === 'kh' ? '高' : '低'}${n.keep.amount})` : '';
      return `${n.count}D${n.sides}${keepText}`;
    }
    if (n.type === 'const') {
      return `${n.value}`;
    }
    const left = visit(n.left, isFirst);
    const right = visit(n.right, false);
    return `${left} ${n.op} ${right}`;
  };
  return visit(node, true);
}
