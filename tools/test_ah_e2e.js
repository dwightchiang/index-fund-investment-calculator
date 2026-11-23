// 端到端：loadScriptText 能不能读到腾讯 v_usQQQ 和新浪 hq_str_hf_NQ
// 用假 DOM 模拟「script 加载后给 window 赋值」的行为
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("index.html", "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

class El {
  constructor(tag = "DIV") {
    this.tagName = tag; this.value = ""; this.textContent = ""; this.innerHTML = "";
    this.dataset = {}; this.style = {};
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  addEventListener() {} appendChild() {} remove() {} closest() { return null; }
  querySelector() { return null; } querySelectorAll() { return []; }
  setAttribute() {} getAttribute() { return null; } focus() {} click() {}
  showModal() {} close() {}
  getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; }
}

// 真实数据（今天 2026-11-23 23:15 抓到的）
const QQQ_BODY = "200~纳指100ETF-Invesco~QQQ.OQ~651.53~608.45~655.98~22403341~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~~2026-11-23 10:15:19";
const NQ_BODY = "26906.375,,26879.750,26880.750,27137.000,25426.750,23:15:38,25126.500,25561.500,0,1,1,2026-11-23,纳斯达克指数期货,0";

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

const cache = new Map(), store = new Map();
const sandbox = {
  console,
  document: {
    querySelector(s) { if (!cache.has(s)) cache.set(s, new El()); return cache.get(s); },
    querySelectorAll() { return []; },
    createElement(t) { return new El(t.toUpperCase()); },
    addEventListener() {}, get activeElement() { return null; }, visibilityState: "visible",
    // ★ 关键：appendChild 时模拟脚本执行 —— 给 window 挂变量后再触发 onload
    head: {
      appendChild(script) {
        const src = String(script.src || "");
        setTimeout(() => {
          if (src.includes("usQQQ")) sandbox.window["v_usQQQ"] = QQQ_BODY;
          if (src.includes("hf_NQ")) sandbox.window["hq_str_hf_NQ"] = NQ_BODY;
          if (typeof script.onload === "function") script.onload();
        }, 5);
      }
    },
    body: new El("BODY"),
  },
  window: { addEventListener() {} },
  location: { pathname: "/index.html", hash: "", hostname: "127.0.0.1", origin: "http://127.0.0.1" },
  navigator: { clipboard: { writeText: async () => {} }, userAgent: "node" },
  localStorage: { getItem: k => store.has(k) ? store.get(k) : null,
                  setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
  fetch: () => Promise.reject(new Error("offline")),
  setTimeout, clearTimeout, setInterval, clearInterval,
  alert: () => {}, confirm: () => true, prompt: () => null,
  Request, Response, Headers, URL, TextEncoder, TextDecoder, AbortController,
  btoa: s => Buffer.from(s, "binary").toString("base64"),
  atob: s => Buffer.from(s, "base64").toString("binary"),
};
sandbox.window = Object.assign({ addEventListener() {} }, sandbox);
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "inline" });

setTimeout(async () => {
  try {
    // ---- 造 QQ.qqq / 期货 的原始文本（正常文本格式，用于存排名）----
    // 1) 腾讯 v_usQQQ
    const txt1 = await vm.runInContext(
      `loadScriptText("https://qt.gtimg.cn/q=usQQQ", 5000, "gbk", "v_usQQQ")`, sandbox);
    check("① 能读到腾讯 v_usQQQ", txt1.startsWith('v_usQQQ="'), true);
    const m1 = /v_usQQQ="([^"]*)"/.exec(txt1);
    const p1 = m1 ? m1[1].split("~") : [];
    check("② 解析出收盘 651.53", parseFloat(p1[3]), 651.53);
    check("③ 盘后价是 0（美股盘中，正常）", parseFloat(p1[9]), 0);

    // 2) 新浪 hq_str_hf_NQ
    const txt2 = await vm.runInContext(
      `loadScriptText("https://hq.sinajs.cn/list=hf_NQ", 5000, "gbk")`, sandbox);
    check("④ 能读到新浪 hq_str_hf_NQ", txt2.includes("hq_str_hf_NQ="), true);
    const m2 = /hq_str_hf_NQ="([^"]*)"/.exec(txt2);
    const p2 = m2 ? m2[1].split(",") : [];
    check("⑤ 期货最新 26906.375", parseFloat(p2[0]), 26906.375);
    check("⑥ 期货昨结 25126.5", parseFloat(p2[7]), 25126.5);

    // 3) loadAfterHours 在只有期货可用时
    const r = await vm.runInContext(`
      (async function(){
        AH = { qivPost:null, qiv:null, qqqPost:null, fut:null, futRaw:null, at:0, src:"" };
        fetchNdxDailyPct = async () => ({ date:"2026-11-20", pct:-5.61, close:25028.98, prevClose:26517.05 });
        proxyUsable = () => false;
        localStorage.removeItem("dca-afterhours-cache");
        await loadAfterHours(true);
        return { fut:AH.fut, futRaw:AH.futRaw, futPost:AH.futPost,
                 qqqPost:AH.qqqPost, futSameDay:AH.futSameDay, futBaseMissing:AH.futBaseMissing };
      })()
    `, sandbox);
    console.log("   loadAfterHours 结果:", JSON.stringify(r));
    check("⑦ 期货原始涨跌算出来了", r.futRaw !== null && isFinite(r.futRaw), true);
    // 期货昨结是 11-23、NDX 是 11-20 → 不同交易日 → futPost 必须为 null（不能瞎减）
    check("⑧ 期货与 NDX 不同交易日 → futPost 为 null", r.futPost, null);
    check("⑨ 且标记了 futSameDay=false", r.futSameDay, false);
    // 15:00 基准：现在是 23:25，早已过 15:00 → 不该伪造基准（否则落地是 0%）
    check("⑩ 远离 15:00 → 不伪造基准，fut 为 null", r.fut, null);
    check("⑪ 并标记 futBaseMissing", r.futBaseMissing, true);

    console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
    process.exit(bad ? 1 : 0);
  } catch (e) {
    console.log("❌ 异常:", e.message, e.stack);
    process.exit(1);
  }
}, 900);
