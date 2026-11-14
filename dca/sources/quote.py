"""实时行情：东方财富 → 腾讯 → 新浪，三级自动切换。

对外统一为 {secid: Quote}，secid 形如 "1.000300" / "0.399006"。
"""
from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass

from ..http import get


@dataclass
class Quote:
    secid: str
    code: str
    name: str
    price: float
    pct_chg: float
    prev_close: float
    source: str = ""
    ts: str = ""


def _to_tx(secid: str) -> str:
    market, code = secid.split(".")
    return ("sh" if market == "1" else "sz") + code


def _decode(resp) -> str:
    raw = resp.content
    for enc in ("utf-8", "gbk", "gb18030"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


# ---------------------------------------------------------------- 东方财富
def _from_eastmoney(secids: list[str]) -> dict[str, Quote]:
    url = (
        "https://push2.eastmoney.com/api/qt/ulist.np/get"
        f"?secids={','.join(secids)}&fields=f2,f3,f12,f13,f14,f18&fltt=2&invt=2"
    )
    js = get(url, referer="https://quote.eastmoney.com/", timeout=6, retries=2).json()
    out: dict[str, Quote] = {}
    for item in (js.get("data") or {}).get("diff") or []:
        price = item.get("f2")
        if not isinstance(price, (int, float)) or price <= 0:
            continue
        secid = f"{item.get('f13')}.{item.get('f12')}"
        out[secid] = Quote(secid, str(item.get("f12")), str(item.get("f14") or ""),
                           float(price), float(item.get("f3") or 0.0),
                           float(item.get("f18") or 0.0), "eastmoney",
                           dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    return out


# ---------------------------------------------------------------- 腾讯
def _from_tencent(secids: list[str]) -> dict[str, Quote]:
    url = "https://qt.gtimg.cn/q=" + ",".join(_to_tx(s) for s in secids)
    text = _decode(get(url, referer="https://gu.qq.com/", timeout=6, retries=2))
    out: dict[str, Quote] = {}
    for line in text.split(";"):
        line = line.strip()
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        val = val.strip().strip('"')
        parts = val.split("~")
        if len(parts) < 33:
            continue
        try:
            price, prev = float(parts[3]), float(parts[4])
            pct = float(parts[32])
        except ValueError:
            continue
        if price <= 0:
            continue
        code = parts[2]
        market = "1" if key.strip().startswith("v_sh") else "0"
        raw_ts = parts[30] if len(parts) > 30 else ""
        ts = ("-".join([raw_ts[0:4], raw_ts[4:6], raw_ts[6:8]]) + " " +
              ":".join([raw_ts[8:10], raw_ts[10:12], raw_ts[12:14]])) if len(raw_ts) >= 14 else ""
        out[f"{market}.{code}"] = Quote(f"{market}.{code}", code, parts[1],
                                        price, pct, prev, "tencent", ts)
    return out


# ---------------------------------------------------------------- 新浪
def _from_sina(secids: list[str]) -> dict[str, Quote]:
    url = "https://hq.sinajs.cn/list=" + ",".join(_to_tx(s) for s in secids)
    text = _decode(get(url, referer="https://finance.sina.com.cn", timeout=6, retries=2))
    out: dict[str, Quote] = {}
    for m in re.finditer(r'hq_str_(sh|sz)(\d{6})="([^"]*)"', text):
        pre, code, body = m.group(1), m.group(2), m.group(3)
        parts = body.split(",")
        if len(parts) < 6:
            continue
        try:
            open_, prev, price = float(parts[1]), float(parts[2]), float(parts[3])
        except ValueError:
            continue
        if price <= 0 or prev <= 0:
            continue
        market = "1" if pre == "sh" else "0"
        out[f"{market}.{code}"] = Quote(f"{market}.{code}", code, parts[0],
                                        price, (price / prev - 1) * 100, prev, "sina",
                                        parts[30] + " " + parts[31] if len(parts) > 31 else "")
    return out


# 顺序即优先级：腾讯最稳，放第一位；东财次之；新浪兜底
PROVIDERS = (_from_tencent, _from_eastmoney, _from_sina)


def last_quote_date(secid: str) -> str | None:
    """腾讯行情里的最新成交日期，格式 YYYYMMDD；用于判断今天是否交易日。"""
    url = "https://qt.gtimg.cn/q=" + _to_tx(secid)
    text = _decode(get(url, referer="https://gu.qq.com/", timeout=6, retries=2))
    for line in text.split(";"):
        if "=" not in line:
            continue
        parts = line.partition("=")[2].strip().strip('"').split("~")
        if len(parts) > 30 and len(parts[30]) >= 8:
            return parts[30][:8]
    return None


def fetch(secids: list[str]) -> dict[str, Quote]:
    """按优先级尝试，返回能取到的全部行情。"""
    want = list(dict.fromkeys(secids))
    merged: dict[str, Quote] = {}
    errors = []
    for fn in PROVIDERS:
        missing = [s for s in want if s not in merged]
        if not missing:
            break
        try:
            got = fn(missing)
            merged.update(got)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{fn.__name__}: {exc}")
            continue
    if not merged:
        raise RuntimeError("所有行情源都失败: " + "; ".join(errors))
    return merged
