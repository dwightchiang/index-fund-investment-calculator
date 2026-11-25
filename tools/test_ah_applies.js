// 验证：选了盘后源后，金额立即变化；涨减跌加
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
  select() {} setSelectionRange() {}
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
    documentElement: { style: { setProperty() {} } },
  },
  window: { addEventListener() {} },
  location: { pathname: "/index.html", hash: "", hostname: "127.0.0.1", origin: "http://127.0.0.1" },
  navigator: { clipboard: { writeText: async () => {} }, userAgent: "node" },
  localStorage: { getItem: k => store.has(k) ? store.get(k) : null,
                  setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  fetch: () => Promise.reject(new Error("offline")),
  setTimeout, clearTimeout, setInterval: () => {}, clearInterval,
  alert: () => {}, confirm: () => true, prompt: () => null,
  Request, Response, Headers, URL, TextEncoder, TextDecoder, AbortController,
  btoa: s => Buffer.from(s, "binary").toString("base64"),
  atob: s => Buffer.from(s, "base64").toString("binary"),
  ResizeObserver: class { observe() {} },
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
  // 准备：纳指100 分位 14.54 → 系数 5 → 基础 (20-14.54)*5 = 27.3
  vm.runInContext(`
    AUTO={items:{}};
    JIUCAI={items:{"NDX.GI":{name:"纳斯达克100",pe_pct:14.54,date:"2026-11-24"}}};
    AH={qivPost:1.34, qiv:26209.11, qivSameDay:true, qiq:null,
        qqqPost:0.20, futPost:-1.25, fut:0.5, futRaw:-2.99,
        ndxDate:"2026-11-24", ndxClose:26214.17, ndxPct:-1.99,
        at:Date.now(), src:""};
    state.ahOn=true; state.yw=false;
    const nd=state.list1.find(x=>x.code==="NDX");
    if(nd){ nd.min=""; nd.mpct3=""; nd.ahPick="auto"; }
  `, sandbox);

  const base = 27.3;
  console.log(`基础金额 = (20 − 14.54) × 5 = ${base}\n`);

  // ── 各选项的金额 ──
  const cases = [
    ["off",    null,   base,           "关闭 → 不变"],
    ["qiv",    1.34,   base - 13.4,    "QIV +1.34% → 涨 → 减 13.4"],
    ["qqq",    0.20,   base - 2,       "QQQ +0.20% → 涨 → 减 2"],
    ["fut",    -1.25,  base + 12.5,    "期货 -1.25% → 跌 → 加 12.5"],
    ["fut15",  0.5,    base - 5,       "期货15:00 +0.5% → 涨 → 减 5"],
  ];

  for (const [pick, wantAh, wantAmt, desc] of cases) {
    const r = vm.runInContext(`
      (function(){
        const nd=state.list1.find(x=>x.code==="NDX");
        nd.ahPick=${JSON.stringify(pick)};
        return calcRow(nd);
      })()
    `, sandbox);
    const gotAmt = Math.round(r.amount * 100) / 100;
    console.log(`  ${desc.padEnd(34)} 盘后=${r.ah}  金额=${gotAmt}`);
    check(`① ${pick}.ah`, r.ah, wantAh);
    check(`① ${pick}.amount = ${wantAmt}`, gotAmt, Math.round(wantAmt * 100) / 100);
  }

  // ── 方向验证：涨减跌加 ──
  console.log("\n── 方向验证 ──");
  const up = vm.runInContext(`
    (function(){
      AH.qivPost = 2;
      const nd=state.list1.find(x=>x.code==="NDX");
      nd.ahPick="qiv";
      return calcRow(nd);
    })()
  `, sandbox);
  check("② 盘后涨 2% → 调整 -20（减钱）", up.ahAdj, -20);
  check("② 金额 = 27.3 - 20 = 7.3", Math.round(up.amount*100)/100, 7.3);

  const dn = vm.runInContext(`
    (function(){
      AH.qivPost = -2;
      return calcRow(state.list1.find(x=>x.code==="NDX"));
    })()
  `, sandbox);
  check("③ 盘后跌 2% → 调整 +20（加钱）", dn.ahAdj, 20);
  check("③ 金额 = 27.3 + 20 = 47.3", Math.round(dn.amount*100)/100, 47.3);

  // ── 手填优先 ──
  console.log("\n── 手填 ──");
  const manual = vm.runInContext(`
    (function(){
      AH.qivPost = 1.34;
      const nd=state.list1.find(x=>x.code==="NDX");
      nd.ahPick="manual"; nd.mpct3="3";
      return calcRow(nd);
    })()
  `, sandbox);
  check("④ 选手填 3% → 用 3（不用 QIV 1.34）", manual.ah, 3);
  check("④ 金额 = 27.3 - 30 = -2.7", Math.round(manual.amount*100)/100, -2.7);
  const av = vm.runInContext(`
    (function(){
      const nd=state.list1.find(x=>x.code==="NDX");
      return amtView(calcRow(nd));
    })()
  `, sandbox);
  check("④ 负值显示 -¥2.7", av.txt, "-¥2.7");

  // ── 下拉菜单包含「不参与（关闭）」 ──
  console.log("\n── 菜单选项 ──");
  const opts = vm.runInContext(`
    afterHoursOptions({code:"NDX",formula:"jc20",jc:"NDX.GI"}).map(o=>o.key)
  `, sandbox);
  console.log("   选项:", opts.join(", "));
  check("⑤ 有 off 选项", opts.includes("off"), true);
  check("⑤ 有 auto/qiv/qqq/fut/manual", 
        ["auto","qiv","qqq","fut","manual"].every(k=>opts.includes(k)), true);

  // ── 源码：切下拉后调用了 render + renderTotals ──
  console.log("\n── 源码检查 ──");
  check("⑥ 切换下拉后调 render() 和 renderTotals()",
        /ahPick[\s\S]{0,400}render\(\)[\s\S]{0,100}renderTotals\(\)/.test(html), true);
  check("⑦ calcJC 不再依赖 state.ahOn",
        !/state\.ahOn && ah!==null/.test(html), true);
  check("⑧ 总开关会同步设置各行 ahPick",
        /it\.ahPick = turnOn \? "auto" : "off"/.test(html), true);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
