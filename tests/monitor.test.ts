
/**
 * 巡检告警 / 恢复：
 * 不启动真实定时器，直接驱动 createMonitor().check()，
 * 通过拦截 MockBot.sendMessage 捕获 ctx.broadcast 发出的内容。
 *
 * 覆盖两条口径：
 * 1) 站点可用性 —— 探无需鉴权的 /api/status；
 * 2) 模型/渠道状态 —— 用 sk- 调用令牌读 GET /v1/models 做差集轮询
 *    （面板 /api/channel/* 全挂在 AdminAuth 后面，普通令牌拿不到，这是唯一可行的替代口径）。
 */
import { App } from 'koishi'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as plugin from '../src'
import { createMonitor, normalizeChannels } from '../src/monitor'

const httpPlugin = (require('@koishijs/plugin-http') as any).default
const memoryPlugin = (require('@koishijs/plugin-database-memory') as any).default
const mockPlugin = (require('@koishijs/plugin-mock') as any).default

let online = true
let modelList = ['deepseek-v4.1-flash', 'claude-3-5-sonnet', 'gpt-5.5']
let modelsAuthorized = true
let server: ReturnType<typeof createServer>
let app: App
let sent: { channelId: string, content: string }[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/v1/models')) {
      if (!modelsAuthorized) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'invalid token', type: 'auth_error' } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        object: 'list',
        data: modelList.map(id => ({ id, object: 'model' })),
      }))
      return
    }
    if (!online) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, message: 'service unavailable' }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      success: true,
      data: { version: '0.8.7', start_time: Math.floor(Date.now() / 1000) - 3600, system_name: 'Neko API' },
    }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  app = new App({ prefix: ['/', ''], autoAssign: false })
  app.plugin(memoryPlugin)
  app.plugin(mockPlugin)
  app.plugin(httpPlugin)
  app.plugin(plugin, {
    baseUrl: 'http://127.0.0.1:' + (server.address() as any).port,
    accessToken: '',
    render: 'text',
    timeout: 3000,
    monitor: { enabled: false, interval: 60, cron: '', channels: ['mock:200'], apiKey: '', models: [], threshold: 1 },
    test: { enabled: false, model: 'gpt-4o-mini', prompt: 'hi', maxTokens: 16, timeout: 3000, presets: {} },
  })
  await app.start()
  await app.mock.initUser('admin', 3)
  await app.mock.initChannel('200')
  const bot = app.bots[0]
  bot.sendMessage = (async (channelId: string, fragment: any) => {
    sent.push({ channelId, content: String(fragment) })
    return [String(sent.length)]
  }) as any
})

afterAll(async () => {
  await app?.stop()
  server?.close()
})

function monitorConfig(apiKey = '') {
  return {
    baseUrl: 'http://127.0.0.1:' + (server.address() as any).port,
    accessToken: '',
    timeout: 3000,
    monitor: { enabled: false, interval: 60, cron: '', channels: ['mock:200'], apiKey, models: [], threshold: 1 },
  } as any
}

function alerts(keyword: string) {
  return sent.filter(item => item.content.includes(keyword))
}

