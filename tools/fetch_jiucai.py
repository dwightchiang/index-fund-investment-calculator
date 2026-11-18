# -*- coding: utf-8 -*-
"""韭圈儿（jiucaishuo）指数估值分位抓取。

数据来源：https://www.jiucaishuo.com/index/NDX.GI 页面背后的公开接口
  GET https://ai2.jiucaishuo.com/api/index-valuation/detail?code=<CODE>
返回近 10 年分位（header.percent / table[0].percent 为市盈率分位）。

输出 data/jiucai.json：
{
  "generated_at": "2026-11-18 09:05:00",
  "source": "韭圈儿 index-valuation/detail · 近十年分位",
  "items": {
     "NDX.GI": {"name":"纳斯达克100", "pe":26.24, "pe_pct":18.86,
                "pb":10.11, "pb_pct":96.67, "level":"低", "date":"2026-11-17"}
  }
}
"""
import argparse
import datetime as dt
import json
import pathlib
import ssl
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "jiucai.json"

BASE = "https://ai2.jiucaishuo.com/api"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

# 关注的指数：lixiang 代码 → 展示名（可继续加）
WATCH = {
    "NDX.GI": "纳斯达克100",
}

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def get_json(path, retries=3):
    url = BASE + path
    h = {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://www.jiucaishuo.com",
        "Referer": "https://www.jiucaishuo.com/",
    }
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=30, context=CTX) as r:
                return json.loads(r.read().decode("utf-8", "ignore"))
        except Exception as exc:                      # noqa: BLE001
            last = exc
            print(f"  [retry {i+1}] {path} -> {exc}")
    raise RuntimeError(f"{path} 取不到：{last}")


def pick(table, name):
    for row in table or []:
        if row.get("name") == name:
            return row
    return {}


def fetch_one(code, name):
    js = get_json(f"/index-valuation/detail?code={urllib.parse.quote(code)}")
    header = js.get("header") or {}
    table = js.get("table") or []
    pe_row = pick(table, "市盈率")
    pb_row = pick(table, "市净率")
    item = {
        "name": header.get("name") or name,
        "pe": pe_row.get("latest"),
        "pe_pct": pe_row.get("percent"),
        "pe_avg": pe_row.get("avg"),
        "pb": pb_row.get("latest"),
        "pb_pct": pb_row.get("percent"),
        "level": header.get("level_desc") or header.get("level") or "",
        "metric": js.get("metric") or "pe",
        "date": js.get("update_time") or "",
        "status_text": js.get("status_text") or "",
    }
    if item["pe_pct"] is None:
        raise RuntimeError(f"{code} 没拿到 PE 分位：{js}")
    return item


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--code", default="", help="只抓一个代码（调试用），如 NDX.GI")
    args = ap.parse_args()

    watch = WATCH if not args.code else {args.code: WATCH.get(args.code, args.code)}
    items, fail = {}, 0
    for code, name in watch.items():
        try:
            it = fetch_one(code, name)
            items[code] = it
            print(f"[ok] {name:10} {code:10} PE={it['pe']} 分位={it['pe_pct']}% "
                  f"PB分位={it['pb_pct']}% 数据日={it['date']}")
        except Exception as exc:                       # noqa: BLE001
            print(f"[err] {name} {code}: {exc}")
            fail += 1

    if not items:
        print("一个都没取到，放弃写入（保留旧文件）")
        return 1

    payload = {
        "generated_at": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "source": "韭圈儿 index-valuation/detail · 近十年分位",
        "items": items,
    }
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n写入 {out}：{len(items)} 个成功，{fail} 个失败")
    return 0


if __name__ == "__main__":
    import urllib.parse  # noqa: E402  （fetch_one 里用到）
    raise SystemExit(main())
