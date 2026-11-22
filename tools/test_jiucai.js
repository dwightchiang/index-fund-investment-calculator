// 韭圈儿公式测试：(20−分位)×系数，≥20 不投，10-20→5，5-10→10，<5→20
const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");

function slice(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error("切不出来：" + from);
  return html.slice(a, b);
}

const harness = `
let JIUCAI = { items: {} };
let AH = { qivPost: null, qiv: null, fut: null, at: 0, src: "" };
let AUTO = { items: {} };
let state = { last: {} };
function num(v){ if(v===null||v===undefined||v==="") return null; const n=+v; return Number.isFinite(n)?n:null; }
function txCode(c){ return c; }
${slice("function jcCoef", "function calc1")}
${slice("function effPct", "function remember")}
${slice("function jiucaiDate", "function minPctOf")}
${slice("function minPctOf", "function remember")}
module.exports = {
  jcCoef, calcJC, minPctOf, effPct, jiucaiDate,
  setJiucai: j => { JIUCAI = { items: j }; },
};
`;

fs.writeFileSync("_jc_test.js", harness);
const m = require(require("path").resolve("_jc_test.js"));

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

// 系数档位
check("分位 25 → 系数 0", m.jcCoef(25), 0);
check("分位 20 → 系数 0（边界）", m.jcCoef(20), 0);
check("分位 19.9 → 系数 5", m.jcCoef(19.9), 5);
check("分位 10 → 系数 5（边界）", m.jcCoef(10), 5);
check("分位 9.9 → 系数 10", m.jcCoef(9.9), 10);
check("分位 5 → 系数 10（边界）", m.jcCoef(5), 10);
check("分位 4.9 → 系数 20", m.jcCoef(4.9), 20);
check("分位 0 → 系数 20", m.jcCoef(0), 20);
check("分位 null → 系数 0", m.jcCoef(null), 0);

// 实际数据：纳斯达克100 分位 18.86 → (20-18.86)*5 = 5.7
m.setJiucai({ "NDX.GI": { name: "纳斯达克100", pe_pct: 18.86, pb_pct: 96.67, date: "2026-11-17" } });
let it = { code: "NDX", jc: "NDX.GI", name: "纳斯达克100", min: "" };
check("韭圈儿能读到分位", m.minPctOf(it), 18.86);
check("韭圈儿日期", m.jiucaiDate(it), "2026-11-17");
let r = m.calcJC(it);
check("纳斯达克100 金额 = 5.7", [r.pct, r.coef, r.amount], [18.86, 5, 5.7]);

// 手填覆盖韭圈儿
it = { code: "NDX", jc: "NDX.GI", min: "8" };
r = m.calcJC(it);
check("手填 8 → 系数 10 → (20-8)*10=120", [r.pct, r.coef, r.amount], [8, 10, 120]);

// 分位 ≥20
it = { code: "NDX", jc: "NDX.GI", min: "25" };
r = m.calcJC(it);
check("分位 25 → 不投", [r.coef, r.amount, r.tag], [0, 0, "off"]);

// 无分位
m.setJiucai({});
it = { code: "NDX", jc: "NDX.GI", min: "" };
r = m.calcJC(it);
check("无分位 → 未填分位", [r.pct, r.amount, r.text], [null, 0, "未填分位"]);

console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
process.exit(bad ? 1 : 0);
