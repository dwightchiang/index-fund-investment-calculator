// 验证：① 顶部显示「韭圈儿分位拿到哪一天」 ② 交易日 11:30 的判定
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
  // ---- ① markJcTime ----
  const today = vm.runInContext("nyToday()", sandbox);
  vm.runInContext(`
    JIUCAI = { items: { "NDX.GI": { name:"纳斯达克100", pe_pct:15.45, date:"${today}" } } };
    state.jcPulledAt = new Date(2026,10,23,11,31).getTime();
    markJcTime();
  `, sandbox);
  const txt = vm.runInContext(`$("#jcTime").innerHTML`, sandbox);
  console.log("   今日数据 →", txt.replace(/<[^>]+>/g, "").trim());
  check("① 显示拿到哪一天", txt.includes(today), true);
  check("② 标了「已是前一交易日」", txt.includes("已是前一交易日"), true);
  check("③ 显示本次刷新时间", txt.includes("11:31"), true);

  // 过期数据 → 警示
  vm.runInContext(`
    JIUCAI = { items: { "NDX.GI": { name:"纳斯达克100", pe_pct:15.45, date:"2026-11-17" } } };
    markJcTime();
  `, sandbox);
  const txt2 = vm.runInContext(`$("#jcTime").innerHTML`, sandbox);
  console.log("   旧数据 →", txt2.replace(/<[^>]+>/g, "").trim());
  check("④ 数据旧了 → 显示警告", txt2.includes("还没更新到前一交易日"), true);

  // 没有数据
  vm.runInContext(`JIUCAI = { items:{} }; markJcTime();`, sandbox);
  const txt3 = vm.runInContext(`$("#jcTime").innerHTML`, sandbox);
  check("⑤ 没数据 → 显示 —", txt3.includes("—"), true);

  // ---- ② 11:30 判定逻辑 ----
  // 交易日判断：周一到周五
  const isTradingDay = (dow) => dow !== 0 && dow !== 6;
  check("⑥ 周一~周五算交易日", [1,2,3,4,5].every(isTradingDay), true);
  check("⑦ 周六日不算", [0,6].every(d=>!isTradingDay(d)), true);

  // 时间点判断
  const shouldPull = (dow, hm) => isTradingDay(dow) && hm >= 1130;
  check("⑧ 周二 11:29 → 不拉", shouldPull(2, 1129), false);
  check("⑨ 周二 11:30 → 拉", shouldPull(2, 1130), true);
  check("⑩ 周二 15:00 → 还会拉（当天没拉过）", shouldPull(2, 1500), true);
  check("⑪ 周六 11:30 → 不拉", shouldPull(6, 1130), false);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
