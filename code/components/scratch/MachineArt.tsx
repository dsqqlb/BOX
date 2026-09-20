'use client';

/**
 * 兑奖机 / 碎纸机的图标：程序化 SVG。
 *
 * 为什么不用外部素材：这台机器上没法下载/校验图片授权，而程序化 SVG 零版权风险、任意缩放不糊，
 * 和票面走的是同一条路线。将来想换成真实图片很简单：
 *   1. 把 PNG 放进 resources/public/image/scratch/（这个目录已经映射到 scratch-cards 权限）；
 *   2. 把下面的 <svg> 换成 <img src="/image/scratch/redeem-machine.png" className={className} alt="" />。
 */

interface MachineArtProps {
  className?: string;
}

/** 兑奖机：带屏幕、投币口与出票口的机器。 */
export function RedeemMachineArt({ className = '' }: MachineArtProps) {
  return (
    <svg className={className} viewBox="0 0 120 150" role="img" aria-label="兑奖机">
      <defs>
        <linearGradient id="scr-redeem-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2b323c" />
          <stop offset="100%" stopColor="#161b22" />
        </linearGradient>
        <linearGradient id="scr-redeem-screen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f7cd67" />
          <stop offset="100%" stopColor="#dda42a" />
        </linearGradient>
      </defs>

      <rect x="8" y="6" width="104" height="134" rx="12" fill="url(#scr-redeem-body)" stroke="#f5c451" strokeWidth="3" />
      <rect x="18" y="16" width="84" height="46" rx="6" fill="#0b0f14" stroke="#f5c451" strokeWidth="2" />
      <rect x="24" y="22" width="72" height="34" rx="4" fill="url(#scr-redeem-screen)" />
      <text x="60" y="45" textAnchor="middle" fontSize="22" fontWeight="900" fill="#3a2a06">¥</text>

      {/* 投币口 */}
      <rect x="34" y="74" width="52" height="9" rx="4" fill="#0b0f14" stroke="#8a7a58" strokeWidth="2" />
      {/* 按键 */}
      <circle cx="38" cy="98" r="6" fill="#7ee0b0" />
      <circle cx="60" cy="98" r="6" fill="#f5c451" />
      <circle cx="82" cy="98" r="6" fill="#8fb8ff" />
      {/* 出票口 */}
      <rect x="26" y="112" width="68" height="14" rx="4" fill="#0b0f14" stroke="#f5c451" strokeWidth="2" />
      <rect x="34" y="114" width="52" height="10" rx="3" fill="#fdf6e0" />
      <rect x="14" y="140" width="16" height="8" rx="3" fill="#101418" />
      <rect x="90" y="140" width="16" height="8" rx="3" fill="#101418" />
    </svg>
  );
}

/** 碎纸机：上方投入口 + 中间滚轮 + 下方纸屑与纸篓。 */
export function ShredderMachineArt({ className = '' }: MachineArtProps) {
  return (
    <svg className={className} viewBox="0 0 120 150" role="img" aria-label="碎纸机">
      <defs>
        <linearGradient id="scr-shred-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2b3644" />
          <stop offset="100%" stopColor="#151b23" />
        </linearGradient>
      </defs>

      {/* 投入斗 */}
      <path d="M14 10 H106 L96 40 H24 Z" fill="url(#scr-shred-body)" stroke="#96c8ff" strokeWidth="3" strokeLinejoin="round" />
      <rect x="34" y="16" width="52" height="8" rx="4" fill="#0b0f14" />
      <rect x="42" y="20" width="36" height="16" rx="2" fill="#fdf6e0" />

      {/* 机身与滚轮 */}
      <rect x="20" y="40" width="80" height="52" rx="8" fill="url(#scr-shred-body)" stroke="#96c8ff" strokeWidth="3" />
      <circle cx="44" cy="66" r="12" fill="#0b0f14" stroke="#96c8ff" strokeWidth="2" />
      <circle cx="76" cy="66" r="12" fill="#0b0f14" stroke="#96c8ff" strokeWidth="2" />
      {[0, 60, 120, 180, 240, 300].map((angle) => (
        <g key={`spike-${angle}`} transform={`rotate(${angle} 44 66)`}>
          <rect x="42.5" y="54" width="3" height="8" rx="1.5" fill="#96c8ff" />
        </g>
      ))}

      {/* 纸屑 */}
      {[30, 46, 62, 78, 94].map((x, index) => (
        <rect
          key={`strip-${x}`}
          x={x}
          y={96 + (index % 2) * 6}
          width="5"
          height={18 - (index % 2) * 4}
          rx="1.5"
          fill={index % 2 === 0 ? '#fdfaf1' : '#d9d2c0'}
        />
      ))}

      {/* 纸篓 */}
      <path d="M18 118 H102 L96 144 H24 Z" fill="url(#scr-shred-body)" stroke="#96c8ff" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
}

/** 自动刮奖机：把票塞进投票口，机器自己刮，顶上的进度屏走完就把票吐回桌面。 */
export function AutoScratchMachineArt({ className = '' }: MachineArtProps) {
  return (
    <svg className={className} viewBox="0 0 120 150" role="img" aria-label="自动刮奖机">
      <defs>
        <linearGradient id="scr-auto-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#223a34" />
          <stop offset="100%" stopColor="#132019" />
        </linearGradient>
      </defs>

      {/* 机身 */}
      <rect x="10" y="8" width="100" height="128" rx="12" fill="url(#scr-auto-body)" stroke="#7ee0b0" strokeWidth="3" />

      {/* 顶部进度屏：HTML 进度条会叠在这块屏上 */}
      <rect x="20" y="18" width="80" height="34" rx="6" fill="#07100c" stroke="#7ee0b0" strokeWidth="2" />
      <rect x="26" y="26" width="68" height="8" rx="4" fill="rgba(126, 224, 176, 0.18)" />
      <rect x="26" y="40" width="34" height="5" rx="2.5" fill="rgba(126, 224, 176, 0.5)" />

      {/* 投票口 */}
      <rect x="24" y="62" width="72" height="12" rx="5" fill="#07100c" stroke="#7ee0b0" strokeWidth="2" />
      <rect x="34" y="65" width="52" height="6" rx="3" fill="#fdf6e0" opacity="0.7" />

      {/* 刮头：三道斜刮刀 */}
      <rect x="26" y="86" width="68" height="9" rx="4.5" fill="#0b0f14" stroke="#7ee0b0" strokeWidth="2" />
      <path d="M34 90.5 L46 90.5" stroke="#7ee0b0" strokeWidth="3" strokeLinecap="round" />
      <path d="M54 90.5 L66 90.5" stroke="#7ee0b0" strokeWidth="3" strokeLinecap="round" />
      <path d="M74 90.5 L86 90.5" stroke="#7ee0b0" strokeWidth="3" strokeLinecap="round" />

      {/* 出票口 + 指示灯 */}
      <rect x="24" y="106" width="72" height="16" rx="4" fill="#07100c" stroke="#7ee0b0" strokeWidth="2" />
      <rect x="32" y="109" width="56" height="10" rx="3" fill="#fdf6e0" />
      <circle cx="30" cy="132" r="4" fill="#7ee0b0" />
      <circle cx="46" cy="132" r="4" fill="#f5c451" />
    </svg>
  );
}