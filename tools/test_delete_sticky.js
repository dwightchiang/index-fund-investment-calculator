// 验证 930713「删了又回来」的修复
// 云端存档里它有两条矛盾记录：
//   {"code":"930713","at":1795072466659}            ← 加入
//   {"code":"930713","del":1,"delAt":1795072462912} ← 删除（比加入早 4 秒！）
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
  select() {} setSelectionRange() {}
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
  // ===== cloudPack：同一代码不能同时输出「活着」和 tombstone =====
  console.log("── cloudPack 去重 ──");
  const pack = vm.runInContext(`
    (function(){
      state.list1 = [
        { id:"a", code:"930713", name:"CS人工智能", min:"6.51", unit:10, pe:"", pb:"", mpct:"", addedAt:1795072466659 },
        { id:"b", code:"399997", name:"中证白酒", min:"3", unit:10, pe:"", pb:"", mpct:"", addedAt:100 },
      ];
      state.list2 = []; state.list3 = [];
      state.trash = [{ sec:"l1", code:"930713", name:"CS人工智能", delAt:1795072462912 }];
      return cloudPack();
    })()
  `, sandbox);
  const codes930 = pack.rows.l1.filter(r => r.code === "930713");
  console.log("   930713 在 rows.l1 里的记录数:", codes930.length);
  codes930.forEach(r => console.log("     ", JSON.stringify(r)));
  check("① 930713 只保留一条（tombstone）", codes930.length, 1);
  check("② 保留的是 del 标记那条", codes930[0].del, 1);
  check("③ 没有「活着」的 930713", codes930.some(r => !r.del), false);
  check("④ 其他行正常输出", pack.rows.l1.some(r => r.code === "399997" && !r.del), true);

  // ===== mergeRoster：本地回收站里有它 → 必须删掉 =====
  console.log("\n── mergeRoster 删除判据 ──");
  const r = vm.runInContext(`
    (function(){
      state.list1 = [
        { id:"a", code:"930713", name:"CS人工智能", min:"6.51", unit:10, pe:"", pb:"", mpct:"", addedAt:1795072466659 },
        { id:"b", code:"399997", name:"中证白酒", min:"3", unit:10, pe:"", pb:"", mpct:"", addedAt:100 },
      ];
      state.list2 = []; state.list3 = [];
      // 关键：用户删过它 → 本地回收站里已经有它
      state.trash = [{ sec:"l1", code:"930713", name:"CS人工智能", delAt:1795072462912 }];
      const remote = { rows: { l1: [
        { code:"930713", name:"CS人工智能", del:1, delAt:1795072462912 },
        { code:"399997", name:"中证白酒", at:100 },
      ], l2:[], l3:[] }, items:{ l1:{},l2:{},l3:{} } };
      mergeRoster(remote);
      return { codes: state.list1.map(x=>x.code), trash: (state.trash||[]).map(t=>t.code) };
    })()
  `, sandbox);
  console.log("   合并后清单元码:", r.codes.join(", "));
  check("⑤ ★ 本地回收站有它 → 从清单删掉（治「删了又回来」）", r.codes.includes("930713"), false);
  check("⑥ 其他行不受影响", r.codes.includes("399997"), true);
  check("⑦ 仍在回收站里（可恢复）", r.trash.includes("930713"), true);

  // 反例：远端只有更早的 tombstone、本地回收站没有它 → 不删（保护用户新加的行）
  const rProt = vm.runInContext(`
    (function(){
      state.list1 = [{ id:"e", code:"333333", name:"新加的", min:"", unit:10, pe:"", pb:"", mpct:"", addedAt:999 }];
      state.list2 = []; state.list3 = []; state.trash = [];
      const remote = { rows: { l1: [{ code:"333333", del:1, delAt:100 }], l2:[], l3:[] }, items:{l1:{},l2:{},l3:{}} };
      mergeRoster(remote);
      return state.list1.map(x=>x.code);
    })()
  `, sandbox);
  check("⑤b 远端 tombstone 更早且本地没删过 → 保留（不误删新加的）", rProt.includes("333333"), true);

  // ===== 正常情况：远端新删除，仍能删 =====
  const r2 = vm.runInContext(`
    (function(){
      state.list1 = [{ id:"c", code:"111111", name:"X", min:"", unit:10, pe:"", pb:"", mpct:"", addedAt:100 }];
      state.list2 = []; state.list3 = []; state.trash = [];
      const remote = { rows: { l1: [{ code:"111111", del:1, delAt:999 }], l2:[], l3:[] }, items:{l1:{},l2:{},l3:{}} };
      mergeRoster(remote);
      return state.list1.map(x=>x.code);
    })()
  `, sandbox);
  check("⑧ 常规删除（delAt > addedAt）仍然生效", r2.includes("111111"), false);

  // ===== 不误删：远端有活着的记录时不该删 =====
  const r3 = vm.runInContext(`
    (function(){
      state.list1 = [{ id:"d", code:"222222", name:"Y", min:"", unit:10, pe:"", pb:"", mpct:"", addedAt:500 }];
      state.list2 = []; state.list3 = []; state.trash = [];
      // 远端既有 tombstone（更早）又有活记录 → 不该删
      const remote = { rows: { l1: [
        { code:"222222", del:1, delAt:100 },
        { code:"222222", at:500 },
      ], l2:[], l3:[] }, items:{l1:{},l2:{},l3:{}} };
      mergeRoster(remote);
      return state.list1.map(x=>x.code);
    })()
  `, sandbox);
  check("⑨ 远端仍有活记录时不误删", r3.includes("222222"), true);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
