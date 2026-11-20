import { Context } from 'koishi'
import type { SiteRoute } from '../types'
import { ApiClientOptions, ApiResponse, request } from './shared'

/**
 * 站点线路（/api/status 的 data.api_info）。
 * 官方前端用它给出「中国大陆 / 全球 / 备用」这类接入点，站内通常还会配 uptime_kuma；
 * 但实测很多站点 uptime/status 是空数组，api_info 反而是唯一有内容的网络视图。
 */
export async function getApiRoutes(ctx: Context, options: ApiClientOptions): Promise<ApiResponse<SiteRoute[]>> {
  const { data, latencyMs, status } = await request<{ api_info?: SiteRoute[] }>(ctx, options, '/api/status', {
    authorization: null,
  })
  const routes = Array.isArray(data?.api_info) ? data!.api_info! : []
  return {
    data: routes.filter(route => route && typeof route.url === 'string' && route.url.trim()),
    latencyMs,
    status,
  }
}

export interface RouteProbe {
  route: SiteRoute
  ok: boolean
  latencyMs: number
  error?: string
}

/**
 * 逐条探测线路的可达性与耗时。
 * 探的是线路根地址下的 /api/status（无鉴权），和 /newapi status 的口径一致。
 */
export async function probeRoutes(
  ctx: Context,
  options: ApiClientOptions,
  routes: SiteRoute[],
): Promise<RouteProbe[]> {
  return Promise.all(routes.map(async (route) => {
    const started = Date.now()
    try {
      await request(ctx, { ...options, baseUrl: route.url }, '/api/status', { authorization: null })
      return { route, ok: true, latencyMs: Date.now() - started }
    } catch (error) {
      return {
        route,
        ok: false,
        latencyMs: Date.now() - started,
        error: (error as Error)?.message,
      }
    }
  }))
}
