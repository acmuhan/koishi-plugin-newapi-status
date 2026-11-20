/**
 * 端到端测试：起一个假的 New API 站点，把插件装进真实的 Koishi App，
 * 通过 @koishijs/plugin-mock 走完整消息管线（middleware → 指令解析 → 权限门控 → action → 发送），
 * 断言最终回复文本。验证的是「指令注册 + 接口调用 + 渲染降级 + 权限」整条链路。
 */
import { App } from 'koishi'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Logger } from 'koishi'
import * as plugin from '../src'
import { LOGGER_NAME, LOG_LEVELS, LOG_METHODS } from '../src/log'
import { relayTest, resolveBaseUrl } from '../src/api'

/** CJS 互操作：这些包的插件本体都在 default 上 */
const httpPlugin = (require('@koishijs/plugin-http') as any).default
const memoryPlugin = (require('@koishijs/plugin-database-memory') as any).default
const mockPlugin = (require('@koishijs/plugin-mock') as any).default
// plugin-help 的产物用命名导出（apply/name/Config），没有 default
const helpPlugin = require('@koishijs/plugin-help')

const now = Math.floor(Date.now() / 1000)

const SITE = {
  status: {
    success: true,
    data: {
      version: '0.8.7',
      start_time: now - 86400 * 12 - 3600 * 4 - 60 * 18,
      system_name: 'Neko API',
      announcements: JSON.stringify(['11-19 全站 Claude 模型已切换至 4.5 渠道，倍率不变。', '11-18 维护完成，账单补发已到账。']),
      announcements_enabled: true,
      uptime_kuma_enabled: true,
      quota_per_unit: 500000,
      display_in_currency: false,
    },
  },
  routesEnabled: true,
  pricing: {
    success: true,
    data: [
      { model_name: 'claude-3-5-sonnet', quota_type: 0, model_ratio: 1, model_price: 0, completion_ratio: 5, enable_groups: ['default', 'svip'], vendor_id: 1 },
      { model_name: 'gpt-4o-mini', quota_type: 0, model_ratio: 0.5, model_price: 0, completion_ratio: 4, enable_groups: ['default'], vendor_id: 2 },
      { model_name: 'dall-e-3', quota_type: 1, model_ratio: 0, model_price: 0.04, completion_ratio: 1, enable_groups: ['default'], vendor_id: 2 },
    ],
    vendors: [{ id: 1, name: 'Anthropic' }, { id: 2, name: 'OpenAI' }],
    group_ratio: { default: 1, svip: 0.7, auto: 0.85 },
    usable_group: { default: '默认分组', svip: '高级会员 7 折' },
    supported_endpoint: {},
    auto_groups: ['auto'],
  },
  perf: {
    success: true,
    data: {
      model_name: 'claude-3-5-sonnet',
      series_schema: 'dbcd0a3c01b55203',
      summary: { avg_latency_ms: 2310, success_rate: 99.1, avg_tps: 42.5 },
      series: Array.from({ length: 6 }, (_, i) => ({
        ts: now - (5 - i) * 3600,
        avg_ttft_ms: 640,
        avg_latency_ms: 2310,
        success_rate: i === 3 ? 90 : 99.5,
        avg_tps: 42.5,
      })),
      window_start: now - 5 * 3600,
      window_end: now,
      groups: [
        { group: 'default', avg_ttft_ms: 640, avg_latency_ms: 2310, success_rate: 99.1, avg_tps: 42.5, series: [] },
        { group: 'svip', avg_ttft_ms: 520, avg_latency_ms: 1800, success_rate: 96.4, avg_tps: 48.1, series: [] },
      ],
    },
  },
  perfSummary: {
    success: true,
    data: {
      summary: { avg_latency_ms: 2100, success_rate: 98.6, avg_tps: 40 },
      window_start: now - 3600,
      window_end: now,
      models: [
        { model_name: 'claude-3-5-sonnet', avg_latency_ms: 2310, success_rate: 99.1, avg_tps: 42.5, recent_success_series: [{ ts: now - 3600, success_rate: 99.1 }] },
        { model_name: 'gpt-4o-mini', avg_latency_ms: 900, success_rate: 88.2, avg_tps: 60, recent_success_series: [{ ts: now - 3600, success_rate: 88.2 }] },
      ],
      recent_success_series: { 'claude-3-5-sonnet': [{ ts: now - 3600, success_rate: 99.1 }] },
    },
  },
  uptime: {
    success: true,
    data: [
      { categoryName: '主力', monitors: [{ name: 'API 网关', uptime: 99.94, status: 1, group: 'prod' }, { name: '备用线路', uptime: 87.2, status: 0, group: 'backup' }] },
    ],
  },
  /**
   * /api/status 的 api_info：真实站点实测就是这个结构（线路名 / 颜色 / 地址 / 说明）。
   * url 里的 {{BASE}} 在响应时替换成假站点地址，这样「Global 线路」是真能探通的。
   */
  routes: [
    { id: 2, route: 'Global', url: '{{BASE}}', color: 'yellow', description: 'CloudFlare NetWorks' },
    { id: 1, route: 'China', url: 'http://127.0.0.1:1', color: 'red', description: '中国大陆使用' },
    { id: 3, route: 'Empty', url: '', color: 'yellow', description: '没有地址的线路要被过滤掉' },
  ],
  /** /api/ratio_config：全站倍率字典，比 /api/pricing 更全 */
  ratioConfig: {
    success: true,
    data: {
      model_ratio: { 'claude-3-5-sonnet': 1, 'gpt-4o-mini': 0.5, 'hidden-model': 2 },
      completion_ratio: { 'claude-3-5-sonnet': 5, 'gpt-4o-mini': 4, 'hidden-model': 1 },
      cache_ratio: { 'claude-3-5-sonnet': 0.1 },
      create_cache_ratio: {},
      model_price: {},
      billing_mode: {},
      billing_expr: {},
    },
  },
  relayModels: { object: 'list', data: [{ id: 'claude-3-5-sonnet' }, { id: 'gpt-4o-mini' }] },
  notice: '第一条公告\n第二条公告',
  about: '这是一个用于测试的 New API 站点。',
}

