/* ============================================================
   任务模块（日志页 · 台词下方）
   ------------------------------------------------------------
   · 记录自己的任务与备忘事项，支持 优先级 + 完成状态 + 编辑
   · 数据存 dnd_quests（dnd_ 前缀 → 随「全数据备份」整体导出 / 导入，不单独做）
   · 有进行中的跑团时，增删改都会记入冒险日志（分类「任务」），
     因此可被「撤销」回卷；未开团时仅本地保存、不可撤销
   条目结构：{ id, title, desc, priority:'high'|'mid'|'low',
               createdAt, done, doneAt }
============================================================ */
(function () {
  const STORE_KEY = 'quests';
  const listEl     = $('quest-list');
  const tabsEl     = $('quest-tabs');
  const titleInput = $('quest-title-input');
  const priSelect  = $('quest-prio');
  const addBtn     = $('quest-add');
  const countEl    = $('quest-count');
  if (!listEl) return;   /* 页面上没有任务模块就跳过 */

  /* 优先级元信息 */
  const PRIO = {
    high: { label: '优先', cls: 'q-prio-high' },
    mid:  { label: '常规', cls: 'q-prio-mid' },
    low:  { label: '次要', cls: 'q-prio-low' },
  };
  /* 状态筛选 */
  const FILTERS = [
    { key: 'all',  label: '全部' },
    { key: 'open', label: '进行中' },
    { key: 'done', label: '已完成' },
  ];

  function uid()  { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDate(t) {
    if (!t) return '';
    const d = new Date(t);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  let filter = 'all';
  let quests = load(STORE_KEY, []);

  function saveQuests() { save(STORE_KEY, quests); }

  /* 记录一条任务日志（无进行中跑团时 logEvent 内部自动忽略，不影响其它） */
  function log(icon, text) {
    if (typeof logEvent === 'function') logEvent('quest', icon, text);
  }

  /* ──── 分类筛选 tabs ──── */
  function buildTabs() {
    if (!tabsEl) return;
    tabsEl.innerHTML = '';
    FILTERS.forEach(f => {
      const b = document.createElement('button');
      b.className = 'sp-tab' + (f.key === filter ? ' active' : '');
      b.textContent = f.label;
      b.addEventListener('click', () => { filter = f.key; buildTabs(); render(); });
      tabsEl.appendChild(b);
    });
  }

  function filtered() {
    return quests.filter(q => {
      if (filter === 'open') return !q.done;
      if (filter === 'done') return !!q.done;
      return true;
    });
  }

  function updateCount() {
    if (!countEl) return;
    const open = quests.filter(q => !q.done).length;
    const done = quests.length - open;
    const parts = [`进行中 ${open}`, `已完成 ${done}`];
    if (quests.length) parts.push(`共 ${quests.length}`);
    countEl.textContent = parts.join(' · ');
  }

  /* ──── 渲染 ──── */
  function render() {
    listEl.innerHTML = '';

    if (!quests.length) {
      const empty = document.createElement('div');
      empty.className = 'quest-empty';
      empty.textContent = '还没有任务 / 备忘。在上方输入框打个字，回车即可记下。';
      listEl.appendChild(empty);
      updateCount();
      return;
    }

    const items = filtered();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'quest-empty';
      empty.textContent = filter === 'done' ? '还没有已完成的任务。' : '没有进行中的任务。';
      listEl.appendChild(empty);
      updateCount();
      return;
    }

    /* 排序：未完成在前 → 同一态内按优先级（高→低）→ 再按创建时间新的在前 */
    const rank = { high: 0, mid: 1, low: 2 };
    const sorted = [...items].sort((a, b) => {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      const pa = rank[a.priority] == null ? 1 : rank[a.priority];
      const pb = rank[b.priority] == null ? 1 : rank[b.priority];
      if (pa !== pb) return pa - pb;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    sorted.forEach(q => {
      const card = document.createElement('div');
      card.className = 'quest-card' + (q.done ? ' quest-done' : '');
      card.setAttribute('data-id', q.id);

      /* 完成勾选 */
      const check = document.createElement('button');
      check.className = 'quest-check';
      check.textContent = q.done ? '✓' : '';
      check.title = q.done ? '恢复为进行中' : '标记已完成';
      check.addEventListener('click', () => toggleDone(q));

      /* 主体 */
      const body = document.createElement('div');
      body.className = 'quest-body';

      const top = document.createElement('div');
      top.className = 'quest-top';
      const pm = PRIO[q.priority] || PRIO.mid;
      const prio = document.createElement('span');
      prio.className = 'quest-prio ' + pm.cls;
      prio.textContent = pm.label;
      const title = document.createElement('span');
      title.className = 'quest-title';
      title.textContent = q.title;
      top.appendChild(prio);
      top.appendChild(title);
      body.appendChild(top);

      const meta = document.createElement('div');
      meta.className = 'quest-meta';
      if (q.desc && q.desc.trim()) {
        const desc = document.createElement('div');
        desc.className = 'quest-desc';
        desc.textContent = q.desc;
        meta.appendChild(desc);
      }
      const time = document.createElement('span');
      time.className = 'quest-time';
      time.textContent = (q.done && q.doneAt ? '完成于 ' : '') + fmtDate(q.done && q.doneAt ? q.doneAt : q.createdAt);
      meta.appendChild(time);
      body.appendChild(meta);

      /* 编辑 */
      const edit = document.createElement('button');
      edit.className = 'quest-act quest-edit';
      edit.textContent = '✎';
      edit.title = '编辑标题 / 说明 / 优先级';
      edit.addEventListener('click', () => openEdit(q));

      /* 删除 */
      const del = document.createElement('button');
      del.className = 'quest-act quest-del';
      del.textContent = '✕';
      del.title = '删除此任务';
      del.addEventListener('click', () => removeQuest(q));

      card.appendChild(check);
      card.appendChild(body);
      card.appendChild(edit);
      card.appendChild(del);
      listEl.appendChild(card);
    });

    updateCount();
  }

  /* ──── 添加 ──── */
  function addQuest() {
    const text = (titleInput.value || '').trim();
    if (!text) { titleInput.focus(); return; }
    const q = {
      id: uid(),
      title: text,
      desc: '',
      priority: (priSelect && priSelect.value) || 'mid',
      createdAt: Date.now(),
      done: false,
      doneAt: null,
    };
    quests.push(q);
    saveQuests();
    titleInput.value = '';
    filter = 'all'; buildTabs(); render();
    log('📌', `新增任务「${q.title}」`);
    titleInput.focus();
  }

  /* ──── 完成 / 恢复 ──── */
  function toggleDone(q) {
    q.done = !q.done;
    q.doneAt = q.done ? Date.now() : null;
    saveQuests();
    render();
    log(q.done ? '✅' : '↩', `${q.done ? '完成' : '恢复'}任务「${q.title}」`);
  }

  /* ──── 删除 ──── */
  function removeQuest(q) {
    if (typeof showDialog === 'function') {
      showDialog({
        icon: '🗑',
        title: '删除任务',
        message: `确定删除「${esc(q.title)}」吗？`,
        confirmText: '删除',
        cancelText: '取消',
        onConfirm: () => doRemove(q),
      });
    } else {
      doRemove(q);
    }
  }
  function doRemove(q) {
    quests = quests.filter(x => x.id !== q.id);
    saveQuests();
    render();
    log('🗑', `删除任务「${q.title}」`);
  }

  /* ──── 编辑（复用通用对话框） ──── */
  function openEdit(q) {
    if (typeof showDialog !== 'function') return;
    $('dialog-icon').textContent = '✎';
    $('dialog-icon').style.display = '';
    $('dialog-title').textContent = '编辑任务';
    $('dialog-message').innerHTML =
      `<div class="quest-edit-field">
         <label>标题</label>
         <input id="q-edit-title" type="text" maxlength="60" value="${esc(q.title)}">
       </div>
       <div class="quest-edit-field">
         <label>说明（可选）</label>
         <textarea id="q-edit-desc" rows="3">${esc(q.desc || '')}</textarea>
       </div>
       <div class="quest-edit-field">
         <label>优先级</label>
         <select id="q-edit-prio">
           <option value="high">优先</option>
           <option value="mid">常规</option>
           <option value="low">次要</option>
         </select>
       </div>`;
    $('q-edit-prio').value = q.priority;
    $('dialog-confirm').textContent = '保存';
    const cancelBtn = $('dialog-cancel');
    cancelBtn.textContent = '取消';
    cancelBtn.style.display = '';
    dialogOnConfirm = () => {
      const t = ($('q-edit-title').value || '').trim();
      if (!t) return;
      q.title = t;
      q.desc = ($('q-edit-desc').value || '').trim();
      q.priority = $('q-edit-prio').value;
      saveQuests();
      render();
      log('✎', `编辑任务「${t}」`);
    };
    $('dialog-modal').classList.remove('hidden');
    $('q-edit-title').focus();
    $('q-edit-title').select();
  }

  /* ──── 撤销恢复：undo 还原 dnd_quests 旧值后，本模块负责重载重渲染 ──── */
  document.addEventListener('undorestore', e => {
    if (e.detail && Array.isArray(e.detail.keys) && e.detail.keys.includes(STORE_KEY)) {
      quests = load(STORE_KEY, []);
      buildTabs();
      render();
    }
  });

  /* ──── 事件绑定 + 初始化 ──── */
  if (addBtn) addBtn.addEventListener('click', addQuest);
  if (titleInput) {
    titleInput.addEventListener('keydown', e => { if (e.key === 'Enter') addQuest(); });
  }

  buildTabs();
  render();
})();
