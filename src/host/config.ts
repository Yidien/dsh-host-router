/**
 * dsh-host-router · 配置(独立 config.json;/save 写完 live reload 即生效)。
 *
 * 存 ~/.dsh/host-router/config.json。优先 DSH_HOME(实测:部署 web 进程 homedir
 * 可能与 DSH_HOME 指向不同用户,homedir() 推导路径错位——DSH_HOME 才是权威)。
 */
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export interface HostRouterConfig {
  proxyHost: string
  proxyPort: number
  proxiedHosts: string[]
  sniff: boolean
}

const DEFAULT: HostRouterConfig = {
  proxyHost: '127.0.0.1',
  proxyPort: 7897,
  proxiedHosts: ['api.openai.com', 'awesome-dsh-plugin.com'],
  sniff: true,
}

export function configDir(): string {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(dshHome, 'host-router')
}

export function configPath(): string {
  return join(configDir(), 'config.json')
}

export function logPath(): string {
  return join(configDir(), 'log.txt')
}

/** 读配置(缺字段用默认;文件不存在用默认并落盘)。 */
export function readConfig(): HostRouterConfig {
  const p = configPath()
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Partial<HostRouterConfig>
    return { ...DEFAULT, ...raw }
  } catch {
    return { ...DEFAULT }
  }
}

/** 原子写配置(先 tmp 再 rename,防中途崩溃留半截 JSON)。 */
export function writeConfig(cfg: HostRouterConfig): void {
  const p = configPath()
  mkdirSync(dirname(p), { recursive: true })
  const tmp = p + '.tmp'
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  // rename 跨设备可能失败,fallback 直接 write
  try {
    renameSync(tmp, p)
  } catch {
    writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  }
}
