// 关键回归：本地清单较旧时 push，不能把云端的行覆盖掉
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

const now = Date.now();
// 手机端：只有 AAA（清单较旧）
store.set("dca-web-v4", JSON.stringify({
  seedVer: 9,
  list1: [{ id:"m1", code:"AAA", name:"甲", min:"3", unit:10, pe:"", pb:"", mpct:"", addedAt: now-9000 }],
  list2: [], list3: [], order:["AAA"], last:{}, src:{},
  seed9Cleanup:1, jcTopVer:1, jcRestoreVer:1, pinTopVer:1,
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
  // 云端（电脑推的）：有 AAA + 科创综指(1B0680)
  const remote = {
    rows: {
      l1: [
        { code:"AAA", name:"甲", at: now-9000 },
        { code:"1B0680", name:"科创综指", at: now-1000 },
      ],
      l2: [], l3: [],
    },
    items: { l1: {}, l2: {}, l3: {} },
    order: ["AAA","1B0680"], orderAt: now-500,
    updatedAt: now-500,
  };

  // 模拟 cloudPush 的「先合并」步骤（这正是修复点）
  vm.runInContext(`
    applyingRemote = true;
    mergeRoster(${JSON.stringify(remote)});
    cloudMerge(${JSON.stringify(remote)});
    applyingRemote = false;
  `, sandbox);

  const list = vm.runInContext("state.list1.map(x=>x.code)", sandbox);
  console.log("合并后:", list.join(", "));

  check("① 手机补上了云端的科创综指", list.includes("1B0680"), true);
  check("② 手机自己的 AAA 保留", list.includes("AAA"), true);

  // 然后才 cloudPack —— 必须包含两行，否则上传就覆盖掉了
  const payload = vm.runInContext("cloudPack()", sandbox);
  const rowCodes = payload.rows.l1.map(r=>r.code);
  console.log("待上传 rows:", rowCodes.join(", "));
  check("③ 上传内容包含两行（不会覆盖云端）", rowCodes.sort(), ["1B0680","AAA"]);
  check("④ payload 版本号是 v2", payload.v, 2);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
