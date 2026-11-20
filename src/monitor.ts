import type { Context } from 'koishi'
import type { Config } from './config'
import { getSiteStatus, listRelayModels, probeSite } from './api'
import type { ApiClientOptions } from './api'
import { formatDuration, formatLatency } from './format'
import { LOGGER_NAME } from './log'
import { renderError } from './text'

/** 与控制台日志页一致的命名空间；任何模块都用这一个，别自己拼字符串 */
export const loggerName = LOGGER_NAME

export interface MonitorState {
  /** 连续失败次数 */
  failures: number
  /** 上次发送告警的时间戳，用于抑制重复告警 */
  lastAlertAt: number
  /** 站点当前是否可用（用于判断「恢复」） */
  online: boolean
  lastLatencyMs: number
  /** 上一次 /v1/models 快照；null = 还没取过（首次只建基线，不告警） */
  models: string[] | null
  /** 已告警为「消失」、尚未恢复的模型名 */
  missing: string[]
}

export function normalizeChannels(channels: string[]): string[] {
  return channels.map(channel => channel.trim()).filter(Boolean)
}

export interface MonitorHandle {
  state: MonitorState
  /** 立即执行一次巡检（测试与手动触发共用） */
  check: () => Promise<void>
  /** 停止巡检 */
  dispose: () => void
}

/** 本次要关注的模型：配置了 models 就只看这些，否则看整份清单 */
function watchList(all: string[], wanted: string[]): string[] {
  if (!wanted.length) return all
  const available = new Set(all)
  // 只返回盯的模型里真实存在于清单中的，避免把「本来就没了」误报成「刚刚消失」
  return wanted.filter(name => available.has(name))
}

function shortList(names: string[], limit = 12): string {
  if (names.length <= limit) return names.join('、')
  return names.slice(0, limit).join('、') + ` 等 ${names.length} 个`
}

/**
 * 定时巡检。
 * - 站点可用性：探无需鉴权的 /api/status；
 * - 模型/渠道状态：用 sk- 调用令牌读 GET /v1/models 做差集轮询。
 *   渠道被管理员禁用后，对应模型会从这份清单里消失 —— 这是唯一不需要 AdminAuth 的观测口径；
 *   面板的 /api/channel/* 全部挂在 AdminAuth 后面，普通令牌拿不到。
 */
