// @ts-nocheck
import * as vscode from "vscode";
const DEFAULT_OPTIONS = {
    showAcStatus: true,
    showDifficultyColor: false,
    showProblemId: true,
    showScorePrefix: false,
};
const CONFIG_KEY = "problemListDisplay";
function getProblemListDisplayOptions() {
    const configured = vscode.workspace.getConfiguration("leetcode-problem-rating").get(CONFIG_KEY, {});
    const options = Object.assign({}, DEFAULT_OPTIONS, configured || {});
    if (configured &&
        Object.prototype.hasOwnProperty.call(configured, "showIdPrefix") &&
        !Object.prototype.hasOwnProperty.call(configured, "showProblemId")) {
        options.showProblemId = configured.showIdPrefix;
    }
    return options;
}
export { getProblemListDisplayOptions };
function optionItem(label, key, picked, description) {
    return {
        label,
        description,
        picked,
        key,
    };
}
async function showProblemListDisplayOptions(treeDataService) {
    const current = getProblemListDisplayOptions();
    const items = [
        optionItem("显示 AC 情况", "showAcStatus", current.showAcStatus, "check / x / lock 图标"),
        optionItem("显示难度颜色", "showDifficultyColor", current.showDifficultyColor, "按难度或 score 给题目上色"),
        optionItem("显示题号", "showProblemId", current.showProblemId, "例如 16."),
        optionItem("显示 Score 前缀", "showScorePrefix", current.showScorePrefix, "例如 [score:1600]"),
    ];
    const picked = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: "选择 LCPR 题目列表中要显示的信息",
        ignoreFocusOut: true,
    });
    if (!picked) {
        return;
    }
    const next = {
        showAcStatus: false,
        showDifficultyColor: false,
        showProblemId: false,
        showScorePrefix: false,
    };
    for (const item of picked) {
        next[item.key] = true;
    }
    await vscode.workspace.getConfiguration("leetcode-problem-rating").update(CONFIG_KEY, next, vscode.ConfigurationTarget.Global);
    treeDataService.fire();
}
function registerProblemListDisplayOptions(context, treeDataService) {
    const disposable = vscode.Disposable.from(vscode.commands.registerCommand("lcpr.problemDisplayOptions", () => showProblemListDisplayOptions(treeDataService)), vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`leetcode-problem-rating.${CONFIG_KEY}`) ||
            event.affectsConfiguration("leetcode-problem-rating.colorizeProblems")) {
            treeDataService.fire();
        }
    }));
    context.subscriptions.push(disposable);
    return disposable;
}
export { registerProblemListDisplayOptions };
