// 用 DOM 垫片跑一遍页面启动，确认纳斯达克100 这行能被正确渲染（分位 18.86 → ¥5.7）
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("index.html", "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const jiucai = JSON.parse(fs.readFileSync("data/jiucai.json", "utf8"));

class El {
  constructor(tag = "DIV") {
    this.tagName = tag; this.value = ""; this.textContent = ""; this.innerHTML = "";
    this.checked = false; this.disabled = false; this.dataset = {}; this.style = {};
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    this.children = [];
  }
  addEventListener() {} removeEventListener() {} appendChild() {} remove() {}
  closest() { return null; } querySelector() { return null; } querySelectorAll() { return []; }
  setAttribute() {} getAttribute() { return null; } focus() {} click() {}
  showModal() {} close() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }
}

const cache = new Map();
const store = new Map();
const documentObj = {
  querySelector(sel) { if (!cache.has(sel)) cache.set(sel, new El()); return cache.get(sel); },
  querySelectorAll() { return []; },
  createElement(t) { return new El(t.toUpperCase()); },
  addEventListener() {},
  get activeElement() { return null; },
  head: { appendChild() {} },
  body: new El("BODY"),
};

const sandbox = {
  console,
  document: documentObj,
  window: {},
  location: { pathname: "/index.html", hash: "", hostname: "127.0.0.1", origin: "http://127.0.0.1" },
  navigator: { clipboard: { writeText: async () => {} }, userAgent: "node" },
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  },
  // 只让 jiucai.json 成功
  fetch: (url) => {
    if (String(url).includes("jiucai.json")) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => jiucai,
        text: async () => JSON.stringify(jiucai),
      });
    }
    return Promise.reject(new Error("offline"));
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  alert: () => {}, confirm: () => true, prompt: () => null,
  Request, Response, Headers, URL,
  TextEncoder, TextDecoder, AbortController,
  btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  atob: (s) => Buffer.from(s, "base64").toString("binary"),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const errors = [];
process.on("unhandledRejection", (e) => errors.push("rejection: " + (e && e.message)));

try {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "inline" });
  console.log("✅ 脚本执行通过");
} catch (e) {
  console.log("❌ 启动崩溃:", e.message);
  process.exit(1);
}

setTimeout(() => {
  try {
    const items = vm.runInContext("state.list1", sandbox);
    const ndx = items.find((x) => x.code === "NDX" || x.jc === "NDX.GI");
    if (!ndx) { console.log("❌ 清单里没有纳斯达克100 行"); process.exit(1); }
    console.log(`✅ 清单里有：${ndx.name}  code=${ndx.code} jc=${ndx.jc} formula=${ndx.formula}`);

    vm.runInContext("JIUCAI = " + JSON.stringify(jiucai), sandbox);
    const r = vm.runInContext("calcRow(state.list1.find(x=>x.code==='NDX'))", sandbox);
    console.log(`✅ 计算：分位=${r.pct} 系数=${r.coef} 金额=¥${r.amount}`);
    if (r.pct !== 18.86) { console.log("❌ 分位不对"); process.exit(1); }
    if (r.coef !== 5) { console.log("❌ 系数不对（应 5）"); process.exit(1); }
    if (r.amount !== 5.7) { console.log("❌ 金额不对（应 5.7）"); process.exit(1); }

    const av = vm.runInContext("amtView(calcRow(state.list1.find(x=>x.code==='NDX')))", sandbox);
    console.log(`✅ 显示：${av.txt}  cls=${av.cls || "(默认)"}`);
    if (av.txt !== "¥5.7") { console.log("❌ 显示不对"); process.exit(1); }

    if (errors.length) { console.log("❌ 异步异常:", errors); process.exit(1); }
    console.log("\n全部通过");
    process.exit(0);
  } catch (e) {
    console.log("❌ 交互检查失败:", e.message);
    process.exit(1);
  }
}, 1200);
