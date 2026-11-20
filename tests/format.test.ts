import { describe, expect, it } from 'vitest'
import {
  LATENCY_FAST,
  LATENCY_SLOW,
  classifyLatency,
  classifySeries,
  classifySuccessRate,
  formatDuration,
  formatLatency,
  formatMonitorStatus,
  formatNumber,
  formatPercent,
  formatQuota,
  formatRatio,
  formatSiteAvailability,
  formatSuccessRate,
  formatTimestamp,
  formatClock,
  parseAnnouncements,
  stripMarkdown,
  tail,
} from '../src/format'

describe('classifyLatency / formatLatency（延迟分档）', () => {
  it('低于 1500ms 为 ok', () => {
    expect(classifyLatency(1)).toBe('ok')
    expect(classifyLatency(LATENCY_FAST - 1)).toBe('ok')
  })

  it('1500~5000ms 为 warn，边界值算 warn', () => {
    expect(classifyLatency(LATENCY_FAST)).toBe('warn')
    expect(classifyLatency(3000)).toBe('warn')
    expect(classifyLatency(LATENCY_SLOW)).toBe('warn')
  })

  it('超过 5000ms 为 fail', () => {
    expect(classifyLatency(LATENCY_SLOW + 1)).toBe('fail')
    expect(classifyLatency(12000)).toBe('fail')
  })

  it('0、负数、NaN、null 都是 unknown', () => {
    expect(classifyLatency(0)).toBe('unknown')
    expect(classifyLatency(-1)).toBe('unknown')
    expect(classifyLatency(Number.NaN)).toBe('unknown')
    expect(classifyLatency(null)).toBe('unknown')
    expect(classifyLatency(undefined)).toBe('unknown')
  })

  it('文本：小于 1 秒用 ms，大于等于 1 秒用秒', () => {
    expect(formatLatency(412)).toBe('412ms')
    expect(formatLatency(999)).toBe('999ms')
    expect(formatLatency(1000)).toBe('1.00s')
    expect(formatLatency(1499)).toBe('1.50s')
    expect(formatLatency(0)).toBe('--')
    expect(formatLatency(null)).toBe('--')
  })
})

describe('formatDuration（时间格式化）', () => {
  it('按天/时/分拆解', () => {
    expect(formatDuration(86400)).toBe('1天')
    expect(formatDuration(86400 + 3600 * 4 + 60 * 18)).toBe('1天4时18分')
    expect(formatDuration(3600)).toBe('1时')
    expect(formatDuration(60)).toBe('1分')
    expect(formatDuration(1)).toBe('1秒')
  })

  it('compact 只保留最高的两级单位', () => {
    expect(formatDuration(86400 + 3600 * 4 + 60 * 18, true)).toBe('1天4时')
    expect(formatDuration(3600 * 2 + 60 * 30, true)).toBe('2时30分')
    expect(formatDuration(45, true)).toBe('45秒')
  })

  it('非法输入与 0', () => {
    expect(formatDuration(0)).toBe('0分')
    expect(formatDuration(0, true)).toBe('0秒')
    expect(formatDuration(-5)).toBe('--')
    expect(formatDuration(undefined)).toBe('--')
  })
})

describe('formatTimestamp / formatClock（unix 秒）', () => {
  const ts = Math.floor(new Date(2026, 10, 7, 16, 20, 5).getTime() / 1000)

  it('时间戳输出 MM-DD HH:mm', () => {
    expect(formatTimestamp(ts)).toBe('11-07 16:20')
  })

  it('时钟输出 HH:mm', () => {
    expect(formatClock(ts)).toBe('16:20')
  })

  it('非法输入返回 --', () => {
    expect(formatTimestamp(0)).toBe('--')
    expect(formatTimestamp(null)).toBe('--')
    expect(formatClock(undefined)).toBe('--')
  })
})

describe('formatQuota（额度换算）', () => {
  it('display_in_currency 为 false 时只显示额度', () => {
    expect(formatQuota(500000, { display_in_currency: false })).toBe('500,000 额度')
  })

  it('按 quota_per_unit 换算成美元', () => {
    expect(formatQuota(500000, { display_in_currency: true, quota_per_unit: 500000 })).toBe('$1.00')
    expect(formatQuota(250000, { display_in_currency: true, quota_per_unit: 500000 })).toBe('$0.50')
  })

  it('叠加汇率与价格', () => {
    expect(formatQuota(500000, {
      display_in_currency: true,
      quota_per_unit: 500000,
      usd_exchange_rate: 7,
      price: 1,
      symbol: '¥',
    })).toBe('¥7.00')
  })

  it('缺省 quota_per_unit 时按 500000 兜底', () => {
    expect(formatQuota(1000000, { display_in_currency: true })).toBe('$2.00')
  })

  it('非法额度返回 --', () => {
    expect(formatQuota(Number.NaN)).toBe('--')
  })
})

describe('formatRatio（倍率）', () => {
  it('按次计费显示按次', () => {
    expect(formatRatio(0, 1)).toBe('按次')
  })

  it('0 倍率显示免费', () => {
    expect(formatRatio(0, 0)).toBe('免费')
  })

  it('普通倍率保留两位', () => {
    expect(formatRatio(1)).toBe('1.00×')
    expect(formatRatio(0.7)).toBe('0.70×')
    expect(formatRatio(1.5)).toBe('1.50×')
  })

  it('非法输入返回 --', () => {
    expect(formatRatio(null)).toBe('--')
    expect(formatRatio(Number.NaN)).toBe('--')
  })
})

