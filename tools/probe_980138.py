# -*- coding: utf-8 -*-
"""980138 存储芯片：逐个源探测有没有行情。"""
import json
import ssl
import time
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def get(url, referer=None, timeout=15):
    h = {"User-Agent": UA, "Accept": "*/*"}
    if referer:
        h["Referer"] = referer
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read()


print("== 腾讯 ==")
for q in ["sz980138", "sh980138"]:
    try:
        t = get(f"https://qt.gtimg.cn/q={q}&_={int(time.time()*1000)}", timeout=12).decode("gbk", "ignore")
        m = t.split("~")
        print(f"  {q}: {'有 ' if len(m) > 40 and m[3] else '无 '}  名称={m[1] if len(m)>1 else ''} 现价={m[3] if len(m)>3 else ''}")
    except Exception as e:
        print(f"  {q}: ERR {e}")

print("== 东财 ==")
for secid in ["2.980138", "0.980138", "1.980138"]:
    try:
        t = get(f"https://push2.eastmoney.com/api/qt/ulist.np/get?secids={secid}"
                f"&fields=f2,f3,f12,f14&fltt=2&invt=2&_={int(time.time()*1000)}",
                referer="https://quote.eastmoney.com/").decode("utf-8", "ignore")
        d = json.loads(t)
        it = ((d.get("data") or {}).get("diff") or [{}])[0]
        print(f"  {secid}: {it.get('f14','无')} 现价={it.get('f2')}")
    except Exception as e:
        print(f"  {secid}: ERR {e}")

print("== 雪球 ==")
try:
    req = urllib.request.Request("https://xueqiu.com/", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15, context=CTX) as r:
        cookie = "; ".join(c.split(";")[0] for c in (r.headers.get_all("Set-Cookie") or []))
    for sym in ["CSI980138", "SZ980138"]:
        try:
            t = get(f"https://stock.xueqiu.com/v5/stock/quote.json?symbol={sym}&extend=detail",
                    timeout=15).decode("utf-8", "ignore")
            d = json.loads(t)
            q = (d.get("data") or {}).get("quote") or {}
            print(f"  {sym}: {q.get('name','无')} 现价={q.get('current')} 涨跌={q.get('percent')}")
        except Exception as e:
            print(f"  {sym}: ERR {e}")
except Exception as e:
    print(f"  cookie: ERR {e}")

print("== 同花顺 ==")
for pre in ["zs", "bk"]:
    try:
        t = get(f"https://d.10jqka.com.cn/v6/line/{pre}_980138/01/today.js",
                referer="https://q.10jqka.com.cn/").decode("utf-8", "ignore")
        print(f"  {pre}_980138: {'有' if 'quotebridge' in t else '无'} | {t[:120]}")
    except Exception as e:
        print(f"  {pre}_980138: ERR {e}")
