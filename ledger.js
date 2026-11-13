// 纯函数：把 DSH 会话事件折成「一条 LLM 调用 = 一条用量记录」，
// 再按本地时间的 日 / 周 / 月 分桶汇总。不依赖 Cordis 和 DSH 服务，方便单测。
//
// 记录只保留 token 数，不含费用；费用换算属于另一个插件（dsh-deepseek-cost）。

/** 非负整数化：异常值按 0 计。 */
function count(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function pad2(value) {
  return value < 10 ? `0${value}` : String(value);
}

/** 本地自然日 0 点。 */
export function startOfDay(time) {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** 本周起点（周一 0 点）。 */
export function startOfWeek(time) {
  const date = new Date(startOfDay(time));
  const weekday = (date.getDay() + 6) % 7; // 周一=0 … 周日=6
  date.setDate(date.getDate() - weekday);
  return date.getTime();
}

/** 本月 1 日 0 点。 */
export function startOfMonth(time) {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

/** 日键：2026-11-13。 */
export function dayKey(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 月键：2026-11。 */
export function monthKey(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/**
 * 从一条持久化 assistant 消息的 stream 里取最后的 usage 记录。
 * 形状即 DSH 的 `{ type: 'chunk', chunk: { type: 'usage', usage } }`。
 * @param {unknown} stream 事件里的 stream 记录数组
 * @returns {object|undefined} usage
 */
export function lastStreamUsage(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index];
    if (record && record.type === "chunk" && record.chunk && record.chunk.type === "usage") {
      return record.chunk.usage;
    }
  }
  return undefined;
}

/**
 * 从 `session/title` 事件里取标题；不是标题事件或标题为空时返回 null。
 * 标题只用于会话列表展示，不参与计数。
 * @param {object} event 持久化会话事件
 * @returns {string|null} 标题
 */
export function titleOf(event) {
  if (!event || event.type !== "session/title") return null;
  const data = event.data;
  if (!data || typeof data.title !== "string") return null;
  const title = data.title.trim();
  return title === "" ? null : title;
}

/**
 * 把一条模型结算事件转成用量记录；没有用量时返回 null。
 *
 * 两种事件都算（与 DSH 自己的 tokenUsage 投影一致）：
 *   - `assistant/message`：落成消息的调用，`data.usage` 或 stream 里的 usage；
 *   - `assistant/attempt`：失败 / 重试但没落消息的尝试，usage 只在 stream 里。
 * attempt 没有 `message.source`，模型归因落空，展示时记作「未知模型」。
 * token 口径沿用 DSH：input 只含未命中缓存的输入，缓存读写分开计。
 * @param {string} sessionId 所属会话
 * @param {object} event 持久化会话事件
 * @returns {object|null} 用量记录
 */
export function entryOf(sessionId, event) {
  if (!event) return null;
  const type = event.type;
  if (type !== "assistant/message" && type !== "assistant/attempt") return null;
  const data = event.data ?? {};
  if (!data || typeof data !== "object") return null;
  const usage = (type === "assistant/message" ? data.usage : undefined) ?? lastStreamUsage(data.stream);
  if (!usage || typeof usage !== "object") return null;
  const input = count(usage.inputTokens);
  const cacheRead = count(usage.cacheReadTokens);
  const cacheWrite = count(usage.cacheWriteTokens);
  const output = count(usage.outputTokens);
  if (input + cacheRead + cacheWrite + output === 0) return null;
  const source = data.message && data.message.source;
  return {
    id: `${sessionId}#${event.seq}`,
    s: sessionId,
    q: event.seq,
    t: typeof event.time === "number" && Number.isFinite(event.time) ? event.time : Date.now(),
    m: source && typeof source.model === "string" ? source.model : "",
    p: source && typeof source.provider === "string" ? source.provider : "",
    i: input,
    r: cacheRead,
    w: cacheWrite,
    o: output,
  };
}

/**
 * 折叠一批事件，只取其中带用量的 assistant 消息。
 * @param {string} sessionId 所属会话
 * @param {Iterable<object>} events 事件序列
 * @returns {object[]} 用量记录
 */
export function foldEvents(sessionId, events) {
  const out = [];
  for (const event of events ?? []) {
    const entry = entryOf(sessionId, event);
    if (entry !== null) out.push(entry);
  }
  return out;
}

/** 一条记录的总 token：输入 + 缓存读 + 缓存写 + 输出。 */
export function totalOf(entry) {
  return entry.i + entry.r + entry.w + entry.o;
}

/** 一个空桶。 */
export function emptyBucket() {
  return { at: 0, key: "", total: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0 };
}

/** 把一条记录累加进桶里。 */
export function addToBucket(bucket, entry) {
  bucket.input += entry.i;
  bucket.cacheRead += entry.r;
  bucket.cacheWrite += entry.w;
  bucket.output += entry.o;
  bucket.total += totalOf(entry);
  bucket.calls += 1;
  return bucket;
}

/** 会话桶：一个会话在一个窗口里的合计。 */
function addToSession(map, entry) {
  let row = map.get(entry.s);
  if (row === undefined) {
    row = { id: entry.s, total: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0, lastAt: 0 };
    map.set(entry.s, row);
  }
  row.input += entry.i;
  row.cacheRead += entry.r;
  row.cacheWrite += entry.w;
  row.output += entry.o;
  row.total += totalOf(entry);
  row.calls += 1;
  if (entry.t > row.lastAt) row.lastAt = entry.t;
  return row;
}

/** 会话表：按总量降序，最多留 limit 条。 */
function sessionRows(map, limit) {
  const rows = [...map.values()];
  rows.sort((a, b) => b.total - a.total || b.lastAt - a.lastAt);
  return rows.slice(0, limit);
}

/** 模型桶。 */
function addToModel(map, entry) {
  const key = entry.m === "" ? "" : entry.m;
  let row = map.get(key);
  if (row === undefined) {
    row = { model: key, provider: entry.p, total: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, calls: 0 };
    map.set(key, row);
  }
  row.input += entry.i;
  row.cacheRead += entry.r;
  row.cacheWrite += entry.w;
  row.output += entry.o;
  row.total += totalOf(entry);
  row.calls += 1;
  if (row.provider === "" && entry.p !== "") row.provider = entry.p;
  return row;
}

/** 模型表：按总量降序。 */
function modelRows(map) {
  const rows = [...map.values()];
  rows.sort((a, b) => b.total - a.total || b.calls - a.calls);
  return rows;
}

/** 生成窗口内每个桶的起点（从旧到新，含当前桶）。 */
function dayBuckets(now, size) {
  const out = [];
  const base = new Date(startOfDay(now));
  for (let offset = size - 1; offset >= 0; offset -= 1) {
    const date = new Date(base);
    date.setDate(date.getDate() - offset);
    const at = date.getTime();
    const bucket = emptyBucket();
    bucket.at = at;
    bucket.key = dayKey(at);
    out.push(bucket);
  }
  return out;
}

function weekBuckets(now, size) {
  const out = [];
  const base = new Date(startOfWeek(now));
  for (let offset = size - 1; offset >= 0; offset -= 1) {
    const date = new Date(base);
    date.setDate(date.getDate() - offset * 7);
    const at = date.getTime();
    const bucket = emptyBucket();
    bucket.at = at;
    bucket.key = dayKey(at);
    out.push(bucket);
  }
  return out;
}

/** 日趋势窗口的起点（含 dayCount 天）。 */
function dayWindowStart(now, size) {
  const date = new Date(startOfDay(now));
  date.setDate(date.getDate() - (size - 1));
  return date.getTime();
}

/** 周趋势窗口的起点（含 size 个周一）。 */
function weekWindowStart(now, size) {
  const date = new Date(startOfWeek(now));
  date.setDate(date.getDate() - (size - 1) * 7);
  return date.getTime();
}

/** 月趋势窗口的起点（含 size 个月）。 */
function monthWindowStart(now, size) {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth() - (size - 1), 1).getTime();
}

function monthBuckets(now, size) {
  const out = [];
  const base = new Date(now);
  for (let offset = size - 1; offset >= 0; offset -= 1) {
    const date = new Date(base.getFullYear(), base.getMonth() - offset, 1);
    const bucket = emptyBucket();
    bucket.at = date.getTime();
    bucket.key = monthKey(bucket.at);
    out.push(bucket);
  }
  return out;
}

/**
 * 汇总：三个口径的合计 + 三组趋势序列 + 三组模型分布 + 总览。
 * 输入记录可以无序；只读一遍。窗口外的记录只进 totals，不进序列。
 * @param {Iterable<object>} entries 用量记录
 * @param {number} [now] 参考时间
 * @param {{ dayCount?: number, weekCount?: number, monthCount?: number }} [options]
 * @returns {{ day: object, week: object, month: object, series: object, models: object, sessions: object, totals: object }}
 */
export function aggregate(entries, now = Date.now(), options = {}) {
  const dayCount = Math.max(1, Math.min(90, options.dayCount ?? 14));
  const weekCount = Math.max(1, Math.min(53, options.weekCount ?? 12));
  const monthCount = Math.max(1, Math.min(36, options.monthCount ?? 12));

  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now);
  const monthStart = startOfMonth(now);

  const summary = { day: emptyBucket(), week: emptyBucket(), month: emptyBucket() };
  summary.day.key = dayKey(dayStart);
  summary.day.at = dayStart;
  summary.week.key = dayKey(weekStart);
  summary.week.at = weekStart;
  summary.month.key = monthKey(monthStart);
  summary.month.at = monthStart;

  const dayList = dayBuckets(now, dayCount);
  const weekList = weekBuckets(now, weekCount);
  const monthList = monthBuckets(now, monthCount);
  const dayIndex = new Map(dayList.map((bucket) => [bucket.key, bucket]));
  const weekIndex = new Map(weekList.map((bucket) => [bucket.key, bucket]));
  const monthIndex = new Map(monthList.map((bucket) => [bucket.key, bucket]));

  const models = { day: new Map(), week: new Map(), month: new Map() };
  const sessionMaps = { day: new Map(), week: new Map(), month: new Map() };
  // 模型分布跟随趋势窗口（近 N 天 / N 周 / N 个月），这样它就等于对应柱子之和。
  const modelDayStart = dayWindowStart(now, dayCount);
  const modelWeekStart = weekWindowStart(now, weekCount);
  const modelMonthStart = monthWindowStart(now, monthCount);

  let firstAt = 0;
  let lastAt = 0;
  let all = 0;
  const sessions = new Set();

  for (const entry of entries ?? []) {
    if (!entry || typeof entry.t !== "number") continue;
    all += 1;
    sessions.add(entry.s);
    if (firstAt === 0 || entry.t < firstAt) firstAt = entry.t;
    if (entry.t > lastAt) lastAt = entry.t;

    if (entry.t >= dayStart) addToBucket(summary.day, entry);
    if (entry.t >= weekStart) addToBucket(summary.week, entry);
    if (entry.t >= monthStart) addToBucket(summary.month, entry);

    if (entry.t >= modelDayStart) {
      addToModel(models.day, entry);
      addToSession(sessionMaps.day, entry);
    }
    if (entry.t >= modelWeekStart) {
      addToModel(models.week, entry);
      addToSession(sessionMaps.week, entry);
    }
    if (entry.t >= modelMonthStart) {
      addToModel(models.month, entry);
      addToSession(sessionMaps.month, entry);
    }

    const dayHit = dayIndex.get(dayKey(entry.t));
    if (dayHit !== undefined) addToBucket(dayHit, entry);
    const weekHit = weekIndex.get(dayKey(startOfWeek(entry.t)));
    if (weekHit !== undefined) addToBucket(weekHit, entry);
    const monthHit = monthIndex.get(monthKey(entry.t));
    if (monthHit !== undefined) addToBucket(monthHit, entry);
  }

  return {
    day: summary.day,
    week: summary.week,
    month: summary.month,
    series: { day: dayList, week: weekList, month: monthList },
    models: { day: modelRows(models.day), week: modelRows(models.week), month: modelRows(models.month) },
    sessions: {
      day: sessionRows(sessionMaps.day, 300),
      week: sessionRows(sessionMaps.week, 300),
      month: sessionRows(sessionMaps.month, 300),
    },
    totals: { calls: all, sessions: sessions.size, firstAt, lastAt },
  };
}

/** 只保留 from 之后的记录，用于裁剪过旧数据。 */
export function keepAfter(entries, from) {
  const out = [];
  for (const entry of entries) if (entry.t >= from) out.push(entry);
  return out;
}
