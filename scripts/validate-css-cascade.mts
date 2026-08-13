// 临时验证脚本：用 Node 24 TS type-stripping 直接跑引擎逻辑
// 覆盖：特异性 / 解析 / !important / @keyframes+@layer+@font-face 画廊解析 / 动态伪类保留
import { parseStylesheet, specificityOfText, compareSpec, specText } from '../lib/cssCascade.ts';

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

// ---- 动态伪类保留：selectorText 完整保留 :hover，特异度照常计 b ----
const hoverRule = rules.find(r => r.selectorText === 'a:hover');
assert(!!hoverRule, 'a:hover 保留在规则里（不再剥离）');
assert(!!hoverRule && compareSpec(hoverRule.specificity, [0, 1, 1]) === 0, 'a:hover 特异度 (0,1,1)');

// ---- !important ----
const cssImp = `.a { color: green !important; } .b { color: red; }`;
const rImp = parseStylesheet(cssImp).rules;
assert(rImp[0].declarations[0].important === true, '!important 识别');
console.log(rImp[0].declarations[0]);

console.log('\n验证完毕');

// ============ 规则画廊：@keyframes 帧跳过 / @layer 跟踪 / 特殊 at-rule 收集 ============
{
  const src = `
@layer reset {
  * { margin: 0; }
}
@layer utilities {
  .u-flex { display: flex; }
}
@keyframes spin {
  0% { transform: rotate(0deg); }
  from { opacity: 0; }
  50%, to { transform: rotate(360deg); }
}
@font-face {
  font-family: "Test";
  src: url(font.woff2);
}
`;
  const { rules, atRules, error } = parseStylesheet(src);
  assert(error === null, '含 @layer/@keyframes/@font-face 的 CSS 解析无错误');

  // ① keyframes 帧块（0%/from/to）不得混入 rules
  const frameSelectors = rules.filter((r) => /^(0%|from|to|\d+%)$/.test(r.selectorText));
  assert(frameSelectors.length === 0, `keyframes 帧块不进 rules（实际: ${frameSelectors.map((r) => r.selectorText).join(',') || '无'}）`);
  assert(rules.length === 2, `规则总数 = 2（* 与 .u-flex），实际 ${rules.length}`);

  // ② @layer 上下文记录到每条规则
  const starRule = rules.find((r) => r.selectorText === '*');
  const flexRule = rules.find((r) => r.selectorText === '.u-flex');
  assert(starRule?.layer === 'reset', `* 位于 @layer reset（实际 ${starRule?.layer}）`);
  assert(flexRule?.layer === 'utilities', `.u-flex 位于 @layer utilities（实际 ${flexRule?.layer}）`);

  // ③ 特殊 at-rule 收集 + 结构
  const key = atRules.find((a) => a.name === 'keyframes');
  assert(!!key, 'atRules 收集 @keyframes');
  assert(key!.prelude === 'spin', `keyframes 动画名 = spin（实际 ${key!.prelude}）`);
  assert(key!.frames && key!.frames.length === 3, `keyframes 帧数 = 3（实际 ${key!.frames?.length}）`);
  assert(key!.frames![0].key === '0%', `帧0 key = 0%（实际 ${key!.frames![0].key}）`);
  assert(key!.frames![0].declarations[0].property === 'transform', '帧0 声明 transform');
  assert(key!.frames![1].key === 'from' && key!.frames![1].declarations[0].property === 'opacity', 'from 帧声明 opacity');
  assert(key!.frames![2].key.replace(/\s+/g, '') === '50%,to', `合并帧 key = 50%, to（实际 ${key!.frames![2].key}）`);
  assert(key!.frames![2].declarations[0].value === 'rotate(360deg)', 'to 帧值 rotate(360deg)');

  const ff = atRules.find((a) => a.name === 'font-face');
  assert(!!ff, 'atRules 收集 @font-face');
  assert(ff!.declarations?.[0].property === 'font-family', 'font-face 声明提取（font-family）');
  assert(ff!.declarations?.some((d) => d.property === 'src'), 'font-face 含 src');
}

// ============ 内置示例：画廊初始化数据 ============
{
  // 与 page.tsx 的 SAMPLE_CSS 结构一致：@layer 两条 + 4 条普通规则 + @media 两条 + keyframes + font-face
  const src = `
@layer base {
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
}
.card { margin: 12px; padding: 16px; border-radius: 12px; background: linear-gradient(135deg, #0d1330, #17224a); }
.card .title { color: #7dd3fc; }
.btn { padding: 8px 18px; border-radius: 8px; font-weight: 600; }
.btn.primary { background: #0891b2; color: #fff; }
@media (max-width: 480px) {
  .card { padding: 8px; }
  .btn { width: 100%; }
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@font-face {
  font-family: 'Sample';
  src: url(sample.woff2) format('woff2');
}
`;
  const { rules, atRules, error } = parseStylesheet(src);
  assert(error === null, '内置示例解析无错误');
  assert(rules.length === 8, `内置示例规则数 = 8（实际 ${rules.length}）`);
  assert(atRules.length === 2, `内置示例 atRules 数 = 2（实际 ${atRules.length}）`);
  assert(atRules.some((a) => a.name === 'keyframes'), '内置示例含 @keyframes');
  assert(atRules.some((a) => a.name === 'font-face'), '内置示例含 @font-face');
  const layered = rules.filter((r) => r.layer);
  assert(layered.length === 2 && layered.every((r) => r.layer === 'base'), `内置示例 @layer 上下文正确（实际 ${layered.map((r) => r.layer).join(',')}）`);
  const mediaRules = rules.filter((r) => r.mediaQuery);
  assert(mediaRules.length === 2, `内置示例 @media 规则 = 2（实际 ${mediaRules.length}）`);
}

console.log('\n规则画廊解析验证完毕');
