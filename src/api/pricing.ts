import { Context } from 'koishi'
import type { PricingResponse } from '../types'
import { ApiClientOptions, request } from './shared'

/**
 * GET /api/pricing
 * 走 middleware.HeaderNavModuleAuth('pricing')：站点默认公开，登录后 group_ratio 会按用户分组覆写。
 * 返回 data(Pricing[]) + vendors + group_ratio + usable_group + auto_groups。
 */
export async function getPricing(ctx: Context, options: ApiClientOptions): Promise<PricingResponse> {
  // 注意：/api/pricing 的 vendors / group_ratio / usable_group 与 data 同级（controller/pricing.go: GetPricing 的 gin.H），
  // 所以这里必须拿整个响应体，不能只要 data。
  const { data } = await request<Partial<PricingResponse>>(ctx, options, '/api/pricing', { raw: true })
  const payload = (data ?? {}) as Partial<PricingResponse>
  return {
    data: Array.isArray(payload.data) ? payload.data : [],
    vendors: Array.isArray(payload.vendors) ? payload.vendors : [],
    group_ratio: payload.group_ratio ?? {},
    usable_group: payload.usable_group ?? {},
    supported_endpoint: payload.supported_endpoint ?? {},
    auto_groups: payload.auto_groups ?? [],
    pricing_version: payload.pricing_version,
  }
}
