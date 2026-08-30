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
.hr-page{font-family:ui-monospace,monospace;font-size:13px;line-height:1.55;padding:10px 14px;max-width:900px}
.hr-page h3{margin:0 0 4px;font-size:14px}
.hr-ep{color:var(--theme-text-secondary,#999);margin:0 0 6px;font-size:12px}
.hr-lbl{color:var(--theme-text-secondary,#999);font-size:12px}
.hr-inp{background:var(--theme-input-bg,#111);border:1px solid var(--theme-border,#444);border-radius:6px;color:var(--theme-text,#ccc);padding:3px 8px;font-size:12px;font-family:ui-monospace,monospace;width:170px;outline:none}
.hr-inp:focus{border-color:var(--theme-accent,#4a9eff)}
.hr-inp-port{width:70px}
.hr-hint2{color:var(--theme-text-tertiary,#777);font-size:11px}
.hr-hint{color:var(--theme-text-tertiary,#777);font-size:12px;margin:0 0 10px}
.hr-bar{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
.hr-btn{background:var(--theme-accent,#4a9eff);color:#fff;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;white-space:nowrap}
.hr-btn.ghost{background:transparent;border:1px solid var(--theme-border,#444);color:var(--theme-text,#ccc)}
.hr-btn:disabled{opacity:.45;cursor:not-allowed}
.hr-msg{color:var(--theme-text-secondary,#999);font-size:12px;padding:5px 8px;border-radius:6px;background:var(--theme-input-bg,#111);border:1px solid var(--theme-border,#333);white-space:pre-wrap;max-height:90px;overflow:auto;margin:6px 0}
.table-wrap{overflow:auto;max-height:55vh;margin-bottom:10px}
table{border-collapse:separate;border-spacing:0;width:auto;table-layout:fixed}
th,td{border-bottom:1px solid var(--theme-border,#333);padding:3px 6px;text-align:left;font-size:12px;white-space:nowrap}
td{overflow:hidden;text-overflow:ellipsis}
th{font-size:11px;color:var(--theme-text-secondary,#999);font-weight:600}
thead th{position:sticky;top:0;background:var(--theme-bg,#1b1b1c);z-index:1}
td.c,th.c{text-align:center}
tr.dim-row{opacity:.55}
.st-ok{color:#2ecc71}.st-fail{color:#e74c3c}.st-gray{color:#888}
.empty{padding:12px;text-align:center;color:var(--theme-text-secondary,#888)}
.hr-tip{position:fixed;z-index:1000;pointer-events:none;background:var(--theme-input-bg,#111);border:1px solid var(--theme-border,#444);color:var(--theme-text,#ccc);padding:4px 8px;border-radius:5px;font-size:12px;max-width:440px;white-space:normal;word-break:break-all;box-shadow:0 2px 8px rgba(0,0,0,.35)}
.h4{margin:14px 0 4px;font-size:12px;color:var(--theme-text-secondary,#aaa)}
`

async function jget(path: string): Promise<any> { return fetch(API + path).then((r) => r.json()).catch(() => null) }
async function jpost(path: string, body?: any): Promise<any> {
  return fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    .then((r) => r.json()).catch(() => null)
}

interface SeenHost {
  host: string; lastStatus?: number | string; lastMs?: number; count?: number
  owner?: string; source?: string; proxied?: boolean; hits?: number; alive?: boolean
}

function HostRouterPage() {
  const [draft, setDraft] = React.useState<Set<string>>(new Set())
  const [seen, setSeen] = React.useState<SeenHost[]>([])
  const [msg, setMsg] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [tip, setTip] = React.useState<{ x: number; y: number; text: string } | null>(null)
  const [proxyHost, setProxyHost] = React.useState('127.0.0.1')
  const [proxyPort, setProxyPort] = React.useState('7897')

  // 超长内容浮窗(fixed 定位,不被表格 overflow 裁剪;右缘 clamp 防出屏)。
  const showTip = (ev: any, text: string) => setTip({ x: Math.min(ev.clientX + 12, window.innerWidth - 452), y: ev.clientY + 16, text })
  const hideTip = () => setTip(null)

  // 只刷数据(seen/cfg),不重置草稿:轮询与手动刷新不覆盖用户编辑到一半的勾选(2026-08-29)。
  const refreshData = React.useCallback(async () => {
    const [seenR] = await Promise.all([jget('/seen')])
    setSeen(seenR?.ok ? seenR.hosts : [])
  }, [])
  // 全量刷新:数据 + 草稿 + 代理地址同步磁盘配置(首次加载用;轮询不动输入框避免打断输入)。
  const refreshAll = React.useCallback(async () => {
    const [seenR, cfgR] = await Promise.all([jget('/seen'), jget('/config')])
    if (cfgR?.ok) {
      setDraft(new Set(cfgR.value.proxiedHosts ?? []))
      setProxyHost(cfgR.value.proxyHost ?? '127.0.0.1')
      setProxyPort(String(cfgR.value.proxyPort ?? 7897))
    }
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
    const port = Number(proxyPort)
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      setBusy(false); setMsg('端口无效(1-65535)'); return
    }
    const r = await jpost('/save', { proxiedHosts: [...draft], proxyHost: proxyHost.trim(), proxyPort: port })
    setBusy(false)
    setMsg(r?.ok ? '已保存并即时生效' : '保存失败')
    if (r?.ok) refreshData()
  }

  const doTest = async (h: string) => {
    const r = await jpost('/test', { host: h })
    setMsg(`${h}: ${r.status} · ${r.ms}ms · ${r.proxy ? '代理' : '直连'}` + (r.message ? ` · ${r.message}` : ''))
  }

  const th = (txt: string, c = true) => React.createElement('th', { className: c ? 'c' : '', key: txt }, txt)

  return React.createElement('div', { className: 'hr-page' },
    React.createElement('style', null, STYLES),
    React.createElement('h3', null, '网络路由(dsh-host-router)'),
    React.createElement('div', { className: 'hr-bar' },
      React.createElement('span', { className: 'hr-lbl' }, '代理地址'),
      React.createElement('input', { className: 'hr-inp', value: proxyHost, onChange: (e: any) => setProxyHost(e.target.value), placeholder: '127.0.0.1' }),
      React.createElement('span', { className: 'hr-lbl' }, '端口'),
      React.createElement('input', { className: 'hr-inp hr-inp-port', value: proxyPort, onChange: (e: any) => setProxyPort(e.target.value.replace(/\D/g, '').slice(0, 5)), placeholder: '7897' }),
      React.createElement('span', { className: 'hr-hint2' }, '保存勾选时一并保存'),
    ),
    React.createElement('p', { className: 'hr-hint' }, '勾选走代理,保存即生效。绿=本次进程实际用到过,灰=本次还没用到;取消勾选再保存即可移除。'),
    React.createElement('div', { className: 'hr-bar' },
      React.createElement('button', { className: 'hr-btn', onClick: doScan, disabled: busy }, '扫描配置'),
      React.createElement('button', { className: 'hr-btn ghost', onClick: doSave, disabled: busy }, '保存勾选'),
      React.createElement('button', { className: 'hr-btn ghost', onClick: refreshData }, '刷新'),
    ),
    msg && React.createElement('div', { className: 'hr-msg' }, msg),
    // 合一表:嗅探 + 白名单(没扫到也显示);精简 5 列,tip 浮窗展示超长内容
    React.createElement('table', null,
      React.createElement('colgroup', null,
        React.createElement('col', { style: { width: '200px' } }),
        React.createElement('col', { style: { width: '44px' } }),
        React.createElement('col', { style: { width: '64px' } }),
        React.createElement('col', { style: { width: '68px' } }),
        React.createElement('col', { style: { width: '56px' } }),
        React.createElement('col', { style: { width: '76px' } }),
        React.createElement('col', { style: { width: '44px' } }),
      ),
      React.createElement('thead', null, React.createElement('tr', null,
        th('hostname', false), th('代理'), th('归属'), th('本次命中'), th('状态'), th('耗时'), th('测'))),
      React.createElement('tbody', null,
        seen.length === 0
          ? React.createElement('tr', null, React.createElement('td', { className: 'empty', colSpan: 5 }, '暂无数据,先用 dsh 一会儿或点「扫描配置」'))
          : seen.map((h: any) => {
              const alive = h.alive !== false && (h.count ?? 0) > 0
              return React.createElement('tr', { key: h.host, className: alive ? undefined : 'dim-row' },
                React.createElement('td', { onMouseEnter: (e: any) => showTip(e, h.host), onMouseLeave: hideTip }, h.host),
                React.createElement('td', { className: 'c' }, React.createElement('input', { type: 'checkbox', checked: draft.has(h.host), onChange: () => toggle(h.host) })),
                React.createElement('td', { className: 'c', onMouseEnter: (e: any) => showTip(e, `${h.owner ?? '未知'} · ${h.source ?? '-'}`), onMouseLeave: hideTip }, h.owner ?? '未知'),
                React.createElement('td', { className: 'c' }, React.createElement('span', { className: alive ? 'st-ok' : 'st-gray' }, alive ? `●${h.count}` : '○')),
                React.createElement('td', { className: 'c' }, React.createElement('span', { className: h.lastStatus === 'ERR' ? 'st-fail' : 'st-ok' }, String(h.lastStatus ?? '—'))),
                React.createElement('td', { className: 'c' }, h.lastMs != null ? `${h.lastMs}ms` : ''),
                React.createElement('td', { className: 'c' }, React.createElement('button', { className: 'hr-btn ghost', onClick: () => doTest(h.host), style: { padding: '0 6px' } }, '测')),
              )
            })
      ),
    ),
    tip && React.createElement('div', { className: 'hr-tip', style: { left: tip.x, top: tip.y } }, tip.text),
  )
}

export function apply(ctx: ClientContext): void {
  // slots.inject 必须裸调用(不包 ctx.effect),否则注册时机错位——
  // 切走设置页再切回时组件被重建、draft 状态丢失(对勾消失)。照 dsh-capture 写法。
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      { name: 'settings.section', id: 'dsh-host-router', order: 60, label: '网络路由' },
      (props: any) => React.createElement(HostRouterPage, props),
    ),
  )
}
