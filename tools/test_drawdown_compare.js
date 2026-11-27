// 回撤对比 + 按涨跌排序 的回归测试
// 锁住两个 bug：
//   1) 定投清单里有纳指100（formula:"jc20"）时，「按涨跌排序」会抛
//      TypeError: Cannot read properties of undefined (reading 'pct')
//      → 整个 render() 被打断，用户看到的是「选了排序没反应」。
//   2) 📉 回撤对比 必须是「只显示、不参与计算」：打开前后金额一分都不能变。
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync("index.html", "utf8");

function slice(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error("切不出来：" + from);
  return html.slice(a, b);
}

const harness = `
let state = { list1:[], order:[], sort:"order", yw:false, last:{} };
let quotes = {};
const AUTO = { items:{} };
const JIUCAI = { items:{} };
let AH = { qivPost:null, qqqPost:null, futPost:null, fut:null };
const TRIGGER = 5, NEAR = 10;
function num(v){ if(v===null||v===undefined||v==="") return null;
                 const n=+v; return Number.isFinite(n)?n:null; }
function txCode(c){ return c; }
function save(){} function render(){} function scheduleCloudPush(){}
function proxyUsable(){ return false; }
${slice("function effPct", "function chgOf")}
${slice("function chgOf", "/* ---------- 计算")}
${slice("const AH_K", "function afterHoursWhyNo")}
${slice("function afterHoursOptions", "function coefOf")}
${slice("function ensureOrder", "function orderMove")}
// ---- 回撤对比部分（不依赖 DOM 的那几个纯函数）
const DD = { items:{}, updated:"", loaded:true };
let ddOn = false;
${slice("function ddOf(", "/* 顶部按钮的状态")}
module.exports = {
  viewOrder, applySort, rowPctOf, calcRow,
  ddOf, dd2026Of, ddLine,
  getDD: () => DD, setDD: d => Object.assign(DD, d),
  isDdOn: () => ddOn, setDdOn: v => { ddOn = v; },
  setQuotes: q => { quotes = q||{}; },
  setAH: o => { Object.assign(AH, o||{}); },
  getAH: () => AH,
  setList: l => { state.list1=l; state.order=l.map(x=>x.code); state.sort="order"; },
  getState: () => state,
};
`;
const tmp = path.resolve("_dd_test.js");
fs.writeFileSync(tmp, harness);
const m = require(tmp);

let bad = 0, pass = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : bad++;
  console.log(`${ok ? "✓" : "✗"} ${name}` + (ok ? "" : `\n    got=${JSON.stringify(got)}\n    want=${JSON.stringify(want)}`));
}
function ok(name, cond, extra) {
  cond ? pass++ : bad++;
  console.log(`${cond ? "✓" : "✗"} ${name}` + (cond || !extra ? "" : `\n    ${extra}`));
}

// ============ 1. 排序：有 jc20 行时不能抛错 ============
m.setList([
  { id:"1", code:"NDX", name:"纳斯达克100", formula:"jc20", jc:"NDX.GI", min:"4" },
  { id:"2", code:"sh000300", name:"沪深300", min:"2" },
  { id:"3", code:"sh000922", name:"中证红利", min:"8" },
]);
m.setQuotes({ sh000300:{pct:-1.2}, sh000922:{pct:0.8} });

let threw = null;
try { m.applySort("pct"); m.viewOrder(); } catch(e) { threw = e.message; }
ok("★ 有纳指100行时「按涨跌排序」不再抛错", threw === null, "抛了：" + threw);

const byPct = m.viewOrder().map(x => x.code);
check("★ 按涨跌排序：跌多在前（纳指100 无盘后数据 → 排最后）",
      byPct, ["sh000300", "sh000922", "NDX"]);

// 盘后涨跌参与排序
m.setAH({ qivPost: -3.5 });      // 纳指100 盘后跌 3.5% → 应该排到最前
const byPct2 = (m.applySort("pct"), m.viewOrder().map(x => x.code));
check("★ 纳指100 用「盘后涨跌」参与排序（−3.5% 排最前）",
      byPct2, ["NDX", "sh000300", "sh000922"]);

// 其它排序也不许炸
for (const k of ["pctile", "amt", "name", "order"]) {
  let e2 = null;
  try { m.applySort(k); m.viewOrder(); } catch(e) { e2 = e.message; }
  ok(`有纳指100行时「${k}」排序正常`, e2 === null, "抛了：" + e2);
}

// 某行计算炸了也不能连累整体顺序
m.getState().list1.push({ id:"4", code:"BAD", name:"坏数据", min:"1" });
let e3 = null;
try { m.applySort("pct"); m.viewOrder(); } catch(e) { e3 = e.message; }
ok("某行数据异常时排序仍返回完整列表", e3 === null && m.viewOrder().length === 4,
   "抛了：" + e3);

// 排序绝不能改 state.order（ensureOrder 补进 BAD 属于它本来的职责，不算排序改的）
m.getState().order = ["sh000922", "sh000300", "NDX"];
const before = m.getState().order.slice();
m.applySort("pct"); m.viewOrder();
const after = m.getState().order;
check("★ 排序不改 state.order（自定义顺序保住，只允许 ensureOrder 补缺）",
      after.filter(c => before.includes(c)), before);
