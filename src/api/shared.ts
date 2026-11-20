import { Context } from 'koishi'
import type { ApiEnvelope } from '../types'

/** 站点 URL 归一化：去掉尾部斜杠，补全协议 */
export function resolveBaseUrl(input: string): string {
  let url = (input || '').trim()
  if (!url) throw new NewApiError('未配置 baseUrl：请在插件配置里填写 New API 站点地址')
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url
  return url.replace(/\/+$/, '')
}

/**
 * 把令牌从任意文本里抹掉。所有对外报错、日志、卡片都必须先过这一层，
 * 保证 access_token / PAT / sk- 调用令牌不会泄漏。
 */
export function sanitize(message: string, ...secrets: Array<string | undefined>): string {
  let text = message ?? ''
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue
    text = text.split(secret).join(`${secret.slice(0, 3)}***${secret.slice(-2)}`)
  }
  return text.replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer ***')
}

export class NewApiError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message)
    this.name = 'NewApiError'
  }
}

export interface ApiClientOptions {
  baseUrl: string
  token?: string
  /**
   * 面板用户 ID。老版本 New API（v0.13 及以前）的 UserAuth / AdminAuth 除了
   * Authorization 之外还强制要求 `New-Api-User` 头，且必须等于令牌所属用户 ID；
   * 不带会直接 401「未提供 New-Api-User」。v1.0.0-rc 起该头不再被读取，带上也无副作用。
   */
  userId?: number
  timeout?: number
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST'
  query?: Record<string, string | number | boolean | string[] | null | undefined>
  body?: unknown
  /** 传入则覆盖默认令牌；传 null 表示本次不带 Authorization */
  authorization?: string | null
  timeout?: number
  /** 以 ReadableStream 形式返回原始响应体（relay 流式测试用） */
  stream?: boolean
  /**
   * 返回整个响应体而不是 envelope.data。
   * 用于 /api/pricing 这类「业务数据与 data 同级」的接口：
   * 它的 vendors / group_ratio / usable_group 都在 success 旁边，不是 data 的字段。
   */
  raw?: boolean
}

export interface ApiResponse<T> {
  data: T
  latencyMs: number
  status: number
}

const STATUS_HINT: Record<number, string> = {
  401: '鉴权失败：access_token / PAT 无效或已过期',
  403: '权限不足：该接口未对外开放，或令牌缺少对应 scope',
  404: '接口不存在：请确认 baseUrl 指向 New API 站点根路径',
  429: '请求过于频繁：站点限流中',
}

/**
 * 统一请求入口。所有 New API 面板接口都走这里：
 * 强制 JSON、记录耗时、把 HTTP 状态映射成人能看懂的中文提示，且不泄漏令牌。
 */
export async function request<T = unknown>(
  ctx: Context,
  options: ApiClientOptions,
  path: string,
  req: ApiRequestOptions = {},
): Promise<ApiResponse<T>> {
  const url = resolveBaseUrl(options.baseUrl) + path
  const headers: Record<string, string> = { Accept: 'application/json' }
  const token = req.authorization === null ? undefined : (req.authorization ?? options.token)
  if (token) headers.Authorization = `Bearer ${token}`
  // 老版本 New API 的鉴权中间件会校验这个头，缺失直接 401
  if (options.userId && options.userId > 0) headers['New-Api-User'] = String(options.userId)

  const started = Date.now()
  try {
    const response = await ctx.http(url, {
      method: req.method ?? 'GET',
      params: req.query as any,
      headers,
      data: req.body as any,
      responseType: req.stream ? 'stream' : undefined,
      timeout: req.timeout ?? options.timeout ?? 10000,
    })
    const latencyMs = Date.now() - started
    if (req.stream) {
      return { data: response.data as T, latencyMs, status: response.status }
    }
    const payload = response.data as ApiEnvelope<T>
    if (payload && typeof payload === 'object' && 'success' in payload && payload.success === false) {
      throw new NewApiError(sanitize(payload.message || '接口返回失败', options.token), response.status)
    }
    if (req.raw) return { data: payload as T, latencyMs, status: response.status }
    const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : (payload as T)
    return { data, latencyMs, status: response.status }
  } catch (error) {
    if (error instanceof NewApiError) throw error
    const status = (error as any)?.response?.status as number | undefined
    const body = (error as any)?.response?.data
    const serverMessage = typeof body === 'string'
      ? body
      : (body && typeof body === 'object' ? (body.message || body.error?.message) : undefined)
    const hint = status ? STATUS_HINT[status] : undefined
    const detail = serverMessage ? String(serverMessage) : (error as Error)?.message
    const message = [hint, detail].filter(Boolean).join(' | ') || '请求失败'
    throw new NewApiError(sanitize(message, options.token), status)
  }
}

/** 探测某个接口的可达性与耗时，不抛错（status 指令用） */
export async function probe(
  ctx: Context,
  options: ApiClientOptions,
  path: string,
): Promise<{ ok: boolean, latencyMs: number, error?: string }> {
  const started = Date.now()
  try {
    await request(ctx, options, path, { authorization: null })
    return { ok: true, latencyMs: Date.now() - started }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof NewApiError ? error.message : sanitize(String(error), options.token),
    }
  }
}
