// Host 服务：把 UsageAccountant 接到 Typert Remote，暴露 tokenStats/read 与 refresh。
//
// 账本逻辑在 accountant.js（纯依赖注入，可单测）；这一层只负责：
// 从 Cordis 取 sessions / sessionQuery 两个服务，以及把结果格式化给客户端。
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

import { UsageAccountant } from './accountant.js'
import { normalizeOptions } from './options.js'
import { createStore } from './store.js'

/** 取一个可选服务；没挂载就返回 undefined。 */
function optionalService(ctx, name) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

export class TokenStatsService extends TypertRemoteService {
  constructor(ctx, options = {}) {
    super(ctx, 'tokenStats')
    const normalized = normalizeOptions(options)
    this.accountant = new UsageAccountant({
      store: createStore({ path: normalized.path }),
      options: normalized,
      liveSessions: () => {
        const sessions = optionalService(this.ctx, 'sessions')
        return sessions !== undefined && sessions !== null && typeof sessions.list === 'function'
          ? sessions.list() ?? []
          : []
      },
      query: () => optionalService(this.ctx, 'sessionQuery'),
    })
  }

  /** 客户端读一次：当前汇总（首次会顺带启动历史回填）。 */
  async read() {
    return this.accountant.read()
  }

  /** 手动刷新：跳过扫描节流并立刻落盘。 */
  async refresh() {
    return this.accountant.refresh()
  }

  /** 卸载：把账本落盘；Cordis 的销毁器不 await，但写入会在后台完成。 */
  dispose() {
    return this.accountant.dispose()
  }
}

export default TokenStatsService
