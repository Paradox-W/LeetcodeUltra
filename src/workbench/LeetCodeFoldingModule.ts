// @ts-nocheck
import * as vscode from "vscode";
function isLeetCodeDocument(document) {
    if (!document || document.uri.scheme !== "file") {
        return false;
    }
    return /@lc app=.* id=.* lang=.*/.test(document.getText());
}
function getGeneratedFoldingRanges(document) {
    if (!isLeetCodeDocument(document)) {
        return [];
    }
    const lines = document.getText().split(/\r?\n/);
    const codeStart = lines.findIndex((line) => line.indexOf("@lc code=start") >= 0);
    const codeEnd = lines.findIndex((line) => line.indexOf("@lc code=end") >= 0);
    const ranges = [];
    if (codeStart > 0) {
        ranges.push(new vscode.FoldingRange(0, codeStart - 1, vscode.FoldingRangeKind.Comment));
    }
    if (codeEnd >= 0 && codeEnd + 1 < lines.length) {
        const lastMeaningfulLine = findLastMeaningfulLine(lines);
        if (lastMeaningfulLine > codeEnd + 1) {
            ranges.push(new vscode.FoldingRange(codeEnd + 1, lastMeaningfulLine, vscode.FoldingRangeKind.Comment));
        }
    }
    return ranges;
}
function findLastMeaningfulLine(lines) {
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim().length > 0) {
            return i;
        }
    }
    return lines.length - 1;
}
function foldActiveLeetCodeDocument() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !isLeetCodeDocument(editor.document)) {
        return;
    }
    const selectionLines = getGeneratedFoldingRanges(editor.document).map((range) => range.start);
    if (!selectionLines.length) {
        return;
    }
    setTimeout(() => {
        vscode.commands.executeCommand("editor.fold", { selectionLines });
    }, 120);
}
function registerLeetCodeFolding(context) {
    const provider = {
        provideFoldingRanges(document) {
            return getGeneratedFoldingRanges(document);
        },
    };
    const disposable = vscode.Disposable.from(vscode.languages.registerFoldingRangeProvider({ scheme: "file" }, provider), vscode.window.onDidChangeActiveTextEditor(() => foldActiveLeetCodeDocument()), vscode.workspace.onDidOpenTextDocument((document) => {
        const editor = vscode.window.activeTextEditor;
        if ((editor === null || editor === void 0 ? void 0 : editor.document) === document) {
            foldActiveLeetCodeDocument();
        }
    }), vscode.workspace.onDidSaveTextDocument((document) => {
        const editor = vscode.window.activeTextEditor;
        if ((editor === null || editor === void 0 ? void 0 : editor.document) === document) {
            foldActiveLeetCodeDocument();
        }
    }));
    context.subscriptions.push(disposable);
    foldActiveLeetCodeDocument();
    return disposable;
}
export { registerLeetCodeFolding };
