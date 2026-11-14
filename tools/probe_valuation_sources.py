# -*- coding: utf-8 -*-
"""实探：中证/国证官网能不能免费拿到估值历史（PE/PB），顺便看韭圈儿/理杏仁的门槛。"""
import json
import io
import ssl
import time
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def get(url, referer=None, timeout=15, raw=False):
    h = {"User-Agent": UA, "Accept": "*/*"}
    if referer:
        h["Referer"] = referer
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        b = r.read()
    return b if raw else b.decode("utf-8", "ignore")


def head(title, ok, detail):
    print(f"\n=== {title}  {'✅' if ok else '❌'}")
    print("  " + detail.replace("\n", " ")[:600])


# ---------- A. 中证官网 index-perf JSON（akshare 同款接口） ----------
for code in ["H11136", "930641", "000922", "000300"]:
    try:
        u = (f"https://www.csindex.com.cn/csindex-home/perf/index-perf?indexCode={code}"
             f"&startDate=20160101&endDate=20261109")
        d = json.loads(get(u, referer="https://www.csindex.com.cn/"))
        data = d.get("data") or []
        if data:
            keys = list(data[0].keys())
            rec = data[-1]
            head(f"中证 index-perf {code}", True,
                 f"共 {len(data)} 条 | 字段: {keys} | 最新: {json.dumps(rec, ensure_ascii=False)}")
        else:
            head(f"中证 index-perf {code}", False, f"空 {str(d)[:200]}")
    except Exception as e:
        head(f"中证 index-perf {code}", False, repr(e))

# ---------- B. 中证官网每只指数的 indicator 历史文件（全历史） ----------
try:
    b = get("https://csi-web-dev.oss-cn-shanghai-finance-1-pub.aliyuncs.com/static/html/csindex/"
            "public/uploads/file/autofile/indicator/H11136indicator.xls",
            referer="https://www.csindex.com.cn/", timeout=20, raw=True)
    head("中证 indicator.xls H11136", True, f"{len(b)} 字节（xls 旧格式，未解析）")
except Exception as e:
    head("中证 indicator.xls H11136", False, repr(e))

# ---------- C. 国证官网 cnindex ----------
cni_tries = [
    ("GET 详情页", "http://www.cnindex.com.cn/index/indexDetail?indexcode=399673", None),
    ("GET 估值接口A", "http://www.cnindex.com.cn/index-estimation/estimation?indexcode=399673", None),
    ("POST 估值接口B", "http://www.cnindex.com.cn/index-estimation/estimation-list",
     json.dumps({"indexcode": "399673", "year": "2026"}).encode()),
]
for name, url, body in cni_tries:
    try:
        h = {"User-Agent": UA, "Accept": "*/*"}
        if body:
            h["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=body, headers=h)
        with urllib.request.urlopen(req, timeout=15, context=CTX) as r:
            t = r.read().decode("utf-8", "ignore")
        head(f"国证 {name}", True, f"{len(t)} 字节 | {t[:300]}")
    except Exception as e:
        head(f"国证 {name}", False, repr(e))

# ---------- D. 韭圈儿 funddb（免费分位，App 同款） ----------
try:
    u = "https://api.jiucaishuo.com/v2/guzhi/showcategory"
    body = json.dumps({"act_time": int(time.time() * 1000), "version": "2.0.0"}).encode()
    req = urllib.request.Request(u, data=body,
                                 headers={"User-Agent": UA, "Content-Type": "application/json"})
    d = json.loads(urllib.request.urlopen(req, timeout=15, context=CTX).read().decode("utf-8", "ignore"))
    head("韭圈儿 分类列表", True, json.dumps(d, ensure_ascii=False)[:400])
except Exception as e:
    head("韭圈儿 分类列表", False, repr(e))

# ---------- E. 理杏仁（看免费门槛） ----------
try:
    t = get("https://lixinger.com/asset/C/CSI/H11136", timeout=15)
    ok = ("市销率" in t) or ("pe" in t.lower())
    head("理杏仁 指数页", ok, f"{len(t)} 字节 | 含市销率字段: {'市销率' in t} | 需要登录: {'登录' in t}")
except Exception as e:
    head("理杏仁 指数页", False, repr(e))
