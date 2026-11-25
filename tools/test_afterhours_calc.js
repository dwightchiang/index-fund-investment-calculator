// 纳指100「盘后加减」公式验证：(20−分位)×系数 − 盘后涨跌%×10
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
    addEventListener() {}, get activeElement() { return null; }, visibilityState: "visible",
    head: { appendChild() {} }, body: new El("BODY"),
  },
  window: { addEventListener() {} },
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
sandbox.window = Object.assign({ addEventListener() {} }, sandbox);
sandbox.globalThis = sandbox;

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "inline" });

setTimeout(() => {
  // 用真实的 current JIUCAI peek 分位（16.16 → 系数 5）
  vm.runInContext(`
    state.ahOn = false;
    JIUCAI = { items: { "NDX.GI": { name:"纳斯达克100", pe_pct:16.16, date:"2026-11-19" } } };
    AH = { qivPost: 1.34, qiv: -4.27, fut: -5.03, at: Date.now(), src:"QIV" };
    const nd = state.list1.find(x=>x.code==="NDX");
    nd.min = "";
  `, sandbox);

  // ---- 关闭（ahPick="off"）：原公式 (20−16.16)×5 = 19.2 ----
  // ★ 语义已改为由每行 ahPick 决定，不再看 state.ahOn
  vm.runInContext(`
    (function(){
      const nd = state.list1.find(x=>x.code==="NDX");
      nd.ahPick = "off";
    })()
  `, sandbox);
  let r = vm.runInContext(`calcRow(state.list1.find(x=>x.code==="NDX"))`, sandbox);
  console.log(`   关闭：分位=${r.pct} 系数=${r.coef} 金额=${r.amount} 盘后=${r.ah}`);
  check("① 关闭 → 系数 5", r.coef, 5);
  check("② 关闭 → 金额 19.2", r.amount, 19.2);
  check("③ 关闭 → 不含盘后项", r.ah, null);

  // ---- 打开（ahPick="auto"）：19.2 − 1.34×10 = 5.8 ----
  r = vm.runInContext(`
    (function(){
      const nd = state.list1.find(x=>x.code==="NDX");
      nd.ahPick = "auto";
      return calcRow(nd);
    })()
  `, sandbox);
  console.log(`   打开：基础=${r.base} 盘后=${r.ah}% 调整=${r.ahAdj} 金额=${r.amount}`);
  check("④ 打开 → 盘后取 QIV 纯盘后 1.34", r.ah, 1.34);
  check("⑤ 盘后调整 = -1.34×10 = -13.4", r.ahAdj, -13.4);
  check("⑥ 金额 = 19.2 - 13.4 = 5.8", r.amount, 5.8);

  // ---- 盘后跌 → 加钱 ----
  r = vm.runInContext(`
    (function(){
      AH.qivPost = -2;
      return calcRow(state.list1.find(x=>x.code==="NDX"));
    })()
  `, sandbox);
  console.log(`   跌2%：调整=${r.ahAdj} 金额=${r.amount}`);
  check("⑦ 盘后跌 2% → 调整 +20", r.ahAdj, 20);
  check("⑧ 金额 = 19.2 + 20 = 39.2", r.amount, 39.2);

  // ---- 涨太多 → 负值如实显示 ----
  r = vm.runInContext(`
    (function(){
      AH.qivPost = 3;
      return calcRow(state.list1.find(x=>x.code==="NDX"));
    })()
  `, sandbox);
  const av = vm.runInContext(`amtView(calcRow(state.list1.find(x=>x.code==="NDX")))`, sandbox);
  console.log(`   涨3%：金额=${r.amount} 显示=${av.txt}`);
  check("⑨ 涨 3% → 19.2-30 = -10.8", r.amount, -10.8);
  check("⑩ 负值显示为 -¥10.8", av.txt, "-¥10.8");

  // ---- 下拉选择：改成 ahPick 后语义变了 ----
  // 选 manual → 用手填值
  r = vm.runInContext(`
    (function(){
      const nd = state.list1.find(x=>x.code==="NDX");
      nd.mpct3 = "0.5"; nd.ahPick = "manual";
      AH.qivPost = 1.34; AH.qqqPost = 1.49; AH.futPost = 0.58;
      return calcRow(nd);
    })()
  `, sandbox);
  check("⑪ 选 manual → 用手填 0.5", r.ah, 0.5);

  // 选 qqq → 用 QQQ 1.49
  r = vm.runInContext(`
    (function(){
      const nd = state.list1.find(x=>x.code==="NDX");
      nd.ahPick = "qqq";
      return calcRow(nd);
    })()
  `, sandbox);
  check("⑫ 选 qqq → 用 QQQ 1.49", r.ah, 1.49);

  // 选 fut → 用期货纯盘后 0.58
  r = vm.runInContext(`
    (function(){
      const nd = state.list1.find(x=>x.code==="NDX");
      nd.ahPick = "fut";
      return calcRow(nd);
    })()
  `, sandbox);
  check("⑬ 选 fut → 用期货 0.58", r.ah, 0.58);

  // auto：QIV 缺失 → 退回 QQQ → 再退回期货
  r = vm.runInContext(`
    (function(){
      const nd = state.list1.find(x=>x.code==="NDX");
      nd.ahPick = "auto";
      AH.qivPost = null;
      return calcRow(nd);
    })()
  `, sandbox);
  check("⑭ auto + QIV缺失 → 用 QQQ 1.49", r.ah, 1.49);

  r = vm.runInContext(`
    (function(){
      AH.qqqPost = null;
      return calcRow(state.list1.find(x=>x.code==="NDX"));
    })()
  `, sandbox);
  check("⑮ auto + QIV/QQQ都缺失 → 用期货 0.58", r.ah, 0.58);

  // ---- 都没有 → 不加不减 ----
  r = vm.runInContext(`
    (function(){
      AH.qivPost = null; AH.qqqPost = null; AH.futPost = null; AH.fut = null;
      return calcRow(state.list1.find(x=>x.code==="NDX"));
    })()
  `, sandbox);
  check("⑯ 都没有 → 盘后 null", r.ah, null);
  check("⑰ 都没有 → 金额回原值 19.2", r.amount, 19.2);

  // ---- 分位≥20 不投（盘后也不能救）----
  r = vm.runInContext(`
    (function(){
      JIUCAI = { items: { "NDX.GI": { pe_pct:25, date:"2026-11-19" } } };
      AH.qivPost = -2;
      const nd = state.list1.find(x=>x.code==="NDX");
      nd.min = "";
      return calcRow(nd);
    })()
  `, sandbox);
  check("⑮ 分位≥20 仍不投（系数 0）", r.coef, 0);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
