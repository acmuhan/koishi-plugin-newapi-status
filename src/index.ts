import { Context, h } from 'koishi'
import type { Config as PluginConfig } from './config'
import { Config as ConfigSchema } from './config'
import {
  MAX_PERF_HOURS,
  NewApiError,
  getAbout,
  getNotice,
  getApiRoutes,
  getPerfMetrics,
  getPerfMetricsSummary,
  getPricing,
  getRatioConfig,
  getSiteStatus,
  getUptimeStatus,
  probeRoutes,
  probeSite,
  relayTest,
  sanitize,
  summarizeSeries,
} from './api'
import type { ApiClientOptions } from './api'
import type { PerfModelSummary, PricingResponse, SiteStatus } from './types'
import {
  classifyLatency,
  classifySuccessRate,
  formatClock,
  formatLatency,
  formatRatio,
  formatSuccessRate,
  parseAnnouncements,
} from './format'
import { createLogger } from './log'
import { startMonitor } from './monitor'
import { renderCard, renderList } from './render'
import type { RenderOptions } from './render'
import { renderError, renderHelp } from './text'
import {
  buildModelList,
  buildModelStatusCard,
  buildRouteList,
  buildStatusCard,
  buildUptimeList,
  collectAnnouncements,
  hostOf,
  pricingModels,
} from './view'
import type { ListRowView, ListView, ViewContext } from './view'

export const name = 'newapi-status'
export const inject = { required: ['http'], optional: ['puppeteer'] }
export const Config = ConfigSchema

const PLUGIN = 'koishi-plugin-newapi-status'
const PLUGIN_VERSION = '0.1.0'

/** 把用户填的前缀归一化成合法指令名：去斜杠、去 .* 后缀、去尾部点。支持逗号分隔多个前缀。 */
export function normalizePrefix(input?: string): string[] {
  const list = (input || 'newapi')
    .split(/[,，\s]+/)
    .map(raw => raw.trim().replace(/^\/+/, '').replace(/\.\*$/, '').replace(/[.\s]+$/, ''))
    .filter(Boolean)
  const unique = [...new Set(list)]
  return unique.length ? unique : ['newapi']
}

function maskKey(key: string): string {
  if (!key) return '--'
  if (key.length <= 8) return key.slice(0, 2) + '***'
  return key.slice(0, 3) + '***' + key.slice(-2)
}

/**
 * 指令清单：help 与各分组默认动作共用同一份，避免文案漂移。
 * healthHours 必须传进来——文案里写死「1 小时」会和实际配置对不上。
 */
function commandList(prefix: string, healthHours = 1): Array<{ usage: string, desc: string }> {
  return [
    { usage: `${prefix} help`, desc: '列出全部指令和用法' },
    { usage: `${prefix} status`, desc: '站点名、版本、运行时长、接口延迟、可访问性' },
    { usage: `${prefix} notice`, desc: '最新时间线与站内公告' },
    { usage: `${prefix} about`, desc: '关于本插件' },
    { usage: `${prefix} model search <关键词>`, desc: '模糊搜索模型名' },
    { usage: `${prefix} model list [供应商]`, desc: '站点可用的模型列表' },
    { usage: `${prefix} model status <模型> [-t 小时] [-g 分组]`, desc: '成功率、平均延迟、首 Token、TPS，附每小时成功率色块' },
    { usage: `${prefix} model health`, desc: `列出近 ${healthHours} 小时成功率高于阈值的模型及其分组` },
    { usage: `${prefix} group`, desc: '分组列表、每个分组的倍率和说明' },
    { usage: `${prefix} group ratio [模型]`, desc: '模型倍率和补全倍率' },
    { usage: `${prefix} group status [分组]`, desc: '分组状态，未指定分组时为全部' },
    { usage: `${prefix} group search <关键词>`, desc: '模糊搜索分组名' },
    { usage: `${prefix} network [名称]`, desc: '站点线路与 Uptime Kuma 监控项的在线状态' },
    { usage: `${prefix} test <模型> [预设keyId | sk-令牌]`, desc: '发一条最短对话请求，返回成功与否、总耗时、首 Token 耗时' },
    { usage: `${prefix} test list`, desc: '列出配置里预设的 keyId 与分组' },
  ]
}

