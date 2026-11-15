// 回撤板块涨跌幅列：calc2 的 pct 取值优先级（手填 mpct2 > 行情）
const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");

function slice(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error("切不出来：" + from);
  return html.slice(a, b);
}

const harness = `
let quotes = {};
function num(v){ if(v===null||v===undefined||v==="") return null; const n=+v; return Number.isFinite(n)?n:null; }
function coefOf(dd){ return dd<20 ? 0 : 1 + 0.5*Math.floor((dd-20)/10); }
function fmt(v,d){ return v===null?"—":(+v).toFixed(d===undefined?2:d); }
${slice("function calc2", "/* ---------- 渲染")}
module.exports = { calc2, setQuotes: q => { quotes = q; } };
`;

fs.writeFileSync("_dd_test.js", harness);
const m = require(require("path").resolve("_dd_test.js"));

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

// 1) 有行情：用行情的涨跌
m.setQuotes({ "886042": { price: 2000, pct: -3.32, date: "20261114", src: "腾讯" } });
let r = m.calc2({ id: "a", code: "886042", high: 3716.55, unit: 1 });
check("有行情 → 用行情涨跌", [r.pct, r.manualPct], [-3.32, false]);
check("回撤与金额照算", [r.dd, r.coef, r.amount], [46.19, 2, 92]);

// 2) 手填 mpct2 优先于行情
r = m.calc2({ id: "a", code: "886042", high: 3716.55, unit: 1, mpct2: "-5.5" });
check("手填 mpct2 优先", [r.pct, r.manualPct], [-5.5, true]);

// 3) 无行情 + 手填涨跌
m.setQuotes({});
r = m.calc2({ id: "b", code: "980138", high: 2400, unit: 1, mpct2: "2.1" });
check("无行情但手填涨跌 → 有 pct", [r.pct, r.manualPct], [2.1, true]);
check("无行情时回撤为空", [r.tag, r.dd], ["na", null]);

// 4) 无行情无手填 → pct 为 null
r = m.calc2({ id: "c", code: "980138", high: 2400, unit: 1 });
check("都没有 → pct null", r.pct, null);

// 5) 未填最高点也要能显示涨跌
m.setQuotes({ "399975": { price: 700, pct: 0.5, date: "20261114", src: "腾讯" } });
r = m.calc2({ id: "d", code: "399975", high: "", unit: 1 });
check("未填最高点 → 仍带涨跌", [r.pct, r.text], [0.5, "未填最高点"]);

// 6) 涨跌为 0
m.setQuotes({ "399975": { price: 700, pct: 0, date: "20261114", src: "腾讯" } });
r = m.calc2({ id: "d", code: "399975", high: 1000, unit: 1 });
check("涨跌 0 正常显示", r.pct, 0);

console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
process.exit(bad ? 1 : 0);
