# -*- coding: utf-8 -*-
"""验证线上 GitHub Pages 是否已经是最新那份 index.html。"""
import hashlib
import io
import re
import time
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")
PAGE = "https://dwightchiang.github.io/index-fund-investment-calculator/"

url = PAGE + "?_=" + str(int(time.time()))
req = urllib.request.Request(url, headers={
    "User-Agent": UA,
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
})
t0 = time.time()
with urllib.request.urlopen(req, timeout=30) as r:
    raw = r.read()
    hdrs = dict(r.headers)
    status = r.status
ms = int((time.time() - t0) * 1000)

remote = raw.decode("utf-8", "ignore")
local = io.open("index.html", encoding="utf-8").read()

print(f"HTTP {status}  {ms}ms  远程 {len(raw)} 字节")
for k in ("Last-Modified", "ETag", "Cache-Control", "Age", "Content-Length"):
    if k in hdrs:
        print(f"  {k}: {hdrs[k]}")

m = re.search(r'const VER\s*=\s*"([^"]+)"', remote)
print(f"\n线上版本号: {m.group(1) if m else '❌ 没找到 const VER'}")
print(f"本地版本号: {re.search(r'const VER\s*=\s*\"([^\"]+)\"', local).group(1)}")

print("\n关键特征是否在线:")
for key, label in [
    ('const SHOW_MON = false', '监测隐藏开关'),
    ('id="retry2"', '回撤重试按钮'),
    ('id="addHint"', '添加时查名称提示'),
    ('delgSync', ''),
    ('id="dlgSync"', '跨设备同步弹窗'),
    ('lookupName', '名称自动查询'),
    ('5–10 段', '5-10 分位段'),
    ('renderSoon', '边拉边显示'),
]:
    if not label:
        continue
    print(f"  {'✅' if key in remote else '❌'} {label}")

h_remote = hashlib.sha256(raw).hexdigest()
h_local = hashlib.sha256(local.encode("utf-8")).hexdigest()
print(f"\n线上 sha256: {h_remote[:16]}…")
print(f"本地 sha256: {h_local[:16]}…")
print("结论:", "✅ 线上就是本地这份（逐字节相同）" if h_remote == h_local else "⚠️ 内容不一致")
