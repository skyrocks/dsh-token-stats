// 账本流水线测试：用假的 Session / sessionQuery 验证增量折叠、历史回填、
// 去重与落盘，不依赖 DSH 运行时。
// 运行：node test/accountant.mjs
import assert from "node:assert/strict";

import { UsageAccountant } from "../accountant.js";
import { normalizeOptions } from "../options.js";

const NOW = new Date(2026, 10, 13, 15, 0, 0).getTime();
const HOUR = 3600000;

/** 一条带 usage 的 assistant/message 事件。 */
function usageEvent(seq, time, input, output, model = "deepseek-v4.1-flash") {
  return {
    seq,
    time,
    type: "assistant/message",
    data: {
      message: { role: "assistant", content: [], source: { model, provider: "opencode-go" } },
      usage: { inputTokens: input, outputTokens: output },
    },
  };
}

/** 假 Session：只实现 account 用到的三个成员。 */
function liveSession(id, events, inheritedEventCount = 0) {
  return {
    id,
    inheritedEventCount,
    seq: events.length,
    snapshotEvents(from) {
      return events.slice(from);
    },
  };
}

/** 假存储：状态放内存。 */
function memoryStore(initial = null) {
  return {
    path: "/tmp/dsh-token-stats-test.json",
    state: initial,
    saves: 0,
    async load() {
      return this.state === null ? { version: 1, entries: [], cursors: {}, scanned: [], backfillAt: 0, savedAt: 0 } : this.state;
    },
    async save(state) {
      this.saves += 1;
      this.state = state;
    },
  };
}

