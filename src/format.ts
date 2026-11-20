/**
 * 纯函数格式化工具。所有函数无副作用，便于 vitest 单测。
 */

export type Level = 'ok' | 'warn' | 'fail' | 'unknown'

/** 延迟分档阈值（毫秒）：< 1500 绿，1500 ~ 5000 黄，> 5000 或缺失 红/灰 */
export const LATENCY_FAST = 1500
export const LATENCY_SLOW = 5000

/**
 * 延迟分档。
 * - 非有限数字或 <= 0 → unknown（灰）
 * - < 1500 → ok
 * - <= 5000 → warn
 * - > 5000 → fail
 */
export function classifyLatency(ms?: number | null): Level {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return 'unknown'
  if (ms < LATENCY_FAST) return 'ok'
  if (ms <= LATENCY_SLOW) return 'warn'
  return 'fail'
}

/** 延迟文本，形如 `412ms` / `1.42s` / `--` */
export function formatLatency(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '--'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

const UNITS: Array<[string, number]> = [
  ['天', 86400],
  ['时', 3600],
  ['分', 60],
  ['秒', 1],
]

/**
 * 把秒数格式化成中文时长。
 * @param compact true 时只保留最大的两级单位（卡片用），false 时补零到分钟（文本用）。
 */
export function formatDuration(seconds?: number | null, compact = false): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '--'
  let rest = Math.floor(seconds)
  const parts: string[] = []
  for (const [unit, size] of UNITS) {
    const value = Math.floor(rest / size)
    rest -= value * size
    // 非 compact 时补足到分钟，但整点（如正好 1 天）不补 0 分
    const padMinute = unit === '分' && !compact && parts.length > 0 && rest > 0
    if (value || padMinute) parts.push(`${value}${unit}`)
    if (compact && parts.length >= 2) break
    if (compact && !value && !parts.length && size === 1) parts.push('0秒')
  }
  if (!parts.length) return compact ? '0秒' : '0分'
  return parts.join('')
}

