import {
  Level,
  classifyLatency,
  classifySuccessRate,
  formatClock,
  formatDuration,
  formatLatency,
  formatRatio,
  formatSuccessRate,
  formatTimestamp,
  parseAnnouncements,
} from './format'
import type { RouteProbe } from './api/network'
import type {
  ModelPricing,
  PerfBucketPoint,
  PerfGroupResult,
  PerfQueryResult,
  PerfSummary,
  PricingResponse,
  SiteStatus,
  SiteRoute,
  UptimeGroup,
} from './types'

/**
 * 卡片 / 列表的视图模型。图片渲染与纯文本渲染共用这一份数据，
 * 保证「有没有 puppeteer」只影响排版，不影响口径。
 */

export type Tone = 'ok' | 'warn' | 'fail' | 'plain' | 'unknown'

export interface CardBadge {
  text: string
  tone: Tone
}

export interface CardMetric {
  key: string
  value: string
  sub?: string
  level?: Level
}

export interface CardBlock {
  level: Level
  label?: string
}

export interface CardRow {
  name: string
  ratio?: number
  value: string
  level?: Level
}

export interface CardSection {
  title: string
  note?: string
  rows?: CardRow[]
  blocks?: CardBlock[]
  axis?: string[]
  legend?: boolean
  chips?: string[]
  empty?: string
}

export interface CardView {
  siteName: string
  sub: string
  badges: CardBadge[]
  metrics: CardMetric[]
  sections: CardSection[]
  notice?: { tag: string, body: string }
  footerLeft: string
  footerRight: string
}

export interface ListRowView {
  name: string
  tag?: string
  value?: string
  level?: Level
  /** 长文本（公告正文等）：value 换行显示，不右对齐、不省略 */
  wrap?: boolean
}

export interface ListView {
  title: string
  subtitle?: string
  note?: string
  rows: ListRowView[]
  empty?: string
  /** 超过该条数时折叠：只渲染前 N 行，并给一行「还有 M 条」提示 */
  limit?: number
  footerLeft: string
  footerRight: string
}

export interface ViewContext {
  pluginName: string
  updatedAt?: number
}

const UNKNOWN = '--'

export function latencyMetric(key: string, ms: number | null | undefined, sub?: string): CardMetric {
  const level = classifyLatency(ms)
  return {
    key,
    value: ms === null || ms === undefined ? UNKNOWN : formatLatency(ms),
    sub,
    level: level === 'unknown' ? undefined : level,
  }
}

/**
 * 站点级色块：把多模型的每小时成功率按小时取平均。
 * 注意真实站点（v1.0.0-rc.51）的 /api/perf-metrics/summary **不返回顶层
 * recent_success_series**，只把它挂在 models[].recent_success_series 上，
 * 所以这里接受两种形态：{ 模型: 点[] } 或 models[] 数组。
 */
export function aggregateSuccessSeries(
  input?: Record<string, { ts: number, success_rate: number }[]> | Array<{ recent_success_series?: { ts: number, success_rate: number }[] }>,
): CardBlock[] {
  if (!input) return []
  const seriesMap: Record<string, { ts: number, success_rate: number }[]> = {}
  if (Array.isArray(input)) {
    input.forEach((model, index) => {
      if (model?.recent_success_series?.length) seriesMap[String(index)] = model.recent_success_series
    })
  } else {
    for (const [key, points] of Object.entries(input)) seriesMap[key] = points
  }
  if (!Object.keys(seriesMap).length) return []
  const buckets = new Map<number, { sum: number, count: number }>()
  for (const points of Object.values(seriesMap)) {
    for (const point of points ?? []) {
      if (!point || typeof point.ts !== 'number' || typeof point.success_rate !== 'number') continue
      const bucket = buckets.get(point.ts) ?? { sum: 0, count: 0 }
      bucket.sum += point.success_rate
      bucket.count += 1
      buckets.set(point.ts, bucket)
    }
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, bucket]) => ({
      level: classifySuccessRate(bucket.sum / bucket.count),
      label: formatClock(ts),
    }))
}

export function seriesToBlocks(series: PerfBucketPoint[] | undefined): CardBlock[] {
  return (series ?? []).map(point => ({
    level: classifySuccessRate(point.success_rate),
    label: formatClock(point.ts),
  }))
}

