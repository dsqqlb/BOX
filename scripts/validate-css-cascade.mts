// 临时验证脚本：用 Node 24 TS type-stripping 直接跑引擎逻辑
import * as csstree from 'css-tree';
import { parseStylesheet, specificityOfText, compareSpec, specText, computeCascade } from '../lib/cssCascade.ts';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error('❌ FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('✅', msg);
  }
}

// ---- 特异性 ----
assert(compareSpec(specificityOfText('*'), [0, 0, 0]) === 0, '* → (0,0,0)');
assert(compareSpec(specificityOfText('div'), [0, 0, 1]) === 0, 'div → (0,0,1)');
assert(compareSpec(specificityOfText('.card'), [0, 1, 0]) === 0, '.card → (0,1,0)');
assert(compareSpec(specificityOfText('#card'), [1, 0, 0]) === 0, '#card → (1,0,0)');
assert(compareSpec(specificityOfText('ul li'), [0, 0, 2]) === 0, 'ul li → (0,0,2)');
assert(compareSpec(specificityOfText('a[href]'), [0, 1, 1]) === 0, 'a[href] → (0,1,1)');
assert(compareSpec(specificityOfText('a:hover'), [0, 1, 1]) === 0, 'a:hover → (0,1,1) 动态伪类计 b');
assert(compareSpec(specificityOfText('.a::before'), [0, 1, 1]) === 0, '.a::before → (0,1,1)');
assert(compareSpec(specificityOfText(':is(#x, .y)'), [1, 0, 0]) === 0, ':is(#x,.y) → (1,0,0) 取最重');
assert(compareSpec(specificityOfText(':not(.a)'), [0, 1, 0]) === 0, ':not(.a) → (0,1,0)');
assert(compareSpec(specificityOfText(':where(#x)'), [0, 0, 0]) === 0, ':where(#x) → (0,0,0)');
assert(compareSpec(specificityOfText('#a.b.c'), [1, 2, 0]) === 0, '#a.b.c → (1,2,0)');
assert(compareSpec(specificityOfText('div > .x'), [0, 1, 1]) === 0, 'div > .x → (0,1,1) 组合器忽略');
assert(specText(specificityOfText('#a.b')) === '1,1,0', 'specText 格式化');

// ---- 解析 ----
const css = `
* { margin: 0; padding: 0; }
#card { color: red; }
.card { color: green; padding: 8px; }
div.card { color: blue; }
a:hover { color: orange; }
@media (max-width: 600px) {
  .card { padding: 4px; }
}
.main, .side { background: black; }
`;
const { rules, error } = parseStylesheet(css);
if (error) { console.error('❌ parse error:', error); process.exit(1); }
console.log(`\n--- 解析出 ${rules.length} 条规则 ---`);
rules.forEach((r, i) => console.log(`[${i}] ${r.selectorText}  spec=${specText(r.specificity)}  media=${r.mediaQuery || 'null'}  props=${r.declarations.map(d => d.property).join(',')}`));

assert(rules.length === 8, `应解析出 8 条规则，实际 ${rules.length}`);
assert(compareSpec(rules[0].specificity, [0, 0, 0]) === 0, '规则0 * → (0,0,0)');
assert(rules[1].selectorText === '#card' && rules[1].declarations[0].value === 'red', '#card { color: red } 解析正确');
assert(rules[5].mediaQuery === '(max-width:600px)', '@media 上下文正确');
assert(rules[7].selectorText === '.side' && rules[7].declarations[0].property === 'background', '选择器列表拆分 .main/.side');
assert(rules[1].declarations[0].line >= 2, '声明行号正确');
assert(rules[2].declarations[1].property === 'padding', '.card 两条声明');

// ---- !important ----
const cssImp = `.a { color: green !important; } .b { color: red; }`;
const rImp = parseStylesheet(cssImp).rules;
assert(rImp[0].declarations[0].important === true, '!important 识别');
console.log(rImp[0].declarations[0]);

console.log('\n验证完毕');

// ============ 层叠计算（用 mock DOM） ============

