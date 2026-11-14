"""本地缓存：估值序列 + 每日分位快照。"""
from __future__ import annotations

import csv
from pathlib import Path

SNAP_FIELDS = [
    "asof", "name", "code",
    "pe", "pb", "ps",
    "pe_pct", "pb_pct", "ps_pct",
]


def save_series(path: Path, rows: list[tuple[str, float]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["date", "value"])
        w.writerows(rows)


def load_series(path: Path) -> list[tuple[str, float]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        r = csv.DictReader(fh)
        out = []
        for row in r:
            try:
                out.append((row["date"][:10], float(row["value"])))
            except (KeyError, TypeError, ValueError):
                continue
    out.sort(key=lambda x: x[0])
    return out


def write_snapshot(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8-sig") as fh:
        w = csv.DictWriter(fh, fieldnames=SNAP_FIELDS, extrasaction="ignore")
        w.writeheader()
        for row in rows:
            w.writerow(row)


def read_snapshot(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))
