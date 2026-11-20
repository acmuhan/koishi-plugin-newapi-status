import { Context } from 'koishi'
import type { SiteStatus } from '../types'
import { ApiResponse, request, probe, ApiClientOptions } from './shared'

/** GET /api/status —— 无鉴权，站点基础信息与启用的模块开关 */
export function getSiteStatus(ctx: Context, options: ApiClientOptions) {
  return request<SiteStatus>(ctx, options, '/api/status', { authorization: null })
}

/** 探测站点可达性（不抛错） */
export function probeSite(ctx: Context, options: ApiClientOptions) {
  return probe(ctx, options, '/api/status')
}

export type SiteStatusResult = ApiResponse<SiteStatus>
