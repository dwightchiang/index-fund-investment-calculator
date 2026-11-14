// 验证 proxyBase 能容忍各种填法
const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");
const a = html.indexOf("function proxyBase");
const b = html.indexOf("function proxyUsable", a);
const src = html.slice(a, b);

const harness = `
let state = { proxy: "" };
function setProxy(v){ state.proxy = v; }
${src}
module.exports = { proxyBase, proxyUrl, setProxy };
`;
fs.writeFileSync("_px_test.js", harness);
const m = require(require("path").resolve("_px_test.js"));

const cases = [
  ["https://abc.workers.dev/quote", "https://abc.workers.dev", "https://abc.workers.dev/quote"],
  ["https://abc.workers.dev/ping", "https://abc.workers.dev", "https://abc.workers.dev/quote"],
  ["https://abc.workers.dev/dbg/", "https://abc.workers.dev", "https://abc.workers.dev/quote"],
  ["https://abc.workers.dev/quotes", "https://abc.workers.dev", "https://abc.workers.dev/quote"],
  ["https://abc.workers.dev/", "https://abc.workers.dev", "https://abc.workers.dev/quote"],
  ["https://abc.workers.dev", "https://abc.workers.dev", "https://abc.workers.dev/quote"],
  ["abc.workers.dev/quote", "https://abc.workers.dev", "https://abc.workers.dev/quote"],
  ["http://192.168.2.167:8080/", "http://192.168.2.167:8080", "http://192.168.2.167:8080/quote"],
  ["", "", ""],
];

let bad = 0;
for (const [input, wantBase, wantUrl] of cases) {
  m.setProxy(input);
  const base = m.proxyBase(), url = m.proxyUrl();
  const ok = base === wantBase && url === wantUrl;
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} "${input}" → base=${base} url=${url}${ok ? "" : `  期望 ${wantBase} / ${wantUrl}`}`);
}
console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
process.exit(bad ? 1 : 0);
