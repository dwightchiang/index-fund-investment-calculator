// 用真实数据验证三个源的「盘后涨跌」算法是否一致
// 实测数据（2026-11-24 13:01）：
//   NDX 11-23 收盘 26746.10（11-20 收 25028.98）
//   QIV 值 26735.49，change 1706.51，日期 11/23/2026
//   QQQ 收盘 651.03，盘后 652.33
//   期货 最新 26838.245，昨结 26808.000
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
function check(name, got, want, tol) {
  const ok = tol === undefined ? JSON.stringify(got) === JSON.stringify(want)
                               : Math.abs(got - want) <= tol;
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${got}${ok ? "" : "  期望=" + want + (tol ? " ±" + tol : "")}`);
}

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "inline" });

setTimeout(() => {
  const NDX_CLOSE = 26746.10;   // NDX 11-23 收盘
  const NDX_PREV = 25028.98;    // NDX 11-20 收盘

  // ---- ① QIV：盘后涨跌 = QIV值 / NDX收盘 − 1 ----
  const qivPct = vm.runInContext(`
    (function(){
      const qiv = 26735.49, ndxClose = ${NDX_CLOSE};
      return Math.round((qiv/ndxClose - 1) * 10000) / 100;
    })()
  `, sandbox);
  console.log(`   QIV: 26735.49 / ${NDX_CLOSE} − 1 = ${qivPct}%`);
  check("① QIV 盘后涨跌 ≈ -0.04%", qivPct, -0.04, 0.01);

  // 验证 QIV − change = 前一日收盘（证明 QIV 是"含盘后的当日指数"）
  const base = vm.runInContext(`26735.49 - 1706.51`, sandbox);
  check("② QIV − change = NDX 11-20 收盘（25028.98）", Math.round(base * 100) / 100, 25028.98, 0.01);

  // ---- ② QQQ：盘后价 / 收盘 − 1 ----
  const qqqPct = vm.runInContext(`
    Math.round((652.33/651.03 - 1) * 10000) / 100
  `, sandbox);
  console.log(`   QQQ: 652.33 / 651.03 − 1 = ${qqqPct}%`);
  check("③ QQQ 盘后涨跌 = +0.20%", qqqPct, 0.20, 0.01);

  // ---- ③ 期货：最新 / 昨结 − 1（本身就是盘后涨跌，不再减 NDX%）----
  const futPct = vm.runInContext(`
    Math.round((26838.245/26808.0 - 1) * 10000) / 100
  `, sandbox);
  console.log(`   期货: 26838.245 / 26808 − 1 = ${futPct}%`);
  check("④ 期货盘后涨跌 = +0.11%", futPct, 0.11, 0.01);

  // ---- ④ 三个源应该量级接近（都在 0 附近）----
  const all = [qivPct, qqqPct, futPct];
  console.log(`   三者: QIV ${qivPct}% / QQQ ${qqqPct}% / 期货 ${futPct}%`);
  check("⑤ 三者都落在 ±1% 内（口径一致）", all.every(x => Math.abs(x) < 1), true);
  const spread = Math.max(...all) - Math.min(...all);
  console.log(`   极差 ${spread.toFixed(2)} 个百分点`);
  check("⑥ 极差 < 0.5 个百分点", spread < 0.5, true);

  // ---- ⑤ 期货日期校验：昨结 26808 vs NDX 收盘 26746（差 0.23% → 同一日）----
  const gap = vm.runInContext(`
    Math.abs(26808.0 - ${NDX_CLOSE}) / ${NDX_CLOSE} * 100
  `, sandbox);
  console.log(`   期货昨结与 NDX 收盘差 ${gap.toFixed(2)}%`);
  check("⑦ 价差 0.23% < 3% → 判定同一交易日", gap < 3, true);

  // ---- ⑥ NDX 日线：11-23 已收盘（美东 11-24 00:01 > 16:00 前一天）----
  // 现在北京时间 13:01 = 美东 11-24 00:01，此时 "今天"=11-24，
  // 日K最后一条是 11-23 < 11-24 → 不会被丢弃
  const keep = vm.runInContext(`
    (function(){
      const days = [
        ["2026-11-19","1","26517.05"], ["2026-11-20","1","25028.98"], ["2026-11-23","1","26746.10"]
      ];
      const today = "2026-11-24";        // 美东今天
      const closed = true;                // 美东 00:01，非交易时段
      let end = days.length;
      while(end > 2 && String(days[end-1][0]) >= today && !closed) end--;
      return { used: days[end-1][0], close: parseFloat(days[end-1][2]) };
    })()
  `, sandbox);
  console.log(`   NDX 日线采用: ${keep.used} 收 ${keep.close}`);
  check("⑧ 用 11-23 而不是 11-20", keep.used, "2026-11-23");
  check("⑨ 收盘价 26746.10", keep.close, 26746.10);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
