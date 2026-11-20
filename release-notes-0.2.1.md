## koishi-plugin-newapi-status v0.2.1

### 修复
- **help 里看不到二级子指令**：Koishi help 插件只列一层子指令，`/newapi help` 原先看不到 `newapi model status`、`newapi group ratio`、`newapi test list` 等用法。现在监听 `help/command` 事件，把二级子指令补进同一份 help 输出——**仍然只发一条消息**，不额外刷屏。
- 二级子指令清单直接从指令注册表读取，与实际注册的指令永远一致（不会漏项/错项）。

### 说明
- 帮助统一走 Koishi 官方 help 插件；`helpText` 配置项的自定义文本追加在最末尾。
- 若本机未安装 `@koishijs/plugin-help`，回退到插件内置的指令清单，同样带上 `helpText`。

### 升级提示
升级后请**重启 Koishi 实例**，否则仍会跑旧的构建产物。
