import { Context } from 'koishi'
import type { RatioConfig } from '../types'
import { ApiClientOptions, request } from './shared'

/**
 * GET /api/ratio_config —— 无鉴权，公开接口。
 * 返回全站倍率字典：model_ratio / completion_ratio / cache_ratio / model_price / billing_mode / billing_expr。
 * 实测部分站点这里下发的模型数远多于 /api/pricing（例如 4102 对 86），
 * 所以「查某个模型的倍率」必须把这份字典当兜底数据源。
 */
export async function getRatioConfig(ctx: Context, options: ApiClientOptions): Promise<RatioConfig> {
  try {
    const { data } = await request<Partial<RatioConfig>>(ctx, options, '/api/ratio_config', { authorization: null })
    const payload = (data ?? {}) as Partial<RatioConfig>
    return {
      model_ratio: payload.model_ratio ?? {},
      completion_ratio: payload.completion_ratio ?? {},
      cache_ratio: payload.cache_ratio ?? {},
      create_cache_ratio: payload.create_cache_ratio ?? {},
      model_price: payload.model_price ?? {},
      billing_mode: payload.billing_mode ?? {},
      billing_expr: payload.billing_expr ?? {},
    }
  } catch {
    // 老版本没有这个接口：返回空字典，调用方退回 /api/pricing
    return { model_ratio: {}, completion_ratio: {}, cache_ratio: {}, create_cache_ratio: {}, model_price: {}, billing_mode: {}, billing_expr: {} }
  }
}
