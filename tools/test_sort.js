// 排序回归测试：排序只能改变「显示顺序」，绝不能改写 state.order（自定义顺序）
const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");

function slice(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error("切不出来：" + from);
  return html.slice(a, b);
}

const harness = `
let state = { list1: [], order: [], sort: "order" };
let quotes = {};
const AUTO = { items: {} };
const JIUCAI = { items: {} };
function num(v){ if(v===null||v===undefined||v==="") return null; const n=+v; return Number.isFinite(n)?n:null; }
function txCode(c){ return c; }
function save(){}
function render(){}
function scheduleCloudPush(){}
const TRIGGER = 5, NEAR = 10;
${slice("function effPct", "function remember")}
${slice("function chgOf", "/* ---------- 计算")}
${slice("function calcRow", "function coefOf")}
${slice("function ensureOrder", "function orderMove")}
module.exports = {
  applySort, viewOrder, ensureOrder,
  getState: () => state,
  set: (list, q) => { state.list1 = list; state.order = list.map(x=>x.code);
                      quotes = q||{}; state.sort="order"; },
};
`;

fs.writeFileSync("_sort_test.js", harness);
const m = require(require("path").resolve("_sort_test.js"));

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

// 自定义顺序：C3, C1, C2（故意不是按分位/名称/金额排的）
const list = [
  { id:"a", code:"C1", name:"乙", min:"8" },     // 5-10 段, 金额 (5-8)+0 = 负
  { id:"b", code:"C2", name:"丙", min:"2" },     // <5, 金额大
  { id:"c", code:"C3", name:"甲", min:"12" },    // >=10 不投
];
const q = { C1:{pct:-1}, C2:{pct:-1}, C3:{pct:-1} };
m.set(list, q);
// 手动把 order 设成 C3, C1, C2
m.getState().order = ["C3", "C1", "C2"];
const custom = m.getState().order.slice();

check("自定义顺序初始显示", m.viewOrder().map(x=>x.code), ["C3","C1","C2"]);

// 选「分位↑」：显示变了，但 order 不变
m.applySort("pctile");
check("分位↑ 显示顺序", m.viewOrder().map(x=>x.code), ["C2","C1","C3"]);
check("★ state.order 未被改写", m.getState().order, custom);

// 选「名称」
m.applySort("name");
check("名称 显示顺序", m.viewOrder().map(x=>x.code), ["C2","C3","C1"]);   // 丙 甲 乙
check("★ state.order 仍未被改写", m.getState().order, custom);

// 再切回自定义
m.applySort("order");
check("切回自定义 → 原样恢复", m.viewOrder().map(x=>x.code), ["C3","C1","C2"]);
check("★ state.order 仍是原顺序", m.getState().order, custom);

// 金额排序后切回自定义，也必须恢复
m.applySort("amt");
const byAmt = m.viewOrder().map(x=>x.code);
m.applySort("order");
check("金额排序后切回自定义 → 原样恢复", m.viewOrder().map(x=>x.code), ["C3","C1","C2"]);
check("金额排序确实变了（说明排序生效）", byAmt.join() !== "C3,C1,C2", true);

console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
process.exit(bad ? 1 : 0);
