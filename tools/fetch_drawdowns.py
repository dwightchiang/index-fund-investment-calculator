#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把每个指数的「2026 年内最高价」和「近 10 年最大回撤」算好，写成网页用的 JSON。

为什么要预先算：定投板块要在「📉 回撤对比」按钮打开时，每行显示
    2026 年以来 −x.x%   ｜   10 年最大回撤 −yy.y%

口径（与页面上的 tooltip 一致，改这里必须同步改 index.html 的文案）：
  · 2026 年以来跌幅 = 当前点位 ÷ 2026 年内最高价 − 1
      当前点位由网页实时行情算（盘中会变），这里只提供分母「2026 年内最高价」。
  · 近 10 年最大回撤 = max over t of ( 1 − low[t] / max(high[s] for s <= t) )
      即「从历史最高点一路跌到最低点」的那一段，峰值用盘中最高价、
      谷底用盘中最低价（用户明确要求用 high 口径，比收盘价更接近真实感受）。
      回撤存成正数（71.42 表示 −71.42%）。

数据源（按优先级）：
  1. 雪球 kline  —— 一次 3000 条，覆盖最深到 2014，绝大多数代码有
  2. 中证官网 csindex index-perf —— 雪球没有的中证系列兜底
  3. 腾讯 usfqkline —— 纳斯达克100（usNDX），分段取
别名：1B0932→000932、1B0905→000905、1B0852→000852、1B0680→000680、1B0690→000690
（这几个 1Bxxxx 是中证官网的「内部代码」，雪球/东财要用 0xxxxx 原码。）

用法：
    python tools/fetch_drawdowns.py                 # 拉全量并写 data/drawdowns.json
    python tools/fetch_drawdowns.py --report        # 只打印，不写文件
    python tools/fetch_drawdowns.py --check 参考.json  # 和你手动整理的表交叉校验
