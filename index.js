// Host 半（插件入口）：建用量统计服务，交给 Typert Remote 暴露给设置页。
//
// 统计只读会话日志，不调用模型、不追加事件；数据落在
// $DSH_HOME/token-stats/usage.json，可用插件配置里的 path 改位置。
import { TokenStatsService } from './service.js'

/** 会话服务是必需依赖：没有它就无从折叠用量。 */
export const inject = ['sessions']

export function apply(ctx, config) {
  const service = new TokenStatsService(ctx, config)
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => service.dispose())
  }
}
