// 模拟用户真实场景：31 行 + v9 误补的 5 行 → 清理后应恢复（31 + NDX = 32）
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

// 用户真正的 31 行（有分位），不含被误补的那些
const user31 = [
  ["中证白酒","399997"],["CS消费50","931139"],["中证消费","1B0932"],["消费龙头","931068"],
  ["中证中药","930641"],["中证红利","000922"],["中国互联网","H11136"],["中证医疗","399989"],
  ["CNIFCF","980092"],["300价值","000919"],["中证生科","930743"],["CS创新药","931152"],
  ["50AH优选","950090"],["证券公司","399975"],["中证全指","000985"],["中证500","1B0905"],
  ["科创成长","1B0690"],["创成长","399296"],
  ["CS电池","931719"],["创业板50","399673"],["创价值","399295"],["细分化工","000813"],
  ["中证新能","399808"],["中证信创","931247"],["CS人工智能","930713"],["5G通信","931079"],
  ["CS新能源车","399976"],["人工智能","931071"],["动漫游戏","930901"],["纳斯达克100","NDX2"],
  ["国证算力","399363"],
].map(([n,c],i)=>({ id:"a-"+i, code:c, name:n, min:String(3+i*0.5), unit:10, pe:"", pb:"", mpct:"" }));

// v9 误补：全空、id 是 add() 真实生成的格式 a-9-N（不是 a9-N！）
// 注意：这些代码必须都在 SEED1 里（预置行），否则不会被清理
const wronglyAdded = [
  { id:"a-9-0", code:"164906", name:"中概互联网LOF", min:"", unit:10, pe:"", pb:"", mpct:"" },
  { id:"a-9-1", code:"HS2083", name:"恒生科技指数", min:"", unit:10, pe:"", pb:"", mpct:"" },
  { id:"a-9-2", code:"KWEB", name:"中证海外中国互联网", min:"", unit:10, pe:"", pb:"", mpct:"" },
  { id:"a-9-3", code:"980017", name:"国证芯片", min:"", unit:10, pe:"", pb:"", mpct:"" },
  { id:"a-9-4", code:"886042", name:"存储芯片", min:"", unit:10, pe:"", pb:"", mpct:"" },
];
const ndx = { id:"jc-9-0", code:"NDX", name:"纳斯达克100", min:"", unit:10, pe:"", pb:"", mpct:"",
              jc:"NDX.GI", formula:"jc20" };

store.set("dca-web-v4", JSON.stringify({
  seedVer: 9,
  list1: [...user31, ...wronglyAdded, ndx],
  list2: [], list3: [],
  order: [...user31, ...wronglyAdded, ndx].map(x=>x.code),
  last: {},
  src: {},
  orderSnaps: [{ name:"同花顺原顺序", at: Date.now(), codes: user31.map(x=>x.code) }],
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
  const list = vm.runInContext("state.list1.map(x=>x.code)", sandbox);
  const n = list.length;
  console.log(`清理后共 ${n} 行（原始 31 + NDX 1 = 32）`);

  check("① 总数回到 32", n, 32);
  check("② 误补的 164906 已移除", list.includes("164906"), false);
  check("③ 误补的 HS2083 已移除", list.includes("HS2083"), false);
  check("④ 误补的 KWEB 已移除", list.includes("KWEB"), false);
  check("⑤ 误补的 886042 已移除", list.includes("886042"), false);
  check("⑥ 用户自己的 31 行都在", user31.every(x=>list.includes(x.code)), true);
  check("⑦ NDX 在第一行", list[0], "NDX");

  // ★ 最关键的一条：NDX 绝不能被清理删掉（上一版就是这里出的错）
  check("⑦b ★ NDX 没有被误删", list.includes("NDX"), true);
  check("⑦c NDX 只有一行（没重复）", list.filter(c=>c==="NDX").length, 1);

  const order = vm.runInContext("state.order.slice()", sandbox);
  check("⑧ 自定义顺序也清理了", wronglyAdded.some(x=>order.includes(x.code)), false);
  check("⑨ 自定义顺序首位是 NDX", order[0], "NDX");
  check("⑨b 自定义顺序里 NDX 还在", order.includes("NDX"), true);

  console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
  process.exit(bad ? 1 : 0);
}, 900);
