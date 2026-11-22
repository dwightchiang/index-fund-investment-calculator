// 列出 START_DATE 表里所有「系数 < 1」的指数，供用户校验
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
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "inline" });

setTimeout(() => {
  // 用页面自己的函数算，跟界面显示完全一致
  const rows = vm.runInContext(`
    (function(){
      const out = [];
      const names = {};
      // 名称从 SEED1 里取
      SEED1.forEach(a=>{ names[a[1]] = a[0]; });
      Object.keys(START_DATE).forEach(c=>{
        const it = { code:c, startDate:"" };
        const y = yearsOf(it);
        const coef = yearCoefOf(it);
        out.push({ code:c, name:names[c]||c, start:START_DATE[c], y, coef });
      });
      return out;
    })()
  `, sandbox);

  const today = vm.runInContext("new Date().toISOString().slice(0,10)", sandbox);
  console.log("今天:", today, "\n");

  const less = rows.filter(r => r.coef !== null && r.coef < 1)
                   .sort((a, b) => a.coef - b.coef || a.start.localeCompare(b.start));
  const full = rows.filter(r => r.coef === 1);

  console.log(`=== 系数 < 1 的（${less.length} 个）===`);
  console.log("起点".padEnd(12) + "年".padEnd(4) + "系数".padEnd(7) + "名称 / 代码");
  for (const r of less) {
    console.log(`${r.start}  ${String(r.y).padEnd(3)} ${String(r.coef).padEnd(6)} ${r.name} ${r.code}`);
  }

  console.log(`\n=== 系数 = 1.0 的（${full.length} 个，已满 10 年封顶）===`);
  console.log(full.map(r => `${r.name}(${r.code}) ${r.start}`).join("\n"));

  // 顺便存一份 CSV，方便你对着表格核对
  const csv = ["名称,代码,数据起点,满年数,系数"]
    .concat(less.map(r => `${r.name},${r.code},${r.start},${r.y},${r.coef}`))
    .join("\n");
  fs.writeFileSync(".tmp/coef_lt1.csv", "\uFEFF" + csv, "utf8");
  console.log("\n（已导出 .tmp/coef_lt1.csv）");
}, 900);
