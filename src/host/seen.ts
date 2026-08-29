/**
 * dsh-host-router · 嗅探聚合 + 主动扫描候选。
 *
 * seenStore:按 host 聚合(首次/最近/命中数/状态/owner/source),给设置页清单。
 *   count = 本次进程(run)命中数,>0 绿(本次扫到)、=0 灰(本次没扫到)。
 *   dsh 重启 = 新进程 = count 清零,看几次重启都灰 = 可删。
 * scanCandidates:读 ~/.dsh/settings.yaml provider baseURL host + 已知境外兜底,
 *   每个带 owner(粗归属)+ source(settings/known),给主动扫描不靠猜的候选表。
 */
import { readFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { normalizeHost, isLoopback } from './routing-dispatcher.js'
import { logPath } from './config.js'

export interface SeenHost {
  host: string
  firstSeen?: number
  lastSeen?: number
  count?: number          // 本次 run 命中数(绿/灰判定)
  lastStatus?: number | string
  lastMs?: number
  proxy?: boolean
  error?: string
  owner?: string          // 粗归属(openai/dshmarket/截图/provider 名/未知)
  source?: 'sniff' | 'settings' | 'known'  // 出处
  mode?: 'passive' | 'active'
}

/** owner 映射:已知 host → 归属(粗标)。 */
const OWNER_MAP: Record<string, string> = {
  'api.openai.com': 'openai',
  'awesome-dsh-plugin.com': 'dshmarket 目录',
  'raw.githubusercontent.com': 'dshmarket 截图/README',
  'user-images.githubusercontent.com': 'dshmarket 截图',
  'camo.githubusercontent.com': 'dshmarket 截图',
  'api.anthropic.com': 'anthropic',
  'generativelanguage.googleapis.com': 'gemini',
  'api.deepseek.com': 'deepseek',
  'api.siliconflow.cn': 'siliconflow',
  'open.bigmodel.cn': 'zhipu',
  'dashscope.aliyuncs.com': 'qwen',
}
function ownerOf(host: string): string {
  if (OWNER_MAP[host]) return OWNER_MAP[host]
  for (const k of Object.keys(OWNER_MAP)) if (host.endsWith(`.${k}`)) return OWNER_MAP[k]
  return '未知'
}

/** 嗅探收集器:按 host 聚合 + 落 log.txt。 */
export function makeSeenStore() {
  const byHost = new Map<string, SeenHost>()
  function record(r: any) {
    const e = byHost.get(r.host)
    if (e) {
      e.lastSeen = r.ts; e.count = (e.count ?? 1) + 1; e.lastStatus = r.status; e.lastMs = r.ms; e.proxy = r.proxy
      if (r.error) e.error = r.error
    } else {
      byHost.set(r.host, { host: r.host, firstSeen: r.ts, lastSeen: r.ts, count: 1, lastStatus: r.status, lastMs: r.ms, proxy: r.proxy, error: r.error, owner: ownerOf(r.host), source: 'sniff', mode: 'passive' })
    }
    try { appendFileSync(logPath(), `${r.ts} | ${r.proxy ? 'PROXY ' : 'DIRECT'} | ${r.host}${r.path} | ${r.status} | ${r.ms}ms\n`) } catch { /* ignore */ }
  }
  return {
    record,
    /** upsert 一个 host(主动扫描/白名单补显用),不增 count。 */
    upsert(host: string, patch: Partial<SeenHost>) {
      const e = byHost.get(host)
      if (e) Object.assign(e, patch)
      else byHost.set(host, { host, count: 0, owner: ownerOf(host), ...patch })
    },
    list: (): SeenHost[] => [...byHost.values()].sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0)),
  }
}

// 已知常见境外 host 兜底(settings.yaml 没记、但 dsh 运行时会打的)。
const KNOWN_REMOTE = Object.keys(OWNER_MAP)

/** dsh settings.yaml 路径(优先 DSH_HOME)。 */
function settingsYamlPath(): string {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(dshHome, 'settings.yaml')
}

/** 从 settings.yaml 提所有 provider baseURL 的 host(正则:只取 `baseURL: <url>`)。 */
function providersFromSettings(): string[] {
  const hosts = new Set<string>()
  try {
    const txt = readFileSync(settingsYamlPath(), 'utf8')
    for (const m of txt.matchAll(/^\s*baseURL:\s*['"]?(https?:\/\/[^'"\s#]+)/gm)) {
      const h = normalizeHost(m[1])
      if (h && !isLoopback(h)) hosts.add(h)
    }
  } catch { /* settings.yaml 缺 */ }
  return [...hosts]
}

/** 扫描候选 = settings.yaml provider host + 已知境外兜底,带 owner/source。 */
export function scanCandidates(): SeenHost[] {
  const byHost = new Map<string, SeenHost>()
  for (const h of providersFromSettings()) byHost.set(h, { host: h, count: 0, owner: ownerOf(h), source: 'settings', mode: 'active' })
  for (const h of KNOWN_REMOTE) {
    if (!byHost.has(h)) byHost.set(h, { host: h, count: 0, owner: OWNER_MAP[h] ?? '未知', source: 'known', mode: 'active' })
  }
  return [...byHost.values()].filter((s) => !isLoopback(s.host))
}
