# -*- coding: utf-8 -*-
"""抽出 index.html 的内联 JS 供 node --check，并打印版本号。"""
import io
import re

h = io.open("index.html", encoding="utf-8").read()
blocks = re.findall(r"<script>(.*?)</script>", h, re.S)
io.open("_check.js", "w", encoding="utf-8").write("\n;\n".join(blocks))
m = re.search(r'const VER = "([^"]+)"', h)
print("VER:", m.group(1) if m else "?")
print("blocks:", len(blocks))
