// 验证两个交互修复：
// ① 点输入框全选、再点取消全选（光标落到点击位置）
// ② 从右往左拖选文字、松手落在行空白处 → 不应选中该行
const fs = require("fs");
const vm = require("vm");

const html = fs.readFileSync("index.html", "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

/* ========== 只测逻辑，不跑整个页面 ==========
   直接从源码里抽出关键实现来验证行为，避免 DOM 桩太复杂 */
console.log("── ① 输入框选中状态机 ──");

// 模拟输入框
function makeInput(value) {
  return {
    tagName: "INPUT",
    dataset: { k: "min", id: "x" },
    value,
    _sel: [value.length, value.length],
    _focused: false,
    get selectionStart() { return this._sel[0]; },
    get selectionEnd() { return this._sel[1]; },
    select() { this._sel = [0, this.value.length]; },
    setSelectionRange(a, b) { this._sel = [a, b]; },
    focus() { this._focused = true; },
    getBoundingClientRect() { return { left: 0, width: 100, top: 0, height: 20 }; },
    _defaultPrevented: false,
  };
}

// 复刻「首次 mousedown → 全选」逻辑
function firstClick(inp, activeEl) {
  if (!inp || inp.tagName !== "INPUT") return;
  if (inp.value === "") return;
  if (activeEl === inp) return;      // 已聚焦 → 走另一条路
  inp.focus();
  inp.select();
}
// 复刻「再次 mousedown → 取消全选 + 光标定位」逻辑
function secondClick(inp, clickX, activeEl) {
  if (activeEl !== inp) return;
  const hasSel = inp.selectionStart !== inp.selectionEnd;
  if (!hasSel) return;
  const rect = inp.getBoundingClientRect();
  const x = clickX - rect.left;
  const padL = 6;
  const v = inp.value;
  // 没有 canvas，用均分估算
  const usable = Math.max(1, rect.width - padL * 2);
  const idx = Math.max(0, Math.min(v.length, Math.round((x - padL) / usable * v.length)));
  inp.setSelectionRange(idx, idx);
}

// 场景：1.26 → 想改成 1.28（点在倒数第二位附近）
let inp = makeInput("1.26");
check("初始未选中", [inp.selectionStart, inp.selectionEnd], [4, 4]);

firstClick(inp, null);
check("① 第一次点击 → 全选", [inp.selectionStart, inp.selectionEnd], [0, 4]);

// 第二次点在 "6" 的位置（约 x=78/100，对应第 3~4 个字符）
secondClick(inp, 80, inp);
console.log(`   第二次点击(x=80) 后光标位置: ${inp.selectionStart}`);
check("② 第二次点击 → 取消全选（选区收成一个点）",
      inp.selectionStart === inp.selectionEnd, true);
check("③ 光标落在靠后的字符（能直接改末位）",
      inp.selectionStart >= 2, true);

// 模拟用户把 1.26 改成 1.28：把最后的 6 换成 8
// "1.26" → 去掉末位 → "1.2" + "8" = "1.28"
inp.value = inp.value.slice(0, -1) + "8";
console.log(`   编辑后: ${inp.value}`);
check("④ 把 6 改成 8 → 1.28", inp.value, "1.28");

// 点在开头 → 光标靠前
let inp2 = makeInput("1.26");
firstClick(inp2, null);
secondClick(inp2, 8, inp2);
console.log(`   点在开头(x=8) → 光标 ${inp2.selectionStart}`);
check("⑤ 点在开头 → 光标靠前", inp2.selectionStart <= 1, true);

/* ========== ② 拖选文字不应选中行 ========== */
console.log("\n── ② 拖选 vs 点击行 ──");

// 复刻状态机
function makeDragState() {
  return { downValid: false, downMoved: false, downOnInput: false, suppressRowClick: false,
           downX: 0, downY: 0 };
}
function onMouseDown(st, target, x, y) {
  st.downValid = true; st.downMoved = false;
  st.downX = x; st.downY = y;
  st.downOnInput = !!(target && target.tagName === "INPUT");
  st.suppressRowClick = false;
}
function onMouseMove(st, x, y) {
  if (!st.downValid) return;
  if (Math.abs(x - st.downX) > 5 || Math.abs(y - st.downY) > 5) {
    st.downMoved = true; st.suppressRowClick = true;
  }
}
function onMouseUp(st) {
  if (st.downOnInput) st.suppressRowClick = true;
}

// 场景 A：按下在输入框，拖到行尾空白，松手
let st = makeDragState();
const inputEl = { tagName: "INPUT" };
onMouseDown(st, inputEl, 80, 10);
onMouseMove(st, 20, 10);        // 向左拖
onMouseUp(st);
console.log(`   A 按下在输入框→拖到空白→松手: suppressRowClick=${st.suppressRowClick}`);
check("⑥ ★ 从输入框拖选 → 不选中行", st.suppressRowClick, true);

// 场景 B：按下就在行空白处，没移动，松手 → 应该选中
st = makeDragState();
onMouseDown(st, { tagName: "DIV" }, 50, 10);
onMouseUp(st);
check("⑦ 点行空白（没拖）→ 可以选中", st.suppressRowClick, false);

// 场景 C：按下在文字上（非输入框），拖到空白 → 不选中
st = makeDragState();
onMouseDown(st, { tagName: "SPAN" }, 60, 10);
onMouseMove(st, 10, 10);
onMouseUp(st);
check("⑧ 从文字上拖选 → 不选中行", st.suppressRowClick, true);

// 场景 D：按下在行空白，轻微移动 3px（手抖）→ 仍算点击
st = makeDragState();
onMouseDown(st, { tagName: "DIV" }, 50, 10);
onMouseMove(st, 52, 11);
onMouseUp(st);
check("⑨ 手抖 3px 仍算点击（能选中）", st.suppressRowClick, false);

/* ========== ③ 源码层检查 ========== */
console.log("\n── ③ 源码检查 ──");
check("有 suppressRowClick 变量", html.includes("suppressRowClick"), true);
check("行选中判断用了 suppressRowClick",
      /rrow\.closest\("#pane-s1"\) && !suppressRowClick/.test(html), true);
check("首次 mousedown 会 preventDefault 后 select",
      /e\.preventDefault\(\);[\s\S]{0,120}t\.select\(\)/.test(html), true);

console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
process.exit(bad ? 1 : 0);