const HELP_TEXT = '自定义帮助底部：遇到问题请到仓库提 issue。'

const baseConfig = {
  accessToken: '',
  userId: 0,
  timeout: 5000,
  render: 'text' as const,
  noticeLimit: 3,
  perfHours: 24,
  healthHours: 1,
  healthThreshold: 95,
  logLevel: 'error' as const,
  helpText: HELP_TEXT,
  monitor: { enabled: false, interval: 300, cron: '', channels: [], apiKey: '', models: [], threshold: 2 },
  test: { enabled: false, model: 'gpt-4o-mini', prompt: 'hi', maxTokens: 16, timeout: 5000, presets: {} },
}

let server: ReturnType<typeof createServer>
let app: App
/** 记录 /api/pricing 最近一次收到的请求头，用于断言 New-Api-User / Authorization */
let lastPricingHeaders: Record<string, any> = {}
/** 假站点地址，beforeAll 里确定 */
let baseUrl = ''

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname === '/api/pricing') lastPricingHeaders = req.headers
    const send = (body: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    switch (url.pathname) {
      case '/api/status': return send(SITE.routesEnabled
        ? {
          ...SITE.status,
          data: {
            ...SITE.status.data,
            api_info: SITE.routes.map(route => ({ ...route, url: route.url.replace('{{BASE}}', baseUrl) })),
          },
        }
        : SITE.status)
      case '/api/ratio_config': return send(SITE.ratioConfig)
      case '/v1/models': return send(SITE.relayModels)
      case '/api/pricing': return send(SITE.pricing)
      case '/api/perf-metrics': return send(SITE.perf)
      case '/api/perf-metrics/summary': return send(SITE.perfSummary)
      case '/api/uptime/status': return send(SITE.uptime)
      case '/api/notice': return send({ success: true, data: SITE.notice })
      case '/api/about': return send({ success: true, data: SITE.about })
      default:
        res.writeHead(404, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ success: false, message: 'not found' }))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

  app = new App({ prefix: ['/', ''], autoAssign: false })
  app.plugin(helpPlugin)
  app.plugin(memoryPlugin)
  app.plugin(mockPlugin)
  app.plugin(httpPlugin)
  app.plugin(plugin, { ...baseConfig, baseUrl, commandPrefix: 'newapi' } as any)
  await app.start()
  // 3 级用户才能调用 /newapi test；1 级用户用来验证权限拒绝
  await app.mock.initUser('admin', 3)
  await app.mock.initUser('guest', 1)
  await app.mock.initChannel('200')
})

