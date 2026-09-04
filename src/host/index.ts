/**
 * dsh-host-router · host 入口。
 *
 * 外挂式 host 路由:按 hostname 给 dsh 请求分流(勾选走代理,其余直连)+ 嗅探
 * + 设置页 API(/api/dsh-host-router/{seen,scan,save,test,config})。
 *
 * 全程在 globalThis.fetch 层替换(白名单走 undici+ProxyAgent,其余原样直连),
 * 位于 LLM 适配器之下,不碰 settings.yaml
 * provider 配置。纯外挂:dependencies 空,运行时零 require,宿主 ctx 注入。
 * 配置存 ~/.dsh/host-router/config.json;/save 写完 live reload 即生效(免重启)。
 */
import { normalizeHost, isLoopback, matchesProxied } from './routing-dispatcher.js'
import { makeSeenStore, scanCandidates } from './seen.js'
import { readConfig, writeConfig, logPath, type HostRouterConfig } from './config.js'
import { appendFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

let undiciMod: any = null
let installed = false

/** 解析 undici 绝对路径:插件目录可能无 node_modules,从 profile node_modules 找。
 *  优先 DSH_HOME/profiles/web/node_modules,退 homedir/.dsh/...
 *  返回 file:// URL(Windows 绝对路径不能直接 import,需转 URL)。 */
function resolveUndiciPath(): string | null {
  const candidates = [
    process.env.DSH_HOME && join(process.env.DSH_HOME, 'profiles', 'web', 'node_modules'),
    join(homedir(), '.dsh', 'profiles', 'web', 'node_modules'),
  ].filter(Boolean) as string[]
  for (const base of candidates) {
    try {
      const req = createRequire(join(base, 'package.json'))
      const p = req.resolve('undici')
      return pathToFileURL(p).href
    } catch { /* try next */ }
  }
  return null
}

let originalFetch: any = null
let patched = false
const seen = makeSeenStore()

/** 造 myFetch:替换 globalThis.fetch。白名单 host → 包 undici fetch + ProxyAgent;其余 → 原内置 fetch。
 *  嗅探也在 myFetch 里记每个请求(按 host 聚合 + log.txt)。 */
function buildMyFetch(undici: any, config: HostRouterConfig): (input: any, init?: any) => Promise<any> {
  const proxied = new Set((config.proxiedHosts ?? []).map(String))
  const proxyUrl = `http://${config.proxyHost}:${config.proxyPort}`
  // ProxyAgent:Clash 关 idle 隧道复用死连接 → 超时;clientFactory 每请求新连接避坑。
  let proxyAgent: any = null
  try {
    proxyAgent = new undici.ProxyAgent({
      uri: proxyUrl,
      clientFactory: (origin: string, o: any) => new undici.Pool(origin, { ...o, pipelining: 0 }),
    })
  } catch (e: any) { /* proxy 不可用 → 白名单也走直连 */ }
  const sniff = config.sniff !== false
  const doSniff = (host: string, path: string, status: any, ms: number, proxy: boolean, error?: string) => {
    if (!sniff) return
    seen.record({ host, path, status, ms, proxy, ts: Date.now(), error })
  }

  return async function myFetch(input: any, init?: any) {
    let host = ''
    let path = ''
    try {
      const u = new URL(typeof input === 'string' ? input : (input?.url ?? input))
      host = u.hostname
      path = u.pathname
    } catch { host = String(input ?? '') }
    const useProxy = proxyAgent && matchesProxied(host, proxied)
    const t = Date.now()
    try {
      let res: any
      if (useProxy) {
        // 白名单 → 包 undici fetch + ProxyAgent(走代理)
        res = await undici.fetch(input, { ...init, dispatcher: proxyAgent })
      } else {
        // 其余 → 原内置 fetch(行为不变)
        res = await originalFetch.call(globalThis, input, init)
      }
      doSniff(host, path, res.status, Date.now() - t, useProxy)
      return res
    } catch (e: any) {
      doSniff(host, path, 'ERR', Date.now() - t, useProxy, String(e.message).slice(0, 140))
      throw e
    }
  }
}

/** monkeypatch globalThis.fetch(保留原引用,可还原)。 */
function patchFetch(undici: any, config: HostRouterConfig) {
  if (!patched) originalFetch = globalThis.fetch
  ;(globalThis as any).fetch = buildMyFetch(undici, config)
  patched = true
  installed = true
  try { appendFileSync(logPath(), `# fetch patched at ${new Date().toISOString()} proxied=[${config.proxiedHosts.join(',') || '(none)'}]\n`) } catch {}
}
/** 还原 globalThis.fetch。 */
function unpatchFetch() {
  if (!patched) return
  try { if (originalFetch) (globalThis as any).fetch = originalFetch } catch {}
  patched = false
}
/** live 重载:用新 config 重建 myFetch(保存即生效,免重启)。
 *  fetch 全局引用换一下即可,毫秒级,无重连开销。 */
function reloadFetch(undici: any, config: HostRouterConfig) {
  if (!undici || !patched) { patchFetch(undici, config); return }
  ;(globalThis as any).fetch = buildMyFetch(undici, config)
  try { appendFileSync(logPath(), `# fetch reloaded at ${new Date().toISOString()} proxied=[${config.proxiedHosts.join(',') || '(none)'}]\n`) } catch {}
}

/** 同源 loopback guard(照 dsh-llm-proxy bridge)。 */
function isTrusted(req: any): boolean {
  const addr = req.socket?.remoteAddress
  if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') return false
  return true
}
function json(res: any, status: number, body: any) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}
async function readBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    const ch: Buffer[] = []
    req.on('data', (c: Buffer) => ch.push(c))
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(ch).toString('utf8'))) } catch { resolve(null) } })
    req.on('error', () => resolve(null))
  })
}

