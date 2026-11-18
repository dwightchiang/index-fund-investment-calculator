// 验证 pinJcRowsTop：把纳指100 从第 2 位拉回第 1 位
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

// 用户的现状：科创综指第一，纳指100 第二（上一版 bug 的结果）
const list = [
  { id:"x-1", code:"1B0680", name:"科创综指", min:"", unit:10, pe:"", pb:"", mpct:"" },
  { id:"jc-r-0", code:"NDX", name:"纳斯达克100", min:"", unit:10, pe:"", pb:"", mpct:"",
    jc:"NDX.GI", formula:"jc20" },
  { id:"a-2", code:"399997", name:"中证白酒", min:"3.2", unit:10, pe:"", pb:"", mpct:"" },
];
store.set("dca-web-v4", JSON.stringify({
  seedVer: 9, list1: list, list2: [], list3: [],
  order: list.map(x=>x.code), last:{}, src:{},
  seed9Cleanup: 1, jcTopVer: 1, jcRestoreVer: 1,
  // pinTopVer 故意不给 → 应触发修正
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
  const order = vm.runInContext("state.order.slice()", sandbox);
  console.log("order:", order.join(", "));
  const view = vm.runInContext("viewOrder().map(x=>x.code)", sandbox);
  console.log("显示:", view.join(", "));

  check("① 纳指100 回到第一位", view[0], "NDX");
  // 其余三行都在、且没有重复/丢失（相对顺序由多个迁移综合决定，这里只校验集合）
  check("② 其余两行都还在", view.slice(1).sort(), ["1B0680","399997"]);
  check("④ 没有重复", view.length, new Set(view).size);
  check("⑤ order 与显示一致", order[0], "NDX");

  // 幂等：再跑一次不应该改变
  const again = vm.runInContext("state.pinTopVer=0; pinJcRowsTop(); state.order.slice()", sandbox);
  check("⑥ 重复执行结果不变", again.join(","), order.join(","));

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
