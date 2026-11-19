// 验证：data/jiucai.json 过期时，页面能直接问韭圈儿接口拿到新数据
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

// 本地文件是旧的（11-17），实时接口是新的（11-20）
const OLD_FILE = { generated_at:"2026-11-18 12:00", source:"文件",
  items: { "NDX.GI": { name:"纳斯达克100", pe:26.24, pe_pct:18.86, pb_pct:96.67, date:"2026-11-17" } } };
const LIVE = { header:{ name:"纳斯达克100", level_desc:"较低" }, update_time:"2026-11-20",
  table:[ {name:"市盈率", latest:27.5, avg:31, percent:22.4},
          {name:"市净率", latest:10.5, avg:7.3, percent:97.1} ] };

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
  // fetch：文件返回旧的，接口返回新的
  fetch: async (url) => {
    calls.push(String(url));
    if(String(url).includes("jiucai.json"))
      return { ok:true, status:200, json: async()=>OLD_FILE };
    if(String(url).includes("jiucaishuo.com"))
      return { ok:true, status:200, json: async()=>LIVE };
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
    // 把「现在」当成 2026-11-21（周六），期望数据 11-20，文件里只有 11-17 → 应触发直连
    const ok = await vm.runInContext(`
      (async function(){
        // 强制不走缓存
        localStorage.removeItem("dca-jiucai-cache");
        JIUCAI = { generated_at:"", items:{} };
        return await loadJiucai(true);
      })()
    `, sandbox);

    check("① loadJiucai 返回 true", ok, true);
    check("② 确实请求了韭圈儿接口", calls.some(u=>u.includes("jiucaishuo.com")), true);

    const got = vm.runInContext(`JIUCAI.items["NDX.GI"]`, sandbox);
    console.log("   拿到:", JSON.stringify(got));
    check("③ 数据被更新到实时值", got.date, "2026-11-20");
    check("④ 分位是实时值 22.4（不是文件的 18.86）", got.pe_pct, 22.4);
    check("⑤ 来源标为页面直连", vm.runInContext("JIUCAI.source", sandbox), "韭圈儿（页面直连）");

    console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
    process.exit(bad ? 1 : 0);
  } catch (e) {
    console.log("❌ 异常:", e.message);
    process.exit(1);
  }
}, 1000);
