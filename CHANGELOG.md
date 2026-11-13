# Changelog

## 0.1.0

首个版本。

- **设置 → Token 用量** 页：今日 / 本周 / 本月三张卡，日 / 周 / 月三种趋势柱状图，模型分布与占比。
- 数据来自会话日志里的 `assistant/message` 与 `assistant/attempt` usage（含子代理），按本机时区切日、周一为周起点。
- 首次打开后台回填历史会话并显示进度；之后按会话游标增量折叠，不重复扫描。
- fork 继承的事件前缀不重复计数。
- 账本落 `$DSH_HOME/token-stats/usage.json`（原子写、0600、只存计数不存正文），超过保留天数的记录落盘时裁掉。
- 趋势柱按输入 / 缓存读写 / 输出三段堆叠；模型分布与会话消耗都与趋势窗口一致。
- 会话消耗列表：按会话汇总 token、调用次数、最后活动时间与占比；默认前 5 个，可「加载更多」每次 +10 / 收起。
- 会话标题读浏览器侧会话列表（与侧边栏同源），不再逐个读会话日志；Host 侧的 `session/title` 采集保留作兜底。
- 页面开着时每 30 秒自动刷新（回填期间 1.2 秒），切回前台立即刷新；刷新失败保留上次数据并自动重试。
- 提供 `tokenStats/read` 与 `tokenStats/refresh` 两个 Remote 调用；页面只用 React + slots / remote。
- 配置：`historyDays` / `retainDays` / `dayCount` / `weekCount` / `monthCount` / `path`。
