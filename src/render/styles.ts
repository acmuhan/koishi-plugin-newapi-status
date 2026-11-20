/**
 * 暗色玻璃拟态（dark glassmorphism）样式。
 * 视觉基线取自用户确认的站内「渠道状态」大屏：深色底 + 半透明玻璃卡 + 彩色状态点 + 双色度量块。
 * puppeteer 用 Chrome headless 渲染，backdrop-filter / 渐变 / 阴影都支持。
 */
export const CARD_WIDTH = 660

export const COLORS = {
  bg: '#0b0c10',
  surface: 'rgba(255,255,255,0.055)',
  surfaceStrong: 'rgba(255,255,255,0.085)',
  border: 'rgba(255,255,255,0.10)',
  borderSoft: 'rgba(255,255,255,0.07)',
  text: '#f2f4f8',
  textSecondary: 'rgba(232,236,244,0.64)',
  textFaint: 'rgba(232,236,244,0.40)',
  accent: '#0a84ff',
  accent2: '#5ac8fa',
  ok: '#30d158',
  warn: '#ffd60a',
  fail: '#ff453a',
  orange: '#ff9f0a',
} as const

export const CSS = `
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: ${COLORS.bg}; }
body {
  display: inline-block; min-width: ${CARD_WIDTH + 48}px;
  background:
    radial-gradient(900px 420px at 10% -12%, rgba(10,132,255,0.22), transparent 62%),
    radial-gradient(760px 380px at 108% 6%, rgba(48,209,88,0.14), transparent 64%),
    radial-gradient(620px 320px at 50% 116%, rgba(255,159,10,0.10), transparent 66%),
    linear-gradient(180deg, #12141a 0%, #0b0c10 62%, #07080b 100%);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  color: ${COLORS.text};
  -webkit-font-smoothing: antialiased;
}
.card {
  width: ${CARD_WIDTH}px;
  margin: 20px;
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.032));
  border: 1px solid ${COLORS.border};
  box-shadow: 0 26px 64px rgba(0,0,0,0.58), inset 0 1px 0 rgba(255,255,255,0.09);
  backdrop-filter: blur(26px) saturate(150%);
  -webkit-backdrop-filter: blur(26px) saturate(150%);
  overflow: hidden;
}
.card-head {
  display: flex; align-items: center; gap: 13px;
  padding: 19px 22px 16px;
}
.logo {
  width: 40px; height: 40px; border-radius: 13px; flex: none;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 650; color: #fff;
  background: linear-gradient(150deg, #0a84ff, #6a5cff 54%, #30d158);
  box-shadow: 0 8px 22px rgba(10,132,255,0.42), inset 0 1px 0 rgba(255,255,255,0.35);
}
.head-main { flex: 1; min-width: 0; }
.site-name { font-size: 17.5px; font-weight: 650; letter-spacing: .2px; line-height: 1.25; }
.site-sub { font-size: 11.5px; color: ${COLORS.textFaint}; margin-top: 4px; letter-spacing: .2px; }
.badges { display: flex; align-items: center; gap: 7px; flex: none; }
.badge {
  font-size: 11.5px; padding: 4px 11px; border-radius: 999px; white-space: nowrap;
  border: 1px solid ${COLORS.borderSoft}; color: ${COLORS.textSecondary};
  background: rgba(255,255,255,0.045); font-variant-numeric: tabular-nums;
}
.badge.ok { color: #6ff0a0; background: rgba(48,209,88,0.13); border-color: rgba(48,209,88,0.30); }
.badge.warn { color: ${COLORS.warn}; background: rgba(255,214,10,0.12); border-color: rgba(255,214,10,0.28); }
.badge.fail { color: #ff8b83; background: rgba(255,69,58,0.14); border-color: rgba(255,69,58,0.32); }
.metrics {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
  padding: 0 18px 16px;
}
.metric {
  padding: 12px 14px 13px; border-radius: 15px;
  background: rgba(255,255,255,0.048);
  border: 1px solid ${COLORS.borderSoft};
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.05);
  min-width: 0;
}
.metric-k { font-size: 10.5px; color: ${COLORS.textFaint}; letter-spacing: .3px; }
.metric-v {
  font-size: 20px; font-weight: 620; margin-top: 7px; line-height: 1.15;
  font-variant-numeric: tabular-nums; letter-spacing: .2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.metric-v.ok { color: #5ef08f; }
.metric-v.warn { color: ${COLORS.warn}; }
.metric-v.fail { color: #ff6f66; }
.metric-sub { font-size: 10.5px; color: ${COLORS.textFaint}; margin-top: 5px; }
.section { padding: 15px 22px 17px; border-top: 1px solid ${COLORS.borderSoft}; }
.section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 11px; gap: 10px; }
.section-title { font-size: 12.5px; font-weight: 600; letter-spacing: .3px; color: rgba(255,255,255,0.88); }
.section-note { font-size: 10.5px; color: ${COLORS.textFaint}; font-variant-numeric: tabular-nums; white-space: nowrap; }
.row { display: flex; align-items: center; gap: 11px; padding: 5px 0; }
.row-name {
  font-size: 12.5px; flex: none; width: 176px; color: rgba(255,255,255,0.82);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.row-bar { flex: 1; height: 7px; border-radius: 999px; background: rgba(255,255,255,0.07); overflow: hidden; }
.row-bar > i {
  display: block; height: 100%; border-radius: 999px;
  background: linear-gradient(90deg, ${COLORS.accent}, ${COLORS.accent2});
  box-shadow: 0 0 12px rgba(10,132,255,0.55);
}
.row-bar.warn > i { background: linear-gradient(90deg, ${COLORS.orange}, ${COLORS.warn}); box-shadow: 0 0 12px rgba(255,159,10,0.5); }
.row-bar.fail > i { background: linear-gradient(90deg, #ff453a, #ff9f0a); box-shadow: 0 0 12px rgba(255,69,58,0.5); }
.row-value {
  font-size: 11.5px; color: ${COLORS.textSecondary}; font-variant-numeric: tabular-nums;
  min-width: 88px; text-align: right; white-space: nowrap;
}
.blocks { display: flex; gap: 3px; margin-top: 2px; }
.block { flex: 1; height: 30px; border-radius: 5px; background: rgba(255,255,255,0.09); }
.block.ok { background: linear-gradient(180deg, #4ff08b, #22b24b); box-shadow: 0 0 14px rgba(48,209,88,0.42); }
.block.warn { background: linear-gradient(180deg, #ffe066, #e0a800); box-shadow: 0 0 14px rgba(255,214,10,0.35); }
.block.fail { background: linear-gradient(180deg, #ff7369, #d92a1f); box-shadow: 0 0 14px rgba(255,69,58,0.45); }
.axis {
  display: flex; justify-content: space-between; font-size: 10px;
  color: ${COLORS.textFaint}; margin-top: 8px; font-variant-numeric: tabular-nums;
}
.legend { display: flex; gap: 15px; font-size: 10.5px; color: ${COLORS.textSecondary}; margin-top: 11px; }
.legend i { display: inline-block; width: 7px; height: 7px; border-radius: 5px; margin-right: 6px; vertical-align: 1px; }
.notice {
  display: flex; gap: 11px; padding: 13px 22px;
  background: rgba(255,214,10,0.075);
  border-top: 1px solid rgba(255,214,10,0.18);
  border-bottom: 1px solid rgba(255,214,10,0.10);
}
.notice-tag {
  /* align-self：否则 flex 布局默认 stretch，标签会被拉到和公告正文一样高，变成一个竖椭圆 */
  align-self: flex-start; white-space: nowrap;
  flex: none; font-size: 10.5px; color: ${COLORS.warn};
  background: rgba(255,214,10,0.15); border: 1px solid rgba(255,214,10,0.30);
  border-radius: 999px; padding: 2px 9px; line-height: 15px; letter-spacing: .3px;
}
.notice-body { font-size: 11.5px; color: rgba(255,236,180,0.86); line-height: 19px; }
.card-foot {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 22px; background: rgba(0,0,0,0.22);
  font-size: 10px; color: ${COLORS.textFaint}; letter-spacing: .3px;
  font-variant-numeric: tabular-nums;
}
.list { display: flex; flex-direction: column; }
.list-row {
  display: flex; align-items: center; gap: 11px; padding: 9px 0;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.list-row:last-child { border-bottom: none; }
.dot {
  width: 7px; height: 7px; border-radius: 50%; flex: none;
  background: rgba(255,255,255,0.22);
}
.dot.ok { background: ${COLORS.ok}; box-shadow: 0 0 10px rgba(48,209,88,0.75); }
.dot.warn { background: ${COLORS.warn}; box-shadow: 0 0 10px rgba(255,214,10,0.7); }
.dot.fail { background: ${COLORS.fail}; box-shadow: 0 0 10px rgba(255,69,58,0.75); }
.list-name {
  font-size: 12.5px; flex: 1; min-width: 0; color: rgba(255,255,255,0.85);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.list-tag {
  flex: none; font-size: 10px; color: ${COLORS.textSecondary};
  background: rgba(255,255,255,0.06); border: 1px solid ${COLORS.borderSoft};
  border-radius: 999px; padding: 2px 8px; max-width: 210px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.list-value {
  flex: none; font-size: 11px; font-variant-numeric: tabular-nums;
  color: ${COLORS.textSecondary}; white-space: nowrap; max-width: 400px;
  overflow: hidden; text-overflow: ellipsis;
}
.list-row.wrap { align-items: flex-start; }
.list-row.wrap .list-name { flex: none; width: 64px; color: ${COLORS.textFaint}; font-size: 11px; padding-top: 1px; }
.list-row.wrap .list-value {
  flex: 1; max-width: none; text-align: left; white-space: normal;
  line-height: 1.62; color: rgba(255,255,255,0.80);
}
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip {
  font-size: 11px; color: rgba(255,255,255,0.80);
  background: rgba(255,255,255,0.055); border: 1px solid ${COLORS.borderSoft};
  border-radius: 999px; padding: 3px 10px; font-variant-numeric: tabular-nums;
}
.list-more {
  font-size: 10.5px; color: ${COLORS.textFaint}; padding: 10px 0 2px; letter-spacing: .2px;
  border-top: 1px dashed rgba(255,255,255,0.08); margin-top: 6px;
}
.empty { font-size: 11.5px; color: ${COLORS.textFaint}; padding: 4px 0; }
`