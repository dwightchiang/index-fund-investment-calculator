/**
 * Cloudflare Worker：定投页面的行情代理
 *
 * 作用：由 Cloudflare 的服务器去拉腾讯/东财/同花顺，再把 JSON 返回给浏览器，
 *      绕开浏览器的跨域限制（CORS / Referer），手机上也能用。
 *
 * 部署（不用命令行，5 分钟）：
 *   1. 打开 https://dash.cloudflare.com/ → Workers & Pages → Create → Worker
 *   2. 把本文件内容整个粘进去，Deploy
 *   3. 记下地址，例如 https://dca-quote.你的账号.workers.dev
 *   4. 页面上 设置 → 行情代理地址 填：
 *        https://dca-quote.你的账号.workers.dev/quote
 *      点「保存代理」，再刷新即可
 *
 * 接口：GET /quote?code=931139  →  {price, prev, pct, date, src}
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

const HELP_HTML = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>行情代理 · 自检</title>
<style>body{background:#0f172a;color:#e2e8f0;font:15px/1.6 -apple-system,"PingFang SC",sans-serif;padding:20px;max-width:640px;margin:0 auto}
code{background:#1e293b;padding:2px 6px;border-radius:4px;font-size:13px}
pre{background:#0b1220;border:1px solid #334155;border-radius:8px;padding:12px;overflow:auto;font-size:13px;white-space:pre-wrap}
.ok{color:#22c55e}.bad{color:#ef4444}</style></head><body>
<h2>这是「行情代理接口」，不是网页</h2>
<p>它的作用是替浏览器去拉行情。请把下面这个地址填到定投页面的
<b>设置 → 行情代理地址</b>：</p>
<pre id="fill">加载中…</pre>
<p><button onclick="t()" style="padding:8px 14px;border-radius:8px;border:1px solid #334155;background:#243044;color:#e2e8f0">测一下</button></p>
<pre id="out">测试中…</pre>
<script>
document.getElementById('fill').textContent = location.origin + '/quote';
async function t(){
  const o=document.getElementById('out'); o.textContent='请求中…';
  try{
    const r=await fetch('/quote?code=931139'); const j=await r.json();
    o.innerHTML = (j.price ? '<span class="ok">✅ 接口正常</span>\\n' : '<span class="bad">❌ 返回异常</span>\\n')
      + JSON.stringify(j,null,2);
  }catch(e){ o.innerHTML='<span class="bad">❌ '+e.message+'</span>'; }
}
t();
</script></body></html>`;

/* 给上游 URL 加一个每次都不同的参数：防止 Cloudflare 边缘 / 上游 CDN 把行情缓存住
   （之前 H11136 就是这样被冻在 11:29 的价，页面显示 4.28%，直连却是 4.23%） */
function bust(url) {
  return url + (url.includes("?") ? "&" : "?") + "_=" + Date.now() + Math.floor(Math.random() * 1000);
}

/* 每个上游都限时：CF 出口连雪球会挂住，不限时整个 /quote 能拖到 85 秒 */
async function fetchText(url, referer, extra, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms || 4500);
  try {
    const r = await fetch(bust(url), {
      headers: {
        "User-Agent": UA,
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        ...(referer ? { Referer: referer } : {}),
        ...(extra || {}),
      },
      signal: ctl.signal,
      cf: { cacheTtl: 0, cacheEverything: false },
    });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r;
  } catch (e) {
    throw new Error(e && e.name === "AbortError" ? "超时" : e.message || String(e));
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- 雪球（中证 93xxxx / 华证 Hxxxx / 恒生 / 美股都在这里） ---------- */
let XQ_COOKIE = "";
const HS_MAP = { HS2083: "HKHSTECH", HSIII: "HKHSIII", HSI: "HKHSI",
                 HSTECH: "HKHSTECH", HSCEI: "HKHSCEI", HSTI: "HKHSTECH" };

function xqSymbol(code) {
  const c = code.toUpperCase();
  if (HS_MAP[c]) return HS_MAP[c];
  if (/^\d{6}$/.test(c)) {
    if (/^(93|95)/.test(c) || c.startsWith("005")) return "CSI" + c;
    return (c[0] === "0" || c[0] === "5" ? "SH" : "SZ") + c;
  }
  if (/^H\d{5}$/.test(c)) return "CSI" + c;
  if (/^[A-Z]{1,6}$/.test(c)) return c;
  return null;
}

/* 雪球 cookie：拿不到就记冷却，5 分钟内不再尝试。
   否则每个代码都要白等 1–3 秒去连 xueqiu.com，把整个 /quote 拖到 5–10 秒，
   前端超时后全变成「无行情」。 */
let XQ_COOKIE_DEAD = 0;
async function xqCookie() {
  if (XQ_COOKIE) return XQ_COOKIE;
  if (XQ_COOKIE_DEAD > Date.now()) return "";        // 冷却中，直接放弃雪球
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2500);
    try {
      const r = await fetch("https://xueqiu.com/", {
        headers: {
          "User-Agent": UA,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "zh-CN,zh;q=0.9",
          "Referer": "https://xueqiu.com/",
        },
        signal: ctl.signal,
        cf: { cacheTtl: 0 },
      });
      const list = typeof r.headers.getSetCookie === "function"
        ? r.headers.getSetCookie()
        : [r.headers.get("set-cookie") || ""];
      XQ_COOKIE = list.map((c) => String(c).split(";")[0]).filter(Boolean).join("; ");
    } finally { clearTimeout(timer); }
  } catch (e) { /* 忽略 */ }
  if (!XQ_COOKIE) XQ_COOKIE_DEAD = Date.now() + 5 * 60 * 1000;
  return XQ_COOKIE;
}