describe('classifySuccessRate（成功率分档）', () => {
  it('>= 95 为 ok', () => {
    expect(classifySuccessRate(95)).toBe('ok')
    expect(classifySuccessRate(99.94)).toBe('ok')
  })

  it('80~95 为 warn', () => {
    expect(classifySuccessRate(94.99)).toBe('warn')
    expect(classifySuccessRate(80)).toBe('warn')
  })

  it('低于 80 为 fail', () => {
    expect(classifySuccessRate(79.9)).toBe('fail')
    expect(classifySuccessRate(0)).toBe('fail')
  })

  it('非法输入为 unknown', () => {
    expect(classifySuccessRate(null)).toBe('unknown')
    expect(classifySuccessRate(-1)).toBe('unknown')
  })
})

describe('状态映射', () => {
  it('成功率文本两位小数', () => {
    expect(formatSuccessRate(99.94)).toBe('99.94%')
    expect(formatSuccessRate(100)).toBe('100.00%')
    expect(formatSuccessRate(undefined)).toBe('--')
  })

  it('Uptime Kuma：1 正常 0 离线', () => {
    expect(formatMonitorStatus(1)).toEqual({ level: 'ok', text: '正常' })
    expect(formatMonitorStatus(0)).toEqual({ level: 'fail', text: '离线' })
    expect(formatMonitorStatus(9)).toEqual({ level: 'unknown', text: '未知' })
  })

  it('站点可访问性', () => {
    expect(formatSiteAvailability(true)).toEqual({ level: 'ok', text: '可访问' })
    expect(formatSiteAvailability(false)).toEqual({ level: 'fail', text: '不可访问' })
  })

  it('色块分档', () => {
    expect(classifySeries([{ success_rate: 99 }, { success_rate: 90 }, { success_rate: 10 }]))
      .toEqual(['ok', 'warn', 'fail'])
  })
})

describe('parseAnnouncements（公告解析）', () => {
  it('解析 JSON 数组字符串', () => {
    expect(parseAnnouncements('["a","b"]')).toEqual(['a', 'b'])
  })

  it('解析普通字符串（按行/分号切分）', () => {
    expect(parseAnnouncements('第一条\n第二条；第三条')).toEqual(['第一条', '第二条', '第三条'])
  })

  it('limit 截断', () => {
    expect(parseAnnouncements('["a","b","c"]', 2)).toEqual(['a', 'b'])
  })

  it('空值返回空数组', () => {
    expect(parseAnnouncements('')).toEqual([])
    expect(parseAnnouncements(null)).toEqual([])
  })

  it('非法 JSON 时退化为纯文本', () => {
    expect(parseAnnouncements('[not json]')).toEqual(['[not json]'])
  })

  it('对象数组（真实站点 v1.0.0-rc.51 的形态）取 content', () => {
    const raw = JSON.stringify([
      { content: 'DeepSeek上架应急自部署\nDeepSeek全线恢复\n', id: 7, type: 'success' },
      { content: 'https://status.deepseek.com/incidents/1 DeepSeek渠道再次维护', id: 6, type: 'error' },
    ])
    expect(parseAnnouncements(raw)).toEqual([
      'DeepSeek上架应急自部署 DeepSeek全线恢复',
      'https://status.deepseek.com/incidents/1 DeepSeek渠道再次维护',
    ])
  })

  it('Markdown 标记会被剥掉（/api/notice 是裸 Markdown）', () => {
    expect(parseAnnouncements('# 欢迎来到\n## 公告请看时间线')).toEqual(['欢迎来到', '公告请看时间线'])
    expect(parseAnnouncements('本站支持 **Github**, **LinuxDo** 快捷注册')).toEqual(['本站支持 Github, LinuxDo 快捷注册'])
  })
})

describe('stripMarkdown（公告去 Markdown 标记）', () => {
  it('去掉标题号与加粗', () => {
    expect(stripMarkdown('## 标题**加粗**')).toBe('标题加粗')
    expect(stripMarkdown('# 一级')).toBe('一级')
  })

  it('链接保留文字与地址', () => {
    expect(stripMarkdown('看[这里](https://example.com/a)')).toBe('看这里 https://example.com/a')
  })

  it('合并空白并去首尾', () => {
    expect(stripMarkdown('a  b\n\nc')).toBe('a b c')
  })

  it('空值返回空串', () => {
    expect(stripMarkdown('')).toBe('')
    expect(stripMarkdown(null)).toBe('')
    expect(stripMarkdown(undefined)).toBe('')
  })
})

describe('杂项工具', () => {
  it('formatNumber 千分位', () => {
    expect(formatNumber(1234567)).toBe('1,234,567')
    expect(formatNumber(1.005, 3)).toBe('1.005')
    expect(formatNumber(null)).toBe('--')
  })

  it('tail 取末尾', () => {
    expect(tail([1, 2, 3, 4], 2)).toEqual([3, 4])
    expect(tail([1, 2], 0)).toEqual([1, 2])
    expect(tail(undefined, 3)).toEqual([])
  })

  it('formatPercent 除零保护', () => {
    expect(formatPercent(1, 2)).toBe('50.0%')
    expect(formatPercent(1, 0)).toBe('--')
  })
})
