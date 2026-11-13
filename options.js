// 配置归一：纯函数，单测直接跑；坏值退回默认值，不抛错。
export const DEFAULTS = {
  historyDays: 365,
  retainDays: 400,
  dayCount: 14,
  weekCount: 12,
  monthCount: 12,
};

function numberOr(value, fallback, min, max) {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, parsed));
}

/**
 * @param {unknown} options 插件行 config
 * @returns {{ path?: string, historyDays: number, retainDays: number, dayCount: number, weekCount: number, monthCount: number }}
 */
export function normalizeOptions(options = {}) {
  const source = options !== null && typeof options === "object" ? options : {};
  const monthCount = numberOr(source.monthCount, DEFAULTS.monthCount, 1, 36);
  // 月趋势要看得见，账本就至少得留够这些月份；配的保留天数更小就按需抬高。
  const retainFloor = monthCount * 31 + 31;
  return {
    path: typeof source.path === "string" && source.path !== "" ? source.path : undefined,
    historyDays: numberOr(source.historyDays, DEFAULTS.historyDays, 1, 3650),
    retainDays: Math.max(retainFloor, numberOr(source.retainDays, DEFAULTS.retainDays, 31, 3650)),
    dayCount: numberOr(source.dayCount, DEFAULTS.dayCount, 1, 90),
    weekCount: numberOr(source.weekCount, DEFAULTS.weekCount, 1, 53),
    monthCount,
  };
}
