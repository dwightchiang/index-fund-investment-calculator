// 韭圈儿数据「是否已更新到该有的那份」—— 覆盖 10 点界线和周末
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
  // 2026-11-19 是周四，11-18 周三
  const at = (y,m,d,h,mi) => new Date(y, m-1, d, h, mi||0);

  // 场景1：11-19 周四 10:30 → 期望 11-18 的数据
  let e = vm.runInContext(`jcExpectedDate(new Date(2026,10,19,10,30))`, sandbox);
  check("周四 10:30 → 期望 11-18", e, "20261118");

  // 场景2：11-19 周四 09:30（10 点前）→ 期望 11-17（昨天那份就是最新）
  e = vm.runInContext(`jcExpectedDate(new Date(2026,10,19,9,30))`, sandbox);
  check("周四 09:30（10点前）→ 期望 11-17", e, "20261117");

  // 场景3：11-19 周四 23:00 → 还是期望 11-18
  e = vm.runInContext(`jcExpectedDate(new Date(2026,10,19,23,0))`, sandbox);
  check("周四 23:00 → 期望 11-18", e, "20261118");

  // 场景4：11-21 周六 12:00 → 期望 11-20（周五）
  e = vm.runInContext(`jcExpectedDate(new Date(2026,10,21,12,0))`, sandbox);
  check("周六 12:00 → 期望 11-20（周五）", e, "20261120");

  // 场景5：11-22 周日 12:00 → 期望 11-20（周五）
  e = vm.runInContext(`jcExpectedDate(new Date(2026,10,22,12,0))`, sandbox);
  check("周日 12:00 → 期望 11-20（周五）", e, "20261120");

  // 场景6：11-23 周一 10:30 → 期望 11-20（周五）
  e = vm.runInContext(`jcExpectedDate(new Date(2026,10,23,10,30))`, sandbox);
  check("周一 10:30 → 期望 11-20（周五）", e, "20261120");

  // ---- isJcFresh ----
  const mk = (d) => ({ code:"NDX", formula:"jc20", jc:"NDX.GI" });
  vm.runInContext(`JIUCAI = { items: { "NDX.GI": { pe_pct: 18.86, date: "2026-11-18" } } }`, sandbox);
  let f = vm.runInContext(`isJcFresh({code:"NDX",jc:"NDX.GI"}, new Date(2026,10,19,10,30))`, sandbox);
  check("① 11-19 10:30，数据 11-18 → 新鲜（显示纯文字）", f, true);

  vm.runInContext(`JIUCAI = { items: { "NDX.GI": { pe_pct: 18.86, date: "2026-11-17" } } }`, sandbox);
  f = vm.runInContext(`isJcFresh({code:"NDX",jc:"NDX.GI"}, new Date(2026,10,19,10,30))`, sandbox);
  check("② 11-19 10:30，数据仍是 11-17 → 不新鲜（退回输入框）", f, false);

  f = vm.runInContext(`isJcFresh({code:"NDX",jc:"NDX.GI"}, new Date(2026,10,19,9,30))`, sandbox);
  check("③ 11-19 09:30，数据 11-17 → 新鲜（10点前就这份）", f, true);

  vm.runInContext(`JIUCAI = { items: {} }`, sandbox);
  f = vm.runInContext(`isJcFresh({code:"NDX",jc:"NDX.GI"}, new Date(2026,10,19,10,30))`, sandbox);
  check("④ 没数据 → 不新鲜（输入框）", f, false);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