async function xq(code) {
  const sym = xqSymbol(code);
  if (!sym) return null;
  const cookie = await xqCookie();
  if (!cookie) throw new Error("雪球 cookie 拿不到");
  const r = await fetchText(
    `https://stock.xueqiu.com/v5/stock/quote.json?symbol=${sym}&extend=detail`,
    "https://xueqiu.com/",
    { Cookie: cookie, Accept: "application/json" },
    4000
  );
  const q = ((await r.json()).data || {}).quote || {};
  if (!q.current) return null;
  const ts = q.timestamp ? Math.floor(q.timestamp / 1000) : 0;
  let date = "";
  if (ts) {
    const d = new Date(ts * 1000 + 8 * 3600 * 1000);   // 北京时间
    date = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  return { price: +q.current, prev: 0, pct: +(q.percent || 0), date, ts, src: "雪球" };
}

/* 腾讯：v_sh000300="51~名称~代码~现价~昨收~..." */
async function tx(code) {
  const r = await fetchText("https://qt.gtimg.cn/q=" + code);
  const buf = await r.arrayBuffer();
  const txt = new TextDecoder("gbk").decode(buf);
  const m = txt.match(/="([^"]*)"/);
  if (!m) return null;
  const f = m[1].split("~");
  const price = +f[3], prev = +f[4];
  if (!(price > 0) || !(prev > 0)) return null;
  return { price, prev, pct: (price / prev - 1) * 100, date: (f[30] || "").slice(0, 8),
           ts: tsOf(f[30]), src: "腾讯" };
}

/* 20261105122900 → epoch 秒 */
function tsOf(s) {
  const t = String(s || "");
  if (t.length < 14) return 0;
  const ms = Date.parse(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}:${t.slice(12, 14)}+08:00`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/* 东财 ulist：中证 93xxxx / 华证 Hxxxx 走市场号 2，国证 98xxxx 走 0.
   镜像「短期内别再试」的时间要短：东财经常是一次慢/一次通，
   之前设 10 分钟，三个镜像被打进黑名单后整个 /quote 只能 404。 */
const EM_DEAD = {};
const EM_DEAD_MS = 45 * 1000;          // 45 秒后重新尝试该镜像
function emDead(h) { return EM_DEAD[h] && EM_DEAD[h] > Date.now(); }
function emMarkDead(h) { EM_DEAD[h] = Date.now() + EM_DEAD_MS; }
function emRevive(h) { delete EM_DEAD[h]; }

async function em(secid, force) {
  const hosts = ["push2.eastmoney.com", "82.push2.eastmoney.com", "push2delay.eastmoney.com"];
  let lastErr = null;
  for (const h of hosts) {
    if (!force && emDead(h)) { lastErr = h + " 冷却中"; continue; }
    try {
      const r = await fetchText(
        `https://${h}/api/qt/ulist.np/get?secids=${secid}&fields=f2,f3,f12,f13,f14,f18,f124&fltt=2&invt=2`,
        "https://quote.eastmoney.com/",
        null,
        6000
      );
      const js = await r.json();
      const it = ((js.data || {}).diff || [])[0];
      if (!it || !(it.f2 > 0)) { lastErr = h + " 无数据"; continue; }
      emRevive(h);                    // 成功一次就解除该镜像的冷却
      return {
        price: +it.f2, prev: +(it.f18 || 0), pct: +(it.f3 || 0), date: "",
        ts: it.f124 ? +it.f124 : 0,
        src: h === "push2delay.eastmoney.com" ? "东财(延迟)" : "东财",
      };
    } catch (e) {
      lastErr = h + " " + e.message;
      if (!force) emMarkDead(h);      // force 模式不记黑名单
    }
  }
  if (lastErr) throw new Error(lastErr);
  return null;
}

