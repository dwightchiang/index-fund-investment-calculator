"""命令行入口：python -m dca <import|update|calc|show|doctor>"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

from . import importer, report, storage
from .config import Config, load_config
from .percentile import compute
from .sources import danjuan, eastmoney, manual, pct_table, quote
from .strategy import Decision, apply_budget, decide

ROOT = Path(__file__).resolve().parent.parent


# ----------------------------------------------------------------- 工具
def _etf_secid(code: str) -> str:
    code = code.strip()
    return ("1." if code[0] in "56" else "0.") + code


def _metric_series(cfg: Config, idx, metric: str) -> tuple[list[tuple[str, float]], str]:
    """返回 (序列, 来源说明)。"""
    if metric in ("pe", "pb") and idx.dj_code:
        path = cfg.hist_dir / f"{idx.code}_{metric}.csv"
        cached = storage.load_series(path)
        try:
            rows = danjuan.history(idx.dj_code, metric)
            if rows:
                storage.save_series(path, rows)
                return rows, "蛋卷"
        except Exception as exc:  # noqa: BLE001
            print(f"  ! {idx.name} {metric} 拉取失败({exc})，使用本地缓存")
        return cached, "蛋卷(缓存)"

    if metric == "ps":
        p = Path(idx.ps_file) if idx.ps_file else cfg.manual_dir / f"{idx.code}_ps.csv"
        rows = manual.load(p)
        return rows, f"手工CSV:{p.name}" if rows else "缺失"

    return [], "缺失"


# ----------------------------------------------------------------- set
def cmd_set(cfg: Config, code: str, pe=None, pb=None, ps=None, pcf=None,
            date: str | None = None, refresh: bool = True) -> int:
    """手工录入一个指数的分位值（手机上看到、电脑上敲一行）。"""
    code = code.strip()
    by_name = {i.name: i.code for i in cfg.indices}
    code = by_name.get(code, code)
    if code not in {i.code for i in cfg.indices}:
        print(f"[set] config.toml 里没有 {code}，可用：{', '.join(i.code for i in cfg.indices)}")
        return 2

    if date is None:
        try:
            date = eastmoney.last_trade_date() or dt.date.today().isoformat()
        except Exception:  # noqa: BLE001
            date = dt.date.today().isoformat()

    rec = {"date": date, "code": code}
    for m, v in (("pe", pe), ("pb", pb), ("ps", ps), ("pcf", pcf)):
        if v is not None:
            try:
                rec[f"{m}_pct"] = float(str(v).replace("%", ""))
            except ValueError:
                print(f"[set] {m} 不是数字：{v}")
                return 2
    if len(rec) <= 2:
        print("[set] 至少要给一个 --pe / --pb / --ps")
        return 2

    name = next((i.name for i in cfg.indices if i.code == code), code)
    parts = [f"{m.upper()} {rec[f'{m}_pct']}" for m in ("pe", "pb", "ps", "pcf") if f"{m}_pct" in rec]
    print(f"[set] {name}({code})  {date}  " + "  ".join(parts))

    changed, total = importer.merge(cfg.manual_dir / "percentiles.csv", [rec])
    print(f"[set] percentiles.csv：新增/更新 {changed} 条，累计 {total} 条")
    if refresh:
        print()
        return cmd_update(cfg)
    return 0


# ----------------------------------------------------------------- import
def cmd_import(cfg: Config, file: str, date: str | None = None, code: str | None = None,
               scale: str = "auto", refresh: bool = True) -> int:
    rows = importer.read_rows(file)
    print(f"[import] 读入 {len(rows)} 行：{file}")

    if date is None:
        try:
            date = eastmoney.last_trade_date() or dt.date.today().isoformat()
            print(f"[import] 没指定 --date，按最近交易日 {date} 记录（如果表里其实是前一交易日，请用 --date 指定）")
        except Exception:  # noqa: BLE001
            date = dt.date.today().isoformat()
            print(f"[import] 没指定 --date 且取不到交易日，按今天 {date} 记录")

    records, notes = importer.parse(rows, cfg, date=date, code=code, scale=scale)
    for n in notes:
        print("  ~", n)

    name_of = {i.code: i.name for i in cfg.indices}
    header = f"{'指数':<10}{'日期':<12}{'PE分位':>9}{'PB分位':>9}{'PS分位':>9}{'PCF分位':>9}"
    print(header)
    print("-" * 62)
    for r in records[:30]:
        def f(m):
            v = r.get(f"{m}_pct")
            return "-" if v is None else f"{v:.2f}"
        print(f"{name_of.get(r['code'], r['code']):<10}{r['date']:<12}"
              f"{f('pe'):>9}{f('pb'):>9}{f('ps'):>9}{f('pcf'):>9}")
    if len(records) > 30:
        print(f"... 其余 {len(records) - 30} 行略")

    changed, total = importer.merge(cfg.manual_dir / "percentiles.csv", records)
    print(f"\n[import] percentiles.csv：新增/更新 {changed} 条，累计 {total} 条")
    if refresh:
        print()
        return cmd_update(cfg)
    return 0


# ----------------------------------------------------------------- update
def cmd_update(cfg: Config) -> int:
    print("[update] 刷新估值序列并计算分位（数据截至上一交易日收盘）")
    manual = pct_table.load(cfg.manual_dir / "percentiles.csv")
    if manual:
        print(f"[update] 读到手工分位表：{len(manual)} 个指数（data/manual/percentiles.csv）")

    rows = []
    for idx in cfg.indices:
        rec = {"name": idx.name, "code": idx.code, "asof": ""}
        asof_candidates = []
        m = manual.get(idx.code, {})
        print(f"  - {idx.name}")
        for metric in cfg.data.metrics:
            # 优先级最高：手工录入的分位值（来自同花顺 / iFinD 的估值分析页面）
            if m.get(f"{metric}_pct") is not None:
                rec[metric] = None
                rec[f"{metric}_pct"] = round(float(m[f"{metric}_pct"]), 2)
                asof_candidates.append(m["date"])
                print(f"      {metric}: 分位 {rec[f'{metric}_pct']}（手工录入，{m['date']}）")
                continue

            series, src = _metric_series(cfg, idx, metric)
            if not series:
                rec[f"{metric}"] = None
                rec[f"{metric}_pct"] = None
                print(f"      {metric}: 无数据（{src}）")
                continue
            last_date = series[-1][0]
            asof_candidates.append(last_date)
            res = compute(series, last_date, cfg.strategy.window_years,
                          cfg.data.method, cfg.data.min_points)
            rec[metric] = res["value"]
            rec[f"{metric}_pct"] = res["percentile"]
            print(f"      {metric}: {res['value']:.4f}  分位 {res['percentile']}  "
                  f"样本 {res['samples']}  ({res['start']} ~ {res['end']}, {src})")

        rec["asof"] = max(asof_candidates) if asof_candidates else ""
        # 数据新鲜度提醒
        if rec["asof"]:
            gap = (dt.date.today() - dt.date.fromisoformat(rec["asof"])).days
            if gap > 7:
                print(f"      ! 数据最新日期 {rec['asof']} 距今 {gap} 天，请检查")
        rows.append(rec)

    storage.write_snapshot(cfg.snapshot_file, rows)
    print(f"\n[update] 已写入 {cfg.snapshot_file}")
    print(_snapshot_table(rows))
    return 0


def _snapshot_table(rows: list[dict]) -> str:
    header = f"{'指数':<10}{'asof':<12}{'PE':>10}{'PE分位':>9}{'PB':>10}{'PB分位':>9}{'PS':>10}{'PS分位':>9}"
    lines = [header, "-" * 80]
    for r in rows:
        def f(k, nd=2):
            v = r.get(k)
            return "-" if v in (None, "") else f"{float(v):.{nd}f}"
        lines.append(
            f"{r['name']:<10}{str(r.get('asof','')):<12}{f('pe'):>10}{f('pe_pct'):>9}"
            f"{f('pb'):>10}{f('pb_pct'):>9}{f('ps'):>10}{f('ps_pct'):>9}"
        )
    return "\n".join(lines)


# ----------------------------------------------------------------- calc
def cmd_calc(cfg: Config, force: bool = False,
             save: bool = True, notify: bool = True) -> int:
    today = dt.date.today()
    ok, why = eastmoney.is_trade_date(today)
    if not ok and not force:
        print(f"[calc] {today} 不是交易日（{why}），跳过。加 --force 可强制计算。")
        return 0

    snap = {r["code"]: r for r in storage.read_snapshot(cfg.snapshot_file)}
    if not snap:
        print("[calc] 没有分位快照，请先运行: python -m dca update")
        return 2
    snap_asof = max((r.get("asof") or "") for r in snap.values())
    if snap_asof:
        try:
            last = eastmoney.last_trade_date()
            if last and snap_asof < last:
                print(f"[calc] 注意：分位快照截至 {snap_asof}，最近交易日已是 {last}，"
                      f"建议先运行 python -m dca update")
        except Exception:  # noqa: BLE001
            pass

    secids = [i.em_secid for i in cfg.indices]
    etf_map = {i.code: i.etf for i in cfg.indices if i.etf and cfg.strategy.round_to_lot}
    secids += [_etf_secid(c) for c in etf_map.values()]
    q = quote.fetch(secids)

    srcs = sorted({qq.source for qq in q.values()})
    stamps = sorted({qq.ts for qq in q.values() if qq.ts})
    print(f"[calc] 行情来源 {'/'.join(srcs)} · {stamps[-1] if stamps else '时间未知'} · 交易日判断：{why}")
    stale = [i.name for i in cfg.indices
             if i.em_secid in q and not q[i.em_secid].ts.startswith(today.strftime("%Y-%m-%d"))
             and not q[i.em_secid].ts.startswith(today.strftime("%Y%m%d"))]
    if stale and not force:
        print(f"[calc] 警告：{len(stale)} 个指数的行情时间不是今天（{', '.join(stale[:5])}），"
              f"涨跌幅可能是上一交易日的，请先确认行情是否正常，或加 --force")

    decisions: list[Decision] = []
    for idx in cfg.indices:
        row = snap.get(idx.code) or {}
        qq = q.get(idx.em_secid)
        pct_chg = qq.pct_chg if qq else 0.0
        if qq is None:
            print(f"  ! {idx.name} 取不到实时行情，涨跌幅按 0 计")
        values = {m: _to_f(row.get(m)) for m in ("pe", "pb", "ps")}
        pcts = {m: _to_f(row.get(f"{m}_pct")) for m in cfg.data.metrics}
        # 只保留配置里启用的指标
        values = {m: values.get(m) for m in cfg.data.metrics}
        etf_price = None
        if idx.etf and cfg.strategy.round_to_lot:
            qe = q.get(_etf_secid(idx.etf))
            etf_price = qe.price if qe else None
        decisions.append(decide(idx.name, idx.code, values, pcts, pct_chg,
                                cfg.strategy, etf=idx.etf, etf_price=etf_price))

    apply_budget(decisions, cfg.strategy.daily_budget)
    rows = [d.as_row() for d in decisions]
    total = sum(float(r["amount"] or 0) for r in rows)

    stamp = dt.datetime.now().strftime("%Y-%m-%d %H%M")
    title = f"指数估值定投 · {today} 收盘前"
    print(f"\n{title}   （估值分位截至 {snap_asof}）")
    print(report.table(rows))
    print(f"\n合计：{total:,.0f} 元")

    if save:
        cfg.out_dir.mkdir(parents=True, exist_ok=True)
        csv_path = cfg.out_dir / f"{stamp.replace(' ', '_')}_result.csv"
        md_path = cfg.out_dir / f"{stamp.replace(' ', '_')}_result.md"
        report.write_csv(rows, csv_path)
        md = report.markdown(rows, title, snap_asof, total)
        md_path.write_text(md, encoding="utf-8")
        print(f"\n已保存：{csv_path.name} / {md_path.name}")
        if notify:
            from .notify import send
            send(cfg.notify, title, md, report.table(rows))
    return 0


def _to_f(v):
    if v in (None, "", "-"):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ----------------------------------------------------------------- show / doctor
def cmd_show(cfg: Config) -> int:
    rows = storage.read_snapshot(cfg.snapshot_file)
    if not rows:
        print("还没有快照，请先运行 python -m dca update")
        return 2
    print(f"快照文件：{cfg.snapshot_file}")
    print(_snapshot_table(rows))
    return 0


def cmd_doctor(cfg: Config) -> int:
    print("== 数据源自检 ==")
    problems = 0

    try:
        q = quote.fetch([cfg.indices[0].em_secid])
        print(f"[OK] 实时行情：{q}")
    except Exception as exc:  # noqa: BLE001
        problems += 1
        print(f"[!!] 实时行情失败：{exc}")

    for idx in cfg.indices[:1]:
        if not idx.dj_code:
            continue
        try:
            d = danjuan.detail(idx.dj_code)
            print(f"[OK] 蛋卷估值：{idx.name} PE={d['pe']} PB={d['pb']} "
                  f"PE分位={d['pe_percentile']} PB分位={d['pb_percentile']}")
            h = danjuan.history(idx.dj_code, "pe")
            print(f"[OK] 蛋卷 PE 历史：{len(h)} 条，{h[0][0]} ~ {h[-1][0]}")
        except Exception as exc:  # noqa: BLE001
            problems += 1
            print(f"[!!] 蛋卷估值失败：{exc}")

    tbl = pct_table.load(cfg.manual_dir / "percentiles.csv")
    if tbl:
        miss = [i.name for i in cfg.indices if i.code not in tbl]
        print(f"[OK] 手工分位表：{len(tbl)} 个指数有分位值"
              + (f"，缺 {', '.join(miss[:6])}{' ...' if len(miss) > 6 else ''}" if miss else ""))
    else:
        print("[~~] 没有 data/manual/percentiles.csv，将用免费源自己算分位")

    missing = [i.name for i in cfg.indices
               if not (Path(i.ps_file) if i.ps_file else cfg.manual_dir / f"{i.code}_ps.csv").exists()]
    if "ps" in cfg.data.metrics and not tbl:
        print(f"[~~] 缺少 PS 数据：{len(missing)} 个指数既没有手工分位，也没有 PS 序列文件")
        print("     两种补法见 data/manual/README.md：percentiles.csv（直接填分位）或 <代码>_ps.csv（填序列）")
    print("== 自检完成 ==" if problems == 0 else f"== 有 {problems} 项异常 ==")
    return 0 if problems == 0 else 1


# ----------------------------------------------------------------- main
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="dca", description="指数估值定投自动化")
    ap.add_argument("-c", "--config", default=str(ROOT / "config.toml"))
    sub = ap.add_subparsers(dest="cmd", required=True)

    p_set = sub.add_parser("set", help="手工录入单个指数的分位值")
    p_set.add_argument("code", help="指数代码或名称，如 000300 / 沪深300")
    p_set.add_argument("--pe", help="市盈率分位")
    p_set.add_argument("--pb", help="市净率分位")
    p_set.add_argument("--ps", help="市销率分位")
    p_set.add_argument("--pcf", help="市现率分位")
    p_set.add_argument("--date", help="分位对应的日期，默认最近交易日")
    p_set.add_argument("--no-refresh", action="store_true", help="只写文件，不刷新快照")

    p_imp = sub.add_parser("import", help="导入同花顺导出的估值表（csv / xlsx）")
    p_imp.add_argument("file", help="导出的文件路径")
    p_imp.add_argument("--date", help="表里没有日期列时，指定分位日期 YYYY-MM-DD")
    p_imp.add_argument("--code", help="导出的是单指数明细时，指定指数代码，如 000300")
    p_imp.add_argument("--scale", default="auto", help="分位量纲：auto / 1 / 100")
    p_imp.add_argument("--no-refresh", action="store_true", help="只写 percentiles.csv，不刷新快照")

    sub.add_parser("update", help="盘后刷新估值序列并计算分位快照")
    p_calc = sub.add_parser("calc", help="收盘前计算当日定投金额")
    p_calc.add_argument("--force", action="store_true", help="非交易日也计算")
    p_calc.add_argument("--no-save", action="store_true", help="不落盘、不推送")
    sub.add_parser("show", help="查看当前分位快照")
    sub.add_parser("doctor", help="数据源自检")

    args = ap.parse_args(argv)
    cfg = load_config(args.config)

    if args.cmd == "set":
        return cmd_set(cfg, args.code, pe=args.pe, pb=args.pb, ps=args.ps,
                       pcf=args.pcf, date=args.date, refresh=not args.no_refresh)
    if args.cmd == "import":
        return cmd_import(cfg, args.file, date=args.date, code=args.code,
                          scale=args.scale, refresh=not args.no_refresh)
    if args.cmd == "update":
        return cmd_update(cfg)
    if args.cmd == "calc":
        return cmd_calc(cfg, force=args.force, save=not args.no_save)
    if args.cmd == "show":
        return cmd_show(cfg)
    if args.cmd == "doctor":
        return cmd_doctor(cfg)
    return 1


if __name__ == "__main__":
    sys.exit(main())
