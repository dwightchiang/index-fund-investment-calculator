"""配置加载。"""
from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class IndexCfg:
    name: str
    code: str
    em_secid: str
    dj_code: str | None = None
    etf: str | None = None
    ps_file: str | None = None


@dataclass
class StrategyCfg:
    trigger: float = 5.0
    window_years: int = 10
    unit_amount: float = 100.0
    multiplier: float = 1.0
    min_amount: float = 0.0
    max_amount: float = 5000.0
    round_amount_to: float = 10.0
    daily_budget: float = 0.0
    round_to_lot: bool = False
    lot_size: int = 100


@dataclass
class DataCfg:
    metrics: list[str] = field(default_factory=lambda: ["pe", "pb", "ps"])
    method: str = "rank_le"
    min_points: int = 60


@dataclass
class NotifyCfg:
    channel: str = "console"
    webhook: str = ""
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_pass: str = ""
    smtp_to: str = ""


@dataclass
class Config:
    path: Path
    root: Path
    strategy: StrategyCfg
    data: DataCfg
    notify: NotifyCfg
    indices: list[IndexCfg]

    # 常用目录
    @property
    def data_dir(self) -> Path:
        return self.root / "data"

    @property
    def out_dir(self) -> Path:
        return self.root / "out"

    @property
    def hist_dir(self) -> Path:
        return self.data_dir / "hist"

    @property
    def manual_dir(self) -> Path:
        return self.data_dir / "manual"

    @property
    def snapshot_file(self) -> Path:
        return self.data_dir / "snapshot.csv"


def _filter(dc, raw: dict) -> dict:
    """只保留 dataclass 里存在的字段，避免用户加注释字段时报错。"""
    names = {f for f in dc.__dataclass_fields__}
    return {k: v for k, v in (raw or {}).items() if k in names}


def load_config(path: str | Path = "config.toml") -> Config:
    p = Path(path).resolve()
    with p.open("rb") as fh:
        raw = tomllib.load(fh)

    indices = [IndexCfg(**_filter(IndexCfg, item)) for item in raw.get("index", [])]
    if not indices:
        raise SystemExit("config.toml 里没有任何 [[index]] 配置")

    return Config(
        path=p,
        root=p.parent,
        strategy=StrategyCfg(**_filter(StrategyCfg, raw.get("strategy"))),
        data=DataCfg(**_filter(DataCfg, raw.get("data"))),
        notify=NotifyCfg(**_filter(NotifyCfg, raw.get("notify"))),
        indices=indices,
    )
