// 账本本体：不依赖 Cordis 与 DSH 服务，靠注入的 liveSessions / query 取数据。
// service.js 把它接到 Typert Remote；单测直接给它假的会话与查询器。
//
// 数据来源只有一个：会话日志里的 assistant/message 事件（模型返回的 usage）。
//   1. 活跃会话：从内存里的 Session 增量折叠，游标记在内存与文件里；
//   2. 历史会话：第一次读取时后台扫描持久化日志做一次性回填，带进度；
//   3. 结果落盘，重启后不再重扫。
// 全程只读：不调用模型、不改会话、不追加会话事件。
import { aggregate, foldEvents, keepAfter, titleOf } from './ledger.js'
import { emptyState } from './store.js'

const DAY_MS = 86400000
const SCAN_CHECK_MS = 5 * 60 * 1000
const SAVE_DEBOUNCE_MS = 1500
const SCAN_CONCURRENCY = 2
const SCANNED_LIMIT = 4000

/** 安全取会话的 seq（日志长度）。 */
function sessionLength(session) {
  return typeof session.seq === 'number' && Number.isFinite(session.seq) && session.seq > 0 ? session.seq : 0
}

/** 安全取 fork 继承前缀长度。 */
function sessionInherited(session) {
  const value = session.inheritedEventCount
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0
}

export class UsageAccountant {
  /**
   * @param {{
   *   store: { path: string, load: () => Promise<object>, save: (state: object) => Promise<void> },
   *   options: { historyDays: number, retainDays: number, dayCount: number, weekCount: number, monthCount: number },
   *   liveSessions: () => object[],
   *   query: () => object | undefined,
   *   now?: () => number,
   * }} deps
   */
  constructor(deps) {
    this.store = deps.store
    this.options = deps.options
    this.liveSessions = typeof deps.liveSessions === 'function' ? deps.liveSessions : () => []
    this.query = typeof deps.query === 'function' ? deps.query : () => undefined
    this.now = typeof deps.now === 'function' ? deps.now : () => Date.now()

    /** @type {Map<string, object>} id → 用量记录 */
    this.entries = new Map()
    /** @type {Map<string, number>} 会话 id → 已折叠的事件下标 */
    this.cursors = new Map()
    /** @type {Set<string>} 已完整扫描过的持久化会话 */
    this.scanned = new Set()
    /** @type {Map<string, string>} 会话 id → 标题（从 session/title 事件里顺手攒的） */
    this.titles = new Map()

    this.state = emptyState()
    this.loaded = null
    this.scan = null
    this.lastScanCheck = 0
    this.saveTimer = null
    this.dirty = false
    this.disposed = false
  }

  /** 一次性加载文件状态；并发调用共享同一个 promise。 */
  ensureLoaded() {
    if (this.loaded === null) {
      this.loaded = (async () => {
        this.state = await this.store.load()
        for (const entry of this.state.entries) this.entries.set(entry.id, entry)
        for (const [sessionId, cursor] of Object.entries(this.state.cursors)) this.cursors.set(sessionId, cursor)
        for (const sessionId of this.state.scanned) this.scanned.add(sessionId)
        for (const [sessionId, title] of Object.entries(this.state.titles || {})) this.titles.set(sessionId, title)
      })()
    }
    return this.loaded
  }

  /** 给三组会话行补上标题（没有就留空，客户端用短 id）。 */
  withTitles(groups) {
    const out = { day: [], week: [], month: [] }
    for (const key of ['day', 'week', 'month']) {
      const rows = groups && Array.isArray(groups[key]) ? groups[key] : []
      out[key] = rows.map((row) => ({ ...row, title: this.titles.get(row.id) || '' }))
    }
    return out
  }

  /** 客户端读一次：增量折叠活跃会话，必要时启动历史回填，返回当前汇总。 */
  async read() {
    await this.ensureLoaded()
    this.foldLive()
    this.maybeScan()
    this.scheduleSave()
    return this.snapshot()
  }

