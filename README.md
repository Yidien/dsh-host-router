# dsh-host-router

dsh 外挂式网络路由插件:按 **hostname** 给 dsh 的请求分流——勾选的域名走本地代理(Clash 等),其余直连。内置嗅探,自动记录 dsh 访问过的 hostname,设置页勾选即生效。

## 跟 dsh-llm-proxy 的区别

| | dsh-llm-proxy | dsh-host-router |
|---|---|---|
| 路由维度 | 按模型(解出 baseURL host) | 按 hostname 通用 |
| 覆盖范围 | 仅 LLM 请求 | LLM + 市场目录 + 截图源 + 任意 dsh 网络请求 |
| 配置 | dsh Config(live) | 独立 config.json(重启生效) |
| 扫描清单 | 无 | 嗅探 + 主动扫(读 settings.yaml provider) |

## 安装

```sh
dsh plugin --profile web add D:/ai/dsh/dsh-host-router
```
重启 `dsh web`(托盘退出 → 启动)。

## 使用

1. 设置页 → 「网络路由」(settings.section 独立页)。
2. 点「扫描配置」:读 dsh 已装 provider(`~/.dsh/settings.yaml` 的 baseURL)+ 常见境外兜底,批量直连探测,标出"直连不通→建议代理"。
3. 勾选要走代理的域名 → 「保存勾选」写回 `~/.dsh/host-router/config.json`。
4. 「保存勾选」即**即时生效**(live reload,免重启;只有装/卸插件才需要重启 dsh)。
5. 「刷新」看嗅探实时清单(dsh 用一会儿后,实际访问过的 host 带 状态/耗时/次数)。

## 配置

`~/.dsh/host-router/config.json`:

```json
{
  "proxyHost": "127.0.0.1",
  "proxyPort": 7897,
  "proxiedHosts": ["api.openai.com", "awesome-dsh-plugin.com"],
  "sniff": true
}
```

`proxiedHosts` 命中(含子域后缀 `xxx.example.com` 命中 `example.com`)走代理;loopback 永远直连。

## 构建

```sh
node scripts/build.mjs
```

跨平台(Windows/macOS/Linux)。工具链定位:优先本机 `node_modules`(标准 `npm install` 流程);本开发机故意不装 devDeps,自动回退复用 `D:/ai/dsh/dsh/dsh-capture/node_modules` 借来的 tsc/tsdown(host tsc + client tsdown factory bundle)。可用 `DSH_CAPTURE_NODE_MODULES` 指定工具链目录。`npm publish` 前会自动执行本脚本(prepublishOnly)。

## 机制

- `globalThis.fetch` 替换(保留原引用,dispose 时还原):白名单 host → undici fetch + ProxyAgent(Clash 等);其余 → 原内置 fetch 原样直连;loopback 永远直连。
- 嗅探在 myFetch 内联:每次请求按 host 聚合(状态/耗时/次数,同步落 `~/.dsh/host-router/log.txt`),喂设置页清单。
- ProxyAgent `clientFactory pipelining:0`:避 Clash 关 idle 隧道复用死连接。
- 保存即热生效:`/save` 写完 config.json 立刻重建 myFetch(毫秒级,免重启)。
- 设置页:`settings.section` slot + React(纯 createElement),host `webServer.register` 前缀路由 `/api/dsh-host-router/*`(loopback-only 鉴权)。
- 纯外挂:`dependencies: {}`,运行时零 require,宿主 ctx 注入;不碰 settings.yaml provider 配置。

## 为什么用独立 config.json(B 方案)

配置走独立 `~/.dsh/host-router/config.json`,而非 dsh 的 schemastery Config(live)。收益:省掉 settings binder(~460 行,绑 dsh 内部 API),稳、轻、跟 dsh 版本解耦。代价只是「live 重载为整体重建 myFetch」——而 `/save` 已经做到保存即生效,免重启。

## License

MIT
