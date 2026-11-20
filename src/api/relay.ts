import { Context } from 'koishi'
import { NewApiError, resolveBaseUrl, sanitize } from './shared'

export interface RelayTestOptions {
  baseUrl: string
  /** sk- 开头的调用令牌（relay key）。面板 access_token 在这里无效。 */
  apiKey: string
  model: string
  prompt?: string
  maxTokens?: number
  timeout?: number
}

export interface RelayTestResult {
  ok: boolean
  model: string
  /** 第一个内容 delta 到达的耗时（毫秒），没有内容时等于总耗时 */
  firstTokenMs: number
  /** 请求全程耗时（毫秒） */
  totalMs: number
  status: number
  /** 服务端返回的前若干字符，失败时用于定位 */
  preview?: string
  error?: string
}

interface StreamChunk {
  choices?: Array<{
    delta?: { content?: string | null, reasoning_content?: string | null }
    message?: { content?: string | null }
  }>
}

/**
 * 取这一条 SSE 里的「首个有效增量」。
 * 推理模型（实测 deepseek-v4.1-flash）先吐 reasoning_content 再吐 content，
 * 只认 content 会把首 Token 耗时算成总耗时。
 */
function pickDelta(payload: StreamChunk): string {
  const choice = payload?.choices?.[0]
  const content = choice?.delta?.content
    ?? choice?.delta?.reasoning_content
    ?? choice?.message?.content
  return typeof content === 'string' ? content : ''
}

/**
 * 用 sk- 调用令牌发一条最短对话请求，测量总耗时与首 Token 耗时。
 * 走 relay 的 OpenAI 兼容端点 POST /v1/chat/completions（不是 /api/* 面板接口）。
 * token 只出现在请求头里，任何报错都会先 sanitize。
 */
/**
 * GET /v1/models —— relay 端点的模型清单，用 sk- 调用令牌即可读取（不需要面板 access_token）。
 * 这是「管理员禁用渠道」的可用观测口径：
 * 某个模型的渠道被全部禁用后，它会从这份清单里消失，重新启用后又会回来。
 */
export async function listRelayModels(
  ctx: Context,
  options: { baseUrl: string, apiKey: string, timeout?: number },
): Promise<{ ok: boolean, models: string[], status: number, error?: string }> {
  const url = resolveBaseUrl(options.baseUrl) + '/v1/models'
  try {
    const response = await ctx.http(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${options.apiKey}`, Accept: 'application/json' },
      timeout: options.timeout ?? 15000,
    })
    const payload = response.data as { data?: Array<{ id?: string }> } | undefined
    const models = (payload?.data ?? [])
      .map(item => (typeof item?.id === 'string' ? item.id : ''))
      .filter(Boolean)
    return { ok: true, models, status: response.status }
  } catch (error) {
    const status = (error as any)?.response?.status as number | undefined
    return {
      ok: false,
      models: [],
      status: status ?? 0,
      error: sanitize(String((error as Error)?.message ?? '请求失败'), options.apiKey),
    }
  }
}

export async function relayTest(ctx: Context, options: RelayTestOptions): Promise<RelayTestResult> {
  const url = resolveBaseUrl(options.baseUrl) + '/v1/chat/completions'
  const body = {
    model: options.model,
    messages: [{ role: 'user', content: options.prompt || 'hi' }],
    max_tokens: options.maxTokens ?? 16,
    stream: true,
  }
  const started = Date.now()
  let output = ''

  try {
    const response = await ctx.http(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      data: body,
      responseType: 'stream',
      timeout: options.timeout ?? 30000,
    })
    const status = response.status as number
    const stream = response.data as ReadableStream<Uint8Array> | undefined
    if (!stream) throw new NewApiError('上游没有返回响应体')

    let firstTokenMs = 0
    const decoder = new TextDecoder()
    let buffer = ''

    const consume = (text: string) => {
      buffer += text
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line || line.startsWith(':')) continue
        const payload = line.startsWith('data:') ? line.slice(5).trim() : line
        if (!payload || payload === '[DONE]' || !payload.startsWith('{')) continue
        try {
          const delta = pickDelta(JSON.parse(payload) as StreamChunk)
          if (!delta) continue
          if (!firstTokenMs) firstTokenMs = Date.now() - started
          output += delta
        } catch {
          // 忽略 SSE 心跳等非 JSON 行
        }
      }
    }

    const reader = (stream as any).getReader?.()
    if (reader) {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) consume(decoder.decode(value, { stream: true }))
      }
    } else {
      for await (const chunk of stream as any) consume(decoder.decode(chunk, { stream: true }))
    }
    consume(decoder.decode())

    const totalMs = Date.now() - started
    return {
      ok: true,
      model: options.model,
      firstTokenMs: firstTokenMs || totalMs,
      totalMs,
      status,
      preview: output.slice(0, 40) || undefined,
    }
  } catch (error) {
    const totalMs = Date.now() - started
    const status = (error as any)?.response?.status as number | undefined
    const raw = (error as any)?.response?.data
    const message = typeof raw === 'string' ? raw : (error as Error)?.message
    return {
      ok: false,
      model: options.model,
      firstTokenMs: totalMs,
      totalMs,
      status: status ?? 0,
      error: sanitize(String(message ?? '请求失败'), options.apiKey),
    }
  }
}
