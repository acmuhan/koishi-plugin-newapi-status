import { Context } from 'koishi'
import type { ModelsByChannel } from '../types'
import { ApiClientOptions, request } from './shared'

/**
 * GET /api/models
 * 走 middleware.UserAuth()：**必须**面板 access_token / PAT，匿名会 401。
 * data 形如 { "1": ["gpt-4o", ...], "14": [...] }（channelType → 模型名列表）。
 */
export async function getModelsByChannel(ctx: Context, options: ApiClientOptions): Promise<ModelsByChannel> {
  const { data } = await request<ModelsByChannel>(ctx, options, '/api/models')
  if (!data || typeof data !== 'object') return {}
  const result: ModelsByChannel = {}
  for (const [type, models] of Object.entries(data)) {
    if (Array.isArray(models)) result[type] = models.filter((item): item is string => typeof item === 'string')
  }
  return result
}
