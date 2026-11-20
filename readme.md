# koishi-plugin-newapi-status

在 Koishi 里查询 [New API](https://docs.newapi.ai) 站点的运行状态、模型表现、分组倍率、监控可用性。

- 站点名 / 版本 / 运行时长 / 接口延迟 / 可访问性
- 模型列表与模糊搜索、单模型成功率 / 平均延迟 / 首 Token / TPS + 每小时成功率色块
- 分组倍率、分组状态、模型倍率与补全倍率
- 站点线路（`/api/status` 的 `api_info`）逐条实测可达性与延迟；没有线路信息时退回 Uptime Kuma
- 用你自己的 `sk-` key 发一条最短对话请求，测总耗时与首 Token 耗时
- 可选定时巡检：站点从「可用 → 不可用」时告警、恢复时通知；填了 `monitor.apiKey` 还会对 `/v1/models` 做差集轮询，模型因渠道被禁而消失时告警、恢复时通知
- 装了 puppeteer 出图片卡片，没装自动降级为纯文本

## 安装

```bash
# 用户安装
yarn add koishi-plugin-newapi-status
```

在控制台「插件配置」里搜索 `newapi-status`（Koishi 会去掉 `koishi-plugin-` 前缀）添加，然后至少填 `baseUrl`。

想用图片卡片，需要再装一个 puppeteer 服务，例如：

```bash
yarn add koishi-plugin-puppeteer
# 或不需要 canvas 的精简版
yarn add @shangxueink/koishi-plugin-puppeteer-without-canvas
```

两者都满足本插件的 `puppeteer` 可选依赖；本插件不关心你装的是哪一个。

## 两种令牌，别填错

New API 有两套完全不同的凭据，填错了只会看到 401 / 403：

| 用途 | 长什么样 | 填在哪 |
| --- | --- | --- |
| **面板访问令牌**（access_token 或 PAT） | 不带 `sk-` 前缀的一串字符，在「个人设置 → 安全与访问 → 访问令牌」生成 | `accessToken` |
| **调用令牌**（relay key） | `sk-` 开头，在「令牌」页面新建 | 只在 `test.presets[].key` 或 `/newapi test <模型> sk-xxx` 里用 |

- 本插件查的**站点状态、模型、分组、倍率**属于面板接口，要用**面板访问令牌**。
- `/newapi test` 打的是 `POST /v1/chat/completions`，要用 **`sk-` 调用令牌**，两者不能互换。
- `accessToken` 在控制台里是 secret 字段，不会回显；插件任何日志和回复里都不会出现它（有单测覆盖）。
- 只读指令（status / notice / about / network、模型的 pricing 部分）在不填 `accessToken` 时也能用，只是遇到需要登录的接口会提示需要令牌。

### `userId` 在哪查

在面板右上角头像 → **个人设置 / 个人资料**，用户信息卡的角色标签旁边就是 `ID: 123` 这样的数字（源码位置：`web/src/components/settings/personal/components/UserInfoHeader.jsx` 里渲染 `ID: {userState?.user?.id}`）。

为什么需要它：

| New API 版本 | 是否必须填 `userId` |
| --- | --- |
| **v0.13.x 及更早** | **必须**。鉴权中间件要求请求头带 `New-Api-User: <你的用户 ID>`，缺了直接 401（`用户 ID 未提供`），对不上也是 401（`用户 ID 不匹配`）。插件已按此实现，只要 `userId > 0` 就会带上这个头。 |
| **v1.0.0-rc.1 及以后**（含 main） | 不需要，后端只认 `Authorization: Bearer <access_token / PAT>`。填了也无副作用（老版本兼容用）。 |

## 版本要求

| 指令 | 依赖的接口 | 最低版本 |
| --- | --- | --- |
| `status` `notice` `about` | `/api/status` `/api/notice` `/api/about`（无需鉴权） | 都能用 |
| `group` `group status` `model list` `model search` | `/api/pricing` | 都能用（老版本该接口实际是公开的） |
| `group ratio` | `/api/pricing`；兜底公开接口 `/api/ratio_config` | 都能用 |
| `model status` `model health` | `/api/perf-metrics`、`/api/perf-metrics/summary` | **v1.0.0-rc.1+** |
| `network` | `/api/status` 的 `api_info`；兜底 `/api/uptime/status` | 都能用（后者需站点开启 Uptime Kuma 集成） |

老站点没有 `/api/perf-metrics`，`model status` / `model health` 会返回 404，插件会给出可读的报错而不是崩掉。

**关于 `model health` 的时间粒度**：New API 的 perf-metrics 按小时分桶（`perf_metrics_setting.BucketTime` 默认 `hour`，桶宽 3600 秒），**拿不到分钟级数据**。所以本指令统计的是「最近 N 个整点小时内」的成功率，默认 1 小时，由 `healthHours` 控制，卡片和文本里都会标明窗口。要严格意义上的「近 1 分钟」需要 New API 自己先改成分级聚合。

## 指令

默认前缀是 `newapi`，可以用 `commandPrefix` 改成 `api`、`nekoapi`，或用逗号写多个前缀（`api, nekoapi`）。

| 指令 | 说明 |
| --- | --- |
| `newapi help` | 列出全部指令和用法（`newapi` 单独发也等价于 help） |
| `newapi status` | 站点名、版本、运行时长、接口延迟、能不能访问 |
| `newapi notice` | 最新时间线与站内公告（条数由 `noticeLimit` 控制） |
| `newapi about` | 关于本插件 + 站点自己的 about 文案 |
| `newapi model search <关键词>` | 模糊搜索模型名 |
| `newapi model list [供应商]` | 站点可用模型列表，可按供应商过滤 |
| `newapi model status <模型> [-t 小时] [-g 分组]` | 成功率、平均延迟、首 Token 延迟、TPS，按分组列出，附每小时成功率色块 |
| `newapi model health` | 列出近 `healthHours` 小时成功率高于 `healthThreshold` 的模型及其分组 |
| `newapi group` | 分组列表、每个分组的倍率和说明 |
| `newapi group ratio [模型]` | 模型倍率和补全倍率。定价表里查不到的模型会回落到公开接口 `/api/ratio_config`（该接口的 `model_ratio` 条目比 `/api/pricing` 更全） |
| `newapi group status [分组]` | 分组状态，不写分组就是全部 |
| `newapi group search <关键词>` | 模糊搜索分组名 |
| `newapi network [名称]` | 列出站点线路（或 Uptime Kuma 监控项）的在线状态，带名称查单个 |
| `newapi test <模型> [预设keyId \| sk-令牌]` | 发一条最短对话请求，返回成功/失败、总耗时、首 Token 耗时 |
| `newapi test list` | 列出配置里预设的 keyId 与分组 |

`newapi test` 需要 **3 级权限**（`authority:3`）。低权限用户调用会被 Koishi 拒绝，回复「权限不足」，且不会把 key 写进任何输出。

> `newapi help` 不自己拼文本，而是调用 Koishi 官方的 [help 插件](https://help.koishi.chat/)（`session.execute({ name: 'help' }, true)`）渲染，再把你配置的 `helpText` 追加在末尾。
>
> - 根指令只列**一层**子指令（`about` / `group` / `help` / `model` / `network` / `notice` / `status` / `test`），二级指令的用法交给 `-h`：`newapi model -h` 看模型相关用法，`newapi model status -h` 看选项和示例。
> - **一次调用只发一条消息**。新版 `@koishijs/plugin-help`（≥ 2.4）会把帮助正文返回给我们，`helpText` 能正常追加；旧版本 help 是在自己内部 `session.send()` 之后返回空值，此时插件不再补发第二条（代价是旧版本上 `helpText` 不显示）。所以如果发现底部自定义文本没生效，先升级 `@koishijs/plugin-help`。
> - 完全没装 help 插件时，退回插件内置的指令清单，同样追加 `helpText`。

> `newapi test list` 之所以能匹配到 `newapi test`：Koishi 的命令解析遇到带参数的命令会先停在该命令上，所以 `list` 会作为参数传进 `test`，由插件内部特判。这是 Koishi 的既定行为，不是 bug。

## 配置项

### 基础设置

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `baseUrl` | string | 必填 | 站点地址，如 `https://api.example.com`。填到站点根即可，末尾误带的 `/v1`、`/api` 会自动剥掉 |
| `accessToken` | string（secret） | `''` | 面板 access_token / PAT。**不是 `sk-` 开头的调用令牌** |
| `userId` | number | `0` | 面板用户 ID。v0.13 及以前必须填（用于 `New-Api-User` 头），v1.0+ 可留 0 |
| `commandPrefix` | string | `newapi` | 指令前缀，支持逗号分隔多个 |
| `timeout` | number | `10000` | 单次 HTTP 请求超时（毫秒） |
| `logLevel` | `silent` \| `error` \| `info` \| `debug` | `info` | 注册给 Koishi 的日志等级，作用于 `ctx.logger('newapi-status')`。`debug` 会额外打出每次请求的地址与耗时 |

### 展示设置

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `render` | `auto` \| `image` \| `text` | `auto` | `auto` 有 puppeteer 就出图、没有就出文本；`image` 强制出图；`text` 强制纯文本 |
| `noticeLimit` | number | `3` | 公告 / 时间线最多展示几条 |
| `perfHours` | number | `24` | `model status` 默认统计窗口（小时），上限 720（New API 的上限是 30 天） |
| `healthHours` | number | `1` | `model health` 的统计窗口（小时） |
| `healthThreshold` | number | `95` | `model health` 的成功率阈值（0–100） |
| `helpText` | string | `''` | 追加在 `help` 输出最末尾的自定义文本，支持多行。留空则不加 |

延迟配色：`< 1500ms` 绿、`1500–5000ms` 黄、`> 5000ms` 红、无数据灰。

### 巡检设置（`monitor`）

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | 开启定时巡检 |
| `interval` | number | `300` | 巡检间隔（秒），最小 30 |
| `cron` | string | `''` | 改用 cron 表达式调度，需另装 [koishi-plugin-cron](https://cron.koishi.chat/)；没装则自动退回固定间隔 |
| `channels` | string[] | `[]` | 收告警的频道，形如 `onebot:123456789`。**必须先在 Koishi 数据库里把该频道 assignee 设好，`ctx.broadcast` 才能投递** |
| `apiKey` | string（secret） | `''` | 巡检用的 `sk-` 调用令牌。**填了才会做模型清单轮询**，不能填面板 access_token |
| `models` | string[] | `[]` | 重点盯的模型名；留空则监控整份 `/v1/models` 清单，任何模型消失都告警 |
| `threshold` | number | `2` | 连续失败多少次才告警，避免网络抖动刷屏 |

巡检会发四类消息，全部是**状态跃迁触发**（同一次故障只发一次，不是每次轮询都刷）：

| 场景 | 消息 |
| --- | --- |
| 站点从可用变不可用 | `⚠️ New API 无法访问` |
| 站点恢复 | `✅ New API 已恢复访问` |
| 模型从 `/v1/models` 消失 | `⚠️ 有 N 个模型从 /v1/models 消失（可能是渠道被禁用或无可用渠道）` |
| 模型重新出现 | `✅ 有 N 个模型恢复可用` |

**巡检口径（重要，别被「渠道」两个字带偏）**

1. **站点可用性**：只探**无需鉴权**的 `/api/status`，看是否可达、是否返回正常。这条永远生效。
2. **模型/渠道状态**：New API 的 `/api/channel/*` 全部挂在 `AdminAuth()` 上（`router/channel-router.go`：`channelRoute.Use(middleware.AdminAuth())`），普通 access_token 拿不到渠道列表和渠道状态，只有站点管理员凭据才行。用管理员凭据做巡检等于把一个高权限令牌长期放在机器人里，不划算。
   所以插件改用**唯一不需要 AdminAuth 的等价观测口径**：`GET /v1/models`（`monitor.apiKey`，`sk-` 调用令牌）返回「当前有可用渠道的模型清单」，**管理员在后台禁用一个渠道后，该渠道承载的模型会从这份清单里消失**。插件每轮拉一次清单、和上一次做差集，消失即告警、回来即恢复。
3. 首次拉取只建立基线、不告警（没有上一份快照就谈不上「消失」）。`/v1/models` 拉取失败（例如 key 无效）只写 warn 日志，**不会误报成「模型全部消失」**。

想验证整条告警链路：把 `monitor.interval` 改成 `60`，在 New API 后台禁用一个渠道，等一两分钟就能在 `monitor.channels` 指定的群里看到告警；重新启用后收到恢复通知。

### 测试设置（`test`）

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enabled` | boolean | `false` | 开启 `/newapi test`。默认关闭，避免没配 key 的站点误触 |
| `model` | string | `gpt-4o-mini` | 指令里没写模型时的默认模型 |
| `prompt` | string | `hi` | 测试用的最短提示词 |
| `maxTokens` | number | `16` | 测试请求的 `max_tokens` |
| `timeout` | number | `30000` | 测试请求超时（毫秒） |
| `presets` | dict | `{}` | `keyId → { key, model, group }`。`key` 必须是 `sk-` 开头的调用令牌 |

`presets` 存在的意义：让用户在群里发 `/newapi test gpt-4o-mini fast` 就能用预设的 key 测试，而不是把 `sk-` 打在聊天记录里。`newapi test list` 只会显示 keyId 和掩码后的 key（前 3 位 + `***` + 后 2 位）。

**首 Token 耗时的口径**：插件用 `stream: true` 请求，取**第一个有效增量**到达的时刻。推理模型（如实测的 `deepseek-v4.1-flash`）会先吐 `reasoning_content` 再吐 `content`，插件把两者都算作「首 Token」——否则只认 `content` 的模型首 Token 会退化成总耗时。返回里带「回复预览」时说明确实收到了内容。

## 图片卡片

`render` 为 `auto`（默认）且宿主装了 puppeteer 时，各指令返回图片卡片；否则返回纯文本，内容一致。

- 卡片风格是**暗色玻璃拟态（dark glassmorphism）**：深色渐变底 + 多层径向光晕、半透明玻璃卡片（`backdrop-filter: blur() saturate()`）、胶囊状态标签、带光晕的状态点、彩色度量条。
- 卡面内容宽 660px，截图按 2x 输出（实际 1416px 宽），在手机和桌面端都不糊。
- 配色语义：绿 `#30d158` 正常 / 黄 `#ffd60a` 波动 / 红 `#ff453a` 异常 / 灰 无数据。
- 长列表（模型列表、分组、模型健康度）统一**折叠到 24 行**并在末尾提示「还有 N 条未显示，用关键词筛选」——真实站点有 86 个模型、30 个分组，全量渲染会得到一张几千像素高的图，客户端加载不动。
- 想强制看文本：把 `render` 设成 `text`，或直接卸载 puppeteer。
- 出图失败（浏览器崩了、内存不够）会自动降级为文本并在日志里 warn，不会让指令整个失败。

## 开发

```bash
cd external/newapi-status
yarn build       # tsc -p tsconfig.json
yarn typecheck   # tsc --noEmit
yarn test        # vitest run
```

测试覆盖三层：

- `tests/format.test.ts` —— 纯函数：额度换算、时间格式化、延迟分档、状态映射、成功率分档、公告解析。
- `tests/monitor.test.ts` —— 巡检状态机：连续失败达到阈值才告警、同一次故障只告警一次、恢复后重新可告警、不污染配置里的频道数组、`/v1/models` 差集告警与恢复、拉取失败时不误报模型消失。
- `tests/integration.test.ts` —— 起一个假 New API 站点，把插件装进真实 Koishi App，走完整消息管线（middleware → 指令解析 → 权限门控 → action → 发送），断言每条指令的输出、权限拒绝、令牌不泄漏、`New-Api-User` / `Authorization` 头。

## 目录结构

```
src/
├─ index.ts          # 入口：name / inject / Config / apply，注册指令
├─ config.ts         # Schema 定义
├─ types.ts          # 接口返回类型
├─ format.ts         # 额度换算、时间、状态映射（纯函数）
├─ view.ts           # 从接口数据组装卡片视图模型
├─ text.ts           # 没有 puppeteer 时的纯文本输出
├─ monitor.ts        # 定时巡检与告警
├─ api/
│  ├─ shared.ts      # 请求封装、错误脱敏、延迟分档
│  ├─ status.ts notice.ts pricing.ts models.ts uptime.ts perf.ts relay.ts
│  └─ index.ts
└─ render/
   ├─ index.ts       # React → HTML → puppeteer 截图
   ├─ StatusCard.tsx ChannelCard.tsx
   └─ styles.ts      # 内联 CSS
```

## License

本项目**不是**开源软件。代码版权归 acmuhan 所有，许可证为自定义的《专有软件许可协议》
（`LicenseRef-Proprietary`，见仓库根目录 `LICENSE`）。

- 允许：通过 npm 安装并在自用 Koishi 实例中运行、未修改地随自己的实例部署、阅读源码学习与评估。
- 需要事先书面授权：复制或摘录源码、修改/二次开发后使用、分发或再发布、商业用途、对外提供收费服务。

授权申请请到 <https://github.com/acmuhan/koishi-plugin-newapi-status/issues> 提交 issue。