afterAll(async () => {
  await app?.stop()
  await new Promise<void>((resolve) => server?.close(() => resolve()))
})

/** 走真实消息管线：user 发一句话，收集机器人回复的文本 */
async function run(input: string, user = 'admin'): Promise<string> {
  const replies = await app.mock.client(user, '200').receive(input)
  return replies.join('\n')
}

describe('指令注册', () => {
  const names = [
    'newapi',
    'newapi.help',
    'newapi.status',
    'newapi.notice',
    'newapi.about',
    'newapi.model',
    'newapi.model.search',
    'newapi.model.list',
    'newapi.model.status',
    'newapi.model.health',
    'newapi.group',
    'newapi.group.ratio',
    'newapi.group.status',
    'newapi.group.search',
    'newapi.network',
    'newapi.test',
  ]

  it('全部指令都已注册', () => {
    for (const name of names) {
      expect(app.$commander.get(name), `缺少指令 ${name}`).toBeTruthy()
    }
  })

  it('前缀可以改（api.* / nekoapi.*）', () => {
    expect(plugin.normalizePrefix('api')).toEqual(['api'])
    expect(plugin.normalizePrefix('/nekoapi.*')).toEqual(['nekoapi'])
    expect(plugin.normalizePrefix('   ')).toEqual(['newapi'])
    expect(plugin.normalizePrefix('api, nekoapi')).toEqual(['api', 'nekoapi'])
  })
})

