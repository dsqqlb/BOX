/* ============================================================
   台词模块（日志页）
   ------------------------------------------------------------
   · 默认从当前分类池里随机显示 3 条，「🎲 换一批」重抽
   · 分类标签单选（全部 / 各分类），缩小随机与搜索的范围
   · 搜索框输入关键词时，改为列出全部匹配的台词（便于找特定一句）
   数据来自 js/data/lines.js 的 LINES_DB / LINE_CATS，纯读取。
============================================================ */
(function () {
  const CATS = (typeof LINE_CATS !== 'undefined') ? LINE_CATS : [];
  const DB   = (typeof LINES_DB !== 'undefined') ? LINES_DB : [];
  const CAT_LABEL = (typeof LINE_CAT_LABEL !== 'undefined') ? LINE_CAT_LABEL : {};
  const SHOW_N = 3;

  const tabsEl   = $('lines-tabs');
  const listEl   = $('lines-list');
  const searchEl = $('lines-search');
  const rerollBtn = $('lines-reroll');
  if (!tabsEl || !listEl) return;   /* 页面上没有台词模块就跳过 */

  let selCat = 'all';
  let term   = '';

  function pool() {
    return DB.filter(l =>
      (selCat === 'all' || l.cat === selCat) &&
      (!term || (l.text && l.text.toLowerCase().includes(term)))
    );
  }

  function pickRandom(arr, n) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
  }

  /* ──── 分类标签（单选）──── */
  function buildTabs() {
    tabsEl.innerHTML = '';
    const mk = (key, label) => {
      const b = document.createElement('button');
      b.className = 'sp-tab';
      b.dataset.key = key;
      b.textContent = label;
      b.addEventListener('click', () => { selCat = key; render(); });
      tabsEl.appendChild(b);
    };
    mk('all', '全部');
    CATS.forEach(c => mk(c.key, c.label));
  }

  /* ──── 渲染 ──── */
  function render() {
    tabsEl.querySelectorAll('.sp-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.key === selCat));

    const searching = !!term.trim();
    const p = pool();
    const show = searching ? p : pickRandom(p, SHOW_N);

    if (rerollBtn) rerollBtn.style.display = searching ? 'none' : '';

    listEl.innerHTML = '';
    if (!show.length) {
      const empty = document.createElement('div');
      empty.className = 'lines-empty';
      empty.textContent = searching ? '没有匹配的台词。' : '该分类暂无台词。';
      listEl.appendChild(empty);
      return;
    }

    show.forEach(l => {
      const card = document.createElement('div');
      card.className = 'line-card';

      const tag = document.createElement('span');
      tag.className = 'line-cat-tag';
      tag.textContent = CAT_LABEL[l.cat] || l.cat;
      card.appendChild(tag);

      const txt = document.createElement('div');
      txt.className = 'line-text';
      txt.textContent = l.text;
      card.appendChild(txt);

      listEl.appendChild(card);
    });
  }

  if (rerollBtn) rerollBtn.addEventListener('click', render);   /* 换一批：重抽随机 */
  if (searchEl) searchEl.addEventListener('input', e => {
    term = e.target.value.trim().toLowerCase();
    render();
  });

  buildTabs();
  render();
})();
