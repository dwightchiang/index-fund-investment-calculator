// 修「新增行重复出现」与「新行挡在纳指100 上方」
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

// 用户现状：NDX 在首位，另有若干老行；然后刚加了一个 1B0680 科创综指
const list = [
  { id:"jc-r-0", code:"NDX", name:"纳斯达克100", min:"", unit:10, pe:"", pb:"", mpct:"",
    jc:"NDX.GI", formula:"jc20" },
  { id:"a-1", code:"399997", name:"中证白酒", min:"3.2", unit:10, pe:"", pb:"", mpct:"" },
  { id:"a-2", code:"000922", name:"中证红利", min:"64.67", unit:10, pe:"", pb:"", mpct:"" },
];
store.set("dca-web-v4", JSON.stringify({
  seedVer: 9, list1: list, list2: [], list3: [],
  order: list.map(x=>x.code), last:{}, src:{},
  seed9Cleanup: 1, jcTopVer: 1, jcRestoreVer: 1,
}));

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "inline" });

setTimeout(() => {
  // 模拟 doAdd 的核心逻辑（不触发网络请求，直接操作 state）
  const added = vm.runInContext(`
    (function(){
      const code="1B0680";
      const it={id:"x-test", name:"科创综指", code, min:"", unit:10, pe:"", pb:"", mpct:"", rev:0};
      state.list1.push(it);
      ensureOrder();
      const pinned = new Set(state.list1.filter(x=>x.formula==="jc20").map(x=>x.code));
      const head=[]; let tail=[];
      for(const c of state.order){
        if(c===code) continue;
        if(pinned.has(c)) head.push(c); else tail.push(c);
      }
      state.order=[...head, code, ...tail];
      return state.order.slice();
    })()
  `, sandbox);

  console.log("插入后 order:", added.join(", "));

  check("① order 里没有重复代码", added.length, new Set(added).size);
  check("② NDX 仍在第一", added[0], "NDX");
  check("③ 新行排在 NDX 之后", added[1], "1B0680");
  check("④ 老行顺序不变", added.slice(2), ["399997","000922"]);

  // 渲染层：viewOrder 不能出现同一代码两次
  const view = vm.runInContext("viewOrder().map(x=>x.code)", sandbox);
  check("⑤ viewOrder 无重复", view.length, new Set(view).size);
  check("⑥ viewOrder 长度 = 清单长度", view.length, vm.runInContext("state.list1.length", sandbox));

  // ensureOrder 自带的去重保险：人为塞重复应该被清掉
  const fixed = vm.runInContext(`
    (function(){
      state.order.push("NDX");          // 制造重复
      ensureOrder();
      return state.order.slice();
    })()
  `, sandbox);
  check("⑦ 人为造重复 → ensureOrder 去重", fixed.length, new Set(fixed).size);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
