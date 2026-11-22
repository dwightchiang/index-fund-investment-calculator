// 「年数加权」公式验证：[(5 − 最低分位) × 系数 + 当日跌幅] × 单位
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

// 用户例子：2026-11-23 时，起点 2024-12-11
const NOW = new Date(2026, 10, 23).getTime();

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "inline" });

setTimeout(() => {
  // ---- 年数 / 系数 ----
  const y1 = vm.runInContext(`yearsOf({code:"932365"}, ${NOW})`, sandbox);
  check("① 中证现金流起点2024-12-11 → 满 2 年", y1, 2);

  const c1 = vm.runInContext(`yearCoefOf({code:"932365"}, ${NOW})`, sandbox);
  check("② 系数 = 2/10 = 0.2", c1, 0.2);

  // ---- 用户例子：最低分位 0，跌幅 1.16，单位 10 ----
  // [(5-0)×0.2 + 1.16] × 10 = (1 + 1.16) × 10 = 21.6 → 四舍五入 22
  const r = vm.runInContext(`
    (function(){
      state.yw = true;
      const it = { id:"t1", name:"中证现金流", code:"932365", min:"0", unit:10, mpct:"-1.16" };
      // 让 chgOf 返回 -1.16（跌 1.16%）
      quotes["932365"] = { price:100, prev:101.176, pct:-1.16, date:"20261123" };
      return calc1(it);
    })()
  `, sandbox);
  console.log(`   分位=${r.min} 系数=${r.coef} 分数=${r.score.toFixed(4)} 金额=${r.amount}`);
  check("③ 系数 0.2", r.coef, 0.2);
  check("④ 分数 = (5-0)×0.2 + 1.16 = 2.16", Math.round(r.score*100)/100, 2.16);
  check("⑤ 金额 = 2.16×10 = 21.6 → 22", r.amount, 22);

  // ---- 关掉开关 → 回到原公式 ----
  const r2 = vm.runInContext(`
    (function(){
      state.yw = false;
      const it = { id:"t2", name:"中证现金流", code:"932365", min:"0", unit:10, mpct:"-1.16" };
      quotes["932365"] = { price:100, prev:101.176, pct:-1.16, date:"20261123" };
      return calc1(it);
    })()
  `, sandbox);
  console.log(`   关闭后：系数=${r2.coef} 分数=${r2.score.toFixed(4)} 金额=${r2.amount}`);
  check("⑥ 关闭开关 → 系数 null（不加权）", r2.coef, null);
  check("⑦ 原公式 (5-0)+1.16 = 6.16 → 62", r2.amount, 62);

  // ---- 封顶 10 年（系数最大 1.0）----
  const y10 = vm.runInContext(`yearsOf({code:"000922"}, ${NOW})`, sandbox);   // 2016-11-21
  check("⑧ 中证红利 2016-11-21 → 满 10 年（封顶）", y10, 10);
  const c10 = vm.runInContext(`yearCoefOf({code:"000922"}, ${NOW})`, sandbox);
  check("⑨ 系数封顶 1.0", c10, 1);

  // 未来起点（异常）→ 最小 1 年
  const ymin = vm.runInContext(`yearsOf({startDate:"2030-01-01", code:"X"}, ${NOW})`, sandbox);
  check("⑩ 起点在未来 → 最小 1 年", ymin, 1);

  // 没有起点 → null（该行按原公式）
  const cnull = vm.runInContext(`yearCoefOf({code:"NDX"}, ${NOW})`, sandbox);
  check("⑪ 没有起点 → null", cnull, null);

  // 手填起点优先于内置
  const ymanual = vm.runInContext(`yearsOf({code:"932365", startDate:"2016-11-21"}, ${NOW})`, sandbox);
  check("⑫ 手填起点优先（2016-11-21 → 10 年）", ymanual, 10);

  // ---- 涨的方向：涨 1.16% 应该减 ----
  const r3 = vm.runInContext(`
    (function(){
      state.yw = true;
      const it = { id:"t3", name:"x", code:"932365", min:"0", unit:10 };
      quotes["932365"] = { price:100, prev:98.85, pct:1.16, date:"20261123" };
      return calc1(it);
    })()
  `, sandbox);
  // (5-0)×0.2 + (-1.16) = 1 - 1.16 = -0.16 → ×10 = -1.6 → -2
  console.log(`   涨1.16%：分数=${r3.score.toFixed(4)} 金额=${r3.amount}`);
  check("⑬ 涨 1.16% → 分数 -0.16（负号）", Math.round(r3.score*100)/100, -0.16);
  check("⑭ 金额为负也如实显示", r3.amount, -2);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
