import { Context, h } from 'koishi'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderCardText, renderListText } from '../text'
import type { CardView, ListView } from '../view'
import { ChannelCard } from './ChannelCard'
import { StatusCard } from './StatusCard'
import { CARD_WIDTH, CSS } from './styles'

export type RenderMode = 'auto' | 'image' | 'text'

export interface RenderOptions {
  mode: RenderMode
  /** 关闭时即使装了 puppeteer 也只输出文字 */
  enabled: boolean
}

function puppeteerOf(ctx: Context): { render: (html: string) => Promise<string> } | undefined {
  try {
    return (ctx as any).puppeteer ?? undefined
  } catch {
    return undefined
  }
}

function wrap(body: string, title: string): string {
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${CSS}</style>`,
    '</head><body>',
    body,
    '</body></html>',
  ].join('')
}

function escapeHtml(text: string): string {
  return String(text).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char] as string)
}

/**
 * 把视图渲染成消息元素。
 * image 分支返回 puppeteer 给的图片标记（字符串形式，交给 h 解析）；
 * text 分支必须用 h.text 包裹，避免正文里的尖括号被当成元素标记。
 */
async function render(
  ctx: Context,
  mode: RenderMode,
  body: string,
  title: string,
  fallback: () => string,
): Promise<h.Fragment> {
  if (mode === 'text') return h.text(fallback())
  const puppeteer = puppeteerOf(ctx)
  if (!puppeteer) {
    const text = fallback()
    if (mode === 'image') return h.text(`${text}\n\n（未启用 puppeteer 服务，已降级为文字）`)
    return h.text(text)
  }
  try {
    return await puppeteer.render(wrap(body, title))
  } catch (error) {
    ctx.logger('newapi-status').warn('卡片渲染失败，降级为文字输出：%s', (error as Error)?.message)
    return h.text(`${fallback()}\n\n（卡片渲染失败，已降级为文字）`)
  }
}

export async function renderCard(ctx: Context, card: CardView, options: RenderOptions): Promise<h.Fragment> {
  const body = renderToStaticMarkup(StatusCard({ card }))
  return render(ctx, options.enabled ? options.mode : 'text', body, card.siteName, () => renderCardText(card))
}

export async function renderList(ctx: Context, list: ListView, options: RenderOptions): Promise<h.Fragment> {
  const body = renderToStaticMarkup(ChannelCard({ list }))
  return render(ctx, options.enabled ? options.mode : 'text', body, list.title, () => renderListText(list))
}

export { CARD_WIDTH }
