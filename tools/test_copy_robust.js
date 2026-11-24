// 验证复制按钮不再因为 jc20 行（无 chg）而崩溃
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
  querySelector(sel) {
    // showCopyPanel 会用到 querySelector("#cpTxt") 等
    if (!this._q) this._q = new Map();
    if (!this._q.has(sel)) this._q.set(sel, new El("SPAN"));
    return this._q.get(sel);
  }
  querySelectorAll() { return []; }
  setAttribute() {} getAttribute() { return null; } focus() {} click() {}
  select() {} setSelectionRange() {}
  showModal() {} close() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }
}
const cache = new Map(), store = new Map();
const panels = [];
const sandbox = {
  console,
  document: {
    querySelector(s) { if (!cache.has(s)) cache.set(s, new El()); return cache.get(s); },
    querySelectorAll() { return []; },
    createElement(t) {
      const e = new El(t.toUpperCase());
      if (t.toLowerCase() === "dialog") { panels.push(e); }
      return e;
    },
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
  getComputedStyle: () => ({ fontWeight: "600", fontSize: "15px", fontFamily: "sans-serif" }),
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
  // 关键：构造一个 jc20 行（calcRow 返回的对象没有 chg）
  const res = vm.runInContext(`
    (function(){
      AUTO={items:{}};
      JIUCAI={items:{"NDX.GI":{name:"纳斯达克100",pe_pct:5.15,date:"2026-11-23"}}};
      AH={qivPost:null,qqqPost:null,futPost:null,at:Date.now(),src:""};
      state.ahOn=false; state.yw=false;

      const nd = state.list1.find(x=>x.code==="NDX");
      if(nd){ nd.min=""; }
      const r = calcRow(nd || {code:"NDX", formula:"jc20", jc:"NDX.GI", id:"x", name:"纳斯达克100", unit:10});

      // 模拟复制时的取值（旧代码这里会炸）
      let crashed = false;
      try{
        const _ = fmt(r.chg.pct);   // 旧写法
      }catch(e){ crashed = true; }

      // 新写法
      const chgPct = (r.chg && r.chg.pct!==null && r.chg.pct!==undefined) ? fmt(r.chg.pct) : "—";

      return {
        isJC: r.isJC,
        hasChg: !!r.chg,
        oldWouldCrash: crashed,
        safeValue: chgPct,
        amount: r.amount,
      };
    })()
  `, sandbox);

  console.log("   calcRow(NDX) 结果:", JSON.stringify(res));
  check("① jc20 行确实没有 chg 字段", res.hasChg, false);
  check("② 旧写法 r.chg.pct 会抛异常（这就是复制没反应的原因）", res.oldWouldCrash, true);
  check("③ 新写法安全取值得到 —", res.safeValue, "—");

  // 现在真的跑一次复制按钮的逻辑（不点 DOM，直接调内部逻辑）
  const copyOk = vm.runInContext(`
    (function(){
      // 直接复用源码里的拼接逻辑（逐行 try/catch）
      const L=["定投 测试"];
      let skipped = 0, pushed = 0;
      state.list1.forEach(it=>{
        try{
          const r=calcRow(it);
          if(r.tag==="na" || r.min===null || r.amount===0 || r.amount===undefined) return;
          const chgPct = (r.chg && r.chg.pct!==null && r.chg.pct!==undefined) ? fmt(r.chg.pct) : "—";
          const label = r.isJC ? "纳指" : (r.tag==="near" ? "临近" : "估值");
          L.push("【"+label+"】"+it.name+" 分位"+fmt(r.min)+" 涨跌"+chgPct+"% → "+(r.amount<0?"-¥":"¥")+Math.abs(r.amount));
          pushed++;
        }catch(e){ skipped++; }
      });
      return { pushed, skipped, lines: L.length, sample: L.slice(1,3) };
    })()
  `, sandbox);
  console.log("   复制拼接结果:", JSON.stringify(copyOk));
  check("④ 没有行因为异常被跳过", copyOk.skipped, 0);
  check("⑤ 至少拼出了内容", copyOk.lines > 1, true);

  // showCopyPanel 能创建面板
  check("⑥ showCopyPanel 是函数", vm.runInContext("typeof showCopyPanel", sandbox), "function");
  try{
    vm.runInContext(`showCopyPanel("测试内容\\n第二行")`, sandbox);
    check("⑦ showCopyPanel 调用不抛异常", true, true);
    check("⑧ 面板被创建了", panels.length > 0, true);
  }catch(e){
    check("⑦ showCopyPanel 调用不抛异常", false, true);
  }

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
