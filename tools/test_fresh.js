// 手填值「新鲜度」测试：以最近一次收盘为界，覆盖交易日盘中/盘后、周末、周一开盘前等场景
const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");

function slice(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error("切不出来：" + from);
  return html.slice(a, b);
}

const harness = `
let quotes = {};
let AUTO = { updated: "", items: {} };
function txCode(c){ return c; }
function ymd(d){ return ""+d.getFullYear()+String(d.getMonth()+1).padStart(2,"0")+String(d.getDate()).padStart(2,"0"); }
${slice("function closeMs", "function fillFresh")}
${slice("function latestTradingDay", "function pctBadge")}
module.exports = {
  setQuotes: q => { quotes = q; },
  setAuto: a => { AUTO = a; },
  fillBoundaryMs, pctFresh, ymd, closeMs, autoYmdOf, latestTradingDay,
};
`;

fs.writeFileSync("_fresh_test.js", harness);
const m = require(require("path").resolve("_fresh_test.js"));

// 2026-11-13 是周五，11-14 周六，11-16 周一
const FRI = new Date(2026, 10, 13);
if (FRI.getDay() !== 5) { console.log("❌ 测试日历错：11-13 不是周五"); process.exit(1); }
const at = (d, h, mi) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi || 0);
const THU = new Date(2026, 10, 12), SAT = new Date(2026, 10, 14), MON = new Date(2026, 10, 16);
const WED = new Date(2026, 10, 11);

let bad = 0;
function check(name, got, want) {
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}`);
}

// 场景1：周五盘中 13:00（quotes=今天）→ 界限 = 周四 15:00
m.setQuotes({ a: { date: "20261113" }, b: { date: "20261113" } });
check("周五盘中：界限=周四15:00", m.fillBoundaryMs(at(FRI, 13, 0)), m.closeMs("20261112"));
const it1 = { min: "0.33", minAt: at(WED, 10, 0).getTime() };   // 周三上午填的 → 周五已过期
const it2 = { min: "0.33", minAt: at(THU, 16, 0).getTime() };   // 周四收盘后填的 → 新鲜
const it3 = { min: "0.33", minAt: at(FRI, 9, 0).getTime() };    // 周五早上填的 → 新鲜
check("周五盘中：周三填 → 过期", m.pctFresh(it1, at(FRI, 13, 0)), false);
check("周五盘中：周四16点填 → 新鲜", m.pctFresh(it2, at(FRI, 13, 0)), true);
check("周五盘中：周五9点填 → 新鲜", m.pctFresh(it3, at(FRI, 13, 0)), true);

// 场景2：周五盘后 16:00 → 界限 = 周五 15:00（下一个交易日要用新数据）
check("周五盘后：界限=周五15:00", m.fillBoundaryMs(at(FRI, 16, 0)), m.closeMs("20261113"));
check("周五盘后：周五14点填 → 过期", m.pctFresh({ min: "0.33", minAt: at(FRI, 14, 0).getTime() }, at(FRI, 16, 0)), false);
check("周五盘后：周五16:10填 → 新鲜", m.pctFresh({ min: "0.33", minAt: at(FRI, 16, 10).getTime() }, at(FRI, 16, 0)), true);

// 场景3：周六 10:00（quotes 最新=周五）→ 界限 = 周五 15:00
m.setQuotes({ a: { date: "20261113" } });
check("周六：界限=周五15:00", m.fillBoundaryMs(at(SAT, 10, 0)), m.closeMs("20261113"));
check("周六：周六10点填 → 新鲜", m.pctFresh({ min: "0.33", minAt: at(SAT, 10, 0).getTime() }, at(SAT, 10, 0)), true);
check("周六：周五9点填（覆盖周五）→ 过期", m.pctFresh({ min: "0.33", minAt: at(FRI, 9, 0).getTime() }, at(SAT, 10, 0)), false);

// 场景4：周一盘中 10:00（quotes=今天周一）→ 界限 = 周五 15:00
m.setQuotes({ a: { date: "20261116" } });
check("周一盘中：界限=周五15:00", m.fillBoundaryMs(at(MON, 10, 0)), m.closeMs("20261113"));
check("周一盘中：周日20点填 → 新鲜", m.pctFresh({ min: "0.33", minAt: at(SAT, 20, 0).getTime() }, at(MON, 10, 0)), true);
check("周一盘中：周五14点填 → 过期", m.pctFresh({ min: "0.33", minAt: at(FRI, 14, 0).getTime() }, at(MON, 10, 0)), false);

// 场景5：旧格式（只有日期字符串）→ 当天 0 点，视为过期
m.setQuotes({ a: { date: "20261113" } });
check("周六：旧格式 11-13（0点）→ 过期", m.pctFresh({ min: "0.33", minAt: "2026-11-13" }, at(SAT, 10, 0)), false);

// 场景6：手填涨跌 mpctAt 也能判定新鲜度
check("周六：mpctAt 周六9点 → 新鲜", m.pctFresh({ min: "0.33", mpctAt: at(SAT, 9, 0).getTime() }, at(SAT, 10, 0)), true);

// 场景7：没填过 → 不新鲜
check("没填过 → 不新鲜（待填）", m.pctFresh({ min: "" }), false);

// 场景8：蛋卷自动分位的新鲜度（数据日期 vs 最近交易日）
m.setQuotes({ a: { date: "20261113" } });                       // 周六，最近交易日=周五
m.setAuto({ items: { "399997": { date: "2026-11-13", pe_pct: 26.16 } } });
check("周六：蛋卷已更新到周五 → 新鲜", m.pctFresh({ code: "399997", min: "" }), true);
m.setAuto({ items: { "399997": { date: "2026-11-12" } } });
check("周六：蛋卷停在周四 → 过期（待填）", m.pctFresh({ min: "" }), false);
m.setQuotes({ a: { date: "20261116" } });                       // 周一盘中
m.setAuto({ items: { "399997": { date: "2026-11-13" } } });
check("周一盘中：蛋卷还是周五 → 过期（15:35 后才有周一的）", m.pctFresh({ min: "" }), false);
m.setAuto({ items: { "399997": { date: "2026-11-16" } } });
check("周一盘中：蛋卷已更新到周一 → 新鲜", m.pctFresh({ code: "399997", min: "" }), true);

console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
process.exit(bad ? 1 : 0);
