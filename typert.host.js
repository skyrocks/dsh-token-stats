// Typert Host 清单：声明 tokenStats/read 与 tokenStats/refresh 两个 direct 调用。
// 0.2.x 的 strict codec 必须是 `{ mode, typeSymbol, create() }`；这里不依赖 zod，
// 目录直装也不会缺包。Client 侧 client.js 里有一份形状相同的声明。
//
// 校验只做「客户端能安全读」的程度：结构不对就抛错，让网关把失败交回界面，
// 而不是把半个对象渲染出去。

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function fail(field, expected) {
  throw new Error(`dsh-token-stats result: ${field} must be ${expected}`)
}

function number(field, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(field, 'a finite number')
  return value
}

function count(field, value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) fail(field, 'a non-negative number')
  return value
}

function string(field, value) {
  if (typeof value !== 'string') fail(field, 'a string')
  return value
}

function bucket(field, value) {
  if (!isRecord(value)) fail(field, 'an object')
  number(`${field}.at`, value.at)
  string(`${field}.key`, value.key)
  for (const key of ['total', 'input', 'cacheRead', 'cacheWrite', 'output', 'calls']) {
    count(`${field}.${key}`, value[key])
  }
  return value
}

function series(field, value) {
  if (!Array.isArray(value)) fail(field, 'an array')
  value.forEach((item, index) => bucket(`${field}[${index}]`, item))
  return value
}

function modelRow(field, value) {
  if (!isRecord(value)) fail(field, 'an object')
  string(`${field}.model`, value.model)
  string(`${field}.provider`, value.provider)
  for (const key of ['total', 'input', 'cacheRead', 'cacheWrite', 'output', 'calls']) {
    count(`${field}.${key}`, value[key])
  }
  return value
}

function sessionRows(field, value) {
  if (!Array.isArray(value)) fail(field, 'an array')
  value.forEach((row, index) => {
    const at = `${field}[${index}]`
    if (!isRecord(row)) fail(at, 'an object')
    string(`${at}.id`, row.id)
    string(`${at}.title`, row.title)
    count(`${at}.lastAt`, row.lastAt)
    for (const key of ['total', 'input', 'cacheRead', 'cacheWrite', 'output', 'calls']) {
      count(`${at}.${key}`, row[key])
    }
  })
  return value
}

function models(field, value) {
  if (!isRecord(value)) fail(field, 'an object')
  for (const key of ['day', 'week', 'month']) {
    if (!Array.isArray(value[key])) fail(`${field}.${key}`, 'an array')
    value[key].forEach((row, index) => modelRow(`${field}.${key}[${index}]`, row))
  }
  return value
}

/** `create()` 返回的 parser：校验 Host 结果的 wire 形状。 */
function parseSnapshot(value) {
  if (!isRecord(value)) fail('snapshot', 'an object')
  number('generatedAt', value.generatedAt)
  if (value.scanning !== null) {
    if (!isRecord(value.scanning)) fail('scanning', 'an object or null')
    count('scanning.done', value.scanning.done)
    count('scanning.total', value.scanning.total)
  }
  if (typeof value.backfilled !== 'boolean') fail('backfilled', 'a boolean')
  // 可缺省：旧版 Host 还没这个字段时，页面按「未知」处理而不是整页报错。
  if (value.backfillAvailable !== undefined && typeof value.backfillAvailable !== 'boolean') {
    fail('backfillAvailable', 'a boolean')
  }
  if (!isRecord(value.counts)) fail('counts', 'an object')
  for (const key of ['calls', 'sessions', 'entries']) count(`counts.${key}`, value.counts[key])
  bucket('day', value.day)
  bucket('week', value.week)
  bucket('month', value.month)
  if (!isRecord(value.series)) fail('series', 'an object')
  series('series.day', value.series.day)
  series('series.week', value.series.week)
  series('series.month', value.series.month)
  models('models', value.models)
  if (!isRecord(value.sessions)) fail('sessions', 'an object')
  for (const key of ['day', 'week', 'month']) sessionRows(`sessions.${key}`, value.sessions[key])
  if (!isRecord(value.totals)) fail('totals', 'an object')
  for (const key of ['calls', 'sessions', 'firstAt', 'lastAt']) number(`totals.${key}`, value.totals[key])
  if (!isRecord(value.config)) fail('config', 'an object')
  number('config.historyDays', value.config.historyDays)
  number('config.dayCount', value.config.dayCount)
  number('config.weekCount', value.config.weekCount)
  number('config.monthCount', value.config.monthCount)
  string('config.storePath', value.config.storePath)
  return value
}

const resultCodec = {
  mode: 'strict',
  typeSymbol: '@skyrocks/dsh-token-stats#TokenStatsSnapshot',
  create: () => ({ parse: parseSnapshot }),
}

const invocation = (method) => ({
  id: `@skyrocks/dsh-token-stats#tokenStats/${method}`,
  service: 'tokenStats',
  namespace: 'tokenStats',
  method,
  invocation: { kind: 'direct' },
  parameters: [],
  result: resultCodec,
})

export const TYPERT = {
  package: '@skyrocks/dsh-token-stats',
  face: 'host',
  schemas: [],
  invocations: [invocation('read'), invocation('refresh')],
  model: { services: [], events: [], objects: [] },
}
