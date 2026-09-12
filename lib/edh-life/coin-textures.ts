/**
 * EDH 记血器的硬币贴图。
 *
 * 骰子引擎自带一颗硬币骰（DICE.dc，type 是 d2），它引用
 * textures/silvercoin/heads.png、tail.png 与各自的 bump 图。
 * 上游那几张素材没有随 vendored 拷贝进入本项目，所以由
 * scripts/generate-coin-textures.mjs 用纯 Node 生成到
 * public/dice-assets/textures/silvercoin/（路径与引擎默认查找的一致）。
 *
 * 于是这里不需要在运行时注册任何纹理，只要把形状映射交给 DiceRoller 即可：
 * 硬币的 shape 是 'd2'（见 DICE.dc.type），所以键用 'd2'。
 *
 * 注意：引擎加载贴图时会无条件在 source 前面拼上 assetPath（/dice-assets/），
 * 所以运行时塞 data URL 是行不通的——这就是必须落成真实文件的原因。
 */

import { COIN_TEXTURE_KEYS } from './constants';

export { COIN_TEXTURE_KEYS };

/** 交给 DiceRoller 的 shapeTextures（硬币 -> d2 形状）。 */
export function coinShapeTextures(): Record<string, string> {
  return { d2: COIN_TEXTURE_KEYS.sun };
}

/**
 * 预热：把两张硬币贴图提前加载进浏览器缓存，
 * 这样第一次点「投硬币」时 3D 场景能立刻拿到图，不会先空白一下。
 */
export async function prewarmCoinTextures(): Promise<void> {
  if (typeof window === 'undefined') return;
  const sources = [
    `/dice-assets/textures/silvercoin/${COIN_TEXTURE_KEYS.sunFile}`,
    `/dice-assets/textures/silvercoin/${COIN_TEXTURE_KEYS.oneFile}`,
  ];
  await Promise.all(sources.map((src) => new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();   // 加载失败不该阻塞页面
    image.src = src;
  })));
}
