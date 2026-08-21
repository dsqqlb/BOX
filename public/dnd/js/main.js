/* ============================================================
   首次渲染
============================================================ */
renderCharSheet();
renderHp();
renderSpellPanel();
renderConcentration();
renderDeathSaves();
renderExhaustion();
renderChannel();
renderHitDice();
renderTempSpells();
renderBuffs();
renderLuckyDice();
renderXp();
renderSkills();
renderRaces();
renderFeats();

/* 幸运骠子交互 */
$('lucky-minus').addEventListener('click', () => {
  if (state.luckyDice > 0) {
    state.luckyDice--; save('luckyDice', state.luckyDice); renderLuckyDice();
    if (typeof logEvent === 'function') logEvent('combat', '🎲', `使用幸运骰（剩 ${state.luckyDice}）`);
  }
});
$('lucky-plus').addEventListener('click', () => {
  state.luckyDice++; save('luckyDice', state.luckyDice); renderLuckyDice();
  if (typeof logEvent === 'function') logEvent('combat', '🎲', `幸运骰 +1（共 ${state.luckyDice}）`);
});
$('lucky-val').addEventListener('click', () => {
  $('lucky-val').style.display = 'none';
  $('lucky-input').style.display = '';
  $('lucky-input').value = state.luckyDice;
  $('lucky-input').focus();
  $('lucky-input').select();
});
function commitLuckyEdit() {
  let v = parseInt($('lucky-input').value, 10);
  if (isNaN(v) || v < 0) v = state.luckyDice;
  state.luckyDice = v;
  save('luckyDice', state.luckyDice);
  $('lucky-val').style.display = '';
  $('lucky-input').style.display = 'none';
  renderLuckyDice();
}
$('lucky-input').addEventListener('blur', commitLuckyEdit);
$('lucky-input').addEventListener('keydown', e => { if (e.key === 'Enter') commitLuckyEdit(); });

/* 经验值编辑（点数字就地编辑 → 保存到 dnd_xp / dnd_xpToNextManual）*/
$('xp-current').addEventListener('click', editXpCurrent);
$('xp-input').addEventListener('blur', commitXpCurrent);
$('xp-input').addEventListener('keydown', e => { if (e.key === 'Enter') commitXpCurrent(); });
$('xp-next').addEventListener('click', editXpNext);
$('xp-next-input').addEventListener('blur', commitXpNext);
$('xp-next-input').addEventListener('keydown', e => { if (e.key === 'Enter') commitXpNext(); });

/* 面板折叠按鈕 */
document.querySelectorAll('.panel').forEach(panel => {
  const title = panel.querySelector(':scope > .panel-title');
  if (!title) return;
  const btn = document.createElement('button');
  btn.className = 'panel-collapse-btn';
  btn.setAttribute('aria-label', '折叠面板');
  btn.textContent = '▾';
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const collapsed = panel.classList.toggle('collapsed');
    btn.textContent = collapsed ? '▸' : '▾';
  });
  title.appendChild(btn);
});

/* 底部标签翻页 */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.page).classList.add('active');
    save('active_page', btn.dataset.page);
  });
});
/* 全收起按钮 */
document.getElementById('btn-collapse-all').addEventListener('click', () => {
  document.querySelectorAll('.srow-glow-wrap').forEach(w => {
    const innerRow = w.querySelector('.srow');
    if (innerRow) {
      w.parentNode.insertBefore(innerRow, w);
      const btn = innerRow.querySelector('.srow-detail-btn');
      if (btn) btn.classList.remove('open');   /* 同步复位箭头方向 */
    }
    w.remove();
  });
});

/* 恢复上次标签页 */
(function () {
  const lastPage = load('active_page', '');
  if (lastPage) {
    const btn  = document.querySelector(`.tab-btn[data-page="${lastPage}"]`);
    const page = document.getElementById(lastPage);
    if (btn && page) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      page.classList.add('active');
    }
  }
}());


