// 冒烟测试：只测纯函数，不依赖 DSH 运行时。
// 运行：node test/smoke.mjs
import assert from "node:assert/strict";

import {
  aggregate,
  dayKey,
  entryOf,
  foldEvents,
  startOfDay,
  startOfMonth,
  startOfWeek,
  keepAfter,
} from "../ledger.js";
import { emptyState, normalizeState } from "../store.js";
import { normalizeOptions } from "../options.js";

/** 造一条带 usage 的 assistant/message 事件。 */
function messageEvent(seq, time, usage, model = "deepseek-v4.1-flash", provider = "opencode-go") {
  return {
    seq,
    time,
    type: "assistant/message",
    data: {
      turn: 1,
      step: 1,
      message: {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        source: { model, provider },
      },
      usage,
    },
  };
}

function entry(sessionId, seq, time, usage, model, provider) {
  const built = entryOf(sessionId, messageEvent(seq, time, usage, model, provider));
  assert.notEqual(built, null, "样例事件应当能折出记录");
  return built;
}

// ── 折叠 ────────────────────────────────────────────────────
{
  const built = entryOf("s1", messageEvent(3, 1000, {
    inputTokens: 10,
    cacheReadTokens: 20,
    cacheWriteTokens: 5,
    outputTokens: 7,
  }));
  assert.deepEqual(
    { i: built.i, r: built.r, w: built.w, o: built.o, m: built.m, p: built.p, q: built.q },
    { i: 10, r: 20, w: 5, o: 7, m: "deepseek-v4.1-flash", p: "opencode-go", q: 3 }
  );
  assert.equal(built.id, "s1#3");
  assert.equal(built.t, 1000);
}

{
  // usage 只在 stream 里时也要能取到。
  const event = {
    seq: 1,
    time: 5,
    type: "assistant/message",
    data: {
      message: { role: "assistant", content: [] },
      stream: [
        { type: "chunk", chunk: { type: "text", text: "hi" } },
        { type: "chunk", chunk: { type: "usage", usage: { inputTokens: 3, outputTokens: 4 } } },
      ],
    },
  };
  const built = entryOf("s2", event);
  assert.equal(built.i, 3);
  assert.equal(built.o, 4);
  assert.equal(built.r, 0);
}

{
  // 失败 / 重试的尝试只要带 usage 也要算（DSH 的 tokenUsage 投影同样计入）。
  const attempt = entryOf("s4", {
    seq: 7,
    time: 9000,
    type: "assistant/attempt",
    data: {
      stream: [{ type: "chunk", chunk: { type: "usage", usage: { inputTokens: 8, outputTokens: 2 } } }],
    },
  });
  assert.notEqual(attempt, null);
  assert.equal(attempt.i, 8);
  assert.equal(attempt.o, 2);
  assert.equal(attempt.m, "", "attempt 没有 message.source，模型记为空");
}

{
  assert.equal(entryOf("s", { seq: 1, type: "user/message", data: {} }), null);
  assert.equal(entryOf("s", messageEvent(1, 1, { inputTokens: 0, outputTokens: 0 })), null);
  const folded = foldEvents("s3", [
    messageEvent(1, 1, { inputTokens: 1, outputTokens: 1 }),
    { seq: 2, type: "tool/call", data: {} },
    messageEvent(3, 2, { inputTokens: 2, outputTokens: 2 }),
  ]);
  assert.equal(folded.length, 2);
  assert.deepEqual(folded.map((item) => item.q), [1, 3]);
}

// ── 时间边界 ────────────────────────────────────────────────
{
  const now = new Date(2026, 10, 13, 15, 30, 0).getTime(); // 2026-11-13 周五
  assert.equal(dayKey(startOfDay(now)), "2026-11-13");
  assert.equal(dayKey(startOfWeek(now)), "2026-11-09"); // 周一
  assert.equal(dayKey(startOfMonth(now)), "2026-11-01");

  const sunday = new Date(2026, 10, 15, 9, 0, 0).getTime();
  assert.equal(dayKey(startOfWeek(sunday)), "2026-11-09");
  const monday = new Date(2026, 10, 16, 9, 0, 0).getTime();
  assert.equal(dayKey(startOfWeek(monday)), "2026-11-16");
}

