// 用极简 DOM 垫片把页面脚本跑一遍启动流程，专门抓「引用错名字 / 空指针」这类运行时崩溃
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("index.html", "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

class El {
  constructor(tag = "DIV") {
    this.tagName = tag;
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.checked = false;
    this.disabled = false;
    this.dataset = {};
    this.style = {};
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  addEventListener() {}
  removeEventListener() {}
  appendChild() {}
  remove() {}
  closest() { return null; }
  querySelector() { return new El(); }
  querySelectorAll() { return []; }
  setAttribute() {}
  getAttribute() { return null; }
  focus() {}
  click() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }
}

const cache = new Map();
const store = new Map();
const documentObj = {
  querySelector(sel) {
    if (!cache.has(sel)) cache.set(sel, new El());
    return cache.get(sel);
  },
  querySelectorAll() { return []; },
  createElement(tag) { return new El(tag.toUpperCase()); },
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
  fetch: () => Promise.reject(new Error("offline")),
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
process.on("unhandledRejection", (e) => errors.push("未处理的 Promise 拒绝: " + (e && e.message ? e.message : e)));

try {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: "index.html<script>" });
  console.log("✅ 脚本整体执行通过（含启动流程）");
} catch (e) {
  errors.push("启动崩溃: " + e.message + "\n" + String(e.stack).split("\n").slice(0, 4).join("\n"));
}

// 让启动里的异步任务（分位、行情）跑一会儿
setTimeout(() => {
  // 再手点几下关键路径：写入一条行情、重画、算一条
  try {
    sandbox.putQuote("399673", { price: 2453.47, prev: 2565.98, pct: -4, date: "20261107", src: "腾讯" });
    sandbox.render();
    const r = sandbox.calc1({ id: "t1", code: "399673", name: "创业板50", min: 5.6, unit: 10 });
    if (r.tag !== "near" || r.amount !== 34) {
      errors.push(`calc1 结果不对：tag=${r.tag} amount=${r.amount}（期望 near/34）`);
    }
    sandbox.renderSoon();
    console.log("✅ 写入行情 / 重画 / 计算 都正常");
  } catch (e) {
    errors.push("交互路径异常: " + e.message);
  }

  if (errors.length) {
    console.log("❌ 发现问题：");
    errors.forEach((x) => console.log("  " + x));
    process.exit(1);
  }
  console.log("✅ 异步启动阶段也没有异常");
  process.exit(0);
}, 1500);
