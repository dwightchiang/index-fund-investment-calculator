"""结果渲染：控制台表格 / Markdown / CSV。"""
from __future__ import annotations

import csv
import unicodedata
from pathlib import Path

COLUMNS = [
    ("name", "指数", 10),
    ("pct_chg", "涨跌幅", 8),
    ("pe_pct", "PE分位", 8),
    ("pb_pct", "PB分位", 8),
    ("ps_pct", "PS分位", 8),
    ("base_pct", "最低分位", 9),
    ("score", "分数", 7),
    ("amount", "金额", 9),
    ("note", "说明", 26),
]


def _width(s: str) -> int:
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in s)


def _pad(s: str, w: int, align: str = "left") -> str:
    s = str(s)
    gap = max(0, w - _width(s))
    return s + " " * gap if align == "left" else " " * gap + s


def _fmt(v, nd=2):
    if v is None or v == "":
        return "-"
    try:
        return f"{float(v):.{nd}f}"
    except (TypeError, ValueError):
        return str(v)


def table(rows: list[dict]) -> str:
    head = "  ".join(_pad(title, w, "right" if key != "name" and key != "note" else "left")
                     for key, title, w in COLUMNS)
    lines = [head, "-" * _width(head)]
    for r in rows:
        cells = []
        for key, title, w in COLUMNS:
            if key == "amount":
                v = "-" if not r.get("amount") else f"{float(r['amount']):.0f}"
            elif key == "pct_chg":
                v = f"{float(r.get(key) or 0):+.2f}%"
            elif key == "score":
                v = _fmt(r.get(key))
            elif key == "name":
                v = r.get("name", "")
            elif key == "note":
                v = r.get("note", "")
            else:
                v = _fmt(r.get(key))
            cells.append(_pad(v, w, "left" if key in ("name", "note") else "right"))
        lines.append("  ".join(cells))
    return "\n".join(lines)


def markdown(rows: list[dict], title: str, asof: str, total: float) -> str:
    head = (
        f"## {title}\n\n"
        f"- 估值分位日期：**{asof}**（T-1 收盘后数据）\n"
        f"- 今日合计：**{total:,.0f} 元**\n\n"
        "| 指数 | 涨跌幅 | PE分位 | PB分位 | PS分位 | 最低分位 | 分数 | 金额(元) | 说明 |\n"
        "|---|---:|---:|---:|---:|---:|---:|---:|---|\n"
    )
    body = []
    for r in rows:
        amt = "-" if not r.get("amount") else f"{float(r['amount']):,.0f}"
        body.append(
            f"| {r.get('name','')} | {float(r.get('pct_chg') or 0):+.2f}% | {_fmt(r.get('pe_pct'))} | "
            f"{_fmt(r.get('pb_pct'))} | {_fmt(r.get('ps_pct'))} | {_fmt(r.get('base_pct'))} | "
            f"{_fmt(r.get('score'))} | {amt} | {r.get('note','')} |"
        )
    return head + "\n".join(body)


def write_csv(rows: list[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fields = ["name", "code", "etf", "pe", "pb", "ps", "pe_pct", "pb_pct", "ps_pct",
              "pct_chg", "base_metric", "base_pct", "score", "amount", "shares", "triggered", "note"]
    with path.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)
