/* ============================================================
   法术数据库 · 聚合器
   ------------------------------------------------------------
   法术按环阶拆到 js/data/spell_<环>.js 里分别定义 SPELL_L<环>，
   本文件把它们合并成全局 SPELL_DB（其它代码只认 SPELL_DB，不用改）。
   index.html 里各 spell_<环>.js 必须排在本文件之前加载。

   下面用 typeof 容错：某环文件还没建（SPELL_L<环> 未定义）时按空数组处理，
   不会报错。所以 4~9 环即使暂时没有文件也没关系。

   ★ 新增高环（如 4 环）：
     1) 建 js/data/spell_4.js，定义 const SPELL_L4 = [ ... ]；
     2) index.html 在本文件之前加 <script src="js/data/spell_4.js">；
     （无需改本文件——下面已经把 L0~L9 都算进去了。）
============================================================ */
const SPELL_DB = [].concat(
  typeof SPELL_L0 !== 'undefined' ? SPELL_L0 : [],
  typeof SPELL_L1 !== 'undefined' ? SPELL_L1 : [],
  typeof SPELL_L2 !== 'undefined' ? SPELL_L2 : [],
  typeof SPELL_L3 !== 'undefined' ? SPELL_L3 : [],
  typeof SPELL_L4 !== 'undefined' ? SPELL_L4 : [],
  typeof SPELL_L5 !== 'undefined' ? SPELL_L5 : [],
  typeof SPELL_L6 !== 'undefined' ? SPELL_L6 : [],
  typeof SPELL_L7 !== 'undefined' ? SPELL_L7 : [],
  typeof SPELL_L8 !== 'undefined' ? SPELL_L8 : [],
  typeof SPELL_L9 !== 'undefined' ? SPELL_L9 : []
);
