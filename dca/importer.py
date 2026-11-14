"""把同花顺导出的估值表（CSV / XLSX）转成 data/manual/percentiles.csv。

为什么要这一步：
    同花顺「简况 → 指数分析 → 估值分析」里的 PE/PB/PS/PCF 分位，是终端算好的成品，
    但它只给页面、不给接口。你在客户端「导出」成 Excel/CSV 之后，用本模块把
    这几列认出来，写进 percentiles.csv，程序就能直接拿去算金额。

支持的表格形态：
    - 多指数列表：一行一个指数，带「代码 / 名称」列
    - 单指数明细：一行一个日期，或只有一行当前值（配合 --code 使用）
    - 表头可以是单行（市盈率分位），也可以是两行合并单元格（市盈率 | 分位）
    - 分位值可以是 51.4 或 51.4% 或 0.514，会自动判断量纲
"""
from __future__ import annotations

import csv
import io
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

# 指标关键词，顺序即匹配优先级（先匹配更长的中文名）
METRIC_TOKENS = (
    ("pcf", ("市现率", "PCF")),
    ("ps", ("市销率", "PS")),
    ("pb", ("市净率", "PB")),
    ("pe", ("市盈率", "PE")),
)
DATE_KEYS = ("日期", "DATE")
CODE_KEYS = ("代码", "CODE")
NAME_KEYS = ("名称", "指数", "NAME")


# ---------------------------------------------------------------- 读文件
def _read_csv(path: Path) -> list[list[str]]:
    raw = path.read_bytes()
    for enc in ("utf-8-sig", "utf-8", "gbk", "gb18030"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("utf-8", errors="replace")
    rows = []
    for row in csv.reader(io.StringIO(text)):
        rows.append([c.strip() for c in row])
    return rows


def _read_xlsx(path: Path) -> list[list[str]]:
    """只用标准库解析 xlsx（zip + xml），避免引入 openpyxl。"""
    ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

    def local(tag: str) -> str:
        return tag.split("}")[-1]

    with zipfile.ZipFile(path) as z:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root:
                shared.append("".join(t.text or "" for t in si.iter() if local(t.tag) == "t"))

        sheets = [n for n in z.namelist() if n.startswith("xl/worksheets/sheet")]
        if not sheets:
            raise ValueError("xlsx 里没有工作表")
        root = ET.fromstring(z.read(sorted(sheets)[0]))

        rows: list[list[str]] = []
        for row in root.iter():
            if local(row.tag) != "row":
                continue
            cells: dict[int, str] = {}
            for c in row:
                if local(c.tag) != "c":
                    continue
                ref = c.get("r") or ""
                letters = re.sub(r"\d", "", ref)
                col = 0
                for ch in letters:
                    col = col * 26 + (ord(ch.upper()) - 64)
                col = max(col - 1, 0)

                val = ""
                for child in c:
                    if local(child.tag) == "v":
                        val = child.text or ""
                    elif local(child.tag) == "is":
                        val = "".join(t.text or "" for t in child.iter() if local(t.tag) == "t")
                if c.get("t") == "s" and val:
                    try:
                        val = shared[int(val)]
                    except (ValueError, IndexError):
                        pass
                cells[col] = val
            if cells:
                width = max(cells) + 1
                rows.append([cells.get(i, "") for i in range(width)])
        return rows


def read_rows(path: str | Path) -> list[list[str]]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"文件不存在: {p}")
    suffix = p.suffix.lower()
    if suffix in (".csv", ".txt"):
        return _read_csv(p)
    if suffix == ".xlsx":
        return _read_xlsx(p)
    if suffix == ".xls":
        raise ValueError("老版 .xls 读不了，请在 Excel/同花顺里另存为 .xlsx 或 .csv 再导入")
    raise ValueError(f"不支持的格式: {suffix}（支持 .csv / .xlsx）")


# ---------------------------------------------------------------- 解析
def _locate_header(rows: list[list[str]]) -> tuple[int | None, int | None]:
    """返回 (主表头行, 副表头行或 None)，支持两行合并表头。"""
    metric_words = ("市盈率", "市净率", "市销率", "市现率")
    for i, row in enumerate(rows[:20]):
        joined = "".join(row)
        if "分位" not in joined and "百分位" not in joined:
            continue
        if i > 0:
            above = "".join(rows[i - 1])
            if any(w in above for w in metric_words) and not any(w in joined for w in metric_words):
                return i - 1, i
        return i, None
    return None, None


def _merge_header(top: list[str], bottom: list[str]) -> list[str]:
    """处理 Excel 合并单元格导出的两行表头：市盈率 | 分位 -> 市盈率分位。"""
    out, carry = [], ""
    for i in range(max(len(top), len(bottom))):
        a = (top[i] if i < len(top) else "").strip()
        b = (bottom[i] if i < len(bottom) else "").strip()
        if a:
            carry = a
        out.append((carry + b).strip())
    return out


def _metric_of(header: str) -> str | None:
    h = header.upper().replace(" ", "")
    if "分位" not in h and "百分位" not in h:
        return None
    for key, tokens in METRIC_TOKENS:
        for tok in tokens:
            if tok.upper() in h:
                return key
    return None


