# -*- coding: utf-8 -*-
"""检查 index.html 里有没有重复定义的函数/事件处理器（这轮踩了两次同样的坑）。"""
import io
import re

s = io.open("index.html", encoding="utf-8").read()
js = re.search(r"<script>([\s\S]*)</script>", s).group(1)

# 1) function 声明
funcs = {}
for m in re.finditer(r"^function ([A-Za-z_$][\w$]*)\s*\(", js, re.M):
    funcs.setdefault(m.group(1), []).append(js[:m.start()].count("\n") + 1)

# 2) $("#id").onclick = 赋值
handlers = {}
for m in re.finditer(r'\$\("#([\w-]+)"\)\.onclick\s*=', js):
    handlers.setdefault(m.group(1), []).append(js[:m.start()].count("\n") + 1)

bad = 0
print("=== 重复 function 声明 ===")
dup_f = {k: v for k, v in funcs.items() if len(v) > 1}
if dup_f:
    for k, v in dup_f.items():
        print(f"  ❌ {k}()  行 {v}")
    bad += len(dup_f)
else:
    print("  ✅ 无")

print("\n=== 重复 onclick 绑定（后面的会覆盖前面的）===")
dup_h = {k: v for k, v in handlers.items() if len(v) > 1}
if dup_h:
    for k, v in dup_h.items():
        print(f"  ❌ #{k}  行 {v}")
    bad += len(dup_h)
else:
    print("  ✅ 无")

print("\n结论:", "❌ 发现 %d 处重复" % bad if bad else "✅ 没有重复定义")
raise SystemExit(1 if bad else 0)
