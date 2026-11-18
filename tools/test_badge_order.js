// 验证三件事：① NDX 排最前 ② state.last 兜底显示 ✓ ③ 待填口径一致
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

// 模拟老用户：list1 里有 164906/HS2083/KWEB/980017/886042（无蛋卷覆盖），
// state.last 里记住过分位；NDX 在末尾
const oldList1 = [
  { id: "a1", code: "399997", name: "中证白酒", min: "", unit: 10, pe: "", pb: "", mpct: "" },
  { id: "a2", code: "164906", name: "中概互联网LOF", min: "", unit: 10, pe: "", pb: "", mpct: "" },
  { id: "a3", code: "HS2083", name: "恒生科技指数", min: "", unit: 10, pe: "", pb: "", mpct: "" },
  { id: "a4", code: "KWEB", name: "中证海外中国互联网", min: "", unit: 10, pe: "", pb: "", mpct: "" },
  { id: "a5", code: "980017", name: "国证芯片", min: "", unit: 10, pe: "", pb: "", mpct: "" },
  { id: "a6", code: "886042", name: "存储芯片", min: "", unit: 10, pe: "", pb: "", mpct: "" },
  { id: "jc1", code: "NDX", name: "纳斯达克100", min: "", unit: 10, pe: "", pb: "", mpct: "",
    jc: "NDX.GI", formula: "jc20" },
];
store.set("dca-web-v4", JSON.stringify({
  seedVer: 9,
  list1: oldList1, list2: [], list3: [],
  order: oldList1.map(x => x.code),
  last: {
    "164906": { pe: 12.3, pb: 2.1 },
    "HS2083": { pe: 8.8, pb: 1.5 },
    "KWEB":   { pe: 15.0, pb: 2.4 },
    "980017": { pe: 30.1, pb: 4.0 },
  },
  src: {},
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
  console.log("清单顺序:", list.join(", "));

  check("① NDX 被移到最前面", list[0], "NDX");
  check("① 其余保持原顺序", list.slice(1), ["399997","164906","HS2083","KWEB","980017","886042"]);

  const order = vm.runInContext("state.order.join(',')", sandbox);
  check("① 自定义顺序也把 NDX 提前", order.split(",")[0], "NDX");

  // ② state.last 兜底 → 显示 ✓ 而不是 ?
  for (const c of ["164906","HS2083","KWEB","980017"]) {
    const b = vm.runInContext(`pctBadge(state.list1.find(x=>x.code==='${c}'))`, sandbox);
    check(`② ${c} 显示 ✓`, b.includes("fb-ok") && b.includes("✓"), true);
  }
  // 真正没数据的（886042 无 last）→ ?
  const b886 = vm.runInContext("pctBadge(state.list1.find(x=>x.code==='886042'))", sandbox);
  check("② 886042（无 last）显示 ?", b886.includes("fb-none"), true);

  // ③ 待填口径一致：有 last 的不算待填
  for (const c of ["164906","HS2083","KWEB","980017"]) {
    const t = vm.runInContext(`isTodo(state.list1.find(x=>x.code==='${c}'))`, sandbox);
    check(`③ ${c} 不算待填`, t, false);
  }
  const t886 = vm.runInContext("isTodo(state.list1.find(x=>x.code==='886042'))", sandbox);
  check("③ 886042 算待填", t886, true);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