/** 把多段输出拼成一个消息元素数组（图片元素是字符串形式的标记，需要归一化） */
function concat(...parts: any[]): h.Fragment {
  return parts.flatMap(part => h.normalize(part)) as any
}

function clampHours(value: number | undefined, fallback: number): number {
  const hours = Number(value)
  if (!Number.isFinite(hours) || hours <= 0) return Math.min(fallback || 24, MAX_PERF_HOURS)
  return Math.min(Math.max(1, Math.floor(hours)), MAX_PERF_HOURS)
}

export function apply(ctx: Context, config: PluginConfig) {
  // 5 等级 logger（success/error/info/warn/debug），命名空间 newapi-status 注册给 Koishi
  const logger = createLogger(ctx, config.logLevel)
  const prefixes = normalizePrefix(config.commandPrefix)
  const client: ApiClientOptions = {
    baseUrl: config.baseUrl,
    token: config.accessToken?.trim() || undefined,
    userId: Number(config.userId) > 0 ? Number(config.userId) : undefined,
    timeout: config.timeout,
  }
  const renderOptions: RenderOptions = { mode: config.render, enabled: true }

  const secrets = () => [
    config.accessToken,
    config.monitor.apiKey,
    ...Object.values(config.test.presets || {}).map(preset => preset?.key),
  ]
  const now = () => Math.floor(Date.now() / 1000)
  const view = (): ViewContext => ({ pluginName: PLUGIN, updatedAt: now() })

  /** 统一兜底：异常变成可读文字，且绝不把令牌写进日志或回复 */
  function action<A extends any[]>(task: (...args: A) => Promise<any>) {
    return async (...args: A): Promise<any> => {
      try {
        return await task(...args)
      } catch (error) {
        const raw = error instanceof NewApiError ? error.message : String((error as Error)?.message ?? error)
        const message = sanitize(raw, ...secrets())
        if (error instanceof NewApiError) {
          // 上游明确拒绝（4xx/网络），属于可恢复的业务失败
          logger.warn('%s', message)
        } else {
          logger.error('指令执行异常：%s', message)
          if (error instanceof Error && error.stack) logger.debug('%s', sanitize(error.stack, ...secrets()))
        }
        return h.text(renderError('查询失败', message))
      }
    }
  }

  const pricing = (): Promise<PricingResponse> => getPricing(ctx, client)
  const pricingOrNull = (): Promise<PricingResponse | null> => pricing().catch((error) => {
    logger.debug('定价接口不可用：%s', sanitize(String((error as Error)?.message), ...secrets()))
    return null
  })

  function listView(title: string, rows: ListRowView[], extra: Partial<ListView> = {}): ListView {
    return {
      title,
      rows,
      footerLeft: PLUGIN,
      footerRight: formatClock(now()),
      ...extra,
    }
  }

  const showList = (list: ListView) => renderList(ctx, list, renderOptions)
  const showCard = (card: Parameters<typeof renderCard>[1]) => renderCard(ctx, card, renderOptions)

  // ── 站点 ──────────────────────────────────────────────────────
  async function statusAction(): Promise<h.Fragment> {
    const probe = await probeSite(ctx, client)
    let status: SiteStatus | null = null
    if (probe.ok) {
      status = await getSiteStatus(ctx, client).then(result => result.data).catch(() => null)
    }
    // 注意：真实站点（v1.0.0-rc.51）的 /api/perf-metrics/summary 只有 models[]，
    // 没有顶层 recent_success_series —— 两种形态都带上，由 buildStatusCard 决定用哪个。
    const [sitePricing, perf] = await Promise.all([
      pricingOrNull(),
      probe.ok
        ? getPerfMetricsSummary(ctx, client, Math.min(config.perfHours, 24)).then(result => result.result).catch(() => undefined)
        : Promise.resolve(undefined),
    ])
    let announcements = collectAnnouncements(status, null, config.noticeLimit)
    if (!announcements.length && probe.ok) {
      const notice = await getNotice(ctx, client).catch(() => '')
      announcements = collectAnnouncements(status, notice, config.noticeLimit)
    }
    const card = buildStatusCard({
      status,
      baseUrl: config.baseUrl,
      latencyMs: probe.latencyMs,
      reachable: probe.ok,
      pricing: sitePricing,
      successSeries: perf?.recent_success_series,
      perfModels: perf?.models,
      perfModelCount: perf?.models?.length,
      announcements,
      seriesHours: Math.min(config.perfHours || 24, 24),
      fallbackName: hostOf(config.baseUrl),
    }, view())
    const rendered = await showCard(card)
    if (probe.ok || !probe.error) return rendered
    return concat(h.text(renderError('站点不可访问', probe.error)), rendered)
  }

  async function noticeAction(): Promise<h.Fragment> {
    const status = await getSiteStatus(ctx, client).then(result => result.data).catch(() => null)
    const notice = await getNotice(ctx, client).catch(() => '')
    const timeline = collectAnnouncements(status, null, config.noticeLimit)
    // /api/notice 是 Markdown 裸字符串（# 标题 / **加粗**），卡片不渲染 Markdown，
    // 走 parseAnnouncements 统一剥标记并按段落切
    const notices = notice
      ? parseAnnouncements(sanitize(notice, ...secrets()), config.noticeLimit)
      : []
    // wrap: true —— 公告正文是长文本，卡片里要换行，不能右对齐挤成一行省略号
    const rows: ListRowView[] = [
      ...timeline.map((text, index) => ({ name: `时间线 ${index + 1}`, value: text, level: 'ok' as const, wrap: true })),
      ...notices.map((text, index) => ({ name: `公告 ${index + 1}`, value: text, wrap: true })),
    ]
    return showList(listView('公告与时间线', rows, {
      subtitle: status?.system_name || hostOf(config.baseUrl),
      note: `时间线 ${timeline.length} 条 · 公告 ${notices.length} 条`,
      empty: '站点没有下发公告（console_setting.Announcements 与 Notice 均为空）。',
    }))
  }

  async function aboutAction(): Promise<h.Fragment> {
    const about = await getAbout(ctx, client).catch(() => '')
    const rows: ListRowView[] = [
      { name: '插件', value: PLUGIN, level: 'ok' },
      { name: '版本', value: PLUGIN_VERSION },
      { name: '指令前缀', value: prefixes.join(', ') },
      { name: '站点', value: hostOf(config.baseUrl) },
      { name: '渲染方式', value: config.render },
      { name: '数据来源', value: '/api/status · /api/pricing · /api/ratio_config · /api/perf-metrics' },
      { name: '巡检口径', value: config.monitor.apiKey ? '/v1/models 差集轮询' : '仅站点可用性' },
      { name: '面板令牌', value: client.token ? '已配置' : '未配置（公开接口仍可用）' },
    ]
    const output = await showList(listView('关于', rows, {
      subtitle: '查询 New API 站点状态',
      note: about ? '含站点关于信息' : undefined,
    }))
    if (!about) return output
    return concat(output, h.text('\n站点关于：' + sanitize(about, ...secrets())))
  }

  // ── 模型 ──────────────────────────────────────────────────────
  async function modelSearchAction(keyword: string): Promise<h.Fragment> {
    const data = await pricing()
    const models = pricingModels(data)
    return showList(buildModelList(models, {
      title: `模型搜索 ${keyword}`,
      subtitle: `${hostOf(config.baseUrl)} · /api/pricing`,
      keyword,
    }, view()))
  }

  async function modelListAction(vendor?: string): Promise<h.Fragment> {
    const data = await pricing()
    const models = pricingModels(data)
    const keyword = (vendor || '').trim().toLowerCase()
    const filtered = keyword
      ? models.filter(item => (item.vendor || '').toLowerCase().includes(keyword)
        || item.groups.some(group => group.toLowerCase().includes(keyword)))
      : models
    return showList(buildModelList(filtered, {
      title: keyword ? `供应商 ${vendor}` : '站点可用模型',
      subtitle: `${hostOf(config.baseUrl)} · /api/pricing`,
      // 不传 note 时由 buildModelList 自己写「86 个 · 显示前 24」；
      // 原先无条件传 "${filtered.length}/${models.length} 个"，没有过滤时会显示成没头没脑的「86/86 个」。
      note: keyword ? `${filtered.length}/${models.length} 个` : undefined,
    }, view()))
  }

  async function modelStatusAction(model: string, options: { hours?: number, group?: string }): Promise<h.Fragment> {
    const hours = clampHours(options.hours, config.perfHours)
    const group = (options.group || '').trim() || undefined
    const { result } = await getPerfMetrics(ctx, client, { model, hours, group })
    if (!result.summary && !result.series?.length) {
      result.summary = summarizeSeries(result.series)
    }
    return showCard(buildModelStatusCard({ model, group, hours, result }, view()))
  }

  async function modelHealthAction(): Promise<h.Fragment> {
    const threshold = Math.min(100, Math.max(0, config.healthThreshold || 95))
    const hours = clampHours(config.healthHours, 1)
    const [{ result }, data] = await Promise.all([
      getPerfMetricsSummary(ctx, client, hours),
      pricingOrNull(),
    ])
    const groupsOf = new Map<string, string[]>()
    for (const item of pricingModels(data)) groupsOf.set(item.model_name, item.groups)
    const rows: ListRowView[] = []
    for (const item of result.models ?? []) {
      const points = item.recent_success_series ?? []
      const latest = points.length ? points[points.length - 1].success_rate : item.success_rate
      if (!Number.isFinite(latest) || latest < threshold) continue
      const groups = groupsOf.get(item.model_name) ?? []
      rows.push({
        name: item.model_name,
        tag: groups.length ? groups.slice(0, 3).join('/') : '未标注分组',
        value: `${formatSuccessRate(latest)} · ${formatLatency(item.avg_latency_ms)}`,
        level: classifySuccessRate(latest),
      })
    }
    rows.sort((a, b) => Number.parseFloat(b.value ?? '0') - Number.parseFloat(a.value ?? '0'))
    const latestBucket = result.models?.[0]?.recent_success_series?.slice(-1)[0]?.ts
    return showList(listView('模型健康度', rows.slice(0, 20), {
      subtitle: `成功率 ≥ ${threshold}% · 近 ${hours} 小时`,
      note: latestBucket ? `最近桶 ${formatClock(latestBucket)} · perf-metrics` : 'perf-metrics',
      empty: `近 ${hours} 小时没有模型的成功率高于 ${threshold}%（New API 的 perf-metrics 最小粒度是小时桶，取不到分钟级数据）。`,
    }))
  }

  // ── 分组 ──────────────────────────────────────────────────────
  function groupRows(data: PricingResponse, keyword?: string): ListRowView[] {
    const names = new Set<string>([
      ...Object.keys(data.group_ratio ?? {}),
      ...Object.keys(data.usable_group ?? {}),
    ])
    const rows: ListRowView[] = []
    for (const name of [...names].sort()) {
      if (keyword && !name.toLowerCase().includes(keyword.toLowerCase())) continue
      const ratio = data.group_ratio?.[name]
      const desc = data.usable_group?.[name]
      const count = pricingModels(data).filter(item => item.groups.includes(name) || item.groups.includes('all')).length
      rows.push({
        name,
        tag: desc || undefined,
        value: [formatRatio(ratio, 0), count ? `${count} 个模型` : '无模型'].join(' · '),
        level: desc ? 'ok' : 'unknown',
      })
    }
    return rows
  }

  async function groupAction(): Promise<h.Fragment> {
    const data = await pricing()
    return showList(listView('分组倍率', groupRows(data), {
      subtitle: `${hostOf(config.baseUrl)} · /api/pricing`,
      note: `${groupRows(data).length} 个分组`,
      empty: '站点没有返回分组倍率（group_ratio 为空）。',
    }))
  }

  async function groupSearchAction(keyword: string): Promise<h.Fragment> {
    const data = await pricing()
    const rows = groupRows(data, keyword)
    return showList(listView(`分组搜索 ${keyword}`, rows, {
      subtitle: `${hostOf(config.baseUrl)} · /api/pricing`,
      note: `${rows.length} 个匹配`,
      empty: `没有匹配「${keyword}」的分组。`,
    }))
  }

  async function groupStatusAction(group?: string): Promise<h.Fragment> {
    const data = await pricing()
    const keyword = (group || '').trim()
    const rows = groupRows(data, keyword || undefined)
    return showList(listView(keyword ? `分组状态 ${keyword}` : '分组状态', rows, {
      subtitle: `${hostOf(config.baseUrl)} · /api/pricing`,
      note: keyword ? undefined : '全部分组',
      empty: keyword
        ? `站点没有名为「${keyword}」的分组。`
        : '站点没有返回分组信息。',
    }))
  }

  /**
   * 模型倍率查询。
   * 主数据源是 /api/pricing（含厂商、分组、端点的完整信息），
   * 但实测有站点 pricing 只下发 86 个模型、/api/ratio_config 却有 4102 个，
   * 所以查单个模型时要用 ratio_config 兜底，并把缓存倍率一并展示。
   */
  async function groupRatioAction(model?: string): Promise<h.Fragment> {
    const keyword = (model || '').trim().toLowerCase()
    const [data, ratioConfig] = await Promise.all([
      pricingOrNull(),
      keyword ? getRatioConfig(ctx, client) : Promise.resolve(null),
    ])
    const models = pricingModels(data)
    const rows: ListRowView[] = []
    const seen = new Set<string>()

    const describe = (name: string, ratio: number, completion: number, cache?: number, quotaType = 0, vendor?: string, price?: number) => {
      const parts: string[] = []
      if (quotaType === 1 && Number.isFinite(price)) {
        parts.push(`按次 ${formatRatio(price, 1)}`)
      } else {
        parts.push(`模型 ${formatRatio(ratio, 0)}`)
        parts.push(`补全 ${formatRatio(completion, 0)}`)
        if (Number.isFinite(cache) && (cache as number) > 0) parts.push(`缓存 ${formatRatio(cache as number, 0)}`)
      }
      return { name, tag: vendor, value: parts.join(' · ') }
    }

    const matched = keyword
      ? models.filter(item => item.model_name.toLowerCase() === keyword)
        .concat(models.filter(item => item.model_name.toLowerCase() !== keyword && item.model_name.toLowerCase().includes(keyword)))
      : models

    for (const item of matched) {
      if (seen.has(item.model_name)) continue
      seen.add(item.model_name)
      rows.push(describe(
        item.model_name, item.ratio, item.completionRatio, item.pricing.cache_ratio,
        item.quotaType, item.vendor, item.pricing.model_price,
      ))
    }

    // ratio_config 兜底：pricing 里没有的模型，用全站倍率字典补上
    if (keyword && ratioConfig) {
      const candidates = Object.keys(ratioConfig.model_ratio ?? {})
        .filter(name => name.toLowerCase().includes(keyword))
        .sort((a, b) => Number(a.toLowerCase() === keyword) * -1 - Number(b.toLowerCase() === keyword) * -1)
      for (const name of candidates.slice(0, 10)) {
        if (seen.has(name)) continue
        seen.add(name)
        rows.push(describe(
          name,
          ratioConfig.model_ratio[name] ?? 0,
          ratioConfig.completion_ratio?.[name] ?? 0,
          ratioConfig.cache_ratio?.[name],
          ratioConfig.model_price?.[name] ? 1 : 0,
          undefined,
          ratioConfig.model_price?.[name],
        ))
      }
    }

    const total = Object.keys(ratioConfig?.model_ratio ?? {}).length
    return showList(listView(keyword ? `模型倍率 ${model}` : '模型倍率与补全倍率', rows, {
      subtitle: `${hostOf(config.baseUrl)} · /api/pricing · /api/ratio_config`,
      note: keyword
        ? `${rows.length} 个匹配`
        : `显示前 ${rows.length}/${models.length} 个，用 <模型> 精确查询`,
      empty: keyword
        ? `定价表和全站倍率字典（${total} 个模型）里都没有「${model}」。`
        : '站点没有返回模型倍率。',
    }))
  }

  // ── 监控 ──────────────────────────────────────────────────────
  /**
   * 网络视图优先用 /api/status 的 api_info 线路（逐条实测可达性），
   * 没有线路时才退回 Uptime Kuma —— 实测不少站点 uptime/status 返回空数组，
   * 但 api_info 是有内容的。
   */
  async function networkAction(target?: string): Promise<h.Fragment> {
    const name = (target || '').trim() || undefined
    const routes = await getApiRoutes(ctx, client).then(result => result.data).catch(() => [])
    if (routes.length) {
      const probes = await probeRoutes(ctx, client, routes)
      return showList(buildRouteList(probes, name, view()))
    }
    const groups = await getUptimeStatus(ctx, client)
    return showList(buildUptimeList(groups, name, view()))
  }

  // ── 测试 ──────────────────────────────────────────────────────
  function presetRows(): ListRowView[] {
    const presets = config.test.presets || {}
    return Object.entries(presets).map(([keyId, preset]) => ({
      name: keyId,
      tag: preset?.group,
      value: [preset?.model || config.test.model, maskKey(preset?.key || '')].join(' · '),
      level: preset?.key ? 'ok' : 'fail',
    }))
  }

  async function testListAction(): Promise<h.Fragment> {
    const rows = presetRows()
    return showList(listView('测试预设', rows, {
      subtitle: config.test.enabled ? 'test.enabled 已开启' : 'test.enabled 未开启，测试指令不可用',
      note: `${rows.length} 个预设`,
      empty: '还没有配置 test.presets。可以在插件配置里添加 { keyId: { key, model, group } }。',
    }))
  }

  async function testAction(model?: string, credential?: string): Promise<h.Fragment> {
    if (!config.test.enabled) {
      return h.text(renderError('测试功能未开启', '请在插件配置里打开 test.enabled，并配置 test.presets 或直接传 sk- 令牌。'))
    }
    const presets = config.test.presets || {}
    const keyIds = Object.keys(presets)
    let apiKey = ''
    let targetModel = (model || '').trim()
    let presetNote = ''

    if (credential) {
      if (credential.startsWith('sk-')) {
        apiKey = credential
        presetNote = '指令内令牌（不会写入日志）'
      } else if (presets[credential]) {
        apiKey = presets[credential]?.key || ''
        targetModel = targetModel || presets[credential]?.model || ''
        presetNote = `预设 ${credential}`
      } else {
        return h.text(renderError('找不到该预设', `可用 keyId：${keyIds.join(', ') || '（未配置）'}；也可以直接传 sk- 开头的调用令牌。`))
      }
    } else if (keyIds.length === 1) {
      apiKey = presets[keyIds[0]]?.key || ''
      targetModel = targetModel || presets[keyIds[0]]?.model || ''
      presetNote = `预设 ${keyIds[0]}`
    } else if (keyIds.length === 0) {
      return h.text(renderError('缺少调用令牌', `请在指令里补一个 sk- 令牌，或在配置 test.presets 里预设 keyId（当前预设：0 个）。`))
    } else {
      return h.text(renderError('请指定预设', `站点配置了多个预设，请写明 keyId：${keyIds.join(', ')}。`))
    }

    if (!apiKey) return h.text(renderError('预设缺少令牌', '该预设没有填写 key，请检查 test.presets。'))
    targetModel = targetModel || config.test.model
    if (!targetModel) return h.text(renderError('缺少模型名', '请在指令里写明模型，或配置 test.model 作为默认值。'))

    const result = await relayTest(ctx, {
      baseUrl: config.baseUrl,
      apiKey,
      model: targetModel,
      prompt: config.test.prompt,
      maxTokens: config.test.maxTokens,
      timeout: config.test.timeout || config.timeout,
    })
    if (result.ok) {
      logger.success('连通性测试通过：%s，总耗时 %dms，首 Token %dms', targetModel, result.totalMs, result.firstTokenMs)
    } else {
      logger.warn('连通性测试失败：%s，HTTP %s，%s', targetModel, result.status || '--', result.error ?? '未知错误')
    }
    const rows: ListRowView[] = [
      { name: '结果', value: result.ok ? '成功' : '失败', level: result.ok ? 'ok' : 'fail' },
      { name: '模型', value: result.model },
      { name: '总耗时', value: formatLatency(result.totalMs), level: classifyLatency(result.totalMs) },
      { name: '首 Token', value: formatLatency(result.firstTokenMs), level: classifyLatency(result.firstTokenMs) },
      { name: 'HTTP', value: String(result.status || '--') },
      { name: '令牌来源', value: presetNote },
    ]
    if (result.preview) rows.push({ name: '回复预览', value: result.preview })
    if (result.error) rows.push({ name: '错误', value: result.error, level: 'fail' })
    return showList(listView(`连通性测试 ${targetModel}`, rows, {
      subtitle: hostOf(config.baseUrl),
      note: 'POST /v1/chat/completions',
    }))
  }

  // ── 帮助 ──────────────────────────────────────────────────────
  /**
   * 帮助正文交给 Koishi 自己的 help 指令生成，不再自己拼一份文本。
   * session.execute(..., true) 只取返回值、不发送（core: shouldEmit=false → h.normalize），
   * 避免一次调用发出两条消息；再把 config.helpText 追加到最末尾。
   * 宿主没装 @koishijs/plugin-help（或 help 指令被禁用）时，回退到内置清单。
   */
  async function koishiHelp(argv: any, target: string, fallback: () => any): Promise<any> {
    const footer = (config.helpText || '').trim()
    let body: any = null
    const session = argv?.session
    if (session && typeof session.execute === 'function') {
      try {
        body = h.normalize(await session.execute({ name: 'help', args: [target] }, true))
      } catch (error) {
        logger.debug('Koishi help 不可用，回退内置清单：%s', sanitize(String((error as Error)?.message), ...secrets()))
      }
    }
    if (!body || !body.length) body = h.normalize(fallback())
    if (!footer) return body
    return concat(body, h.text('\n' + sanitize(footer, ...secrets())))
  }

  // ── 指令注册 ──────────────────────────────────────────────────
  for (const prefix of prefixes) {
    const fullList = () => commandList(prefix, clampHours(config.healthHours, 1))
    const root = ctx.command(prefix, 'New API 站点状态查询')
      .usage(`输入 ${prefix} help 查看全部子指令；任意子指令加 -h 查看详细帮助。`)
    root.action(action(argv => koishiHelp(argv, prefix, () => h.text(renderHelp(prefix, fullList())))))

    ctx.command(`${prefix}.help`, '列出全部指令和用法')
      .example(`${prefix} help`)
      .action(action(argv => koishiHelp(argv, prefix, () => h.text(renderHelp(prefix, fullList())))))
    ctx.command(`${prefix}.status`, '查询站点状态').action(action(statusAction))
    ctx.command(`${prefix}.notice`, '查看最新时间线与公告').action(action(noticeAction))
    ctx.command(`${prefix}.about`, '关于本插件').action(action(aboutAction))

    const modelRoot = ctx.command(`${prefix}.model`, '模型相关查询')
      .usage(`输入 ${prefix} model 查看模型相关子指令。`)
    modelRoot.action(action(argv => koishiHelp(argv, `${prefix}.model`, () => h.text(renderHelp(prefix,
      fullList().filter(item => item.usage.includes(`${prefix} model`)))))))

    ctx.command(`${prefix}.model.search <keyword>`, '模糊搜索模型名')
      .action(action(async (_argv, keyword) => modelSearchAction(String(keyword ?? ''))))

    ctx.command(`${prefix}.model.list [vendor]`, '站点可用模型列表')
      .action(action(async (_argv, vendor) => modelListAction(vendor ? String(vendor) : undefined)))

    ctx.command(`${prefix}.model.status <model>`, '查询模型表现')
      .option('hours', '-t <hours:natural> 统计窗口（小时），默认 24')
      .option('group', '-g <group> 只看某个分组')
      .action(action(async (argv, model) => modelStatusAction(String(model ?? ''), {
        hours: argv.options?.hours as number | undefined,
        group: argv.options?.group as string | undefined,
      })))

    ctx.command(`${prefix}.model.health`, '列出成功率高于阈值的模型及其分组')
      .action(action(modelHealthAction))

    const groupRoot = ctx.command(`${prefix}.group`, '分组相关查询')
    groupRoot.action(action(groupAction))

    ctx.command(`${prefix}.group.ratio [model]`, '模型倍率和补全倍率')
      .action(action(async (_argv, model) => groupRatioAction(model ? String(model) : undefined)))

    ctx.command(`${prefix}.group.status [group]`, '分组状态')
      .action(action(async (_argv, group) => groupStatusAction(group ? String(group) : undefined)))

    ctx.command(`${prefix}.group.search <keyword>`, '模糊搜索分组名')
      .action(action(async (_argv, keyword) => groupSearchAction(String(keyword ?? ''))))

    ctx.command(`${prefix}.network [name]`, '站点线路与监控项状态')
      .action(action(async (_argv, name) => networkAction(name ? String(name) : undefined)))

    ctx.command(`${prefix}.test [model] [credential]`, '用调用令牌做一次连通性测试', { permissions: ['authority:3'] })
      .action(action(async (_argv, model, credential) => {
        if (String(model ?? '') === 'list') return testListAction()
        return testAction(model ? String(model) : undefined, credential ? String(credential) : undefined)
      }))
  }

  /**
   * Koishi help 的 formatCommands 只迭代 command.children——只列一层子指令，
   * 所以 `nekoapi` 的帮助里看不到 `nekoapi model status` 这类二级指令。
   * showHelp 会 emit('help/command', output, command, session)，这里从指令注册表里
   * 把二级指令补进同一个 output；仍然是一条 Koishi help 消息，不额外多发一条。
   */
  // 事件名由 @koishijs/plugin-help 声明，宿主没装它时类型里没有这个 key，这里放宽类型
  ctx.on('help/command' as any, (output: string[], command: any, session: any) => {
    const scope = String(command?.name ?? '')
    if (!prefixes.includes(scope)) return
    const lines: string[] = []
    for (const child of command.children ?? []) {
      for (const grand of child.children ?? []) {
        if (session && session.resolve(grand.config?.hidden)) continue
        const title = String(grand.displayName ?? grand.name).replace(/\./g, ' ')
        const desc = session ? session.text([`commands.${grand.name}.description`, '']) : ''
        lines.push(`    /${title}${grand.declaration ?? ''}${desc ? '  ' + desc : ''}`)
      }
    }
    // `test list` 不是独立指令，但它是最常用的用法之一，单独补一行
    const usage = commandList(scope, clampHours(config.healthHours, 1))
      .find(item => item.usage === `${scope} test list`)
    if (usage && (command.children ?? []).some((child: any) => child.name === `${scope}.test`)) {
      lines.push(`    /${usage.usage}  ${sanitize(usage.desc, ...secrets())}`)
    }
    if (!lines.length) return
    output.push('', '二级子指令：', ...lines)
  })

  logger.info('插件已加载：前缀 %s，站点 %s，渲染 %s，日志等级 %s',
    prefixes.join(', '), hostOf(config.baseUrl), config.render, config.logLevel)

  if (config.monitor.enabled) {
    ctx.on('ready', () => {
      try {
        startMonitor(ctx, config)
      } catch (error) {
        logger.warn('巡检启动失败：%s', sanitize(String((error as Error)?.message), ...secrets()))
      }
    })
  }
}