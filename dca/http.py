"""HTTP 小工具：带重试与统一 UA。"""
from __future__ import annotations

import time
import requests

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

_session = requests.Session()
_session.headers.update({"User-Agent": UA, "Accept": "*/*"})


def get(url: str, *, referer: str | None = None, timeout: int = 15,
        retries: int = 3, backoff: float = 1.2, **kwargs) -> requests.Response:
    headers = kwargs.pop("headers", {}) or {}
    if referer:
        headers["Referer"] = referer
    last = None
    for i in range(retries):
        try:
            r = _session.get(url, headers=headers, timeout=timeout, **kwargs)
            r.raise_for_status()
            return r
        except Exception as exc:  # noqa: BLE001
            last = exc
            if i < retries - 1:
                time.sleep(backoff ** i)
    raise RuntimeError(f"GET {url} 失败: {last}") from last


def get_json(url: str, **kwargs):
    return get(url, **kwargs).json()
