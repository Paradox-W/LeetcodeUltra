const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "vscode") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

let LeetCodeWorkbenchProvider;
try {
  ({ LeetCodeWorkbenchProvider } = require("../out/src/workbench/LeetCodeWorkbenchModule"));
} finally {
  Module._load = originalLoad;
}
const { storageUtils } = require("../out/src/rpc/utils/storageUtils");

const html = Object.create(LeetCodeWorkbenchProvider.prototype).getHtml();
const scriptStart = html.indexOf("<script nonce=");
const scriptBodyStart = html.indexOf(">", scriptStart) + 1;
const scriptEnd = html.indexOf("</script>", scriptBodyStart);
assert(scriptStart >= 0 && scriptEnd > scriptBodyStart, "workbench script should be present");

const script = html.slice(scriptBodyStart, scriptEnd);
assert(!script.includes("type: 'panelMessage'"), "case renaming should never write validation messages into the result panel");
const sourceFile = ts.createSourceFile("workbench-webview.js", script, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
const functionSource = sourceFile.statements
  .filter((statement) => ts.isFunctionDeclaration(statement))
  .map((statement) => script.slice(statement.pos, statement.end))
  .join("\n");
const context = vm.createContext({ console });
vm.runInContext(functionSource, context);

const payload = {
  action: "allcase",
  runMode: "allcase",
  result: {
    messages: ["Finished"],
    system_message: {
      sub_type: "test",
      accepted: true,
      compare_result: "11",
    },
    "Your Input": ["[0,1,2,2,3,0,4,2]\n2\n[3,2,2,3]\n3"],
    Output: ["[0,1,3,0,4]\n[2,2]"],
    "Expected Answer": ["[0,1,4,0,3]\n[2,2]"],
  },
};

context.state = {
  cases: [
    { label: "用例 1", value: "[0,1,2,2,3,0,4,2]\n2" },
    { label: "用例 2", value: "[3,2,2,3]\n3" },
  ],
  result: payload,
};

assert.strictEqual(context.getStatus(payload), "Accepted", "server acceptance must determine the overall status");
assert.strictEqual(
  context.allcaseVerdictForCase(context.state.cases[0], 0, payload),
  "Correct",
  "a server-accepted custom-judge output must not be marked wrong by strict text comparison"
);
assert(context.caseClass(context.state.cases[0], 0).includes("case-pass"), "accepted case should use pass styling");
const acceptedResultHtml = context.renderResultComparison(payload);
assert(acceptedResultHtml.includes("通过"), "accepted results should render the authoritative server status");
assert(acceptedResultHtml.includes("result-card-pass"), "accepted result cards should render with pass styling");
assert(!acceptedResultHtml.includes("答案错误"), "different display text must not override an accepted verdict");

const partialPayload = JSON.parse(JSON.stringify(payload));
partialPayload.result.messages = ["Wrong Answer"];
partialPayload.result.system_message.accepted = false;
partialPayload.result.system_message.compare_result = "01";
partialPayload.result.Output = ["[0,1,3,0,4]\n[2,3]"];
context.state.result = partialPayload;
assert.strictEqual(context.getStatus(partialPayload), "部分错误");
assert.strictEqual(context.getTone(partialPayload), "tone-warning");
assert.strictEqual(context.allcaseVerdictForCase(context.state.cases[0], 0, partialPayload), "Wrong Answer");
assert.strictEqual(
  context.allcaseVerdictForCase(context.state.cases[1], 1, partialPayload),
  "Correct",
  "per-case compare_result should remain authoritative when the full run is not accepted"
);

const allWrongPayload = JSON.parse(JSON.stringify(partialPayload));
allWrongPayload.result.system_message.compare_result = "00";
assert.strictEqual(context.getStatus(allWrongPayload), "Wrong Answer");
assert.strictEqual(context.getTone(allWrongPayload), "tone-danger");

delete partialPayload.result.system_message.compare_result;
assert.strictEqual(
  context.allcaseVerdictForCase(context.state.cases[1], 1, partialPayload),
  "",
  "output text must not become a local verdict when LeetCode provides no per-case result"
);
assert.strictEqual(context.caseClass(context.state.cases[1], 1), "", "unknown per-case results should remain neutral");

const missingServerResult = JSON.parse(JSON.stringify(partialPayload));
missingServerResult.result.messages = [];
delete missingServerResult.result.system_message.accepted;
context.state.result = missingServerResult;
assert.strictEqual(context.getStatus(missingServerResult), "服务端错误");
assert.strictEqual(context.getTone(missingServerResult), "tone-neutral");
assert.strictEqual(context.caseClass(context.state.cases[0], 0), "");
const serverErrorHtml = context.renderResultComparison(missingServerResult);
assert(serverErrorHtml.includes("服务端错误"), "missing server verdicts should render an explicit server error");
assert(serverErrorHtml.includes("result-card-neutral"), "missing server verdict cards should remain neutral");
assert(!serverErrorHtml.includes("result-card-pass"), "missing server verdicts must not be inferred as passing");
assert(!serverErrorHtml.includes("result-card-fail"), "missing server verdicts must not be inferred as failing");
assert.strictEqual(context.caseLabelLength("六个汉字名称"), 6);
assert.strictEqual(context.validateCaseRename(""), "用例名称不能为空。");
assert.strictEqual(context.validateCaseRename("   "), "用例名称不能为空。");
assert.strictEqual(context.validateCaseRename("七个汉字的名字"), "用例名称最多 6 个字。");
assert.strictEqual(context.validateCaseRename("六个汉字名称"), "");
assert.strictEqual(context.isCaseRenameEmpty(""), true);
assert.strictEqual(context.isCaseRenameEmpty("   "), true);
assert.strictEqual(context.isCaseRenameEmpty("有效名称"), false);
assert.strictEqual(context.preferredCaseColumnCount(300, 400, 700, 4), 1, "cases that fit vertically should stay single-column");
assert.strictEqual(context.preferredCaseColumnCount(800, 400, 430, 4), 1, "narrow case panes should stay single-column even when they overflow");
assert.strictEqual(context.preferredCaseColumnCount(800, 400, 500, 4), 2, "overflowing cases may use the minimum viable column count");
assert.strictEqual(context.preferredCaseColumnCount(1200, 400, 700, 6), 3, "wide overflowing panes may use more columns when needed");
context.editingCaseIndex = 0;
const editingCaseTitle = context.renderCaseTitle({ label: '双引号"&' }, 0);
assert(editingCaseTitle.includes("case-title-input"), "clicking a case title should render the inline rename input");
assert(editingCaseTitle.includes('value="双引号&quot;&amp;"'), "rename input values should be safely escaped");
context.editingCaseIndex = -1;
assert(
  context.renderCaseTitle({ label: "普通用例" }, 0).includes('data-rename="0"'),
  "non-editing case titles should remain clickable rename buttons"
);
assert(
  context.renderCaseTitle({ label: "用例 1", isDefault: true }, 0).includes("case-default-badge"),
  "official cases should render a compact default badge"
);
assert(
  !context.renderCaseTitle({ label: "用例 1", isDefault: false }, 0).includes("case-default-badge"),
  "modified cases should not render the default badge"
);
const defaultPinnedCaseTitle = context.renderCaseTitle({ label: "用例 1", isDefault: true, isPinned: true }, 0);
assert(defaultPinnedCaseTitle.includes("case-default-badge"), "default pinned cases should retain the default badge");
assert(defaultPinnedCaseTitle.includes("case-pin-toggle is-pinned"), "pinned cases should render a filled pin icon");
assert(defaultPinnedCaseTitle.includes('data-toggle-pin="0"'), "the pin icon should expose a dedicated toggle action");
assert(defaultPinnedCaseTitle.includes('aria-pressed="true"'), "pinned icons should expose their active state");
assert(
  defaultPinnedCaseTitle.indexOf("case-title-text") < defaultPinnedCaseTitle.indexOf("case-default-badge") &&
    defaultPinnedCaseTitle.indexOf("case-default-badge") < defaultPinnedCaseTitle.indexOf("case-pin-toggle"),
  "case name, labels, and pin icon should remain left-aligned in that order"
);
const unpinnedCaseTitle = context.renderCaseTitle({ label: "用例 2", isDefault: false, isPinned: false }, 1);
assert(unpinnedCaseTitle.includes("case-pin-toggle"), "unpinned cases should keep a hollow pin icon visible");
assert(unpinnedCaseTitle.includes('aria-pressed="false"'), "unpinned icons should expose their inactive state");
assert(!unpinnedCaseTitle.includes("case-pin-toggle is-pinned"), "unpinned icons should remain hollow");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lcpr-case-storage-"));
const tempFile = path.join(tempRoot, "1.two-sum.cpp");
const legacyCaseFile = storageUtils.testCaseFile(tempFile, "1", tempRoot);
fs.mkdirSync(path.dirname(legacyCaseFile), { recursive: true });
fs.writeFileSync(
  legacyCaseFile,
  JSON.stringify(
    {
      problemId: "1",
      cases: ["1\n2\n", "", "3\n4"],
    },
    null,
    2
  )
);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(storageUtils.readProblemCaseEntries(tempFile, "1"))),
  [
    { label: "用例 1", value: "1\n2" },
    { label: "用例 3", value: "3\n4" },
  ],
  "legacy string-array case storage should still expose stable labels and trimmed values"
);

storageUtils.writeProblemCaseEntries(
  tempFile,
  "1",
  [
    { label: "自定义名称", value: "a\nb", isDefault: true, isPinned: true },
    { label: "", value: "c\nd" },
  ],
  tempRoot
);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(storageUtils.readProblemCases(tempFile, "1"))),
  ["a\nb", "c\nd"],
  "value-only readers should stay compatible after labeled case storage is written"
);

assert.deepStrictEqual(
  JSON.parse(JSON.stringify(storageUtils.readProblemCaseEntries(tempFile, "1"))),
  [
    { label: "自定义名称", value: "a\nb", isDefault: true, isPinned: true },
    { label: "用例 2", value: "c\nd" },
  ],
  "labeled case storage should persist custom labels, default markers, and backfill empty ones"
);

fs.rmSync(tempRoot, { recursive: true, force: true });

console.log("workbench verdict and case storage regression tests passed");
