// 验证「点输入框全选」的新实现（不再用 preventDefault 方案）
const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

console.log("── 检查实现要点 ──");

// ① 不能再用 preventDefault（那会把 focus 一起挡掉）
const hasPreventDefaultInSelect = /mousedown",[\s\S]{0,700}?e\.preventDefault\(\)[\s\S]{0,200}?t\.select\(\)/.test(html);
check("① 不再用 preventDefault + select 组合（会挡掉聚焦）", hasPreventDefaultInSelect, false);

// ② 应该有 selectAllLater 辅助函数
check("② 有 selectAllLater 函数", html.includes("function selectAllLater"), true);

// ③ mousedown 里只打标记
check("③ mousedown 里设置 _wantSelectAll 标记",
      /_wantSelectAll\s*=\s*true/.test(html), true);

// ④ focusin 里调用 selectAllLater
check("④ focusin 里调用 selectAllLater",
      /focusin[\s\S]{0,600}?selectAllLater/.test(html), true);

// ⑤ mouseup 里补刀
check("⑤ mouseup 里再补一次全选",
      /mouseup[\s\S]{0,400}?selectAllLater/.test(html), true);

// ⑥ selectAllLater 用 setTimeout(0) + rAF 双保险
check("⑥ selectAllLater 用了 setTimeout 和 rAF",
      /setTimeout\(doSel,\s*0\)/.test(html) && /requestAnimationFrame\(doSel\)/.test(html), true);

// ⑦ selectAllLater 会检查 activeElement
check("⑦ selectAllLater 检查 activeElement",
      /document\.activeElement===t\)\s*t\.select\(\)/.test(html), true);

// ⑧ 记录聚焦时刻，用于"刚进入才补全选"
check("⑧ 有 _focusedAt 记录", html.includes("_focusedAt"), true);

// ⑨ 用户移动光标后不再自动全选
check("⑨ 有 _userMovedOnce 标记", html.includes("_userMovedOnce"), true);

// ⑩ 第二次点击仍然取消全选
check("⑩ 第二次点击仍会 setSelectionRange 取消全选",
      /document\.activeElement!==t\) return/.test(html) &&
      /setSelectionRange\(idx, idx\)/.test(html), true);

console.log("── 模拟执行顺序 ──");
// 模拟：mousedown → focusin → mouseup → click 的顺序下，最终选区应覆盖全文
function simulate(value) {
  const t = {
    tagName: "INPUT",
    dataset: { k: "min" },
    value,
    _sel: [value.length, value.length],
    _wantSelectAll: false,
    _focusedAt: 0,
    _userMovedOnce: false,
    active: false,
    get selectionStart() { return this._sel[0]; },
    get selectionEnd() { return this._sel[1]; },
    select() { this._sel = [0, this.value.length]; },
    setSelectionRange(a, b) { this._sel = [a, b]; },
    focus() { this.active = true; },
  };
  const activeElement = { get: () => t.active ? t : null };

  // ① mousedown（捕获）
  if (t.value !== "" && !activeElement.get()) t._wantSelectAll = true;

  // ② 浏览器默认：聚焦 + 把光标放到点击位置（模拟落到中间）
  t.active = true;
  const mid = Math.floor(t.value.length / 2);
  t._sel = [mid, mid];

  // ③ focusin
  if (t.value !== "" && t.selectionStart === t.selectionEnd && t._wantSelectAll) {
    // selectAllLater → 用同步模拟
    if (t.active) t.select();
  }
  t._focusedAt = 1;

  // ④ mouseup（捕获）→ 补刀
  if (t._wantSelectAll) {
    t._wantSelectAll = false;
    if (t.active) t.select();
  }

  // ⑤ click（捕获）→ 如果没有选区且刚进入 → 再补
  if (t.active && t.selectionStart === t.selectionEnd && !t._userMovedOnce) {
    if (Date.now() - t._focusedAt < 300) t.select();
  }
  return t;
}

let t = simulate("1.26");
console.log(`   最终选区: [${t.selectionStart}, ${t.selectionEnd}]  value="${t.value}"`);
check("⑪ 首次点击 → 最终全选（0 ~ 长度）",
      [t.selectionStart, t.selectionEnd], [0, 4]);

t = simulate("5.15");
check("⑫ 5.15 也能全选", [t.selectionStart, t.selectionEnd], [0, 4]);

t = simulate("0");
check("⑬ 单个字符也能全选", [t.selectionStart, t.selectionEnd], [0, 1]);

console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
process.exit(bad ? 1 : 0);
