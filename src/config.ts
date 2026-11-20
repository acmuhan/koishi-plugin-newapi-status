import { Schema } from 'koishi'
import type { LogLevelName } from './log'

/** 系统配置里预设的测试凭据 */
export interface TestPreset {
  /** 展示用的名称，指令里通过 -k/第二个参数引用 */
  keyId: string
  /** 上游调用令牌，必须是 sk- 开头的 relay key，不能填面板 access_token */
  key: string
  model: string
  group?: string
}

export interface MonitorConfig {
  enabled: boolean
  /** 巡检间隔（秒） */
  interval: number
  /** 若填写且宿主装有 koishi-plugin-cron，则改用 cron 表达式调度 */
  cron: string
  /** 接收告警的频道，形如 onebot:123456789 */
  channels: string[]
  /**
   * 盯模型用的 sk- 调用令牌。
   * 面板的 /api/channel 全部要求管理员权限，普通 access_token 拿不到渠道状态；
   * 但 relay 的 GET /v1/models 用 sk- 令牌就能读，渠道被禁用后模型会从清单里消失，
   * 所以「渠道级告警」用这份清单做差集轮询，不需要 AdminAuth。
   * 留空则只巡检站点可用性。
   */
  apiKey: string
  /** 需要重点盯的模型名；留空则监控整份 /v1/models 清单的任何变化 */
  models: string[]
  /** 连续失败多少次才告警，避免抖动 */
  threshold: number
}

export interface TestConfig {
  enabled: boolean
  model: string
  prompt: string
  maxTokens: number
  timeout: number
  presets: Record<string, Omit<TestPreset, 'keyId'>>
}

export interface Config {
  baseUrl: string
  accessToken: string
  userId: number
  commandPrefix: string
  timeout: number
  render: 'auto' | 'image' | 'text'
  noticeLimit: number
  perfHours: number
  healthHours: number
  healthThreshold: number
  /** 日志过滤档位：silent / error / info / debug（对应 reggol 的 0/1/2/3） */
  logLevel: LogLevelName
  /** 追加在 /newapi help 底部的自定义文本，留空则不追加 */
  helpText: string
  monitor: MonitorConfig
  test: TestConfig
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    baseUrl: Schema.string()
      .description('New API 站点地址，例如 https://api.example.com。只填到站点根即可；末尾误带的 /v1、/api 会被自动剥掉')
      .required(),
    accessToken: Schema.string()
      .role('secret')
      .description('面板 access_token 或 PAT。仅 group ratio、模型列表等需要登录的接口使用；**不要填 sk- 调用令牌**。')
      .default(''),
    userId: Schema.natural()
      .description('面板用户 ID，填了才会带上 New-Api-User 头。老版本 New API（v0.13 及以前）的鉴权接口要求这个头，不填会 401；v1.0 起可留 0。')
      .default(0),
    commandPrefix: Schema.string()
      .description('指令前缀，默认 newapi（即 /newapi status）。改成 api 就是 /api status。')
      .default('newapi'),
    timeout: Schema.natural()
      .description('单次 HTTP 请求超时（毫秒）')
      .default(10000),
    logLevel: Schema.union([
      Schema.const('silent').description('完全不输出'),
      Schema.const('error').description('只输出 success / error'),
      Schema.const('info').description('输出 success / error / info / warn（默认）'),
      Schema.const('debug').description('全部输出，含请求耗时等诊断细节'),
    ])
      .description('日志等级过滤。日志命名空间固定为 newapi-status，在 Koishi 控制台「日志」页按此过滤')
      .default('info'),
  }).description('基础设置'),

  Schema.object({
    render: Schema.union([
      Schema.const('auto').description('装有 puppeteer 就出图，否则出文本'),
      Schema.const('image').description('强制出图，缺 puppeteer 时报错'),
      Schema.const('text').description('强制纯文本'),
    ])
      .description('卡片渲染方式')
      .default('auto'),
    noticeLimit: Schema.natural()
      .description('公告 / 时间线最多展示条数')
      .default(3),
    perfHours: Schema.natural()
      .description('模型表现默认统计窗口（小时），上限 720')
      .default(24),
    healthHours: Schema.natural()
      .description('model health 使用的统计窗口（小时）。注意：New API 的 perf-metrics 只有小时级桶，拿不到分钟级')
      .default(1),
    healthThreshold: Schema.natural()
      .description('model health 的成功率阈值（0-100）')
      .default(95),
    helpText: Schema.string()
      .role('textarea')
      .description('追加在 /newapi help 输出底部的自定义文本，支持换行。留空则不追加')
      .default(''),
  }).description('展示设置'),

  Schema.object({
    monitor: Schema.object({
      enabled: Schema.boolean()
        .description('开启定时巡检：站点点不通会告警；配了 apiKey 还会对 /v1/models 做差集轮询，模型消失即告警')
        .default(false),
      interval: Schema.natural()
        .description('巡检间隔（秒），最小 30。想验证告警链路可以先改 60')
        .default(300),
      cron: Schema.string()
        .description('改用 cron 表达式调度（需安装 koishi-plugin-cron），留空则用固定间隔')
        .default(''),
      channels: Schema.array(Schema.string())
        .description('接收告警的频道，形如 onebot:123456789（需先在 Koishi 数据库里给频道设置 assignee）')
        .default([]),
      apiKey: Schema.string()
        .role('secret')
        .description('巡检用的 sk- 调用令牌（relay key）。填了才会做模型清单轮询；不能填面板 access_token')
        .default(''),
      models: Schema.array(Schema.string())
        .description('重点盯的模型名；留空则监控整份 /v1/models 清单，任何模型消失都告警')
        .default([]),
      threshold: Schema.natural()
        .description('连续异常多少次才发告警')
        .default(2),
    }).description('定时巡检'),
  }).description('巡检设置'),

  Schema.object({
    test: Schema.object({
      enabled: Schema.boolean()
        .description('开启 /newapi test 连通性测试。默认关闭，避免未配置 key 的站点误触')
        .default(false),
      model: Schema.string()
        .description('未指定模型时使用的默认模型')
        .default('gpt-4o-mini'),
      prompt: Schema.string()
        .description('测试用最短提示词')
        .default('hi'),
      maxTokens: Schema.natural()
        .description('测试请求的 max_tokens')
        .default(16),
      timeout: Schema.natural()
        .description('测试请求超时（毫秒）')
        .default(30000),
      presets: Schema.dict(
        Schema.object({
          key: Schema.string()
            .role('secret')
            .description('sk- 开头的调用令牌（relay key），不是面板 access_token')
            .required(),
          model: Schema.string().description('该 key 默认使用的模型'),
          group: Schema.string().description('备注用分组名'),
        }),
      )
        .description('预设凭据：keyId → { key, model, group }。指令里用 keyId 引用，避免把 key 打在聊天记录里。')
        .default({}),
    }).description('连通性测试'),
  }).description('测试设置'),
])
