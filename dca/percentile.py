"""历史分位计算。"""
from __future__ import annotations

import datetime as dt
from typing import Iterable


def _parse(d: str) -> dt.date:
    return dt.date.fromisoformat(d[:10])


def shift_years(d: dt.date, years: int) -> dt.date:
    try:
        return d.replace(year=d.year - years)
    except ValueError:  # 2 月 29 日
        return d.replace(year=d.year - years, day=28)


def window(
    series: Iterable[tuple[str, float]],
    asof: str,
    years: int,
    min_points: int = 1,
) -> list[tuple[str, float]]:
    """截取 (asof-years, asof] 区间内、日期不晚于 asof 的样本。"""
    end = _parse(asof)
    start = shift_years(end, years)
    out = [(_parse(d), v) for d, v in series if _parse(d) <= end]
    out = [(d, v) for d, v in out if d > start]
    out.sort(key=lambda x: x[0])
    if len(out) < min_points:
        return []
    return [(d.isoformat(), v) for d, v in out]


def percentile_rank(value: float, sample: list[float], method: str = "rank_le") -> float:
    """value 在 sample 中的百分位（0-100）。"""
    n = len(sample)
    if n == 0:
        return float("nan")
    less = sum(1 for v in sample if v < value)
    eq = sum(1 for v in sample if v == value)
    if method == "rank_lt":
        return less / n * 100
    if method == "mean_rank":
        return (less + 0.5 * eq) / n * 100
    # rank_le：同花顺/多数行情软件的口径，含等于
    return (less + eq) / n * 100


def compute(
    series: Iterable[tuple[str, float]],
    asof: str,
    years: int,
    method: str = "rank_le",
    min_points: int = 60,
) -> dict:
    """返回 {value, percentile, samples, start, end}；样本不足时 percentile 为 None。"""
    win = window(series, asof, years, min_points=max(min_points, 1))
    if not win:
        return {"value": None, "percentile": None, "samples": 0, "start": None, "end": None}
    values = [v for _, v in win]
    cur = values[-1]
    pct = percentile_rank(cur, values, method)
    return {
        "value": cur,
        "percentile": round(pct, 2),
        "samples": len(values),
        "start": win[0][0],
        "end": win[-1][0],
    }
