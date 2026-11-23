// 锁定 bug：8 位日期被当成秒 → 算出 "-498735时前"
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
  // ---- qTs 各种输入 ----
  const cases = [
    ["8位日期串 20261123", `qTs("20261123")`, new Date(2026, 10, 23).getTime()],
    ["8位日期数字 20261123", `qTs(20261123)`, new Date(2026, 10, 23).getTime()],
    ["秒级 1795208400", `qTs(1795208400)`, 1795208400000],
    ["毫秒级 1795208400000", `qTs(1795208400000)`, 1795208400000],
    ["空值", `qTs(null)`, 0],
  ];
  for (const [name, expr, want] of cases) {
    check(`qTs ${name}`, vm.runInContext(expr, sandbox), want);
  }

  // ---- 关键：8位日期不能算出天文数字的"小时前" ----
  const age = vm.runInContext(`
    (function(){
      quotes["932365"] = { price:1, prev:1, pct:-0.64, date:"20261123", ts:0, at:Date.now(), src:"t" };
      return quoteAgeSec("932365");
    })()
  `, sandbox);
  check("① 只有日期(ts=0) → 不返回滞后秒数", age, null);

  const age2 = vm.runInContext(`
    (function(){
      // 3 分钟前的精确时间戳
      quotes["X1"] = { price:1, prev:1, pct:0, date:"20261123", ts:Date.now()-180000, at:Date.now(), src:"t" };
      return quoteAgeSec("X1");
    })()
  `, sandbox);
  console.log(`   3分钟前的 ts → age=${age2}s`);
  check("② 精确时间戳 3 分钟 → 约 180 秒", Math.abs(age2 - 180) <= 3, true);

  const age3 = vm.runInContext(`
    (function(){
      quotes["X2"] = { price:1, prev:1, pct:0, date:"20261123", ts:Date.now()+9999999, at:Date.now(), src:"t" };
      return quoteAgeSec("X2");
    })()
  `, sandbox);
  check("③ 未来时间戳 → null（不显示负数）", age3, null);

  // ---- 模拟截图场景：正常当日行情，不该出现「N时前」标记 ----
  const lag = vm.runInContext(`
    (function(){
      const out=[];
      ["932365","930851","1B0852","1B0680","931152","930901","000813"].forEach((c,i)=>{
        putQuote(c, { price:100+i, prev:99+i, pct:1+i*0.3, date:"20261123", ts:null, src:"腾讯" });
        const a=quoteAgeSec(c);
        out.push({ code:c, age:a, showLag: (a!==null && a>120) });
      });
      return out;
    })()
  `, sandbox);
  console.log("   截图里那 7 行：");
  lag.forEach(x=>console.log(`     ${x.code}: age=${x.age} 显示滞后=${x.showLag}`));
  check("④ 这些行都不显示「N时前」", lag.every(x=>!x.showLag), true);

  // ---- 真正滞后的要能显示 ----
  const real = vm.runInContext(`
    (function(){
      quotes["LAG"] = { price:1, prev:1, pct:0, date:"20261123", ts:Date.now()-600000, at:Date.now(), src:"t" };
      const a=quoteAgeSec("LAG");
      return { age:a, showLag:(a!==null && a>120) };
    })()
  `, sandbox);
  check("⑤ 真正滞后 10 分钟 → 会显示", real.showLag, true);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
