// 场景二：NDX 已被清理误删 → restoreJcRows 应自动补回，且不重复、仍在首位
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

// 模拟「刚被清理误删了 NDX」的状态：清理标记已置位，但清单里没有 NDX
const user31 = Array.from({length:31}, (_,i)=>({
  id:"a-"+i, code:"C"+i, name:"指数"+i, min:String(3+i*0.4), unit:10, pe:"", pb:"", mpct:""
}));
store.set("dca-web-v4", JSON.stringify({
  seedVer: 9,
  list1: user31,
  list2: [], list3: [],
  order: user31.map(x=>x.code),
  last: {}, src: {},
  seed9Cleanup: 1,          // 清理已跑过
  jcTopVer: 1,              // NDX 置顶迁移也跑过
  // jcRestoreVer 故意不给 → 应触发自动补回
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
  const list = vm.runInContext("state.list1.map(x=>x.code)", sandbox);
  console.log(`补回后共 ${list.length} 行`);

  check("① NDX 被自动补回", list.includes("NDX"), true);
  check("② 总数 31+1=32", list.length, 32);
  check("③ NDX 在首位", list[0], "NDX");
  check("④ NDX 不重复", list.filter(c=>c==="NDX").length, 1);
  const ndx = vm.runInContext("state.list1.find(x=>x.code==='NDX')", sandbox);
  check("⑤ 补回的行带 jc20 公式", ndx.formula, "jc20");
  check("⑥ 补回的行带韭圈儿映射", ndx.jc, "NDX.GI");

  const order = vm.runInContext("state.order.slice()", sandbox);
  check("⑦ 自定义顺序也补回 NDX", order.includes("NDX"), true);
  check("⑧ 自定义顺序首位 NDX", order[0], "NDX");

  // 再跑一次不能重复添加（幂等）
  vm.runInContext("state.jcRestoreVer=0; restoreJcRows();", sandbox);
  const again = vm.runInContext("state.list1.map(x=>x.code)", sandbox);
  check("⑨ 重复执行不会加出第二行", again.filter(c=>c==="NDX").length, 1);
  check("⑩ 重复执行总数不变", again.length, 32);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