export function createMonitor(ctx: Context, config: Config, channels: string[]): MonitorHandle {
  const logger = ctx.logger(loggerName)
  const client: ApiClientOptions = {
    baseUrl: config.baseUrl,
    token: config.accessToken?.trim() || undefined,
    userId: Number(config.userId) > 0 ? Number(config.userId) : undefined,
    timeout: config.timeout,
  }
  const apiKey = config.monitor.apiKey?.trim() || ''
  const wanted = (config.monitor.models || []).map(name => name.trim()).filter(Boolean)
  const state: MonitorState = {
    failures: 0,
    lastAlertAt: 0,
    online: true,
    lastLatencyMs: 0,
    models: null,
    missing: [],
  }

  const checkSite = async (): Promise<boolean> => {
    const result = await probeSite(ctx, client)
    if (result.ok) {
      const recovered = !state.online
      state.online = true
      state.failures = 0
      state.lastLatencyMs = result.latencyMs
      if (recovered) {
        await notify(ctx, channels, [
          '✅ New API 已恢复访问',
          `地址：${config.baseUrl}`,
          `本次探测延迟：${formatLatency(result.latencyMs)}`,
        ].join('\n'))
      }
      return true
    }

    state.failures += 1
    logger.warn('巡检失败（连续 %d 次）：%s', state.failures, result.error ?? '未知错误')
    const threshold = Math.max(1, config.monitor.threshold)
    if (state.failures < threshold) return false
    // 只在「可用 → 不可用」的状态跃迁时告警一次，避免每次巡检都刷屏
    if (!state.online) return false
    state.online = false
    state.lastAlertAt = Date.now()
    await notify(ctx, channels, [
      '⚠️ New API 无法访问',
      `地址：${config.baseUrl}`,
      `连续失败：${state.failures} 次`,
      `原因：${result.error ?? '请求失败'}`,
    ].join('\n'))
    return false
  }

  const checkModels = async () => {
    if (!apiKey) return
    const result = await listRelayModels(ctx, { baseUrl: config.baseUrl, apiKey, timeout: config.timeout })
    if (!result.ok) {
      logger.warn('拉取 /v1/models 失败：%s', result.error ?? '未知错误')
      return
    }
    const current = [...new Set(result.models)].sort()
    const previous = state.models
    state.models = current
    // 首次只建基线：没有上一份快照就没有「消失」可言
    if (!previous) {
      logger.info('模型清单基线已建立：%d 个模型。', current.length)
      return
    }

    const before = new Set(watchList(previous, wanted))
    const after = new Set(watchList(current, wanted))
    const disappeared = [...before].filter(name => !after.has(name))
    const recovered = state.missing.filter(name => after.has(name))
    state.missing = state.missing.filter(name => !after.has(name))
    for (const name of disappeared) if (!state.missing.includes(name)) state.missing.push(name)

    if (disappeared.length) {
      state.lastAlertAt = Date.now()
      await notify(ctx, channels, [
        `⚠️ 有 ${disappeared.length} 个模型从 /v1/models 消失（可能是渠道被禁用或无可用渠道）`,
        `站点：${config.baseUrl}`,
        `模型：${shortList(disappeared)}`,
        `当前可用模型：${current.length} 个（上次 ${previous.length} 个）`,
      ].join('\n'))
    }

    if (recovered.length) {
      await notify(ctx, channels, [
        `✅ 有 ${recovered.length} 个模型恢复可用`,
        `站点：${config.baseUrl}`,
        `模型：${shortList(recovered)}`,
        `当前可用模型：${current.length} 个`,
      ].join('\n'))
    }
  }

  const check = async () => {
    try {
      const online = await checkSite()
      if (online) await checkModels()
    } catch (error) {
      logger.warn('巡检异常：%s', (error as Error)?.message)
    }
  }

  return { state, check, dispose: () => {} }
}

export function startMonitor(ctx: Context, config: Config): () => void {
  const logger = ctx.logger(loggerName)
  const channels = normalizeChannels(config.monitor.channels)
  if (!channels.length) {
    logger.warn('已开启定时巡检，但 monitor.channels 为空，不会发送任何告警。请在配置里填写形如 onebot:123456789 的频道。')
    return () => {}
  }

  const handle = createMonitor(ctx, config, channels)
  const interval = Math.max(30, config.monitor.interval) * 1000
  const cron = config.monitor.cron?.trim()
  let dispose: () => void

  if (cron && typeof (ctx as any).cron === 'function') {
    dispose = (ctx as any).cron(cron, () => { void handle.check() })
    logger.info('巡检已按 cron 表达式启动：%s', cron)
  } else {
    if (cron) logger.warn('未安装 koishi-plugin-cron，已改为固定间隔 %d 秒巡检。', interval / 1000)
    dispose = ctx.setInterval(() => { void handle.check() }, interval)
    logger.info('巡检已启动，间隔 %d 秒，告警频道 %s。', interval / 1000, channels.join(', '))
  }

  return () => {
    handle.dispose()
    dispose()
  }
}

async function notify(ctx: Context, channels: string[], content: string) {
  try {
    // ctx.broadcast 会把命中的频道从传入数组里 splice 掉，必须传副本，
    // 否则第一次告警之后同一个频道再也收不到任何消息。
    await ctx.broadcast([...channels], content)
  } catch (error) {
    ctx.logger(loggerName).warn('发送告警失败：%s', (error as Error)?.message)
  }
}

/** /status 里附带展示的运行时长摘要，供 monitor 复用避免重复请求。 */
export function describeUptime(startTime: number | undefined): string {
  if (!startTime || startTime <= 0) return '--'
  return formatDuration(Math.max(0, Math.floor(Date.now() / 1000) - startTime), true)
}

export { renderError, getSiteStatus }
