"""定投规则：分位 → 分数 → 金额。"""
from __future__ import annotations

from dataclasses import dataclass, field

from .config import StrategyCfg

METRIC_NAMES = {"pe": "市盈率", "pb": "市净率", "ps": "市销率"}


@dataclass
class Decision:
    name: str
    code: str
    etf: str | None = None
    values: dict[str, float | None] = field(default_factory=dict)   # 指标当前值
    pcts: dict[str, float | None] = field(default_factory=dict)     # 指标分位
    pct_chg: float = 0.0        # 当日涨跌幅（%）
    base_metric: str | None = None
    base_pct: float | None = None
    score: float | None = None
    amount: float = 0.0
    shares: int | None = None
    triggered: bool = False
    note: str = ""

    def as_row(self) -> dict:
        return {
            "name": self.name,
            "code": self.code,
            "etf": self.etf or "",
            "pe": self.values.get("pe"),
            "pb": self.values.get("pb"),
            "ps": self.values.get("ps"),
            "pe_pct": self.pcts.get("pe"),
            "pb_pct": self.pcts.get("pb"),
            "ps_pct": self.pcts.get("ps"),
            "pct_chg": round(self.pct_chg, 2),
            "base_metric": METRIC_NAMES.get(self.base_metric or "", ""),
            "base_pct": self.base_pct,
            "score": None if self.score is None else round(self.score, 3),
            "amount": round(self.amount, 2),
            "shares": self.shares,
            "triggered": "Y" if self.triggered else "",
            "note": self.note,
        }


def _round_to(value: float, step: float) -> float:
    if step and step > 0:
        return round(round(value / step) * step, 2)
    return round(value, 2)


def decide(
    name: str,
    code: str,
    values: dict[str, float | None],
    pcts: dict[str, float | None],
    pct_chg: float,
    cfg: StrategyCfg,
    etf: str | None = None,
    etf_price: float | None = None,
) -> Decision:
    d = Decision(name=name, code=code, etf=etf, values=values, pcts=pcts, pct_chg=pct_chg)

    avail = {m: p for m, p in pcts.items() if p is not None}
    if not avail:
        d.note = "没有可用的估值分位"
        return d

    # 多个指标低于阈值时取最低的那个
    d.base_metric = min(avail, key=avail.get)
    d.base_pct = avail[d.base_metric]

    if d.base_pct >= cfg.trigger:
        d.note = f"最低分位 {d.base_pct:.2f} ≥ {cfg.trigger:g}，不投"
        return d

    d.triggered = True
    # 分数 = (阈值 5 - 最低分位) + 当日跌幅（当日上涨则减去涨幅）
    # 分位越低，离阈值越远，分数越高；再叠加当日跌幅，越跌越买
    raw_score = (cfg.trigger - d.base_pct) - pct_chg
    d.score = max(0.0, raw_score)
    raw = cfg.unit_amount * d.score * cfg.multiplier

    raw = max(raw, cfg.min_amount)
    raw = min(raw, cfg.max_amount)
    d.amount = max(0.0, _round_to(raw, cfg.round_amount_to))

    if raw_score <= 0:
        d.note = f"分数为负（涨幅抵消了分位），按最低金额 {cfg.min_amount:g} 处理"

    if cfg.round_to_lot and etf_price and etf_price > 0:
        lot = int(d.amount // (etf_price * cfg.lot_size)) * cfg.lot_size
        d.shares = lot
        d.amount = round(lot * etf_price, 2)
        if lot == 0:
            d.note = "不足 1 手（100 份），按 0 处理"

    d.note = d.note or f"{METRIC_NAMES[d.base_metric]}分位最低"
    return d


def apply_budget(decisions: list[Decision], budget: float) -> None:
    """总金额超过预算时按比例缩放。"""
    if budget and budget > 0:
        total = sum(d.amount for d in decisions)
        if total > budget:
            k = budget / total
            for d in decisions:
                d.amount = round(d.amount * k, 2)
                d.note = (d.note + f"；按预算缩放×{k:.2f}").strip("；")