  /** 手动刷新：跳过扫描节流并立刻落盘。 */
  async refresh() {
    await this.ensureLoaded()
    this.foldLive()
    this.lastScanCheck = 0
    this.maybeScan()
    await this.flush()
    return this.snapshot()
  }

  /** 当前汇总（纯计算，不触发 IO）。 */
  snapshot() {
    const now = this.now()
    const agg = aggregate([...this.entries.values()], now, {
      dayCount: this.options.dayCount,
      weekCount: this.options.weekCount,
      monthCount: this.options.monthCount,
    })
    const scan = this.scan
    return {
      generatedAt: now,
      scanning: scan !== null && scan.running ? { done: scan.done, total: scan.total } : null,
      backfilled: this.state.backfillAt > 0,
      backfillAvailable: this.hasQuery(),
      counts: { calls: agg.totals.calls, sessions: agg.totals.sessions, entries: this.entries.size },
      day: agg.day,
      week: agg.week,
      month: agg.month,
      series: agg.series,
      models: agg.models,
      sessions: this.withTitles(agg.sessions),
      totals: agg.totals,
      config: {
        historyDays: this.options.historyDays,
        dayCount: this.options.dayCount,
        weekCount: this.options.weekCount,
        monthCount: this.options.monthCount,
        storePath: this.store.path,
      },
    }
  }

  /** 把每条活跃会话里新追加的事件折进账本（同步、幂等）。 */
  foldLive() {
    let changed = false
    let sessions = []
    try {
      sessions = this.liveSessions() ?? []
    } catch {
      sessions = []
    }
    for (const session of sessions) {
      try {
        changed = this.foldSession(session) || changed
      } catch {
        // 单个会话读取失败不影响其余会话。
      }
    }
    if (changed) this.dirty = true
    return changed
  }

  /** 折叠一条活跃会话；返回是否有新记录。 */
  foldSession(session) {
    if (session === null || typeof session !== 'object' || typeof session.id !== 'string') return false
    const inherited = sessionInherited(session)
    const length = sessionLength(session)
    const stored = this.cursors.get(session.id)
    let cursor = stored === undefined ? inherited : Math.max(stored, inherited)
    cursor = Math.min(cursor, length)
    let changed = false
    if (stored !== cursor) {
      this.cursors.set(session.id, cursor)
      changed = true
    }
    if (cursor >= length || typeof session.snapshotEvents !== 'function') return changed
    const events = session.snapshotEvents(cursor)
    if (!Array.isArray(events) || events.length === 0) return changed
    for (const entry of foldEvents(session.id, events)) {
      if (this.entries.has(entry.id)) continue
      this.entries.set(entry.id, entry)
      changed = true
    }
    if (this.collectTitles(session.id, events)) changed = true
    this.cursors.set(session.id, cursor + events.length)
    return true
  }

  /** 会话查询服务在不在（不触发 IO）。 */
  hasQuery() {
    let query
    try {
      query = this.query()
    } catch {
      query = undefined
    }
    return query !== undefined && query !== null && typeof query.listSessions === 'function'
  }

  /** 必要时启动一次后台回填（节流，单飞）。 */
  maybeScan() {
    if (this.scan !== null && this.scan.running) return
    const now = this.now()
    if (now - this.lastScanCheck < SCAN_CHECK_MS) return
    this.lastScanCheck = now
    let query
    try {
      query = this.query()
    } catch {
      query = undefined
    }
    if (query === undefined || query === null || typeof query.listSessions !== 'function') {
      // 没有查询服务就只统计本次运行以来的活跃会话；不谎称回填完成。
      return
    }
    this.scan = { running: true, done: 0, total: 0 }
    this.runScan(query)
      .catch(() => {})
      .finally(() => {
        if (this.scan !== null) this.scan.running = false
        this.state.backfillAt = this.state.backfillAt || this.now()
        this.dirty = true
        this.scheduleSave()
      })
  }

