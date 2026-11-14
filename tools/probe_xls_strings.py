# -*- coding: utf-8 -*-
"""不装 xlrd：直接从 BIFF8 的 SST 里抠字符串，看中证 indicator.xls 有哪些列。"""
import re
import ssl
import urllib.request

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0"
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

url = ("https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/"
       "indicator/H11136indicator.xls")
req = urllib.request.Request(url, headers={"User-Agent": UA,
                                           "Referer": "https://www.csindex.com.cn/"})
b = urllib.request.urlopen(req, timeout=25, context=CTX).read()
print("文件大小:", len(b), "字节; 魔数:", b[:4].hex())

# 1) UTF-16LE 中文串（SST 里的中文列名/指数名）
texts = set()
for m in re.finditer(rb"(?:[\x00-\xff][\x4e-\x9f]){2,}", b):
    try:
        s = m.group(0).decode("utf-16-le", "ignore")
        s = s.strip("\x00").strip()
        if len(s) >= 2 and re.search(r"[\u4e00-\u9fff]", s):
            texts.add(s)
    except Exception:
        pass
print("\nUTF-16 字符串（前 40 个）:")
for t in sorted(texts)[:40]:
    print("  ", t)

# 2) ASCII 串（英文列名/日期/代码）
asc = set(m.group(0).decode() for m in re.finditer(rb"[A-Za-z][A-Za-z0-9 _\-]{3,}", b))
print("\nASCII 字符串（前 30 个）:")
for t in sorted(asc)[:30]:
    print("  ", t)

# 3) 行数估计：BOF 记录数（BIFF Row record type 0x0208）
rows = 0
i = 512  # 跳过 OLE 头，粗扫
while i < len(b) - 4:
    if b[i] == 0x08 and b[i + 1] == 0x02:
        rows += 1
    i += 1
print("\n粗略 Row 记录数（含误报）:", rows)
