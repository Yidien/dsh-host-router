/**
 * dsh-host-router · client 设置页(纯 React)。
 *
 * 挂 settings.section slot:设置页里独立一页「网络路由」。
 * 通信:同源 fetch → host webServer API(/api/dsh-host-router/{seen,scan,save,test,config})。
 *
 * 渲染:纯 React(createElement + hooks),React 管 mount/unmount,切走回来自动重渲染不丢。
 * (之前 useEffect+ref 塞原生 DOM,切走回来组件未 remount 时 DOM 丢失 → 改纯 React。)
 */
import React from 'react'

type SlotsService = any
type ClientContext = { slots: SlotsService }

export const inject = ['slots']

const API = '/api/dsh-host-router'

const STYLES = `
.hr-page{font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;padding:14px 16px;max-width:820px}
.hr-page h3{margin:0 0 4px;font-size:13px}
.hr-ep{color:var(--theme-text-secondary,#999);margin:0 0 8px;font-size:11px}
.hr-hint{color:var(--theme-text-tertiary,#777);font-size:11px;margin:0 0 12px}
.hr-bar{display:flex;gap:6px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
.hr-btn{background:var(--theme-accent,#4a9eff);color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;white-space:nowrap}
.hr-btn.ghost{background:transparent;border:1px solid var(--theme-border,#444);color:var(--theme-text,#ccc)}
.hr-btn:disabled{opacity:.45;cursor:not-allowed}
.hr-msg{color:var(--theme-text-secondary,#999);font-size:11px;padding:6px 10px;border-radius:6px;background:var(--theme-input-bg,#111);border:1px solid var(--theme-border,#333);white-space:pre-wrap;max-height:140px;overflow:auto;margin:8px 0}
.hr-page{max-width:1000px}
.table-wrap{overflow-x:auto;margin-bottom:12px}
table{border-collapse:collapse;min-width:720px}
th,td{border-bottom:1px solid var(--theme-border,#333);padding:4px 6px;text-align:left;font-size:11px;white-space:nowrap}
th{font-size:10px;color:var(--theme-text-secondary,#999);font-weight:600}
td.c,th.c{text-align:center}
td.h{font-family:ui-monospace,monospace;max-width:220px;overflow:hidden;text-overflow:ellipsis}
.st-ok{color:#2ecc71}.st-fail{color:#e74c3c}.st-warn{color:#f1c40f}.st-gray{color:#888}
.empty{padding:14px;text-align:center;color:var(--theme-text-secondary,#888)}
.h4{margin:14px 0 4px;font-size:12px;color:var(--theme-text-secondary,#aaa)}
`

async function jget(path: string): Promise<any> { return fetch(API + path).then((r) => r.json()).catch(() => null) }
async function jpost(path: string, body?: any): Promise<any> {
  return fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .then((r) => r.json()).catch(() => null)
}

interface SeenHost {
  host: string; lastStatus?: number | string; lastMs?: number; count?: number
  owner?: string; source?: string; proxied?: boolean; hits?: number; stale?: boolean; alive?: boolean
}
interface Cfg { proxyHost?: string; proxyPort?: number; proxiedHosts?: string[] }

