// 验证 fetchDirect：只走浏览器直连（不碰代理），失败时用 lastGood 兜底
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
    addEventListener() {}, get activeElement() { return null; },
    head: { appendChild() {} }, body: new El("BODY"),
  },
  window: {},
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
sandbox.window = sandbox; sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "inline" });

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

setTimeout(async () => {
  try {
    check("① fetchDirect 已定义", vm.runInContext("typeof fetchDirect", sandbox), "function");

    // 注入一个假 fetcher：模拟直连能拿到数据
    vm.runInContext(`
      window.__calls = [];
      fetchersFor = function(c){ return [{ id:"fake", fn: async ()=>{ window.__calls.push(c);
        return { price: 1.5, prev: 1.4, pct: 7.14, date:"20261118", src:"假源" }; } }]; };
    `, sandbox);

    const r = await vm.runInContext("fetchDirect('TEST1')", sandbox);
    check("② 直连成功拿到数据", [r.price, r.src], [1.5, "假源"]);
    check("③ 确实调用了 fetcher", vm.runInContext("window.__calls.length", sandbox), 1);

    // 直连全挂 → 用 lastGood 兜底
    vm.runInContext(`
      fetchersFor = function(){ return [{ id:"bad", fn: async ()=>{ throw new Error("挂了"); } }]; };
      lastGood["TEST2"] = { price: 9.9, prev: 9.0, pct: 10, date:"20261118", at: Date.now()-120000 };
    `, sandbox);
    const r2 = await vm.runInContext("fetchDirect('TEST2')", sandbox);
    check("④ 直连失败 → lastGood 兜底", r2.price, 9.9);
    check("⑤ 兜底标了「上次·N分前」", /^上次·/.test(r2.src), true);

    // 什么都没有 → 抛错
    vm.runInContext(`lastGood["TEST3"] = undefined; failCache["TEST3"]=false;`, sandbox);
    let threw = false;
    try { await vm.runInContext("fetchDirect('TEST3')", sandbox); } catch (e) { threw = true; }
    check("⑥ 彻底取不到会抛错", threw, true);

    // ★ 关键：fetchDirect 不应触碰代理（proxyDownUntil 不被修改）
    const before = vm.runInContext("proxyDownUntil", sandbox);
    vm.runInContext(`proxyDownUntil=12345;`, sandbox);
    vm.runInContext(`
      fetchersFor = function(){ return [{ id:"bad", fn: async ()=>{ throw new Error("x"); } }]; };
      lastGood["TEST4"] = { price: 1, prev: 1, pct: 0, date:"20261118", at: Date.now() };
    `, sandbox);
    await vm.runInContext("fetchDirect('TEST4')", sandbox);
    check("⑦ fetchDirect 不修改代理冷却状态", vm.runInContext("proxyDownUntil", sandbox), 12345);

    console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
    process.exit(bad ? 1 : 0);
  } catch (e) {
    console.log("❌ 测试异常:", e.message);
    process.exit(1);
  }
}, 900);
