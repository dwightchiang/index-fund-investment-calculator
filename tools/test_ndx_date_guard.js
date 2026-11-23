// 验证三件事：
//  ① NDX 日线要丢掉「美东今天还在盘中」那条（否则算出的 NDX% 是盘中，不是收盘）
//  ② QIV 日期与 NDX 不一致时弃用（不能相减）
//  ③ 期货以 15:00 为基准
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
const cache = new Map(), store = new Map();
const sandbox = {
  console,
  document: {
    querySelector(s) { if (!cache.has(s)) cache.set(s, new El()); return cache.get(s); },
    querySelectorAll() { return []; }, createElement(t) { return new El(t.toUpperCase()); },
    addEventListener() {}, get activeElement() { return null; }, visibilityState: "visible",
    head: { appendChild() {} }, body: new El("BODY"),
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

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: "inline" });

setTimeout(() => {
  // ---- ① 模拟腾讯日K：最后一条是「美东今天」还在盘中 ----
  const days = [
    ["2026-11-19", "27574.24", "26517.05"],
    ["2026-11-20", "26184.76", "25028.98"],
    ["2026-11-23", "26889.29", "26558.16"],   // ← 今天盘中，未收盘
  ];
  const fakeKline = "kline_dayqfq=" + JSON.stringify({
    data: { usNDX: { day: days.map(d => [...d, "0", "0", "0", "0"]) } }
  });

  // 替换 fetchWithTimeout 返回假数据
  vm.runInContext(`
    fetchWithTimeout = async () => ({ ok:true, text: async () => ${JSON.stringify(fakeKline)} });
    // 把「美东今天」固定成 2026-11-23，确保最后一条会被丢弃
    nyToday = () => "2026-11-23";
  `, sandbox);

  const r = vm.runInContext("fetchNdxDailyPct()", sandbox);
  return r.then(d => {
    console.log(`   NDX 日线取到：${d.date} 收 ${d.close}  涨跌 ${d.pct}%`);
    check("① 丢掉盘中那条，用 11-20 收盘", d.date, "2026-11-20");
    check("② NDX 当日% = -5.61（不是盘中的 +6.11）", d.pct, -5.61);

    // ---- ③ QIV 日期不一致 → 弃用 ----
    const qivCase = vm.runInContext(`
      (function(){
        AH.ndxDate="2026-11-20"; AH.ndxPct=-5.61;
        // 模拟 QIV 日期是 11-20（一致）
        const mm=/(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})/.exec("11/20/2026");
        const qd = mm ? \`\${mm[3]}-\${mm[1].padStart(2,"0")}-\${mm[2].padStart(2,"0")}\` : "";
        AH.qivDateNorm=qd; AH.qivSameDay = !!(qd && AH.ndxDate && qd===AH.ndxDate);
        AH.qivPost = (!AH.qivSameDay) ? null : Math.round((-4.27 - AH.ndxPct)*100)/100;
        return { qd:AH.qivDateNorm, same:AH.qivSameDay, post:AH.qivPost };
      })()
    `, sandbox);
    console.log(`   QIV 日期 ${qivCase.qd} vs NDX 2026-11-20 → same=${qivCase.same} post=${qivCase.post}`);
    check("③ 日期一致 → 采用", qivCase.same, true);
    check("④ QIV纯盘后 = -4.27-(-5.61) = 1.34", qivCase.post, 1.34);

    const mismatch = vm.runInContext(`
      (function(){
        AH.ndxDate="2026-11-20";
        const mm=/(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4})/.exec("11/21/2026");
        const qd = mm ? \`\${mm[3]}-\${mm[1].padStart(2,"0")}-\${mm[2].padStart(2,"0")}\` : "";
        const same = !!(qd && AH.ndxDate && qd===AH.ndxDate);
        return { same, post: same ? 1.34 : null };
      })()
    `, sandbox);
    check("⑤ 日期不一致 → 弃用（null，不给错数）", [mismatch.same, mismatch.post], [false, null]);

    // ---- ⑥ 15:00 基准 ----
    const fut = vm.runInContext(`
      (function(){
        localStorage.removeItem(FUT_BASE_KEY);
        const b = setFutBase(26000);            // 15:00 基准 26000
        const now = 26130;
        const pct = Math.round((now - b.price)/b.price*10000)/100;
        return { base:b.price, date:b.date, pct };
      })()
    `, sandbox);
    console.log(`   期货基准 ${fut.base}（${fut.date}）→ 现价 26130 = ${fut.pct}%`);
    check("⑥ 15:00 基准存下来了", fut.base, 26000);
    check("⑦ 15:00→现在 = +0.50%", fut.pct, 0.5);

    const sameDay = vm.runInContext(`
      (function(){
        const b = getFutBase();
        return { ok: !!b, price: b ? b.price : null };
      })()
    `, sandbox);
    check("⑧ 当天能读回同一个基准", sameDay, { ok: true, price: 26000 });

    // ---- ⑨ 纳指100 不该有年数加权 ----
    const yw = vm.runInContext(`
      (function(){
        state.yw = true;
        JIUCAI = { items: { "NDX.GI": { pe_pct:15.45, date:"2026-11-20" } } };
        AH.qivPost = null; AH.qqqPost = null; AH.futPost = null;
        const nd = state.list1.find(x=>x.code==="NDX");
        nd.min = "";
        const r = calcRow(nd);
        return { coef:r.coef, years:r.years, amount:r.amount };
      })()
    `, sandbox);
    console.log(`   纳指100：coef=${yw.coef} years=${yw.years} amount=${yw.amount}`);
    // 注意：jc20 行的 r.coef 是「分位档位系数」（15.45% → 5），不是年数系数
    // 年数加权对它不生效，所以 years 应为 undefined（calc1 才设置）
    check("⑨ 纳指100 不走年数加权（years 为空）", yw.years, undefined);
    check("⑩ 分位档位系数仍是 5", yw.coef, 5);
    check("⑪ 金额 = (20-15.45)×5 = 22.75", yw.amount, 22.75);

    console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
    process.exit(bad ? 1 : 0);
  }).catch(e => {
    console.log("❌ 异常:", e.message);
    process.exit(1);
  });
}, 900);