function HostRouterPage() {
  const [cfg, setCfg] = React.useState<Cfg>({})
  const [draft, setDraft] = React.useState<Set<string>>(new Set())
  const [seen, setSeen] = React.useState<SeenHost[]>([])
  const [msg, setMsg] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  // 只刷数据(seen/cfg),不重置草稿:轮询与手动刷新不覆盖用户编辑到一半的勾选(2026-08-29)。
  const refreshData = React.useCallback(async () => {
    const [seenR, cfgR] = await Promise.all([jget('/seen'), jget('/config')])
    if (cfgR?.ok?.value) setCfg(cfgR.value)
    setSeen(seenR?.ok ? seenR.hosts : [])
  }, [])
  // 全量刷新:数据 + 草稿同步磁盘白名单(首次加载/清理过期后用)。
  const refreshAll = React.useCallback(async () => {
    const [seenR, cfgR] = await Promise.all([jget('/seen'), jget('/config')])
    if (cfgR?.ok?.value) { setCfg(cfgR.value); setDraft(new Set(cfgR.value.proxiedHosts ?? [])) }
    setSeen(seenR?.ok ? seenR.hosts : [])
  }, [])

  React.useEffect(() => {
    refreshAll()
    const t = window.setInterval(refreshData, 5000)
    return () => window.clearInterval(t)
  }, [refreshAll, refreshData])

  const toggle = (h: string) => setDraft((d) => { const n = new Set(d); n.has(h) ? n.delete(h) : n.add(h); return n })

  const doScan = async () => {
    setMsg('扫描中…'); setBusy(true)
    const r = await jpost('/scan')
    setBusy(false)
    if (!r?.ok) { setMsg('扫描失败'); return }
    setMsg(`扫描完成,${r.hosts.filter((h: any) => h.needsProxy).length} 个直连不通(建议代理)`)
    await refreshData()  // 扫描结果已 upsert 进 seen,刷新拉合并表(不动草稿)
  }

  const doSave = async () => {
    setBusy(true); setMsg('保存中…')
    const r = await jpost('/save', { proxiedHosts: [...draft] })
    setBusy(false)
    setMsg(r?.ok ? '已保存并即时生效' : '保存失败')
    if (r?.ok) refreshData()
  }

  const doTest = async (h: string) => {
    const r = await jpost('/test', { host: h })
    setMsg(`${h}: ${r.status} · ${r.ms}ms · ${r.proxy ? '代理' : '直连'}` + (r.message ? ` · ${r.message}` : ''))
  }

  const th = (txt: string, c = true) => React.createElement('th', { className: c ? 'c' : '', key: txt }, txt)
  const endpoint = `${cfg.proxyHost ?? '127.0.0.1'}:${cfg.proxyPort ?? 7897}`

  const doCleanStale = async () => {
    setBusy(true); setMsg('清理过期…')
    const r = await jpost('/clean-stale')
    setBusy(false)
    setMsg(r?.ok ? `已清理 ${r.removed?.length ?? 0} 个过期 host:${(r.removed ?? []).join(', ') || '无'}` : '清理失败')
    if (r?.ok) refreshAll()  // 磁盘白名单被清理,草稿需同步
  }

  return React.createElement('div', { className: 'hr-page' },
    React.createElement('style', null, STYLES),
    React.createElement('h3', null, '网络路由(dsh-host-router)'),
    React.createElement('p', { className: 'hr-ep' }, '代理: ', React.createElement('code', null, endpoint)),
    React.createElement('p', { className: 'hr-hint' }, '勾选走代理,保存即生效。绿=本次扫到在用,灰=本次没扫到(几次重启都灰可删),过期=白名单里但久未用。'),
    React.createElement('div', { className: 'hr-bar' },
      React.createElement('button', { className: 'hr-btn', onClick: doScan, disabled: busy }, '扫描配置'),
      React.createElement('button', { className: 'hr-btn ghost', onClick: doSave, disabled: busy }, '保存勾选'),
      React.createElement('button', { className: 'hr-btn ghost', onClick: doCleanStale, disabled: busy }, '清理过期'),
      React.createElement('button', { className: 'hr-btn ghost', onClick: refreshData }, '刷新'),
    ),
    msg && React.createElement('div', { className: 'hr-msg' }, msg),
    // 合一表:嗅探 + 白名单(没扫到也显示)
    React.createElement('table', null,
      React.createElement('thead', null, React.createElement('tr', null,
        th('hostname', false), th('走代理'), th('归属'), th('出处'), th('本次命中'), th('状态'), th('耗时'), th('标记'), th('测试'))),
      React.createElement('tbody', null,
        seen.length === 0
          ? React.createElement('tr', null, React.createElement('td', { className: 'empty', colSpan: 9 }, '暂无数据,先用 dsh 一会儿或点「扫描配置」'))
          : seen.map((h: any) => {
              const alive = h.alive !== false && (h.count ?? 0) > 0
              return React.createElement('tr', { key: h.host },
                React.createElement('td', { className: 'h' }, h.host),
                React.createElement('td', { className: 'c' }, React.createElement('input', { type: 'checkbox', checked: draft.has(h.host), onChange: () => toggle(h.host) })),
                React.createElement('td', { className: 'c' }, h.owner ?? '未知'),
                React.createElement('td', { className: 'c' }, h.source ?? '-'),
                React.createElement('td', { className: 'c' }, React.createElement('span', { className: alive ? 'st-ok' : 'st-gray' }, alive ? `●${h.count}` : '○')),
                React.createElement('td', { className: 'c' }, React.createElement('span', { className: h.lastStatus === 'ERR' ? 'st-fail' : 'st-ok' }, String(h.lastStatus ?? ''))),
                React.createElement('td', { className: 'c' }, (h.lastMs ?? '') + (h.lastMs != null ? 'ms' : '')),
                React.createElement('td', { className: 'c' }, h.stale ? React.createElement('span', { className: 'st-warn' }, '过期') : ''),
                React.createElement('td', { className: 'c' }, React.createElement('button', { className: 'hr-btn ghost', onClick: () => doTest(h.host), style: { padding: '2px 8px' } }, '测')),
              )
            })
      ),
    ),
  )
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'dsh-host-router', order: 60, label: '网络路由' },
      (props: any) => React.createElement(HostRouterPage, props),
    ),
  ), 'dsh-host-router: settings page')
}