/** 首 Token 只存在于分组维度，按分组序列求平均 */
function averageTtft(groups: PerfGroupResult[] | undefined): number | undefined {
  const values = (groups ?? [])
    .map(group => group.avg_ttft_ms)
    .filter(value => Number.isFinite(value) && value > 0)
  if (!values.length) return undefined
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function trimTail(text: string): string {
  return String(text).replace(/[。．.;；,，、\s]+$/, '')
}

export function buildStatusCard(input: {
  status: SiteStatus | null
  baseUrl: string
  latencyMs: number
  reachable: boolean
  pricing?: PricingResponse | null
  successSeries?: Record<string, { ts: number, success_rate: number }[]>
  /** /api/perf-metrics/summary 的 models[]（真实站点把成功率序列挂在这里） */
  perfModels?: Array<{ recent_success_series?: { ts: number, success_rate: number }[] }>
  /** 参与色块聚合的模型数，用于文案 */
  perfModelCount?: number
  announcements?: string[]
  fallbackName?: string
  /** 成功率色块的统计窗口（小时），用于空态文案 */
  seriesHours?: number
}, view: ViewContext): CardView {
  const { status, pricing } = input
  const siteName = status?.system_name || input.fallbackName || 'New API'
  const version = status?.version ? `v${status.version.replace(/^v/, '')}` : UNKNOWN
  const startTime = status?.start_time
  const uptimeSeconds = startTime && startTime > 0 ? Math.max(0, Math.floor(Date.now() / 1000) - startTime) : 0
  const groups = Object.entries(pricing?.group_ratio ?? {})
    .sort((a, b) => b[1] - a[1])
    .map<CardRow>(([name, ratio]) => ({
      name,
      ratio: Number.isFinite(ratio) ? Math.max(0.001, ratio) : 0.001,
      value: Number.isFinite(ratio) ? `${ratio.toFixed(2)}×` : UNKNOWN,
    }))

  const blocks = aggregateSuccessSeries(input.perfModels?.length ? input.perfModels : input.successSeries)
  const announcements = (input.announcements ?? []).slice(0, 5)
  const sections: CardSection[] = []

  // 实测站点有 30 个分组，全量渲染会让状态卡长到 2600px；状态卡只给前 10 个当概览，
  // 完整列表交给 newapi group。note 里明说收口，避免用户以为被吞了。
  if (groups.length) {
    const shown = groups.slice(0, 10)
    // 倍率条按「本组最大值」归一化：真实站点有 3.00× 也有 0.06×，
    // 直接当 0–1 比例会把所有 1.00× 以上都截成满格，看起来像全部一样大。
    const maxRatio = Math.max(...shown.map(row => row.ratio ?? 0.001), 0.01)
    sections.push({
      title: '分组倍率',
      note: groups.length > shown.length
        ? `显示前 ${shown.length}/${groups.length} · newapi group 看全部`
        : 'group_ratio',
      rows: shown.map(row => ({ ...row, ratio: Math.max(0.06, (row.ratio ?? 0.001) / maxRatio) })),
    })
  }

  const seriesHours = input.seriesHours && input.seriesHours > 0 ? input.seriesHours : 24
  sections.push({
    title: '近期成功率色块',
    note: blocks.length
      ? `${blocks.length} 小时 · ${input.perfModelCount ? `${input.perfModelCount} 个模型平均` : 'perf-metrics'}`
      : '无数据',
    blocks,
    // 色块只标「多久之前」而不是首尾两个 HH:mm：24 小时窗口的两端都可能是 05:00 / 04:00，
    // 并排放会让人以为时间倒流。
    axis: blocks.length ? [`过去 ${blocks.length} 小时`, '现在'] : undefined,
    legend: true,
    // 空态不要写成「未开启性能监控」：接口没数据也可能是这段时间真没有请求
    empty: `近 ${seriesHours} 小时没有请求数据，或站点未开启性能监控。`,
  })

  return {
    siteName,
    sub: `${hostOf(input.baseUrl)} · ${version}`,
    badges: [
      { text: input.reachable ? '可访问' : '不可访问', tone: input.reachable ? 'ok' : 'fail' },
      {
        text: startTime ? `Uptime ${formatDuration(uptimeSeconds, true)}` : 'Uptime --',
        tone: 'plain',
      },
    ],
    metrics: [
      { key: '站点版本', value: version, sub: 'New API' },
      {
        key: '运行时长',
        value: startTime ? formatDuration(uptimeSeconds, true) : UNKNOWN,
        sub: startTime ? `自 ${formatTimestamp(startTime)}` : 'start_time 缺失',
      },
      latencyMetric('接口延迟', input.reachable ? input.latencyMs : 0, '/api/status'),
      {
        key: '可访问性',
        value: input.reachable ? '正常' : '异常',
        sub: input.reachable ? 'HTTP 200' : '请求失败',
        level: input.reachable ? 'ok' : 'fail',
      },
    ],
    sections,
    notice: announcements.length
      ? { tag: `${announcements.length} 条`, body: announcements.map(trimTail).join('；') }
      : undefined,
    footerLeft: view.pluginName,
    footerRight: formatClock(view.updatedAt ?? Math.floor(Date.now() / 1000)),
  }
}

export function buildModelStatusCard(input: {
  model: string
  group?: string
  hours: number
  result: PerfQueryResult
}, view: ViewContext): CardView {
  const summary: PerfSummary | undefined = input.result.summary
  const groups = input.result.groups ?? []
  const series = input.result.series ?? []
  const ttft = averageTtft(groups)

  const rows = groups
    .slice()
    .sort((a, b) => (b.success_rate ?? 0) - (a.success_rate ?? 0))
    .map<CardRow>(group => ({
      name: group.group,
      ratio: Number.isFinite(group.success_rate) ? Math.min(1, Math.max(0.02, group.success_rate / 100)) : 0.02,
      value: `${formatSuccessRate(group.success_rate)} · ${formatLatency(group.avg_latency_ms)}`,
      level: classifySuccessRate(group.success_rate),
    }))

  return {
    siteName: input.model,
    sub: `分组 ${input.group || '全部'} · 近 ${input.hours} 小时 · perf-metrics`,
    badges: [
      {
        text: `成功率 ${formatSuccessRate(summary?.success_rate)}`,
        tone: classifySuccessRate(summary?.success_rate) === 'unknown' ? 'unknown' : classifySuccessRate(summary?.success_rate),
      },
      // 「窗口 05:00」这种写法没人看得懂是在说哪一端，直接给小时数
      { text: `窗口 ${input.hours}h`, tone: 'plain' },
    ],
    metrics: [
      {
        key: '成功率',
        value: formatSuccessRate(summary?.success_rate),
        level: classifySuccessRate(summary?.success_rate),
      },
      latencyMetric('平均延迟', summary?.avg_latency_ms),
      latencyMetric('首 Token', ttft),
      {
        key: 'TPS',
        value: summary && Number.isFinite(summary.avg_tps) ? summary.avg_tps.toFixed(1) : UNKNOWN,
        sub: 'tokens/s',
      },
    ],
    sections: [
      {
        title: '分组明细',
        note: `${groups.length} 个分组`,
        rows,
        empty: '该模型暂无分组维度的监控数据。',
      },
      {
        title: '每小时成功率',
        note: series.length ? `${series.length} 小时` : '无数据',
        blocks: seriesToBlocks(series),
        axis: series.length ? [formatTimestamp(series[0].ts), '现在'] : undefined,
        legend: true,
        empty: '该模型在所选窗口内没有请求量。',
      },
    ],
    footerLeft: view.pluginName,
    footerRight: formatClock(view.updatedAt ?? Math.floor(Date.now() / 1000)),
  }
}

export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') || UNKNOWN
  }
}

