"""蛋卷（雪球）指数估值源：提供 PE/PB 近 10 年序列与官方分位。

接口示例：
  https://danjuanfunds.com/djapi/index_eva/detail/SH000300
  https://danjuanfunds.com/djapi/index_eva/pe_history/SH000300?day=all
"""
from __future__ import annotations

import datetime as dt
import json

from ..http import get

BASE = "https://danjuanfunds.com/djapi/index_eva"


def _get(url: str) -> dict:
    r = get(url, referer="https://danjuanfunds.com/", timeout=20)
    js = json.loads(r.text)
    if js.get("result_code") not in (0, "0", None):
        raise RuntimeError(f"蛋卷接口返回异常: {js.get('result_code')} {js.get('message')}")
    return js.get("data") or {}


def detail(dj_code: str) -> dict:
    """当前估值快照：pe / pb / pe_percentile / pb_percentile / roe / yeild。"""
    d = _get(f"{BASE}/detail/{dj_code}")
    return {
        "name": d.get("name"),
        "pe": d.get("pe"),
        "pb": d.get("pb"),
        "pe_percentile": d.get("pe_percentile"),
        "pb_percentile": d.get("pb_percentile"),
        "roe": d.get("roe"),
        "dividend_yield": d.get("yeild"),
        "date": d.get("date"),
    }


def history(dj_code: str, metric: str) -> list[tuple[str, float]]:
    """近 10 年周频序列：[(YYYY-MM-DD, value), ...]。metric 取 pe / pb。"""
    metric = metric.lower()
    if metric not in ("pe", "pb"):
        raise ValueError(f"蛋卷只提供 pe/pb，收到 {metric}")
    d = _get(f"{BASE}/{metric}_history/{dj_code}?day=all")
    key = f"index_eva_{metric}_growths"
    rows = d.get(key) or []
    out: list[tuple[str, float]] = []
    for item in rows:
        v = item.get(metric)
        ts = item.get("ts")
        if v is None or ts is None:
            continue
        day = dt.datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
        out.append((day, float(v)))
    out.sort(key=lambda x: x[0])
    return out
