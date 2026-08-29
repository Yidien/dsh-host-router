/**
 * dsh-host-router · hostname 归一化工具(直连/代理判断共用)。
 *
 * 早期设计里的 duck-typed HostRouter dispatcher(undici setGlobalDispatcher)
 * 已由 globalThis.fetch 替换方案取代(见 index.ts),这里只保留被
 * index.ts / seen.ts 实际使用的两个纯函数。
 */

/** 归一化 hostname(去端口/括号/scheme)。 */
export function normalizeHost(host: string): string {
  if (!host) return ''
  let h = String(host).trim().toLowerCase()
  if (h.includes('://')) {
    try { h = new URL(h).hostname } catch { /* fall through */ }
  }
  h = h.replace(/:\d+$/, '').replace(/^\[(.+)\]$/, '$1')
  return h
}

/** loopback 永远直连。 */
export function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

/** host 是否命中代理白名单(含子域后缀 `xxx.example.com` 命中 `example.com`);loopback 永远否。
 *  快路径用 Set,白名单很小,成员遍历开销可忽略。 */
export function matchesProxied(host: string, proxied: ReadonlySet<string>): boolean {
  if (!host || isLoopback(host)) return false
  if (proxied.has(host)) return true
  for (const entry of proxied) if (host.endsWith(`.${entry}`)) return true
  return false
}