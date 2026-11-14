# -*- coding: utf-8 -*-
"""第二轮：中证官网的 PB/指标文件镜像 + 国证官网真实接口。"""
import json
import ssl
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def fetch(url, referer=None, data=None, timeout=15):
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
    print("  " + detail.replace("\n", " ")[:500])


# A. 中证指标文件的其它镜像（有没有 PB）
hosts = [
    "https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/H11136indicator.xls",
    "https://www.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/indicator/H11136indicator.xls",
    "https://csi-web-dev.oss-cn-shanghai-finance-1-pub.aliyuncs.com/static/html/csindex/public/uploads/file/autofile/closeweight/H11136closeweight.xls",
]
for u in hosts:
    try:
        b = fetch(u, referer="https://www.csindex.com.cn/", timeout=20)
        head(u.split("/")[-1], True, f"{len(b)} 字节")
    except Exception as e:
        head(u.split("/")[-1], False, repr(e))

# B. 中证官网"估值数据"整表接口（每天全市场一个文件）
try:
    u = "https://www.csindex.com.cn/csindex-home/index-list/query-index-item"
    body = json.dumps({"sorter": {}, "pager": {"page": 1, "pageNum": 5},
                       "indexFilter": {"ifTracked": False, "ifWeightCapped": False,
                                        "customizedBy": 0, "indexCompliance": []}}).encode()
    d = json.loads(fetch(u, referer="https://www.csindex.com.cn/#/dataService/indexEstimation",
                         data=body).decode("utf-8", "ignore"))
    head("中证 query-index-item", True, json.dumps(d, ensure_ascii=False)[:400])
except Exception as e:
    head("中证 query-index-item", False, repr(e))

# C. 国证官网：https + 常见接口路径
cni = [
    ("详情页 https", "https://www.cnindex.com.cn/index/indexDetail?indexcode=399673", None),
    ("接口 intro", "https://www.cnindex.com.cn/index-intro?indexcode=399673", None),
    ("接口 估值", "https://www.cnindex.com.cn/index-estimation/estimation?indexcode=399673", None),
    ("接口 指数列表", "https://www.cnindex.com.cn/index/indexList?channelCode=-1&rows=5&pageNum=1", None),
]
for name, u, body in cni:
    try:
        t = fetch(u, referer="https://www.cnindex.com.cn/", data=body).decode("utf-8", "ignore")
        head(f"国证 {name}", True, f"{len(t)} 字节 | {t[:260]}")
    except Exception as e:
        head(f"国证 {name}", False, repr(e))
