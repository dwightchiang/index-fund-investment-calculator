// 回归测试：① 定投的计分/金额，特别是新增的「分位 5–10 也出金额、黄色标记」这一段
const fs = require("fs");
const html = fs.readFileSync("web/index.html", "utf8");

function slice(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error("切不出来：" + from + " → " + to);
  return html.slice(a, b);
}

const harness = `
const TRIGGER = 5, NEAR = 10;
let quotes = {};
const state = { last: {} };
const AUTO = { items: {} };
function num(v){ if(v===null||v===undefined||v==="") return null; const n=+v; return Number.isFinite(n)?n:null; }
function txCode(c){ return c; }
function fmt(v,d){ return v===null?"—":(+v).toFixed(d===undefined?2:d); }
${slice("function minPctOf", "function remember")}
${slice("function chgOf", "/* ---------- 计算")}
${slice("function calc1(it)", "function coefOf")}
${slice("/* 金额显示", "function dateLabel")}
module.exports = { calc1, amtView, setQuotes: q => { quotes = q; } };
`;

fs.writeFileSync("web/_near_test.js", harness);
const m = require(require("path").resolve("web/_near_test.js"));

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

// 用户举的例子：分位 5.6、跌 4% → (5-5.6+4)*10 = 34，黄色
m.setQuotes({ "399296": { price: 5000, pct: -4, date: "20260505", src: "腾讯" } });
let r = m.calc1({ id: 1, code: "399296", name: "创成长", min: 5.6, unit: 10 });
check("5.6 分位 + 跌4% → 34", [r.tag, r.amount], ["near", 34]);
check("5.6 分位金额显示为黄色", m.amtView(r), { txt: "¥34", cls: "near" });

r = m.calc1({ id: 2, code: "399296", name: "涨2%", min: 5.6, unit: 10 });
m.setQuotes({ "399296": { price: 5000, pct: 2, date: "20260505", src: "腾讯" } });
r = m.calc1({ id: 2, code: "399296", name: "涨2%", min: 5.6, unit: 10 });
check("5.6 分位 + 涨2% → 负值 -26", [r.tag, r.amount, r.text], ["near", -26, "临近·负值"]);
check("临近负值显示红色", m.amtView(r), { txt: "-¥26", cls: "neg" });

m.setQuotes({ "399296": { price: 5000, pct: -3, date: "20260505", src: "腾讯" } });
r = m.calc1({ id: 3, code: "399296", name: "5.0 边界", min: 5, unit: 10 });
check("分位正好 5.0 + 跌3% → 临近 30（<5 才算触发）", [r.tag, r.amount], ["near", 30]);

r = m.calc1({ id: 4, code: "399296", name: "4.99", min: 4.99, unit: 10 });
check("分位 4.99 + 跌3% → 绿色触发 30", [r.tag, r.amount], ["hit", 30]);

m.setQuotes({ "399296": { price: 5000, pct: 0, date: "20260505", src: "腾讯" } });
r = m.calc1({ id: 5, code: "399296", name: "9.99", min: 9.99, unit: 10 });
check("分位 9.99 平盘 → 临近 -50（一样算出来）", [r.tag, r.amount], ["near", -50]);

r = m.calc1({ id: 6, code: "399296", name: "10", min: 10, unit: 10 });
check("分位 10 → 不投、不显示金额", [r.tag, r.amount, m.amtView(r).txt], ["off", 0, "—"]);

r = m.calc1({ id: 7, code: "399296", name: "20", min: 20, unit: 10 });
check("分位 20 → 不投", [r.tag, m.amtView(r).txt], ["off", "—"]);

// 无行情：照旧「待填」
m.setQuotes({});
r = m.calc1({ id: 8, code: "005012", name: "无行情", min: 6.2, unit: 10 });
check("无行情 + 已填分位 → 待填", [r.tag, m.amtView(r).txt], ["na", "待填"]);

console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
process.exit(bad ? 1 : 0);