只用标准库，GitHub Actions 里免安装依赖。
"""
from __future__ import annotations

import argparse
import datetime as dt
import http.cookiejar
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.request

# Windows 控制台默认 GBK，打印 ✓ / ⚠ / ≠ 会 UnicodeEncodeError
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "data" / "drawdowns.json"

UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    "Accept": "*/*",
}

# 中证官网内部代码 → 雪球/东财的 6 位原码
ALIAS = {
    "1B0932": "000932",   # 中证消费
    "1B0905": "000905",   # 中证500
    "1B0852": "000852",   # 中证1000
    "1B0680": "000680",   # 科创综指
    "1B0690": "000690",   # 科创成长
}

# 定投板块（state.list1）里的全部指数。新增指数时这里也要加，
# 否则网页上那一行的回撤会显示「—」。
DCA_CODES = [
    "NDX", "399997", "931139", "1B0932", "931068", "930641", "000922", "H11136",
    "399989", "980092", "000919", "930743", "931152", "950090", "399975", "000985",
    "1B0905", "399296", "1B0690", "399006", "399673", "399295", "399976", "931071",
    "930901", "000813", "931079", "399808", "931719", "931247", "980138", "1B0680",
    "1B0852", "930851", "932365", "399363", "930713",
]

WINDOW_YEARS = 10
START_2026 = "2026-01-01"


# ---------------------------------------------------------------- 数据源
class XQ:
    """雪球：需要先取一个 cookie，否则返回 400。"""

    def __init__(self):
        self.op = None

    def _ensure(self):
        if self.op is not None:
            return self.op
        cj = http.cookiejar.CookieJar()
        op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        op.addheaders = list(UA.items())
        try:
            op.open("https://xueqiu.com/", timeout=25).read()
        except Exception:  # noqa: BLE001  取不到 cookie 也继续，后面会失败并换源
            pass
        self.op = op
        return op

    def fetch(self, sym: str, count: int = 3000):
        """返回 [(YYYY-MM-DD, high, low, close), ...] 升序，失败返回 None。"""
        op = self._ensure()
        url = ("https://stock.xueqiu.com/v5/stock/chart/kline.json"
               f"?symbol={sym}&begin={int(time.time() * 1000)}"
               f"&period=day&type=before&count=-{count}&indicator=kline")
        for attempt in range(2):
            try:
                raw = op.open(url, timeout=35).read().decode("utf-8", "ignore")
                data = (json.loads(raw) or {}).get("data") or {}
                item, col = data.get("item"), data.get("column") or []
                if not item:
                    return None
                i_hi, i_lo, i_c = col.index("high"), col.index("low"), col.index("close")
                rows = []
                for r in item:
                    day = dt.datetime.fromtimestamp(r[0] / 1000, dt.timezone.utc).strftime("%Y-%m-%d")
                    rows.append((day, float(r[i_hi]), float(r[i_lo]), float(r[i_c])))
                return rows
            except Exception:  # noqa: BLE001
                if attempt == 0:
                    self.op = None          # cookie 过期 → 重取一次
                    self._ensure()
                    time.sleep(0.8)
        return None


def csindex(code: str):
    """中证官网全量日线，返回 [(day, high, low, close), ...]。"""
    url = ("https://www.csindex.com.cn/csindex-home/perf/index-perf"
           f"?indexCode={code}&startDate=20160101&endDate=20500101")
    for attempt in range(2):
        try:
            req = urllib.request.Request(
                url, headers={**UA, "Referer": "https://www.csindex.com.cn/"})
            raw = urllib.request.urlopen(req, timeout=35).read().decode("utf-8", "ignore")
            arr = (json.loads(raw) or {}).get("data") or []
            if not arr:
                return None
            rows = []
            for x in arr:
                d = str(x.get("tradeDate") or "")
                if len(d) != 8:
                    continue
                hi, lo, c = x.get("high"), x.get("low"), x.get("close")
                if hi is None or lo is None:
                    continue
                rows.append((f"{d[:4]}-{d[4:6]}-{d[6:8]}", float(hi), float(lo),
                             float(c if c is not None else lo)))
            return rows or None
        except Exception:  # noqa: BLE001
            time.sleep(1.5 * (attempt + 1))
    return None


def tencent_us(code: str = "usNDX"):
    """腾讯美股日线：单次最多 1300 条，按年份分段取，合并去重。"""
    segs = [("2016-01-01", "2021-12-31"), ("2021-06-01", "2026-12-31")]
    got: dict[str, tuple] = {}
    for beg, end in segs:
        n = 1300
        url = ("https://web.ifzq.gtimg.cn/appstock/app/usfqkline/get"
               f"?param={code},day,{beg},{end},{n},qfq")
        try:
            raw = urllib.request.urlopen(
                urllib.request.Request(url, headers=UA), timeout=35
            ).read().decode("utf-8", "ignore")
            i = raw.find("{")
            j = (json.loads(raw[i:]) or {}).get("data") or {}
            rows = (j.get(code) or {}).get("day") or []
            for r in rows:
                # [日期, 开, 收, 高, 低, 量]  ← 注意是「收」在「高」前面
                got[r[0]] = (r[0], float(r[3]), float(r[4]), float(r[2]))
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.8)
    if not got:
        return None
    return [got[k] for k in sorted(got)]


# ---------------------------------------------------------------- 计算
def _max_dd(rows):
    """峰谷最大回撤 + 起止日期 + 持续天数。

    定义（和网页 tooltip 一致）：
      对每一段「先创新高、再回落」，用 峰值(盘中最高价) 对 之后的最低价(盘中最低价)
      算跌幅；取跌幅最大的那一段。
      起止日 = 峰值日 → 谷底日；持续天数 = 两个日期的自然日差。
    返回 dict，没有回撤时返回 None。
    """
    peak = peak_day = None
    best = None
    for day, hi, lo, _close in rows:
        if peak is None or hi > peak:
            peak, peak_day = hi, day
        if not peak or peak <= 0:
            continue
        dd = (1 - lo / peak) * 100
        if best is None or dd > best["pct"]:
            try:
                days = (dt.date.fromisoformat(day) - dt.date.fromisoformat(peak_day)).days
            except ValueError:
                days = None
            best = {"pct": dd, "peak": peak, "peakDate": peak_day,
                    "trough": lo, "troughDate": day, "days": days}
    return best


def stats(rows, today: dt.date):
    """从日线算：2026 年内最高价、10 年最大回撤、历史最大回撤。"""
    if not rows:
        return None
    win_start = (today - dt.timedelta(days=365 * WINDOW_YEARS + 5)).isoformat()

    hi2026 = hi2026_day = None
    last_close = rows[-1][3]
    for day, hi, lo, close in rows:
        if day >= START_2026 and (hi2026 is None or hi > hi2026):
            hi2026, hi2026_day = hi, day
    if hi2026 is None:
        best_row = max(rows, key=lambda r: r[1])
        hi2026, hi2026_day = best_row[1], best_row[0]

    # 10 年窗口
    win_rows = [r for r in rows if r[0] >= win_start]
    dd10 = _max_dd(win_rows) if win_rows else None

    # 全部历史（数据里能找到的最早一条起）
    ddall = _max_dd(rows)

    # 全部历史最高点
    hi_all, hi_all_day = max(((r[1], r[0]) for r in rows), default=(None, None))

    # 数据是不是真的覆盖满 10 年（浅的指数要如实标注，不能假装是 10 年）
    covered_from = win_rows[0][0] if win_rows else (rows[0][0] if rows else None)
    partial = bool(covered_from and covered_from > (today - dt.timedelta(days=365 * 9)).isoformat())

    def pack(d, prefix):
        if not d:
            return {prefix: None, prefix + "Peak": None, prefix + "PeakDate": None,
                    prefix + "Trough": None, prefix + "TroughDate": None,
                    prefix + "Days": None}
        return {
            prefix: round(d["pct"], 2),
            prefix + "Peak": round(d["peak"], 4),
            prefix + "PeakDate": d["peakDate"],
            prefix + "Trough": round(d["trough"], 4),
            prefix + "TroughDate": d["troughDate"],
            prefix + "Days": d["days"],
        }

    out = {
        "hi2026": round(hi2026, 4) if hi2026 else None,
        "hi2026Date": hi2026_day,
        "hiAll": round(hi_all, 4) if hi_all else None,
        "hiAllDate": hi_all_day,
        "partial": partial,
        "coveredFrom": covered_from,
        "first": rows[0][0],
        "last": rows[-1][0],
        "lastClose": round(last_close, 4),
        "n": len(rows),
    }
    out.update(pack(dd10, "dd10"))
    out.update(pack(ddall, "ddAll"))
    return out


def em_kline(code: str):
    """东方财富全量日线。980138（存储芯片）这类国证指数只有这里有。

    东财 secid：6 位数字且 0/1/3 开头 → 沪 1.码 / 深 0.码；98xxxx 是深市 0.码。
    返回 [(day, high, low, close), ...]，失败返回 None。
    """
    c = ALIAS.get(code, code)
    if not re.fullmatch(r"\d{6}", c):
        return None
    secids = [f"0.{c}", f"1.{c}"] if c[0] in "03" else [f"1.{c}", f"0.{c}"]
    if c.startswith("98"):
        secids = [f"0.{c}"]                    # 国证 98xxxx 只在深市
    for secid in secids:
        url = ("https://push2his.eastmoney.com/api/qt/stock/kline/get"
               f"?secid={secid}&fields1=f1,f2,f3,f4,f5,f6"
               f"&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1"
               f"&beg=19900101&end=20500101&lmt=8000")
        try:
            req = urllib.request.Request(
                url, headers={**UA, "Referer": "https://quote.eastmoney.com/"})
            raw = urllib.request.urlopen(req, timeout=35).read().decode("utf-8", "ignore")
            klines = ((json.loads(raw) or {}).get("data") or {}).get("klines") or []
            if not klines:
                continue
            rows = []
            for k in klines:
                f = k.split(",")
                if len(f) < 6:
                    continue
                # fields2=f51,f52,f53,f54,f55,f56
                # → f[0]日期 f[1]开 f[2]收 f[3]高 f[4]低 f[5]量
                rows.append((f[0], float(f[3]), float(f[4]), float(f[2])))
            if rows:
                return rows
        except Exception:  # noqa: BLE001
            pass
        time.sleep(1.0)
    return None


def resolve(code: str, xq: XQ):
    """为一个代码找数据：把所有源都试一遍，取**历史最长**的那份。

    为什么要比较而不是「第一个成功就用」：
      雪球对 930641（中证中药）只给到 2018-08 起（该指数 2018 年才发布），
      但中证官网有 2016-01 起的回溯数据。用雪球那份会把 10 年窗口算窄，
      最大回撤被低估。所以按「最早的那条日线」排序取最优。
    """
    cands = []      # [(rows, src)]
    tried = []
    syms = [code] if code == "NDX" else [code, "SH" + code, "SZ" + code, "CSI" + code]
    for sym in syms:
        rows = xq.fetch(sym)
        if rows:
            cands.append((rows, "雪球:" + sym))
            break               # 雪球自带前缀探测，命中一个就够
        tried.append("雪球:" + sym)
        time.sleep(0.4)
    for cd in ([ALIAS[code]] if code in ALIAS else []) + [code]:
        rows = csindex(cd)
        if rows:
            cands.append((rows, "中证:" + cd))
            break
        tried.append("中证:" + cd)
        time.sleep(0.8)

    # 东财只在「前两个源没拿到」或「拿到的不够 10 年」时才去问 ——
    # 它最全但也最慢（每只 1~3 秒），不能每只都等它。
    need_more = (not cands) or (min(c[0][0][0] for c in cands) >
                                (dt.date.today() - dt.timedelta(days=365 * 9)).isoformat())
    if need_more:
        rows = em_kline(code)
        if rows:
            cands.append((rows, "东财:" + ALIAS.get(code, code)))
        else:
            tried.append("东财:" + ALIAS.get(code, code))

    if not cands:
        return None, "未取到（" + "、".join(tried[:4]) + "…）"
    # 起点最早的那份最完整；起点相同则取最后一条更新的
    best = min(cands, key=lambda c: (c[0][0][0], -len(c[0])))
    return best[0], best[1]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--report", action="store_true", help="只打印，不写文件")
    ap.add_argument("--check", default="", help="参考 JSON（{code: 高点} 或本脚本同构），用来自查")
    ap.add_argument("--codes", default="", help="只跑这几个代码，逗号分隔")
    args = ap.parse_args()

    codes = [c.strip() for c in args.codes.split(",") if c.strip()] or DCA_CODES
    today = dt.date.today()
    xq = XQ()
    items: dict[str, dict] = {}
    fails: list[str] = []

    for i, code in enumerate(codes, 1):
        if code == "NDX":
            rows, src = tencent_us("usNDX"), "腾讯:usNDX"
            if not rows:
                rows, src = resolve(code, xq)
        else:
            rows, src = resolve(code, xq)
        st = stats(rows, today) if rows else None
        if not st:
            fails.append(code)
            print(f"[{i:2}/{len(codes)}] {code:8} ✗ {src}", flush=True)
            continue
        st["src"] = src
        items[code] = st
        flag = " ⚠10年窗口不全" if st["partial"] else ""
        print(f"[{i:2}/{len(codes)}] {code:8} ✓ {src:22} "
              f"数据 {st['first']}→{st['last']}", flush=True)
        print(f"          2026年内高={st['hi2026']} ({st['hi2026Date']})", flush=True)
        for pfx, label in (("dd10", "10年最大回撤"), ("ddAll", "历史最大回撤")):
            if st.get(pfx) is None:
                print(f"          {label}=—（数据不足）")
                continue
            print(f"          {label}={st[pfx]}%  "
                  f"{st[pfx+'PeakDate']}({st[pfx+'Peak']}) → "
                  f"{st[pfx+'TroughDate']}({st[pfx+'Trough']})  历经 {st[pfx+'Days']} 天{flag}")

    out = {
        "updated": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec="seconds"),
        "basis": "2026以来=当前/2026年内最高价-1；10年最大回撤=峰(high)到谷(low)最大跌幅，存正数",
        "window10yFrom": (today - dt.timedelta(days=365 * WINDOW_YEARS + 5)).isoformat(),
        "source": "雪球 kline / 中证官网 index-perf / 腾讯 usfqkline",
        "items": items,
        "missing": fails,
    }

    if args.check:
        ref = json.loads(pathlib.Path(args.check).read_text(encoding="utf-8-sig"))
        ref = ref.get("items", ref)
        print("\n---- 与参考表交叉校验（你的表只作参考，不一致以接口为准）----")
        print("     你那张表给的是「历史最高点」，所以跟 hiAll 比；2026 年内最高另列。")
        bad = 0
        for code, v in ref.items():
            mine = items.get(code) or {}
            ref_hi = v.get("hiAll", v.get("high", v.get("hi2026"))) if isinstance(v, dict) else v
            if ref_hi is None:
                continue
            try:
                ref_hi = float(ref_hi)
            except (TypeError, ValueError):
                continue
            if mine.get("hiAll") is None:
                print(f"  ? {code:8} 接口无数据，参考={ref_hi}")
                continue
            diff = abs(mine["hiAll"] - ref_hi) / ref_hi * 100
            ok = diff < 0.5
            if not ok:
                bad += 1
            mark = "✓" if ok else "≠"
            print(f"  {mark} {code:8} 接口历史高={mine['hiAll']:<12} 参考={ref_hi:<12} "
                  f"差 {diff:5.2f}%   2026年内高={mine.get('hi2026')}")
        print(f"  不一致 {bad} 条（≠ 的多半是参考表把「历史高」写成了某个更早点位，或指数改过基期）")

    print(f"\n成功 {len(items)} / {len(codes)}，取不到：{fails or '无'}")
    if args.report:
        return 0 if items else 1

    out_path = pathlib.Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"已写入 {out_path}")
    return 0 if len(items) >= len(codes) * 0.8 else 1


if __name__ == "__main__":
    sys.exit(main())
