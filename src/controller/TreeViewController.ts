// @ts-nocheck
/*
 * Filename: https://github.com/ccagml/leetcode-extension/src/controller/TreeViewController.ts
 * Path: https://github.com/ccagml/leetcode-extension
 * Created Date: Thursday, October 27th 2022, 7:43:29 pm
 * Author: ccagml
 *
 * Copyright (c) 2022 ccagml . All rights reserved.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import * as lodash from "lodash";
import * as path from "path";
import * as vscode from "vscode";
import * as lodash_1 from "lodash";
import * as fs from "fs";
import * as vscode_1 from "vscode";
import * as ConstDefind_1 from "../model/ConstDefind";
import * as ConfigUtils_1 from "../utils/ConfigUtils";
import * as TreeNodeModel_1 from "../model/TreeNodeModel";
import * as OutputUtils_1 from "../utils/OutputUtils";
import * as SystemUtils_1 from "../utils/SystemUtils";
import * as ConfigUtils_2 from "../utils/ConfigUtils";
import * as systemUtils from "../utils/SystemUtils";
import * as fse from "fs-extra";
import * as groupDao_1 from "../dao/groupDao";
import { carlDao } from "../dao/carlDao";
import * as problemUtils_1 from "../utils/problemUtils";
import * as BABA_1 from "../BABA";
import { storageUtils } from "../rpc/utils/storageUtils";
// 视图控制器
class TreeViewController {
    constructor() {
        this.searchSet = new Map();
        this.cppIntelliSenseConfiguredWorkspaces = new Set();
        this.configurationChangeListener = vscode_1.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("leetcode-problem-rating.hideScore")) {
                BABA_1.BABA.sendNotification(BABA_1.BabaStr.ConfigChange_hideScore);
            }
        }, this);
    }
    ensureCppIntelliSenseForDocument(document) {
        try {
            if (!document || document.uri.scheme !== "file") {
                return false;
            }
            this.migrateLeetCodeScaffoldingForDocument(document);
            const meta = (0, problemUtils_1.fileMeta)(document.getText(), document.fileName);
            if (!meta || meta.lang !== "cpp") {
                return false;
            }
            const workspaceFolder = this.resolveIntelliSenseWorkspaceFolder(document);
            if (!workspaceFolder) {
                return false;
            }
            const definitionPath = this.writeCppDefinitionFile(workspaceFolder);
            this.ensureCppIntelliSenseConfig(workspaceFolder, definitionPath);
            if (!this.cppIntelliSenseConfiguredWorkspaces.has(workspaceFolder)) {
                this.cppIntelliSenseConfiguredWorkspaces.add(workspaceFolder);
                this.refreshCppLanguageServices();
            }
            return true;
        }
        catch (_) {
            return false;
        }
    }
    migrateLeetCodeScaffoldingForFile(filePath, workspaceFolder) {
        try {
            if (!filePath || !fs.existsSync(filePath)) {
                return false;
            }
            const content = fs.readFileSync(filePath, "utf8");
            const parsedMeta = storageUtils.parseProblemMetaFromText(content);
            if (parsedMeta.id && parsedMeta.lang) {
                storageUtils.writeProblemMeta(filePath, parsedMeta, workspaceFolder);
            }
            const meta = storageUtils.meta(filePath);
            if (meta.id) {
                const legacyCases = storageUtils.extractCaseAnnotationsFromText(content);
                if (legacyCases.length > 0) {
                    storageUtils.writeProblemCases(filePath, meta.id, legacyCases, workspaceFolder);
                }
            }
            const cleaned = storageUtils.removeGeneratedScaffoldingFromText(content);
            if (cleaned !== content) {
                fs.writeFileSync(filePath, cleaned);
                return true;
            }
        }
        catch (_) {
            // Migration is best-effort; never block opening or running a problem.
        }
        return false;
    }
    migrateLeetCodeScaffoldingForDocument(document) {
        try {
            if (!document || document.uri.scheme !== "file" || document.isDirty) {
                return false;
            }
            const workspaceFolder = this.resolveIntelliSenseWorkspaceFolder(document);
            const content = document.getText();
            const parsedMeta = storageUtils.parseProblemMetaFromText(content);
            const storedMeta = storageUtils.readProblemMeta(document.fileName);
            const hasMeta = (parsedMeta.id && parsedMeta.lang) || (storedMeta.id && storedMeta.lang);
            if (!hasMeta && !/@lcpr-template-|@lc\s+code=|#line\s+\d+|leetcode-definition\.(?:h|hpp)/.test(content)) {
                return false;
            }
            if (parsedMeta.id && parsedMeta.lang) {
                storageUtils.writeProblemMeta(document.fileName, parsedMeta, workspaceFolder);
            }
            const meta = storageUtils.meta(document.fileName);
            if (meta.id) {
                const legacyCases = storageUtils.extractCaseAnnotationsFromText(content);
                if (legacyCases.length > 0) {
                    storageUtils.writeProblemCases(document.fileName, meta.id, legacyCases, workspaceFolder);
                }
            }
            const cleaned = storageUtils.removeGeneratedScaffoldingFromText(content);
            if (cleaned === content) {
                return false;
            }
            const editor = vscode.window.visibleTextEditors.find((item) => item.document === document);
            if (editor) {
                const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(content.length));
                editor.edit((edit) => edit.replace(fullRange, cleaned)).then((success) => {
                    if (success) {
                        document.save().then(undefined, () => undefined);
                    }
                }, () => undefined);
            }
            else {
                fs.writeFileSync(document.fileName, cleaned);
            }
            return true;
        }
        catch (_) {
            return false;
        }
    }
    resolveIntelliSenseWorkspaceFolder(document) {
        const containingWorkspace = vscode.workspace.getWorkspaceFolder(document.uri);
        if (containingWorkspace) {
            return containingWorkspace.uri.fsPath;
        }
        const configuredWorkspace = (0, ConfigUtils_1.getWorkspaceFolder)();
        if (configuredWorkspace && fs.existsSync(configuredWorkspace)) {
            return configuredWorkspace;
        }
        return path.dirname(document.fileName);
    }
    inferWorkbenchRunMode(tsd) {
        if (!tsd) {
            return "test";
        }
        if (tsd.allCase) {
            return "allcase";
        }
        if (tsd.type === ConstDefind_1.TestSolutionType.Type_3 || tsd.type === ConstDefind_1.TestSolutionType.Type_4) {
            return "case";
        }
        return "test";
    }
    notifyWorkbenchRunning(action, runMode, activeTestCase) {
        vscode.commands.executeCommand("lcpr.workbench.showResult", {
            phase: "running",
            action,
            runMode,
            activeTestCase,
            startedAt: Date.now(),
        });
    }
    notifyWorkbenchError(runMode, error) {
        vscode.commands.executeCommand("lcpr.workbench.showResult", {
            phase: "complete",
            runMode,
            result: {
                messages: ["Error", String((error === null || error === void 0 ? void 0 : error.message) || error || "No result returned.")],
                system_message: {
                    sub_type: runMode === "submit" ? "submit" : "test",
                    accepted: false,
                    status: "Error",
                },
            },
        });
    }
    // 提交问题
    /**
     * It gets the active file path, then submits the solution to the server, and finally refreshes the
     * tree view
     * @param [uri] - The URI of the file to be submitted. If not provided, the currently active file will
     * be submitted.
     * @returns A promise that resolves to a string.
     */
    submitSolution(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            let sbp = BABA_1.BABA.getProxy(BABA_1.BabaStr.StatusBarProxy);
            if (!sbp.getUser()) {
                (0, OutputUtils_1.promptForSignIn)();
                return;
            }
            const filePath = yield (0, SystemUtils_1.getTextEditorFilePathByUri)(uri);
            if (!filePath) {
                return;
            }
            try {
                this.notifyWorkbenchRunning("submit", "submit");
                const result = yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy).get_instance().submitSolution(filePath);
                if (!result) {
                    this.notifyWorkbenchError("submit", "No result returned.");
                    return;
                }
                BABA_1.BABA.sendNotification(BABA_1.BabaStr.CommitResult_submitSolutionResult, { resultString: result });
            }
            catch (error) {
                this.notifyWorkbenchError("submit", error);
                yield (0, OutputUtils_1.ShowMessage)(`提交出错${error}了. 请查看控制台信息~`, ConstDefind_1.OutPutType.error);
                return;
            }
        });
    }
    // 提交测试用例
    /**
     * It takes the current file, and sends it to the server to be tested
     * @param [uri] - The file path of the file to be submitted. If it is not passed, the currently active
     * file is submitted.
     */
    testSolution(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                let sbp = BABA_1.BABA.getProxy(BABA_1.BabaStr.StatusBarProxy);
                if (sbp.getStatus() === ConstDefind_1.UserStatus.SignedOut) {
                    return;
                }
                const filePath = yield (0, SystemUtils_1.getTextEditorFilePathByUri)(uri);
                if (!filePath) {
                    return;
                }
                const picks = [];
                picks.push({
                    label: "$(pencil) Write directly...",
                    description: "",
                    detail: "输入框的测试用例",
                    value: ":direct",
                }, {
                    label: "$(file-text) Browse...",
                    description: "",
                    detail: "文件中的测试用例",
                    value: ":file",
                });
                const choice = yield vscode.window.showQuickPick(picks);
                if (!choice) {
                    return;
                }
                let result;
                let testString;
                let testFile;
                let tsd = Object.assign({}, ConstDefind_1.defaultTestSolutionData, {});
                switch (choice.value) {
                    case ":direct":
                        testString = yield vscode.window.showInputBox({
                            prompt: "Enter the test cases.",
                            validateInput: (s) => s && s.trim() ? undefined : "Test case must not be empty.",
                            placeHolder: "Example: [1,2,3]\\n4",
                            ignoreFocusOut: true,
                        });
                        if (testString) {
                            tsd.filePath = filePath;
                            tsd.testString = this.normalizeTestString(testString);
                            tsd.allCase = false;
                            tsd.type = ConstDefind_1.TestSolutionType.Type_1;
                            this.notifyWorkbenchRunning("test", "test");
                            result = yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy)
                                .get_instance()
                                .testSolution(tsd.filePath, tsd.testString, tsd.allCase);
                            tsd.result = result;
                        }
                        break;
                    case ":file":
                        testFile = yield this.showFileSelectDialog(filePath);
                        if (testFile && testFile.length) {
                            const input = (yield fse.readFile(testFile[0].fsPath, "utf-8")).trim();
                            if (input) {
                                tsd.filePath = filePath;
                                tsd.testString = this.normalizeTestString(input);
                                tsd.allCase = false;
                                this.notifyWorkbenchRunning("test", "test");
                                result = yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy)
                                    .get_instance()
                                    .testSolution(tsd.filePath, tsd.testString, tsd.allCase);
                                tsd.result = result;
                                tsd.type = ConstDefind_1.TestSolutionType.Type_2;
                            }
                            else {
                                (0, OutputUtils_1.ShowMessage)("The selected test file must not be empty.", ConstDefind_1.OutPutType.error);
                            }
                        }
                        break;
                    default:
                        break;
                }
                if (!result) {
                    this.notifyWorkbenchError("test", "No result returned.");
                    return;
                }
                BABA_1.BABA.sendNotification(BABA_1.BabaStr.CommitResult_testSolutionResult, { resultString: result, tsd: tsd });
            }
            catch (error) {
                this.notifyWorkbenchError("test", error);
                yield (0, OutputUtils_1.ShowMessage)(`提交测试出错${error}了. 请查看控制台信息~`, ConstDefind_1.OutPutType.error);
            }
        });
    }
    /**
     * "Show a file selection dialog, and return the selected file's URI."
     *
     * The function is async, so it returns a promise
     * @param {string} [fsPath] - The path of the file that is currently open in the editor.
     * @returns An array of file URIs or undefined.
     */
    showFileSelectDialog(fsPath) {
        return __awaiter(this, void 0, void 0, function* () {
            const defaultUri = (0, ConfigUtils_1.getBelongingWorkspaceFolderUri)(fsPath);
            const options = {
                defaultUri,
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: "Select",
            };
            return yield vscode.window.showOpenDialog(options);
        });
    }
    /**
     * It gets the active file path, and then calls the BABA.getProxy(BabaStr.ChildCallProxy).get_instance().testSolution function to test the
     * solution
     * @param [uri] - The path of the file to be submitted. If it is not passed, the currently active file
     * is submitted.
     * @param {boolean} [allCase] - Whether to submit all cases.
     * @returns a promise that resolves to void.
     */
    testCaseDef(uri, allCase) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                let sbp = BABA_1.BABA.getProxy(BABA_1.BabaStr.StatusBarProxy);
                if (sbp.getStatus() === ConstDefind_1.UserStatus.SignedOut) {
                    return;
                }
                const filePath = yield (0, SystemUtils_1.getTextEditorFilePathByUri)(uri);
                if (!filePath) {
                    return;
                }
                let tsd = Object.assign({}, ConstDefind_1.defaultTestSolutionData, {});
                tsd.filePath = filePath;
                tsd.testString = undefined;
                tsd.allCase = allCase || false;
                tsd.type = ConstDefind_1.TestSolutionType.Type_3;
                this.notifyWorkbenchRunning(tsd.allCase ? "allcase" : "case", tsd.allCase ? "allcase" : "case");
                let result = yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy)
                    .get_instance()
                    .testSolution(tsd.filePath, tsd.testString, tsd.allCase);
                tsd.result = result;
                if (!result) {
                    this.notifyWorkbenchError(tsd.allCase ? "allcase" : "case", "No result returned.");
                    return;
                }
                BABA_1.BABA.sendNotification(BABA_1.BabaStr.CommitResult_testSolutionResult, { resultString: result, tsd: tsd });
            }
            catch (error) {
                this.notifyWorkbenchError(allCase ? "allcase" : "case", error);
                yield (0, OutputUtils_1.ShowMessage)(`提交测试出错${error}了. 请查看控制台信息~`, ConstDefind_1.OutPutType.error);
            }
        });
    }
    // 提交测试用例
    /**
     * It takes the current file, and sends it to the server to be tested
     * @param [uri] - The file path of the file to be submitted. If it is not passed, the currently active
     * file is submitted.
     */
    reTestSolution(uri) {
        return __awaiter(this, void 0, void 0, function* () {
            let runMode = "test";
            try {
                let sbp = BABA_1.BABA.getProxy(BABA_1.BabaStr.StatusBarProxy);
                if (sbp.getStatus() === ConstDefind_1.UserStatus.SignedOut) {
                    return;
                }
                const filePath = yield (0, SystemUtils_1.getTextEditorFilePathByUri)(uri);
                if (!filePath) {
                    return;
                }
                const fileContent = fs.readFileSync(filePath);
                const meta = (0, problemUtils_1.fileMeta)(fileContent.toString());
                let qid = undefined;
                if ((meta === null || meta === void 0 ? void 0 : meta.id) != undefined) {
                    qid = BABA_1.BABA.getProxy(BABA_1.BabaStr.QuestionDataProxy).getQidByFid(meta === null || meta === void 0 ? void 0 : meta.id);
                }
                if (qid == undefined) {
                    return;
                }
                let tsd = BABA_1.BABA.getProxy(BABA_1.BabaStr.CommitResultProxy).getTSDByQid(qid);
                if (tsd == undefined) {
                    return;
                }
                runMode = this.inferWorkbenchRunMode(tsd);
                this.notifyWorkbenchRunning("retest", runMode, tsd.testString);
                let result = yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy)
                    .get_instance()
                    .testSolution(tsd.filePath, tsd.testString, tsd.allCase);
                if (!result) {
                    this.notifyWorkbenchError(runMode, "No result returned.");
                    return;
                }
                BABA_1.BABA.sendNotification(BABA_1.BabaStr.CommitResult_testSolutionResult, { resultString: result, tsd: tsd });
            }
            catch (error) {
                this.notifyWorkbenchError(runMode, error);
                yield (0, OutputUtils_1.ShowMessage)(`提交测试出错${error}了. 请查看控制台信息~`, ConstDefind_1.OutPutType.error);
            }
        });
    }
    /**
     * It gets the active file path, then calls the BABA.getProxy(BabaStr.ChildCallProxy).get_instance().testSolution function to test the
     * solution
     * @param [uri] - The file path of the file to be submitted. If it is not passed in, the currently
     * active file is submitted.
     * @param {string} [testcase] - The test case to be tested. If it is not specified, the test case will
     * be randomly selected.
     * @returns a promise that resolves to void.
     */
    tesCaseArea(uri, testcase, runMode) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                let sbp = BABA_1.BABA.getProxy(BABA_1.BabaStr.StatusBarProxy);
                if (sbp.getStatus() === ConstDefind_1.UserStatus.SignedOut) {
                    return;
                }
                const filePath = yield (0, SystemUtils_1.getTextEditorFilePathByUri)(uri);
                if (!filePath) {
                    return;
                }
                let tsd = Object.assign({}, ConstDefind_1.defaultTestSolutionData, {});
                const workbenchRunMode = runMode === "allcase" ? "allcase" : "case";
                const normalizedTestcase = this.normalizeTestString(testcase);
                tsd.filePath = filePath;
                tsd.testString = normalizedTestcase;
                tsd.allCase = workbenchRunMode === "allcase";
                tsd.type = workbenchRunMode === "allcase" ? ConstDefind_1.TestSolutionType.Type_3 : ConstDefind_1.TestSolutionType.Type_4;
                this.notifyWorkbenchRunning(workbenchRunMode === "allcase" ? "allcase" : "runCase", workbenchRunMode, normalizedTestcase);
                let result = yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy)
                    .get_instance()
                    .testSolution(tsd.filePath, tsd.testString, tsd.allCase);
                tsd.result = result;
                if (!result) {
                    this.notifyWorkbenchError(workbenchRunMode, "No result returned.");
                    return;
                }
                BABA_1.BABA.sendNotification(BABA_1.BabaStr.CommitResult_testSolutionResult, { resultString: result, tsd: tsd });
            }
            catch (error) {
                this.notifyWorkbenchError(runMode === "allcase" ? "allcase" : "case", error);
                yield (0, OutputUtils_1.ShowMessage)(`提交测试出错${error}了. 请查看控制台信息~`, ConstDefind_1.OutPutType.error);
            }
        });
    }
    /**
     * If you're on Windows, and you're using cmd.exe, then you need to escape double quotes with
     * backslashes. Otherwise, you don't
     * @param {string} test - The test string to be parsed.
     * @returns a string.
     */
    parseTestString(test) {
        if (systemUtils.useWsl() || !systemUtils.isWindows()) {
            if (systemUtils.useVscodeNode()) {
                return `${test}`;
            }
            return `'${test}'`;
        }
        if ((0, SystemUtils_1.usingCmd)()) {
            // 一般需要走进这里, 除非改了 环境变量ComSpec的值
            if (systemUtils.useVscodeNode()) {
                //eslint-disable-next-line
                return `${test.replace(/"/g, '"')}`;
            }
            return `"${test.replace(/"/g, '\\"')}"`;
        }
        else {
            if (systemUtils.useVscodeNode()) {
                //eslint-disable-next-line
                return `${test.replace(/"/g, '"')}`;
            }
            return `'${test.replace(/"/g, '\\"')}'`;
        }
    }
    normalizeTestString(test) {
        return String(test || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\\n/g, "\n");
    }
    /**
     * It switches the endpoint of LeetCode, and then signs out and signs in again
     * @returns a promise that resolves to a void.
     */
    /**
     * It shows a quick pick menu with the available sorting strategies, and if the user selects one, it
     * updates the sorting strategy and refreshes the tree view
     * @returns A promise that resolves to a void.
     */
    switchSortingStrategy() {
        return __awaiter(this, void 0, void 0, function* () {
            const currentStrategy = (0, ConfigUtils_1.getSortingStrategy)();
            const picks = [];
            picks.push(...ConstDefind_1.SORT_ORDER.map((s) => {
                return {
                    label: `${currentStrategy === s ? "$(check)" : "    "} ${s}`,
                    value: s,
                };
            }));
            const choice = yield vscode.window.showQuickPick(picks);
            if (!choice || choice.value === currentStrategy) {
                return;
            }
            yield (0, ConfigUtils_1.updateSortStrategy)(choice.value, true);
        });
    }
    /**
     * It adds a node to the user's favorites
     * @param {TreeNodeModel} node - TreeNodeModel
     */
    applyFavoriteOptimistic(node, isFavorite) {
        var _a, _b;
        (_a = node === null || node === void 0 ? void 0 : node.get_data()) === null || _a === void 0 ? void 0 : _a.isFavorite = isFavorite;
        const cachedNode = BABA_1.BABA.getProxy(BABA_1.BabaStr.QuestionDataProxy).getNodeByQid(node.qid);
        if (cachedNode && cachedNode !== node) {
            (_b = cachedNode.get_data()) === null || _b === void 0 ? void 0 : _b.isFavorite = isFavorite;
        }
        BABA_1.BABA.sendNotification(BABA_1.BabaStr.TreeData_rebuildTreeData);
    }
    addFavorite(node) {
        return __awaiter(this, void 0, void 0, function* () {
            this.applyFavoriteOptimistic(node, true);
            try {
                yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy).get_instance().toggleFavorite(node, true);
                BABA_1.BABA.sendNotification(BABA_1.BabaStr.TreeData_favoriteChange);
            }
            catch (error) {
                this.applyFavoriteOptimistic(node, false);
                yield (0, OutputUtils_1.ShowMessage)("添加收藏失败，已恢复本地状态。请查看控制台信息~", ConstDefind_1.OutPutType.error);
            }
        });
    }
    /**
     * It removes a node from the user's favorites
     * @param {TreeNodeModel} node - The node that is currently selected in the tree.
     */
    removeFavorite(node) {
        return __awaiter(this, void 0, void 0, function* () {
            this.applyFavoriteOptimistic(node, false);
            try {
                yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy).get_instance().toggleFavorite(node, false);
                BABA_1.BABA.sendNotification(BABA_1.BabaStr.TreeData_favoriteChange);
            }
            catch (error) {
                this.applyFavoriteOptimistic(node, true);
                yield (0, OutputUtils_1.ShowMessage)("取消收藏失败，已恢复本地状态。请查看控制台信息~", ConstDefind_1.OutPutType.error);
            }
        });
    }
    searchProblem() {
        return __awaiter(this, void 0, void 0, function* () {
            const picks = [];
            picks.push({
                label: `题目id查询`,
                detail: `通过题目id查询`,
                value: `byid`,
            }, {
                label: `分数范围查询`,
                detail: `例如 1500-1600`,
                value: `range`,
            }, {
                label: `周赛期数查询`,
                detail: `周赛期数查询`,
                value: `contest`,
            }
            // {
            //   label: `测试api`,
            //   detail: `测试api`,
            //   value: `testapi`,
            // }
            );
            const choice = yield vscode.window.showQuickPick(picks, {
                title: "选择查询选项",
            });
            if (!choice) {
                return;
            }
            if (!BABA_1.BABA.getProxy(BABA_1.BabaStr.StatusBarProxy).getUser() && choice.value != "testapi") {
                (0, OutputUtils_1.promptForSignIn)();
                return;
            }
            if (choice.value == "byid") {
                yield this.searchProblemByID();
            }
            else if (choice.value == "range") {
                yield this.searchScoreRange();
            }
            else if (choice.value == "contest") {
                yield this.searchContest();
            }
            else if (choice.value == "today") {
                yield BABA_1.BABA.getProxy(BABA_1.BabaStr.TodayDataProxy).searchToday();
            }
            else if (choice.value == "userContest") {
                yield this.searchUserContest();
            }
            else if (choice.value == "testapi") {
                yield this.testapi();
            }
        });
    }
    getHelp(input) {
        return __awaiter(this, void 0, void 0, function* () {
            let problemInput;
            if (input instanceof TreeNodeModel_1.TreeNodeModel) {
                // Triggerred from explorer
                problemInput = input.qid;
            }
            else if (input instanceof vscode.Uri) {
                // Triggerred from Code Lens/context menu
                if (systemUtils.useVscodeNode()) {
                    problemInput = `${input.fsPath}`;
                }
                else {
                    problemInput = `"${input.fsPath}"`;
                    if (systemUtils.useWsl()) {
                        problemInput = yield systemUtils.toWslPath(input.fsPath);
                    }
                }
            }
            else if (!input) {
                // Triggerred from command
                problemInput = yield (0, SystemUtils_1.getTextEditorFilePathByUri)();
            }
            if (!problemInput) {
                (0, OutputUtils_1.ShowMessage)("Invalid input to fetch the solution data.", ConstDefind_1.OutPutType.error);
                return;
            }
            const language = yield (0, ConfigUtils_1.fetchProblemLanguage)();
            if (!language) {
                return;
            }
            const picks = [];
            picks.push({
                label: "获取中文站题解",
                description: "",
                detail: "",
                value: "cn",
            }, {
                label: "获取英文站题解",
                description: "",
                detail: "",
                value: "en",
            }, {
                label: "获取提示",
                description: "",
                detail: "",
                value: "cnhints",
            });
            const choice = yield vscode.window.showQuickPick(picks);
            if (!choice) {
                return;
            }
            try {
                if (choice.value == "cn" || choice.value == "en") {
                    const solution = yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy)
                        .get_instance()
                        .getHelp(problemInput, language, (0, ConfigUtils_1.isUseEndpointTranslation)(), choice.value == "cn");
                    BABA_1.BABA.getProxy(BABA_1.BabaStr.SolutionProxy).show(solution);
                }
                else if (choice.value == "cnhints") {
                    const hints = yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy).get_instance().getHints(problemInput);
                    BABA_1.BABA.getProxy(BABA_1.BabaStr.SolutionProxy).show(hints, true);
                }
            }
            catch (error) {
                BABA_1.BABA.getProxy(BABA_1.BabaStr.LogOutputProxy).get_log().appendLine(error.toString());
                yield (0, OutputUtils_1.ShowMessage)("Failed to fetch the top voted solution. 请查看控制台信息~", ConstDefind_1.OutPutType.error);
            }
        });
    }
    testapi() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
            }
            catch (error) {
                BABA_1.BABA.getProxy(BABA_1.BabaStr.LogOutputProxy).get_log().appendLine(error.toString());
                yield (0, OutputUtils_1.ShowMessage)("Failed to fetch today question. 请查看控制台信息~", ConstDefind_1.OutPutType.error);
            }
        });
    }
    searchProblemByID() {
        return __awaiter(this, void 0, void 0, function* () {
            let sbp = BABA_1.BABA.getProxy(BABA_1.BabaStr.StatusBarProxy);
            if (!sbp.getUser()) {
                (0, OutputUtils_1.promptForSignIn)();
                return;
            }
            const choice = yield vscode.window.showQuickPick(yield this.parseProblemsToPicks(BABA_1.BABA.getProxy(BABA_1.BabaStr.QuestionDataProxy).getfidMapQuestionData()), {
                matchOnDetail: true,
                matchOnDescription: true,
                placeHolder: "Select one problem",
            });
            if (!choice) {
                return;
            }
            yield this.showProblemInternal(choice.value);
        });
    }
    showProblem(node) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!node) {
                return;
            }
            yield this.showProblemInternal(node);
        });
    }
    initializeProblemSidecars(node, filePath, workspaceFolder, language, needTranslation) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (language === "cpp") {
                    const definitionPath = this.writeCppDefinitionFile(workspaceFolder);
                    this.ensureCppIntelliSenseConfig(workspaceFolder, definitionPath);
                    this.refreshCppLanguageServices();
                }
                this.migrateLeetCodeScaffoldingForFile(filePath, workspaceFolder);
                storageUtils.writeProblemMeta(filePath, {
                    app: "leetcode",
                    id: node.id || node.fid || node.qid,
                    fid: node.fid || node.id || node.qid,
                    lang: language,
                }, workspaceFolder);
                if (storageUtils.readProblemCases(filePath, node.id || node.fid || node.qid).length > 0) {
                    return;
                }
                const descString = yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy)
                    .get_instance()
                    .getDescription(node.qid, needTranslation);
                const response = JSON.parse(descString);
                const desc = response && response.code === 100 && response.msg ? response.msg.desc : "";
                const cases = desc ? storageUtils.getAllCase(desc) : [];
                if (cases.length > 0) {
                    storageUtils.writeProblemCases(filePath, node.id || node.fid || node.qid, cases, workspaceFolder);
                }
            }
            catch (_) {
                // Sidecar data is an editor convenience; problem creation should still succeed.
            }
        });
    }
    writeCppDefinitionFile(workspaceFolder) {
        const definitionPath = path.join(workspaceFolder, ".lcpr_data", "cpp", "leetcode-definition.hpp");
        fse.ensureDirSync(path.dirname(definitionPath));
        fs.writeFileSync(definitionPath, [
            "#pragma once",
            "#include <algorithm>",
            "#include <array>",
            "#include <cassert>",
            "#include <bitset>",
            "#include <cctype>",
            "#include <climits>",
            "#include <cmath>",
            "#include <cstddef>",
            "#include <cstdlib>",
            "#include <cstring>",
            "#include <deque>",
            "#include <functional>",
            "#include <iomanip>",
            "#include <iostream>",
            "#include <limits>",
            "#include <list>",
            "#include <map>",
            "#include <memory>",
            "#include <numeric>",
            "#include <queue>",
            "#include <set>",
            "#include <sstream>",
            "#include <stack>",
            "#include <string>",
            "#include <tuple>",
            "#include <unordered_map>",
            "#include <unordered_set>",
            "#include <utility>",
            "#include <vector>",
            "using namespace std;",
            "",
            "struct ListNode {",
            "    int val;",
            "    ListNode *next;",
            "    ListNode() : val(0), next(nullptr) {}",
            "    explicit ListNode(int x) : val(x), next(nullptr) {}",
            "    ListNode(int x, ListNode *next) : val(x), next(next) {}",
            "};",
            "",
            "struct TreeNode {",
            "    int val;",
            "    TreeNode *left;",
            "    TreeNode *right;",
            "    TreeNode() : val(0), left(nullptr), right(nullptr) {}",
            "    explicit TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}",
            "    TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}",
            "};",
            "",
            "class Node {",
            "public:",
            "    int val;",
            "    Node *next;",
            "    Node *random;",
            "    Node *left;",
            "    Node *right;",
            "    vector<Node *> neighbors;",
            "    vector<Node *> children;",
            "    Node() : val(0), next(nullptr), random(nullptr), left(nullptr), right(nullptr) {}",
            "    explicit Node(int _val) : val(_val), next(nullptr), random(nullptr), left(nullptr), right(nullptr) {}",
            "    Node(int _val, vector<Node *> _neighbors) : val(_val), next(nullptr), random(nullptr), left(nullptr), right(nullptr), neighbors(_neighbors) {}",
            "    Node(int _val, Node *_next, Node *_random) : val(_val), next(_next), random(_random), left(nullptr), right(nullptr) {}",
            "    Node(int _val, Node *_left, Node *_right, Node *_next) : val(_val), next(_next), random(nullptr), left(_left), right(_right) {}",
            "};",
            "",
            "class NestedInteger {",
            "public:",
            "    NestedInteger();",
            "    NestedInteger(int value);",
            "    bool isInteger() const;",
            "    int getInteger() const;",
            "    void setInteger(int value);",
            "    void add(const NestedInteger &ni);",
            "    const vector<NestedInteger> &getList() const;",
            "};",
            "",
            "class MountainArray {",
            "public:",
            "    int get(int index);",
            "    int length();",
            "};",
            "",
            "class Master {",
            "public:",
            "    int guess(string word);",
            "};",
            "",
            "bool isBadVersion(int version);",
            "int guess(int num);",
            "bool knows(int a, int b);",
            "",
        ].join("\n"));
        return definitionPath;
    }
    ensureCppIntelliSenseConfig(workspaceFolder, definitionPath) {
        try {
            this.ensureCppToolsProperties(workspaceFolder, definitionPath);
            this.ensureCppToolsSettings(workspaceFolder, definitionPath);
            this.ensureClangdConfig(workspaceFolder, definitionPath);
        }
        catch (_) {
            // Keep source generation independent from local C++ extension settings.
        }
    }
    ensureCppToolsProperties(workspaceFolder, definitionPath) {
        try {
            const vscodeDir = path.join(workspaceFolder, ".vscode");
            const configPath = path.join(vscodeDir, "c_cpp_properties.json");
            fse.ensureDirSync(vscodeDir);
            let config;
            if (fs.existsSync(configPath)) {
                config = JSON.parse(fs.readFileSync(configPath, "utf8"));
            }
            else {
                config = {
                    configurations: [
                        {
                            name: "LeetcodeUltra",
                            includePath: ["${workspaceFolder}/**"],
                            forcedInclude: [],
                            cppStandard: "c++17",
                        },
                    ],
                    version: 4,
                };
            }
            if (!Array.isArray(config.configurations) || config.configurations.length === 0) {
                config.configurations = [{ name: "LeetcodeUltra", includePath: ["${workspaceFolder}/**"], forcedInclude: [] }];
            }
            let changed = false;
            config.configurations.forEach((item) => {
                if (!Array.isArray(item.includePath)) {
                    item.includePath = ["${workspaceFolder}/**"];
                    changed = true;
                }
                if (!Array.isArray(item.forcedInclude)) {
                    item.forcedInclude = [];
                    changed = true;
                }
                if (item.forcedInclude.indexOf(definitionPath) < 0) {
                    item.forcedInclude.push(definitionPath);
                    changed = true;
                }
                if (item.configurationProvider && item.mergeConfigurations !== true) {
                    item.mergeConfigurations = true;
                    changed = true;
                }
                if (!item.cppStandard) {
                    item.cppStandard = "c++17";
                    changed = true;
                }
            });
            if (changed || !fs.existsSync(configPath)) {
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
            }
        }
        catch (_) {
            // Invalid user JSON should not block opening a problem.
        }
    }
    ensureCppToolsSettings(workspaceFolder, definitionPath) {
        try {
            const vscodeDir = path.join(workspaceFolder, ".vscode");
            const settingsPath = path.join(vscodeDir, "settings.json");
            fse.ensureDirSync(vscodeDir);
            let settings = {};
            if (fs.existsSync(settingsPath)) {
                settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
            }
            const key = "C_Cpp.default.forcedInclude";
            const forcedInclude = Array.isArray(settings[key]) ? settings[key] : [];
            let changed = !Array.isArray(settings[key]);
            if (forcedInclude.indexOf(definitionPath) < 0) {
                forcedInclude.push(definitionPath);
                changed = true;
            }
            settings[key] = forcedInclude;
            if (!settings["C_Cpp.default.cppStandard"]) {
                settings["C_Cpp.default.cppStandard"] = "c++17";
                changed = true;
            }
            if (changed || !fs.existsSync(settingsPath)) {
                fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
            }
        }
        catch (_) {
            // Invalid user JSON should not block opening a problem.
        }
    }
    ensureClangdConfig(workspaceFolder, definitionPath) {
        try {
            const clangdPath = path.join(workspaceFolder, ".clangd");
            const start = "# LCPR_LEETCODEULTRA_START";
            const end = "# LCPR_LEETCODEULTRA_END";
            const fragment = [
                start,
                "---",
                "If:",
                "  PathMatch: .*\\.(cpp|cc|cxx|hpp|h)$",
                "CompileFlags:",
                "  Add:",
                `    - ${JSON.stringify("-include")}`,
                `    - ${JSON.stringify(definitionPath)}`,
                `    - ${JSON.stringify("-std=c++17")}`,
                end,
                "",
            ].join("\n");
            let content = fs.existsSync(clangdPath) ? fs.readFileSync(clangdPath, "utf8") : "";
            const markerRegExp = new RegExp(`${start}[\\s\\S]*?${end}\\n?`, "m");
            if (markerRegExp.test(content)) {
                content = content.replace(markerRegExp, fragment);
            }
            else {
                content = `${content.replace(/\s*$/g, "")}${content.trim() ? "\n\n" : ""}${fragment}`;
            }
            fs.writeFileSync(clangdPath, content);
        }
        catch (_) {
            // .clangd is best-effort because users may maintain their own config.
        }
    }
    refreshCppLanguageServices() {
        const cppConfig = vscode.workspace.getConfiguration("C_Cpp");
        if (cppConfig.get("intelliSenseEngine") !== "disabled") {
            vscode.commands.executeCommand("C_Cpp.RescanWorkspace").then(undefined, () => undefined);
        }
        vscode.commands.executeCommand("clangd.restart").then(undefined, () => undefined);
    }
    pickOne() {
        return __awaiter(this, void 0, void 0, function* () {
            const picks = [];
            let last_pick = yield groupDao_1.groupDao.getPickOneTags();
            let last_tag_set = new Set();
            last_pick.forEach((tag_name) => {
                last_tag_set.add(tag_name);
            });
            for (const tag of BABA_1.BABA.getProxy(BABA_1.BabaStr.QuestionDataProxy).getTagSet().values()) {
                let pick_item = {
                    label: tag,
                    detail: "",
                    value: tag,
                };
                if (last_tag_set.has(tag)) {
                    pick_item.picked = true;
                }
                picks.push(pick_item);
            }
            const user_score = BABA_1.BABA.getProxy(BABA_1.BabaStr.StatusBarProxy).getUserContestScore() || 0;
            let min_score = (0, ConfigUtils_1.getPickOneByRankRangeMin)();
            let max_score = (0, ConfigUtils_1.getPickOneByRankRangeMax)();
            const need_min = user_score + min_score;
            const need_max = user_score + max_score;
            const choice = yield vscode_1.window.showQuickPick(picks, {
                title: user_score > 0 ? `手气一下,score:[${Math.ceil(need_min)} - ${Math.floor(need_max)}]` : "手气一下",
                matchOnDescription: false,
                matchOnDetail: false,
                placeHolder: "指定Tag类型",
                canPickMany: true,
            });
            if (!choice) {
                return;
            }
            // 写入选择
            let cur_tag_set = new Set();
            choice.forEach((element) => {
                cur_tag_set.add(element.value);
            });
            const problems = yield BABA_1.BABA.getProxy(BABA_1.BabaStr.QuestionDataProxy).getfidMapQuestionData();
            let randomProblem;
            if (user_score > 0) {
                let temp_problems = [];
                problems.forEach((element) => {
                    var _a;
                    if ((_a = BABA_1.BABA.getProxy(BABA_1.BabaStr.RankScoreDataProxy).getDataByFid(element.id)) === null || _a === void 0 ? void 0 : _a.Rating) {
                        if (BABA_1.BABA.getProxy(BABA_1.BabaStr.RankScoreDataProxy).getDataByFid(element.id).Rating >= need_min &&
                            BABA_1.BABA.getProxy(BABA_1.BabaStr.RankScoreDataProxy).getDataByFid(element.id).Rating <= need_max) {
                            for (const q_tag of BABA_1.BABA.getProxy(BABA_1.BabaStr.TreeDataProxy).getTagsData(element.id)) {
                                if (cur_tag_set.has(q_tag)) {
                                    temp_problems.push(element);
                                }
                            }
                        }
                    }
                });
                randomProblem = temp_problems[Math.floor(Math.random() * temp_problems.length)];
            }
            else {
                randomProblem = problems[Math.floor(Math.random() * problems.length)];
            }
            if (randomProblem) {
                yield this.showProblemInternal(randomProblem);
            }
            // 写入
            let new_pick_one_tags = [];
            for (const new_tag of cur_tag_set) {
                new_pick_one_tags.push(new_tag);
            }
            yield groupDao_1.groupDao.setPickOneTags(new_pick_one_tags);
        });
    }
    showProblemInternal(node) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const language = yield (0, ConfigUtils_1.fetchProblemLanguage)();
                if (!language) {
                    return;
                }
                const leetCodeConfig = vscode.workspace.getConfiguration("leetcode-problem-rating");
                const workspaceFolder = yield (0, ConfigUtils_1.selectWorkspaceFolder)();
                if (!workspaceFolder) {
                    return;
                }
                const fileFolder = leetCodeConfig
                    .get(`filePath.${language}.folder`, leetCodeConfig.get(`filePath.default.folder`, ""))
                    .trim();
                const fileName = leetCodeConfig
                    .get(`filePath.${language}.filename`, leetCodeConfig.get(`filePath.default.filename`) || (0, SystemUtils_1.genFileName)(node, language))
                    .trim();
                let finalPath = path.join(workspaceFolder, fileFolder, fileName);
                if (finalPath) {
                    finalPath = yield this.resolveRelativePath(finalPath, node, language);
                    if (!finalPath) {
                        BABA_1.BABA.getProxy(BABA_1.BabaStr.LogOutputProxy).get_log().appendLine("Showing problem canceled by user.");
                        return;
                    }
                }
                finalPath = systemUtils.useWsl() ? yield systemUtils.toWinPath(finalPath) : finalPath;
                const descriptionConfig = (0, ConfigUtils_1.getDescriptionConfiguration)();
                const needTranslation = (0, ConfigUtils_1.isUseEndpointTranslation)();
                let show_code = yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy)
                    .get_instance()
                    .showProblem(node, language, finalPath, descriptionConfig.showInComment, needTranslation);
                if (show_code == 100) {
                    yield this.initializeProblemSidecars(node, finalPath, workspaceFolder, language, needTranslation);
                    const promises = [
                        vscode.window
                            .showTextDocument(vscode.Uri.file(finalPath), {
                            preview: false,
                            viewColumn: vscode.ViewColumn.One,
                        })
                            .then((editor) => {
                            BABA_1.BABA.sendNotification(BABA_1.BabaStr.showProblemFinishOpen, { node: node, editor: editor });
                        }, (error) => {
                            BABA_1.BABA.sendNotification(BABA_1.BabaStr.showProblemFinishError, { node: node, error: error });
                        }),
                        (0, OutputUtils_1.promptHintMessage)("hint.commentDescription", 'You can config how to show the problem description through "leetcode-problem-rating.showDescription".', "Open settings", () => (0, ConfigUtils_1.openSettingsEditor)("leetcode-problem-rating.showDescription")),
                    ];
                    if (descriptionConfig.showInWebview) {
                        promises.push(this.showDescriptionView(node));
                    }
                    promises.push(new Promise((resolve, _) => __awaiter(this, void 0, void 0, function* () {
                        BABA_1.BABA.sendNotification(BABA_1.BabaStr.showProblemFinish, node);
                        resolve(1);
                    })));
                    yield Promise.all(promises);
                }
            }
            catch (error) {
                yield (0, OutputUtils_1.ShowMessage)(`${error} 请查看控制台信息~`, ConstDefind_1.OutPutType.error);
            }
        });
    }
    showDescriptionView(node) {
        return __awaiter(this, void 0, void 0, function* () {
            BABA_1.BABA.sendNotification(BABA_1.BabaStr.BABACMD_previewProblem, { input: node, isSideMode: (0, ConfigUtils_1.enableSideMode)() });
        });
    }
    searchScoreRange() {
        return __awaiter(this, void 0, void 0, function* () {
            const twoFactor = yield vscode.window.showInputBox({
                prompt: "输入分数范围 低分-高分 例如: 1500-1600",
                ignoreFocusOut: true,
                validateInput: (s) => (s && s.trim() ? undefined : "The input must not be empty"),
            });
            // vscode.window.showErrorMessage(twoFactor || "输入错误");
            const tt = Object.assign({}, ConstDefind_1.SearchNode, {
                value: twoFactor,
                type: ConstDefind_1.SearchSetType.ScoreRange,
                time: Math.floor(Date.now() / 1000),
            });
            treeViewController.insertSearchSet(tt);
            BABA_1.BABA.sendNotification(BABA_1.BabaStr.TreeData_searchScoreRangeFinish);
        });
    }
    searchContest() {
        return __awaiter(this, void 0, void 0, function* () {
            const twoFactor = yield vscode.window.showInputBox({
                prompt: "单期数 例如: 300 或者 输入期数范围 低期数-高期数 例如: 303-306",
                ignoreFocusOut: true,
                validateInput: (s) => (s && s.trim() ? undefined : "The input must not be empty"),
            });
            // vscode.window.showErrorMessage(twoFactor || "输入错误");
            const tt = Object.assign({}, ConstDefind_1.SearchNode, {
                value: twoFactor,
                type: ConstDefind_1.SearchSetType.Context,
                time: Math.floor(Date.now() / 1000),
            });
            treeViewController.insertSearchSet(tt);
            BABA_1.BABA.sendNotification(BABA_1.BabaStr.TreeData_searchContest);
        });
    }
    searchUserContest() {
        return __awaiter(this, void 0, void 0, function* () {
            let sbp = BABA_1.BABA.getProxy(BABA_1.BabaStr.StatusBarProxy);
            if (!sbp.getUser()) {
                (0, OutputUtils_1.promptForSignIn)();
                return;
            }
            try {
                const needTranslation = (0, ConfigUtils_1.isUseEndpointTranslation)();
                const solution = yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy)
                    .get_instance()
                    .getUserContest(needTranslation, sbp.getUser() || "");
                const query_result = JSON.parse(solution);
                const tt = Object.assign({}, ConstDefind_1.userContestRankingObj, query_result.userContestRanking);
                BABA_1.BABA.sendNotification(BABA_1.BabaStr.TreeData_searchUserContest, tt);
            }
            catch (error) {
                BABA_1.BABA.getProxy(BABA_1.BabaStr.LogOutputProxy).get_log().appendLine(error.toString());
                yield (0, OutputUtils_1.ShowMessage)("Failed to fetch today question. 请查看控制台信息~", ConstDefind_1.OutPutType.error);
            }
        });
    }
    parseProblemsToPicks(p) {
        const picks = [];
        p.forEach((problem) => {
            var _a, _b;
            picks.push(Object.assign({}, {
                label: `${this.parseProblemDecorator(problem.state, problem.locked)}${problem.id}.${problem.name}`,
                description: `QID:${problem.qid}`,
                detail: ((((_a = problem.scoreData) === null || _a === void 0 ? void 0 : _a.score) || "0") > "0" ? "score: " + ((_b = problem.scoreData) === null || _b === void 0 ? void 0 : _b.score) + " , " : "") +
                    `AC rate: ${problem.passRate}, Difficulty: ${problem.difficulty}`,
                value: problem,
            }));
        });
        return picks;
    }
    parseProblemDecorator(state, locked) {
        switch (state) {
            case ConstDefind_1.ProblemState.AC:
                return "$(check) ";
            case ConstDefind_1.ProblemState.NotAC:
                return "$(x) ";
            default:
                return locked ? "$(lock) " : "";
        }
    }
    resolveRelativePath(relativePath, node, selectedLanguage) {
        return __awaiter(this, void 0, void 0, function* () {
            let tag = "";
            if (/\$\{tag\}/i.test(relativePath)) {
                tag = (yield this.resolveTagForProblem(node)) || "";
            }
            let company = "";
            if (/\$\{company\}/i.test(relativePath)) {
                company = (yield this.resolveCompanyForProblem(node)) || "";
            }
            let errorMsg;
            return relativePath.replace(/\$\{(.*?)\}/g, (_substring, ...args) => {
                const placeholder = args[0].toLowerCase().trim();
                switch (placeholder) {
                    case "id":
                        return node.id;
                    case "cnname":
                    case "cn_name":
                        return node.cn_name || node.name;
                    case "name":
                        return node.en_name || node.name;
                    case "camelcasename":
                        return lodash.camelCase(node.en_name || node.name);
                    case "pascalcasename":
                        return lodash.upperFirst(lodash.camelCase(node.en_name || node.name));
                    case "kebabcasename":
                    case "kebab-case-name":
                        return lodash.kebabCase(node.en_name || node.name);
                    case "snakecasename":
                    case "snake_case_name":
                        return lodash.snakeCase(node.en_name || node.name);
                    case "ext":
                        return (0, SystemUtils_1.genFileExt)(selectedLanguage);
                    case "language":
                        return selectedLanguage;
                    case "difficulty":
                        return node.difficulty.toLocaleLowerCase();
                    case "tag":
                        return tag;
                    case "company":
                        return company;
                    case "yyyymmdd":
                        return (0, SystemUtils_1.getyyyymmdd)(undefined);
                    case "timestamp":
                        return (0, SystemUtils_1.getDayNowStr)();
                    default:
                        errorMsg = `The config '${placeholder}' is not supported.`;
                        BABA_1.BABA.getProxy(BABA_1.BabaStr.LogOutputProxy).get_log().appendLine(errorMsg);
                        throw new Error(errorMsg);
                }
            });
        });
    }
    resolveTagForProblem(problem) {
        return __awaiter(this, void 0, void 0, function* () {
            let path_en_tags = BABA_1.BABA.getProxy(BABA_1.BabaStr.TreeDataProxy).getTagsDataEn(problem.id);
            if (path_en_tags.length === 1) {
                return path_en_tags[0];
            }
            return yield vscode.window.showQuickPick(path_en_tags, {
                matchOnDetail: true,
                placeHolder: "Multiple tags available, please select one",
                ignoreFocusOut: true,
            });
        });
    }
    resolveCompanyForProblem(problem) {
        return __awaiter(this, void 0, void 0, function* () {
            if (problem.companies.length === 1) {
                return problem.companies[0];
            }
            return yield vscode.window.showQuickPick(problem.companies, {
                matchOnDetail: true,
                placeHolder: "Multiple tags available, please select one",
                ignoreFocusOut: true,
            });
        });
    }
    insertSearchSet(tt) {
        this.searchSet.set(tt.value, tt);
    }
    clearUserScore() {
        this.waitUserContest = false;
        this.waitTodayQuestion = false;
        this.searchSet = new Map();
    }
    refreshCheck() {
        return __awaiter(this, void 0, void 0, function* () {
            let sbp = BABA_1.BABA.getProxy(BABA_1.BabaStr.StatusBarProxy);
            if (!sbp.getUser()) {
                return;
            }
            // const day_start = systemUtils.getDayStart(); //获取当天零点的时间
            // const day_end = systemUtils.getDayEnd(); //获取当天23:59:59的时间
            // let need_get_today: boolean = true;
            // this.searchSet.forEach((element) => {
            //   if (element.type == SearchSetType.Day) {
            //     if (day_start <= element.time && element.time <= day_end) {
            //       need_get_today = false;
            //     } else {
            //       this.waitTodayQuestion = false;
            //     }
            //   }
            // });
            // if (need_get_today && !this.waitTodayQuestion) {
            //   this.waitTodayQuestion = true;
            //   await BABA.getProxy(BabaStr.TodayDataProxy).searchToday();
            // }
            const user_score = BABA_1.BABA.getProxy(BABA_1.BabaStr.StatusBarProxy).getUserContestScore();
            if (!user_score && !this.waitUserContest) {
                this.waitUserContest = true;
                yield this.searchUserContest();
            }
        });
    }
    refreshCache() {
        return __awaiter(this, void 0, void 0, function* () {
            const temp_searchSet = this.searchSet;
            const temp_waitTodayQuestion = this.waitTodayQuestion;
            const temp_waitUserContest = this.waitUserContest;
            BABA_1.BABA.sendNotification(BABA_1.BabaStr.QuestionData_ReBuildQuestionData);
            this.searchSet = temp_searchSet;
            this.waitTodayQuestion = temp_waitTodayQuestion;
            this.waitUserContest = temp_waitUserContest;
        });
    }
    getRootNodes() {
        const baseNode = [
            (0, TreeNodeModel_1.CreateTreeNodeModel)({
                id: ConstDefind_1.Category.All,
                name: ConstDefind_1.Category.All,
                rootNodeSortId: ConstDefind_1.RootNodeSort.All,
            }, TreeNodeModel_1.TreeNodeType.Tree_All),
            (0, TreeNodeModel_1.CreateTreeNodeModel)({
                id: ConstDefind_1.Category.Difficulty,
                name: ConstDefind_1.Category.Difficulty,
                rootNodeSortId: ConstDefind_1.RootNodeSort.Difficulty,
            }, TreeNodeModel_1.TreeNodeType.Tree_difficulty),
            (0, TreeNodeModel_1.CreateTreeNodeModel)({
                id: ConstDefind_1.Category.Tag,
                name: ConstDefind_1.Category.Tag,
                rootNodeSortId: ConstDefind_1.RootNodeSort.Tag,
            }, TreeNodeModel_1.TreeNodeType.Tree_tag),
            (0, TreeNodeModel_1.CreateTreeNodeModel)({
                id: ConstDefind_1.Category.Favorite,
                name: ConstDefind_1.Category.Favorite,
                rootNodeSortId: ConstDefind_1.RootNodeSort.Favorite,
            }, TreeNodeModel_1.TreeNodeType.Tree_favorite),
            (0, TreeNodeModel_1.CreateTreeNodeModel)({
                id: ConstDefind_1.Category.Score,
                name: ConstDefind_1.Category.Score,
                rootNodeSortId: ConstDefind_1.RootNodeSort.Score,
            }, TreeNodeModel_1.TreeNodeType.Tree_score),
            (0, TreeNodeModel_1.CreateTreeNodeModel)({
                id: ConstDefind_1.Category.Choice,
                name: ConstDefind_1.Category.Choice,
                rootNodeSortId: ConstDefind_1.RootNodeSort.Choice,
            }, TreeNodeModel_1.TreeNodeType.Tree_choice),
            (0, TreeNodeModel_1.CreateTreeNodeModel)({
                id: ConstDefind_1.Category.Carl,
                name: "代码随想录题单",
                rootNodeSortId: ConstDefind_1.RootNodeSort.Carl,
            }, TreeNodeModel_1.TreeNodeType.Tree_carl),
            (0, TreeNodeModel_1.CreateTreeNodeModel)({
                id: ConstDefind_1.Category.Contest,
                name: ConstDefind_1.Category.Contest,
                rootNodeSortId: ConstDefind_1.RootNodeSort.Contest,
            }, TreeNodeModel_1.TreeNodeType.Tree_contest),
        ];
        // 获取每日一题的数据
        let today_info = BABA_1.BABA.getProxy(BABA_1.BabaStr.TodayDataProxy).getAllTodayData();
        today_info.forEach((element) => {
            const curDate = new Date(element.time * 1000);
            baseNode.push((0, TreeNodeModel_1.CreateTreeNodeModel)({
                id: element.fid,
                name: `[${curDate.getFullYear()}-${curDate.getMonth() + 1}-${curDate.getDate()}]${ConstDefind_1.SearchSetTypeName[ConstDefind_1.SearchSetType.Day]}`,
                isSearchResult: true,
                rootNodeSortId: ConstDefind_1.RootNodeSort.Day,
            }, TreeNodeModel_1.TreeNodeType.Tree_day));
        });
        this.searchSet.forEach((element) => {
            baseNode.push((0, TreeNodeModel_1.CreateTreeNodeModel)({
                id: element.type,
                name: ConstDefind_1.SearchSetTypeName[element.type] + element.value,
                input: element.value,
                isSearchResult: true,
                rootNodeSortId: ConstDefind_1.RootNodeSort[element.type],
            }, TreeNodeModel_1.TreeNodeType.Tree_search));
        });
        baseNode.sort(function (a, b) {
            if (a.rootNodeSortId < b.rootNodeSortId) {
                return -1;
            }
            else if (a.rootNodeSortId > b.rootNodeSortId) {
                return 1;
            }
            return 0;
        });
        return baseNode;
    }
    getScoreRangeNodes(rank_range) {
        const sorceNode = [];
        const rank_r = rank_range.split("-");
        let rank_a = Number(rank_r[0]);
        let rank_b = Number(rank_r[1]);
        if (rank_a > 0 && rank_b > 0) {
            if (rank_a > rank_b) {
                const rank_c = rank_a;
                rank_a = rank_b;
                rank_b = rank_c;
            }
            BABA_1.BABA.getProxy(BABA_1.BabaStr.QuestionDataProxy)
                .getfidMapQuestionData()
                .forEach((element) => {
                if (!this.canShow(element)) {
                    return;
                }
                if (rank_a <= Number(element.score) && Number(element.score) <= rank_b) {
                    sorceNode.push((0, TreeNodeModel_1.CreateTreeNodeModel)(element.get_data(), TreeNodeModel_1.TreeNodeType.Tree_search_score_leaf));
                }
            });
        }
        return (0, ConfigUtils_2.sortNodeList)(sorceNode);
    }
    canShow(element) {
        if ((0, ConfigUtils_1.isHideSolvedProblem)() && element.state === ConstDefind_1.ProblemState.AC) {
            return false;
        }
        if ((0, ConfigUtils_1.isHideScoreProblem)(element)) {
            return false;
        }
        return true;
    }
    getContestNodes(rank_range) {
        const sorceNode = [];
        const rank_r = rank_range.split("-");
        let rank_a = Number(rank_r[0]);
        let rank_b = Number(rank_r[1]);
        if (rank_a > 0) {
            BABA_1.BABA.getProxy(BABA_1.BabaStr.QuestionDataProxy)
                .getfidMapQuestionData()
                .forEach((element) => {
                const slu = element.ContestSlug;
                const slu_arr = slu.split("-");
                const slu_id = Number(slu_arr[slu_arr.length - 1]);
                if (rank_b > 0 && rank_a <= slu_id && slu_id <= rank_b) {
                    sorceNode.push((0, TreeNodeModel_1.CreateTreeNodeModel)(element.get_data(), TreeNodeModel_1.TreeNodeType.Tree_search_contest_leaf));
                }
                else if (rank_a == slu_id) {
                    sorceNode.push((0, TreeNodeModel_1.CreateTreeNodeModel)(element.get_data(), TreeNodeModel_1.TreeNodeType.Tree_search_contest_leaf));
                }
            });
        }
        return (0, ConfigUtils_2.sortNodeList)(sorceNode);
    }
    getDayNodes(element) {
        const fid = (element === null || element === void 0 ? void 0 : element.id) || "";
        const sorceNode = [];
        // 获取这题的数据
        let DayQuestionNode = BABA_1.BABA.getProxy(BABA_1.BabaStr.QuestionDataProxy).getNodeById(fid);
        if (DayQuestionNode != undefined) {
            sorceNode.push((0, TreeNodeModel_1.CreateTreeNodeModel)(DayQuestionNode.get_data(), TreeNodeModel_1.TreeNodeType.Tree_day_leaf));
        }
        return (0, ConfigUtils_2.sortNodeList)(sorceNode);
    }
    getAllNodes() {
        const res = [];
        BABA_1.BABA.getProxy(BABA_1.BabaStr.QuestionDataProxy)
            .getfidMapQuestionData()
            .forEach((node) => {
            if (this.canShow(node)) {
                res.push((0, TreeNodeModel_1.CreateTreeNodeModel)(node.get_data(), TreeNodeModel_1.TreeNodeType.Tree_All_leaf));
            }
        });
        return (0, ConfigUtils_2.sortNodeList)(res);
    }
    getDifficultyChild() {
        const res = [];
        res.push((0, TreeNodeModel_1.CreateTreeNodeModel)({
            id: `Easy`,
            name: "Easy",
            rootNodeSortId: ConstDefind_1.RootNodeSort.DIFEASY,
        }, TreeNodeModel_1.TreeNodeType.Tree_difficulty_easy), (0, TreeNodeModel_1.CreateTreeNodeModel)({
            id: `Medium`,
            name: "Medium",
            rootNodeSortId: ConstDefind_1.RootNodeSort.DIFMID,
        }, TreeNodeModel_1.TreeNodeType.Tree_difficulty_mid), (0, TreeNodeModel_1.CreateTreeNodeModel)({
            id: `Hard`,
            name: "Hard",
            rootNodeSortId: ConstDefind_1.RootNodeSort.DIFHARD,
        }, TreeNodeModel_1.TreeNodeType.Tree_difficulty_hard));
        return res;
    }
    getScoreChild() {
        const user_score = BABA_1.BABA.getProxy(BABA_1.BabaStr.StatusBarProxy).getUserContestScore();
        const res = [];
        const score_array = [
            "3300",
            "3200",
            "3100",
            "3000",
            "2900",
            "2800",
            "2700",
            "2600",
            "2500",
            "2400",
            "2300",
            "2200",
            "2100",
            "2000",
            "1900",
            "1800",
            "1700",
            "1600",
            "1500",
            "1400",
            "1300",
            "1200",
            "1100",
        ];
        score_array.forEach((score_str) => {
            const temp_num = Number(score_str);
            const diff = Math.abs(temp_num - user_score);
            if (diff <= 200) {
                res.push((0, TreeNodeModel_1.CreateTreeNodeModel)({
                    id: `${score_str}`,
                    name: `${score_str}`,
                    rootNodeSortId: temp_num,
                }, TreeNodeModel_1.TreeNodeType.Tree_score_fen));
            }
        });
        return res;
    }
    getContestChild() {
        const res = [];
        res.push((0, TreeNodeModel_1.CreateTreeNodeModel)({
            id: `Q1`,
            name: "Q1",
            rootNodeSortId: 1,
        }, TreeNodeModel_1.TreeNodeType.Tree_contest_Q1), (0, TreeNodeModel_1.CreateTreeNodeModel)({
            id: `Q2`,
            name: "Q2",
            rootNodeSortId: 2,
        }, TreeNodeModel_1.TreeNodeType.Tree_contest_Q2), (0, TreeNodeModel_1.CreateTreeNodeModel)({
            id: `Q3`,
            name: "Q3",
            rootNodeSortId: 3,
        }, TreeNodeModel_1.TreeNodeType.Tree_contest_Q3), (0, TreeNodeModel_1.CreateTreeNodeModel)({
            id: `Q4`,
            name: "Q4",
            rootNodeSortId: 4,
        }, TreeNodeModel_1.TreeNodeType.Tree_contest_Q4));
        return res;
    }
    getChoiceChild() {
        const res = [];
        const all_choice = BABA_1.BABA.getProxy(BABA_1.BabaStr.TreeDataProxy).getChoiceData();
        all_choice.forEach((element) => {
            res.push((0, TreeNodeModel_1.CreateTreeNodeModel)({
                id: `${element.id}`,
                name: `${element.name}`,
                rootNodeSortId: 4,
            }, TreeNodeModel_1.TreeNodeType.Tree_choice_fenlei));
        });
        return res;
    }
    getCarlChild() {
        return carlDao.getProblemList().map((section, index) => (0, TreeNodeModel_1.CreateTreeNodeModel)({
            id: section.id,
            name: section.name,
            rootNodeSortId: index,
        }, TreeNodeModel_1.TreeNodeType.Tree_carl_section));
    }
    getTagChild() {
        const res = [];
        for (const tag of BABA_1.BABA.getProxy(BABA_1.BabaStr.QuestionDataProxy).getTagSet().values()) {
            res.push((0, TreeNodeModel_1.CreateTreeNodeModel)({
                id: `${tag}`,
                name: lodash.startCase(tag),
                rootNodeSortId: 4,
            }, TreeNodeModel_1.TreeNodeType.Tree_tag_fenlei));
        }
        this.sortSubCategoryNodes(res, ConstDefind_1.Category.Tag);
        return res;
    }
    getFavoriteNodes() {
        const res = [];
        BABA_1.BABA.getProxy(BABA_1.BabaStr.QuestionDataProxy)
            .getfidMapQuestionData()
            .forEach((node) => {
            if (this.canShow(node) && node.isFavorite) {
                res.push((0, TreeNodeModel_1.CreateTreeNodeModel)(node.get_data(), TreeNodeModel_1.TreeNodeType.Tree_favorite_leaf));
            }
        });
        return (0, ConfigUtils_2.sortNodeList)(res);
    }
    // 第二层取第三层的叶子
    getChildrenSon(TreeChildNode) {
        const res = [];
        const choiceQuestionId = new Map();
        if (TreeChildNode.nodeType == TreeNodeModel_1.TreeNodeType.Tree_choice_fenlei) {
            const all_choice = BABA_1.BABA.getProxy(BABA_1.BabaStr.TreeDataProxy).getChoiceData();
            all_choice.forEach((element) => {
                if (element.id == TreeChildNode.id) {
                    element.questions.forEach((kk) => {
                        choiceQuestionId[kk] = true;
                    });
                    return;
                }
            });
        }
        if (TreeChildNode.nodeType == TreeNodeModel_1.TreeNodeType.Tree_carl_section) {
            const section = carlDao.getSection(TreeChildNode.id);
            if (!section) {
                return res;
            }
            for (const fid of section.questions) {
                const node = BABA_1.BABA.getProxy(BABA_1.BabaStr.QuestionDataProxy).getNodeById(fid);
                if (node && this.canShow(node)) {
                    res.push((0, TreeNodeModel_1.CreateTreeNodeModel)(node.get_data(), TreeNodeModel_1.TreeNodeType.Tree_carl_section_leaf));
                }
            }
            return res;
        }
        for (const node of BABA_1.BABA.getProxy(BABA_1.BabaStr.QuestionDataProxy).getfidMapQuestionData().values()) {
            if (!this.canShow(node)) {
                continue;
            }
            if (TreeChildNode.nodeType == TreeNodeModel_1.TreeNodeType.Tree_difficulty_easy) {
                if (node.get_data().difficulty === TreeChildNode.id) {
                    res.push((0, TreeNodeModel_1.CreateTreeNodeModel)(node.get_data(), TreeNodeModel_1.TreeNodeType.Tree_difficulty_easy_leaf));
                }
            }
            else if (TreeChildNode.nodeType == TreeNodeModel_1.TreeNodeType.Tree_difficulty_mid) {
                if (node.get_data().difficulty === TreeChildNode.id) {
                    res.push((0, TreeNodeModel_1.CreateTreeNodeModel)(node.get_data(), TreeNodeModel_1.TreeNodeType.Tree_difficulty_mid_leaf));
                }
            }
            else if (TreeChildNode.nodeType == TreeNodeModel_1.TreeNodeType.Tree_difficulty_hard) {
                if (node.get_data().difficulty === TreeChildNode.id) {
                    res.push((0, TreeNodeModel_1.CreateTreeNodeModel)(node.get_data(), TreeNodeModel_1.TreeNodeType.Tree_difficulty_hard_leaf));
                }
            }
            else if (TreeChildNode.nodeType == TreeNodeModel_1.TreeNodeType.Tree_tag_fenlei) {
                if (node.tags.indexOf(TreeChildNode.id) >= 0) {
                    res.push((0, TreeNodeModel_1.CreateTreeNodeModel)(node.get_data(), TreeNodeModel_1.TreeNodeType.Tree_tag_fenlei_leaf));
                }
            }
            else if (TreeChildNode.nodeType == TreeNodeModel_1.TreeNodeType.Tree_score_fen) {
                if (node.score > "0") {
                    const check_rank = (0, lodash_1.toNumber)(TreeChildNode.id);
                    const node_rank = (0, lodash_1.toNumber)(node.score);
                    if (check_rank <= node_rank && node_rank < check_rank + 100) {
                        res.push((0, TreeNodeModel_1.CreateTreeNodeModel)(node.get_data(), TreeNodeModel_1.TreeNodeType.Tree_score_fen_leaf));
                    }
                }
            }
            else if (TreeChildNode.nodeType == TreeNodeModel_1.TreeNodeType.Tree_choice_fenlei) {
                if (choiceQuestionId[Number(node.get_data().qid)]) {
                    res.push((0, TreeNodeModel_1.CreateTreeNodeModel)(node.get_data(), TreeNodeModel_1.TreeNodeType.Tree_choice_fenlei_leaf));
                }
            }
            else if (TreeChildNode.nodeType == TreeNodeModel_1.TreeNodeType.Tree_contest_Q1) {
                if (node.ProblemIndex == TreeChildNode.id) {
                    res.push((0, TreeNodeModel_1.CreateTreeNodeModel)(node.get_data(), TreeNodeModel_1.TreeNodeType.Tree_contest_Q1_leaf));
                }
            }
            else if (TreeChildNode.nodeType == TreeNodeModel_1.TreeNodeType.Tree_contest_Q2) {
                if (node.ProblemIndex == TreeChildNode.id) {
                    res.push((0, TreeNodeModel_1.CreateTreeNodeModel)(node.get_data(), TreeNodeModel_1.TreeNodeType.Tree_contest_Q2_leaf));
                }
            }
            else if (TreeChildNode.nodeType == TreeNodeModel_1.TreeNodeType.Tree_contest_Q3) {
                if (node.ProblemIndex == TreeChildNode.id) {
                    res.push((0, TreeNodeModel_1.CreateTreeNodeModel)(node.get_data(), TreeNodeModel_1.TreeNodeType.Tree_contest_Q3_leaf));
                }
            }
            else if (TreeChildNode.nodeType == TreeNodeModel_1.TreeNodeType.Tree_contest_Q4) {
                if (node.ProblemIndex == TreeChildNode.id) {
                    res.push((0, TreeNodeModel_1.CreateTreeNodeModel)(node.get_data(), TreeNodeModel_1.TreeNodeType.Tree_contest_Q4_leaf));
                }
            }
        }
        return (0, ConfigUtils_2.sortNodeList)(res);
    }
    dispose() {
        this.configurationChangeListener.dispose();
        BABA_1.BABA.sendNotification(BABA_1.BabaStr.QuestionData_clearCache);
    }
    sortSubCategoryNodes(subCategoryNodes, category) {
        switch (category) {
            case ConstDefind_1.Category.Tag:
                subCategoryNodes.sort((a, b) => {
                    if (a.name === "Unknown") {
                        return 1;
                    }
                    else if (b.name === "Unknown") {
                        return -1;
                    }
                    else {
                        return Number(a.name > b.name) - Number(a.name < b.name);
                    }
                });
                break;
            default:
                break;
        }
    }
}
export const treeViewController = new TreeViewController();
