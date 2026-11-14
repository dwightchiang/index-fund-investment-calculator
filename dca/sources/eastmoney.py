"""东方财富行情源：日K线 + 交易日判断。"""
from __future__ import annotations

import datetime as dt

from ..http import get_json
from . import quote

KLINE_URL = "https://push2his.eastmoney.com/api/qt/stock/kline/get"

# 上证指数，用于判断当天是否为交易日
SH_INDEX = "1.000001"


def kline(secid: str, begin: str = "19900101", end: str = "20500101") -> list[tuple[str, float, float]]:
    """日K线：[(date, close, pct_chg), ...]。"""
    url = (
        f"{KLINE_URL}?secid={secid}&klt=101&fqt=1&beg={begin}&end={end}"
        "&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53,f59"
    )
    js = get_json(url, referer="https://quote.eastmoney.com/")
    data = js.get("data") or {}
    rows = []
    for line in data.get("klines") or []:
        parts = line.split(",")
        if len(parts) < 2:
            continue
        date, close = parts[0], float(parts[1])
        pct = float(parts[2]) if len(parts) > 2 and parts[2] else 0.0
        rows.append((date, close, pct))
    return rows


def last_trade_date() -> str | None:
    """最近一个交易日（YYYY-MM-DD）。"""
    rows = kline(SH_INDEX, begin="20200101")
    return rows[-1][0] if rows else None


def is_trade_date(day: dt.date | None = None) -> tuple[bool, str]:
    """判断今天是否交易日。任何数据源异常都不会抛错，只会降级判断。"""
    day = day or dt.date.today()
    if day.weekday() >= 5:
        return False, "周末"

    stamp = day.strftime("%Y%m%d")

    # 1) 腾讯行情里的成交日期（最快，1 个请求）
    try:
        d = quote.last_quote_date(SH_INDEX)
        if d:
            return d == stamp, f"腾讯行情最新成交日 {d}"
    except Exception:  # noqa: BLE001
        pass

    # 2) 东方财富日K线
    try:
        last = last_trade_date()
        if last:
            return last == day.isoformat(), f"上证指数最新K线 {last}"
    except Exception:  # noqa: BLE001
        pass

    # 3) 两个源都挂了：按工作日继续，避免因为接口抖动错过当天
    return True, "行情源暂时不可用，按工作日继续（请自行确认非节假日）"
