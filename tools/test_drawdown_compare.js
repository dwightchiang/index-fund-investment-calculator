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
  ddOf, ddSince24Of, ddLine, fmtPx,
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
  hi24: 4000, hi24Date:"2026-06-24",
  hi2026: 4000, hi2026Date:"2026-06-24",
  hiAll: 4037.959, hiAllDate:"2015-06-04",
  dd10: 58.53, dd10Peak:3576.12, dd10PeakDate:"2021-07-21",
  dd10Trough:1482.99, dd10TroughDate:"2024-02-04", dd10Days:928,
  ddAll: 70.66, ddAllPeak:4037.959, ddAllPeakDate:"2015-06-04",
  ddAllTrough:1184.91, ddAllTroughDate:"2018-10-18", ddAllDays:1232,
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
const a = m.ddSince24Of(m.getState().list1[0]);
check("★ 2024-09-24以来跌幅 = 1 − 当前价/该起点后最高", Math.round(a.pct * 100) / 100, 50);
check("2024-09-24以来跌幅带上最高点与日期", [a.hi, a.hiDate], [4000, "2026-06-24"]);

// 没行情 → 退回数据文件里的最新收盘
m.setQuotes({});
const a2 = m.ddSince24Of(m.getState().list1[0]);
check("无实时行情时退回最新收盘价算", Math.round(a2.pct * 100) / 100, 50);

// 有手填价 → 手填优先于收盘
m.getState().list1[0].manual = "3000";
const a3 = m.ddSince24Of(m.getState().list1[0]);
check("有手填价时用手填价（3000/4000 → 25%）", Math.round(a3.pct * 100) / 100, 25);
delete m.getState().list1[0].manual;

// 该指数没数据 → null，不是 NaN
const noData = m.ddSince24Of({ code:"999999", name:"不存在" });
check("没数据的指数返回 null（不是 NaN）", noData, null);

// 关闭时不输出任何小字
m.setDdOn(false);
check("回撤对比关闭时不显示小字", m.ddLine(m.getState().list1[0]), "");

// 打开时小字含三个数（2024-09-24以来 / 10年 / 历史）
m.setDdOn(true);
const line = m.ddLine(m.getState().list1[0]);
ok("★ 打开后小字含「2024-09-24以来」「10年」「历史」三块",
   line.includes("2024-09-24以来") && line.includes("10年") && line.includes("历史"),
   line.slice(0, 300));
ok("★ 小字里出现 50.00%（2024-09-24以来）、58.53%（10年）、70.66%（历史）",
   line.includes("−50.00%") && line.includes("−58.53%") && line.includes("−70.66%"),
   line.slice(0, 400));

// 起止日必须用完整年份
ok("★ 10年回撤的起止日是完整 YYYY-MM-DD",
   line.includes("2021-07-21→2024-02-04"), line.slice(0, 400));
ok("★ 历史回撤的起止日是完整 YYYY-MM-DD",
   line.includes("2015-06-04→2018-10-18"), line.slice(0, 500));
ok("★ 不再用 MM-DD 短格式（不能只有 07-21→02-04）",
   !/(?<!2021-)07-21→02-04/.test(line.replace("2021-07-21→2024-02-04", "")));

// 持续天数必须在
ok("★ 10年回撤带持续天数（928天）", line.includes("928天"), line.slice(0, 400));
ok("★ 历史回撤带持续天数（1232天）", line.includes("1232天"), line.slice(0, 500));

// 三个指标竖向堆叠：每块一个 .ddr div，不是挤在一起的一串
const ddrCount = (line.match(/class="ddr"/g) || []).length;
check("★ 三个指标各自一个块（竖向堆叠，共 3 块）", ddrCount, 3);
ok("★ 每块都有标签列（ddr-lb）与数值列（ddr-pct）",
   (line.match(/ddr-lb/g) || []).length === 3 && (line.match(/ddr-pct/g) || []).length === 3);
ok("日期与天数各有独立 class（ddr-date / ddr-days）",
   line.includes('class="ddr-date"') && line.includes('class="ddr-days"'));

// ★ 三个指标都必须显示点位（只看百分比不知道从多高跌下来的）
ok("★ 2024-09-24以来 显示最高点位与日期",
   line.includes("4000") && line.includes("2026-06-24"), line.slice(0, 400));
ok("★ 10年 显示峰值→谷底点位（3576→1483）",
   line.includes("3576") && line.includes("1483"), line.slice(0, 500));
ok("★ 历史 显示峰值→谷底点位（4038→1185）",
   line.includes("4038") && line.includes("1185"), line.slice(0, 600));
ok("★ 不再出现「2026以来」字样（已改成 2024-09-24 以来）",
   !line.includes("2026以来"), line.slice(0, 300));
ok("点位用 ddr-pk class 单独排版",
   (line.match(/ddr-pk/g) || []).length >= 3);

ok("悬停时能看到峰值/谷底点位",
   line.includes("3576.12") && line.includes("1482.99"),
   line.slice(0, 600));

// 历史回撤缺数据时显示「—」，不许崩
const lineNoAll = m.ddLine({ code:"399006", name:"创业板指", min:"2" });
ok("历史回撤缺字段时显示「—」而不是 NaN",
   !/NaN|undefined/.test(lineNoAll), lineNoAll.slice(0, 300));

// 第二行：回撤块不在 .nmcell 里，而在 grid 之后
ok("★ 回撤块移出了名称列（不在 nmcell 内）",
   !/<div class="nmcell">[\s\S]{0,600}\$\{ddLine\(it\)\}/.test(html),
   "ddLine 还在 nmcell 里");
ok("★ 回撤块在 grid 那一行之后（独占整行）",
   /<\/div>\s*\$\{ddLine\(it\)\}/.test(html) || /\$\{ddLine\(it\)\}<\/div>/.test(html) || html.includes("${ddLine(it)}"),
   "没找到 ddLine 的位置");

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
ok("★ 定投行里插入了回撤块", html.includes("${ddLine(it)}"));
ok("★ 回撤块紧跟 grid 之后、在展开面板之前（独占指数的第二行）",
   /<\/div>\s*\$\{ddLine\(it\)\}\s*<div class="expand/.test(html),
   "位置不对：应在 grid 收尾 </div> 之后、expand 之前");
ok("★ 启动时加载 data/drawdowns.json", html.includes("data/drawdowns.json") && html.includes("loadDrawdowns"));
ok("★ 回撤数据版本变了会丢缓存", html.includes("DD_VER_KEY") && html.includes("!==VER"));
ok("回撤数据不从网络实时抓（离线可用）",
   !/fetchDrawdownsFromAPI|csindex\.com\.cn|stock\.xueqiu/.test(html));
ok("回撤小字不参与 calcRow（calcRow 里没有 ddOn/DD）",
   !/function calcRow\(it\)\{[\s\S]{0,400}(ddOn|DD\.)/.test(html));

console.log(`\n${bad ? `${bad} 项不符合预期（通过 ${pass}）` : `全部通过（${pass} 项）`}`);
process.exit(bad ? 1 : 0);
