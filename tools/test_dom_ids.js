// 静态检查：脚本里 $("#xxx") 引用的 id 是否真的存在于 HTML 中（否则 .onclick 会报 null 崩溃）
const fs = require("fs");
const html = fs.readFileSync("web/index.html", "utf8");

const ids = new Set();
for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
  if (!m[1].includes("${")) ids.add(m[1]);      // 模板里拼出来的（data-panel 等）跳过
}

const used = new Map();
for (const m of html.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)) {
  const id = m[1];
  if (!used.has(id)) used.set(id, 0);
  used.set(id, used.get(id) + 1);
}

const missing = [...used.keys()].filter((id) => !ids.has(id));
console.log(`页面 id 共 ${ids.size} 个，脚本引用 ${used.size} 个`);
if (missing.length) {
  console.log("❌ 脚本引用了不存在的 id：", missing.join(", "));
  process.exit(1);
}
console.log("✅ 所有 $('#id') 引用都能在 DOM 里找到");

// 顺带看看有没有重复 id
const seen = new Map();
for (const m of html.matchAll(/\bid="([^"]+)"/g)) {
  if (m[1].includes("${")) continue;
  seen.set(m[1], (seen.get(m[1]) || 0) + 1);
}
const dup = [...seen.entries()].filter(([, n]) => n > 1);
console.log(dup.length ? "❌ 重复 id：" + dup.map(([k, n]) => `${k}×${n}`).join(", ") : "✅ 没有重复 id");
process.exit(dup.length ? 1 : 0);
