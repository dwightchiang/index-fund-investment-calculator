# -*- coding: utf-8 -*-
"""第三轮：解析中证 indicator.xls 看有没有 PB；再猜国证估值接口。"""
import io
import json
import ssl
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0"
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def fetch(url, referer=None, data=None, timeout=20):
    h = {"User-Agent": UA, "Accept": "*/*"}
    if referer:
        h["Referer"] = referer
    if data:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read()


def head(title, ok, detail):
    print(f"\n=== {title}  {'✅' if ok else '❌'}")
    print("  " + detail.replace("\n", " ")[:700])


# A. 下载两个镜像，看魔数并尝试解析
urls = [
    "https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/H11136indicator.xls",
    "https://www.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/H11136indicator.xls",
]
blobs = []
for u in urls:
    try:
        b = fetch(u, referer="https://www.csindex.com.cn/")
        blobs.append((u, b))
        magic = b[:8].hex()
        head(u.split("/")[2], True, f"{len(b)}B magic={magic} (d0cf11e0=OLE2/xls)")
    except Exception as e:
        head(u.split("/")[2], False, repr(e))

try:
    import xlrd  # noqa
    print("\nxlrd 可用，开始解析…")
    for u, b in blobs:
        try:
            wb = xlrd.open_workbook(file_contents=b)
            sh = wb.sheet_by_index(0)
            rows = [sh.row_values(i) for i in range(min(3, sh.nrows))]
            head(u.split("/")[2] + " 解析", True,
                 f"行数={sh.nrows} 列数={sh.ncols} | 表头={rows[0]} | 首行={rows[1] if len(rows)>1 else ''} | 末行={sh.row_values(sh.nrows-1)}")
        except Exception as e:
            head(u.split("/")[2] + " 解析", False, repr(e))
except ImportError:
    print("\nxlrd 不可用，跳过解析（后面用 pandas/其它方式）")

# B. 国证估值接口再猜
guesses = [
    ("estimation-list POST", "https://www.cnindex.com.cn/index-estimation/estimation-list",
     json.dumps({"indexcode": "399673"}).encode()),
    ("index-estimation GET", "https://www.cnindex.com.cn/index-estimation?indexcode=399673", None),
    ("index/valuation", "https://www.cnindex.com.cn/index/valuation?indexcode=399673", None),
    ("api/index-estimation", "https://www.cnindex.com.cn/api/index-estimation?indexcode=399673", None),
]
for name, u, body in guesses:
    try:
        t = fetch(u, referer="https://www.cnindex.com.cn/", data=body).decode("utf-8", "ignore")
        head(f"国证 {name}", True, f"{len(t)}B | {t[:300]}")
    except Exception as e:
        head(f"国证 {name}", False, repr(e))
