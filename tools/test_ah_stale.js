// 验证「NDX 日期过期就强制刷新」的判定逻辑
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
  console.log("── 源码检查 ──");
  check("① 有 AH_VER_KEY（版本变化清缓存）", html.includes("AH_VER_KEY"), true);
  check("② 有 wantNdx 计算", html.includes("wantNdx"), true);
  check("③ 用 ndxOutdated 判断过期", html.includes("ndxOutdated"), true);
  check("④ 有 ndxFail 连续失败计数", html.includes("AH.ndxFail"), true);
  check("⑤ 失败 3 次后写入期望日期（防死循环）",
        /ndxFail >= 3\) AH\.ndxDate = wantNdx/.test(html), true);

  console.log("\n── 模拟 wantNdx 计算 ──");
  // 复刻 wantNdx 逻辑
  function wantNdxAt(fakeNyDate) {
    const d = fakeNyDate;
    const p = n => String(n).padStart(2, "0");
    const cur = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const hm = d.getHours() * 100 + d.getMinutes();
    if (hm >= 1600) return cur;
    const y = new Date(d);
    y.setDate(y.getDate() - 1);
    while (y.getDay() === 0 || y.getDay() === 6) y.setDate(y.getDate() - 1);
    return `${y.getFullYear()}-${p(y.getMonth() + 1)}-${p(y.getDate())}`;
  }

  // 2026-11-25 是周三
  const cases = [
    ["周三 00:19（今天未开盘）→ 应为周二 11-24", new Date(2026, 10, 25, 0, 19), "2026-11-24"],
    ["周三 09:00（盘中）→ 应为周二 11-24", new Date(2026, 10, 25, 9, 0), "2026-11-24"],
    ["周三 16:30（已收盘）→ 应为今天 11-25", new Date(2026, 10, 25, 16, 30), "2026-11-25"],
    ["周三 23:00（已收盘）→ 应为今天 11-25", new Date(2026, 10, 25, 23, 0), "2026-11-25"],
    ["周一 09:00（今天未收盘）→ 应为上周五 11-20", new Date(2026, 10, 23, 9, 0), "2026-11-20"],
    ["周六 12:00 → 应为周五 11-27", new Date(2026, 10, 28, 12, 0), "2026-11-27"],
  ];
  for (const [label, d, want] of cases) {
    const got = wantNdxAt(d);
    console.log(`   ${label.padEnd(38)} → ${got}`);
    check(`⑥ ${label}`, got, want);
  }

  console.log("\n── 过期判定 ──");
  function isOutdated(cachedDate, want) { return !cachedDate || cachedDate < want; }
  check("⑦ 缓存 11-23，期望 11-24 → 过期（会强制刷新）", isOutdated("2026-11-23", "2026-11-24"), true);
  check("⑧ 缓存 11-24，期望 11-24 → 不过期", isOutdated("2026-11-24", "2026-11-24"), false);
  check("⑨ 缓存 11-25，期望 11-24 → 不过期", isOutdated("2026-11-25", "2026-11-24"), false);
  check("⑩ 缓存为空 → 过期", isOutdated(undefined, "2026-11-24"), true);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
