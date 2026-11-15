// 云端合并逻辑测试：从 index.html 抠出 cloudMerge / cloudPack，验证「新者胜」等规则
const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");

function slice(from, to) {
  const a = html.indexOf(from), b = html.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error("切不出来：" + from);
  return html.slice(a, b);
}

const harness = `
let state = { list1:[], list2:[], list3:[], cloudLast:null };
let saved = 0;
function save(){ saved++; }
function deviceName(){ return "测试机"; }
const $ = () => null;
let focusId = null;
Object.defineProperty(globalThis, "document", {
  value: { get activeElement(){ return focusId ? { dataset: { id: focusId } } : null; } },
  configurable: true,
});
${slice("const CLOUD_FIELDS", "function cloudSetStatus")}
module.exports = {
  cloudMerge, cloudPack,
  getState: () => state,
  setState: s => { state = s; },
  setFocus: id => { focusId = id; },
  savedCount: () => saved,
};
`;

fs.writeFileSync("_sync_test.js", harness);
const m = require(require("path").resolve("_sync_test.js"));

let bad = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  got=${JSON.stringify(got)}${ok ? "" : "  期望=" + JSON.stringify(want)}`);
}

// 场景1：云端 rev 更新 → 应用远端手填值
m.setState({ list1: [{ id: "a", code: "399673", name: "创业板50", min: "", pe: "", pb: "", mpct: "", rev: 0 }],
             list2: [], list3: [] });
const remote = { items: { l1: { "399673": { rev: 1000, min: "5.6", pe: "", pb: "", mpct: "-4",
                                            minAt: "2026-11-13", mpctAt: "2026-11-13" } } } };
check("云端较新 → 应用 2 条字段", m.cloudMerge(remote), 1);
check("应用后的值", [m.getState().list1[0].min, m.getState().list1[0].mpct, m.getState().list1[0].minAt, m.getState().list1[0].rev],
      ["5.6", "-4", "2026-11-13", 1000]);
check("merge 后触发 save", m.savedCount() >= 1, true);

// 场景2：本地 rev 更新 → 不覆盖
m.setState({ list1: [{ id: "a", code: "399673", name: "创业板50", min: "4.9", pe: "", pb: "", mpct: "", rev: 2000 }], list2: [], list3: [] });
m.cloudMerge(remote);
check("本地较新 → 值保留", m.getState().list1[0].min, "4.9");

// 场景3：云端没有的代码 → 跳过
m.setState({ list1: [{ id: "b", code: "999999", name: "未知", min: "", rev: 0 }], list2: [], list3: [] });
check("云端没有的代码 → 不动", m.cloudMerge(remote), 0);

// 场景4：正在输入的行 → 跳过
m.setState({ list1: [{ id: "a", code: "399673", name: "x", min: "", rev: 0 }], list2: [], list3: [] });
m.setFocus("a");
check("正在输入的行 → 不应用", m.cloudMerge(remote), 0);
m.setFocus(null);

// 场景5：云端值清空（""）也会同步过来
m.setState({ list1: [{ id: "a", code: "399673", name: "x", min: "5.6", rev: 0 }], list2: [], list3: [] });
const cleared = { items: { l1: { "399673": { rev: 3000, min: "", pe: "", pb: "", mpct: "", minAt: "", mpctAt: "" } } } };
m.cloudMerge(cleared);
check("云端清空 → 本地也清空", [m.getState().list1[0].min, m.getState().list1[0].minAt], ["", ""]);

// 场景6：cloudPack 结构
m.setState({
  list1: [{ code: "399673", name: "x", min: "5.6", pe: "", pb: "", mpct: "-4", minAt: "2026-11-14", mpctAt: "2026-11-14", rev: 99 }],
  list2: [{ code: "886042", name: "存储芯片", high: 3716.55, unit: 1, manual: "", rev: 5 }],
  list3: [{ code: "H11136", name: "中国互联网", pe: "1.31", pb: "", rev: 7 }],
});
const p = m.cloudPack();
check("pack l1", p.items.l1["399673"],
      { rev: 99, min: "5.6", pe: "", pb: "", mpct: "-4", minAt: "2026-11-14", mpctAt: "2026-11-14" });
check("pack l2", p.items.l2["886042"], { rev: 5, high: 3716.55, manual: "", unit: 1, mpct2: "" });
check("pack l3", p.items.l3["H11136"], { rev: 7, pe: "1.31", pb: "" });
check("pack 有 updatedAt/device", [!!p.updatedAt, p.device], [true, "测试机"]);

// 场景7：round-trip —— pack 出来的快照再 merge 回空 state，能完整还原
m.setState({ list1: [{ code: "399673", name: "x", min: "", pe: "", pb: "", mpct: "", rev: 0 }], list2: [], list3: [] });
m.cloudMerge(JSON.parse(JSON.stringify(p)));
check("round-trip 还原手填值", [m.getState().list1[0].min, m.getState().list1[0].mpct, m.getState().list1[0].rev],
      ["5.6", "-4", 99]);

console.log(bad ? `\n${bad} 项不符合预期` : "\n全部通过");
process.exit(bad ? 1 : 0);
