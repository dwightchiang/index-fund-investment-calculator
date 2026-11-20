// 验证 header 优先逻辑：header 与 table 不一致时，采用 header（顶部那份，更新更快）
const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");
const a = html.indexOf("async function fetchJiucaiLive");
const b = html.indexOf("async function loadJiucai");
const src = html.slice(a, b);

const harness = `
// 用最简单的 fetch 包装替换 fetchWithTimeout（测试里不需要超时逻辑）
function fetchWithTimeout(url){
  return fetch(url);
}
const JC_API = "x";
${src}
module.exports = { fetchJiucaiLive };
`;
fs.writeFileSync("_jc_live_test.js", harness);

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

// 场景1：header 新（16.16），table 旧（15.61）—— 这正是「10点刚更新」时的状态
global.fetch = async () => ({
  ok: true, status: 200,
  json: async () => ({
    header: { name: "纳斯达克100", value: 25.68, percent: 16.16, level_desc: "较低" },
    table: [ { name:"市盈率", latest:25.55, percent:15.61, avg:31 },
             { name:"市净率", latest:9.92, percent:94.61 } ],
    update_time: "2026-11-19",
  }),
});

const m = require(require("path").resolve("_jc_live_test.js"));

(async () => {
  try {
    const r = await m.fetchJiucaiLive("NDX.GI");
    console.log("拿到:", JSON.stringify({ pe:r.pe, pct:r.pe_pct, date:r.date }));
    check("① 分位采用 header 的 16.16（不是 table 的 15.61）", r.pe_pct, 16.16);
    check("② PE 采用 header 的 25.68", r.pe, 25.68);

    // 场景2：header 缺失 → 退回 table
    global.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({
        header: {},
        table: [ { name:"市盈率", latest:25.55, percent:15.61, avg:31 } ],
        update_time: "2026-11-18",
      }),
    });
    const r2 = await m.fetchJiucaiLive("NDX.GI");
    check("③ header 缺失 → 用 table 的 15.61", r2.pe_pct, 15.61);

    console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
    process.exit(bad ? 1 : 0);
  } catch (e) {
    console.log("❌ 异常:", e.message);
    process.exit(1);
  } finally {
    try { fs.unlinkSync("_jc_live_test.js"); } catch (e) {}
  }
})();
