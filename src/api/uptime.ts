import { Context } from 'koishi'
import type { UptimeGroup } from '../types'
import { ApiClientOptions, request } from './shared'

/**
 * GET /api/uptime/status —— 无鉴权。
 * data 是 [{ categoryName, monitors: [{ name, uptime, status, group? }] }]，
 * status: 1 = up，0 = down；uptime 是 24h 可用率百分比。
 */
export async function getUptimeStatus(ctx: Context, options: ApiClientOptions): Promise<UptimeGroup[]> {
  const { data } = await request<UptimeGroup[]>(ctx, options, '/api/uptime/status', { authorization: null })
  if (!Array.isArray(data)) return []
  return data.map((group) => ({
    categoryName: group?.categoryName ?? '未分组',
    monitors: Array.isArray(group?.monitors) ? group.monitors : [],
  }))
}
