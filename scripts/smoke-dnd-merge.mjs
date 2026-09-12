#!/usr/bin/env node
/**
 * 角色卡「字段级同步」的三方比对纯函数测试（不需要服务端/浏览器）。
 * 直接跑 public/dnd/js/features/sync-merge.js 里的 decide()，重点回归
 * 「服务器旧值不得覆盖本地未推送的新值」这个曾导致丢数据的场景。
 *
 * 用法：node scripts/smoke-dnd-merge.mjs
 */

import DndSync from '../public/dnd/js/features/sync-merge.js';

let failures = 0;
function check(name, condition, detail = '') {
  console.log(`  ${condition ? '✔' : '✘'} ${name}${condition ? '' : ` — ${detail}`}`);
  if (!condition) failures += 1;
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const empty = (o) => Object.keys(o).length === 0;

console.log('[合并判定] sync-merge.decide()');

let plan = DndSync.decide({}, { hp: '10', xp: '5' }, {});
check('新浏览器（本地空）：采纳服务器全部字段', eq(plan.adopt, { hp: '10', xp: '5' }) && empty(plan.push));

plan = DndSync.decide({ hp: '10' }, { hp: '10' }, { hp: '10' });
check('完全一致：不采纳也不推送，只记已同步', eq(plan.synced, { hp: '10' }) && empty(plan.push) && empty(plan.adopt) && plan.pushDelete.length === 0);

plan = DndSync.decide({ hp: '10' }, { hp: '20' }, { hp: '10' });
check('服务器更新且本地已同步：采纳服务器', eq(plan.adopt, { hp: '20' }) && empty(plan.push));

plan = DndSync.decide({ hp: '30' }, { hp: '10' }, { hp: '10' });
check('本地有未推送改动：保留本地并推送，服务器值留档', eq(plan.push, { hp: '30' }) && empty(plan.adopt) && eq(plan.conflicts, { hp: '10' }));

plan = DndSync.decide({ hp: '30', xp: '99' }, { hp: '10' }, { hp: '10', xp: '99' });
check('★回归：服务器旧值不会覆盖本地新值', plan.adopt.hp === undefined && plan.push.hp === '30');

plan = DndSync.decide({ hp: '10', brandNew: 'v' }, { hp: '10' }, { hp: '10' });
check('本地新增字段：推送上去', eq(plan.push, { brandNew: 'v' }));

plan = DndSync.decide({ hp: '10', gone: 'x' }, { hp: '10' }, { hp: '10', gone: 'x' });
check('服务器删了且本地已同步：本地跟随删除', eq(plan.removeLocal, ['gone']) && empty(plan.push));

plan = DndSync.decide({ hp: '10' }, { hp: '10', gone: 'x' }, { hp: '10', gone: 'x' });
check('本地删了而服务器还有：推送 null 删除', eq(plan.pushDelete, ['gone']) && empty(plan.adopt));

plan = DndSync.decide({}, { gone: 'x' }, { gone: null });
check('删除已推送过（acked=null）：服务器复活就再推一次删除', eq(plan.pushDelete, ['gone']));

plan = DndSync.decide({}, { gone: 'x' }, {});
check('新浏览器遇到服务器字段：采纳而不是删除', eq(plan.adopt, { gone: 'x' }) && plan.pushDelete.length === 0);

plan = DndSync.decide({ a: 'A1', b: 'B2' }, { a: 'A2', b: 'B1' }, { a: 'A1', b: 'B1' });
check('不同字段各改各的：a 采纳服务器、b 推送本地', plan.adopt.a === 'A2' && plan.push.b === 'B2' && plan.push.a === undefined);

const fakeStore = {
  length: 3,
  key: (i) => ['dnd_hp', 'box-dnd-sync-acked', 'dnd_xp'][i],
  getItem: (k) => ({ dnd_hp: '1', 'box-dnd-sync-acked': '{}', dnd_xp: '2' })[k] ?? null,
};
check('collect()：只收集 dnd_ 前缀，忽略 acked 等内部键', eq(DndSync.collect('dnd_', fakeStore), { hp: '1', xp: '2' }));

console.log(failures ? `\n✘ ${failures} 项失败` : '\n✔ 全部通过');
process.exit(failures ? 1 : 0);
