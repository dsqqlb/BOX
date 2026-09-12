/**
 * EDH 记血器 —— 常量。
 *
 * 硬币贴图放在这里（而不是 lib/edh-life/types.ts），因为文件名要与
 * 引擎内置硬币骰 DICE.dc 的定义保持一致；生成脚本 scripts/generate-coin-textures.mjs
 * 也引用同一组文件名，两边不会漂移。
 */

/** 引擎内置硬币骰引用的文件名（public/dice-assets/textures/silvercoin/ 下）。 */
export const COIN_TEXTURE_KEYS = {
  /** 太阳面（引擎里的 heads） */
  sunFile: 'heads.png',
  /** 数字 1 面（引擎里的 tail） */
  oneFile: 'tail.png',
  /** 传给引擎的纹理名：DICE.dc.labels[1] 是 heads，对应硬币值 1（太阳） */
  sun: 'textures/silvercoin/heads.png',
  one: 'textures/silvercoin/tail.png',
} as const;
