/* ============================================================
   交互：死亡豁免
============================================================ */
document.querySelectorAll('.save-circle').forEach(c => {
  c.addEventListener('click', () => {
    const type = c.dataset.type;
    const idx  = parseInt(c.dataset.idx, 10);
    state.deathSave[type][idx] = !state.deathSave[type][idx];
    save('deathSave', state.deathSave);
    renderDeathSaves();
    if (typeof logEvent === 'function') {
      const n = state.deathSave[type].filter(Boolean).length;
      const lbl = type === 'success' ? '死亡豁免成功' : '死亡豁免失败';
      logEvent('hp', '💀', (state.deathSave[type][idx] ? '' : '撤销') + `${lbl}（${n}/3）`);
    }
  });
});

/* ============================================================
   交互：力竭计数
============================================================ */
document.querySelectorAll('.exhaust-pip').forEach(pip => {
  pip.addEventListener('click', () => {
    const idx = parseInt(pip.dataset.idx, 10);
    state.exhaustion[idx] = !state.exhaustion[idx];
    save('exhaustion', state.exhaustion);
    renderExhaustion();
  });
});

/* ============================================================
   交互：断专注
============================================================ */
$('conc-break').addEventListener('click', () => {
  const nm = state.concentration && typeof getSpell === 'function' ? (getSpell(state.concentration) || {}).name : '';
  state.concentration = null;
  save('concentration', null);
  renderConcentration();
  renderSpellPanel();
  if (typeof logEvent === 'function') logEvent('cast', '🎯', nm ? `断开专注（${nm}）` : '断开专注');
});

/* ============================================================
   通用对话框（确认 / 提示）—— 替代原生 alert / confirm
   showDialog({ icon, title, message, confirmText, cancelText, onConfirm })
   · 只传 confirmText → 提示框（单按钮）
   · 同时传 cancelText → 确认框（确定时执行 onConfirm）
============================================================ */
let dialogOnConfirm = null;

function showDialog(opts) {
  const {
    icon = '', title = '', message = '',
    confirmText = '确定', cancelText = null, onConfirm = null,
  } = opts;
  $('dialog-icon').textContent = icon;
  $('dialog-icon').style.display = icon ? '' : 'none';
  $('dialog-title').textContent = title;
  $('dialog-message').innerHTML = message;   /* 允许简单 <br> 标记 */
  $('dialog-confirm').textContent = confirmText;
  $('dialog-confirm').style.display = '';     /* 复位：升环对话框可能曾隐藏它 */
  const cancelBtn = $('dialog-cancel');
  if (cancelText) { cancelBtn.textContent = cancelText; cancelBtn.style.display = ''; }
  else            { cancelBtn.style.display = 'none'; }
  dialogOnConfirm = onConfirm;
  $('dialog-modal').classList.remove('hidden');
  $('dialog-confirm').focus();
}

function closeDialog() {
  $('dialog-modal').classList.add('hidden');
  dialogOnConfirm = null;
}

$('dialog-confirm').addEventListener('click', () => {
  const cb = dialogOnConfirm;
  closeDialog();
  if (cb) cb();
});
$('dialog-cancel').addEventListener('click', closeDialog);
$('dialog-modal').addEventListener('click', e => { if (e.target === $('dialog-modal')) closeDialog(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('dialog-modal').classList.contains('hidden')) closeDialog();
});

/* ============================================================
   交互：一键长休
============================================================ */
function doLongRest() {
  state.maxHp         = CHAR.maxHp;
  state.hp            = state.maxHp;
  state.tempHp        = 0;
  state.slots         = CHAR.spellSlots.map(count => new Array(count).fill(false));  /* 各环阶法术位全恢复，环数由配置决定 */
  state.channel       = new Array(CHAR.channelDivinity).fill(false);
  state.deathSave     = { success:[false,false,false], fail:[false,false,false] };
  state.concentration = null;
  state.buffs         = {};
  state.buffDurations = {};
  /* 力竭每次长休减一级（从末尾往前找第一个激活的清除） */
  const lastActive = [...state.exhaustion].lastIndexOf(true);
  if (lastActive !== -1) state.exhaustion[lastActive] = false;
  /* 生命骰：长休恢复「上限的一半，向下取整，至少 1」个 */
  const hdMax = CHAR.hitDiceMax || 0;
  let hdRecovered = 0;
  if (hdMax > 0) {
    const spent = (state.hitDice || []).filter(Boolean).length;
    const recover = Math.max(1, Math.floor(hdMax / 2));
    const newSpent = Math.max(0, spent - recover);
    hdRecovered = spent - newSpent;
    state.hitDice = new Array(hdMax).fill(false).map((_, i) => i < newSpent);
  }
  /* 临时法术：长休恢复全部（含短休类）*/
  (state.tempSpells || []).forEach(t => { t.used = 0; });
  save('maxHp',        state.maxHp);
  save('hp',           state.hp);
  save('tempHp',       state.tempHp);
  save('slots',        state.slots);
  save('channel',      state.channel);
  save('deathSave',    state.deathSave);
  save('concentration', state.concentration);
  save('buffs',        state.buffs);
  save('buffDurations', state.buffDurations);
  save('exhaustion',   state.exhaustion);
  save('hitDice',      state.hitDice);
  save('tempSpells',   state.tempSpells);
  $('temp-hp-slider').value = 0;
  $('temp-hp-slider-val').textContent = 0;
  $('temp-hp-slider-wrap').classList.add('hidden');
  renderHp();
  renderSlots();
  renderDeathSaves();
  renderExhaustion();
  renderChannel();
  renderHitDice();
  renderTempSpells();
  renderConcentration();
  renderSpellPanel();
  renderBuffs();
  if (typeof logEvent === 'function') {
    logEvent('rest', '⌛', '进行了长休 · 恢复生命与法术位，力竭 −1');
    if (hdRecovered > 0) {
      const hdLeft = hdMax - state.hitDice.filter(Boolean).length;
      logEvent('rest', '🎲', `长休恢复 ${hdRecovered} 个生命骰（剩 ${hdLeft}/${hdMax}）`);
    }
  }
}

