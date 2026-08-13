// CSS 层叠解释器的内置 demo（纯数据，供组件与测试复用）

export const DEFAULT_DEMO_HTML = `<div class="scene">
  <h1 class="title">🌌 深空控制台</h1>
  <div class="panel" id="main-panel">
    <header class="panel-head">
      <h2 class="panel-title">任务日志</h2>
      <span class="badge">运行中</span>
    </header>
    <p class="desc">这是一个用于演示 <strong>CSS 层叠</strong> 的示例。点任意元素看瀑布。</p>
    <ul class="log">
      <li class="item warn">推进器预热</li>
      <li class="item">轨道修正 12%</li>
      <li class="item active">跃迁准备就绪</li>
    </ul>
    <button class="btn primary">🚀 发射</button>
    <button class="btn">取消</button>
  </div>
  <p class="foot">* 点击任意元素查看层叠瀑布</p>
</div>`;

export const DEFAULT_DEMO_CSS = `* {
  box-sizing: border-box;
}
body {
  margin: 0;
  padding: 24px;
  background: #0a0e27;
  color: #cbd5e1;
  font-family: 'Segoe UI', system-ui, sans-serif;
}
h1, h2, p, ul {
  margin: 0;
}
.title {
  font-size: 28px;
  text-align: center;
  color: #7dd3fc;
}
.panel {
  margin: 18px auto;
  padding: 20px;
  max-width: 420px;
  border-radius: 14px;
  background: rgba(16, 22, 48, .85);
  border: 1px solid rgba(94, 234, 212, .28);
}
.panel-title {
  font-size: 18px;
  color: #e2e8f0;
}
.panel .panel-title {
  color: #67e8f9;
}
.desc {
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.7;
  color: #94a3b8;
}
.badge {
  display: inline-block;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  background: #065f46;
  color: #6ee7b7;
}
.badge {
  color: #86efac !important;
}
.log {
  margin: 12px 0;
  padding: 0;
  list-style: none;
}
.item {
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, .04);
  color: #e2e8f0;
}
.item.active {
  background: #1e3a5f;
  color: #93c5fd;
}
.item.warn {
  color: #fbbf24;
}
.btn {
  margin-top: 6px;
  padding: 8px 18px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  background: #1e293b;
  color: #cbd5e1;
}
.btn.primary {
  background: #0891b2;
  color: #fff;
}
@media (max-width: 480px) {
  .panel { padding: 12px; }
  .title { font-size: 22px; }
}`;
