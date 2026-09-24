'use client';

/** 开发进度条：UNO 是分步做的，把路线图留在页面上，方便随时看做到哪一步了。 */

const ROADMAP: { step: string; title: string; detail: string; done: boolean }[] = [
  { step: 'Step 0', title: '工具骨架与权限', detail: '页面、权限白名单、首页卡片', done: true },
  { step: 'Step 1', title: '规则引擎与机器人', detail: '服务端权威发牌、出牌合法性、三档机器人', done: true },
  { step: 'Step 2', title: '房间与实时通道', detail: '6 位房间号、托管与席位找回、闲置回收', done: true },
  { step: 'Step 3', title: '大厅与建房', detail: '房间列表、房主自定义、等待室、可玩的基础牌桌', done: true },
  { step: 'Step 4', title: '育碧风格牌桌', detail: '自绘卡面、首字头像、立起的扇形手牌、方向箭头', done: false },
  { step: 'Step 5', title: '牌库一览', detail: '分类浏览每张牌，悬停/点击弹出浮层详情，带动效', done: false },
  { step: 'Step 6', title: '动效、音效与设置', detail: '发牌/出牌/抓牌动效、拖拽出牌、移动端、设置页面', done: false },
  { step: 'Step 7', title: '拓展系统', detail: 'JSON 定义新牌与房规，服务端钩子实现新玩法', done: false },
  { step: 'Step 8', title: '文档与收尾', detail: '完整文档、索引、全量回归', done: false },
];

export default function UnoProgress({ compact = false }: { compact?: boolean }) {
  return (
    <section className="mt-6 rounded-3xl border border-white/[.08] bg-white/[.02] p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-[.18em] text-slate-400">开发进度</h2>
        <span className="text-[11px] text-slate-500">
          已完成 {ROADMAP.filter((item) => item.done).length} / {ROADMAP.length} 步
        </span>
      </div>
      <ol className={`mt-4 gap-2 ${compact ? 'grid sm:grid-cols-2 lg:grid-cols-3' : 'space-y-2'}`}>
        {ROADMAP.map((item) => (
          <li
            key={item.step}
            className={`flex items-start gap-3 rounded-xl border px-3 py-2 text-xs ${
              item.done ? 'border-emerald-400/25 bg-emerald-400/[.06]' : 'border-white/[.08] bg-white/[.02]'
            }`}
          >
            <span className="font-mono font-bold text-slate-400">{item.step}</span>
            <span className="min-w-0">
              <span className={`block font-bold ${item.done ? 'text-emerald-200' : 'text-white'}`}>{item.done ? '✓ ' : ''}{item.title}</span>
              <span className="mt-0.5 block leading-5 text-slate-500">{item.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}