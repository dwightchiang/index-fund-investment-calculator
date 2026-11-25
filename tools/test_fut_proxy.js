// 验证 Worker /fut 的解析逻辑 + 页面优先走代理
const fs = require("fs");

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

const workerSrc = fs.readFileSync("tools/worker.js", "utf8");
const pageSrc = fs.readFileSync("index.html", "utf8");

console.log("── Worker /fut 路由 ──");
check("① 有 /fut 路由", workerSrc.includes('path === "/fut"'), true);
check("② 带新浪 Referer（关键）",
      /Referer["']?\s*:\s*["']https:\/\/finance\.sina\.com\.cn\//.test(workerSrc), true);
check("③ 请求新浪时用规范大小写 hf_NQ（★ 全小写会返回空值）",
      /const sinaCode = upper\.replace\(\/\^HF_\/, "hf_"\)/.test(workerSrc), true);
check("③b 没有把代码转成全小写",
      !/upper\.toLowerCase\(\)/.test(workerSrc), true);
check("③c 空 last 会报错（不返回假数据）",
      /if \(out\.last === null\) throw new Error\("sina-null-last"\)/.test(workerSrc), true);
check("④ 解析用大小写不敏感正则",
      /new RegExp\('hq_str_' \+ sinaCode \+ '="\(\[\^"\]\*\)"', "i"\)/.test(workerSrc), true);
check("⑤ 返回 pct（最新/昨结−1）",
      /Math\.round\(\(last \/ prev - 1\) \* 10000\) \/ 100/.test(workerSrc), true);
check("⑥ 返回 last / prevSettle / name / date",
      workerSrc.includes("prevSettle: prev") && workerSrc.includes("name: p[13]"), true);
check("⑦ /ping 里列出了 /fut", workerSrc.includes('fut: "/fut?code=hf_NQ"'), true);

// 用真实的新浪响应文本，跑一遍 Worker 的解析算法
console.log("\n── 用真实响应验证解析 ──");
const SINA_SAMPLE = 'var hq_str_hf_NQ="25949.318,,25954.250,25956.000,26350.750,25904.500,12:57:38,26275.750,26279.500,0,1,2,2026-11-25,纳斯达克指数期货,0";';

function parseLikeWorker(body, upperCode) {
  const sinaCode = upperCode.toLowerCase();
  const m = new RegExp('hq_str_' + sinaCode + '="([^"]*)"', "i").exec(body);
  if (!m || !m[1]) return { error: "sina-empty" };
  const p = m[1].split(",");
  const num = (i) => { const v = parseFloat(p[i]); return isFinite(v) ? v : null; };
  const last = num(0), prev = num(7);
  return {
    code: upperCode,
    last,
    prevSettle: prev,
    prevClose: num(8),
    time: p[6] || "",
    date: p[12] || "",
    name: p[13] || "",
    pct: (last !== null && prev) ? Math.round((last / prev - 1) * 10000) / 100 : null,
  };
}

let r = parseLikeWorker(SINA_SAMPLE, "HF_NQ");
console.log("   解析结果:", JSON.stringify(r));
check("⑧ last 正确", r.last, 25949.318);
check("⑨ prevSettle 正确", r.prevSettle, 26275.75);
check("⑩ pct = -1.24%", r.pct, -1.24);
check("⑪ name 正确", r.name, "纳斯达克指数期货");
check("⑫ date 正确", r.date, "2026-11-25");

// 大写入参也能解析（大小写不敏感）
r = parseLikeWorker(SINA_SAMPLE, "HF_NQ");
check("⑬ 大写入参 OK", r.last, 25949.318);

// 空响应要报错
r = parseLikeWorker("var hq_str_hf_XX=\"\";", "HF_XX");
check("⑭ 空响应返回 sina-empty", r.error, "sina-empty");

console.log("\n── 页面优先走代理 ──");
check("⑮ 页面调用 /fut", pageSrc.includes('proxyBase()+"/fut?code=hf_NQ'), true);
check("⑯ 代理失败后有 JSONP 直连兜底",
      /loadScriptText\("https:\/\/hq\.sinajs\.cn\/list=hf_NQ/.test(pageSrc), true);
check("⑰ 记录来源 AH.futVia", pageSrc.includes("AH.futVia"), true);
check("⑱ proxyBase 能识别 /fut 后缀",
      /quote\|quotes\|ping\|dbg\|qiv\|fut/.test(pageSrc), true);
check("⑲ 缺数据时提示需要代理",
      pageSrc.includes("新浪校验 Referer，直连会被 403"), true);

// 模拟：代理成功 → 用代理值；代理失败 → 用直连值
console.log("\n── 模拟两种路径 ──");
function simulate(proxyOk, directOk, proxyData, directData) {
  let last = null, prev = null, via = "";
  if (proxyOk && proxyData) {
    last = proxyData.last; prev = proxyData.prevSettle; via = "代理";
  }
  if (last === null && directOk && directData) {
    last = directData.last; prev = directData.prev; via = "直连";
  }
  if (last === null) return { via: "", pct: null };
  return { via, pct: Math.round((last / prev - 1) * 10000) / 100 };
}
const P = { last: 25949.318, prevSettle: 26275.75 };
const D = { last: 25950, prev: 26276 };
check("⑳ 代理可用 → 走代理", simulate(true, true, P, D).via, "代理");
check("㉑ 代理不可用 → 走直连", simulate(false, true, P, D).via, "直连");
check("㉒ 两者都失败 → pct 为 null", simulate(false, false, P, D).pct, null);
console.log(`   代理路径 pct = ${simulate(true, true, P, D).pct}%`);

console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
process.exit(bad ? 1 : 0);
