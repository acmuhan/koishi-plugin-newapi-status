import type { Context } from 'koishi'

/**
 * 日志命名空间。Koishi 控制台「日志」页按这个名字分组，
 * 用 `ctx.logger('newapi-status')` 打出来的每一行都会落在这里。
 */
export const LOGGER_NAME = 'newapi-status'

/** reggol 提供的 5 个日志等级，顺序即语义强度 */
export const LOG_METHODS = ['success', 'error', 'info', 'warn', 'debug'] as const
export type LogMethod = typeof LOG_METHODS[number]

/**
 * 配置里的过滤档位 → reggol 的数值等级。
 * reggol 常量：SILENT=0，SUCCESS/ERROR=1，INFO/WARN=2，DEBUG=3
 * （info 与 warn 同档，success 与 error 同档，这是上游定义，插件不另造）。
 */
export const LOG_LEVELS = { silent: 0, error: 1, info: 2, debug: 3 } as const
export type LogLevelName = keyof typeof LOG_LEVELS

export const LOG_LEVEL_NAMES: LogLevelName[] = Object.keys(LOG_LEVELS) as LogLevelName[]

export interface PluginLogger {
  /** 达成类事件：连通性测试通过、巡检恢复 */
  success(message: string, ...args: any[]): void
  /** 真正的异常：未预期错误、栈信息 */
  error(message: string, ...args: any[]): void
  /** 常规事件：插件加载、巡检启动、基线建立 */
  info(message: string, ...args: any[]): void
  /** 可恢复的降级：接口不可用、卡片渲染失败、巡检失败 */
  warn(message: string, ...args: any[]): void
  /** 诊断细节：请求耗时、回退路径 */
  debug(message: string, ...args: any[]): void
}

/**
 * 创建插件的 5 等级 logger，并在注册时把配置里的档位写回 Koishi 的全局等级表。
 * 所有日志都经这一个入口，脱敏责任留给调用方（sanitize）。
 */
export function createLogger(ctx: Context, level: LogLevelName = 'info'): PluginLogger {
  const raw = ctx.logger(LOGGER_NAME)
  const numeric = LOG_LEVELS[level] ?? LOG_LEVELS.info
  try {
    raw.level = numeric
  } catch {
    // 旧版 reggol 没有 level setter，忽略即可，不影响日志输出
  }
  return {
    success: (message, ...args) => raw.success(message, ...args),
    error: (message, ...args) => raw.error(message, ...args),
    info: (message, ...args) => raw.info(message, ...args),
    warn: (message, ...args) => raw.warn(message, ...args),
    debug: (message, ...args) => raw.debug(message, ...args),
  }
}
