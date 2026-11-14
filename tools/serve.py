#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""本地一键跑：拉分位 + 起服务 + 提供 /api/quote 行情代理。

用法：
    python tools/serve.py                # 拉一次分位，然后开服务（默认 8080）
    python tools/serve.py --port 9000
    python tools/serve.py --no-fetch     # 不拉分位，只起服务
    python tools/serve.py --refresh-hours 3

为什么需要本地代理：
    浏览器直连东财/同花顺会被 CORS 或 Referer 策略拦掉（中证 93xxxx、华证 Hxxxx 只在东财有）。
    由本机 Python 去请求，就没有这些限制；页面调 /api/quote?code=931068 即可。
"""
from __future__ import annotations

import argparse
import concurrent.futures as _cf
import datetime as _dt
import functools
import http.server
import importlib.util
import json
import pathlib
import re
import socket
import sys
import threading
import time
from urllib.parse import parse_qs, urlparse

import requests

requests.packages.urllib3.disable_warnings()

# 行情缓存：同一个代码 60 秒内不重复请求
_CACHE: dict[str, tuple[float, dict | None]] = {}
_CACHE_LOCK = threading.Lock()
_CACHE_TTL = 180
_POOL = _cf.ThreadPoolExecutor(max_workers=8)
_as_completed = _cf.as_completed


def resolve_cached(code: str):
    now = time.time()
    with _CACHE_LOCK:
        hit = _CACHE.get(code)
        if hit and now - hit[0] < _CACHE_TTL:
            return hit[1]
    got = resolve(code)
    with _CACHE_LOCK:
        if got:
            _CACHE[code] = (now, got)      # 只缓存成功，失败不缓存，重试才有意义
        else:
            _CACHE.pop(code, None)
    return got

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
WEB = ROOT / "web"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120"}

sess = requests.Session()
sess.headers.update(UA)
sess.trust_env = False

XQ = requests.Session()
XQ.headers.update(UA)
XQ.trust_env = False
_xq_ready = False
HS_MAP = {"HS2083": "HKHSTECH", "HSIII": "HKHSIII", "HSI": "HKHSI",
          "HSTECH": "HKHSTECH", "HSCEI": "HKHSCEI", "HSTI": "HKHSTECH"}


def _xq_init():
    """雪球接口要带 cookie，先访问一次首页拿 token。"""
    global _xq_ready
    if _xq_ready:
        return
    try:
        XQ.get("https://xueqiu.com/", timeout=8, verify=False)
    except Exception:
        pass
    _xq_ready = True


def _xq_symbol(code: str):
    c = code.upper()
    if c in HS_MAP:
        return HS_MAP[c]
    if re.fullmatch(r"\d{6}", c):
        if c[:2] in ("93", "95") or c[:3] == "005":
            return "CSI" + c
        return ("SH" if c[0] in "05" else "SZ") + c
    if re.fullmatch(r"H\d{5}", c):
        return "CSI" + c
    if re.fullmatch(r"[A-Z]{1,6}", c):
        return c
    return None


def _xq_reset():
    global _xq_ready, XQ_COOKIE
    XQ.cookies.clear()
    _xq_ready = False


_XQ_SEM = threading.Semaphore(1)   # 雪球并发高了会被拒，串行 + 小间隔最稳


def _xq(code: str):
    """雪球：覆盖中证 93xxxx、华证 Hxxxx、恒生、美股 ETF，是这些代码最靠谱的源。"""
    sym = _xq_symbol(code)
    if not sym:
        return None
    url = f"https://stock.xueqiu.com/v5/stock/quote.json?symbol={sym}&extend=detail"
    for attempt in range(3):
        _xq_init()
        try:
            with _XQ_SEM:
                time.sleep(0.12)
                js = XQ.get(url, timeout=10, verify=False).json()
        except Exception:
            time.sleep(0.5 * (attempt + 1))
            continue
        q = ((js.get("data") or {}).get("quote")) or {}
        price, pct = q.get("current"), q.get("percent")
        if price:
            day = ""
            ts = q.get("timestamp")
            if ts:
                day = _dt.datetime.fromtimestamp(ts / 1000).strftime("%Y%m%d")
            return {"price": float(price), "prev": 0.0, "pct": float(pct or 0),
                    "date": day, "src": "雪球",
                    "ts": int(ts / 1000) if ts else 0}
        # 400016 之类：多是 cookie 失效，重置后重试
        _xq_reset()
        time.sleep(0.4 * (attempt + 1))
    return None


# ---------------------------------------------------------------- 行情
def _tx(code: str):
    prefix = "sh" if code[0] in "056" else "sz"
    r = sess.get(f"https://qt.gtimg.cn/q={prefix}{code}", timeout=6)
    r.encoding = "gbk"
    m = re.search(r'="([^"]*)"', r.text)
    if not m:
        return None
    f = m.group(1).split("~")
    if len(f) < 5:
        return None
    try:
        price, prev = float(f[3]), float(f[4])
    except ValueError:
        return None
    if price <= 0 or prev <= 0:
        return None
    return {"price": price, "prev": prev, "pct": (price / prev - 1) * 100,
            "date": (f[30][:8] if len(f) > 30 else ""), "src": "腾讯"}


def _qts(s: str) -> int:
    """保留：需要时把 20261105122900 转成 epoch 秒。"""
    try:
        return int(_dt.datetime.strptime(str(s)[:14], "%Y%m%d%H%M%S").timestamp())
    except Exception:
        return 0


def _em(secid: str):
    for host in ("push2.eastmoney.com", "82.push2.eastmoney.com", "push2delay.eastmoney.com"):
        try:
            u = (f"https://{host}/api/qt/ulist.np/get?secids={secid}"
                 "&fields=f2,f3,f12,f13,f14,f18&fltt=2&invt=2")
            r = sess.get(u, timeout=6, headers={"Referer": "https://quote.eastmoney.com/"})
            js = r.json()
            diff = ((js.get("data") or {}).get("diff")) or []
            if not diff:
                continue
            it = diff[0]
            if not it.get("f2"):
                continue
            return {"price": float(it["f2"]), "prev": float(it.get("f18") or 0),
                    "pct": float(it.get("f3") or 0), "date": "", "src": "东财"}
        except Exception:
            continue
    return None


def _ths(code: str):
    for pre in ("zs", "bk"):
        try:
            r = sess.get(f"https://d.10jqka.com.cn/v6/line/{pre}_{code}/01/today.js",
                         timeout=6, headers={"Referer": "https://q.10jqka.com.cn/"})
            m = re.search(r"\((\{.*\})\)", r.text, re.S)
            if not m:
                continue
            node = json.loads(m.group(1)).get(f"{pre}_{code}") or {}
            price, day = float(node.get("11") or 0), str(node.get("1") or "")
            if price <= 0:
                continue
            r2 = sess.get(f"https://d.10jqka.com.cn/v6/line/{pre}_{code}/01/last.js",
                          timeout=6, headers={"Referer": "https://q.10jqka.com.cn/"})
            m2 = re.search(r"\((\{.*\})\)", r2.text, re.S)
            if not m2:
                continue
            rows = str(json.loads(m2.group(1)).get("data") or "").split(";")
            prev = 0.0
            for row in reversed(rows):
                f = row.split(",")
                if len(f) >= 5 and f[0] < day:
                    prev = float(f[4])
                    break
            if prev <= 0:
                continue
            return {"price": price, "prev": prev, "pct": (price / prev - 1) * 100,
                    "date": day, "src": "同花顺"}
        except Exception:
            continue
    return None


def resolve(code: str):
    """按代码长相依次尝试。返回 dict 或 None。"""
    c = code.strip().upper()
    tries = []
    dig6 = bool(re.fullmatch(r"\d{6}", c))
    if dig6 and c[0] in "0135":
        tries.append(lambda: _tx(c))       # 标准沪深指数/ETF：腾讯最快
    if dig6 and c[:2] == "98":
        tries.append(lambda: _tx(c))
    tries.append(lambda: _xq(c))           # 雪球：中证/华证/恒生/美股都在这
    if dig6 and (c[:2] in ("93", "95") or c[:3] == "005"):
        tries.append(lambda: _em("2." + c))
    if re.fullmatch(r"H\d{5}", c):
        tries.append(lambda: _em("2." + c))
    if c.startswith("HS"):
        tries.append(lambda: _em("100." + c))
    if re.fullmatch(r"[A-Z]{1,6}", c) and not c.startswith("HS"):
        tries.append(lambda: _tx_us(c))
        tries.append(lambda: _em("105." + c))
    tries.append(lambda: _ths(c))
    for fn in tries:
        try:
            got = fn()
            if got:
                return got
        except Exception:
            pass
    return None


def _tx_us(code: str):
    r = sess.get(f"https://qt.gtimg.cn/q=us{code}", timeout=6)
    r.encoding = "gbk"
    m = re.search(r'="([^"]*)"', r.text)
    if not m:
        return None
    f = m.group(1).split("~")
    try:
        price, prev = float(f[3]), float(f[4])
    except (ValueError, IndexError):
        return None
    if price <= 0 or prev <= 0:
        return None
    return {"price": price, "prev": prev, "pct": price / prev * 100 - 100,
            "date": (f[30][:8] if len(f) > 30 else ""), "src": "腾讯"}


# ---------------------------------------------------------------- 分位
def load_fetcher():
    spec = importlib.util.spec_from_file_location("fetch_percentiles", HERE / "fetch_percentiles.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def refresh(quiet: bool = False) -> bool:
    try:
        mod = load_fetcher()
        return mod.main() == 0
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] 拉取分位失败：{exc}")
        return False


def lan_ip() -> str | None:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:  # noqa: BLE001
        return None
    finally:
        s.close()


class Handler(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        t = super().guess_type(path)
        if t in ("application/json", "text/html", "text/javascript",
                 "application/javascript", "text/css"):
            return t + "; charset=utf-8"
        return t

    def end_headers(self):
        p = self.path.split("?")[0]
        if p.endswith(".json") or p.endswith(".html") or p.endswith("/"):
            self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # 把路径带上，404 时才知道是哪个请求
        if str(args[0]).startswith("4") or str(args[0]).startswith("5"):
            sys.stderr.write(f"[{time.strftime('%H:%M:%S')}] {self.requestline} -> {args[0]}\n")

    def do_GET(self):
        if self.path.startswith("/favicon.ico"):
            self.send_response(204)
            self.end_headers()
            return
        if self.path.startswith("/api/ping"):
            self._json({"ok": True, "v": "2026-11-02a", "quote": "/api/quote?code=399997",
                        "batch": "/api/quotes?codes=399997,931139"})
            return
        if self.path.startswith("/api/quotes"):
            self._api_quotes()
            return
        if self.path.startswith("/api/quote"):
            self._api_quote()
            return
        super().do_GET()

    def _api_quotes(self):
        q = parse_qs(urlparse(self.path).query)
        raw = (q.get("codes") or [""])[0]
        codes = [c.strip() for c in raw.split(",") if c.strip()]
        if not codes:
            self._json({"error": "缺少 codes"}, 400)
            return
        items = {}
        futs = {_POOL.submit(resolve_cached, c): c for c in codes}
        for f in _as_completed(futs):
            c = futs[f]
            try:
                got = f.result()
            except Exception:
                got = None
            items[c] = got if got else {"error": "取不到"}
        self._json({"items": items})

    def _api_quote(self):
        q = parse_qs(urlparse(self.path).query)
        code = (q.get("code") or [""])[0].strip()
        if not code:
            self._json({"error": "缺少 code"}, 400)
            return
        got = resolve(code)
        if not got:
            self._json({"error": f"{code} 取不到"}, 404)
            return
        got["code"] = code
        self._json(got, 200)

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    ap = argparse.ArgumentParser(description="本地跑定投网页")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--no-fetch", action="store_true")
    ap.add_argument("--refresh-hours", type=float, default=3.0)
    args = ap.parse_args()

    if not args.no_fetch:
        print("[1/2] 拉取指数估值分位…")
        refresh()

    handler = functools.partial(Handler, directory=str(WEB))
    httpd = http.server.ThreadingHTTPServer((args.host, args.port), handler)

    ip = lan_ip()
    print("[2/2] 服务已启动（含 /api/quote 行情代理）")
    print(f"      本机： http://127.0.0.1:{args.port}/")
    if ip:
        print(f"      手机： http://{ip}:{args.port}/    （需同一个 Wi-Fi）")
    print("      Ctrl+C 停止\n")

    if args.refresh_hours and args.refresh_hours > 0:
        def loop():
            while True:
                time.sleep(args.refresh_hours * 3600)
                print(f"[定时] {time.strftime('%H:%M')} 刷新分位…")
                refresh()
        threading.Thread(target=loop, daemon=True).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
