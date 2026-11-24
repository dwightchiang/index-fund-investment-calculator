// 验证本轮 6 个修复
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("index.html", "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

class El {
  constructor(tag = "DIV") {
    this.tagName = tag; this.value = ""; this.textContent = ""; this.innerHTML = "";
    this.dataset = {}; this.style = {}; this.children = [];
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  addEventListener() {} appendChild(c) { this.children.push(c); return c; }
  removeChild() {} remove() {} closest() { return null; }
  querySelector() { return null; } querySelectorAll() { return []; }
  setAttribute() {} getAttribute() { return null; } focus() {} click() {}
  select() {} setSelectionRange() {}
  insertBefore(n) { this.children.push(n); return n; }
  showModal() {} close() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 100 }; }
}
const cache = new Map(), store = new Map();
const sandbox = {
  console,
  document: {
    querySelector(s) { if (!cache.has(s)) cache.set(s, new El()); return cache.get(s); },
    querySelectorAll() { return []; }, createElement(t) { return new El(t.toUpperCase()); },
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
  // ===== 问题 4：中文逗号/全角数字 =====
  console.log("── 问题4：数字输入容错 ──");
  const cases = [
    ["3，05（中文逗号当小数点）", "3，05", 3.05],
    ["1,4（半角逗号当小数点）", "1,4", 1.4],
    ["1,234（千分位）", "1,234", 1234],
    ["３.５（全角数字）", "３.５", 3.5],
    ["0。08（中文句号）", "0。08", 0.08],
    ["－2.5（全角负号）", "－2.5", -2.5],
    ["5%（带百分号）", "5%", 5],
    [" 7.8（前后空格）", " 7.8 ", 7.8],
    ["空", "", null],
    ["正常 2.31", "2.31", 2.31],
  ];
  for (const [name, input, want] of cases) {
    const got = vm.runInContext(`num(${JSON.stringify(input)})`, sandbox);
    check(`num ${name}`, got, want);
  }

  // normNum 单独测
  check("normNum 3，05 → 3.05", vm.runInContext(`normNum("3，05")`, sandbox), "3.05");
  check("normNum 1,234 → 1234", vm.runInContext(`normNum("1,234")`, sandbox), "1234");

  // 用中文逗号填分位，能算出金额
  const r = vm.runInContext(`
    (function(){
      state.yw=false; state.ahOn=false;
      AUTO={items:{}}; JIUCAI={items:{}};
      const it={ id:"t", code:"399997", name:"x", min:"3，05", unit:10 };
      quotes["399997"]={ price:100, prev:98.85, pct:1.16, date:"20261125", ts:Date.now(), at:Date.now() };
      return calc1(it);
    })()
  `, sandbox);
  console.log(`   分位"3，05" → 解析为 ${r.min}，金额 ${r.amount}`);
  check("中文逗号分位能算出金额（不是 NaN）", r.min, 3.05);
  check("金额 = (5-3.05-1.16)×10 = 7.9 → 8", r.amount, 8);

  // ===== 问题 6：复制 =====
  console.log("\n── 问题6：复制有兜底 ──");
  check("copyText 已定义", vm.runInContext("typeof copyText", sandbox), "function");
  check("copyText 里有 execCommand 兜底",
        /execCommand/.test(vm.runInContext("copyText.toString()", sandbox)), true);
  check("有 showCopyPanel（手动复制面板）",
        vm.runInContext("typeof showCopyPanel", sandbox), "function");
  check("复制后总会弹面板（不靠返回值判断）",
        html.includes("showCopyPanel(text)"), true);

  // ===== 问题 1：吸顶 =====
  console.log("\n── 问题1：吸顶区 ──");
  check("stickTop 元素存在", html.includes('id="stickTop"'), true);
  check("有 .stickTop 样式", /\.stickTop\{/.test(html), true);
  check("有 syncHdrHeight 函数", vm.runInContext("typeof syncHdrHeight", sandbox), "function");

  // ===== 问题 2：输入框不该强制全选 =====
  console.log("\n── 问题2：点输入框保持光标位置（不全选）──");
  check("有 lastPointerDown 记录", html.includes("lastPointerDown"), true);
  check("focusin 里会判断最近是否有指针按下",
        /Date\.now\(\)-lastPointerDown/.test(html), true);
  check("已移除无条件 mouseup 全选",
        !/addEventListener\("mouseup", e=>\{[\s\S]{0,400}t\.select\(\)/.test(html), true);

  // ===== 问题 3/5：填表快照 + 取消选中 =====
  console.log("\n── 问题3/5：填表模式 ──");
  check("有 todoSnapshot 变量", vm.runInContext("typeof todoSnapshot", sandbox), "object");
  check("有「取消选中」按钮创建逻辑", html.includes("btnFillUnpick"), true);

  // 模拟填表快照：填完一行不消失
  const snap = vm.runInContext(`
    (function(){
      AUTO={items:{}}; JIUCAI={items:{}};
      state.list1 = [
        { id:"a", code:"C1", name:"甲", min:"", unit:10, pe:"", pb:"", mpct:"" },
        { id:"b", code:"C2", name:"乙", min:"", unit:10, pe:"", pb:"", mpct:"" },
      ];
      onlyTodo = true; fillMode = true;
      todoSnapshot = new Set(state.list1.filter(it=>isTodo(it)).map(it=>it.id));
      const before = state.list1.filter(it=>todoSnapshot.has(it.id)).length;
      // 填完第一行
      state.list1[0].min = "3"; state.list1[0].minAt = Date.now();
      const after = state.list1.filter(it=>todoSnapshot.has(it.id)).length;
      return { before, after, isTodoNow: isTodo(state.list1[0]) };
    })()
  `, sandbox);
  console.log(`   快照 ${snap.before} 行 → 填完一行后仍显示 ${snap.after} 行`);
  check("① 填完的行不立刻消失（快照）", snap.after, 2);
  check("② 该行确实已不算待填", snap.isTodoNow, false);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
