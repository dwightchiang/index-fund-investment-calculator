#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""每天拉一次指数估值分位，写成网页用的 JSON。

数据来源：蛋卷（雪球）公开接口 danjuanfunds.com/djapi/index_eva/detail/<code>
        返回的 pe_percentile / pb_percentile 就是「近十年分位」（0~1）。

输出：web/data/percentiles.json
    网页（静态托管）用同源 fetch 读取，不需要 CORS、不需要后端。

用法：
    python tools/fetch_percentiles.py
只用标准库，GitHub Actions 里免安装依赖。
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib
import ssl
import sys
import time
import urllib.error
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "web" / "data" / "percentiles.json"
CATALOG = HERE / "indices.json"

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "Referer": "https://danjuanfunds.com/",
    "Accept": "application/json",
}


def get_json(url: str, retries: int = 3):
    ctx = ssl.create_default_context()
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=20, context=ctx) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            last = exc
            # 证书链问题时退回不校验
            if isinstance(exc, urllib.error.URLError) and "CERTIFICATE" in str(exc).upper():
                ctx = ssl._create_unverified_context()  # noqa: SLF001
            time.sleep(1.2 * (i + 1))
    raise RuntimeError(f"{url} 失败: {last}")


def pct(v):
    if v is None:
        return None
    try:
        return round(float(v) * 100, 2)
    except (TypeError, ValueError):
        return None


def main() -> int:
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))["items"]
    items: dict[str, dict] = {}
    ok = fail = 0

    for it in catalog:
        code, dj, name = it["code"], it["dj"], it["name"]
        try:
            js = get_json(f"https://danjuanfunds.com/djapi/index_eva/detail/{dj}")
            data = (js or {}).get("data") or {}
            if data.get("pe") is None:
                print(f"[skip] {name} ({dj}) 无数据")
                fail += 1
                continue
            ts = data.get("ts")
            day = (dt.datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
                   if isinstance(ts, (int, float)) else "")
            items[code] = {
                "name": data.get("name") or name,
                "pe": data.get("pe"),
                "pb": data.get("pb"),
                "pe_pct": pct(data.get("pe_percentile")),
                "pb_pct": pct(data.get("pb_percentile")),
                "date": day,
            }
            ok += 1
            print(f"[ok] {name:6} PE分位={items[code]['pe_pct']:>6} PB分位={items[code]['pb_pct']:>6} ({day})")
        except Exception as exc:  # noqa: BLE001
            print(f"[err] {name} {exc}")
            fail += 1

    if not items:
        print("一个都没取到，放弃写入（保留旧文件）")
        return 1

    payload = {
        "updated": dt.date.today().isoformat(),
        "generated_at": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source": "蛋卷（雪球）index_eva/detail · 近十年分位",
        "items": items,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n写入 {OUT}：{ok} 个成功，{fail} 个失败")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