/** 等待后台回填结束。 */
async function waitScan(accountant) {
  for (let index = 0; index < 200; index += 1) {
    if (accountant.scan === null || accountant.scan.running === false) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("回填没有在预期时间内结束");
}

// ── 活跃会话：增量折叠、不重复、不漏 ─────────────────────────
{
  const events = [
    usageEvent(0, NOW - 2 * HOUR, 100, 10),
    { seq: 1, time: NOW - HOUR, type: "tool/call", data: {} },
    { seq: 2, time: NOW - HOUR, type: "session/title", data: { title: "重构计时插件", messageSeqs: [] } },
    usageEvent(3, NOW - HOUR, 50, 5),
  ];
  const session = liveSession("live-1", events);
  const store = memoryStore();
  const accountant = new UsageAccountant({
    store,
    options: normalizeOptions(),
    liveSessions: () => [session],
    query: () => undefined,
    now: () => NOW,
  });

  const first = await accountant.read();
  assert.equal(first.counts.calls, 2);
  assert.equal(first.day.total, 165);
  assert.equal(first.scanning, null);

  const second = await accountant.read();
  assert.equal(second.counts.calls, 2, "同一批事件不能重复计数");

  // 会话继续追加
  events.push(usageEvent(4, NOW, 7, 3));
  session.seq = events.length;
  const third = await accountant.read();
  assert.equal(third.counts.calls, 3);
  assert.equal(third.day.total, 175);
  assert.equal(third.day.calls, 3);

  assert.equal(third.sessions.month[0].title, "重构计时插件", "标题从 session/title 事件里攒出来");

  await accountant.flush();
  assert.equal(store.state.cursors["live-1"], 5);
  assert.equal(store.state.entries.length, 3);
  assert.equal(store.state.titles["live-1"], "重构计时插件");
}

// ── fork 继承前缀不重复计数 ─────────────────────────────────
{
  const inherited = [usageEvent(0, NOW - 3 * HOUR, 1000, 100), usageEvent(1, NOW - 2 * HOUR, 2000, 200)];
  const own = [usageEvent(2, NOW - HOUR, 40, 4)];
  const parent = liveSession("parent", inherited);
  const fork = liveSession("fork", inherited.concat(own), inherited.length);

  const accountant = new UsageAccountant({
    store: memoryStore(),
    options: normalizeOptions(),
    liveSessions: () => [parent, fork],
    query: () => undefined,
    now: () => NOW,
  });
  const snapshot = await accountant.read();
  // 只算父会话的两条 + fork 自己的一条
  assert.equal(snapshot.counts.calls, 3);
  assert.equal(snapshot.counts.sessions, 2);
  assert.equal(snapshot.day.total, 3300 + 44);
}

// ── 历史回填：扫描持久化会话，进度可见，之后不再重扫 ─────────
{
  const persisted = new Map([
    ["persisted-a", [usageEvent(0, NOW - 5 * HOUR, 300, 30), { seq: 1, time: NOW - 5 * HOUR, type: "session/title", data: { title: "数据库迁移" } }]],
    ["persisted-b", [usageEvent(0, NOW - 26 * HOUR, 700, 70)]],
    ["persisted-old", [usageEvent(0, NOW - 500 * 24 * HOUR, 9000, 900)]],
  ]);
  let reads = 0;
  const query = {
    async listSessions() {
      return [...persisted.keys()].map((id) => ({
        header: { id, createdAt: id === "persisted-old" ? NOW - 500 * 24 * HOUR : NOW - 6 * HOUR },
        live: false,
        persisted: true,
      }));
    },
    async readSession(id) {
      reads += 1;
      const events = persisted.get(id);
      return { session: { id }, inheritedEventCount: 0, events };
    },
  };
  const store = memoryStore();
  const accountant = new UsageAccountant({
    store,
    options: normalizeOptions(),
    liveSessions: () => [],
    query: () => query,
    now: () => NOW,
  });

  const first = await accountant.read();
  assert.equal(first.scanning.total, 0, "第一次读只启动扫描，还没开始读日志");
  await waitScan(accountant);

  const second = await accountant.read();
  assert.equal(second.scanning, null);
  assert.equal(second.counts.calls, 2, "太老的会话不回填");
  const persistedRow = second.sessions.month.find((row) => row.id === "persisted-a");
  assert.equal(persistedRow.title, "数据库迁移", "回填时也要攒标题");
  assert.equal(second.day.total, 330);
  assert.equal(second.week.total, 330 + 770);
  assert.equal(reads, 2, "只有范围内的会话被读取");
  assert.equal(accountant.scanned.has("persisted-old"), true);
  assert.equal(second.backfilled, true);
  assert.equal(second.backfillAvailable, true);

  await accountant.flush();
  assert.equal(store.state.scanned.length, 3);

  // 重启：新实例从文件里恢复，游标与已扫描集合都在，不会重扫也不会重复。
  const restarted = new UsageAccountant({
    store,
    options: normalizeOptions(),
    liveSessions: () => [],
    query: () => query,
    now: () => NOW,
  });
  const third = await restarted.read();
  assert.equal(third.counts.calls, 2);
  await waitScan(restarted);
  assert.equal(reads, 2, "已扫描过的会话不再读取");
}

// ── 手动刷新：强制重新检查，不漏掉新出现的持久化会话 ─────────
{
  const persisted = new Map([["p1", [usageEvent(0, NOW - HOUR, 10, 1)]]]);
  const query = {
    async listSessions() {
      return [...persisted.keys()].map((id) => ({ header: { id, createdAt: NOW - HOUR } }));
    },
    async readSession(id) {
      return { inheritedEventCount: 0, events: persisted.get(id) };
    },
  };
  const accountant = new UsageAccountant({
    store: memoryStore(),
    options: normalizeOptions(),
    liveSessions: () => [],
    query: () => query,
    now: () => NOW,
  });
  await accountant.read();
  await waitScan(accountant);

  persisted.set("p2", [usageEvent(0, NOW - 2 * HOUR, 20, 2)]);
  const refreshed = await accountant.refresh();
  await waitScan(accountant);
  assert.equal(refreshed.counts.calls, 2);
}

// ── 裁剪：超过保留期的记录在落盘时被删掉 ─────────────────────
{
  const events = [usageEvent(0, NOW - 500 * 24 * HOUR, 5, 5)];
  const store = memoryStore();
  const accountant = new UsageAccountant({
    store,
    options: normalizeOptions({ retainDays: 400 }),
    liveSessions: () => [liveSession("old-live", events)],
    query: () => undefined,
    now: () => NOW,
  });
  const snapshot = await accountant.read();
  assert.equal(snapshot.counts.calls, 1);
  await accountant.flush();
  assert.equal(store.state.entries.length, 0, "超出保留天数的记录只留在 totals 里，不落盘");
}

console.log("dsh-token-stats: accountant tests passed");