/* 同花顺 JSONP：quotebridge_v6_line_<prefix>_<code>_01_today({...}) */
async function ths(code) {
  for (const pre of ["zs", "bk"]) {
    try {
      const t = await (await fetchText(`https://d.10jqka.com.cn/v6/line/${pre}_${code}/01/today.js`,
        "https://q.10jqka.com.cn/", null, 3000)).text();
      const m = t.match(/\((\{.*\})\)/s);
      if (!m) continue;
      const node = JSON.parse(m[1])[`${pre}_${code}`];
      if (!node) continue;
      const price = +node["11"], day = String(node["1"] || "");
      if (!(price > 0)) continue;

      const t2 = await (await fetchText(`https://d.10jqka.com.cn/v6/line/${pre}_${code}/01/last.js`,
        "https://q.10jqka.com.cn/", null, 3000)).text();
      const m2 = t2.match(/\((\{.*\})\)/s);
      if (!m2) continue;
      const rows = String(JSON.parse(m2[1]).data || "").split(";");
      let prev = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        const f = rows[i].split(",");
        if (f.length >= 5 && f[0] < day) { prev = +f[4]; break; }
      }
      if (!(prev > 0)) continue;
      return { price, prev, pct: (price / prev - 1) * 100, date: day, src: "同花顺" };
    } catch (e) {
      /* 换前缀 */
    }
  }
  return null;
}

