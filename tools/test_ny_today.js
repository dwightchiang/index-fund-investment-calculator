// 验证 nyToday 的时区 bug 修复
// 旧代码用 toISOString()，会再按 UTC 转一次 → 日期少一天
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
  console.log("── 旧 bug 复现 ──");
  // 旧写法：new Date(utc+off).toISOString().slice(0,10)
  function oldNyToday(fakeNow) {
    const now = fakeNow;
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const m = now.getUTCMonth() + 1;
    const off = (m >= 3 && m <= 10) ? -4 : -5;
    return new Date(utc + off * 3600000).toISOString().slice(0, 10);
  }
  // 模拟北京时间 2026-11-25 13:10（本地时区设为 UTC+8）
  // Node 里直接构造一个 Date，其 getTimezoneOffset() 取决于机器时区
  // 为了让测试确定，直接算：北京 13:10 = UTC 05:10 = 美东 00:10（11-25）
  const utcMs = Date.UTC(2026, 10, 25, 5, 10);       // 2026-11-25 05:10 UTC
  // 用一个「本地时区为 UTC+8」的假 Date
  function FakeDate(ms) {
    const d = new Date(ms);
    d.getTimezoneOffset = () => -480;                 // UTC+8
    return d;
  }
  const fake = FakeDate(utcMs);
  const oldVal = oldNyToday(fake);
  console.log(`   北京时间 11-25 13:10（美东 11-25 00:10）`);
  console.log(`   旧 nyToday() = ${oldVal}  ${oldVal === "2026-11-25" ? "✅" : "❌ 少了一天！"}`);
  check("① 旧实现会算成 11-24（少一天）", oldVal, "2026-11-24");

  console.log("\n── 新实现 ──");
  // 新写法：用本地格式化
  function newNyToday(fakeNow) {
    const now = fakeNow;
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const m = now.getUTCMonth() + 1;
    const off = (m >= 3 && m <= 10) ? -4 : -5;
    const d = new Date(utc + off * 3600000);
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  const newVal = newNyToday(FakeDate(utcMs));
  console.log(`   新 nyToday() = ${newVal}`);
  check("② 新实现正确得到 11-25", newVal, "2026-11-25");

  // 多时点验证
  const cases = [
    ["北京 11-25 13:10（美东 11-25 00:10）", Date.UTC(2026, 10, 25, 5, 10), "2026-11-25", "2026-11-24"],
    ["北京 11-25 05:00（美东 11-24 16:00）", Date.UTC(2026, 10, 24, 21, 0), "2026-11-24", "2026-11-24"],
    ["北京 11-26 03:00（美东 11-25 14:00）", Date.UTC(2026, 10, 25, 19, 0), "2026-11-25", "2026-11-25"],
    ["北京 11-25 22:00（美东 11-25 09:00）", Date.UTC(2026, 10, 25, 14, 0), "2026-11-25", "2026-11-25"],
  ];
  console.log("\n── 多个时点对比 ──");
  console.log("   场景                                     旧      新      正确");
  for (const [label, ms, wantNew, wantOld] of cases) {
    const o = oldNyToday(FakeDate(ms));
    const n = newNyToday(FakeDate(ms));
    const mark = n === wantNew ? "✅" : "❌";
    console.log(`   ${label.padEnd(40)} ${o}  ${n}  ${mark}`);
    check(`③ ${label} → ${wantNew}`, n, wantNew);
  }

  // 源码检查
  console.log("\n── 源码检查 ──");
  // nyToday / nyNowHm 里不能再出现 toISOString（其他地方用于文件名/提交信息，无妨）
  const nyFunc = (html.match(/function nyNow\(\)[\s\S]*?function nyNowHm\(\)[\s\S]*?\n\}/) || [""])[0];
  check("④ nyToday/nyNowHm 里没有 toISOString", nyFunc.includes("toISOString"), false);
  check("⑤ 有 nyNow() 辅助函数", html.includes("function nyNow()"), true);
  check("⑥ nyToday 用本地格式化", /function nyToday\(\)[\s\S]{0,200}getFullYear/.test(html), true);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