ok("★ 排序没有把显示顺序写回 state.order",
   after.indexOf("sh000922") < after.indexOf("sh000300"),
   JSON.stringify(after));

// ============ 2. 回撤对比：只显示，不参与计算 ============
m.setList([
  { id:"1", code:"399006", name:"创业板指", min:"2", unit:"10" },
]);
m.setQuotes({ "399006":{pct:-1, price:2000} });
m.setDD({ items:{ "399006": {
  hi2026: 4000, hi2026Date:"2026-06-24",
  hiAll: 4000, hiAllDate:"2026-06-24",
  dd10: 58.53, dd10Peak:3576.8, dd10PeakDate:"2021-07-21",
  dd10Trough:1482.9, dd10TroughDate:"2024-02-04",
  partial:false, coveredFrom:"2016-11-01",
  lastClose: 2000, n: 3000 } } });

const amtBefore = m.calcRow(m.getState().list1[0]).amount;
m.setDdOn(true);
const amtOn = m.calcRow(m.getState().list1[0]).amount;
m.setDdOn(false);
const amtOff = m.calcRow(m.getState().list1[0]).amount;
check("★ 打开回撤对比不改变金额", [amtOn, amtOff], [amtBefore, amtBefore]);

// 2026 以来跌幅 = 1 − 2000/4000 = 50%
m.setDdOn(true);
const a = m.dd2026Of(m.getState().list1[0]);
check("★ 2026以来跌幅 = 1 − 当前价/2026年内最高", Math.round(a.pct * 100) / 100, 50);
check("2026以来跌幅带上最高点与日期", [a.hi, a.hiDate], [4000, "2026-06-24"]);

// 没行情 → 退回数据文件里的最新收盘
m.setQuotes({});
const a2 = m.dd2026Of(m.getState().list1[0]);
check("无实时行情时退回最新收盘价算", Math.round(a2.pct * 100) / 100, 50);

// 有手填价 → 手填优先于收盘
m.getState().list1[0].manual = "3000";
const a3 = m.dd2026Of(m.getState().list1[0]);
check("有手填价时用手填价（3000/4000 → 25%）", Math.round(a3.pct * 100) / 100, 25);
delete m.getState().list1[0].manual;

// 该指数没数据 → null，不是 NaN
const noData = m.dd2026Of({ code:"999999", name:"不存在" });
check("没数据的指数返回 null（不是 NaN）", noData, null);

// 关闭时不输出任何小字
m.setDdOn(false);
check("回撤对比关闭时不显示小字", m.ddLine(m.getState().list1[0]), "");

// 打开时小字含两个数
m.setDdOn(true);
const line = m.ddLine(m.getState().list1[0]);
ok("★ 打开后小字含「2026以来」和「10年最大回撤」",
   line.includes("2026以来") && line.includes("10年最大回撤"),
   line.slice(0, 200));
ok("★ 小字里出现 50.00%（2026以来）与 58.53%（10年回撤）",
   line.includes("−50.00%") && line.includes("−58.53%"), line.slice(0, 300));

// 取不到历史数据的那一行要显示「—」，不能编数字
m.getState().list1.push({ id:"9", code:"980138", name:"存储芯片", min:"2" });
const line2 = m.ddLine(m.getState().list1[1]);
ok("数据源没收录的指数显示「—」而不是假数字",
   line2.includes("—") && !/−\d/.test(line2.replace(/−50\.00%|−58\.53%/g, "")),
   line2.slice(0, 200));

// ============ 3. 按钮与渲染接线 ============
ok("★ 页面上有 📉 回撤对比 按钮", html.includes('id="fDD"') && html.includes("📉 回撤对比"));
ok("★ 按钮有点击处理（开关式）", /\$\("#fDD"\)\.onclick/.test(html) && html.includes("ddOn = !ddOn"));
ok("★ 按钮状态会同步（updateDdBtn）", html.includes("function updateDdBtn") && html.includes("updateDdBtn();"));
ok("★ 定投行里插入了回撤小字", /<span class="code2">[\s\S]{0,400}\$\{ddLine\(it\)\}/.test(html));
ok("★ 启动时加载 data/drawdowns.json", html.includes("data/drawdowns.json") && html.includes("loadDrawdowns"));
ok("★ 回撤数据版本变了会丢缓存", html.includes("DD_VER_KEY") && html.includes("!==VER"));
ok("回撤数据不从网络实时抓（离线可用）",
   !/fetchDrawdownsFromAPI|csindex\.com\.cn|stock\.xueqiu/.test(html));
ok("回撤小字不参与 calcRow（calcRow 里没有 ddOn/DD）",
   !/function calcRow\(it\)\{[\s\S]{0,400}(ddOn|DD\.)/.test(html));

console.log(`\n${bad ? `${bad} 项不符合预期（通过 ${pass}）` : `全部通过（${pass} 项）`}`);
process.exit(bad ? 1 : 0);
