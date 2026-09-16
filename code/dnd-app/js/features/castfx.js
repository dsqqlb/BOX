/* ============================================================
   施法全屏特效
   ------------------------------------------------------------
   按法术学派 (sp.school) 播放不同的全屏动效，戏法用缩小/简化版。
   纯 CSS 关键帧驱动，这里只负责：
     · 生成一次性 DOM 片段扔进 #cast-fx-layer
     · 挂对应学派的 class，播完自动清除
     · 记忆“特效开/关”，并尊重系统的“减弱动态效果”辅助设置
   加新学派：① 在 SCHOOL_MAP 加一条中文名→key 的映射
             ② 在 character_sheet.css 里加 [data-school="key"] 的动效规则
============================================================ */
(function () {

  const LAYER = document.getElementById('cast-fx-layer');
  const BTN   = document.getElementById('btn-fx-toggle');

  /* 中文学派名 → 动效 key（对应 CSS 里的 data-school 选择器） */
  const SCHOOL_MAP = {
    '塑能': 'evocation',
    '防护': 'abjuration',
    '预言': 'divination',
    '咒法': 'conjuration',
    '附魔': 'enchantment',
    '幻术': 'illusion',
    '死灵': 'necromancy',
    '变化': 'transmutation',
  };

  const PARTICLE_COUNT = { full: 14, mini: 8 };

  function enabled() { return load('castFxEnabled', true); }

  function setEnabled(v) {
    save('castFxEnabled', v);
    updateBtn();
  }

  function updateBtn() {
    if (!BTN) return;
    BTN.classList.toggle('fx-off', !enabled());
    BTN.title = enabled() ? '施法全屏特效：开（点击关闭）' : '施法全屏特效：关（点击开启）';
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* 生成 n 个粒子 span，随机角度飞散/汇聚（通过内联 --angle 变量供 CSS 使用）*/
  function buildParticles(n) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const p = document.createElement('span');
      p.className = 'fx-particle';
      const angle = (360 / n) * i + (Math.random() * 18 - 9);
      const dist  = 34 + Math.random() * 14;   /* vw 单位的飞行距离，略微随机 */
      p.style.setProperty('--angle', angle + 'deg');
      p.style.setProperty('--dist', dist + 'vmin');
      p.style.animationDelay = (Math.random() * 0.08) + 's';
      frag.appendChild(p);
    }
    return frag;
  }

  /* ──── 对外接口：播放一次施法特效 ──── */
  window.playCastFx = function (sp, isMini) {
    if (!LAYER || !enabled()) return;
    const key = SCHOOL_MAP[sp && sp.school] || 'evocation';

    /* 减弱动态效果：只给一个极简的淡入淡出提示，不跑完整动效 */
    if (reducedMotion()) {
      LAYER.innerHTML = '';
      const flash = document.createElement('div');
      flash.className = 'fx-reduced-flash';
      LAYER.appendChild(flash);
      setTimeout(() => { LAYER.innerHTML = ''; }, 260);
      return;
    }

    LAYER.innerHTML = '';   /* 连续施法：新特效直接替换，不排队堆叠 */
    LAYER.className = '';
    LAYER.dataset.school = key;
    LAYER.classList.add('fx-play', isMini ? 'fx-mini' : 'fx-full');

    const root = document.createElement('div');
    root.className = 'fx-root';

    /* 通用图层：闪光 + 双圈环 + 晕影 + 扫光条，各学派通过 CSS 挑选启用哪几层 */
    ['fx-flash', 'fx-ring fx-ring-a', 'fx-ring fx-ring-b', 'fx-vignette', 'fx-sweep', 'fx-twist']
      .forEach(cls => {
        const el = document.createElement('div');
        el.className = cls;
        root.appendChild(el);
      });

    /* 粒子层：咒法/塑能等用得上 */
    const particleWrap = document.createElement('div');
    particleWrap.className = 'fx-particles';
    particleWrap.appendChild(buildParticles(isMini ? PARTICLE_COUNT.mini : PARTICLE_COUNT.full));
    root.appendChild(particleWrap);

    /* 屏幕正中央的法术名：中文大字 + 英文小字，随特效一起淡入淡出 */
    if (sp && sp.name) {
      const title = document.createElement('div');
      title.className = 'fx-title';
      title.innerHTML =
        `<span class="fx-title-cn cinzel">${sp.name}</span>` +
        (sp.nameEn ? `<span class="fx-title-en">${sp.nameEn}</span>` : '');
      root.appendChild(title);
    }

    LAYER.appendChild(root);

    /* 播放完毕自动清空（比最长动效稍留余量）*/
    const DURATION = isMini ? 650 : 950;
    setTimeout(() => {
      if (LAYER.dataset.school === key) { LAYER.innerHTML = ''; LAYER.classList.remove('fx-play'); }
    }, DURATION);
  };

  /* ————对外接口：播放对应的法术音频————
     约定：默认音频文件名 = spellId，放在 audios/ 下，扩展名 .mp3。
     例：id 'guidance' → audios/guidance.mp3。绝大多数法术不用登记。

     ★ 别名表 AUDIO_ALIAS（可选）：当【多个不同法术共用同一份音频】时，
       把它们都映射到同一个音频名即可，不必为每个法术各放一份文件。
       值只写音频名（不含 audios/ 前缀和 .mp3 后缀）。表里没有的法术
       一律用自己的 id 作音频名。没有对应文件时 play() 静默失败。*/
  const AUDIO_ALIAS = {
    // 例：几种治疗法术共用一个音频文件 audios/healing.mp3
    // 'cure_wounds':      'healing',
    // 'healing_word':     'healing',
    // 'mass_cure_wounds': 'healing',
    'healing_word' : 'cure_wounds',
  };

  window.playSpellAudio = function (sp) {
    if (!sp || !sp.id) return;
    const key = AUDIO_ALIAS[sp.id] || sp.id;   /* 有别名用别名，否则用 spellId */
    try {
      const audio = new Audio('audios/' + key + '.mp3');
      audio.play().catch(() => {});  /* 无文件/浏览器拦截自动播放 → 静默失败 */
    } catch (_) {}
  };

  if (BTN) BTN.addEventListener('click', () => setEnabled(!enabled()));
  updateBtn();

})();
