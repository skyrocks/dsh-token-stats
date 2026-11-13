// Client 模块测试：在 Node 里假装浏览器的 module loader 与 React，
// 验证 factory 能加载、apply() 注册了设置页与图标、不碰真实 DOM。
// 运行：node test/client.mjs
import assert from "node:assert/strict";

const registrations = [];
const effects = [];
let moduleExports = null;

globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      assert.equal(id, "@skyrocks/dsh-token-stats");
      moduleExports = factory((name) => {
        if (name !== "react") throw new Error(`unexpected require: ${name}`);
        class Component {
          constructor(props) {
            this.props = props;
            this.state = {};
          }
          setState(next) {
            this.state = { ...this.state, ...next };
          }
        }
        return {
          createElement: (type, props, ...children) => ({ type, props, children }),
          Component,
          Fragment: "Fragment",
          useState: () => [undefined, () => {}],
          useEffect: () => {},
          useRef: (value) => ({ current: value }),
        };
      });
    },
  },
};

await import("../client.js");
assert.notEqual(moduleExports, null, "factory 必须把模块交回来");
assert.equal(typeof moduleExports.apply, "function");
assert.deepEqual(moduleExports.inject, ["slots", "remote", "sessions"]);

const ctx = {
  effect(fn) {
    effects.push(fn);
    const disposer = fn();
    if (typeof disposer === "function") disposer();
    return () => {};
  },
  get(name) {
    if (name === "slots") return slots;
    if (name === "remote.tokenStats") return remoteNamespace;
    return undefined;
  },
  remote: {
    $mount(remote) {
      assert.equal(remote.package, "@skyrocks/dsh-token-stats");
      assert.deepEqual(remote.descriptors.map((item) => item.method), ["read", "refresh"]);
      return Promise.resolve();
    },
  },
};

const remoteNamespace = {
  mode: "ok",
  async read() {
    if (this.mode === "fail") return { ok: false, error: { message: "Host 挂了" } };
    return { ok: true, value: { generatedAt: 1, counts: { calls: 1, sessions: 1, entries: 1 } } };
  },
  async refresh() {
    return this.read();
  },
};

const slots = {
  inject(owner, register) {
    assert.equal(typeof register, "function");
    const result = register();
    assert.equal(result.owner, owner);
    registrations.push(result);
    return () => {};
  },
  register(options, component) {
    assert.equal(typeof component, "function");
    return { owner: options.name, options, component };
  },
};

moduleExports.apply(ctx);

assert.equal(effects.length, 1, "apply 应通过 ctx.effect 安装样式");
const section = registrations.find((item) => item.owner === "settings.section");
const icon = registrations.find((item) => item.owner === "settings.section.icon");
assert.notEqual(section, undefined, "必须注册 settings.section");
assert.notEqual(icon, undefined, "必须注册 settings.section.icon");
assert.equal(section.options.id, "token-stats");
assert.equal(icon.options.id, "token-stats");
assert.equal(section.options.label(), "Token 用量");
assert.equal(typeof section.component, "function");
assert.equal(typeof icon.component, "function");

// 页面外面套了错误边界：正常时它原样渲染 children，出错时接管显示错误。
const guarded = section.component({});
assert.equal(typeof guarded.type, "function");
const child = guarded.children[0];
const boundary = new guarded.type({ children: child });
assert.equal(boundary.state.error, null);
assert.equal(boundary.render(), child);
boundary.state.error = new Error("boom");
const failed = boundary.render();
assert.notEqual(failed, child, "出错时应渲染错误提示而不是原内容");

// 图标是纯 SVG，Node 里只要不抛错即可。
const tree = icon.component({ size: 16, active: true });
assert.equal(tree.type, "svg");
assert.equal(icon.component({}).props.width, 16);

// Remote 直调返回 { ok, value } 信封：必须解包，失败要抛错。
const internals = moduleExports.__internals;
{
  const snapshot = await internals.callToken("read");
  assert.equal(snapshot.counts.calls, 1, "应当解包出 value");
  remoteNamespace.mode = "fail";
  await assert.rejects(() => internals.callToken("read"), /Host 挂了/);
  remoteNamespace.mode = "ok";
}

// 会话列表：默认 5 个 + 加载更多，不再是「其他 N 个会话」。
{
  const rows = Array.from({ length: 7 }, (_, index) => ({
    id: `session-${index}`,
    title: `会话标题 ${index}`,
    total: (7 - index) * 1000,
    calls: 3,
    lastAt: 1794557037176
  }));
  let asked = 0;
  const tree = internals.Sessions({ rows, visible: 5, initial: 5, onMore: (next) => { asked = next; } });
  assert.equal(tree.children[0].length, 5, "默认 5 行");
  const moreRow = tree.children[1];
  const button = moreRow.children[0];
  assert.match(button.children[0], /还有 2 个/);
  button.props.onClick();
  assert.equal(asked, 15, "每次加载 10 个");
  // 全部展开后是「收起」
  const expanded = internals.Sessions({ rows, visible: 7, initial: 5, onMore: () => {} });
  assert.equal(expanded.children[0].length, 7);
  assert.equal(expanded.children[1].children[0].children[0], "收起");
}

// 格式化：compact 单位、占比、时钟。
assert.equal(internals.compact(999), "999");
assert.equal(internals.compact(8420), "8,420");
assert.equal(internals.compact(15000), "1.5万");
assert.equal(internals.compact(1234567), "123万");
assert.equal(internals.compact(1346700000), "13.47亿");
assert.equal(internals.compact(20000000000), "200亿");
assert.equal(internals.share(50, 200), 25);
assert.equal(internals.share(0, 0), 0);
assert.equal(internals.axisLabel("2026-11-13", "day"), "11-13");
assert.equal(internals.axisLabel("2026-11", "month"), "11月");
assert.match(internals.clock(1794557037176), /^\d{2}:\d{2}$/);

console.log("dsh-token-stats: client tests passed");
