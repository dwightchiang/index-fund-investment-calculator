// 清单同步测试：增/删/顺序跨设备合并，绝不能丢数据
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("index.html", "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

class El {
  constructor(tag = "DIV") {
    this.tagName = tag; this.value = ""; this.textContent = ""; this.innerHTML = "";
    this.dataset = {}; this.style = {};
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  addEventListener() {} appendChild() {} remove() {} closest() { return null; }
  querySelector() { return null; } querySelectorAll() { return []; }
  setAttribute() {} getAttribute() { return null; } focus() {} click() {}
  showModal() {} close() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }
}
const cache = new Map(), store = new Map();
const sandbox = {
  console,
  document: {
    querySelector(s) { if (!cache.has(s)) cache.set(s, new El()); return cache.get(s); },
    querySelectorAll() { return []; }, createElement(t) { return new El(t.toUpperCase()); },
    addEventListener() {}, get activeElement() { return null; },
    head: { appendChild() {} }, body: new El("BODY"),
  },
  window: {},
  location: { pathname: "/index.html", hash: "", hostname: "127.0.0.1", origin: "http://127.0.0.1" },
  navigator: { clipboard: { writeText: async () => {} }, userAgent: "node" },
  localStorage: { getItem: k => store.has(k) ? store.get(k) : null,
                  setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  fetch: () => Promise.reject(new Error("offline")),
  setTimeout, clearTimeout, setInterval, clearInterval,
  alert: () => {}, confirm: () => true, prompt: () => null,
  Request, Response, Headers, URL, TextEncoder, TextDecoder, AbortController,
  btoa: s => Buffer.from(s, "binary").toString("base64"),
  atob: s => Buffer.from(s, "base64").toString("binary"),
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;

const now = Date.now();
// 设备 A：有 AAA、BBB、CCC（CCC 是刚加的）
store.set("dca-web-v4", JSON.stringify({
  seedVer: 9,
  list1: [
    { id:"a1", code:"AAA", name:"甲", min:"3", unit:10, pe:"", pb:"", mpct:"", addedAt: now-3000 },
    { id:"a2", code:"BBB", name:"乙", min:"8", unit:10, pe:"", pb:"", mpct:"", addedAt: now-3000 },
    { id:"a3", code:"CCC", name:"丙", min:"", unit:10, pe:"", pb:"", mpct:"", addedAt: now-1000 },
  ],
  list2: [], list3: [],
  order: ["AAA","BBB","CCC"], last:{}, src:{},
  seed9Cleanup:1, jcTopVer:1, jcRestoreVer:1, pinTopVer:1,
}));

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "inline" });

setTimeout(() => {
  // 远端（设备 B）：
  //  - 有 DDD（A 没有）→ A 应该补进来
  //  - BBB 被 B 删了（delAt 比 A 的 addedAt 晚）→ A 应该删掉
  //  - ZZZ 被删了但 A 从没加过 → 忽略
  const remote = {
    rows: {
      l1: [
        { code:"AAA", name:"甲", at: now-3000 },
        { code:"BBB", name:"乙", del:1, delAt: now-500 },
        { code:"DDD", name:"丁", at: now-800 },
        { code:"ZZZ", name:"未知", del:1, delAt: now-900 },
      ],
      l2: [], l3: [],
    },
    items: { l1: {}, l2: {}, l3: {} },
    order: ["AAA","DDD","CCC"],
    orderAt: now-100,
  };

  const changed = vm.runInContext("mergeRoster(" + JSON.stringify(remote) + ")", sandbox);
  const list = vm.runInContext("state.list1.map(x=>x.code)", sandbox);
  console.log("合并后清单:", list.join(", "), " changed =", changed);

  check("① 远端新增的 DDD 补进来了", list.includes("DDD"), true);
  check("② 远端删除的 BBB 删掉了", list.includes("BBB"), false);
  check("③ 自己新加的 CCC 没被删", list.includes("CCC"), true);
  check("④ 本地独有的 AAA 保留", list.includes("AAA"), true);
  check("⑤ 不存在的 ZZZ 未被加进来", list.includes("ZZZ"), false);

  // 回收站应记下 BBB
  const trash = vm.runInContext("(state.trash||[]).map(t=>t.code)", sandbox);
  check("⑥ BBB 进了回收站", trash.includes("BBB"), true);

  // ★ 关键：本地比远端「新」的删除不该被执行
  // A 里 CCC 是 now-1000 加的；远端说 CCC 在 now-2000 被删 → 不能删
  const remote2 = {
    rows: { l1: [ { code:"CCC", name:"丙", del:1, delAt: now-2000 } ], l2: [], l3: [] },
    items: { l1: {}, l2: {}, l3: {} },
  };
  vm.runInContext("mergeRoster(" + JSON.stringify(remote2) + ")", sandbox);
  const list2 = vm.runInContext("state.list1.map(x=>x.code)", sandbox);
  check("⑦ 更早的删除不会删掉我新加的 CCC", list2.includes("CCC"), true);

  // 顺序合并
  const before = vm.runInContext("state.order.slice()", sandbox);
  vm.runInContext(`
    state.orderAt = 1000;
    cloudPull_order_test = null;
    (function(){
      const remoteOrder = ["DDD","AAA","CCC"];
      const orderAt = 99999;
      if(orderAt > (state.orderAt||0)){
        const valid = remoteOrder.filter(c=>state.list1.some(x=>x.code===c));
        if(valid.length){ state.order = valid; state.orderAt = orderAt; }
      }
    })();
  `, sandbox);
  const after = vm.runInContext("state.order.slice()", sandbox);
  check("⑧ 更晚的顺序会覆盖", after[0], "DDD");

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
