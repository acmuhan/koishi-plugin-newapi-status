import { Context } from 'koishi'
import { ApiClientOptions, request } from './shared'

/**
 * GET /api/notice、GET /api/about。
 * 注意：这两个接口的 data 是**裸字符串**（controller/misc.go: serveRevalidatedJSON），不是对象。
 */
export async function getNotice(ctx: Context, options: ApiClientOptions): Promise<string> {
  const { data } = await request<string>(ctx, options, '/api/notice', { authorization: null })
  return typeof data === 'string' ? data : ''
}

export async function getAbout(ctx: Context, options: ApiClientOptions): Promise<string> {
  const { data } = await request<string>(ctx, options, '/api/about', { authorization: null })
  return typeof data === 'string' ? data : ''
}
