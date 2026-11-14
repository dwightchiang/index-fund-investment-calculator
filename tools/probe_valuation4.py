# -*- coding: utf-8 -*-
"""从官网前端 JS bundle 里挖真实的估值接口路径。"""
import re
import ssl
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0"
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        return r.read().decode("utf-8", "ignore")


def head(t, ok, detail):
    print(f"\n=== {t}  {'✅' if ok else '❌'}")
    print("  " + detail.replace("\n", " ")[:800])


# ---- 中证官网 ----
try:
    home = fetch("https://www.csindex.com.cn/")
    bundles = re.findall(r'src="([^"]+\.js)"', home) + re.findall(r'href="([^"]+\.js)"', home)
    head("中证首页", True, f"JS 引用 {len(bundles)} 个: {bundles[:6]}")
    hits = set()
    for b in bundles:
        u = b if b.startswith("http") else "https://www.csindex.com.cn" + b
        try:
            js = fetch(u)
        except Exception:
            continue
        for m in re.finditer(r'["\'](/csindex-home/[A-Za-z0-9_/\-]+)["\']', js):
            hits.add(m.group(1))
    val = [x for x in hits if re.search(r"estimat|indicator|perf|valuation", x, re.I)]
    head("中证 csindex-home 接口（估值相关）", bool(val), "\n  ".join(sorted(val)) or f"共 {len(hits)} 个，无估值相关")
except Exception as e:
    head("中证首页", False, repr(e))

# ---- 国证官网 ----
try:
    home = fetch("https://www.cnindex.com.cn/")
    bundles = re.findall(r'src="([^"]+\.js)"', home)
    head("国证首页", True, f"JS 引用 {len(bundles)} 个: {bundles[:6]}")
    hits = set()
    for b in bundles:
        u = b if b.startswith("http") else "https://www.cnindex.com.cn" + b
        try:
            js = fetch(u)
        except Exception:
            continue
        for m in re.finditer(r'["\'](/[A-Za-z0-9_\-]*(?:estimat|valuation|indicator|index)[A-Za-z0-9_/\-]*)["\']', js, re.I):
            hits.add(m.group(1))
    head("国证接口候选", bool(hits), "\n  ".join(sorted(hits)[:40]))
except Exception as e:
    head("国证首页", False, repr(e))
