import { defineConfig } from 'vitest/config'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

/**
 * koishi 的 ESM 入口（lib/index.mjs）在 vitest 下会把 @koishijs/loader 的 CJS
 * 默认导出当成命名空间对象，导致 `class NodeLoader extends Loader` 抛
 * "Class extends value #<Object> is not a constructor"。真实 Node 运行时走
 * require 分支没有这个问题，所以测试里显式固定到 CJS 产物。
 */
export default defineConfig({
  resolve: {
    alias: {
      koishi: require.resolve('koishi'),
      '@koishijs/loader': require.resolve('@koishijs/loader'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
