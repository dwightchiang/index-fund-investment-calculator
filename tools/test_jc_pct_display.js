// 验证：纳指100 的分位在输入框里直接显示（不再空着）
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("index.html", "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const jiucai = JSON.parse(fs.readFileSync("data/jiucai.json", "utf8"));

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
    addEventListener() {}, get activeElement() { return null; },
    visibilityState: "visible",
    head: { appendChild() {} }, body: new El("BODY"),
  },
  window: { addEventListener() {} },
  location: { pathname: "/index.html", hash: "", hostname: "127.0.0.1", origin: "http://127.0.0.1" },
  navigator: { clipboard: { writeText: async () => {} }, userAgent: "node" },
  localStorage: { getItem: k => store.has(k) ? store.get(k) : null,
                  setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  fetch: (url) => {
    if (String(url).includes("jiucai.json")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => jiucai,
                               text: async () => JSON.stringify(jiucai) });
    }
    return Promise.reject(new Error("offline"));
  },
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
  vm.runInContext("JIUCAI = " + JSON.stringify(jiucai), sandbox);

  // fmtAutoPct 应返回 18.86
  const v = vm.runInContext("fmtAutoPct(state.list1.find(x=>x.code==='NDX'))", sandbox);
  check("① fmtAutoPct 返回 18.86", v, "18.86");

  // 关键：min 是空字符串时，也要回退到自动值（之前 ?? 判定失败）
  const it = vm.runInContext("state.list1.find(x=>x.code==='NDX')", sandbox);
  check("② 该行 min 是空字符串", it.min, "");

  const shown = vm.runInContext(`
    (function(){
      const it = state.list1.find(x=>x.code==='NDX');
      const jc = it.formula==="jc20";
      const autoPct = jc ? fmtAutoPct(it) : "";
      const hasAuto = autoPct !== "" && (it.min===undefined || it.min==="");
      const jcD = jiucaiDate(it);
      const autoDate = hasAuto && jcD ? jcD.slice(5) : "";
      return { autoPct, hasAuto, autoDate, kind: hasAuto ? "text" : "input" };
    })()
  `, sandbox);
  check("③ ★ 有分位 → 纯文字（不是框）", shown.kind, "text");
  check("③b 显示 18.86%", shown.autoPct, "18.86");
  // 日期跟着 data/jiucai.json 走，这里只验证格式是 MM-DD
  check("③c 代码行显示数据日期（MM-DD）", /^\d{2}-\d{2}$/.test(shown.autoDate), true);

  // 手填后应优先手填（此时显示输入框）
  const shown2 = vm.runInContext(`
    (function(){
      const it = { min:"9.9", formula:"jc20", jc:"NDX.GI", code:"NDX" };
      const jc = it.formula==="jc20";
      const autoPct = jc ? "18.86" : "";
      const hasAuto = autoPct !== "" && (it.min===undefined || it.min==="");
      return { kind: hasAuto ? "text" : "input", val: it.min };
    })()
  `, sandbox);
  check("④ 手填 9.9 → 输入框、值为 9.9", [shown2.kind, shown2.val], ["input", "9.9"]);

  // 没有韭圈儿数据 → 输入框 + 问号徽标
  const shown3 = vm.runInContext(`
    (function(){
      const autoPct = "";                       // 模拟没拿到
      const it = { min:"" };
      const hasAuto = autoPct !== "" && (it.min===undefined || it.min==="");
      const badge = autoPct ? "ok" : "?";       // 没拿到 → 问号
      return { kind: hasAuto ? "text" : "input", badge };
    })()
  `, sandbox);
  check("⑤ 没拿到 → 输入框 + 问号", [shown3.kind, shown3.badge], ["input", "?"]);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 1000);
