// 从 index.html 里抠出「过期判断」相关函数，用 node 跑一遍边界情况
const fs = require("fs");
const path = "index.html";
const html = fs.readFileSync(path, "utf8");

const start = html.indexOf("const STALE_MS");
const end = html.indexOf("async function fetchViaProxyRaw");
if (start < 0 || end < 0) throw new Error("找不到代码段");
const src = html.slice(start, end);

const harness = `
let trading = true;
function tradingNow(){ return trading; }
const $ = () => null;
${src}
module.exports = { isStale, ageSecs, qTs, normQuote, setTrading: v => { trading = v; } };
`;
fs.writeFileSync("_stale_test.js", harness);
const m = require(require("path").resolve("_stale_test.js"));

const nowSec = Math.floor(Date.now() / 1000);
const cases = [
  ["刚拉的 5 秒前", nowSec - 5, 0, false],
  ["2 分钟前", nowSec - 120, 0, false],
  ["20 分钟前（Worker 那种）", nowSec - 1200, 0, true],
  ["没有时间戳", 0, 0, false],
  ["毫秒时间戳 20 分钟前", (nowSec - 1200) * 1000, 0, true],
  ["非交易时段 20 分钟前", nowSec - 1200, 0, false],
];
let bad = 0;
for (const [name, ts, srvNow, expect] of cases) {
  m.setTrading(name !== "非交易时段 20 分钟前");
  const got = m.isStale(ts, srvNow || undefined);
  const ok = got === expect;
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}：isStale=${got}（期望 ${expect}）  age=${m.ageSecs(ts, srvNow || undefined)}s`);
}

// normQuote 要能把 ts 归一化成毫秒
const q = m.normQuote({ price: 3654.1, prev: 3505.85, pct: 4.23, date: "20261105", ts: 1793854148, src: "东财" });
console.log(`\nnormQuote ts → ${q.ts}（应为 1793854148000，即毫秒）  ${q.ts === 1793854148000 ? "✅" : "❌"}`);
if (q.ts !== 1793854148000) bad++;

console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
process.exit(bad ? 1 : 0);
