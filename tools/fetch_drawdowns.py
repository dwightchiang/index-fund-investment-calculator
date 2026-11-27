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
# 「这一轮」的起点：2024-09-24（A 股 924 行情启动日）。
# 用户要求把原来的「2026 以来」换成「2024-09-24 以来」——
# 244 那波拉起来之后的高点，才是现在这轮下跌该比的那个顶。
START_24 = "2024-09-24"


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
    """中证官网全量日线，返回 [(day, high, low, close), ...]。

    ★ startDate 必须给 19900101，不能写 2016：
      中证官网会返回**指数发布之前**的回溯数据（000852 能回到 2005、
      930901 能回到 2013），这些正是「历史最大回撤」需要的。
      以前写死 20160101，白丢了一半历史，10年/历史两个回撤都算小。
    首行 tradeDate 常是 19900101 这种占位行（high/low 为 null），
    靠「high is None 就跳过」自然过滤掉。
    """
    url = ("https://www.csindex.com.cn/csindex-home/perf/index-perf"
           f"?indexCode={code}&startDate=19900101&endDate=20500101")
    for attempt in range(3):
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
                if d == "19900101":
                    # ★ 占位行：中证官网总在开头塞一条 tradeDate=19900101，
                    #   数值与真正的首日一模一样（如 930901 首两行都是
                    #   1006.7/986.58/1000.61）。这条不删，历史回撤窗口会被
                    #   假拉长 20 年，「历史最大回撤」直接错。
                    continue
                hi, lo, c = x.get("high"), x.get("low"), x.get("close")
                # ★ 有些指数（如 931247 中证信创）在 2017-12-29 ~ 2023-08-25
                #   这段只给 close，high/low 是 null。这时用 close 当高低价 ——
                #   close-only 的回撤略小于盘中口径，但总比丢掉这 5 年半历史、
                #   让「历史最大回撤」只看最近 3 年强得多。
                if c is None:
                    continue
                if not hi or not lo:
                    hi = lo = c
                rows.append((f"{d[:4]}-{d[4:6]}-{d[6:8]}", float(hi), float(lo),
                             float(c)))
            # 再去一次重：相邻两天数值完全相同 → 前一条是占位
            out = []
            for r in rows:
                if out and r[1:] == out[-1][1:] and r[0] != out[-1][0]:
                    out[-1] = r                # 保留日期更晚的那条
                    continue
                out.append(r)
            return out or None
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
    """从日线算：2024-09-24 以来的两个回撤、10 年最大回撤、历史最大回撤。"""
    if not rows:
        return None
    win_start = (today - dt.timedelta(days=365 * WINDOW_YEARS + 5)).isoformat()

    # 「2024-09-24 以来」这个窗口（这一轮行情的起点，用户指定的口径）
    rows24 = [r for r in rows if r[0] >= START_24]
    last_close = rows[-1][3]

    # ① 24-09-24 以来的**峰谷最大回撤**（区间内先创新高、再回落的最大跌幅）
    dd24 = _max_dd(rows24) if rows24 else None

    # ② 24-09-24 以来的**最高点 → 当前点位**的回撤（含当前价，前端用实时价重算）
    hi24 = hi24_day = None
    for day, hi, lo, close in rows24:
        if hi24 is None or hi > hi24:
            hi24, hi24_day = hi, day
    if hi24 is None:                       # 数据没覆盖到这个日期 → 退回全历史最高
        best_row = max(rows, key=lambda r: r[1])
        hi24, hi24_day = best_row[1], best_row[0]

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
        # ② 最高点（前端拿实时价算「最高点→当前」的回撤）
        "hi24": round(hi24, 4) if hi24 else None,
        "hi24Date": hi24_day,
        # 兼容旧字段（前端已改用 hi24，这里留着免得别处引用报错）
        "hi2026": round(hi24, 4) if hi24 else None,
        "hi2026Date": hi24_day,
        "hiAll": round(hi_all, 4) if hi_all else None,
        "hiAllDate": hi_all_day,
        "partial": partial,
        "coveredFrom": covered_from,
        "first": rows[0][0],
        "last": rows[-1][0],
        "lastClose": round(last_close, 4),
        "n": len(rows),
    }
    out.update(pack(dd24, "dd24"))         # ① 24-09-24 以来峰谷最大回撤
    out.update(pack(dd10, "dd10"))
    out.update(pack(ddall, "ddAll"))
    return out


