// 锁定：没填分位的行不能显示 ✓（之前 state.last 自我强化导致误标）
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
  // 场景：一行从没填过分位、蛋卷不覆盖、韭圈儿不覆盖
  // 但 state.last 里有历史污染值
  const badge = vm.runInContext(`
    (function(){
      // 造一个干净环境
      AUTO = { items: {} };
      JIUCAI = { items: {} };
      state.last = { "886042": { pe: 55.38, pb: 56.26 } };   // 被污染的旧值

      const it = { id:"t1", code:"886042", name:"存储芯片", min:"", unit:10, pe:"", pb:"", mpct:"" };
      return pctBadge(it);
    })()
  `, sandbox);
  console.log("   没填分位的行 →", badge.replace(/<[^>]+>/g, "|").slice(0, 40));
  check("① 没填分位 → 显示 ?", badge.includes("fb-none"), true);
  check("② 不再显示 ✓", badge.includes("✓"), false);

  // 有手填值的 → ✓
  const b2 = vm.runInContext(`
    pctBadge({ id:"t2", code:"399997", name:"中证白酒", min:"3.2", minAt:Date.now(), unit:10, pe:"", pb:"" })
  `, sandbox);
  check("③ 手填且新鲜 → ✓", b2.includes("✓"), true);

  // 蛋卷覆盖的 → ✓
  const b3 = vm.runInContext(`
    (function(){
      AUTO = { items: { "399997": { pe_pct: 3.2, date: "2026-11-24" } } };
      return pctBadge({ id:"t3", code:"399997", min:"", unit:10, pe:"", pb:"" });
    })()
  `, sandbox);
  check("④ 蛋卷有数据 → ✓", b3.includes("✓"), true);

  // 韭圈儿覆盖的 → ✓
  const b4 = vm.runInContext(`
    (function(){
      AUTO = { items: {} };
      JIUCAI = { items: { "NDX.GI": { pe_pct: 5.15, date: "2026-11-23" } } };
      return pctBadge({ id:"t4", code:"NDX", formula:"jc20", jc:"NDX.GI", min:"", unit:10, pe:"", pb:"" });
    })()
  `, sandbox);
  check("⑤ 韭圈儿有数据 → ✓", b4.includes("✓"), true);

  // ---- remember 不能再自我强化 ----
  const r = vm.runInContext(`
    (function(){
      AUTO = { items: {} };
      JIUCAI = { items: {} };
      state.last = {};
      const it = { id:"t5", code:"999999", name:"无源指数", min:"", unit:10, pe:"", pb:"" };
      // 连续 remember 三次（模拟多次 render）
      remember(it); remember(it); remember(it);
      return { last: JSON.parse(JSON.stringify(state.last)) };
    })()
  `, sandbox);
  console.log("   三次 remember 后 state.last =", JSON.stringify(r.last));
  check("⑥ 无来源的行不会被写入 state.last", r.last["999999"], undefined);

  // ---- isTodo 不再被 last 影响 ----
  const todo = vm.runInContext(`
    (function(){
      AUTO = { items: {} };
      JIUCAI = { items: {} };
      state.last = { "886042": { pe: 55, pb: 56 } };
      return isTodo({ id:"t6", code:"886042", min:"", unit:10, pe:"", pb:"" });
    })()
  `, sandbox);
  check("⑦ 没填分位 → 算待填（不受 last 影响）", todo, true);

  // ---- cleanupPollutedLast 清掉污染 ----
  const clean = vm.runInContext(`
    (function(){
      AUTO = { items: {} };
      JIUCAI = { items: {} };
      state.last = { "886042": { pe:55, pb:56 }, "399997": { pe:3.2, pb:1.1 } };
      state.lastCleanVer = 0;
      state.list1 = [
        { id:"a", code:"886042", min:"", pe:"", pb:"" },          // 无来源 → 清
        { id:"b", code:"399997", min:"3.2", pe:"", pb:"" },       // 手填 → 保留
      ];
      state.list3 = [];
      cleanupPollutedLast();
      return { last: JSON.parse(JSON.stringify(state.last)) };
    })()
  `, sandbox);
  console.log("   清理后 state.last =", JSON.stringify(clean.last));
  check("⑧ 无来源的被清掉", clean.last["886042"], undefined);
  check("⑨ 有手填的保留", clean.last["399997"] !== undefined, true);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
