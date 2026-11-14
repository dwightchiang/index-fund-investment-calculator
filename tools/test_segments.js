// 分位段筛选测试：段划分、计数、行选中、重试目标
const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");

function slice(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error("切不出来：" + from);
  return html.slice(a, b);
}

const harness = `
const TRIGGER = 5, NEAR = 10;
let quotes = {};
let AUTO = { items: {} };
let state = { list1: [], last: {} };
let retrySegs = new Set();
let pickSet = new Set();
let onlyNaFilter = false;
function num(v){ if(v===null||v===undefined||v==="") return null; const n=+v; return Number.isFinite(n)?n:null; }
function txCode(c){ return c; }
${slice("function effPct", "function remember")}
${slice("const SEG_KEYS", "function updateRetryUI")}
module.exports = {
  segOf, segSel, rowSel, retryTargets, segCounts, minPctOf, noQuote,
  set: (list, q, segs, picks, onlyNa) => {
    state.list1 = list; quotes = q||{};
    retrySegs = new Set(segs||[]); pickSet = new Set(picks||[]);
    onlyNaFilter = !!onlyNa;
  },
};
`;

fs.writeFileSync("_seg_test.js", harness);
const m = require(require("path").resolve("_seg_test.js"));

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

// 造 8 个指数，覆盖各段 + 没分位的
const list = [
  { id:"a", code:"C1", name:"分位3",   min:"3" },
  { id:"b", code:"C2", name:"分位4.9", min:"4.9" },
  { id:"c", code:"C3", name:"分位10",  min:"10" },
  { id:"d", code:"C4", name:"分位14.9",min:"14.9" },
  { id:"e", code:"C5", name:"分位20",  min:"20" },
  { id:"f", code:"C6", name:"分位25",  min:"25" },
  { id:"g", code:"C7", name:"没填分位", min:"" },
  { id:"h", code:"C8", name:"蛋卷分位12", min:"" },
];
const quotes = { C1:{pct:-1}, C2:{pct:-1}, C3:{pct:-1}, C4:{pct:-1}, C5:{pct:-1}, C6:{pct:-1}, C7:{pct:-1}, C8:{pct:-1} };
const auto = { items: { C8: { pe_pct: 12, pb_pct: 30 } } };

m.set(list, quotes, [], []);
// 用蛋卷数据得先设 AUTO —— harness 里 AUTO 是 let，暴露一个 setter 更稳妥
check("段划分", list.map(x => m.segOf(x)), ["0-5","0-5","10-15","10-15","20+","20+",null,null]);
check("20+ 计数", m.segCounts()["20+"], 2);
check("无行情计数", m.segCounts().na, 0);

// 选 20+ → 只选中 C5 C6
m.set(list, quotes, ["20+"], []);
check("选 20+ 的重试目标", m.retryTargets(), ["C5","C6"]);
check("选 20+ 时各行的选中状态", list.map(x => m.rowSel(x)),
      [false,false,false,false,true,true,false,false]);

// 选 10-15 → C3 C4
m.set(list, quotes, ["10-15"], []);
check("选 10-15 的重试目标", m.retryTargets(), ["C3","C4"]);

// 多选段 0-5 + 20+
m.set(list, quotes, ["0-5","20+"], []);
check("多选 0-5+20+", m.retryTargets(), ["C1","C2","C5","C6"]);

// 圆圈点选与段选合并、去重
m.set(list, quotes, ["20+"], ["a"]);
check("段+圆圈合并", m.retryTargets(), ["C1","C5","C6"]);
check("圆圈点选的行也选中", m.rowSel(list[0]), true);

// 无行情段：C7 没行情
const q2 = { C1:{pct:-1}, C2:{pct:-1}, C3:{pct:-1}, C4:{pct:-1}, C5:{pct:-1}, C6:{pct:-1}, C8:{pct:-1} };
m.set(list, q2, ["na"], []);
check("无行情段 → 只选没行情的", m.retryTargets(), ["C7"]);
check("无行情计数", m.segCounts().na, 1);

// 全选段也不含无分位的 C7
m.set(list, quotes, ["0-5","5-10","10-15","15-20","20+"], []);
check("全选段也不含无分位的 C7", m.retryTargets().includes("C7"), false);

// —— 回归：全选后再取消一个段，数量必须跟着变（曾经的 bug：全选往 pickSet 里塞，取消段不生效）
const ALLSEG = ["0-5","5-10","10-15","15-20","20+","na"];
m.set(list, quotes, ALLSEG, []);
const full = m.retryTargets().length;
m.set(list, quotes, ALLSEG.filter(k => k !== "20+"), []);
const after = m.retryTargets().length;
check("全选时总数（6 个有分位，C7 无分位不计）", full, 6);
check("取消 20+ 后减少 2 个", full - after, 2);
check("取消 20+ 后 C5/C6 不再选中", [m.rowSel(list[4]), m.rowSel(list[5])], [false, false]);
check("取消 20+ 后其余仍选中", [m.rowSel(list[0]), m.rowSel(list[2]), m.rowSel(list[3])], [true, true, true]);

// 全选后取消「无行情」：C7 本来没行情，取消后仍在（它没有分位、不属任何段）
m.set(list, q2, ALLSEG, []);
check("全选（含无行情）总数", m.retryTargets().length, 7);
m.set(list, q2, ALLSEG.filter(k => k !== "na"), []);
check("取消无行情后 C7 不再选中", m.rowSel(list[6]), false);
check("取消无行情后不含 C7", m.retryTargets().includes("C7"), false);

// —— 交集模式「限无行情」：只更新「0-5 段里没有行情的」
// C1 没行情、C2 有行情，都在 0-5 段
const q3 = { C2:{pct:-1}, C3:{pct:-1}, C4:{pct:-1}, C5:{pct:-1}, C6:{pct:-1}, C7:{pct:-1}, C8:{pct:-1} };
m.set(list, q3, ["0-5"], [], true);
check("限无行情 + 0-5 → 只剩没行情的 C1", m.retryTargets(), ["C1"]);
m.set(list, q3, ["0-5"], [], false);
check("不限时 0-5 → C1 C2 都要", m.retryTargets(), ["C1","C2"]);
// 交集模式下只勾「无行情」= 所有没行情的
m.set(list, q3, ["na"], [], true);
check("限无行情 + 只勾无行情 → 所有没行情的", m.retryTargets(), ["C1"]);
// 交集模式下什么都不勾 → 空
m.set(list, q3, [], [], true);
check("限无行情 + 未勾任何段 → 空", m.retryTargets(), []);

console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
process.exit(bad ? 1 : 0);