async function resolve(code) {
  const c = String(code || "").trim().toUpperCase();
  const tries = [];
  const csi = /^\d{6}$/.test(c) && (/^(93|95)/.test(c) || c.startsWith("005"));
  const huazheng = /^H\d{5}$/.test(c);
  const dig6 = /^\d{6}$/.test(c);

  if (/^\d{6}$/.test(c)) {
    if (/^[0135]/.test(c)) tries.push(() => tx((c[0] === "0" || c[0] === "5" ? "sh" : "sz") + c));
    if (/^98/.test(c)) tries.push(() => tx("sz" + c));
  }
  // 中证/华证：东财优先（CF 上一般 1–3 秒），雪球必须作为兜底——
  // 之前东财全挂时直接 404，其实雪球能拿到
  if (csi || huazheng) {
    tries.push(() => em("2." + c));
    tries.push(() => xq(c));
    tries.push(() => em("1." + c));      // 部分中证指数在沪市 1.
  } else if (dig6 && c.startsWith("98")) {
    // 国证 98xxxx：雪球没有（CSI980138 实测为空），只能靠东财深市 0.
    // 东财镜像可能都被冷却，这里用「强制重试」绕过一次冷却，避免整段返回 404
    tries.push(() => em("0." + c, true));
    tries.push(() => em("2." + c, true));
  } else if (c.startsWith("HS")) {
    tries.push(() => xq(c));
    tries.push(() => em("100." + c));
  } else if (/^[A-Z]{1,6}$/.test(c)) {
    tries.push(() => xq(c));
    tries.push(() => tx("us" + c));
    tries.push(() => em("105." + c));
  } else {
    tries.push(() => xq(c));
  }
  tries.push(() => ths(c));

  for (const fn of tries) {
    try {
      const got = await fn();
      if (got) return got;
    } catch (e) { /* 继续 */ }
  }
  return null;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";   // 容忍结尾斜杠
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "CDN-Cache-Control": "no-store",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    // 根路径给一个自检页，避免“打开是空白/报错”的困惑
    if (path === "/") {
      return new Response(HELP_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8", ...cors },
      });
    }

    if (path === "/ping") {
      return new Response(JSON.stringify({ ok: true, v: "2026-11-23", quote: "/quote?code=399997",
                                           batch: "/quotes?codes=399997,931139",
                                           dbg: "/dbg?code=H11136",
                                           qiv: "/qiv" }), {
        headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
      });
    }

    /* ---------- QIV：纳斯达克100 盘后指标 ----------
       官方站没有 CORS，浏览器直连拿不到，必须走这里。
       页面 HTML 里直接带现成的值：
         data-current-value="26,735.49"      ← QIV 指数值（含盘后）
         data-numerical-change="1,706.51"    ← 相对前一日收盘的当日涨跌（点数）
         id="pctChange" > 0.00%              ← ★ 这个字段是假的，恒为 0，别用
         DATA AS OF 11/23/2026

       用法：盘后涨跌 = qiv / NDX当日收盘 − 1
       （因为 QIV − change = 前一日收盘，QIV 本身就是含盘后的当日指数值） */
    if (path === "/qiv") {
      const t0 = Date.now();
      try {
        const r = await fetch("https://indexes.nasdaqomx.com/Index/Overview/QIV", {
          headers: { "User-Agent": UA, "Accept": "text/html" },
          cf: { cacheTtl: 60, cacheEverything: true },
        });
        if (!r.ok) throw new Error("qiv-http-" + r.status);
        const html = await r.text();
        const cur = html.match(/data-current-value="([\d,.]+)"/);
        const chg = html.match(/data-numerical-change="(-?[\d,.]+)"/);
        const pct = html.match(/id="pctChange"[\s\S]{0,200}?>\s*([-+]?[\d.]+)%/);
        const dt = html.match(/DATA AS OF\s*([\d/]+)/);
        if (!cur) throw new Error("qiv-parse");
        const num = (s) => (s === undefined || s === null) ? null : Number(String(s).replace(/,/g, ""));
        const out = {
          qiv: num(cur[1]),                 // ★ 主力字段：指数值（含盘后）
          change: chg ? num(chg[1]) : null, // 相对前一日收盘的涨跌点数
          pct: pct ? Number(pct[1]) : null, // 已知不可靠（常为 0），仅保留
          date: dt ? dt[1] : "",
          ms: Date.now() - t0,
        };
        return new Response(JSON.stringify(out), {
          headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e.message || e), ms: Date.now() - t0 }), {
          status: 502,
          headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
        });
      }
    }

    // 逐个数据源单独试，看谁给了什么价（排查"两个客户端数据不一样"用）
    if (path === "/dbg") {
      const c = (url.searchParams.get("code") || "").toUpperCase();
      const emSecids = [/^H\d{5}$/.test(c) || /^(93|95)/.test(c) || c.startsWith("005")
                        ? "2." + c
                        : (c.startsWith("98") ? "0." + c : c)];
      const cands = [
        ["腾讯", () => tx((c[0] === "0" || c[0] === "5" ? "sh" : "sz") + c)],
        ["雪球", () => xq(c)],
        ["东财", () => em(emSecids[0])],
        ["同花顺", () => ths(c)],
      ];
      const rows = [];
      for (const [name, fn] of cands) {
        const t = Date.now();
        try {
          const r = await fn();
          rows.push(r ? { src: name, ok: true, ...r, ms: Date.now() - t }
                      : { src: name, ok: false, err: "无数据", ms: Date.now() - t });
        } catch (e) {
          rows.push({ src: name, ok: false, err: String(e.message || e), ms: Date.now() - t });
        }
      }
      return new Response(JSON.stringify({
        code: c,
        now: Math.floor(Date.now() / 1000),
        emSecid: emSecids[0],
        emDead: Object.keys(EM_DEAD).filter(emDead),
        rows,
      }, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
      });
    }

    if (path === "/quotes") {
      const codes = (url.searchParams.get("codes") || "").split(",").map((s) => s.trim()).filter(Boolean);
      const items = {};
      const queue = [...codes];
      const deadline = Date.now() + 18000;       // 18 秒还不完就先返回，别把页面拖死
      const run = async () => {
        while (queue.length) {
          const c = queue.shift().toUpperCase();
          if (Date.now() > deadline) { items[c] = { error: "超时" }; continue; }
          try {
            items[c] = (await resolve(c)) || { error: "取不到" };
          } catch (e) { items[c] = { error: "取不到" }; }
        }
      };
      // 并发 4：东财能扛，雪球并发高了才拒绝
      await Promise.all(Array.from({ length: Math.min(4, codes.length || 1) }, run));
      return new Response(JSON.stringify({ items, now: Math.floor(Date.now() / 1000) }), {
        headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
      });
    }

    const code = url.searchParams.get("code");
    if (!code) {
      return new Response(JSON.stringify({ error: "缺少 code" }), {
        status: 400, headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
      });
    }
    const got = await resolve(code);
    const body = got ? JSON.stringify({ ...got, code, now: Math.floor(Date.now() / 1000) })
                     : JSON.stringify({ error: code + " 取不到" });
    return new Response(body, {
      status: got ? 200 : 404,
      headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
    });
  },
};