/** 公告来源：优先 /api/status 的 announcements，退回 /api/notice */
export function collectAnnouncements(status: SiteStatus | null, notice: string | null, limit: number): string[] {
  const fromStatus = status?.announcements ? parseAnnouncements(status.announcements) : []
  if (fromStatus.length) return fromStatus.slice(0, limit || fromStatus.length)
  if (notice) return parseAnnouncements(notice, limit)
  return []
}

export interface PricingModelItem {
  model_name: string
  vendor?: string
  groups: string[]
  quotaType: number
  ratio: number
  completionRatio: number
  pricing: ModelPricing
}

/** 把 /api/pricing 归一化成便于展示的模型条目 */
export function pricingModels(pricing: PricingResponse | null): PricingModelItem[] {
  if (!pricing) return []
  const vendors = new Map<number, string>()
  for (const vendor of pricing.vendors ?? []) vendors.set(vendor.id, vendor.name)
  return (pricing.data ?? [])
    .filter(item => item && typeof item.model_name === 'string')
    .map(item => ({
      model_name: item.model_name,
      vendor: item.vendor_id !== undefined ? vendors.get(item.vendor_id) : undefined,
      groups: item.enable_groups ?? [],
      quotaType: item.quota_type ?? 0,
      ratio: item.model_ratio ?? 0,
      completionRatio: item.completion_ratio ?? 0,
      pricing: item,
    }))
}

