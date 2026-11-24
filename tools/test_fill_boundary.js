// 验证 fillBoundaryMs 新逻辑
// 2026-11-20 周五 / 11-21 周六 / 11-22 周日 / 11-23 周一 / 11-24 周二
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
  const MS = (y, m, d, h) => new Date(y, m - 1, d, h || 15, 0, 0).getTime();

  check("① 2026-11-24 是周二", new Date(2026, 10, 24).getDay(), 2);

  // 周二 13:22（15:00 前）→ 边界 = 上一工作日（周一 11-23）15:00
  const b1 = vm.runInContext(`fillBoundaryMs(new Date(2026,10,24,13,22))`, sandbox);
  console.log(`   周二13:22 → 边界 ${new Date(b1).toLocaleString("zh-CN")}`);
  check("② 周二 15:00 前 → 边界是周一 11-23 15:00", b1, MS(2026, 11, 23));

  // 用户在 11-21（周六）00:13 填的 → 早于边界 → 不新鲜
  const userMinAt = new Date(2026, 10, 21, 0, 13, 33).getTime();
  console.log(`   11-21(周六)00:13 填的 vs 边界 11-23 15:00 → 新鲜=${userMinAt >= b1}`);
  check("③ ★ 周六凌晨填的 → 不新鲜（显示 !）", userMinAt >= b1, false);

  // 若在 11-23（周一）收盘后填的 → 新鲜
  const ok1 = new Date(2026, 10, 23, 16, 0, 0).getTime();
  check("④ 周一收盘后填的 → 新鲜", ok1 >= b1, true);

  // 周二 15:30（15:00 后）→ 边界 = 今天 11-24 15:00
  const b2 = vm.runInContext(`fillBoundaryMs(new Date(2026,10,24,15,30))`, sandbox);
  console.log(`   周二15:30 → 边界 ${new Date(b2).toLocaleString("zh-CN")}`);
  check("⑤ 周二 15:00 后 → 边界是今天", b2, MS(2026, 11, 24));

  // 周六 12:00 → 边界 = 周五 11-27 15:00
  const b3 = vm.runInContext(`fillBoundaryMs(new Date(2026,10,28,12,0))`, sandbox);
  console.log(`   周六12:00 → 边界 ${new Date(b3).toLocaleString("zh-CN")}`);
  check("⑥ 周六 → 边界是周五 11-27 15:00", b3, MS(2026, 11, 27));

  // 周日 12:00 → 边界 = 周五 11-27 15:00
  const b4 = vm.runInContext(`fillBoundaryMs(new Date(2026,10,29,12,0))`, sandbox);
  check("⑦ 周日 → 边界是周五 11-27 15:00", b4, MS(2026, 11, 27));

  // 周一 09:00 → 边界 = 上周五 11-20 15:00
  const b5 = vm.runInContext(`fillBoundaryMs(new Date(2026,10,23,9,0))`, sandbox);
  console.log(`   周一09:00 → 边界 ${new Date(b5).toLocaleString("zh-CN")}`);
  check("⑧ 周一 09:00 → 边界是上周五 11-20 15:00", b5, MS(2026, 11, 20));

  // 周二 09:00（开盘前）→ 边界 = 周一 11-23 15:00
  const b6 = vm.runInContext(`fillBoundaryMs(new Date(2026,10,24,9,0))`, sandbox);
  check("⑨ 周二 09:00 → 边界是周一 11-23 15:00", b6, MS(2026, 11, 23));

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
