
/* ============================================================
   主题切换 + 设置弹窗
   ------------------------------------------------------------
   每套主题只是覆盖 :root 那套 CSS 变量（配色）。切换即给 <html>
   设置 data-theme，并存进 localStorage(dnd_theme)。
   入口：日志页右上角「设置 ⚙」弹窗里的主题下拉菜单。
   想加新主题：① 在下面 THEMES 里加一项；
              ② 在 character_sheet.css 里加对应的 [data-theme="id"] 变量块。
   （id = 'violet' 是默认，无需 CSS 块，直接用 :root 的值。）
============================================================ */
(function () {

  const THEMES = [
    { id: 'violet',  name: '银灰紫' },
    { id: 'amber',   name: '琥珀金' },
    { id: 'blood',   name: '赤红' },
    { id: 'emerald', name: '翡翠' },
    { id: 'azure',   name: '霜蓝' },
    { id: 'ivory',   name: '羊皮纸' },
  ];
  const DEFAULT_THEME = 'violet';

  function currentTheme() { return load('theme', DEFAULT_THEME); }

  function applyTheme(id) {
    document.documentElement.dataset.theme = id;
    save('theme', id);
  }

  /* ──── 主题下拉 ──── */
  const sel = $('theme-select');
  if (sel) {
    THEMES.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
    sel.value = currentTheme();
    sel.addEventListener('change', () => applyTheme(sel.value));
  }

  /* ──── 全局字号档位（用 zoom 只等比缩放【内容区 #pages-container】：
       px 布局随之放大不溢出；底部 dock 栏 #tab-bar 在其外，不受影响、位置不变）──── */
  function currentFontScale() { return load('fontScale', 1); }
  function applyFontScale(z) {
    const box = document.getElementById('pages-container');
    if (box) box.style.zoom = z;
    save('fontScale', z);
  }
  const fsSel = $('fontscale-select');
  if (fsSel) {
    fsSel.value = String(currentFontScale());
    fsSel.addEventListener('change', () => applyFontScale(parseFloat(fsSel.value) || 1));
  }

  /* ──── 设置弹窗开关（日志页右上角齿轮）──── */
  const modal = $('settings-modal');
  const gear  = $('btn-settings');
  if (gear && modal) {
    gear.addEventListener('click', () => {
      if (sel) sel.value = currentTheme();                   /* 打开时同步当前选中 */
      if (fsSel) fsSel.value = String(currentFontScale());   /* 同步字号选中 */
      modal.classList.remove('hidden');
    });
    $('settings-close').addEventListener('click', () => modal.classList.add('hidden'));
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
  }

  /* 初始化：主题挂 <html>；字号只挂内容区（内联脚本可能已设置，这里兜底）*/
  document.documentElement.dataset.theme = currentTheme();
  (function () {
    const box = document.getElementById('pages-container');
    if (box) box.style.zoom = currentFontScale();
  })();

})();
