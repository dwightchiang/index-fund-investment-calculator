# -*- coding: utf-8 -*-
"""每天记录纳指100的四个「盘后/隔夜」指标 + 次日实际涨跌，用于算 MAE。

记录什么（每次运行记一条快照，key = 快照日期）：
  qiv         QIV 涨跌%（纳斯达克官方盘后指标，含盘后）
  qiv_post    QIV% − NDX 当日%  = 纯盘后涨跌
  qqq_post    QQQ 盘后涨跌%（腾讯字段9）
  fut        纳指期货 hf_NQ 涨跌%（含盘中，24h 连续）
  ndx_close   NDX 当日涨跌%（基准，用于算 qiv_post 和 next_day）

次日实际涨跌（next_day）在第二天运行本脚本时回填。

用法：
  python tools/record_afterhours.py              # 记录今天
  python tools/record_afterhours.py --report     # 只输出 MAE 报告
  python tools/record_afterhours.py --force      # 覆盖今天的已有记录
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import ssl
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "afterhours.json"

UA = {"User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")}
requests.packages.urllib3.disable_warnings()


def num(x):
    try:
        return float(str(x).replace(",", "").replace("%", "").replace("+", ""))
    except Exception:
        return None


# ---------- 各指标 ----------
def get_qiv():
    """QIV：纳斯达克100 盘后指标（官方站，页面 HTML 直接带值）。"""
    try:
        r = requests.get("https://indexes.nasdaqomx.com/Index/Overview/QIV",
                         headers={**UA, "Accept": "text/html"}, timeout=25, verify=False)
        html = r.text
        cur = re.search(r'data-current-value="([\d,.]+)"', html)
        chg = re.search(r'data-numerical-change="(-?[\d,.]+)"', html)
        pct = re.search(r'id="pctChange"[\s\S]{0,200}?>\s*([-+]?[\d.]+)%', html)
        dat = re.search(r"DATA AS OF\s*([\d/]+)", html)
        if not cur:
            return None
        return {"qiv": num(cur.group(1)),
                "change": num(chg.group(1)) if chg else None,
                "pct": float(pct.group(1)) if pct else None,
                "date": dat.group(1) if dat else ""}
    except Exception as e:
        print(f"  [qiv] 失败: {e!r}"[:120])
        return None


def get_qqq_after():
    """QQQ 盘后：腾讯美股字段 9 = 盘后价，字段 3 = 收盘。"""
    try:
        r = requests.get("https://qt.gtimg.cn/q=usQQQ", headers=UA, timeout=20, verify=False)
        p = r.text.strip().split('="', 1)[-1].rstrip('";').split("~")
        close, after = num(p[3]), num(p[9])
        if not close or not after:
            return None
        return {"close": close, "after": after, "pct": (after - close) / close * 100}
    except Exception as e:
        print(f"  [qqq] 失败: {e!r}"[:120])
        return None


def get_future():
    """纳指期货 hf_NQ：最新价 + 昨结。"""
    try:
        r = requests.get("https://hq.sinajs.cn/list=hf_NQ",
                         headers={**UA, "Referer": "https://finance.sina.com.cn/"},
                         timeout=20, verify=False)
        body = r.text.split('="', 1)[-1].rstrip('";')
        p = body.split(",")
        last, prev = num(p[0]), num(p[7])
        if not last or not prev:
            return None
        return {"last": last, "prev": prev, "pct": (last - prev) / prev * 100,
                "time": p[6], "date": p[12] if len(p) > 12 else ""}
    except Exception as e:
        print(f"  [future] 失败: {e!r}"[:120])
        return None


def get_ndx_daily(lmt=8):
    """NDX 最近日线（东财），返回 [{date, close, pct}, ...]。"""
    try:
        u = ("https://push2his.eastmoney.com/api/qt/stock/kline/get?"
             "secid=100.NDX100&fields1=f1&fields2=f51,f52,f53,f59,f60"
             f"&klt=101&fqt=1&end=20500101&lmt={lmt}")
        r = requests.get(u, headers={**UA, "Referer": "https://quote.eastmoney.com/"},
                         timeout=25, verify=False)
        kl = ((r.json().get("data") or {}).get("klines") or [])
        out = []
        for row in kl:
            p = row.split(",")
            out.append({"date": p[0], "open": num(p[1]), "close": num(p[2]),
                        "pct": num(p[3]), "change": num(p[4])})
        return out
    except Exception as e:
        print(f"  [ndx] 失败: {e!r}"[:120])
        return []


# ---------- 记录 ----------
def load():
    if OUT.exists():
        try:
            return json.loads(OUT.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"v": 1, "rows": []}


def save(db):
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(db, ensure_ascii=False, indent=1), encoding="utf-8")


def record(force=False):
    now = dt.datetime.now()
    today = now.strftime("%Y-%m-%d")
    db = load()
    rows = db.setdefault("rows", [])

    if not force and any(r.get("at", "").startswith(today) for r in rows):
        print(f"今天（{today}）已经记录过了，跳过。用 --force 覆盖。")
        return 0

    print(f"记录 {now:%Y-%m-%d %H:%M:%S}")
    qiv = get_qiv()
    qqq = get_qqq_after()
    fut = get_future()
    ndx = get_ndx_daily()

    # NDX 最新一条 = 最近交易日
    last = ndx[-1] if ndx else None
    prev = ndx[-2] if len(ndx) >= 2 else None

    rec = {
        "at": now.strftime("%Y-%m-%d %H:%M:%S"),
        # 原始值（各指标自己的口径）
        "qiv_pct": qiv["pct"] if qiv else None,          # QIV = 含盘后的当日涨跌
        "qiv_date": qiv["date"] if qiv else "",
        "qqq_post": round(qqq["pct"], 4) if qqq else None,   # QQQ 盘后（已是纯盘后）
        "fut_raw": round(fut["pct"], 4) if fut else None,    # 期货原始（含盘中）
        # 基准
        "ndx_date": last["date"] if last else "",
        "ndx_pct": last["pct"] if last else None,
        # ★ 统一口径：减掉 NDX 当日% → 都变成「纯盘后」，才能公平比较
        "qiv_post": None,
        "fut_post": None,
        "next_date": "",
        "next_pct": None,
    }
    if rec["ndx_pct"] is not None:
        if rec["qiv_pct"] is not None:
            rec["qiv_post"] = round(rec["qiv_pct"] - rec["ndx_pct"], 4)
        if rec["fut_raw"] is not None:
            rec["fut_post"] = round(rec["fut_raw"] - rec["ndx_pct"], 4)

    # 如果这条 NDX 日线比上次记录的更新，说明上次的「次日」已经出来了 → 回填
    if last:
        for r in rows:
            if r.get("next_pct") is None and r.get("ndx_date") and r["ndx_date"] < last["date"]:
                # 找 ndx_date 之后的那一天
                for i, d in enumerate(ndx):
                    if d["date"] == r["ndx_date"] and i + 1 < len(ndx):
                        nx = ndx[i + 1]
                        r["next_date"] = nx["date"]
                        r["next_pct"] = nx["pct"]
                        print(f"  回填 {r['at'][:10]} 的次日({nx['date']})涨跌 = {nx['pct']}%")
                        break

    # 覆盖 or 追加
    idx = next((i for i, r in enumerate(rows) if r.get("at", "").startswith(today)), None)
    if idx is not None:
        rec["next_date"] = rows[idx].get("next_date", "")
        rec["next_pct"] = rows[idx].get("next_pct")
        rows[idx] = rec
    else:
        rows.append(rec)
    rows.sort(key=lambda r: r.get("at", ""))
    db["rows"] = rows
    db["updated"] = now.strftime("%Y-%m-%d %H:%M:%S")
    save(db)

    print(f"  NDX 当日   : {rec['ndx_pct']}%  ({rec['ndx_date']})")
    print(f"  QIV 原始   : {rec['qiv_pct']}%   → 减NDX后 = {rec['qiv_post']}%")
    print(f"  期货 原始  : {rec['fut_raw']}%   → 减NDX后 = {rec['fut_post']}%")
    print(f"  QQQ 盘后   : {rec['qqq_post']}%  （本身就是纯盘后）")
    print(f"  共 {len(rows)} 条记录 → {OUT}")
    return 0


# ---------- MAE 报告 ----------
def report():
    db = load()
    rows = [r for r in db.get("rows", []) if r.get("next_pct") is not None]
    if not rows:
        print("还没有「次日实际涨跌」可对比的记录。等跑几天再来。")
        n = len(db.get("rows", []))
        print(f"（已记录 {n} 条，等次日数据回填）")
        return 0

    keys = [("qiv_post", "QIV(减NDX)"), ("fut_post", "期货(减NDX)"), ("qqq_post", "QQQ盘后")]
    print(f"\n=== MAE 排名（样本 {len(rows)} 条）===")
    print("三个指标都已统一为「纯盘后」口径：QIV/期货 各自减去 NDX 当日%")
    print("对比基准：次日 NDX 实际涨跌%\n")
    print(f"{'指标':<12}{'MAE':>8}{'平均误差(带符号)':>18}{'命中方向':>10}{'样本':>6}")
    print("-" * 60)

    stats = []
    for k, label in keys:
        pairs = [(r[k], r["next_pct"]) for r in rows if r.get(k) is not None]
        if not pairs:
            continue
        errs = [abs(a - b) for a, b in pairs]
        signed = [a - b for a, b in pairs]
        hit = sum(1 for a, b in pairs if (a >= 0) == (b >= 0))
        stats.append({
            "key": k, "label": label,
            "mae": sum(errs) / len(errs),
            "bias": sum(signed) / len(signed),
            "hit": hit / len(pairs) * 100,
            "n": len(pairs),
        })
    stats.sort(key=lambda x: x["mae"])
    for i, s in enumerate(stats, 1):
        print(f"{s['label']:<12}{s['mae']:>7.2f}%{s['bias']:>17.2f}%{s['hit']:>9.0f}%{s['n']:>6}")

    if stats:
        print(f"\n→ 误差最小：{stats[0]['label']}（MAE {stats[0]['mae']:.2f}%，方向命中 {stats[0]['hit']:.0f}%）")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true", help="只输出 MAE 报告")
    ap.add_argument("--force", action="store_true", help="覆盖今天的记录")
    args = ap.parse_args()
    if args.report:
        return report()
    rc = record(force=args.force)
    report()
    return rc


if __name__ == "__main__":
    sys.exit(main())