describe('指令输出', () => {
  it('/newapi help 走 Koishi help，并在末尾追加自定义文本', async () => {
    const text = await run('/newapi help')
    // 正文来自 @koishijs/plugin-help：标题 + 用法 + 子指令清单都是一层层列
    expect(text).toContain('指令：newapi')
    expect(text).toContain('/newapi status')
    expect(text).toContain('/newapi model')
    expect(text).toContain('/newapi test')
    // 自定义底部文本必须真的在最后
    expect(text.trimEnd().endsWith(HELP_TEXT)).toBe(true)
  })

  it('/newapi（根命令）同样走 Koishi help', async () => {
    const text = await run('/newapi')
    expect(text).toContain('/newapi status')
    expect(text.trimEnd().endsWith(HELP_TEXT)).toBe(true)
  })

  it('/newapi model（子命令根）展示自己的子指令', async () => {
    const text = await run('/newapi model')
    expect(text).toContain('/newapi model status')
    expect(text.trimEnd().endsWith(HELP_TEXT)).toBe(true)
  })

  it('/newapi status 带站点信息', async () => {
    const text = await run('/newapi status')
    expect(text).toContain('Neko API')
    expect(text).toContain('v0.8.7')
    expect(text).toContain('/api/status')
    expect(text).toContain('可访问')
  })

  it('/newapi notice 输出公告', async () => {
    const text = await run('/newapi notice')
    expect(text).toContain('Claude')
    expect(text).toContain('公告与时间线')
  })

  it('/newapi about 输出插件信息', async () => {
    const text = await run('/newapi about')
    expect(text).toContain('koishi-plugin-newapi-status')
    expect(text).toContain('站点关于')
  })

  it('/newapi model search 模糊匹配', async () => {
    const text = await run('/newapi model search claude')
    expect(text).toContain('claude-3-5-sonnet')
    expect(text).not.toContain('gpt-4o-mini')
  })

  it('/newapi model list 列出全部模型', async () => {
    const text = await run('/newapi model list')
    expect(text).toContain('claude-3-5-sonnet')
    expect(text).toContain('gpt-4o-mini')
  })

  it('/newapi model list 按供应商过滤', async () => {
    const text = await run('/newapi model list Anthropic')
    expect(text).toContain('claude-3-5-sonnet')
    expect(text).not.toContain('gpt-4o-mini')
  })

  it('/newapi model status 带成功率与延迟', async () => {
    const text = await run('/newapi model status claude-3-5-sonnet')
    expect(text).toContain('99.10%')
    expect(text).toContain('2.31s')
    expect(text).toContain('default')
    expect(text).toContain('svip')
    expect(text).toContain('🟩')
  })

  it('/newapi model status 支持 -t 与 -g', async () => {
    const text = await run('/newapi model status claude-3-5-sonnet -t 6 -g default')
    expect(text).toContain('近 6 小时')
    expect(text).toContain('default')
  })

  it('/newapi model health 只保留达标模型', async () => {
    const text = await run('/newapi model health')
    expect(text).toContain('claude-3-5-sonnet')
    expect(text).not.toContain('gpt-4o-mini')
  })

  it('/newapi group 列出倍率', async () => {
    const text = await run('/newapi group')
    expect(text).toContain('default')
    expect(text).toContain('1.00×')
    expect(text).toContain('0.70×')
  })

  it('/newapi group ratio 模型倍率', async () => {
    const text = await run('/newapi group ratio claude')
    expect(text).toContain('模型 1.00×')
    expect(text).toContain('补全 5.00×')
  })

  it('/newapi group ratio 用 ratio_config 兜底 pricing 缺失的模型', async () => {
    const text = await run('/newapi group ratio hidden')
    // pricing 里没有 hidden-model，只有公开的 /api/ratio_config 有
    expect(text).toContain('hidden-model')
    expect(text).toContain('模型 2.00×')
    expect(text).toContain('补全 1.00×')
  })

  it('/newapi group ratio 查不到时给出可读空态', async () => {
    const text = await run('/newapi group ratio not-a-real-model')
    expect(text).toContain('定价表')
    expect(text).toContain('没有')
  })

  it('/newapi group status 未指定分组时全部', async () => {
    const text = await run('/newapi group status')
    expect(text).toContain('全部分组')
  })

  it('/newapi group search 模糊匹配', async () => {
    const text = await run('/newapi group search svip')
    expect(text).toContain('svip')
  })

  it('/newapi network 优先用 api_info 线路并实测可达性', async () => {
    const text = await run('/newapi network')
    // 空 url 的第 3 条被过滤，只剩 Global / China 两条
    expect(text).toContain('站点线路')
    expect(text).toContain('Global')
    expect(text).toContain('China')
    expect(text).not.toContain('Empty')
    expect(text).toContain('1/2 在线')
    expect(text).toContain('在线')
    expect(text).toContain('不可达')
  })

  it('/newapi network 可按线路名过滤', async () => {
    const text = await run('/newapi network china')
    expect(text).toContain('China')
    expect(text).not.toContain('Global')
  })

  it('/newapi network 没有 api_info 时退回 Uptime Kuma', async () => {
    SITE.routesEnabled = false
    try {
      const text = await run('/newapi network')
      expect(text).toContain('API 网关')
      expect(text).toContain('备用线路')
      expect(text).toContain('1/2 在线')
    } finally {
      SITE.routesEnabled = true
    }
  })

  it('/newapi test list 列出预设', async () => {
    const text = await run('/newapi test list')
    expect(text).toContain('还没有配置 test.presets')
  })

  it('/newapi test 未开启时给出明确提示', async () => {
    const text = await run('/newapi test gpt-4o-mini sk-abcdefghijklmn')
    expect(text).toContain('测试功能未开启')
    // 令牌不能出现在回复里
    expect(text).not.toContain('sk-abcdefghijklmn')
  })
})

describe('权限门控', () => {
  it('低权限用户 /newapi test 被拒绝', async () => {
    const text = await run('/newapi test gpt-4o-mini sk-abcdefghijklmn', 'guest')
    expect(text).toContain('权限不足')
    expect(text).not.toContain('sk-abcdefghijklmn')
  })

  it('低权限用户仍可使用只读指令', async () => {
    const text = await run('/newapi status', 'guest')
    expect(text).toContain('Neko API')
  })
})