function makeStyle(props: Record<string, string>, important: Record<string, boolean> = {}) {
  const keys = Object.keys(props);
  return {
    length: keys.length,
    item: (i: number) => keys[i] || '',
    getPropertyValue: (p: string) => props[p.toLowerCase()] || '',
    getPropertyPriority: (p: string) => (important[p.toLowerCase()] ? 'important' : ''),
  };
}

function makeEl(sel: string, opts: { id?: string; cls?: string; style?: any; parent?: any; tag?: string } = {}) {
  const classes = (opts.cls || '').split(/\s+/).filter(Boolean);
  return {
    matches: (s: string) => {
      const sels = s.split(',').map(x => x.trim());
      return sels.some((selStr: string) => {
        const idMatch = selStr.match(/#([\w-]+)/g) || [];
        const clsMatch = selStr.match(/\.([\w-]+)/g) || [];
        const tagPart = selStr
          .replace(/#[\w-]+/g, '')
          .replace(/\.[\w-]+/g, '')
          .replace(/[ :>+~[\](),-]+[\w-]*/g, '')
          .trim()
          .toLowerCase();
        if (idMatch.length && !idMatch.every((m) => m.slice(1) === opts.id)) return false;
        if (clsMatch.length && !clsMatch.every((m) => classes.includes(m.slice(1)))) return false;
        if (tagPart && tagPart !== (opts.tag || 'div').toLowerCase()) return false;
        return true;
      });
    },
    style: opts.style,
    parentElement: opts.parent || null,
    id: opts.id || '',
    tagName: (opts.tag || 'DIV').toUpperCase(),
    className: opts.cls || '',
  };
}

const matchMedia = (q: string) => ({ matches: q === '(min-width:900px)' });

const win = { matchMedia } as unknown as Window;

// 场景 A：inline normal vs author !important → author !important 应该赢
{
  const { rules } = parseStylesheet(`div { color: green !important; }`);
  const el = makeEl('div', { style: makeStyle({ color: 'red' }) });
  const res = computeCascade(rules, el as unknown as Element, win);
  const color = res.properties.find(p => p.property === 'color')!;
  const winners = color.hits.filter(h => h.wins);
  assert(winners.length === 1, '场景A：color 只有一个赢家');
  assert(winners[0].declaration.value === 'green', '场景A：author !important 胜于 inline normal');
  assert(winners[0].isInline === false, '场景A：赢家不是 inline');
}

// 场景 B：author normal 特异性 → #id > .class > type
{
  const { rules } = parseStylesheet(`
    div { color: gray; }
    .box { color: blue; }
    #box { color: red; }
  `);
  const el = makeEl('#box', { id: 'box', cls: 'box' });
  const res = computeCascade(rules, el as unknown as Element, win);
  const color = res.properties.find(p => p.property === 'color')!;
  const winner = color.hits.find(h => h.wins)!;
  assert(winner.rule.selectorText === '#box', `场景B：#box 赢（实际 ${winner.rule.selectorText}）`);
  assert(color.hits.length === 3, '场景B：三条规则全部命中');
  // 排序从输到赢
  const order = color.hits.map(h => h.rule.selectorText);
  assert(order[0] === 'div' && order[1] === '.box' && order[2] === '#box', `场景B：排序 ${order}`);
}

// 场景 C：源码顺序（同特异性，后写赢）
{
  const { rules } = parseStylesheet(`.a { color: red; } .a { color: blue; }`);
  const el = makeEl('.a', { cls: 'a' });
  const res = computeCascade(rules, el as unknown as Element, win);
  const winner = res.properties.find(p => p.property === 'color')!.hits.find(h => h.wins)!;
  assert(winner.declaration.value === 'blue', '场景C：同特异性后写赢');
}

// 场景 D：@media 生效控制
{
  const { rules } = parseStylesheet(`.card { padding: 8px; } @media (min-width:900px) { .card { padding: 20px; } }`);
  const el = makeEl('.card', { cls: 'card' });
  const res = computeCascade(rules, el as unknown as Element, win);
  const p = res.properties.find(x => x.property === 'padding')!;
  const winner = p.hits.find(h => h.wins)!;
  assert(winner.declaration.value === '20px', `场景D：@media 命中时 media 规则赢（实际 ${winner.declaration.value}）`);
  assert(p.hits.length === 2, '场景D：两条 padding 都参与');
}

// 场景 E：继承 —— p 内无 color 声明，从祖先继承
{
  const { rules } = parseStylesheet(`.card { color: purple; }`);
  const parent = makeEl('.card', { cls: 'card' });
  const el = makeEl('p', { cls: 'desc', parent });
  const res = computeCascade(rules, el as unknown as Element, win);
  const color = res.properties.find(p => p.property === 'color')!;
  assert(!!color && color.inherited === true, '场景E：color 标记为继承');
  assert(color.inheritedSource?.includes('.card'), `场景E：继承来源 .card（实际 ${color.inheritedSource}）`);
  assert(color.computed === 'purple', '场景E：继承值 purple');
}

// 场景 F：inline 正常 vs author 规则 → inline 赢
{
  const { rules } = parseStylesheet(`.box { color: blue; }`);
  const el = makeEl('.box', { cls: 'box', style: makeStyle({ color: 'orange' }) });
  const res = computeCascade(rules, el as unknown as Element, win);
  const winner = res.properties.find(p => p.property === 'color')!.hits.find(h => h.wins)!;
  assert(winner.isInline === true && winner.declaration.value === 'orange', '场景F：inline normal 赢');
}

console.log('层叠验证完毕');

// ============ 用真实 demo CSS 做集成测试 ============
import { DEFAULT_DEMO_CSS } from '../data/cssCascadeDemo.ts';

const demo = parseStylesheet(DEFAULT_DEMO_CSS);
console.log(`\n--- demo 解析：${demo.rules.length} 条规则，错误=${demo.error || '无'} ---`);
const sels = demo.rules.map((r) => `${r.selectorText}${r.mediaQuery ? ' @' + r.mediaQuery : ''} (${specText(r.specificity)})`);
console.log(sels.join('\n'));

// 关键场景核对
// .badge 定义两次：第二次带 !important → 胜出者应取第二次
const badgeRules = demo.rules.filter((r) => r.selectorText === '.badge');
assert(badgeRules.length === 2, 'demo：.badge 出现两次');
assert(badgeRules[1].declarations[0].important === true, 'demo：第二个 .badge 是 !important');

// .panel .panel-title (0,2,0) 应胜于 .panel-title (0,1,0)
const ptRules = demo.rules.filter((r) => r.selectorText === '.panel-title' || r.selectorText === '.panel .panel-title');
assert(ptRules.length === 2, 'demo：panel-title 两条');
const panelTitleWins = ptRules.some((r) => r.specificity[1] === 2);
assert(panelTitleWins, 'demo：.panel .panel-title 特异性更高 (0,2,0)');

// @media 内规则
const mediaRules = demo.rules.filter((r) => r.mediaQuery);
assert(mediaRules.length === 2, 'demo：两条 @media 规则');
assert(mediaRules.every((r) => r.mediaQuery === '(max-width:480px)'), 'demo：@media 条件正确');

// 继承链测试：desc 有 color，strong 无 → strong 应继承
const parentDesc = makeEl('p.desc', { cls: 'desc', tag: 'p' });
const strongEl = makeEl('strong', { cls: '', tag: 'strong', parent: parentDesc });
const strongRes = computeCascade(demo.rules, strongEl as unknown as Element, win);
const strongColor = strongRes.properties.find((p) => p.property === 'color')!;
assert(!!strongColor && strongColor.inherited, `demo：strong 的 color 来自继承（实际 ${strongColor?.inherited}）`);
assert(strongColor.computed === '#94a3b8', `demo：strong 继承值 #94a3b8（实际 ${strongColor?.computed}）`);

// .item.active 的 color 竞争：.item(0,1,0) vs .item.active(0,2,0) → active 赢
const itemEl = makeEl('li.item.active', { cls: 'item active', tag: 'li' });
const itemRes = computeCascade(demo.rules, itemEl as unknown as Element, win);
const itemColor = itemRes.properties.find((p) => p.property === 'color')!;
const itemWinner = itemColor.hits.find((h) => h.wins)!;
assert(itemWinner.rule.selectorText === '.item.active', `demo：.item.active 胜出（实际 ${itemWinner.rule.selectorText}）`);

console.log('demo 集成验证完毕');
