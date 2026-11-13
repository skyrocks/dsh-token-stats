// 用量数据的落盘层：一个 JSON 文件，原子替换写入，坏文件不让插件崩掉。
//
// 文件里没有会话正文，只有每条模型调用的 token 计数与所属会话 id，
// 以及「已统计到哪」的游标；删掉它可以随时重建（代价是重新扫描历史）。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const VERSION = 1
const IDS_LIMIT = 4000

/** DSH home：显式 $DSH_HOME 优先，与 dsh-home-paths 的约定一致。 */
export function dshHome() {
  const configured = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return configured.length > 0 ? resolve(configured) : join(homedir(), '.dsh')
}

/** 默认用量文件。 */
export function defaultStorePath() {
  return join(dshHome(), 'token-stats', 'usage.json')
}

/** 一条记录是否成形：字段齐全、数值有限。 */
function validEntry(entry) {
  if (entry === null || typeof entry !== 'object') return false
  if (typeof entry.s !== 'string' || entry.s === '') return false
  if (!Number.isInteger(entry.q) || entry.q < 0) return false
  if (typeof entry.t !== 'number' || !Number.isFinite(entry.t)) return false
  for (const key of ['i', 'r', 'w', 'o']) {
    if (typeof entry[key] !== 'number' || !Number.isFinite(entry[key]) || entry[key] < 0) return false
  }
  return true
}

/** 空状态。 */
export function emptyState() {
  return {
    version: VERSION,
    entries: [],
    titles: {},
    cursors: {},
    scanned: [],
    backfillAt: 0,
    savedAt: 0,
  }
}

/** 把任意读到的 JSON 归一成状态；不认识的字段丢掉，坏记录跳过。 */
export function normalizeState(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return emptyState()
  const state = emptyState()
  if (Array.isArray(input.entries)) {
    for (const entry of input.entries) {
      if (!validEntry(entry)) continue
      state.entries.push({
        id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : `${entry.s}#${entry.q}`,
        s: entry.s,
        q: entry.q,
        t: entry.t,
        m: typeof entry.m === 'string' ? entry.m : '',
        p: typeof entry.p === 'string' ? entry.p : '',
        i: entry.i,
        r: entry.r,
        w: entry.w,
        o: entry.o,
      })
    }
  }
  if (input.cursors !== null && typeof input.cursors === 'object' && !Array.isArray(input.cursors)) {
    for (const [sessionId, cursor] of Object.entries(input.cursors)) {
      if (typeof cursor !== 'number' || !Number.isFinite(cursor) || cursor < 0) continue
      state.cursors[sessionId] = Math.floor(cursor)
    }
  }
  if (input.titles !== null && typeof input.titles === 'object' && !Array.isArray(input.titles)) {
    let count = 0
    for (const [sessionId, title] of Object.entries(input.titles)) {
      if (count >= 5000) break
      if (typeof sessionId !== 'string' || sessionId === '') continue
      if (typeof title !== 'string' || title.trim() === '') continue
      state.titles[sessionId] = title
      count += 1
    }
  }
  if (Array.isArray(input.scanned)) {
    state.scanned = input.scanned.filter((id) => typeof id === 'string' && id !== '').slice(-IDS_LIMIT)
  }
  if (typeof input.backfillAt === 'number' && Number.isFinite(input.backfillAt)) state.backfillAt = input.backfillAt
  if (typeof input.savedAt === 'number' && Number.isFinite(input.savedAt)) state.savedAt = input.savedAt
  return state
}

/** 文件存储：读一次、写多次；写入串行化，避免并发重命名打架。 */
export function createStore(options = {}) {
  const path = typeof options.path === 'string' && options.path !== '' ? resolve(options.path) : defaultStorePath()
  let pending = Promise.resolve()

  return {
    path,

    /** 读状态；文件不存在或损坏都返回空状态。 */
    async load() {
      let text
      try {
        text = await readFile(path, 'utf8')
      } catch {
        return emptyState()
      }
      try {
        return normalizeState(JSON.parse(text))
      } catch {
        return emptyState()
      }
    },

    /**
     * 写状态：先写临时文件再 rename，崩溃也不会留下半个 JSON。
     * @param {object} state 归一后的状态
     * @returns {Promise<void>}
     */
    save(state) {
      const payload = JSON.stringify({
        version: VERSION,
        entries: state.entries,
        titles: state.titles,
        cursors: state.cursors,
        scanned: state.scanned,
        backfillAt: state.backfillAt,
        savedAt: Date.now(),
      })
      pending = pending
        .then(async () => {
          await mkdir(dirname(path), { recursive: true, mode: 0o700 })
          const temp = `${path}.${process.pid}.tmp`
          await writeFile(temp, payload, { mode: 0o600 })
          await rename(temp, path)
        })
        .catch(() => {
          // 落盘失败不影响本次读取；下一次变更会再试。
        })
      return pending
    },
  }
}