// ── 汇总 ────────────────────────────────────────────────────
{
  const now = new Date(2026, 10, 13, 15, 30, 0).getTime();
  const entries = [
    // 今天：两次
    entry("a", 1, new Date(2026, 10, 13, 9, 0, 0).getTime(), { inputTokens: 100, outputTokens: 10 }),
    entry("a", 2, new Date(2026, 10, 13, 10, 0, 0).getTime(), { inputTokens: 50, outputTokens: 5 }, "deepseek-v4.1-pro"),
    // 本周内、非今天（11-10 周二）
    entry("a", 3, new Date(2026, 10, 10, 12, 0, 0).getTime(), { inputTokens: 200, outputTokens: 20 }),
    // 本月内、本周外（11-02）
    entry("b", 4, new Date(2026, 10, 2, 12, 0, 0).getTime(), { inputTokens: 1000, outputTokens: 100 }),
    // 上个月（10-20），只在 12 个月窗口里
    entry("b", 5, new Date(2026, 9, 20, 12, 0, 0).getTime(), { inputTokens: 3000, outputTokens: 300 }),
    // 一年半前：仅进 totals
    entry("c", 6, new Date(2025, 4, 1, 12, 0, 0).getTime(), { inputTokens: 9000, outputTokens: 900 }),
  ];

  const result = aggregate(entries, now);
  assert.equal(result.day.total, 165);
  assert.equal(result.day.calls, 2);
  assert.equal(result.week.total, 165 + 220);
  assert.equal(result.week.calls, 3);
  assert.equal(result.month.total, 165 + 220 + 1100);
  assert.equal(result.month.calls, 4);
  assert.equal(result.totals.calls, 6);
  assert.equal(result.totals.sessions, 3);

  // 序列长度与末位
  assert.equal(result.series.day.length, 14);
  assert.equal(result.series.day[13].key, "2026-11-13");
  assert.equal(result.series.day[13].total, 165);
  assert.equal(result.series.week.length, 12);
  assert.equal(result.series.week[11].key, "2026-11-09");
  assert.equal(result.series.week[11].total, 385);
  assert.equal(result.series.month.length, 12);
  assert.equal(result.series.month[11].key, "2026-11");
  assert.equal(result.series.month[11].total, 1485);
  assert.equal(result.series.month[10].key, "2026-10");
  assert.equal(result.series.month[10].total, 3300);

  // 模型分布跟随趋势窗口：近 14 天 = 11-02 起的全部记录，按总量降序
  assert.equal(result.models.day.length, 2);
  assert.equal(result.models.day[0].model, "deepseek-v4.1-flash");
  assert.equal(result.models.day[0].total, 110 + 220 + 1100);
  assert.equal(result.models.day[1].total, 55);
  assert.equal(result.models.month.length, 2);
  // 会话聚合：12 个月窗口里两个会话按总量降序，且与模型合计一致
  assert.equal(result.sessions.month.length, 2);
  assert.equal(result.sessions.month[0].id, "b");
  assert.equal(result.sessions.month[0].total, 3300 + 1100);
  assert.equal(result.sessions.month[1].id, "a");
  assert.equal(result.sessions.month[1].total, 165 + 220);
  const sessionSum = result.sessions.month.reduce((total, row) => total + row.total, 0);
  const modelSumMonth = result.models.month.reduce((total, row) => total + row.total, 0);
  assert.equal(sessionSum, modelSumMonth);
  // 近 14 天里 b 在 11-02 有一条 1100，比 a 的两天合计更大
  assert.equal(result.sessions.day[0].id, "b");

  // 模型分布与趋势柱之和一致
  const modelSum = result.models.day.reduce((total, row) => total + row.total, 0);
  const seriesSum = result.series.day.reduce((total, bucket) => total + bucket.total, 0);
  assert.equal(modelSum, seriesSum);

  // 求和一致：14 天窗口覆盖了整个 11 月数据，所以等于月合计。
  const sum = result.series.day.reduce((total, bucket) => total + bucket.total, 0);
  assert.equal(sum, result.month.total);
}

{
  // 空输入不炸，返回完整的空桶与空序列。
  const result = aggregate([], Date.now());
  assert.equal(result.totals.calls, 0);
  assert.equal(result.series.day.length, 14);
  assert.equal(result.series.week.length, 12);
  assert.equal(result.series.month.length, 12);
  assert.equal(result.models.month.length, 0);
}

// ── 裁剪与落盘归一 ──────────────────────────────────────────
{
  const now = Date.now();
  const kept = keepAfter([{ t: now - 10 }, { t: now - 100000 }], now - 1000);
  assert.equal(kept.length, 1);
}

{
  const state = normalizeState({
    version: 1,
    entries: [
      { s: "a", q: 1, t: 10, i: 1, r: 0, w: 0, o: 1, m: "m", p: "p", id: "a#1" },
      { s: "a", q: 2, t: "bad", i: 1, r: 0, w: 0, o: 1 },
      { nope: true },
    ],
    cursors: { a: 2, b: -1, c: "x" },
    scanned: ["a", 3, ""],
    backfillAt: 42,
  });
  assert.equal(state.entries.length, 1);
  assert.deepEqual(state.cursors, { a: 2 });
  assert.deepEqual(state.scanned, ["a"]);
  assert.equal(state.backfillAt, 42);
  assert.deepEqual(normalizeState("nope").entries, []);
  assert.deepEqual(emptyState().cursors, {});
}

// ── 配置归一 ────────────────────────────────────────────────
{
  const options = normalizeOptions({ historyDays: 0, dayCount: 999, retainDays: "x", path: "" });
  assert.equal(options.historyDays, 1);
  assert.equal(options.dayCount, 90);
  assert.equal(options.retainDays, 403); // 默认 400，按 12 个月窗口抬到 403
  assert.equal(options.path, undefined);
  assert.equal(normalizeOptions(null).weekCount, 12);
}

console.log("dsh-token-stats: smoke tests passed");
