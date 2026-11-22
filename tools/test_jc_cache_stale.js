// 复现你的场景：localStorage 缓存里是旧的 15.61，线上文件已经是 16.16
// 期望：页面加载后采用 16.16，而不是被缓存挡住
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

// ★ 缓存里是旧值 15.61（11-19），刚写入 1 分钟
const OLD_CACHE = { at: Date.now() - 60000, data: {
  generated_at: "2026-11-20 02:55", source: "文件",
  items: { "NDX.GI": { name:"纳斯达克100", pe:25.55, pe_pct:15.61, pb_pct:97.11, date:"2026-11-19" } } } };
store.set("dca-jiucai-cache", JSON.stringify(OLD_CACHE));

// 线上文件是新值 16.16
const NEW_FILE = { generated_at: "2026-11-20 12:30", source: "文件",
  items: { "NDX.GI": { name:"纳斯达克100", pe:25.68, pe_pct:16.16, pb_pct:94.61, date:"2026-11-19" } } };

const calls = [];
const sandbox = {
  console,
  document: {
    querySelector(s) { if (!cache.has(s)) cache.set(s, new El()); return cache.get(s); },
    querySelectorAll() { return []; }, createElement(t) { return new El(t.toUpperCase()); },
    addEventListener() {}, get activeElement() { return null; }, visibilityState: "visible",
    head: { appendChild() {} }, body: new El("BODY"),
  },
  window: { addEventListener() {} },
  location: { pathname:"/index.html", hash:"", hostname:"dwightchiang.github.io", origin:"https://dwightchiang.github.io" },
  navigator: { clipboard: { writeText: async () => {} }, userAgent: "node" },
  localStorage: { getItem: k => store.has(k) ? store.get(k) : null,
                  setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  fetch: async (url) => {
    calls.push(String(url));
    if(String(url).includes("jiucai.json"))
      return { ok:true, status:200, json: async()=>NEW_FILE };
    return { ok:false, status:404, json: async()=>({}) };
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  alert: () => {}, confirm: () => true, prompt: () => null,
  Request, Response, Headers, URL, TextEncoder, TextDecoder, AbortController,
  btoa: s => Buffer.from(s,"binary").toString("base64"),
  atob: s => Buffer.from(s,"base64").toString("binary"),
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
vm.runInContext(code, sandbox, { filename:"inline" });

setTimeout(async () => {
  try {
    await vm.runInContext(`(async function(){ JIUCAI={generated_at:"",items:{}}; return await loadJiucai(false); })()`, sandbox);

    const got = vm.runInContext(`JIUCAI.items["NDX.GI"]`, sandbox);
    console.log("最终拿到:", JSON.stringify({ pct: got.pe_pct, date: got.date }));
    check("① 缓存里的 15.61 被线上文件的 16.16 覆盖", got.pe_pct, 16.16);

    // 再看一次：第二次加载。若数据仍被判为「不够新」会再请求一次；
    // 只要最终值仍是 16.16（没被缓存拉回旧值）就算正确。
    const before = calls.length;
    await vm.runInContext(`(async function(){ return await loadJiucai(false); })()`, sandbox);
    const after = calls.length;
    const got2 = vm.runInContext(`JIUCAI.items["NDX.GI"]`, sandbox);
    console.log(`   第二次请求数 +${after - before}，值=${got2.pe_pct}`);
    check("② 重复加载不会把值拉回旧的 15.61", got2.pe_pct, 16.16);

    console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
    process.exit(bad ? 1 : 0);
  } catch (e) {
    console.log("❌ 异常:", e.message, e.stack);
    process.exit(1);
  }
}, 1000);