$('btn-long-rest').addEventListener('click', () => {
  showDialog({
    icon: '⌛',
    title: '长休',
    message: '确定进行长休吗？',
    confirmText: '长休',
    cancelText: '取消',
    onConfirm: doLongRest,
  });
});

/* ============================================================
   交互：短休（恢复引导神力 + 断专注，不影响血量）
============================================================ */
function doShortRest() {
  state.channel       = new Array(CHAR.channelDivinity).fill(false);  /* 引导神力回满 */
  state.concentration = null;                                          /* 断开专注 */
  /* 临时法术：短休只恢复"短休"类 */
  (state.tempSpells || []).forEach(t => { if (t.recharge === 'short') t.used = 0; });
  save('channel', state.channel);
  save('concentration', state.concentration);
  save('tempSpells', state.tempSpells);
  renderChannel();
  renderConcentration();
  renderTempSpells();
  renderSpellPanel();   /* 刷新法术面板里的专注按钮高亮 */
  if (typeof logEvent === 'function') logEvent('rest', '☾', '进行了短休 · 恢复引导神力，断开专注');
}

$('btn-short-rest').addEventListener('click', () => {
  showDialog({
    icon: '☾',
    title: '短休',
    message: '确定进行短休吗？',
    confirmText: '短休',
    cancelText: '取消',
    onConfirm: doShortRest,
  });
});

/* ============================================================
   全数据备份：导出 / 导入（覆盖全部 dnd_ 开头的 localStorage 键，含冒险日志）
   —— 入口在「设置」弹窗（日志页右上角齿轮），背包页不再放备份按钮。
   与日志页自带的「日志导入导出」是两套：这里是整卡快照/灾备（整体覆盖还原），
   日志页那套是日志专用（合并追加）。
============================================================ */
/* 收集所有本卡数据（含冒险日志 dnd_sessions / dnd_currentSessionId），键值原样搬运 */
function collectBackup() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('dnd_')) data[key] = localStorage.getItem(key);
  }
  return data;
}

function exportBackup() {
  const payload = {
    app: 'dnd-character-sheet',
    version: 2,
    exportedAt: new Date().toISOString(),
    data: collectBackup(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `dnd-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showDialog({
    icon: '⬇', title: '已导出',
    message: `已保存 ${Object.keys(payload.data).length} 项数据（含冒险日志）到备份文件。<br>妥善保管这个 .json 文件。`,
    confirmText: '好',
  });
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try { parsed = JSON.parse(reader.result); }
    catch { showDialog({ icon: '⚠', title: '导入失败', message: '文件不是有效的 JSON。', confirmText: '知道了' }); return; }

    const data = parsed && parsed.data;
    if (parsed.app !== 'dnd-character-sheet' || !data || typeof data !== 'object') {
      showDialog({ icon: '⚠', title: '导入失败', message: '这不是本角色卡的备份文件。', confirmText: '知道了' });
      return;
    }

    const keys = Object.keys(data).filter(k => k.startsWith('dnd_'));
    if (!keys.length) {
      showDialog({ icon: '⚠', title: '导入失败', message: '备份文件里没有可用的数据。', confirmText: '知道了' });
      return;
    }

    showDialog({
      icon: '⬆', title: '导入全部数据',
      message: `将用备份中的 ${keys.length} 项数据<b>整体覆盖</b>当前全部数据（含冒险日志）。<br>` +
                '为防止点错，导入前会先自动下载一份「当前数据」的安全快照，之后再覆盖。<br>确定导入吗？',
      confirmText: '覆盖导入', cancelText: '取消',
      onConfirm: () => {
        /* 安全网：覆盖前先把当前数据（含日志）自动导出一份全量快照 */
        try {
          const snapshot = { app: 'dnd-character-sheet', version: 2, exportedAt: new Date().toISOString(), autoSnapshot: true, data: collectBackup() };
          const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement('a');
          a.href     = url;
          a.download = `dnd-backup-导入前快照-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        } catch (err) {
          console.error('[importBackup] 导入前快照失败：', err);
        }

        /* 清除现有全部 dnd_ 键（含日志），再写入备份，最后重载页面让状态重新初始化 */
        const existing = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('dnd_')) existing.push(k);
        }
        existing.forEach(k => localStorage.removeItem(k));
        keys.forEach(k => localStorage.setItem(k, data[k]));
        location.reload();
      },
    });
  };
  reader.readAsText(file);
}

$('settings-export').addEventListener('click', exportBackup);
$('settings-import').addEventListener('click', () => $('settings-import-file').click());
$('settings-import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) importBackup(file);
  e.target.value = '';   /* 清空以便重复选择同一文件 */
});

