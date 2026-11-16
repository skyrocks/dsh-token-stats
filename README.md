# dsh-token-stats

[![CI](https://github.com/skyrocks/dsh-token-stats/actions/workflows/ci.yml/badge.svg)](https://github.com/skyrocks/dsh-token-stats/actions/workflows/ci.yml)
![license](https://img.shields.io/badge/license-MIT-blue.svg)

DeepSeek Harness 插件：在 **设置 → Token 用量** 里按 **日 / 周 / 月** 统计所有会话的 token 消耗。

包含总用量、输入、缓存读写、输出、调用次数、趋势柱状图和模型分布；子代理会话一起算。

## 为什么单独做一个

对话里的「统计」页签只覆盖**当前**会话；而「这个月用了多少 token」要跨会话、跨子代理、跨重启。
这个插件把**所有**会话日志里的 `assistant/message` usage 折成一本账，按本机时区切成日 / 周 / 月，
一次扫描、之后增量更新。

它**不**调用模型、**不**改会话、**不**往会话里追加事件；账本单独存文件。

## 安装

在 DSH 桌面端：**设置 → 插件 → 添加插件**，粘贴下面的地址；或者直接用命令行：

```sh
# 跟随 GitHub 默认分支
dsh plugin --profile desktop add github:skyrocks/dsh-token-stats

# 或从插件索引的 CDN 直下
dsh plugin --profile desktop add "https://cdn.jsdelivr.net/gh/skyrocks/dsh-plugins@main/dist/skyrocks-dsh-token-stats-0.1.0.tgz"
```

装完**完全退出 DSH 再打开**（Host 插件只在启动时加载），然后进 **设置 → Token 用量**（左侧导航里带柱子图标的条目）。

本地开发时也可以直接选这个目录（或让 agent 用 `install_bundle`）。

## 页面上有什么

- **今日 / 本周 / 本月** 三张卡：总 token、输入、缓存、输出、调用次数。
- **趋势**：按天（近 14 天）/ 按周（近 12 周，周一为起点）/ 按月（近 12 个月）的柱状图，
  每根柱子顶上直接标数值，柱子按「输入 / 缓存读写 / 输出」三段堆叠；鼠标悬停看完整拆分。
- **模型分布**：跟随上面选中的趋势窗口（近 14 天 / 12 周 / 12 个月），按总量排序，带占比条。
- **会话消耗**：同一个窗口内按会话排序，显示标题、调用次数、最后活动时间和占比。默认显示前 5 个，点「加载更多」每次多看 10 个，也可以收起。标题直接读浏览器侧会话列表（和侧边栏同一份数据），所以不用等后台读日志；万一个别会话没有标题，退回「会话 + 短 id」。
- 首次打开会在卡片上方显示 **历史会话回填进度**；页面可以先关掉，Host 会继续扫。
- 页面开着时会每 30 秒自动更新一次（回填期间 1.2 秒一次），切回前台也会立即刷新。

## 口径

| 项 | 含义 |
|---|---|
| 输入 | 未命中缓存的输入 token（DSH 的 `inputTokens`） |
| 缓存读写 | `cacheReadTokens` + `cacheWriteTokens`，单独列 |
| 输出 | `outputTokens` |
| 合计 | 输入 + 缓存读写 + 输出，不依赖供应商的 `totalTokens`（那条可能缺失） |
| 调用 | 一条带 usage 的 `assistant/message`（落成消息）或 `assistant/attempt`（失败 / 重试但报了用量）算一次 |

- 时间按**本机时区**切日；周从**周一** 0 点开始；月是自然月。
- **fork 继承来的前缀不重复计数**：账本按会话自己的事件从 `inheritedEventCount` 之后开始算。
- 只统计**有 usage 的**结算；没有 usage 的历史消息（老适配器）不计入。
- 失败 / 重试但报了用量的尝试也计入调用次数（与 DSH 自己的 token 统计口径一致）；它们没有模型归因，模型分布里显示为「未知模型」。
- 只统计本机写入会话日志的用量，官网后台的账单可能另含标题生成等内部调用，两者不必相等。

## 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: token-stats
  config:
    historyDays: 365   # 回填只看最近多久创建的会话（默认 365）
    retainDays: 400    # 账本保留天数（默认 400；会被 monthCount 窗口自动抬高到至少 403）
    dayCount: 14       # 日趋势柱数（默认 14）
    weekCount: 12      # 周趋势柱数（默认 12）
    monthCount: 12     # 月趋势柱数（默认 12）
    path: ~/.dsh/token-stats/usage.json   # 账本位置（默认如此）
```

## 数据与隐私

- 账本：`$DSH_HOME/token-stats/usage.json`（默认 `~/.dsh/token-stats/usage.json`，0600）。
  内容只有：会话 id、事件序号、时间、模型名、provider、四类 token 数。**没有**对话正文。
- 删掉这个文件 = 清空账本；下次打开设置页会重新回填（会再扫一遍历史会话）。
- 首次回填会读一遍持久化会话日志（只读、本机、异步）；几十个会话通常十几秒，进度可见。
- 卸载插件后这个文件保留，可以自己删。

## 已知限制

- **只统计本地日志里带 usage 的结算**：老适配器没报 usage 的消息不计；官网账单可能另含标题生成等内部调用，两边不必相等。
- **回填有范围**：默认只看最近 365 天创建的会话（`historyDays` 可调）；更早的会话不进账本。
- **首次打开要读一遍历史日志**：耗时取决于历史量，几十个会话通常十几秒；之后启动不重扫。
- **模型分布 / 会话排行最多各 300 行**：超出部分不返回，避免一次传输过大；前 5 个默认展示，其余靠「加载更多」。
- **会话排行不能点进去**：只做统计，不跳转会话。
- **单位是「万 / 亿」**：一万以下显示完整数字，卡片数字悬停可看精确值。

## 实现

| 文件 | 职责 |
|---|---|
| `index.js` | Host 入口：建服务、随插件卸载释放 |
| `service.js` | `TypertRemoteService`，把 `tokenStats/read` `tokenStats/refresh` 暴露给页面 |
| `accountant.js` | 账本：活跃会话增量折叠、历史回填（带进度、单飞、节流）、落盘 |
| `ledger.js` | 纯函数：事件 → 用量记录，日 / 周 / 月分桶与模型汇总 |
| `store.js` | 原子写 JSON，坏文件不崩 |
| `options.js` | 配置归一（坏值退默认） |
| `client.js` | 设置页（手写 lazy-CJS，只用 React 与 slots / remote） |
| `typert.host.js` | Remote 调用清单与结果校验 |

## 测试

```sh
node test/smoke.mjs       # 折叠、分桶边界、序列、配置与落盘归一
node test/accountant.mjs  # 增量折叠、fork 去重、历史回填、重启恢复、裁剪
node test/client.mjs      # 客户端模块加载与设置页 / 图标的 slot 注册
```
