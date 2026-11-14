"""手工/第三方 CSV 数据源：用来补 PS 等免费接口拿不到的指标。

CSV 格式（表头可以是中英文，取前两列）：
    date,value
    2026-10-23,1.234

默认路径：data/manual/<code>_<metric>.csv
"""
from __future__ import annotations

import csv
import io
from pathlib import Path

DATE_NAMES = {"date", "日期", "trade_date", "时间"}
VALUE_NAMES = {"value", "数值", "ps", "市销率", "pe", "pb", "收盘"}


def _read_text(path: Path) -> str:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def load(path: str | Path) -> list[tuple[str, float]]:
    """读取 (date, value) 序列，按日期升序。"""
    p = Path(path)
    if not p.exists():
        return []
    text = _read_text(p)
    reader = csv.reader(io.StringIO(text))
    rows = [r for r in reader if r and any(c.strip() for c in r)]
    if not rows:
        return []

    header = [c.strip().lower() for c in rows[0]]
    di = next((i for i, h in enumerate(header) if h in DATE_NAMES), 0)
    vi = next((i for i, h in enumerate(header) if h in VALUE_NAMES), 1)
    body = rows[1:] if (header[di] in DATE_NAMES or header[vi] in VALUE_NAMES) else rows

    out: list[tuple[str, float]] = []
    for r in body:
        if len(r) <= max(di, vi):
            continue
        d = r[di].strip().replace("/", "-")
        try:
            v = float(str(r[vi]).strip().replace("%", ""))
        except ValueError:
            continue
        if len(d) == 8 and d.isdigit():
            d = f"{d[:4]}-{d[4:6]}-{d[6:]}"
        out.append((d[:10], v))
    out.sort(key=lambda x: x[0])
    return out
