## koishi-plugin-newapi-status v0.2.2

### 修复
- **help 仍然发两条**：根因是旧版 `@koishijs/plugin-help` 的 help 指令在自己的 action 里 `session.send()` 后返回空值——帮助已经发出去了，插件却因为拿不到正文又补发了一条内置清单。现在只要宿主存在 `help` 指令且没拿到正文，插件就**不再补发**，一次调用只有一条消息。
- 新版 help（≥ 2.4）行为不变：正文由插件返回，`helpText` 追加在末尾。

### 调整
- 根帮助只列一层子指令，不再额外塞「二级子指令」清单——二级用法交给 `-h`：`newapi model -h`、`newapi model status -h`。
- `newapi model` 补了使用示例，`-h` 里能直接看到 `-t` / `-g` 的写法。

### 升级提示
- 升级后请**重启** Koishi 实例并清掉旧的 `lib/` 缓存。
- 如果 `helpText` 没生效，说明宿主里的 `@koishijs/plugin-help` 太老（它在内部自行发送帮助，插件无法追加文本），升级到 ≥ 2.4 即可。