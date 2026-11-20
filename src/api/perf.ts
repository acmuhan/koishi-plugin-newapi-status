import { Context } from 'koishi'
import type { PerfQueryResult, PerfSummaryAllResult, PerfSummary } from '../types'
import { ApiClientOptions, request } from './shared'

/** hours 取值范围：controller 侧 min(hours, 24*30)，<=0 时按 24 处理 */
export const MAX_PERF_HOURS = 24 * 30
/** pkg/perf_metrics MaxRecentModels */
export const MAX_RECENT_MODELS = 50

export interface PerfQueryOptions {
  model: string
  hours?: number
  group?: string
}

/**
 * GET /api/perf-metrics?model=&hours=&group=
 * 必须带 model；bucket 固定按小时聚合（perf_metrics_setting.BucketTime 默认 hour），
 * 所以拿不到分钟级数据，任何"近 1 分钟"的文案都必须改写。
 */
export async function getPerfMetrics(ctx: Context, options: ApiClientOptions, query: PerfQueryOptions) {
  const { data, latencyMs } = await request<PerfQueryResult>(ctx, options, '/api/perf-metrics', {
    query: { model: query.model, hours: query.hours ?? 24, group: query.group || undefined },
  })
  return { result: data, latencyMs }
}

/**
 * GET /api/perf-metrics/summary?hours=&recent_model=...
 * 返回全站模型汇总 + 每个模型的近期成功率序列（最多 50 个 recent_model）。
 */
export async function getPerfMetricsSummary(
  ctx: Context,
  options: ApiClientOptions,
  hours = 24,
  recentModels: string[] = [],
) {
  const capped = recentModels.slice(0, MAX_RECENT_MODELS)
  const { data, latencyMs } = await request<PerfSummaryAllResult>(ctx, options, '/api/perf-metrics/summary', {
    query: { hours, recent_model: capped.length ? capped : undefined },
  })
  return { result: data, latencyMs }
}

/** 从 buckets 里按请求数加权估算整体指标（summary 缺失时的兜底） */
export function summarizeSeries(series: PerfQueryResult['series'] | undefined): PerfSummary | undefined {
  if (!series?.length) return undefined
  const valid = series.filter((point) => Number.isFinite(point?.success_rate))
  if (!valid.length) return undefined
  const avg = (pick: (point: typeof valid[number]) => number) => {
    const values = valid.map(pick).filter((value) => Number.isFinite(value))
    if (!values.length) return 0
    return values.reduce((sum, value) => sum + value, 0) / values.length
  }
  return {
    success_rate: avg((point) => point.success_rate),
    avg_latency_ms: avg((point) => point.avg_latency_ms),
    avg_tps: avg((point) => point.avg_tps),
  }
}
