import type { Level } from './format'
import type { CardBlock, CardView, ListView } from './view'

/**
 * 没有 puppeteer 时的纯文本输出。
 * 与卡片共用同一份 CardView / ListView，信息不缩水，只换排版。
 */

const DOT: Record<Level, string> = {
  ok: '●',
  warn: '◐',
  fail: '✕',
  unknown: '○',
}

const BLOCK: Record<Level, string> = {
  ok: '🟩',
  warn: '🟨',
  fail: '🟥',
  unknown: '⬜',
}

function line(char = '─', length = 18): string {
  return char.repeat(length)
}

export function renderCardText(card: CardView): string {
  const out: string[] = []
  out.push(`【${card.siteName}】${card.sub}`)
  if (card.badges.length) {
    out.push(card.badges.map(badge => `[${badge.text}]`).join(' '))
  }
  out.push(line())

  for (const metric of card.metrics) {
    const level = metric.level && metric.level !== 'ok' ? ` ${DOT[metric.level]}` : ''
    out.push(`${metric.key}：${metric.value}${level}${metric.sub ? `（${metric.sub}）` : ''}`)
  }

  for (const section of card.sections) {
    out.push('')
    out.push(`· ${section.title}${section.note ? ` · ${section.note}` : ''}`)
    if (section.rows?.length) {
      for (const row of section.rows) {
        const level = row.level ? `${DOT[row.level]} ` : ''
        out.push(`  ${level}${row.name} → ${row.value}`)
      }
    }
    if (section.blocks?.length) {
      out.push(`  ${blocksToText(section.blocks)}`)
      if (section.axis?.length) out.push(`  ${section.axis.join('   →   ')}`)
    }
    if (section.chips?.length) {
      for (const chip of section.chips) out.push(`  - ${chip}`)
    }
    if (!section.rows?.length && !section.blocks?.length && !section.chips?.length && section.empty) {
      out.push(`  ${section.empty}`)
    }
  }

  if (card.notice) out.push(`\n公告：${card.notice.body}`)
  out.push(`\n${card.footerLeft} · ${card.footerRight}`)
  return out.join('\n')
}

export function blocksToText(blocks: CardBlock[]): string {
  return blocks.map(block => BLOCK[block.level] ?? BLOCK.unknown).join('')
}

export function renderListText(list: ListView): string {
  const out: string[] = []
  out.push(`【${list.title}】${list.subtitle ? ` ${list.subtitle}` : ''}`)
  if (list.note) out.push(`${list.note}`)
  out.push(line())
  if (!list.rows.length) {
    out.push(list.empty || '暂无数据。')
  } else {
    const limit = list.limit && list.limit > 0 ? list.limit : 24
    const rows = list.rows.slice(0, limit)
    for (const row of rows) {
      const level = row.level ? `${DOT[row.level]} ` : ''
      const tag = row.tag ? ` [${row.tag}]` : ''
      if (row.wrap) {
        // 长文本（公告正文）：名字单独一行，正文换行缩进，避免一坨超长单行
        out.push(`${level}${row.name}`)
        out.push(`  ${row.value || ''}`)
        continue
      }
      out.push(`${level}${row.name}${tag}${row.value ? `  ${row.value}` : ''}`)
    }
    if (list.rows.length > rows.length) {
      out.push(`… 还有 ${list.rows.length - rows.length} 条未显示，用关键词筛选`)
    }
  }
  out.push(`\n${list.footerLeft} · ${list.footerRight}`)
  return out.join('\n')
}

/** 指令列表（/newapi help）用文本表格，不渲染卡片。 */
export function renderHelp(prefix: string, items: Array<{ usage: string, desc: string }>): string {
  const out = [`New API 状态查询 · 指令前缀 ${prefix}`, line()]
  for (const item of items) out.push(`${item.usage}\n    ${item.desc}`)
  return out.join('\n')
}

export function renderError(title: string, detail: string): string {
  return [`✕ ${title}`, detail].filter(Boolean).join('\n')
}
