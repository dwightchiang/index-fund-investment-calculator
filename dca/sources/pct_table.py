"""直接读取"已经算好的分位值"。

同花顺 / iFinD 的「简况 → 指数分析 → 估值分析」页面本来就给出 PE/PB/PS/PCF 的
1/3/5/10 年分位。与其自己拿原始估值序列重算（还受数据源 5 年/10 年的限制），
不如每天把这几个数字记下来，程序直接拿去算金额。

文件：data/manual/percentiles.csv

    date,code,pe_pct,pb_pct,ps_pct,pcf_pct
    2026-10-23,000300,51.4,26.8,45.2,60.1
    2026-10-23,000905,70.5,68.0,55.3,48.2

以 # 开头的行是注释，会被跳过。每个指数取日期最新的那一行。
"""
from __future__ import annotations

import csv
from pathlib import Path

METRICS = ("pe", "pb", "ps", "pcf")


def load(path: str | Path) -> dict[str, dict]:
    """返回 {code: {"date":..., "pe_pct":...}}，每个代码只保留最新日期。"""
    p = Path(path)
    if not p.exists():
        return {}

    text = None
    for enc in ("utf-8-sig", "utf-8", "gbk"):
        try:
            text = p.read_text(encoding=enc)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        return {}

    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    if not lines:
        return {}

    reader = csv.DictReader(lines)
    table: dict[str, dict] = {}
    for row in reader:
        code = (row.get("code") or "").strip()
        date = (row.get("date") or "").strip().replace("/", "-")[:10]
        if not code or not date:
            continue
        rec = {"date": date}
        for m in METRICS:
            raw = (row.get(f"{m}_pct") or "").strip().replace("%", "")
            if raw:
                try:
                    rec[f"{m}_pct"] = float(raw)
                except ValueError:
                    pass
        old = table.get(code)
        if old is None or date >= old["date"]:
            table[code] = rec
    return table