describe('鉴权头', () => {
  it('配了 userId 就带 New-Api-User，配了令牌就带 Bearer', async () => {
    const secured = new App({ prefix: ['/', ''], autoAssign: false })
    secured.plugin(memoryPlugin)
    secured.plugin(mockPlugin)
    secured.plugin(httpPlugin)
    secured.plugin(plugin, {
      ...baseConfig,
      baseUrl,
      accessToken: 'panel-token-abc',
      userId: 7,
      commandPrefix: 'auth',
    } as any)
    await secured.start()
    try {
      await secured.mock.initUser('admin', 3)
      await secured.mock.initChannel('200')
      await secured.mock.client('admin', '200').receive('/auth model list')
      // v0.13 及以前的 UserAuth 要求这个头，缺了直接 401
      expect(String(lastPricingHeaders['new-api-user'])).toBe('7')
      expect(String(lastPricingHeaders.authorization)).toBe('Bearer panel-token-abc')
    } finally {
      await secured.stop()
    }
  })

  it('userId 为 0 时不发 New-Api-User', async () => {
    lastPricingHeaders = {}
    await run('/newapi model list')
    expect(lastPricingHeaders['new-api-user']).toBeUndefined()
  })
})

describe('异常处理', () => {
  it('站点不可用时仍返回可读结果，且不泄漏令牌', async () => {
    const broken = new App({ prefix: ['/', ''], autoAssign: false })
    broken.plugin(memoryPlugin)
    broken.plugin(mockPlugin)
    broken.plugin(httpPlugin)
    broken.plugin(plugin, {
      ...baseConfig,
      baseUrl: 'http://127.0.0.1:1',
      accessToken: 'secret-token-should-not-leak',
      commandPrefix: 'broken',
      timeout: 2000,
    } as any)
    await broken.start()
    try {
      await broken.mock.initUser('admin', 3)
      await broken.mock.initChannel('200')
      const replies = await broken.mock.client('admin', '200').receive('/broken status')
      const text = replies.join('\n')
      expect(text).toBeTruthy()
      expect(text).not.toContain('secret-token-should-not-leak')
    } finally {
      await broken.stop()
    }
  })
})
describe('baseUrl 归一化', () => {
  it('只剥末尾的 /v1、/api，保留真实子路径', () => {
    expect(resolveBaseUrl('https://a.example.com/v1')).toBe('https://a.example.com')
    expect(resolveBaseUrl('https://a.example.com/api/')).toBe('https://a.example.com')
    expect(resolveBaseUrl('https://a.example.com/newapi/v1')).toBe('https://a.example.com/newapi')
    expect(resolveBaseUrl('a.example.com')).toBe('https://a.example.com')
    expect(resolveBaseUrl('https://a.example.com/')).toBe('https://a.example.com')
  })

  it('404 时给出可执行的排查方向，且不泄漏令牌', async () => {
    const key = 'sk-test-1234567890'
    const result = await relayTest(app as any, {
      baseUrl: baseUrl + '/v1',
      apiKey: key,
      model: 'gpt-4o-mini',
      timeout: 3000,
    })
    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
    expect(result.error).toContain('baseUrl 只填站点根地址')
    expect(result.error).not.toContain(key)
  })
})

describe('5 等级日志', () => {
  it('命名空间注册给 Koishi，且 5 个等级方法齐备', () => {
    expect(Logger.levels[LOGGER_NAME]).toBe(Logger.ERROR)
    const logger = app.logger(LOGGER_NAME)
    for (const method of LOG_METHODS) {
      expect(typeof (logger as any)[method], method).toBe('function')
    }
  })

  it('档位映射与 reggol 常量一致', () => {
    expect(LOG_LEVELS.silent).toBe(Logger.SILENT)
    expect(LOG_LEVELS.error).toBe(Logger.ERROR)
    expect(LOG_LEVELS.info).toBe(Logger.INFO)
    expect(LOG_LEVELS.debug).toBe(Logger.DEBUG)
  })
})

describe('未安装 @koishijs/plugin-help 时的回退', () => {
  it('/bare help 回退到内置清单，仍追加自定义文本', async () => {
    const bare = new App({ prefix: ['/', ''], autoAssign: false })
    bare.plugin(memoryPlugin)
    bare.plugin(mockPlugin)
    bare.plugin(httpPlugin)
    bare.plugin(plugin, { ...baseConfig, baseUrl, commandPrefix: 'bare' } as any)
    await bare.start()
    try {
      await bare.mock.initUser('admin', 3)
      await bare.mock.initChannel('200')
      const text = (await bare.mock.client('admin', '200').receive('/bare help')).join('\n')
      expect(text).toContain('bare model status')
      expect(text.trimEnd().endsWith(HELP_TEXT)).toBe(true)
    } finally {
      await bare.stop()
    }
  })
})
