/** @jsxImportSource react */
import type { ReactNode } from 'react'
import type { ListView } from '../view'

export function ChannelCard({ list }: { list: ListView }): ReactNode {
  // 列表可能很长（真实站点有 30+ 分组、86 个模型），超出 limit 的部分折叠成一行提示，
  // 否则截图会变成一张几千像素高的图，客户端加载不动。
  const limit = list.limit && list.limit > 0 ? list.limit : 24
  const rows = list.rows.slice(0, limit)
  const hidden = list.rows.length - rows.length
  return (
    <div className="card">
      <div className="card-head">
        <div className="logo">{(list.title || 'L').slice(0, 1).toUpperCase()}</div>
        <div className="head-main">
          <div className="site-name">{list.title}</div>
          <div className="site-sub">{list.subtitle || list.note || ''}</div>
        </div>
        {list.note && list.subtitle ? <div className="badges"><span className="badge">{list.note}</span></div> : null}
      </div>

      <div className="section">
        {rows.length ? (
          <div className="list">
            {rows.map((row, index) => (
              <div className={`list-row${row.wrap ? ' wrap' : ''}`} key={index}>
                <span className={`dot ${row.level || 'unknown'}`} />
                <span className="list-name">{row.name}</span>
                {row.tag ? <span className="list-tag">{row.tag}</span> : null}
                {row.value ? <span className="list-value">{row.value}</span> : null}
              </div>
            ))}
            {hidden > 0 ? <div className="list-more">还有 {hidden} 条未显示，用关键词筛选</div> : null}
          </div>
        ) : (
          <div className="empty">{list.empty || '暂无数据'}</div>
        )}
      </div>

      <div className="card-foot">
        <span>{list.footerLeft}</span>
        <span>{list.footerRight}</span>
      </div>
    </div>
  )
}