def em_kline(code: str, expect: str = ""):
    """东方财富全量日线。980138（存储芯片）这类国证指数只有这里有。

    ★ 必须校验返回的 name，不能只看「拿到数据就算成功」：
      东财 secid 前缀决定市场，同一串数字在不同市场可能是完全不同的东西。
      实例：000852 在 1. 是中证1000（点位 5982），在 0. 是深市「石化机械」
      这只股票（点位 4.59、数据还能追到 1998）。不校验就会把个股当成指数，
      算出 91% 的假回撤。
    所以这里按「市场 + 名称」双校验：候选 secid 全试一遍，只接受
    name 里含「指数/CS/中证/国证/科创/创业」等指数特征、或与 expect 吻合的那份。

    expect：期望的名称关键词（如 "中证1000"），给了就更严格。
    返回 [(day, high, low, close), ...]，失败返回 None。
    """
    c = ALIAS.get(code, code)
    if not re.fullmatch(r"\d{6}", c):
        return None
    # 候选市场：指数优先按「沪市 1. / 深市 0.」都试，靠 name 校验挑对的那个
    if c.startswith("98"):
        secids = [f"0.{c}"]                    # 国证 98xxxx 确实只在深市
    elif c.startswith("000") or c.startswith("880") or c.startswith("H"):
        secids = [f"1.{c}", f"0.{c}"]          # 沪市指数（中证/上证系列）
    elif c[0] in "03":
        secids = [f"0.{c}", f"1.{c}"]          # 深市指数
    else:
        secids = [f"1.{c}", f"0.{c}"]

    INDEX_HINT = ("指数", "CS", "中证", "国证", "上证", "深证", "科创", "创业",
                  "全指", "价值", "成长", "红利", "消费", "医药", "银行", "证券")
    # 这些名字一出现就说明是**个股**，无论市场前缀都拒
    STOCK_HINT = ("股份", "科技", "机械", "电子", "药业", "集团", "实业", "能源",
                  "材料", "环保", "生物", "通信", "汽车", "地产", "电力")
    for secid in secids:
        url = ("https://push2his.eastmoney.com/api/qt/stock/kline/get"
               f"?secid={secid}&fields1=f1,f2,f3,f4,f5,f6"
               f"&fields2=f51,f52,f53,f54,f55,f56&klt=101&fqt=1"
               f"&beg=19900101&end=20500101&lmt=8000")
        try:
            req = urllib.request.Request(
                url, headers={**UA, "Referer": "https://quote.eastmoney.com/"})
            raw = urllib.request.urlopen(req, timeout=35).read().decode("utf-8", "ignore")
            node = (json.loads(raw) or {}).get("data") or {}
            klines = node.get("klines") or []
            if not klines:
                continue
            name = str(node.get("name") or "")
            # ★ 校验规则：
            #   1) 给了 expect → 必须命中 expect（最严格）
            #   2) 名字里有个股特征词 → 一定是股票，拒
            #   3) 名字像指数（含「指数」等）→ 收
            #   4) 都不像但也不像个股（如「存储芯片」「中证白酒」这类纯主题名）→ 收，
            #      因为东财的指数名称常常就是纯主题词，没有「指数」二字。
            if expect:
                ok = expect in name
            elif any(h in name for h in STOCK_HINT):
                ok = False
            else:
                ok = True
            if not ok:
                print(f"          ⚠ 跳过 {secid}（名称「{name}」不像指数）", flush=True)
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

    用户的要求是「所有指数都请以行情数据最长的数据来源为准」，
    所以这里必须**真的比较**，不能命中一个源就 break：
      · 雪球   —— 覆盖广，但深的指数只给最近 3000 条（约 12 年）
      · 中证官网 —— 会给指数发布前的回溯数据，000852 能到 2005、930901 到 2013
      · 东财   —— 980138 这类国证指数只有它有；但最慢（每只 1~3 秒）
    最后按「最早那条日线」挑起点最早的一份。

    为了不做无用功：雪球命中后仍然问中证官网（它常常更深）；
    东财只在「前两个源都没拿到」或「中证官网也没把 10 年填满」时才问。
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

    # 中证官网：中证系列（93xxxx/95xxxx/Hxxxx/000xxx）都值得问，它常常最深
    for cd in ([ALIAS[code]] if code in ALIAS else []) + [code]:
        if not re.fullmatch(r"(\d{6}|H\d{5})", cd):
            continue
        rows = csindex(cd)
        if rows:
            cands.append((rows, "中证:" + cd))
            break
        tried.append("中证:" + cd)
        time.sleep(0.8)

    # 东财兜底：前两个源没拿到，或拿到的最早一条还没盖住 10 年
    ten_years_ago = (dt.date.today() - dt.timedelta(days=365 * 10)).isoformat()
    best_start = min((c[0][0][0] for c in cands), default="9999")
    if best_start > ten_years_ago:
        rows = em_kline(code)
        if rows:
            cands.append((rows, "东财:" + ALIAS.get(code, code)))
        else:
            tried.append("东财:" + ALIAS.get(code, code))
    if not cands:
        return None, "未取到（" + "、".join(tried[:4]) + "…）"
    # 起点最早的最完整；起点相同取条数多的
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
        print(f"          2024-09-24 以来最高={st['hi24']} ({st['hi24Date']})", flush=True)
        for pfx, label in (("dd24", "24以来最大回撤"), ("dd10", "10年最大回撤"),
                           ("ddAll", "历史最大回撤")):
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
