// dsh-host-router · 跨平台构建(Windows/macOS/Linux 通用):host(tsc) + client(tsdown)。
// 工具链定位:优先本机 node_modules(标准 npm install 流程);
// 本开发机故意不装 devDeps,回退 D:/ai/dsh/dsh/dsh-capture/node_modules 借用的 tsc/tsdown。
// 可用环境变量 DSH_CAPTURE_NODE_MODULES 显式指定。
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const hasToolchain = (base) =>
  existsSync(join(base, 'typescript', 'bin', 'tsc')) &&
  existsSync(join(base, 'tsdown', 'bin', 'tsdown.js'))

const cap =
  process.env.DSH_CAPTURE_NODE_MODULES ||
  (hasToolchain(join(root, 'node_modules')) ? join(root, 'node_modules') : null) ||
  (hasToolchain('D:/ai/dsh/dsh/dsh-capture/node_modules') ? 'D:/ai/dsh/dsh/dsh-capture/node_modules' : null)

if (!cap) {
  console.error('error: typescript/tsdown toolchain not found — run "npm install" or set DSH_CAPTURE_NODE_MODULES')
  process.exit(1)
}

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

console.log('=== build:host (tsc) ===')
run(process.execPath, [join(cap, 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'])

console.log('=== build:client (tsdown) ===')
run(process.execPath, [join(cap, 'tsdown', 'bin', 'tsdown.js')], { NODE_PATH: cap })

console.log('=== build complete ===')