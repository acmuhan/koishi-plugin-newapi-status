/** @jsxImportSource react */
import type { ReactNode } from 'react'
import type { CardBlock, CardView } from '../view'
import { COLORS } from './styles'

function Badge({ tone, text }: { tone: string, text: string }): ReactNode {
  return <span className={`badge ${tone}`}>{text}</span>
}

function Blocks({ blocks }: { blocks: CardBlock[] }): ReactNode {
  if (!blocks.length) return null
  return (
    <div className="blocks">
      {blocks.map((block, index) => (
        <div key={index} className={`block ${block.level}`} title={block.label || ''} />
      ))}
    </div>
  )
}

export function StatusCard({ card }: { card: CardView }): ReactNode {
  return (
    <div className="card">
      <div className="card-head">
        <div className="logo">{(card.siteName || 'N').slice(0, 1).toUpperCase()}</div>
        <div className="head-main">
          <div className="site-name">{card.siteName}</div>
          <div className="site-sub">{card.sub}</div>
        </div>
        {card.badges.length ? (
          <div className="badges">
            {card.badges.map((badge, index) => <Badge key={index} tone={badge.tone} text={badge.text} />)}
          </div>
        ) : null}
      </div>

      {card.metrics.length ? (
        <div className="metrics">
          {card.metrics.map((metric, index) => (
            <div className="metric" key={index}>
              <div className="metric-k">{metric.key}</div>
              <div className={`metric-v${metric.level ? ' ' + metric.level : ''}`}>{metric.value}</div>
              {metric.sub ? <div className="metric-sub">{metric.sub}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      {card.sections.map((section, index) => (
        <div className="section" key={index}>
          <div className="section-head">
            <div className="section-title">{section.title}</div>
            {section.note ? <div className="section-note">{section.note}</div> : null}
          </div>
          {section.rows && section.rows.length ? (
            section.rows.map((row, rowIndex) => (
              <div className="row" key={rowIndex}>
                <div className="row-name">{row.name}</div>
                {row.ratio === undefined ? null : (
                  <div className={`row-bar${row.level ? ' ' + row.level : ''}`}>
                    <i style={{ width: `${Math.max(2, Math.min(100, Math.round(row.ratio * 100)))}%` }} />
                  </div>
                )}
                <div className="row-value">{row.value}</div>
              </div>
            ))
          ) : null}
          {section.blocks && section.blocks.length ? (
            <>
              <Blocks blocks={section.blocks} />
              {section.axis && section.axis.length ? (
                <div className="axis">
                  {section.axis.map((label, axisIndex) => <span key={axisIndex}>{label}</span>)}
                </div>
              ) : null}
              {section.legend ? (
                <div className="legend">
                  <span><i style={{ background: COLORS.ok }} />正常</span>
                  <span><i style={{ background: COLORS.warn }} />波动</span>
                  <span><i style={{ background: COLORS.fail }} />异常</span>
                  <span><i style={{ background: 'rgba(255,255,255,0.16)' }} />无数据</span>
                </div>
              ) : null}
            </>
          ) : null}
          {section.chips && section.chips.length ? (
            <div className="chips">
              {section.chips.map((chip, chipIndex) => <span className="chip" key={chipIndex}>{chip}</span>)}
            </div>
          ) : null}
          {!section.rows?.length && !section.blocks?.length && !section.chips?.length
            ? <div className="empty">{section.empty}</div>
            : null}
        </div>
      ))}

      {card.notice ? (
        <div className="notice">
          <div className="notice-tag">公告</div>
          <div className="notice-body">{card.notice.body}</div>
        </div>
      ) : null}

      <div className="card-foot">
        <span>{card.footerLeft}</span>
        <span>{card.footerRight}</span>
      </div>
    </div>
  )
}