  /** 列出还没统计过的持久化会话，逐个读取并折叠。 */
  async runScan(query) {
    const records = await query.listSessions()
    if (!Array.isArray(records)) return
    const cutoff = this.now() - this.options.historyDays * DAY_MS
    let live = new Set()
    try {
      live = new Set((this.liveSessions() ?? []).map((session) => session.id))
    } catch {
      live = new Set()
    }
    const targets = []
    for (const record of records) {
      const header = record && record.header ? record.header : undefined
      if (header === undefined || typeof header.id !== 'string') continue
      if (live.has(header.id)) continue
      if (this.scanned.has(header.id)) continue
      const createdAt = typeof header.createdAt === 'number' ? header.createdAt : 0
      if (createdAt > 0 && createdAt < cutoff) {
        // 太老的会话直接记为「已处理」，省一次读取。
        this.scanned.add(header.id)
        continue
      }
      targets.push(header.id)
    }
    this.scan.total = targets.length
    if (targets.length === 0) return

    let next = 0
    const worker = async () => {
      while (next < targets.length && !this.disposed) {
        const id = targets[next]
        next += 1
        try {
          const snapshot = await query.readSession(id)
          if (this.disposed) return
          this.foldPersisted(id, snapshot)
        } catch {
          // 读不了的会话（旧格式、损坏、迁移中）跳过，下次扫描会再试。
        }
        if (this.disposed) return
        if (this.scan !== null) this.scan.done += 1
        if (this.scan !== null && this.scan.done % 5 === 0) this.scheduleSave()
      }
    }
    const workers = []
    for (let index = 0; index < Math.min(SCAN_CONCURRENCY, targets.length); index += 1) workers.push(worker())
    await Promise.all(workers)
  }

  /** 折叠一条持久化会话的完整日志（跳过 fork 继承来的前缀，避免重复计数）。 */
  foldPersisted(sessionId, snapshot) {
    const events = snapshot && Array.isArray(snapshot.events) ? snapshot.events : []
    const inherited =
      snapshot && typeof snapshot.inheritedEventCount === 'number' ? Math.max(0, snapshot.inheritedEventCount) : 0
    const start = Math.min(inherited, events.length)
    let changed = false
    for (const entry of foldEvents(sessionId, events.slice(start))) {
      if (this.entries.has(entry.id)) continue
      this.entries.set(entry.id, entry)
      changed = true
    }
    if (this.collectTitles(sessionId, events)) changed = true
    const cursor = events.length
    if (this.cursors.get(sessionId) !== cursor) {
      this.cursors.set(sessionId, cursor)
      changed = true
    }
    if (!this.scanned.has(sessionId)) {
      this.scanned.add(sessionId)
      changed = true
    }
    if (changed) this.dirty = true
    return changed
  }

  /** 从一批事件里收集最新的 session/title；返回是否有变化。 */
  collectTitles(sessionId, events) {
    let latest = null
    for (const event of events || []) {
      const title = titleOf(event)
      if (title !== null) latest = title
    }
    if (latest === null || this.titles.get(sessionId) === latest) return false
    this.titles.set(sessionId, latest)
    return true
  }

  /** 延迟落盘：多次变更合成一次写。 */
  scheduleSave() {
    if (!this.dirty || this.disposed) return
    if (this.saveTimer !== null) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.flush()
    }, SAVE_DEBOUNCE_MS)
    if (typeof this.saveTimer.unref === 'function') this.saveTimer.unref()
  }

  /** 立刻落盘（裁剪过旧记录后写）。 */
  async flush() {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    if (!this.dirty) return
    this.dirty = false

    const cutoff = this.now() - this.options.retainDays * DAY_MS
    const kept = keepAfter([...this.entries.values()], cutoff)
    if (kept.length !== this.entries.size) {
      this.entries.clear()
      for (const entry of kept) this.entries.set(entry.id, entry)
    }

    this.state.entries = kept
    this.state.titles = Object.fromEntries(this.titles)
    this.state.cursors = Object.fromEntries(this.cursors)
    this.state.scanned = [...this.scanned].slice(-SCANNED_LIMIT)
    await this.store.save(this.state)
  }

  /** 卸载：停扫，并把还在内存里的账本落盘（调用方可以不 await）。 */
  async dispose() {
    this.disposed = true
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    await this.flush()
  }
}

export default UsageAccountant