def _num(text: str) -> float | None:
    t = str(text).strip().replace("%", "").replace(",", "")
    if not t or t in ("-", "--", "None", "nan"):
        return None
    try:
        return float(t)
    except ValueError:
        return None


def _date_of(text: str) -> str | None:
    t = str(text).strip()
    m = re.search(r"(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})", t)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    m = re.fullmatch(r"(\d{4})(\d{2})(\d{2})", t)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return None


def parse(
    rows: list[list[str]],
    cfg,
    date: str | None = None,
    code: str | None = None,
    scale: str = "auto",
) -> tuple[list[dict], list[str]]:
    """返回 (记录列表, 提示信息)。"""
    notes: list[str] = []
    top, bottom = _locate_header(rows)
    if top is None:
        raise ValueError("没找到含「分位」的表头，请确认导出的是估值分析表")

    if bottom is None:
        header = rows[top]
        body_start = top + 1
    else:
        header = _merge_header(rows[top], rows[bottom])
        body_start = bottom + 1

    metric_cols: dict[str, int] = {}
    for j, h in enumerate(header):
        m = _metric_of(h)
        if m and m not in metric_cols:
            metric_cols[m] = j
    if not metric_cols:
        raise ValueError(f"表头里没认出分位列，实际表头：{header}")

    date_col = next((j for j, h in enumerate(header) if any(k in h.upper() for k in DATE_KEYS)), None)
    code_col = next((j for j, h in enumerate(header) if any(k in h.upper() for k in CODE_KEYS)), None)
    name_col = next((j for j, h in enumerate(header) if any(k in h.upper() for k in NAME_KEYS)), None)

    by_name = {i.name: i.code for i in cfg.indices}
    by_code = {i.code: i.code for i in cfg.indices}

    records: list[dict] = []
    raw_pcts: list[float] = []

    for row in rows[body_start:]:
        if not any(str(c).strip() for c in row):
            continue
        rec: dict = {}

        # 指数
        idx_code = code
        if idx_code is None and code_col is not None and code_col < len(row):
            m = re.search(r"\d{6}", str(row[code_col]))
            if m:
                idx_code = m.group(0)
        if idx_code is None and name_col is not None and name_col < len(row):
            nm = str(row[name_col]).strip()
            idx_code = by_name.get(nm)
            if idx_code is None:
                m = re.search(r"\d{6}", nm)
                if m:
                    idx_code = m.group(0)
        if idx_code is None:
            continue
        if idx_code not in by_code:
            notes.append(f"跳过未配置的指数：{idx_code}")
            continue

        # 日期
        rec_date = date
        if rec_date is None and date_col is not None and date_col < len(row):
            rec_date = _date_of(row[date_col])
        rec["date"] = rec_date or ""

        got = False
        for m, j in metric_cols.items():
            if j < len(row):
                v = _num(row[j])
                if v is not None:
                    rec[f"{m}_pct"] = v
                    raw_pcts.append(v)
                    got = True
        if got:
            rec["code"] = idx_code
            records.append(rec)

    if not records:
        raise ValueError("没解析出任何数据行，请检查：指数代码/名称是否和 config.toml 对得上")

    # 量纲：0.514 -> 51.4
    if scale == "auto":
        scale_n = 100.0 if raw_pcts and max(raw_pcts) <= 1.0 else 1.0
        if scale_n == 100.0:
            notes.append("分位值疑似 0-1 小数，已 ×100 转成百分数（可用 --scale 1 关闭）")
    else:
        scale_n = float(scale)

    for rec in records:
        for m in ("pe", "pb", "ps", "pcf"):
            k = f"{m}_pct"
            if k in rec:
                rec[k] = round(rec[k] * scale_n, 2)
    return records, notes


# ---------------------------------------------------------------- 写文件
HEADER = "date,code,pe_pct,pb_pct,ps_pct,pcf_pct"


def _existing(path: Path) -> dict[tuple[str, str], list[str]]:
    """读已有 percentiles.csv：{(date, code): 原始行}"""
    if not path.exists():
        return {}
    out = {}
    text = path.read_text(encoding="utf-8-sig")
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#") or s.lower().startswith("date,"):
            continue
        parts = [p.strip() for p in s.split(",")]
        if len(parts) >= 2:
            out[(parts[0][:10], parts[1])] = parts
    return out


def merge(path: str | Path, records: list[dict]) -> tuple[int, int]:
    """把记录并入 percentiles.csv，返回 (新增/更新条数, 总条数)。"""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    existing = _existing(p)

    changed = 0
    for rec in records:
        if not rec.get("date"):
            continue
        key = (rec["date"], rec["code"])
        row = [rec["date"], rec["code"]]
        for m in ("pe", "pb", "ps", "pcf"):
            v = rec.get(f"{m}_pct")
            row.append("" if v is None else f"{v:g}")
        if existing.get(key) != row:
            existing[key] = row
            changed += 1

    lines = [
        "# 手工分位表：由 `python -m dca import <导出文件>` 自动维护",
        "# 来源：同花顺 / iFinD 「简况 → 指数分析 → 估值分析」",
        HEADER,
    ]
    for key in sorted(existing):
        lines.append(",".join(existing[key]))
    p.write_text("\n".join(lines) + "\n", encoding="utf-8-sig")
    return changed, len(existing)