/** 把 unix 秒格式化成 `MM-DD HH:mm`（按调用方时区） */
export function formatTimestamp(unixSeconds?: number | null): string {
  if (unixSeconds == null || !Number.isFinite(unixSeconds) || unixSeconds <= 0) return '--'
  const date = new Date(unixSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 把 unix 秒格式化成 `HH:mm`（色块时间轴用） */
export function formatClock(unixSeconds?: number | null): string {
  if (unixSeconds == null || !Number.isFinite(unixSeconds) || unixSeconds <= 0) return '--'
  const date = new Date(unixSeconds * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 额度换算。New API 的 quota 字段是整数额度，除以 quota_per_unit 得到「美元」，
 * 再按 usd_exchange_rate × price 换算成展示货币。display_in_currency 为 false 时只显示额度。
 */
export function formatQuota(
  quota: number,
  options: { quota_per_unit?: number, display_in_currency?: boolean, usd_exchange_rate?: number, price?: number, symbol?: string } = {},
): string {
  if (!Number.isFinite(quota)) return '--'
  const perUnit = options.quota_per_unit && options.quota_per_unit > 0 ? options.quota_per_unit : 500000
  const usd = quota / perUnit
  if (!options.display_in_currency) return `${formatNumber(quota)} 额度`
  const rate = options.usd_exchange_rate && options.usd_exchange_rate > 0 ? options.usd_exchange_rate : 1
  const price = options.price && options.price > 0 ? options.price : 1
  const amount = usd * rate * price
  const symbol = options.symbol ?? '$'
  return `${symbol}${amount.toFixed(2)}`
}

/** 千分位数字，保留最多两位小数且去掉多余的 0 */
export function formatNumber(value?: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '--'
  const fixed = Number(value.toFixed(digits))
  return fixed.toLocaleString('en-US', { maximumFractionDigits: digits })
}

/**
 * 倍率展示。New API 中 model_ratio / group_ratio 为倍数：1 → 1.00×。
 * 按次计费（quota_type === 1）时倍率为 0，需要显示为「按次」。
 */
export function formatRatio(ratio?: number | null, quotaType?: number): string {
  if (quotaType === 1) return '按次'
  if (ratio == null || !Number.isFinite(ratio)) return '--'
  if (ratio === 0) return '免费'
  return `${ratio.toFixed(2)}×`
}

/** 成功率（0–100）分档 */
export function classifySuccessRate(rate?: number | null): Level {
  if (rate == null || !Number.isFinite(rate) || rate < 0) return 'unknown'
  if (rate >= 95) return 'ok'
  if (rate >= 80) return 'warn'
  return 'fail'
}

/** 成功率文本，形如 `99.94%` */
export function formatSuccessRate(rate?: number | null): string {
  if (rate == null || !Number.isFinite(rate) || rate < 0) return '--'
  return `${rate.toFixed(2)}%`
}

/** Uptime Kuma 监控状态：1 = up，0 = down，其余视为未知 */
export function formatMonitorStatus(status?: number | null): { level: Level, text: string } {
  if (status === 1) return { level: 'ok', text: '正常' }
  if (status === 0) return { level: 'fail', text: '离线' }
  return { level: 'unknown', text: '未知' }
}

/** 站点可访问性：能拿到 /api/status 即为可访问 */
export function formatSiteAvailability(reachable: boolean): { level: Level, text: string } {
  return reachable ? { level: 'ok', text: '可访问' } : { level: 'fail', text: '不可访问' }
}

/**
 * 解析 console_setting.Announcements。它是 JSON 数组字符串（不是数组对象），
 * 也可能直接是普通字符串，两种都要能处理。
 */
export function parseAnnouncements(raw?: unknown, limit = 0): string[] {
  if (raw === null || raw === undefined) return []
  let list: unknown = raw
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return []
    // console_setting.Announcements 是 JSON 数组字符串；新版站点则直接返回数组
    if (trimmed.startsWith('[') || trimmed.startsWith('"')) {
      try {
        list = JSON.parse(trimmed)
      } catch {
        list = trimmed
      }
    }
  }
  const result: string[] = []
  const push = (value: unknown) => {
    // 新版 /api/status 的 announcements 是对象数组：{ content, extra, id, publishDate, type }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      push((value as { content?: unknown }).content)
      return
    }
    if (typeof value !== 'string') return
    // 公告正文可能是 Markdown（/api/notice 是裸 Markdown），卡片里不渲染标记
    const text = stripMarkdown(value)
    if (text) result.push(text)
  }
  if (Array.isArray(list)) list.forEach(push)
  else if (typeof list === 'string') {
    // 兼容纯文本公告：按行或按分号切分
    list.split(/\r?\n|；/).forEach(push)
  } else if (list && typeof list === 'object') {
    push(list)
  }
  return limit > 0 ? result.slice(0, limit) : result
}

/**
 * 公告是 Markdown 裸文本（实测 /api/notice 返回 "# 欢迎来到\n## 公告请看时间线"），
 * 卡片里不渲染 Markdown，所以去掉标题号、加粗、行内代码与链接语法，只留人话。
 */
export function stripMarkdown(text?: string | null): string {
  if (!text) return ''
  return String(text)
    .replace(/!?\[([^\]]*)\]\((https?:[^\s)]+)\)/g, '$1 $2')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)[*_]([^\s*_][^*_]*)[*_](?=\s|$)/g, '$1$2')
    .replace(/\u0060([^\u0060]+)\u0060/g, '$1')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 状态色块分档：成功率 → 色块等级 */
export function classifySeries(values: Array<{ success_rate: number }>, threshold?: number): Level[] {
  return values.map((point) => classifySuccessRate(point.success_rate))
}

/** 取最近 n 个点的成功率数组，不足时原样返回 */
export function tail<T>(list: T[] | undefined, n: number): T[] {
  if (!list?.length) return []
  return n > 0 ? list.slice(-n) : list.slice()
}

/** 计算百分比文本，除零返回 -- */
export function formatPercent(value: number, total: number): string {
  if (!total) return '--'
  return `${((value / total) * 100).toFixed(1)}%`
}