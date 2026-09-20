/**
 * 「手机扫得到、别人打得开」的公开地址。
 *
 * 主屏类页面（先攻追踪器 /display、目标大屏等）经常开在本机或局域网地址上：
 *   http://localhost:9999/...、http://192.168.1.50:9999/...
 * 二维码里直接写当前地址，手机扫完是打不开的；但把公网域名写死在页面里，
 * 又会在 http/https 切换、换域名、离线内网跑团时出错。
 *
 * 所以规则是：
 *   当前页面已经开在公网域名上 -> 直接用当前地址（协议、域名、端口都跟着页面走）；
 *   当前页面开在回环/局域网地址上 -> 回落到 PUBLIC_ORIGIN（服务器上的正式域名）。
 */

// 兜底公网地址：与服务器 resources/.env.local 里的 BOX_PRIMARY_HOST 保持一致。
// 换域名或将来上 HTTPS 时，只改这一处即可。
export const PUBLIC_ORIGIN = 'http://www.dsqqlb.top';

/** 回环、私网、mDNS 这类「离开这台机器或这个内网就打不开」的主机名。 */
export function isLocallyScopedHost(hostname: string): boolean {
  const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (host === '::1' || host === 'localhost' || host.endsWith('.localhost')) return true;
  // .local 走 mDNS，只有同一内网能解析
  if (host.endsWith('.local')) return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const first = Number(ipv4[1]);
    const second = Number(ipv4[2]);
    if (first === 0 || first === 10 || first === 127) return true; // 本机 / 10.0.0.0/8 / 回环
    if (first === 192 && second === 168) return true; // 192.168.0.0/16
    if (first === 172 && second >= 16 && second <= 31) return true; // 172.16.0.0/12
    if (first === 169 && second === 254) return true; // 链路本地
    return false;
  }

  // 不带点的单段主机名（如 dnd-table）同样出不了内网
  if (!host.includes('.')) return true;
  return false;
}

/**
 * 分享/扫码用的公开地址（不含结尾斜杠）。
 * 服务端预渲染阶段没有 window，返回兜底域名；调用点应保证只在客户端渲染完成后使用结果。
 */
export function publicOrigin(): string {
  if (typeof window === 'undefined') return PUBLIC_ORIGIN;
  const { origin, hostname } = window.location;
  return isLocallyScopedHost(hostname) ? PUBLIC_ORIGIN : origin;
}