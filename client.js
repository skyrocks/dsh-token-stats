// Client 半：「设置 → Token 用量」页。
//
// 数据全部来自 Host 侧 tokenStats 服务（见 service.js）：本文件只做请求、
// 展示与格式化，不读会话事件、不自己算账。
//
// 手写 lazy-CJS bundle：脚本执行时只注册 factory，模块体在 materialize 时才运行。
// 只依赖 React 与 DSH 既有服务（slots / remote），不引入 primitives。
window.__ModuleLoader__.load({
  id: "@skyrocks/dsh-token-stats",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");

    // Client 只声明调用形状；真正的校验在 Host 侧完成。
    const passThrough = () => ({ parse: (value) => value });
    const codec = (typeSymbol) => ({ mode: "strict", typeSymbol, create: passThrough });

    const REMOTE = {
      package: "@skyrocks/dsh-token-stats",
      descriptors: [
        {
          id: "@skyrocks/dsh-token-stats#tokenStats/read",
          service: "tokenStats",
          namespace: "tokenStats",
          method: "read",
          invocation: { kind: "direct" },
          parameters: [],
          result: codec("@skyrocks/dsh-token-stats#TokenStatsSnapshot")
        },
        {
          id: "@skyrocks/dsh-token-stats#tokenStats/refresh",
          service: "tokenStats",
          namespace: "tokenStats",
          method: "refresh",
          invocation: { kind: "direct" },
          parameters: [],
          result: codec("@skyrocks/dsh-token-stats#TokenStatsSnapshot")
        }
      ]
    };

    const SESSION_PAGE = 5;

    const GRANULARITY = [
      { id: "day", label: "按天", range: (config) => `近 ${config.dayCount} 天` },
      { id: "week", label: "按周", range: (config) => `近 ${config.weekCount} 周` },
      { id: "month", label: "按月", range: (config) => `近 ${config.monthCount} 个月` }
    ];

    const CSS = [
      ".dsh-ts-section{display:flex;flex-direction:column;gap:14px;max-width:760px;padding:2px 2px 20px;color:var(--dsw-alias-label-primary,#1f2329);font-size:13px;line-height:20px;}",
      ".dsh-ts-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}",
      ".dsh-ts-head h2{margin:0;font-size:18px;line-height:24px;font-weight:600;}",
      ".dsh-ts-intro{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8a8f98);}",
      ".dsh-ts-btn{flex:none;height:28px;padding:0 12px;border-radius:8px;border:0.5px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;}",
      "@media (hover:hover){.dsh-ts-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));}}",
      ".dsh-ts-btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4d6bfe));outline-offset:2px;}",
      ".dsh-ts-btn:disabled{opacity:.55;cursor:default;}",
      ".dsh-ts-scan{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-radius:10px;border:0.5px solid var(--dsw-alias-settings-card-stroke,rgba(127,127,127,.22));background:var(--dsw-alias-settings-card-fill,rgba(127,127,127,.04));}",
      ".dsh-ts-scan-head{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);}",
      ".dsh-ts-scan-note{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a8f98);}",
      ".dsh-ts-progress{position:relative;height:4px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-border-l2,rgba(127,127,127,.2));}",
      ".dsh-ts-progress i{position:absolute;inset:0 auto 0 0;display:block;border-radius:999px;background:var(--dsw-alias-state-business-primary,#4d6bfe);transition:width .3s ease;}",
      ".dsh-ts-progress.is-idle i{width:35%;animation:dsh-ts-slide 1.4s ease-in-out infinite;}",
      "@keyframes dsh-ts-slide{0%{transform:translateX(-40%)}100%{transform:translateX(320%)}}",
      ".dsh-ts-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;}",
      "@media (max-width:640px){.dsh-ts-cards{grid-template-columns:1fr;}}",
      ".dsh-ts-card{display:flex;flex-direction:column;gap:6px;padding:12px 14px;border-radius:var(--dsw-radius-xl,12px);border:0.5px solid var(--dsw-alias-settings-card-stroke,rgba(127,127,127,.22));background:var(--dsw-alias-settings-card-fill,rgba(127,127,127,.04));}",
      ".dsh-ts-card-label{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);}",
      ".dsh-ts-card-value{font-size:22px;line-height:28px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.01em;}",
      ".dsh-ts-card-value small{font-size:11px;font-weight:400;margin-left:3px;color:var(--dsw-alias-label-tertiary,#8a8f98);}",
      ".dsh-ts-card-rows{display:flex;flex-direction:column;gap:1px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a8f98);}",
      ".dsh-ts-card-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;white-space:nowrap;}",
      ".dsh-ts-card-row b{font-weight:500;color:var(--dsw-alias-label-secondary,#6b7280);font-variant-numeric:tabular-nums;}",
      ".dsh-ts-card-label{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);}",
      ".dsh-ts-card-label em{font-style:normal;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f98);white-space:nowrap;}",
      ".dsh-ts-block{display:flex;flex-direction:column;gap:8px;padding:12px 14px 10px;border-radius:12px;border:0.5px solid var(--dsw-alias-settings-card-stroke,rgba(127,127,127,.22));background:var(--dsw-alias-settings-card-fill,rgba(127,127,127,.04));}",
      ".dsh-ts-block-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}",
      ".dsh-ts-block-head h3{margin:0;font-size:13px;line-height:20px;font-weight:600;}",
      ".dsh-ts-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f98);font-variant-numeric:tabular-nums;}",
      ".dsh-ts-tabs{display:flex;align-items:center;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-skeleton,rgba(127,127,127,.1));}",
      ".dsh-ts-tab{height:24px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#6b7280);font:inherit;font-size:12px;line-height:24px;cursor:pointer;}",
      ".dsh-ts-tab[data-active='true']{background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#1f2329);box-shadow:0 1px 2px rgba(0,0,0,.08);}",
      ".dsh-ts-tab:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4d6bfe));outline-offset:1px;}",
      ".dsh-ts-legend{display:flex;flex-wrap:wrap;align-items:center;gap:12px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8f98);}",
      ".dsh-ts-legend b{font-weight:500;color:var(--dsw-alias-label-secondary,#6b7280);font-variant-numeric:tabular-nums;}",
      ".dsh-ts-dot{display:inline-block;width:6px;height:6px;border-radius:2px;margin-right:4px;vertical-align:1px;}",
      ".dsh-ts-dot.is-input{background:var(--dsw-alias-state-business-primary,#4d6bfe);}",
      ".dsh-ts-dot.is-cache{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 45%,transparent);}",
      ".dsh-ts-dot.is-output{background:var(--dsw-alias-state-success-primary,#2f9e44);}",
      ".dsh-ts-chart{display:flex;align-items:flex-end;gap:4px;height:150px;padding-top:18px;}",
      ".dsh-ts-y{flex:none;height:14px;text-align:center;font-size:9.5px;line-height:14px;color:var(--dsw-alias-label-tertiary,#8a8f98);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:visible;}",
      ".dsh-ts-barwrap{flex:1;min-height:0;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:2px;}",
      ".dsh-ts-col{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-end;height:100%;}",
      ".dsh-ts-bar{display:flex;flex-direction:column;width:100%;max-width:26px;min-height:2px;border-radius:3px 3px 0 0;overflow:hidden;background:transparent;}",
      ".dsh-ts-seg{display:block;width:100%;min-height:0;flex-basis:0;}",
      ".dsh-ts-seg.is-input{background:var(--dsw-alias-state-business-primary,#4d6bfe);}",
      ".dsh-ts-seg.is-cache{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4d6bfe) 45%,transparent);}",
      ".dsh-ts-seg.is-output{background:var(--dsw-alias-state-success-primary,#2f9e44);}",
      ".dsh-ts-bar.is-empty{height:2px !important;background:var(--dsw-alias-border-l2,rgba(127,127,127,.3));opacity:.5;}",
      "@media (hover:hover){.dsh-ts-col:hover .dsh-ts-seg{filter:brightness(1.08);}}",
      ".dsh-ts-x{height:18px;padding-top:4px;text-align:center;font-size:11px;line-height:12px;color:var(--dsw-alias-label-tertiary,#8a8f98);font-variant-numeric:tabular-nums;overflow:hidden;white-space:nowrap;}",
      ".dsh-ts-models{display:flex;flex-direction:column;gap:8px;}",
      ".dsh-ts-model{display:grid;grid-template-columns:minmax(0,1fr) auto 44px;align-items:center;gap:10px;}",
      ".dsh-ts-model-main{min-width:0;display:flex;flex-direction:column;gap:3px;}",
      ".dsh-ts-model-name{font-size:12px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".dsh-ts-model-name span{margin-left:6px;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8a8f98);}",
      ".dsh-ts-model-bar{height:3px;border-radius:999px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.18));overflow:hidden;}",
      ".dsh-ts-model-bar i{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary,#4d6bfe);opacity:.72;}",
      ".dsh-ts-num{font-size:12px;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}",
      ".dsh-ts-share{font-size:11px;text-align:right;color:var(--dsw-alias-label-tertiary,#8a8f98);font-variant-numeric:tabular-nums;}",
      ".dsh-ts-session-sub{margin-top:2px;font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-tertiary,#8a8f98);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
      ".dsh-ts-more-row{display:flex;justify-content:center;padding-top:2px;}",
      ".dsh-ts-more{border:0;padding:4px 8px;border-radius:6px;background:transparent;color:var(--dsw-alias-state-business-primary,#4d6bfe);font:inherit;font-size:12px;cursor:pointer;}",
      "@media (hover:hover){.dsh-ts-more:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1));}}",
      ".dsh-ts-more:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4d6bfe));outline-offset:2px;}",
      ".dsh-ts-empty{padding:18px 0;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a8f98);}",
      ".dsh-ts-error{padding:10px 12px;border-radius:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#e5484d);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#e5484d) 10%,transparent);}",
      ".dsh-ts-stack{margin:8px 0 0;padding:10px 12px;border-radius:var(--dsw-radius-xl,12px);background:var(--dsw-alias-bg-skeleton,rgba(127,127,127,.1));font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-all;max-height:320px;overflow:auto;}",
      ".dsh-ts-foot{margin:2px 0 0;font-size:12px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8a8f98);word-break:break-all;}",
      ".dsh-ts-foot code{font-family:inherit;opacity:.85;}",
    ].join("");

    function ensureStyle() {
      if (typeof document === "undefined") return () => {};
      const id = "dsh-token-stats-style";
      if (document.getElementById(id) !== null) return () => {};
      const element = document.createElement("style");
      element.id = id;
      element.textContent = CSS;
      document.head.appendChild(element);
      return () => {
        element.remove();
      };
    }

    // ───────────────────────────────────────────────────────────
    // 格式化
    // ───────────────────────────────────────────────────────────

    function full(number) {
      return Math.round(number || 0).toLocaleString("en-US");
    }

    /** 中文单位：13.47亿 / 752.9万 / 8,420。去掉多余的小数零。 */
    function compact(number) {
      const value = Math.round(number || 0);
      if (value >= 1e8) return `${trim(value / 1e8, value >= 1e10 ? 1 : 2)}亿`;
      if (value >= 1e4) return `${trim(value / 1e4, value >= 1e6 ? 0 : 1)}万`;
      return value.toLocaleString("en-US");
    }

    function trim(value, digits) {
      const text = value.toFixed(digits);
      return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
    }

    function share(part, whole) {
      if (!whole) return 0;
      return Math.round((part / whole) * 1000) / 10;
    }

    function errorText(error) {
      if (error instanceof Error && error.message) return error.message;
      return String(error === undefined || error === null ? "读取失败" : error);
    }

    /** 月-日 时:分，用于会话的最后活动时间。 */
    function stamp(time) {
      const date = new Date(typeof time === "number" && time > 0 ? time : Date.now());
      const pad = (value) => (value < 10 ? `0${value}` : String(value));
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    /** 本地时分：16:20。 */
    function clock(time) {
      const date = new Date(typeof time === "number" ? time : Date.now());
      const hours = date.getHours();
      const minutes = date.getMinutes();
      return `${hours < 10 ? `0${hours}` : hours}:${minutes < 10 ? `0${minutes}` : minutes}`;
    }

    /** 柱状图 X 轴文案：日/周显示月-日，月显示“11月”。 */
    function axisLabel(key, granularity) {
      if (typeof key !== "string") return "";
      if (granularity === "month") return `${Number(key.slice(5))}月`;
      return key.slice(5);
    }

    function bucketTitle(bucket) {
      return [
        bucket.key,
        `总 ${full(bucket.total)} tokens`,
        `输入 ${full(bucket.input)} · 缓存读 ${full(bucket.cacheRead)} · 缓存写 ${full(bucket.cacheWrite)} · 输出 ${full(bucket.output)}`,
        `${full(bucket.calls)} 次调用`
      ].join("\n");
    }

    // ───────────────────────────────────────────────────────────
    // 数据访问
    // ───────────────────────────────────────────────────────────

    let ctxRef = null;
    let mountReady = Promise.resolve();

    /** 调 Host 的 tokenStats/read 或 tokenStats/refresh。 */
    async function callToken(method) {
      await mountReady;
      let remote;
      try {
        remote = ctxRef === null ? undefined : ctxRef.get("remote.tokenStats");
      } catch {
        remote = undefined;
      }
      if (remote === undefined || remote === null || typeof remote[method] !== "function") {
        throw new Error("用量服务不可用（Host 未加载）");
      }
      // Remote 直调返回的是 { ok, value } 信封，不是数据本身。
      const result = await remote[method]();
      if (result === null || typeof result !== "object" || result.ok !== true) {
        const failure = result && result.error;
        throw new Error(failure && failure.message ? failure.message : "读取失败");
      }
      return result.value;
    }

    /**
     * 会话标题：直接用浏览器侧会话列表（侧边栏那份）里的 title / displayTitle，
     * 内存里就有，不用去读会话日志。取不到再落到 Host 账本里的标题。
     */
    function sessionTitleOf(id) {
      try {
        const sessions = ctxRef === null ? undefined : ctxRef.get("sessions");
        const state = sessions && sessions.list && typeof sessions.list.getSnapshot === "function"
          ? sessions.list.getSnapshot()
          : null;
        const summary = state && state.byId ? state.byId[id] : null;
        if (!summary) return "";
        const title = typeof summary.title === "string" ? summary.title.trim() : "";
        if (title !== "") return title;
        return typeof summary.displayTitle === "string" ? summary.displayTitle : "";
      } catch {
        return "";
      }
    }

    // ───────────────────────────────────────────────────────────
    // 组件
    // ───────────────────────────────────────────────────────────

    function SummaryCard(props) {
      const bucket = props.bucket || {};
      const total = bucket.total || 0;
      const input = bucket.input || 0;
      const cache = (bucket.cacheRead || 0) + (bucket.cacheWrite || 0);
      const output = bucket.output || 0;
      const calls = bucket.calls || 0;
      return React.createElement(
        "div",
        { className: "dsh-ts-card" },
        React.createElement(
          "div",
          { className: "dsh-ts-card-label" },
          React.createElement("span", null, props.label),
          React.createElement("em", null, `${full(calls)} 次调用`)
        ),
        React.createElement(
          "div",
          { className: "dsh-ts-card-value", title: `${full(total)} tokens` },
          compact(total),
          React.createElement("small", null, "tokens")
        ),
        React.createElement(
          "div",
          { className: "dsh-ts-card-rows" },
          React.createElement(
            "div",
            { className: "dsh-ts-card-row" },
            React.createElement("span", null, "输入"),
            React.createElement("b", null, compact(input))
          ),
          React.createElement(
            "div",
            { className: "dsh-ts-card-row" },
            React.createElement("span", null, "缓存读写"),
            React.createElement("b", null, compact(cache))
          ),
          React.createElement(
            "div",
            { className: "dsh-ts-card-row" },
            React.createElement("span", null, "输出"),
            React.createElement("b", null, compact(output))
          )
        )
      );
    }

    /** 一根柱子按「输出 / 缓存 / 输入」三段堆叠，高度与 token 数成比例。 */
    function segmentsOf(bucket) {
      const parts = [
        ["is-output", bucket.output],
        ["is-cache", bucket.cacheRead + bucket.cacheWrite],
        ["is-input", bucket.input]
      ];
      return parts
        .filter(([, value]) => value > 0)
        .map(([name, value]) => React.createElement("i", {
          key: name,
          className: `dsh-ts-seg ${name}`,
          style: { flexGrow: value }
        }));
    }

    function Chart(props) {
      const series = props.series;
      const granularity = props.granularity;
      let max = 1;
      let input = 0;
      let cache = 0;
      let output = 0;
      let calls = 0;
      for (const bucket of series) {
        if (bucket.total > max) max = bucket.total;
        input += bucket.input;
        cache += bucket.cacheRead + bucket.cacheWrite;
        output += bucket.output;
        calls += bucket.calls;
      }
      if (calls === 0) {
        return React.createElement("div", { className: "dsh-ts-empty" }, "这个区间还没有调用。");
      }
      const sparse = series.length > 8;
      return React.createElement(
        "div",
        null,
        React.createElement(
          "div",
          { className: "dsh-ts-legend" },
          React.createElement("span", null, React.createElement("i", { className: "dsh-ts-dot is-input" }), "输入 ", React.createElement("b", null, compact(input))),
          React.createElement("span", null, React.createElement("i", { className: "dsh-ts-dot is-cache" }), "缓存读写 ", React.createElement("b", null, compact(cache))),
          React.createElement("span", null, React.createElement("i", { className: "dsh-ts-dot is-output" }), "输出 ", React.createElement("b", null, compact(output))),
          React.createElement("span", { className: "dsh-ts-meta" }, `共 ${full(calls)} 次调用`)
        ),
        React.createElement(
          "div",
          { className: "dsh-ts-chart", role: "img", "aria-label": "token 用量趋势，按输入 / 缓存 / 输出堆叠" },
          series.map((bucket, index) => React.createElement(
            "div",
            { className: "dsh-ts-col", key: bucket.key },
            React.createElement(
              "div",
              { className: "dsh-ts-barwrap" },
              React.createElement(
                "div",
                { className: "dsh-ts-y" },
                bucket.total > 0 ? compact(bucket.total) : ""
              ),
              React.createElement(
                "div",
                {
                  className: bucket.total > 0 ? "dsh-ts-bar" : "dsh-ts-bar is-empty",
                  style: { height: `${bucket.total > 0 ? Math.max(3, Math.round((bucket.total / max) * 100)) : 2}%` },
                  title: bucketTitle(bucket)
                },
                bucket.total > 0 ? segmentsOf(bucket) : null
              )
            ),
            React.createElement(
              "div",
              { className: "dsh-ts-x" },
              sparse && index % 2 === 1 && index !== series.length - 1 ? "" : axisLabel(bucket.key, granularity)
            )
          ))
        )
      );
    }

    function Models(props) {
      const rows = props.rows;
      const total = rows.reduce((sum, row) => sum + row.total, 0);
      if (rows.length === 0 || total === 0) {
        return React.createElement("div", { className: "dsh-ts-empty" }, "这个区间还没有模型调用。");
      }
      const head = rows.slice(0, 7);
      const rest = rows.slice(7);
      const list = head.slice();
      if (rest.length > 0) {
        const other = { model: `其他 ${rest.length} 个模型`, provider: "", total: 0, calls: 0 };
        for (const row of rest) {
          other.total += row.total;
          other.calls += row.calls;
        }
        list.push(other);
      }
      return React.createElement(
        "div",
        { className: "dsh-ts-models" },
        list.map((row, index) => React.createElement(
          "div",
          { className: "dsh-ts-model", key: `${row.model}-${index}` },
          React.createElement(
            "div",
            { className: "dsh-ts-model-main" },
            React.createElement(
              "div",
              { className: "dsh-ts-model-name", title: row.model === "" ? "未知模型（失败 / 重试的尝试）" : row.model },
              row.model === "" ? "未知模型" : row.model,
              row.provider === "" ? null : React.createElement("span", null, row.provider)
            ),
            React.createElement(
              "div",
              { className: "dsh-ts-model-bar" },
              React.createElement("i", { style: { width: `${Math.max(1, share(row.total, total))}%` } })
            )
          ),
          React.createElement("div", { className: "dsh-ts-num", title: `${full(row.total)} tokens · ${full(row.calls)} 次调用` }, compact(row.total)),
          React.createElement("div", { className: "dsh-ts-share" }, `${share(row.total, total)}%`)
        ))
      );
    }

    /** 会话 id 的短形式，没有标题时的兜底：会话 07c0196e。 */
    function shortId(id) {
      const text = String(id || "").replace(/^session-/, "");
      return `会话 ${text.slice(0, 8)}`;
    }

    function Sessions(props) {
      const rows = props.rows;
      const total = rows.reduce((sum, row) => sum + row.total, 0);
      if (rows.length === 0 || total === 0) {
        return React.createElement("div", { className: "dsh-ts-empty" }, "这个区间还没有会话用量。");
      }
      const list = rows.slice(0, props.visible);
      return React.createElement(
        "div",
        { className: "dsh-ts-models" },
        list.map((row, index) => React.createElement(
          "div",
          { className: "dsh-ts-model", key: `${row.id}-${index}` },
          React.createElement(
            "div",
            { className: "dsh-ts-model-main" },
            React.createElement(
              "div",
              { className: "dsh-ts-model-name", title: row.title === "" ? row.id : row.title },
              row.title === "" ? shortId(row.id) : row.title
            ),
            React.createElement(
              "div",
              { className: "dsh-ts-session-sub" },
              `${full(row.calls)} 次调用 · 最后 ${stamp(row.lastAt)}`
            ),
            React.createElement(
              "div",
              { className: "dsh-ts-model-bar" },
              React.createElement("i", { style: { width: `${Math.max(1, share(row.total, total))}%` } })
            )
          ),
          React.createElement("div", { className: "dsh-ts-num", title: `${full(row.total)} tokens` }, compact(row.total)),
          React.createElement("div", { className: "dsh-ts-share" }, `${share(row.total, total)}%`)
        )),
        React.createElement(
          "div",
          { className: "dsh-ts-more-row" },
          rows.length > props.visible
            ? React.createElement(
                "button",
                {
                  type: "button",
                  className: "dsh-ts-more",
                  onClick: () => props.onMore(props.visible + 10)
                },
                `加载更多（还有 ${full(rows.length - props.visible)} 个）`
              )
            : props.visible > props.initial
              ? React.createElement(
                  "button",
                  { type: "button", className: "dsh-ts-more", onClick: () => props.onMore(props.initial) },
                  "收起"
                )
              : null
        )
      );
    }

    function Scanning(props) {
      const scanning = props.scanning;
      const total = scanning.total;
      const done = scanning.done;
      const width = total > 0 ? Math.max(2, Math.round((done / total) * 100)) : 0;
      return React.createElement(
        "div",
        { className: "dsh-ts-scan", role: "status" },
        React.createElement(
          "div",
          { className: "dsh-ts-scan-head" },
          React.createElement("span", null, total > 0 ? "正在统计历史会话…" : "正在整理会话列表…"),
          React.createElement("span", null, total > 0 ? `${done} / ${total}` : "")
        ),
        React.createElement(
          "div",
          { className: total > 0 ? "dsh-ts-progress" : "dsh-ts-progress is-idle" },
          React.createElement("i", { style: total > 0 ? { width: `${width}%` } : undefined })
        ),
        React.createElement(
          "div",
          { className: "dsh-ts-scan-note" },
          "只读扫描本地会话日志，一次性完成；页面可以先关掉，Host 会继续。"
        )
      );
    }

    function Pending() {
      return React.createElement(
        "div",
        { className: "dsh-ts-empty" },
        "正在回填历史会话，数字稍后会自动更新。"
      );
    }

    function TokenStatsSection() {
      const [state, setState] = React.useState({ status: "loading", data: null, error: null });
      const [busy, setBusy] = React.useState(false);
      const [granularity, setGranularity] = React.useState("day");
      const [sessionVisible, setSessionVisible] = React.useState(SESSION_PAGE);
      const alive = React.useRef(true);
      const timer = React.useRef(null);
      const seq = React.useRef(0);
      const lastData = React.useRef(null);

      const load = async (manual) => {
        const mine = ++seq.current;
        try {
          const data = await callToken(manual ? "refresh" : "read");
          if (!alive.current || mine !== seq.current) return null;
          lastData.current = data;
          setState({ status: "ready", data, error: null });
          return data;
        } catch (error) {
          if (!alive.current || mine !== seq.current) return null;
          setState({ status: "error", data: lastData.current, error: errorText(error) });
          return null;
        }
      };

      const schedule = (ms) => {
        timer.current = setTimeout(() => {
          if (typeof document !== "undefined" && document.visibilityState === "hidden") {
            schedule(15000);
            return;
          }
          void poll(false);
        }, ms);
      };

      const poll = async (manual) => {
        const data = await load(manual);
        if (!alive.current) return;
        if (data === null) {
          // 一次失败不丢已有数据：5 秒后自动再试。
          schedule(5000);
          return;
        }
        // 回填中快轮询；之后就慢慢看，页面开着也能跟上新用量。
        schedule(data.scanning === null || data.scanning === undefined ? 30000 : 1200);
      };

      React.useEffect(() => {
        alive.current = true;
        void poll(false);
        const onVisible = () => {
          if (typeof document !== "undefined" && document.visibilityState === "visible") {
            clearTimeout(timer.current);
            void poll(false);
          }
        };
        if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
        return () => {
          alive.current = false;
          clearTimeout(timer.current);
          if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
        };
      }, []);

      const refresh = async () => {
        if (busy) return;
        setBusy(true);
        clearTimeout(timer.current);
        await poll(true);
        if (alive.current) setBusy(false);
      };

      const header = React.createElement(
        "div",
        { className: "dsh-ts-head" },
        React.createElement(
          "div",
          null,
          React.createElement("h2", null, "Token 用量"),
          React.createElement(
            "p",
            { className: "dsh-ts-intro" },
            "所有会话（含子代理）里模型返回的 token 用量，按本地时间切分为日 / 周 / 月。"
          )
        ),
        React.createElement(
          "button",
          {
            type: "button",
            className: "dsh-ts-btn",
            disabled: state.status === "loading" || busy,
            onClick: () => {
              void refresh();
            }
          },
          busy ? "刷新中…" : "刷新"
        )
      );

      const data = state.data;

      if (data === null) {
        if (state.status === "error") {
          return React.createElement(
            "div",
            { className: "dsh-ts-section" },
            header,
            React.createElement("div", { className: "dsh-ts-error", role: "alert" }, state.error),
            React.createElement(
              "div",
              null,
              React.createElement(
                "button",
                { type: "button", className: "dsh-ts-btn", onClick: () => { void refresh(); } },
                "重试"
              )
            )
          );
        }
        return React.createElement(
          "div",
          { className: "dsh-ts-section" },
          header,
          React.createElement("div", { className: "dsh-ts-empty" }, "读取中…")
        );
      }

      const config = data.config || { historyDays: 365, dayCount: 14, weekCount: 12, monthCount: 12, storePath: "" };
      const scanning = data.scanning === null || data.scanning === undefined ? null : data.scanning;
      const counts = data.counts || { calls: 0, sessions: 0, entries: 0 };
      const totals = data.totals || { calls: 0, sessions: 0, firstAt: 0, lastAt: 0 };
      const pending = scanning !== null && counts.calls === 0;
      const active = GRANULARITY.find((item) => item.id === granularity) ?? GRANULARITY[0];
      const series = Array.isArray(data.series && data.series[active.id]) ? data.series[active.id] : [];
      const rows = Array.isArray(data.models && data.models[active.id]) ? data.models[active.id] : [];
      const sessionRows = Array.isArray(data.sessions && data.sessions[active.id]) ? data.sessions[active.id] : [];
      const titledSessions = sessionRows.map((row) => ({ ...row, title: sessionTitleOf(row.id) || row.title || "" }));

      return React.createElement(
        "div",
        { className: "dsh-ts-section" },
        header,
        state.status === "error"
          ? React.createElement("div", { className: "dsh-ts-error", role: "alert" }, `刷新失败：${state.error}（下面还是上次的数据）`)
          : null,
        scanning === null ? null : React.createElement(Scanning, { scanning }),
        data.backfillAvailable === false && scanning === null
          ? React.createElement("div", { className: "dsh-ts-scan-note" }, "没有本地会话查询服务，只能统计本次运行中打开的会话。")
          : null,
        pending
          ? React.createElement(Pending, null)
          : React.createElement(
              React.Fragment,
              null,
              React.createElement(
                "div",
                { className: "dsh-ts-cards" },
                React.createElement(SummaryCard, { label: "今日", bucket: data.day || {} }),
                React.createElement(SummaryCard, { label: "本周", bucket: data.week || {} }),
                React.createElement(SummaryCard, { label: "本月", bucket: data.month || {} })
              ),
              React.createElement(
                "div",
                { className: "dsh-ts-block" },
                React.createElement(
                  "div",
                  { className: "dsh-ts-block-head" },
                  React.createElement(
                    "div",
                    { className: "dsh-ts-tabs", role: "tablist", "aria-label": "统计粒度" },
                    GRANULARITY.map((item) => React.createElement(
                      "button",
                      {
                        key: item.id,
                        type: "button",
                        role: "tab",
                        className: "dsh-ts-tab",
                        "data-active": item.id === granularity ? "true" : undefined,
                        "aria-selected": item.id === granularity,
                        onClick: () => {
                          setGranularity(item.id);
                          setSessionVisible(SESSION_PAGE);
                        }
                      },
                      item.label
                    ))
                  ),
                  React.createElement("span", { className: "dsh-ts-meta" }, active.range(config))
                ),
                React.createElement(Chart, { series, granularity: active.id })
              ),
              React.createElement(
                "div",
                { className: "dsh-ts-block" },
                React.createElement(
                  "div",
                  { className: "dsh-ts-block-head" },
                  React.createElement("h3", null, "模型分布"),
                  React.createElement("span", { className: "dsh-ts-meta" }, active.range(config))
                ),
                React.createElement(Models, { rows })
              ),
              React.createElement(
                "div",
                { className: "dsh-ts-block" },
                React.createElement(
                  "div",
                  { className: "dsh-ts-block-head" },
                  React.createElement("h3", null, "会话消耗"),
                  React.createElement(
                    "span",
                    { className: "dsh-ts-meta" },
                    `${active.range(config)} · 共 ${full(sessionRows.length)} 个会话`
                  )
                ),
                React.createElement(Sessions, {
                  rows: titledSessions,
                  visible: sessionVisible,
                  initial: SESSION_PAGE,
                  onMore: setSessionVisible
                })
              )
            ),
        React.createElement(
          "p",
          { className: "dsh-ts-foot" },
          "口径：输入指未命中缓存的输入 token，缓存读写单列，合计 = 输入 + 缓存读写 + 输出；失败 / 重试但报了用量的尝试也计一次调用（模型记作未知）。数据来自会话日志，按本地时区切日（周一为周起点），历史回填范围是最近 ",
          `${config.historyDays} 天创建的会话。账本：`,
          React.createElement("code", null, config.storePath),
          totals.calls > 0
            ? `；已统计 ${full(totals.calls)} 次调用 / ${full(totals.sessions)} 个会话，更新于 ${clock(data.generatedAt)}。`
            : "。"
        )
      );
    }

    /**
     * 页面兜底：渲染里真出错时把错误显示在设置面板里，而不是让 slot 整块空白。
     * 平时不参与任何逻辑，只在崩溃时接管。
     */
    class SectionBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }

      static getDerivedStateFromError(error) {
        return { error };
      }

      componentDidCatch(error) {
        try {
          console.error("[dsh-token-stats]", error);
        } catch {
          /* 控制台不可用就算了 */
        }
      }

      render() {
        if (this.state.error === null) return this.props.children;
        const detail = this.state.error && this.state.error.stack ? String(this.state.error.stack) : String(this.state.error);
        return React.createElement(
          "div",
          { className: "dsh-ts-section" },
          React.createElement("div", { className: "dsh-ts-error", role: "alert" }, "Token 用量页面渲染失败"),
          React.createElement(
            "pre",
            { className: "dsh-ts-stack" },
            detail.slice(0, 1200)
          )
        );
      }
    }

    /** 设置导航里的小图标：三根柱子。 */
    function StatsIcon(props) {
      const size = props !== null && typeof props === "object" && typeof props.size === "number" ? props.size : 16;
      return React.createElement(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 16 16",
          fill: "none",
          "aria-hidden": "true",
          focusable: "false"
        },
        React.createElement("path", {
          d: "M3.5 13V9.5M8 13V3.5M12.5 13V7",
          stroke: "currentColor",
          strokeWidth: 1.6,
          strokeLinecap: "round"
        })
      );
    }

    function apply(ctx) {
      ctxRef = ctx;
      mountReady = ctx.remote.$mount(REMOTE);
      const slots = ctx.get("slots");
      if (slots === undefined) return;
      ctx.effect(() => ensureStyle());
      slots.inject("settings.section", () =>
        slots.register(
          { name: "settings.section", id: "token-stats", order: 36, label: () => "Token 用量" },
          (props) => React.createElement(SectionBoundary, null, React.createElement(TokenStatsSection, props))
        )
      );
      slots.inject("settings.section.icon", () =>
        slots.register({ name: "settings.section.icon", id: "token-stats", order: 36 }, StatsIcon)
      );
    }

    exports.apply = apply;
    exports.inject = ["slots", "remote", "sessions"];
    exports.__internals = { callToken, compact, full, share, clock, stamp, axisLabel, bucketTitle, shortId, Sessions };
    return module.exports;
  }
});
