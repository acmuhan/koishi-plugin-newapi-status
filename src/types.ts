/**
 * New API 接口返回结构。
 * 全部字段均来自 QuantumNous/new-api 源码（controller/、pkg/perf_metrics/types.go），未做猜测。
 */

export interface ApiEnvelope<T> {
  success: boolean
  message?: string
  data: T
}

/** GET /api/status */
export interface SiteStatus {
  version: string
  /** unix 秒 */
  start_time: number
  system_name?: string
  logo?: string
  server_address?: string
  docs_link?: string
  quota_per_unit?: number
  display_in_currency?: boolean
  quota_display_type?: string
  usd_exchange_rate?: number
  price?: number
  api_info_enabled?: boolean
  uptime_kuma_enabled?: boolean
  announcements_enabled?: boolean
  faq_enabled?: boolean
  register_enabled?: boolean
  self_use_mode_enabled?: boolean
  demo_site_enabled?: boolean
  /**
   * 公告列表，仅在 announcements_enabled 时下发。
   * 老版本是 JSON 数组字符串（console_setting.Announcements），
   * v1.0.0-rc 之后直接返回对象数组 { content, extra, id, publishDate, type }。
   */
  announcements?: string | SiteAnnouncement[]
  /** 站点线路（只在 api_info_enabled 时下发），用于 /newapi network */
  api_info?: SiteRoute[]
  setup?: boolean
}

/** /api/status 的 data.api_info 元素 */
export interface SiteRoute {
  /** 仅用于展示的分类色（red / yellow / green ...），不是健康状态 */
  color?: string
  description?: string
  id?: number
  /** 线路名，例如 China / Global */
  route: string
  /** 该线路的接入地址 */
  url: string
}

/** /api/status 里 announcements 的对象形态（v1.0.0-rc+） */
export interface SiteAnnouncement {
  content: string
  extra?: string
  id?: number
  publishDate?: string
  type?: string
}

/** GET /api/pricing */
export interface ModelPricing {
  model_name: string
  description?: string
  icon?: string
  tags?: string[]
  vendor_id?: number
  quota_type: number
  model_ratio: number
  model_price: number
  owner_by?: string
  completion_ratio: number
  cache_ratio?: number
  create_cache_ratio?: number
  image_ratio?: number
  audio_ratio?: number
  audio_completion_ratio?: number
  enable_groups: string[]
  supported_endpoint_types?: string[]
  billing_mode?: string
  billing_expr?: string
  pricing_version?: string
  ordinary_pricing?: boolean
}

export interface PricingVendor {
  id: number
  name: string
  description?: string
  icon?: string
}

export interface PricingResponse {
  data: ModelPricing[]
  vendors: PricingVendor[]
  group_ratio: Record<string, number>
  usable_group: Record<string, string>
  supported_endpoint?: Record<string, string[]>
  auto_groups?: string[]
  pricing_version?: string
}

/**
 * GET /api/ratio_config
 * 全站倍率字典。model 名 → 倍率/价格，字段是 map 而不是数组。
 */
export interface RatioConfig {
  model_ratio: Record<string, number>
  completion_ratio: Record<string, number>
  cache_ratio: Record<string, number>
  create_cache_ratio: Record<string, number>
  model_price: Record<string, number>
  /** 动态计费模式标识 */
  billing_mode: Record<string, string>
  /** 动态计费表达式 */
  billing_expr: Record<string, string>
}

/** GET /v1/models（relay 端点，用 sk- 调用令牌） */
export interface RelayModelList {
  object?: string
  data?: Array<{ id?: string, object?: string }>
}

/** GET /api/models 的 data：channelType(int) -> 模型名列表 */
export type ModelsByChannel = Record<string, string[]>

/** GET /api/uptime/status */
export interface UptimeMonitor {
  name: string
  uptime: number
  /** 1 = up，0 = down */
  status: number
  group?: string
}

export interface UptimeGroup {
  categoryName: string
  monitors: UptimeMonitor[]
}

/** GET /api/perf-metrics */
export interface PerfSummary {
  avg_latency_ms: number
  success_rate: number
  avg_tps: number
}

export interface PerfBucketPoint {
  ts: number
  avg_ttft_ms: number
  avg_latency_ms: number
  success_rate: number
  avg_tps: number
}

export interface PerfGroupResult {
  group: string
  avg_ttft_ms: number
  avg_latency_ms: number
  success_rate: number
  avg_tps: number
  series: PerfBucketPoint[]
}

export interface PerfQueryResult {
  model_name: string
  series_schema?: string
  summary?: PerfSummary
  series: PerfBucketPoint[]
  window_start: number
  window_end: number
  groups?: PerfGroupResult[]
}

/** GET /api/perf-metrics/summary */
export interface SuccessRatePoint {
  ts: number
  success_rate: number
}

export interface PerfModelSummary {
  model_name: string
  avg_latency_ms: number
  success_rate: number
  avg_tps: number
  recent_success_series?: SuccessRatePoint[]
  request_count?: number
}

export interface PerfSummaryAllResult {
  summary?: PerfSummary
  window_start: number
  window_end: number
  models: PerfModelSummary[]
  recent_success_series?: Record<string, SuccessRatePoint[]>
}

/** relay 测试（POST /v1/chat/completions）返回的最小字段 */
export interface ChatCompletionResponse {
  id?: string
  model?: string
  choices?: Array<{ message?: { content?: string }, finish_reason?: string }>
  usage?: { prompt_tokens?: number, completion_tokens?: number, total_tokens?: number }
}