describe('定时巡检告警与恢复', () => {
  it('normalizeChannels 去掉空白项', () => {
    expect(normalizeChannels([' mock:200 ', '', '   '])).toEqual(['mock:200'])
  })

  it('站点不可用 → 告警一次；恢复 → 恢复通知一次', async () => {
    sent = []
    online = true
    const handle = createMonitor(app as any, monitorConfig(), ['mock:200'])
    await handle.check()
    expect(handle.state.online).toBe(true)
    expect(alerts('无法访问')).toHaveLength(0)

    online = false
    await handle.check()
    expect(handle.state.online).toBe(false)
    expect(handle.state.failures).toBe(1)
    expect(alerts('无法访问')).toHaveLength(1)
    expect(sent.at(-1)?.channelId).toBe('200')

    // 持续不可用不重复告警
    await handle.check()
    await handle.check()
    expect(handle.state.failures).toBe(3)
    expect(alerts('无法访问')).toHaveLength(1)

    online = true
    await handle.check()
    expect(handle.state.online).toBe(true)
    expect(handle.state.failures).toBe(0)
    expect(alerts('已恢复访问')).toHaveLength(1)

    // 再次可用时不再重复恢复通知
    await handle.check()
    expect(alerts('已恢复访问')).toHaveLength(1)
  })

  it('未配置 monitor.apiKey 时不做模型轮询', async () => {
    sent = []
    online = true
    const handle = createMonitor(app as any, monitorConfig(''), ['mock:200'])
    await handle.check()
    expect(handle.state.models).toBeNull()
    expect(sent).toHaveLength(0)
  })

  it('首次巡检只建基线，不告警', async () => {
    sent = []
    online = true
    modelList = ['deepseek-v4.1-flash', 'claude-3-5-sonnet', 'gpt-5.5']
    const handle = createMonitor(app as any, monitorConfig('sk-test-key'), ['mock:200'])
    await handle.check()
    expect(handle.state.models).toEqual(['claude-3-5-sonnet', 'deepseek-v4.1-flash', 'gpt-5.5'])
    expect(sent).toHaveLength(0)
  })

  it('模型从 /v1/models 消失 → 告警；恢复 → 恢复通知', async () => {
    sent = []
    online = true
    modelList = ['deepseek-v4.1-flash', 'claude-3-5-sonnet', 'gpt-5.5']
    const handle = createMonitor(app as any, monitorConfig('sk-test-key'), ['mock:200'])
    await handle.check()
    expect(sent).toHaveLength(0)

    // 管理员在后台禁用了 gpt-5.5 的渠道 → 它从 /v1/models 消失
    modelList = ['deepseek-v4.1-flash', 'claude-3-5-sonnet']
    await handle.check()
    const gone = alerts('消失')
    expect(gone).toHaveLength(1)
    expect(gone[0].content).toContain('gpt-5.5')
    expect(gone[0].channelId).toBe('200')
    expect(handle.state.missing).toEqual(['gpt-5.5'])

    // 持续缺失不重复告警
    await handle.check()
    expect(alerts('消失')).toHaveLength(1)

    // 重新启用渠道 → 模型回到清单
    modelList = ['deepseek-v4.1-flash', 'claude-3-5-sonnet', 'gpt-5.5']
    await handle.check()
    const back = alerts('恢复可用')
    expect(back).toHaveLength(1)
    expect(back[0].content).toContain('gpt-5.5')
    expect(handle.state.missing).toEqual([])
  })

  it('配了 monitor.models 时只盯这些模型', async () => {
    sent = []
    online = true
    modelList = ['deepseek-v4.1-flash', 'claude-3-5-sonnet', 'gpt-5.5']
    const config = monitorConfig('sk-test-key')
    config.monitor.models = ['claude-3-5-sonnet']
    const handle = createMonitor(app as any, config, ['mock:200'])
    await handle.check()

    // 只掉了一个不关心的模型，不该打扰用户
    modelList = ['claude-3-5-sonnet', 'gpt-5.5']
    await handle.check()
    expect(alerts('消失')).toHaveLength(0)

    modelList = ['gpt-5.5']
    await handle.check()
    expect(alerts('消失')).toHaveLength(1)
    expect(alerts('消失')[0].content).toContain('claude-3-5-sonnet')
  })

  it('/v1/models 鉴权失败时不误报模型消失', async () => {
    sent = []
    online = true
    modelList = ['deepseek-v4.1-flash']
    const handle = createMonitor(app as any, monitorConfig('sk-test-key'), ['mock:200'])
    await handle.check()
    expect(handle.state.models).toEqual(['deepseek-v4.1-flash'])

    modelsAuthorized = false
    await handle.check()
    expect(alerts('消失')).toHaveLength(0)
    // 保留旧快照，恢复鉴权后差集仍然正确
    expect(handle.state.models).toEqual(['deepseek-v4.1-flash'])
    modelsAuthorized = true
  })
})