/** 对某 host 探测(走当前全局 fetch,真实路径)。 */
async function testHost(host: string): Promise<any> {
  const h = normalizeHost(host)
  if (!h || isLoopback(h)) return { host: h, status: 'ERR', ms: 0, proxy: false, message: 'loopback/empty' }
  const cfg = readConfig()
  const useProxy = matchesProxied(h, new Set((cfg.proxiedHosts ?? []).map(String)))
  const t = Date.now()
  try {
    const r = await fetch(`https://${h}/`, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
    return { host: h, status: r.status, ms: Date.now() - t, proxy: useProxy }
  } catch (e: any) {
    return { host: h, status: 'ERR', ms: Date.now() - t, proxy: useProxy, message: String(e.message).slice(0, 100) }
  }
}

export const inject = ['webServer']

export function apply(ctx: any): void {
  let diag = 'apply-start'
  try { appendFileSync(logPath(), `# apply at ${new Date().toISOString()}\n`); diag = 'logged' } catch {}
  const start = (u: any) => {
    undiciMod = u
    if (!u || typeof u.fetch !== 'function' || typeof u.ProxyAgent !== 'function') {
      diag = 'no-undici-fetch'
      try { appendFileSync(logPath(), `# start: undici fetch/ProxyAgent unavailable\n`) } catch {}
      ctx.logger?.error?.('dsh-host-router: undici fetch/ProxyAgent unavailable — disabled'); return
    }
    try {
      const cfg = readConfig()
      patchFetch(u, cfg)
      diag = 'patched'
      ctx.logger?.info?.(`dsh-host-router: globalThis.fetch patched (proxy=${cfg.proxyHost}:${cfg.proxyPort}, proxied=[${cfg.proxiedHosts.join(',') || '(none)'}])`)
    } catch (e: any) {
      diag = 'patch-failed:' + String(e?.message ?? e)
      try { appendFileSync(logPath(), `# patch FAILED: ${diag}\n`) } catch {}
      ctx.logger?.error?.('dsh-host-router: patch failed: ' + String(e?.message ?? e))
    }
  }

  // undici:插件目录无 node_modules,从 profile node_modules 解析绝对路径再 import。
  const undiciMain = resolveUndiciPath()
  try { appendFileSync(logPath(), `# undiciMain=${undiciMain ?? '(null)'}\n`) } catch {}
  if (!undiciMain) { diag = 'undici-not-found'; ctx.logger?.error?.('dsh-host-router: undici not found in profile node_modules — disabled'); return }
  import(undiciMain).then(async (u: any) => {
    try { appendFileSync(logPath(), `# undici imported OK\n`) } catch {}
    start(u)
  }).catch((e) => {
    diag = 'import-failed:' + String(e?.message ?? e)
    try { appendFileSync(logPath(), `# import FAILED: ${diag}\n`) } catch {}
    ctx.logger?.error?.('dsh-host-router: undici load failed: ' + String(e))
  })

  // 设置页 API:webServer.register 前缀路由(照 dsh-super-injector /api 同款)。
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/api/dsh-host-router',
    handler: async (req: any, res: any) => {
      if (!isTrusted(req)) { json(res, 403, { error: 'forbidden' }); return }
      const url = req.url ?? ''
      try {
        if (url.endsWith('/seen') && req.method === 'GET') {
          let fetchPatched = false
          try { fetchPatched = patched && (globalThis as any).fetch !== originalFetch } catch {}
          const cfg = readConfig()
          const proxied = new Set(cfg.proxiedHosts ?? [])
          // 合并:嗅探到的 host + 白名单 host(没嗅探到也显示,灰)
          const map = new Map<string, any>()
          for (const h of seen.list()) map.set(h.host, { ...h })
          for (const h of proxied) {
            if (!map.has(h)) map.set(h, { host: h, count: 0, owner: '未知', source: 'config' })
          }
          const hosts = [...map.values()].map((h: any) => {
            const hits = h.count ?? 0
            return { ...h, proxied: proxied.has(h.host), hits, alive: hits > 0 }
          })
          json(res, 200, { ok: true, hosts, installed, diag, fetchPatched }); return
        }
        if (url.endsWith('/scan') && req.method === 'POST') {
          // 候选带 owner/source,批量直连探测(2.5s),结果 upsert 进 store
          const candidates = scanCandidates()
          const probe = async (c: any) => {
            const t = Date.now()
            try {
              const r = await fetch(`https://${c.host}/`, { method: 'HEAD', signal: AbortSignal.timeout(2500) })
              return { ...c, direct: r.status, ms: Date.now() - t, needsProxy: false }
            } catch (e: any) {
              return { ...c, direct: 'fail', ms: Date.now() - t, needsProxy: true, reason: String(e.message).slice(0, 80) }
            }
          }
          const results: any[] = []
          let idx = 0
          async function worker() { while (idx < candidates.length) { const c = candidates[idx++]; results.push(await probe(c)) } }
          await Promise.all(Array.from({ length: 8 }, worker))
          // upsert 进 store(带探测结果,不增 hits)
          for (const r of results) seen.upsert(r.host, { owner: r.owner, source: r.source, lastStatus: r.direct, lastMs: r.ms })
          results.sort((a, b) => Number(b.needsProxy) - Number(a.needsProxy) || a.host.localeCompare(b.host))
          json(res, 200, { ok: true, hosts: results }); return
        }
        if (url.endsWith('/save') && req.method === 'POST') {
          const body = await readBody(req)
          const cfg = readConfig()
          if (body && Array.isArray(body.proxiedHosts)) cfg.proxiedHosts = body.proxiedHosts
          if (body && typeof body.sniff === 'boolean') cfg.sniff = body.sniff
          if (body && typeof body.proxyHost === 'string') cfg.proxyHost = body.proxyHost
          if (body && typeof body.proxyPort === 'number') cfg.proxyPort = body.proxyPort
          writeConfig(cfg)
          // live 重载:用新 config 重建 myFetch,保存即生效(免重启)
          try { reloadFetch(undiciMod, cfg) } catch (e: any) { try { appendFileSync(logPath(), `# reload FAILED: ${String(e?.message ?? e)}\n`) } catch {} }
          json(res, 200, { ok: true, note: '已保存并即时生效' }); return
        }
        if (url.endsWith('/test') && req.method === 'POST') {
          const body = await readBody(req)
          const r = await testHost(body?.host ?? '')
          json(res, 200, r); return
        }
        if (url.endsWith('/config') && req.method === 'GET') {
          json(res, 200, { ok: true, value: readConfig() }); return
        }
        json(res, 404, { error: 'not found' })
      } catch (e: any) {
        json(res, 500, { error: String(e?.message ?? e) })
      }
    },
  }), 'dsh-host-router: api')

  // cordis 4.0.2 不 emit 'dispose' 事件，清理必须走 effect disposer 才会在卸载时执行
  ctx.effect(() => unpatchFetch, 'dsh-host-router: fetch cleanup')
}