/** 模型列表 / 搜索结果 */
export function buildModelList(
  models: PricingModelItem[],
  options: { title: string, subtitle?: string, note?: string, keyword?: string },
  view: ViewContext,
): ListView {
  const keyword = options.keyword?.trim().toLowerCase()
  const filtered = keyword
    ? models.filter(item => item.model_name.toLowerCase().includes(keyword))
    : models
  const sorted = filtered
    .slice()
    .sort((a, b) => a.model_name.localeCompare(b.model_name))
  // 实测站点有 86 个模型：全量渲染是一张 1400×9000 的图，40 行也有 3500px 高，
  // 列表统一在 24 行收口（约 2100px），剩下的提示用关键词筛选。
  const limit = 24
  const rows = sorted
    .map<ListRowView>(item => {
      // tag 只放供应商名：早先写成 vendor || groups[0]，没有 vendor 的条目会变成
      // 「default | default · 37.50×」这种同一个词出现两遍的鬼样子。
      const groups = item.groups.slice(0, 2).join('/')
      const ratio = formatRatio(item.ratio, item.quotaType)
      return {
        name: item.model_name,
        tag: item.vendor || undefined,
        value: [groups, ratio].filter(Boolean).join(' · '),
      }
    })
  return {
    title: options.title,
    subtitle: options.subtitle,
    note: options.note ?? (rows.length > limit ? `${rows.length} 个 · 显示前 ${limit}` : `${rows.length} 个`),
    rows,
    limit,
    empty: keyword ? `没有匹配「${options.keyword}」的模型。` : '站点没有返回可用模型。',
    footerLeft: view.pluginName,
    footerRight: formatClock(view.updatedAt ?? Math.floor(Date.now() / 1000)),
  }
}

/** Uptime Kuma 监控列表 */
export function buildUptimeList(groups: UptimeGroup[], name: string | undefined, view: ViewContext): ListView {
  const rows: ListRowView[] = []
  for (const group of groups) {
    for (const monitor of group.monitors ?? []) {
      if (name && !monitor.name.toLowerCase().includes(name.toLowerCase())) continue
      rows.push({
        name: monitor.name,
        tag: monitor.group || group.categoryName,
        value: `${monitor.status === 1 ? '在线' : '离线'} · ${(monitor.uptime ?? 0).toFixed(2)}%`,
        level: monitor.status === 1 ? 'ok' : 'fail',
      })
    }
  }
  const online = rows.filter(row => row.level === 'ok').length
  return {
    title: name ? `监控项 ${name}` : 'Uptime Kuma 监控',
    subtitle: `${online}/${rows.length} 在线`,
    note: name ? undefined : `${groups.length} 个分类`,
    rows,
    empty: name
      ? '没有匹配的监控项。'
      : '站点未配置 Uptime Kuma 状态页，或未开启该模块（status.uptime_kuma_enabled）。',
    footerLeft: view.pluginName,
    footerRight: formatClock(view.updatedAt ?? Math.floor(Date.now() / 1000)),
  }
}
/** 线路颜色只是站内的分类色，不能当健康状态用；健康状态一律以实测为准 */
function routeLevel(probe: RouteProbe): Level {
  if (!probe.ok) return 'fail'
  if (!Number.isFinite(probe.latencyMs) || probe.latencyMs <= 0) return 'unknown'
  return probe.latencyMs > 5000 ? 'warn' : 'ok'
}

/**
 * /api/status 的 api_info 线路列表（多数站点比 Uptime Kuma 更有内容）。
 * 每条线路单独探一次 /api/status，得到真实可达性与延迟。
 */
export function buildRouteList(probes: RouteProbe[], name: string | undefined, view: ViewContext): ListView {
  const keyword = name?.trim().toLowerCase()
  const rows: ListRowView[] = []
  for (const probe of probes) {
    const route: SiteRoute = probe.route
    if (keyword && !route.route.toLowerCase().includes(keyword) && !(route.url || '').toLowerCase().includes(keyword)) {
      continue
    }
    rows.push({
      name: route.route || route.url,
      tag: (route.description || '').trim() || undefined,
      value: probe.ok
        ? `在线 · ${formatLatency(probe.latencyMs)}`
        : `不可达 · ${formatLatency(probe.latencyMs)}`,
      level: routeLevel(probe),
    })
  }
  const online = rows.filter(row => row.level !== 'fail').length
  return {
    title: name ? `线路 ${name}` : '站点线路',
    subtitle: `${online}/${rows.length} 在线 · /api/status api_info`,
    note: name ? undefined : `${probes.length} 条线路`,
    rows,
    empty: keyword
      ? `没有匹配「${name}」的线路。`
      : '站点没有下发 api_info（status.api_info_enabled 未开启），也没有配置 Uptime Kuma 监控项。',
    footerLeft: view.pluginName,
    footerRight: formatClock(view.updatedAt ?? Math.floor(Date.now() / 1000)),
  }
}
