// @ts-nocheck
import * as vscode from "vscode";
import * as ConfigUtils_1 from "../utils/ConfigUtils";
import * as problemUtils_1 from "../utils/problemUtils";
import * as storageUtils_1 from "../rpc/utils/storageUtils";
class LeetCodeWorkbenchProvider {
    constructor(context, baba, babaStr) {
        this.context = context;
        this.baba = baba;
        this.babaStr = babaStr;
        this.view = undefined;
        this.currentState = undefined;
        this.currentResult = undefined;
        this.currentDocumentUri = undefined;
        this.savingCases = false;
        this.aiDebugEnabledKey = "lcpr.workbench.aiDebugEnabled";
        this.aiDebugEnabled = !!this.context.workspaceState.get(this.aiDebugEnabledKey, false);
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [],
        };
        webviewView.webview.html = this.getHtml();
        webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message));
        this.refresh();
    }
    refresh() {
        this.currentState = this.readState();
        this.postState();
    }
    async refreshOfficialCases() {
        const editor = this.getActiveEditor();
        if (!editor || !this.isLeetCodeDocument(editor.document)) {
            vscode.window.showWarningMessage("请先打开一个力扣题目文件。");
            this.refresh();
            return;
        }
        const meta = (0, problemUtils_1.fileMeta)(editor.document.getText());
        if (!meta || !meta.id) {
            vscode.window.showWarningMessage("无法在当前文件中找到力扣题号。");
            this.refresh();
            return;
        }
        try {
            const descString = await this.baba
                .getProxy(this.babaStr.ChildCallProxy)
                .get_instance()
                .getDescription(meta.id, (0, ConfigUtils_1.isUseEndpointTranslation)());
            const response = JSON.parse(descString);
            const desc = response && response.code === 100 && response.msg ? response.msg.desc : undefined;
            if (!desc) {
                vscode.window.showWarningMessage("无法从题目描述中刷新官方测试用例。");
                this.refresh();
                return;
            }
            const seen = new Set();
            const officialCases = storageUtils_1.storageUtils
                .getAllCase(desc)
                .map((testCase) => this.formatOfficialCase(testCase))
                .filter((value) => {
                const key = value.replace(/\s+/g, "");
                if (!key || seen.has(key)) {
                    return false;
                }
                seen.add(key);
                return true;
            })
                .map((value, index) => ({ label: `用例 ${index + 1}`, value }));
            if (!officialCases.length) {
                vscode.window.showWarningMessage("题目描述中没有找到官方测试用例。");
                this.refresh();
                return;
            }
            await this.saveCases(officialCases);
        }
        catch (error) {
            vscode.window.showErrorMessage(`刷新官方测试用例失败：${(error === null || error === void 0 ? void 0 : error.message) || error}`);
            this.refresh();
        }
    }
    formatOfficialCase(testCase) {
        if (Array.isArray(testCase)) {
            return testCase.map((item) => `${item}\\n`).join("");
        }
        return `${testCase || ""}`;
    }
    trimVisibleCase(value) {
        return String(value || "").trim().replace(/(?:\\n|\r?\n)+$/g, "");
    }
    formatVisibleAllcase(cases) {
        return (cases || [])
            .map((testCase) => this.trimVisibleCase((testCase === null || testCase === void 0 ? void 0 : testCase.value) || ""))
            .filter((value) => value.length > 0)
            .join("\\n");
    }
    postState() {
        var _a;
        (_a = this.view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({
            type: "state",
            state: this.currentState || this.readState(),
        });
    }
    getActiveEditor() {
        const editor = vscode.window.activeTextEditor;
        if ((editor === null || editor === void 0 ? void 0 : editor.document) && editor.document.uri.scheme === "file" && this.isLeetCodeDocument(editor.document)) {
            this.currentDocumentUri = editor.document.uri.toString();
            return editor;
        }
        const visibleEditors = vscode.window.visibleTextEditors || [];
        if (this.currentDocumentUri) {
            const currentEditor = visibleEditors.find((item) => item.document && item.document.uri.toString() === this.currentDocumentUri);
            if (currentEditor) {
                return currentEditor;
            }
        }
        const leetCodeEditor = visibleEditors.find((item) => item.document && item.document.uri.scheme === "file" && this.isLeetCodeDocument(item.document));
        if (leetCodeEditor) {
            this.currentDocumentUri = leetCodeEditor.document.uri.toString();
            return leetCodeEditor;
        }
        return undefined;
    }
    getRememberedUri() {
        var _a;
        const raw = ((_a = this.currentState) === null || _a === void 0 ? void 0 : _a.uri) || this.currentDocumentUri;
        if (!raw) {
            return undefined;
        }
        try {
            return vscode.Uri.parse(raw);
        }
        catch (_) {
            return undefined;
        }
    }
    async resolveActionDocument(editor) {
        const document = editor === null || editor === void 0 ? void 0 : editor.document;
        if (document && this.isLeetCodeDocument(document)) {
            return document;
        }
        const uri = this.getRememberedUri();
        if (!uri) {
            return undefined;
        }
        try {
            const rememberedDocument = await vscode.workspace.openTextDocument(uri);
            return this.isLeetCodeDocument(rememberedDocument) ? rememberedDocument : undefined;
        }
        catch (_) {
            return undefined;
        }
    }
    isLeetCodeDocument(document) {
        return /@lc app=.* id=.* lang=.*/.test(document.getText());
    }
    getProblemTitle(text, fileName) {
        const meta = (0, problemUtils_1.fileMeta)(text);
        if (meta && meta.id) {
            try {
                const questionMap = this.baba.getProxy(this.babaStr.QuestionDataProxy).getfidMapQuestionData();
                const problem = questionMap && questionMap.get ? questionMap.get(meta.id) : undefined;
                const title = (problem && (problem.cn_name || problem.name || problem.en_name)) || "";
                if (title) {
                    return `${meta.id}. ${title}`;
                }
            }
            catch (_) {
                // Question data may still be loading; use the file name fallback.
            }
        }
        const baseName = String(fileName || "").split(/[\\/]/).pop() || "当前题目";
        return baseName.replace(/\.[^.]+$/, "").replace(/^(\d+)-/, "$1. ").replace(/-/g, " ");
    }
    readState() {
        const editor = this.getActiveEditor();
        if (!editor || !this.isLeetCodeDocument(editor.document)) {
            return {
                isLeetCodeFile: false,
                fileName: "未打开力扣题目",
                problemTitle: "未打开力扣题目",
                cases: [],
                dirty: false,
                result: this.currentResult,
                aiDebugEnabled: this.aiDebugEnabled,
            };
        }
        const text = editor.document.getText();
        const fileName = editor.document.fileName.split(/[\\/]/).pop() || editor.document.fileName;
        const cases = this.readCases(editor, text);
        return {
            isLeetCodeFile: true,
            fileName,
            problemTitle: this.getProblemTitle(text, editor.document.fileName),
            uri: editor.document.uri.toString(),
            cases,
            dirty: editor.document.isDirty,
            result: this.currentResult,
            aiDebugEnabled: this.aiDebugEnabled,
        };
    }
    readCases(editor, text) {
        const meta = (0, problemUtils_1.fileMeta)(text);
        if (!meta || !meta.id) {
            return this.parseCases(text);
        }
        const storedCases = storageUtils_1.storageUtils.readProblemCases(editor.document.fileName, meta.id);
        if (storedCases.length > 0) {
            if (text.indexOf("@lcpr case=start") >= 0) {
                this.removeCaseBlocks(editor);
            }
            return storedCases.map((value, index) => ({ id: `stored-${index}`, label: `用例 ${index + 1}`, value }));
        }
        const legacyCases = this.parseCases(text);
        if (legacyCases.length > 0) {
            const values = legacyCases.map((testCase) => testCase.value);
            storageUtils_1.storageUtils.writeProblemCases(editor.document.fileName, meta.id, values);
            this.removeCaseBlocks(editor);
            return values.map((value, index) => ({ id: `stored-${index}`, label: `用例 ${index + 1}`, value }));
        }
        return [];
    }
    parseCases(text) {
        const lines = text.split(/\r?\n/);
        const cases = [];
        let caseStartLine = -1;
        let prefix = "//";
        let parts = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.indexOf("@lcpr case=start") >= 0) {
                caseStartLine = i;
                prefix = this.detectCommentPrefix(line);
                parts = [];
                continue;
            }
            if (caseStartLine >= 0 && line.indexOf("@lcpr case=end") >= 0) {
                cases.push({
                    id: `${caseStartLine}-${i}`,
                    label: `用例 ${cases.length + 1}`,
                    value: parts.join(""),
                    startLine: caseStartLine + 1,
                    endLine: i + 1,
                    prefix,
                });
                caseStartLine = -1;
                parts = [];
                continue;
            }
            if (caseStartLine >= 0) {
                parts.push(this.stripCommentPrefix(line));
            }
        }
        return cases;
    }
    detectCommentPrefix(line) {
        const match = line.match(/^(\s*(?:\/\/|#|--))/);
        return match ? match[1].trim() : "//";
    }
    stripCommentPrefix(line) {
        let value = line.replace(/^\s*/, "");
        if (value.startsWith("//")) {
            value = value.slice(2);
        }
        else if (value.startsWith("#")) {
            value = value.slice(1);
        }
        else if (value.startsWith("--")) {
            value = value.slice(2);
        }
        return value.replace(/^\s?/, "").replace(/\s+$/g, "");
    }
    removeCaseBlocks(editor) {
        const document = editor.document;
        const text = document.getText();
        if (document.isDirty || text.indexOf("@lcpr case=start") < 0) {
            return Promise.resolve(false);
        }
        const nextText = storageUtils_1.storageUtils.removeCaseAnnotationsFromText(text);
        if (nextText === text) {
            return Promise.resolve(false);
        }
        const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
        return editor.edit((edit) => edit.replace(fullRange, nextText)).then((success) => {
            if (success) {
                return document.save().then(() => true, () => true);
            }
            return false;
        });
    }
    saveCases(cases, options = {}) {
        return new Promise((resolve) => {
            const editor = this.getActiveEditor();
            if (!editor || !this.isLeetCodeDocument(editor.document)) {
                vscode.window.showWarningMessage("请先打开一个力扣题目文件。");
                resolve(undefined);
                return;
            }
            const document = editor.document;
            const meta = (0, problemUtils_1.fileMeta)(document.getText());
            if (!meta || !meta.id) {
                vscode.window.showWarningMessage("无法在当前文件中找到力扣题号。");
                resolve(undefined);
                return;
            }
            storageUtils_1.storageUtils.writeProblemCases(document.fileName, meta.id, cases.map((testCase) => (testCase === null || testCase === void 0 ? void 0 : testCase.value) || ""));
            this.savingCases = true;
            this.removeCaseBlocks(editor).then(() => {
                this.savingCases = false;
                if (!options.silent) {
                    this.refresh();
                }
                resolve(undefined);
            }, () => {
                this.savingCases = false;
                resolve(undefined);
            });
        });
    }
    async runAction(action, testCase, options = {}) {
        const editor = this.getActiveEditor();
        const actionDocument = await this.resolveActionDocument(editor);
        const uri = (actionDocument === null || actionDocument === void 0 ? void 0 : actionDocument.uri) || this.getRememberedUri();
        const enableAiDebug = Object.prototype.hasOwnProperty.call(options, "enableAiDebug")
            ? !!options.enableAiDebug
            : !!this.aiDebugEnabled;
        if (!uri && ["submit", "test", "retest", "case", "allcase", "runCase", "debug"].indexOf(action) >= 0) {
            vscode.window.showWarningMessage("请先打开一个力扣题目文件。");
            return;
        }
        switch (action) {
            case "submit":
                this.baba.sendNotification(this.babaStr.BABACMD_submitSolution, { uri });
                break;
            case "test":
                this.baba.sendNotification(this.babaStr.BABACMD_testSolution, { uri });
                break;
            case "retest":
                this.baba.sendNotification(this.babaStr.BABACMD_reTestSolution, { uri });
                break;
            case "case":
                this.baba.sendNotification(this.babaStr.BABACMD_testCaseDef, { uri, allCase: false });
                break;
            case "allcase":
                const visibleAllcase = testCase || this.formatVisibleAllcase((this.currentState && this.currentState.cases) || []);
                if (!visibleAllcase) {
                    vscode.window.showWarningMessage("没有可运行的测试用例。");
                    break;
                }
                this.baba.sendNotification(this.babaStr.BABACMD_tesCaseArea, { uri, testCase: visibleAllcase, runMode: "allcase" });
                break;
            case "solution":
                this.baba.sendNotification(this.babaStr.BABACMD_getHelp, uri);
                break;
            case "debug":
                if (actionDocument) {
                    this.setRunningResult("debug", testCase);
                    await this.baba.sendNotificationAsync(this.babaStr.BABACMD_simpleDebug, {
                        document: actionDocument,
                        testCase,
                        enableAiDebug,
                    });
                }
                else {
                    vscode.window.showWarningMessage("请先打开一个力扣题目文件。");
                }
                break;
            case "runCase":
                this.baba.sendNotification(this.babaStr.BABACMD_tesCaseArea, { uri, testCase });
                break;
            default:
                break;
        }
    }
    setRunningResult(action, testCase) {
        if (["submit", "test", "retest", "case", "allcase", "runCase", "debug"].indexOf(action) < 0) {
            return;
        }
        this.currentResult = {
            phase: "running",
            action,
            activeTestCase: testCase,
            startedAt: Date.now(),
        };
        this.currentState = this.readState();
        this.postState();
    }
    showResult(payload) {
        const previousResult = this.currentResult || {};
        this.currentResult = Object.assign({
            phase: "complete",
            action: previousResult.action,
            activeTestCase: previousResult.activeTestCase,
            receivedAt: Date.now(),
        }, payload || {});
        this.currentState = this.readState();
        this.postState();
    }
    getResultData(payload) {
        return (payload && payload.result) || payload || {};
    }
    hasAcceptedSubmission() {
        const payload = this.currentResult;
        if (!payload || payload.phase === "running") {
            return false;
        }
        const data = this.getResultData(payload);
        const sys = data.system_message || payload.submitEvent || {};
        return sys.sub_type === "submit" && sys.accepted === true;
    }
    handleSavedDocument(document) {
        if (this.savingCases || !document || !this.isLeetCodeDocument(document)) {
            return;
        }
        if (this.currentResult) {
            this.currentResult = undefined;
        }
        this.refresh();
    }
    async handleMessage(message) {
        const editor = this.getActiveEditor();
        const document = editor && editor.document;
        switch (message === null || message === void 0 ? void 0 : message.type) {
            case "refresh":
                this.refresh();
                break;
            case "refreshOfficial":
                await this.refreshOfficialCases();
                break;
            case "saveCases":
                await this.saveCases(message.cases || [], { silent: !!message.silent });
                break;
            case "setAiDebugEnabled":
                this.aiDebugEnabled = !!message.value;
                await this.context.workspaceState.update(this.aiDebugEnabledKey, this.aiDebugEnabled);
                this.currentState = this.readState();
                this.postState();
                break;
            case "action":
                await this.runAction(message.action, message.testCase, { enableAiDebug: !!message.enableAiDebug });
                break;
            default:
                break;
        }
    }
    dispose() {
    }
    getHtml() {
        const nonce = Date.now().toString(36);
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      color-scheme: light dark;
      --row-height: 26px;
      --gap: 6px;
      --panel-pad-x: 12px;
      --lcpr-success-deep: #137333;
      --lcpr-focus-gray: #b7b7b7;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      color: var(--vscode-sideBar-foreground);
      background: var(--vscode-sideBar-background);
      font: 12px var(--vscode-font-family);
    }
    button, textarea {
      font: inherit;
    }
    .toolbar {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 4px var(--panel-pad-x);
      border-bottom: 1px solid var(--vscode-sideBar-border);
      background: var(--vscode-sideBar-background);
      z-index: 2;
    }
    .toolbar-group {
      position: relative;
      z-index: 2;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    .toolbar-run {
      gap: 4px;
    }
    .toolbar-edit {
      justify-self: end;
    }
    .toolbar-check {
      height: 24px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 0 6px;
      color: var(--vscode-button-secondaryForeground);
      white-space: nowrap;
      user-select: none;
    }
    .toolbar-check input {
      margin: 0;
      width: 14px;
      height: 14px;
      appearance: none;
      -webkit-appearance: none;
      position: relative;
      border: 1px solid var(--vscode-checkbox-border, #8a8a8a);
      border-radius: 2px;
      background: var(--vscode-checkbox-background, transparent);
      cursor: pointer;
    }
    .toolbar-check input:checked {
      border-color: var(--vscode-descriptionForeground, #767676);
      background: var(--vscode-descriptionForeground, #767676);
    }
    .toolbar-check input:checked::after {
      content: "";
      position: absolute;
      left: 4px;
      top: 1px;
      width: 4px;
      height: 8px;
      border: solid var(--vscode-sideBar-background, #ffffff);
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
    .toolbar-check input:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }
    .toolbar button, .case-actions button {
      height: 24px;
      padding: 0 7px;
      border: 1px solid transparent;
      border-radius: 3px;
      color: var(--vscode-button-secondaryForeground);
      background: transparent;
      cursor: pointer;
    }
    .toolbar button:hover:not(:disabled), .case-actions button:hover:not(:disabled) {
      background: var(--vscode-toolbar-hoverBackground);
    }
    .toolbar button:disabled, .case-actions button:disabled {
      opacity: .45;
      cursor: not-allowed;
    }
    .toolbar .primary {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    .toolbar .primary:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .toolbar .important {
      color: var(--vscode-button-secondaryForeground);
      background: transparent;
      border-color: transparent;
      font-weight: 500;
    }
    .toolbar .important:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }
    .problem-title {
      position: absolute;
      left: 50%;
      top: 50%;
      z-index: 1;
      width: min(48vw, 680px);
      min-width: 0;
      padding: 0 8px;
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    .workspace {
      display: grid;
      grid-template-columns: minmax(420px, 62%) minmax(260px, 38%);
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
    }
    .case-pane {
      min-width: 0;
      min-height: 0;
      overflow: auto;
      border-left: 1px solid var(--vscode-sideBar-border);
    }
    .result-pane {
      min-width: 0;
      min-height: 0;
      overflow: auto;
      background: var(--vscode-sideBar-background);
    }
    .result-sticky {
      min-height: 100%;
    }
    .result-header {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 4px var(--panel-pad-x);
      color: var(--vscode-sideBar-foreground);
      font-weight: 600;
    }
    .result-header .muted {
      margin-left: auto;
      color: var(--vscode-descriptionForeground);
      font-weight: 400;
    }
    #result .result-header {
      gap: 9px;
      min-height: 34px;
      padding: 7px var(--panel-pad-x) 2px;
      font-size: 14px;
      font-weight: 700;
    }
    .result-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--vscode-descriptionForeground);
    }
    #result .result-dot {
      width: 10px;
      height: 10px;
    }
    .tone-success { --tone: var(--lcpr-success-deep); }
    .tone-danger { --tone: var(--vscode-testing-iconFailed, #d1242f); }
    .tone-warning { --tone: var(--vscode-testing-iconQueued, #bf8700); }
    .tone-running { --tone: var(--vscode-progressBar-background, #0e70c0); }
    .tone-neutral { --tone: var(--vscode-descriptionForeground); }
    .tone-success .result-dot,
    .tone-danger .result-dot,
    .tone-warning .result-dot,
    .tone-running .result-dot,
    .tone-neutral .result-dot {
      background: var(--tone);
    }
    .tone-running .result-dot {
      animation: resultPulse 1s ease-in-out infinite;
    }
    .result-body {
      padding: 8px var(--panel-pad-x) 12px;
    }
    #result .result-header + .result-body {
      padding-top: 3px;
    }
    .result-waiting {
      color: var(--vscode-sideBar-foreground);
      font-size: 13px;
      line-height: 1.45;
    }
    .result-status {
      margin: 0;
      color: var(--tone, var(--vscode-sideBar-foreground));
      font-size: 24px;
      line-height: 1.2;
      font-weight: 800;
      letter-spacing: 0;
      word-break: break-word;
    }
    .result-summary-card {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-rows: auto auto;
      align-items: center;
      column-gap: 12px;
      row-gap: 2px;
      width: 100%;
      min-width: 0;
      margin: 0 0 8px;
      padding: 9px 12px 10px;
      border: 1px solid color-mix(in srgb, var(--vscode-sideBar-border) 58%, transparent);
      border-radius: 4px;
      background: var(--vscode-input-background);
    }
    .result-summary-case {
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--vscode-sideBar-foreground);
      font-family: var(--vscode-editor-font-family);
      font-size: 13px;
      font-weight: 700;
      line-height: 1.2;
      text-align: right;
      white-space: nowrap;
    }
    .result-summary-meta,
    .result-summary-time {
      min-width: 0;
      color: var(--vscode-descriptionForeground);
      overflow: hidden;
      text-overflow: ellipsis;
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
      white-space: nowrap;
    }
    .result-summary-meta {
      text-align: left;
      max-width: 100%;
    }
    .result-summary-time {
      text-align: right;
    }
    .result-lines {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 14px;
      margin: 0 0 8px;
      padding: 0;
      list-style: none;
    }
    .result-lines li {
      position: relative;
      padding-left: 14px;
      color: var(--vscode-sideBar-foreground);
      line-height: 1.45;
    }
    .result-lines li::before {
      content: "";
      position: absolute;
      left: 2px;
      top: .6em;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--tone, var(--vscode-descriptionForeground));
    }
    .performance-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
      margin: 0 0 8px;
    }
    .performance-card {
      min-width: 0;
      padding: 7px 8px;
      border: 1px solid var(--vscode-sideBar-border);
      border-radius: 4px;
      background: var(--vscode-input-background);
      animation: performanceCardIn .34s cubic-bezier(.2, .8, .2, 1) both;
      animation-delay: var(--card-delay, 0ms);
    }
    .performance-head {
      display: flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
      margin-bottom: 4px;
    }
    .performance-title {
      flex: 1 1 auto;
      min-width: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .performance-value {
      flex: 0 0 auto;
      color: var(--vscode-sideBar-foreground);
      font-family: var(--vscode-editor-font-family);
      font-weight: 700;
      white-space: nowrap;
    }
        .performance-subtitle {
          margin-top: 3px;
          color: var(--lcpr-success-deep);
          font-size: 11px;
          font-weight: 600;
          opacity: 0;
          transform: translateY(3px);
          animation: performanceSubtitleIn .28s cubic-bezier(.2, .8, .2, 1) both;
          animation-delay: var(--result-delay, 1s);
        }
    .performance-hist {
      display: grid;
      gap: 4px;
    }
    .performance-bars {
      position: relative;
      display: grid;
      align-items: end;
      gap: 2px;
      height: 38px;
      padding-top: 3px;
      border-bottom: 1px solid var(--vscode-sideBar-border);
    }
        .performance-bars::after {
          content: "";
          position: absolute;
          right: 0;
      bottom: -1px;
      left: 0;
      height: 1px;
          background: linear-gradient(90deg, transparent, var(--tone, var(--lcpr-success-deep)), transparent);
          opacity: .55;
          transform-origin: left;
          animation: chartBaselineSweep var(--chart-duration, 1200ms) cubic-bezier(.2, .8, .2, 1) both;
        }
    .performance-bar {
      position: relative;
      align-self: end;
      --bar-translate: 0;
      width: 4px;
      min-height: 2px;
          border-radius: 2px 2px 0 0;
          background: rgba(128, 128, 128, .42);
          opacity: 0;
          transform-origin: bottom;
          transform: translateX(var(--bar-translate)) scaleY(0);
          animation: chartBarGrow .24s cubic-bezier(.2, .8, .2, 1) both;
      animation-delay: var(--bar-delay, 0ms);
        }
    .performance-bars.positioned {
      display: block;
    }
    .performance-bars.positioned .performance-bar {
      position: absolute;
      bottom: 0;
      left: var(--bar-left, 50%);
      --bar-translate: -50%;
    }
    .performance-bar-before {
      background: rgba(19, 115, 51, .28);
    }
    .performance-bar-active {
      background: var(--lcpr-success-deep);
    }
    .performance-bar-active::after {
      content: "";
      position: absolute;
      left: 50%;
      top: -5px;
      bottom: -3px;
      width: 1px;
      background: var(--lcpr-success-deep);
      opacity: 0;
      transform: translateX(-50%) scaleY(.35);
      transform-origin: bottom;
      animation: chartMarkerDrop .34s cubic-bezier(.2, .8, .2, 1) both;
      animation-delay: var(--marker-delay, .52s);
    }
    .performance-axis {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      color: var(--vscode-descriptionForeground);
      font-size: 9px;
      font-family: var(--vscode-editor-font-family);
    }
    .performance-note {
      display: none;
      margin-top: 5px;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
    }
    .performance-strip {
      position: relative;
      height: 10px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-sideBar-border);
    }
    .performance-strip-fill {
      display: block;
      height: 100%;
      background: rgba(19, 115, 51, .38);
      transform-origin: left;
      animation: chartStripGrow .5s cubic-bezier(.2, .8, .2, 1) both;
    }
    .performance-strip-marker {
      position: absolute;
      top: -3px;
      bottom: -3px;
      width: 2px;
      background: var(--lcpr-success-deep);
      opacity: 0;
      transform: translateX(-1px) scaleY(.35);
      transform-origin: bottom;
      animation: chartMarkerDrop .34s cubic-bezier(.2, .8, .2, 1) .38s both;
    }
    .performance-empty {
      padding: 7px 0 1px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    .result-diagnostics-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      align-items: stretch;
    }
    .result-diagnostics-grid.has-comparison {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
    .result-section {
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
    .result-section-wide {
      grid-column: 1 / -1;
    }
    .result-section-title {
      margin: 0 0 5px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      font-weight: 600;
    }
    .result-pre {
      flex: 1;
      min-height: 0;
      max-height: 160px;
      margin: 0;
      overflow: auto;
      padding: 8px 10px;
      color: var(--vscode-editor-foreground);
      background: color-mix(in srgb, var(--vscode-textCodeBlock-background, var(--vscode-editor-background)) 82%, transparent);
      border: 0;
      border-radius: 4px;
      font: 11px/1.45 var(--vscode-editor-font-family);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .visualize {
      border-top: 1px solid var(--vscode-sideBar-border);
    }
    .visualize:empty {
      display: none;
    }
    .visualize-body {
      padding: 9px var(--panel-pad-x) 12px;
    }
    .visualize-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 8px;
    }
    .visualize-actions button, .visualize-debug-actions button {
      height: 24px;
      padding: 0 7px;
      border: 1px solid transparent;
      border-radius: 3px;
      color: var(--vscode-button-secondaryForeground);
      background: transparent;
      cursor: pointer;
    }
    .visualize-actions button:hover:not(:disabled), .visualize-debug-actions button:hover:not(:disabled) {
      background: var(--vscode-toolbar-hoverBackground);
    }
    .visualize-actions .primary {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    .visualize-actions .primary:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }
    .visualize-actions button:disabled {
      opacity: .45;
      cursor: default;
    }
    .visualize-meta {
      margin-bottom: 7px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }
    .visualize-step {
      padding: 8px 9px;
      border: 1px solid var(--vscode-sideBar-border);
      border-radius: 4px;
      background: var(--vscode-input-background);
    }
    .visualize-title {
      margin: 0 0 5px;
      color: var(--vscode-sideBar-foreground);
      font-size: 13px;
      line-height: 1.35;
      font-weight: 600;
    }
    .visualize-text {
      margin: 0;
      color: var(--vscode-sideBar-foreground);
      line-height: 1.45;
      word-break: break-word;
    }
    .visualize-vars {
      display: grid;
      gap: 4px;
      margin-top: 8px;
    }
    .visualize-var {
      display: grid;
      grid-template-columns: minmax(70px, 35%) minmax(0, 1fr);
      gap: 6px;
      min-width: 0;
      color: var(--vscode-sideBar-foreground);
      font-family: var(--vscode-editor-font-family);
      font-size: 11px;
    }
    .visualize-var span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .visualize-var strong {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
      white-space: nowrap;
    }
    .visualize-json {
      min-height: 58px;
      max-height: 150px;
      margin-top: 6px;
      resize: vertical;
    }
    .visualize-error {
      margin: 7px 0 0;
      color: var(--vscode-errorForeground);
      line-height: 1.4;
      word-break: break-word;
    }
    .visualize-scene {
      display: grid;
      gap: 10px;
      margin-bottom: 9px;
    }
    .scene-string {
      overflow-x: auto;
      padding: 4px 0 8px;
    }
    .scene-track {
      display: inline-grid;
      grid-auto-flow: column;
      grid-auto-columns: 34px;
      gap: 4px;
      align-items: end;
      min-width: 100%;
    }
    .scene-cell-wrap {
      display: grid;
      grid-template-rows: 16px 34px 18px;
      gap: 3px;
      justify-items: center;
      min-width: 34px;
    }
    .scene-pointer {
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      line-height: 16px;
      white-space: nowrap;
    }
    .scene-pointer-active {
      color: var(--vscode-button-background);
      font-weight: 700;
    }
    .scene-cell {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border: 1px solid var(--vscode-sideBar-border);
      border-radius: 4px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font: 13px var(--vscode-editor-font-family);
    }
    .scene-cell-window {
      background: rgba(14, 112, 192, .18);
      border-color: rgba(14, 112, 192, .6);
    }
    .scene-cell-best {
      box-shadow: inset 0 -3px 0 var(--lcpr-success-deep);
    }
    .scene-cell-active {
      outline: 2px solid var(--vscode-button-background);
      outline-offset: 1px;
    }
    .scene-index {
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
      line-height: 14px;
    }
    .scene-map {
      border: 1px solid var(--vscode-sideBar-border);
      border-radius: 4px;
      overflow: hidden;
      background: var(--vscode-input-background);
    }
    .scene-map-title {
      padding: 5px 7px;
      color: var(--vscode-descriptionForeground);
      border-bottom: 1px solid var(--vscode-sideBar-border);
      font-size: 11px;
      font-weight: 600;
    }
    .scene-map-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(70px, 1fr));
      gap: 1px;
      background: var(--vscode-sideBar-border);
    }
    .scene-map-item {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      min-width: 0;
      padding: 5px 7px;
      color: var(--vscode-sideBar-foreground);
      background: var(--vscode-input-background);
      font: 11px var(--vscode-editor-font-family);
    }
    .scene-map-item strong,
    .scene-map-item span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .visualize-debug {
      margin-top: 8px;
      color: var(--vscode-descriptionForeground);
    }
    .visualize-debug summary {
      cursor: pointer;
      user-select: none;
    }
    .visualize-debug-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 7px;
    }
    .result-diagnostics-grid.equalized .result-pre {
      height: var(--result-pre-height, auto);
      max-height: var(--result-pre-height, 160px);
    }
    @media (max-width: 980px) {
      .result-diagnostics-grid {
        grid-template-columns: 1fr;
      }
      .result-diagnostics-grid.has-comparison {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      }
      .performance-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .result-diagnostics-grid.equalized .result-pre {
        height: auto;
        max-height: 180px;
      }
    }
    @media (max-width: 680px) {
      .performance-grid {
        grid-template-columns: 1fr;
      }
    }
    .empty {
      padding: 18px 12px;
      color: var(--vscode-descriptionForeground);
    }
    .result-pane .empty {
      padding: 6px var(--panel-pad-x) 14px;
      font-size: 13px;
      line-height: 1.45;
    }
    .list {
      padding: 8px 18px 10px;
    }
    .case {
      position: relative;
      margin-bottom: 6px;
      padding: 0 7px 5px 18px;
      border: 0;
      border-radius: 4px;
      background: var(--vscode-input-background);
      overflow: hidden;
    }
    .case::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 5px;
      border-radius: 0;
      background: var(--vscode-descriptionForeground);
      opacity: .72;
    }
    .case.case-pass {
      box-shadow: none;
    }
    .case.case-pass::before {
      background: var(--lcpr-success-deep);
      opacity: 1;
    }
    .case.case-fail {
      box-shadow: none;
    }
    .case.case-fail::before {
      background: var(--vscode-testing-iconFailed, #d1242f);
      opacity: 1;
    }
    .case-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      column-gap: 8px;
      min-height: 24px;
      padding: 2px 0 1px;
    }
    .case-title {
      min-width: 0;
      color: var(--vscode-sideBar-foreground);
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .case-actions {
      display: flex;
      gap: 4px;
      opacity: 1;
      justify-self: end;
    }
    .case-actions button {
      display: inline-grid;
      place-items: center;
      width: 20px;
      height: 20px;
      padding: 0;
      border: 0;
      border-radius: 4px;
      color: var(--vscode-descriptionForeground);
      background: transparent;
      line-height: 1;
    }
    .case-actions button:hover {
      color: var(--vscode-foreground);
      background: var(--vscode-toolbar-hoverBackground);
    }
    .case-actions button:active {
      color: var(--vscode-foreground);
      background: var(--vscode-toolbar-activeBackground, var(--vscode-toolbar-hoverBackground));
    }
    .case-actions svg {
      width: 14px;
      height: 14px;
      display: block;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .case-editor {
      padding: 0;
    }
    .case-add-row {
      display: flex;
      justify-content: center;
      padding: 8px 0 4px;
    }
    .case-add-button {
      display: inline-grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border: 1px solid var(--vscode-input-border, var(--vscode-sideBar-border));
      border-radius: 50%;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-input-background);
      cursor: pointer;
    }
    .case-add-button:hover {
      color: var(--vscode-foreground);
      background: var(--vscode-toolbar-hoverBackground);
    }
    .case-add-button svg {
      width: 16px;
      height: 16px;
      display: block;
      fill: none;
      stroke: currentColor;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    textarea {
      width: 100%;
      height: 30px;
      min-height: 30px;
      max-height: 180px;
      resize: none;
      overflow: hidden;
      padding: 4px 8px;
      color: var(--vscode-input-foreground);
      background: color-mix(in srgb, var(--vscode-sideBar-background) 94%, var(--vscode-input-foreground) 6%);
      border: 0;
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
      line-height: 20px;
      outline: none;
    }
    textarea:focus {
      box-shadow: inset 0 0 0 1px var(--lcpr-focus-gray);
    }
    .dirty {
      color: var(--vscode-gitDecoration-modifiedResourceForeground);
    }
    @keyframes resultPulse {
      0%, 100% { opacity: .45; transform: scale(.88); }
      50% { opacity: 1; transform: scale(1.12); }
    }
        @keyframes performanceCardIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes performanceSubtitleIn {
          from { opacity: 0; transform: translateY(3px); }
          to { opacity: 1; transform: translateY(0); }
        }
            @keyframes chartBarGrow {
              from { opacity: 0; transform: translateX(var(--bar-translate)) scaleY(0); }
              to { opacity: 1; transform: translateX(var(--bar-translate)) scaleY(1); }
            }
    @keyframes chartMarkerDrop {
      from { opacity: 0; transform: translateX(-50%) scaleY(.35); }
      to { opacity: 1; transform: translateX(-50%) scaleY(1); }
    }
    @keyframes chartStripGrow {
      from { opacity: .5; transform: scaleX(.04); }
      to { opacity: 1; transform: scaleX(1); }
    }
    @keyframes chartBaselineSweep {
      from { opacity: 0; transform: scaleX(.08); }
      45% { opacity: .65; }
      to { opacity: 0; transform: scaleX(1); }
    }
    @media (prefers-reduced-motion: reduce) {
          .tone-running .result-dot,
          .performance-card,
          .performance-subtitle,
          .performance-bar,
          .performance-bar-active::after,
          .performance-bars::after,
      .performance-strip-fill,
      .performance-strip-marker {
        animation: none !important;
        opacity: 1 !important;
        transform: none !important;
      }
    }
    @media (max-width: 720px) {
      .toolbar {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .problem-title {
        width: min(58vw, 420px);
        padding: 0 8px;
        text-align: center;
      }
      .toolbar-edit {
        grid-column: 2;
        justify-self: end;
      }
      .workspace {
        display: block;
        overflow: auto;
      }
      .result-pane {
        overflow: visible;
        border-top: 1px solid var(--vscode-sideBar-border);
      }
      .case-pane {
        overflow: visible;
        border-left: 0;
      }
      .result-sticky {
        min-height: 0;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="toolbar-group toolbar-run">
      <button data-action="submit" class="primary">提交</button>
      <button data-action="allcase" class="important">全部用例</button>
    </div>
    <div id="file" class="problem-title">未打开力扣题目</div>
    <div class="toolbar-group toolbar-edit">
      <label class="toolbar-check"><input id="aiDebugToggle" type="checkbox">开启 AI 调试</label>
      <button id="refresh">恢复默认用例</button>
    </div>
  </div>
  <div class="workspace">
    <aside id="resultPane" class="result-pane">
      <div class="result-sticky">
        <div id="result"></div>
      </div>
    </aside>
    <section class="case-pane">
      <div id="content"></div>
    </section>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let state = { isLeetCodeFile: false, cases: [] };
    const content = document.getElementById('content');
    const file = document.getElementById('file');
    const resultEl = document.getElementById('result');
    const aiDebugToggle = document.getElementById('aiDebugToggle');
    const send = (message) => vscode.postMessage(message);
    function escapeHtml(value) {
      return String(value || '').replace(/[&<>"']/g, (ch) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[ch]));
    }
    function asLines(value) {
      if (value === undefined || value === null) return [];
      return (Array.isArray(value) ? value : [value]).map((line) => String(line)).filter((line) => line.length > 0);
    }
    function cleanLine(value) {
      return String(value || '')
        .replace(/^耗时\\s*/, 'Elapsed ')
        .replace(/\\s+%%/g, '%')
        .trim();
    }
    function getResultData(payload) {
      return (payload && payload.result) || payload || {};
    }
    function getStatus(payload) {
      if (!payload) return '';
      if (payload.phase === 'running') return '运行中';
      const verdict = caseVerdict(payload);
      if (verdict) return verdict;
      const data = getResultData(payload);
      const sys = data.system_message || payload.submitEvent || {};
      const statusCode = Number(data.statusCode || data.status_code || sys.statusCode || sys.status_code || 0);
      const msg = asLines(data.msg || data.message || data.error || data.messages).join(' ').toLowerCase();
      if (statusCode >= 400 || /http error|too many requests|rate limit|429/.test(msg)) return '请求失败';
      return (data.messages && data.messages[0]) || sys.status || (sys.accepted ? 'Accepted' : '结果');
    }
    function zhStatus(status) {
      const text = String(status || '');
      const lower = text.toLowerCase();
      if (lower === 'accepted') return '通过';
      if (lower === 'wrong answer') return '答案错误';
      if (lower === 'runtime error') return '运行时错误';
      if (lower === 'compile error') return '编译错误';
      if (lower === 'time limit exceeded') return '超出时间限制';
      if (lower === 'memory limit exceeded') return '超出内存限制';
      if (lower === 'output limit exceeded') return '超出输出限制';
      if (lower === 'finished') return '完成';
      if (lower === 'correct') return '正确';
      if (lower === 'running') return '运行中';
      return text;
    }
    function getMode(payload) {
      const data = getResultData(payload);
      const sys = data.system_message || payload.submitEvent || {};
      const runMode = payload && payload.runMode;
      if (runMode === 'submit') return '提交';
      if (runMode === 'allcase') return '全部用例';
      if (runMode === 'case') return '用例';
      if (runMode === 'debug') return '调试';
      if (runMode === 'retest') return '重测';
      if (runMode === 'test') return '测试';
      const action = payload && payload.action;
      if (sys.sub_type === 'submit' || action === 'submit') return '提交';
      if (action === 'allcase') return '全部用例';
      if (action === 'case' || action === 'runCase') return '用例';
      if (action === 'debug') return '调试';
      if (action === 'retest') return '重测';
      return '测试';
    }
    function getTone(payload) {
      if (!payload) return 'tone-neutral';
      if (payload.phase === 'running') return 'tone-running';
      const data = getResultData(payload);
      const sys = data.system_message || payload.submitEvent || {};
      const status = getStatus(payload).toLowerCase();
      if (sys.accepted || /^(accepted|finished|correct)$/.test(status)) return 'tone-success';
      if (/time limit|memory limit|output limit|exceeded/.test(status)) return 'tone-warning';
      if (/wrong|runtime|compile|error|failed|exception/.test(status)) return 'tone-danger';
      return 'tone-neutral';
    }
    function hasAcceptedSubmission() {
      return isAcceptedSubmit(state.result);
    }
    function isAcceptedSubmit(payload) {
      if (!payload || payload.phase === 'running') return false;
      const data = getResultData(payload);
      const sys = data.system_message || payload.submitEvent || {};
      return sys.sub_type === 'submit' && sys.accepted === true;
    }
    function extractCasesText(data) {
      return asLines(data.messages).find((line) => /cases passed/i.test(line)) || '';
    }
    function extractRuntimeFromOutputKey(data) {
      const key = Object.keys(data || {}).find((item) => /^Output\\s*\\(/i.test(item));
      const match = key && key.match(/\\(([^)]+)\\)/);
      return match ? match[1] : '';
    }
    function elapsedMetricValue(data) {
      return asLines(data && data.costTime)
        .map(cleanLine)
        .map((line) => line.replace(/^Elapsed\\s*/i, '').replace(/^耗时\\s*/, '').trim())
        .find(Boolean) || '';
    }
    function resultSummary(payload) {
      const data = getResultData(payload);
      const sys = data.system_message || payload.submitEvent || {};
      const total = Number(sys.total || 0);
      const cases = total > 0 ? ((sys.passed || 0) + '/' + total) : extractCasesText(data).replace(/\\s*cases passed.*$/i, '');
      const elapsed = elapsedMetricValue(data);
      const lang = String(sys.lang || '').trim();
      const mode = getMode(payload);
      const input = sectionValue(data, ['Your Input', 'Input', 'Testcase', 'Last Testcase']);
      const runtime = sys.runtime || extractRuntimeFromOutputKey(data) || '';
      const inputText = String(input || '').replace(/\\r?\\n/g, ' / ').trim();
      const subLeft = inputText ? '输入 ' + inputText : (lang || mode || '结果');
      const subRight = [elapsed, runtime].find((value) => value && !/^0\\s*ms$/i.test(String(value).trim())) || '';
      const topRight = cases || '';
      return '<div class="result-summary-card">' +
        '<h2 class="result-status">' + escapeHtml(zhStatus(getStatus(payload))) + '</h2>' +
        '<div class="result-summary-case">' + escapeHtml(topRight) + '</div>' +
        '<div class="result-summary-meta">' + escapeHtml(subLeft) + '</div>' +
        '<div class="result-summary-time">' + escapeHtml(subRight) + '</div>' +
      '</div>';
    }
    function firstNumber(value) {
      if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
      const match = String(value || '').match(/-?\\d+(?:\\.\\d+)?/);
      if (!match) return undefined;
      const number = Number(match[0]);
      return Number.isFinite(number) ? number : undefined;
    }
    function parseRuntimeMs(value) {
      const number = firstNumber(value);
      if (number === undefined) return undefined;
      const text = String(value || '').toLowerCase();
      return /\\bs\\b/.test(text) && !/ms\\b/.test(text) ? number * 1000 : number;
    }
    function parseMemoryKb(value) {
      const number = firstNumber(value);
      if (number === undefined) return undefined;
      const text = String(value || '').toLowerCase();
      if (/\\bgb\\b/.test(text)) return number * 1024 * 1024;
      if (/\\bmb\\b/.test(text)) return number * 1024;
      return number;
    }
    function parseDistributionSource(raw) {
      if (!raw) return [];
      let value = raw;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value);
        } catch (_) {
          return [];
        }
      }
      if (Array.isArray(value)) return value;
      if (value && Array.isArray(value.distribution)) return value.distribution;
      if (value && typeof value === 'object') {
        return Object.keys(value).map((key) => [key, value[key]]);
      }
      return [];
    }
    function ownValue(item, names) {
      for (const name of names) {
        if (Object.prototype.hasOwnProperty.call(item, name) && item[name] !== undefined && item[name] !== null) {
          return item[name];
        }
      }
      return undefined;
    }
    function normalizeDistribution(raw, valueParser) {
      const parseValue = valueParser || firstNumber;
      return parseDistributionSource(raw).map((item) => {
        let value;
        let weight;
        if (Array.isArray(item)) {
          value = parseValue(item[0]);
          weight = firstNumber(item[1]);
        } else if (item && typeof item === 'object') {
          value = parseValue(ownValue(item, ['displayed_value', 'displayedValue', 'value', 'runtime', 'memory', 'x', 0]));
          weight = firstNumber(ownValue(item, ['percent', 'percentage', 'weight', 'count', 'y', 1]));
        }
        if (value === undefined || weight === undefined) return undefined;
        return { value, weight };
      }).filter((item) => item && Number.isFinite(item.value) && Number.isFinite(item.weight))
        .sort((a, b) => a.value - b.value);
    }
    function clampPercent(value) {
      const number = firstNumber(value);
      if (number === undefined) return undefined;
      return Math.max(0, Math.min(100, number));
    }
    function formatPercentValue(value) {
      const number = clampPercent(value);
      if (number === undefined) return '';
      return number.toFixed(2).replace(/\\.00$/, '').replace(/(\\.\\d)0$/, '$1');
    }
    function formatCompactNumber(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return '';
      if (Math.abs(number) >= 100) return String(Math.round(number));
      if (Math.abs(number) >= 10) return number.toFixed(1).replace(/\\.0$/, '');
      return number.toFixed(2).replace(/\\.00$/, '').replace(/(\\.\\d)0$/, '$1');
    }
    function formatBucketValue(value, unit) {
      if (unit === 'KB' && Number(value) >= 1024) {
        return formatCompactNumber(Number(value) / 1024) + ' MB';
      }
      return formatCompactNumber(value) + (unit ? ' ' + unit : '');
    }
    function nearestBucket(points, value) {
      if (!points.length || !Number.isFinite(Number(value))) return -1;
      let bestIndex = 0;
      let bestDistance = Infinity;
      points.forEach((point, index) => {
        const distance = Math.abs(Number(point.value) - Number(value));
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      return bestIndex;
    }
    function compactDistribution(points, maxBars) {
      if (points.length <= maxBars) return points;
      const groupSize = Math.ceil(points.length / maxBars);
      const groups = [];
      for (let i = 0; i < points.length; i += groupSize) {
        const group = points.slice(i, i + groupSize);
        const weight = group.reduce((sum, point) => sum + Number(point.weight || 0), 0);
        const weightedValue = group.reduce((sum, point) => sum + Number(point.value || 0) * Number(point.weight || 0), 0);
        groups.push({
          value: weight ? weightedValue / weight : Number(group[0].value || 0),
          weight,
        });
      }
      return groups;
    }
    function localDistributionWindow(points, activeIndex, radius) {
      if (!points.length || activeIndex < 0) return [];
      const start = Math.max(0, activeIndex - radius);
      const end = Math.min(points.length, activeIndex + radius + 1);
      return points.slice(start, end).map((point, offset) => ({
        value: point.value,
        weight: point.weight,
        sourceIndex: start + offset,
      }));
    }
    function metricHasData(metric) {
      return !!(metric && (metric.display || (metric.percentile !== undefined && metric.percentile !== null && String(metric.percentile).trim() !== '') || normalizeDistribution(metric.distribution).length));
    }
    function performanceMetric(charts, key, sys) {
      const raw = (charts && charts[key]) || {};
      const isRuntime = key === 'runtime';
      const display = raw.display || (isRuntime ? sys.runtime : sys.memory) || '';
      let value = Number(raw.value);
      if (!Number.isFinite(value)) {
        value = isRuntime ? parseRuntimeMs(display) : parseMemoryKb(display);
      }
      return {
        key,
        title: isRuntime ? '运行时间分布' : '内存占用分布',
        display,
        value,
        unit: raw.unit || (isRuntime ? 'ms' : 'KB'),
        percentile: raw.percentile !== undefined && raw.percentile !== null ? raw.percentile : (isRuntime ? sys.runtime_percentile : sys.memory_percentile),
        distribution: raw.distribution || [],
      };
    }
        function renderDistributionChart(metric, points) {
          const source = points.slice().reverse();
          const activeIndex = nearestBucket(source, metric.value);
          const percent = clampPercent(metric.percentile);
          if (activeIndex < 0 || percent === undefined) {
            const compact = compactDistribution(source, 24);
            const maxWeight = Math.max(...compact.map((point) => Number(point.weight || 0)), 1);
            const fallbackActive = nearestBucket(compact, metric.value);
            const bars = compact.map((point, index) => {
              const height = Math.max(4, Math.round((Number(point.weight || 0) / maxWeight) * 100));
              const active = fallbackActive >= 0 && index === fallbackActive;
              const before = fallbackActive >= 0 && index < fallbackActive;
              const cls = 'performance-bar' + (before ? ' performance-bar-before' : '') + (active ? ' performance-bar-active' : '');
              const delay = 70 + index * 22;
              const markerDelay = delay + 220;
              const title = formatBucketValue(point.value, metric.unit) + ' / ' + formatCompactNumber(point.weight);
              return '<span class="' + cls + '" style="height:' + height + '%; --bar-delay:' + delay + 'ms; --marker-delay:' + markerDelay + 'ms;" title="' + escapeHtml(title) + '"></span>';
            }).join('');
            const left = compact.length ? formatBucketValue(compact[0].value, metric.unit) : '';
            const right = compact.length ? formatBucketValue(compact[compact.length - 1].value, metric.unit) : '';
            return '<div class="performance-hist"><div class="performance-bars" style="grid-template-columns: repeat(' + compact.length + ', minmax(2px, 1fr)); --chart-duration:' + (720 + compact.length * 22) + 'ms;">' + bars + '</div><div class="performance-axis"><span>' + escapeHtml(left) + '</span><span>' + escapeHtml(right) + '</span></div></div>';
          }
          const local = localDistributionWindow(source, activeIndex, 9);
          const maxWeight = Math.max(...local.map((point) => Number(point.weight || 0)), 1);
          const activeLocalIndex = local.findIndex((point) => point.sourceIndex === activeIndex);
          const step = local.length > 1 ? Math.min(7.5, Math.max(4.4, 72 / Math.max(local.length - 1, 1))) : 0;
          const bars = local.map((point, index) => {
            const height = Math.max(4, Math.round((Number(point.weight || 0) / maxWeight) * 100));
            const left = Math.max(1, Math.min(99, percent + (index - activeLocalIndex) * step));
            const active = index === activeLocalIndex;
            const before = left < percent;
            const cls = 'performance-bar' + (before ? ' performance-bar-before' : '') + (active ? ' performance-bar-active' : '');
            const delay = 70 + index * 24;
            const markerDelay = delay + 220;
            const title = formatBucketValue(point.value, metric.unit) + ' / ' + formatCompactNumber(point.weight);
            return '<span class="' + cls + '" style="left:' + left.toFixed(2) + '%; --bar-left:' + left.toFixed(2) + '%; height:' + height + '%; --bar-delay:' + delay + 'ms; --marker-delay:' + markerDelay + 'ms;" title="' + escapeHtml(title) + '"></span>';
          }).join('');
          return '<div class="performance-hist"><div class="performance-bars positioned" style="--chart-duration:' + (780 + local.length * 24) + 'ms;">' + bars + '</div><div class="performance-axis"><span>0%</span><span>100%</span></div></div>';
        }
    function renderPercentileStrip(metric) {
      const percent = clampPercent(metric.percentile);
      if (percent === undefined) {
        return '<div class="performance-empty">暂无官方性能数据</div>';
      }
      return '<div class="performance-strip"><span class="performance-strip-fill" style="width:' + percent + '%"></span><span class="performance-strip-marker" style="left:' + percent + '%"></span></div><div class="performance-axis"><span>0%</span><span>100%</span></div>';
    }
    function renderPerformanceCard(metric, index) {
      const parser = metric.key === 'memory' ? parseMemoryKb : parseRuntimeMs;
      const points = normalizeDistribution(metric.distribution, parser);
          const hasDistribution = points.length > 1;
          const percent = formatPercentValue(metric.percentile);
          const value = metric.display || (Number.isFinite(Number(metric.value)) ? formatBucketValue(metric.value, metric.unit) : '--');
          const body = hasDistribution ? renderDistributionChart(metric, points) : renderPercentileStrip(metric);
          const note = hasDistribution ? '官方提交分布' : '官方分布暂不可用';
          const barCount = hasDistribution ? Math.min(points.length, 19) : 1;
              const resultDelay = hasDistribution ? (320 + barCount * 24) : 520;
          const subtitle = percent ? '击败了 ' + percent + '% 用户' : '暂无击败率';
          return '<section class="performance-card" style="--card-delay:' + ((index || 0) * 70) + 'ms; --result-delay:' + resultDelay + 'ms;"><div class="performance-head"><span class="performance-title">' + escapeHtml(metric.title) + '</span><span class="performance-value">' + escapeHtml(value) + '</span></div>' + body + '<div class="performance-subtitle">' + escapeHtml(subtitle) + '</div><div class="performance-note">' + escapeHtml(note) + '</div></section>';
        }
    function renderPerformanceCharts(payload) {
      const data = getResultData(payload);
      const sys = data.system_message || payload.submitEvent || {};
      if (sys.sub_type !== 'submit' || sys.accepted !== true) return '';
      const charts = sys.performance_charts || {};
      const metrics = [
        performanceMetric(charts, 'runtime', sys),
        performanceMetric(charts, 'memory', sys),
      ].filter(metricHasData);
      if (!metrics.length) return '';
      return '<div class="performance-grid">' + metrics.map(renderPerformanceCard).join('') + '</div>';
    }
    function statusHint(status) {
      const text = String(status || '').toLowerCase();
      if (/wrong answer/.test(text)) return '请查看下面的失败用例、输出和期望结果。';
      if (/time limit/.test(text)) return '代码超出了力扣时间限制。';
      if (/memory limit/.test(text)) return '代码超出了内存限制。';
      if (/output limit/.test(text)) return '输出超过了允许大小。';
      if (/runtime error/.test(text)) return '代码运行时崩溃。';
      if (/compile error/.test(text)) return '代码没有通过编译。';
      if (/error|exception|failed/.test(text)) return '力扣返回了错误状态。';
      return '';
    }
    function summaryLines(payload) {
      if (isAcceptedSubmit(payload)) return '';
      const data = getResultData(payload);
      const status = getStatus(payload);
      const lines = asLines(data.messages).slice(1).map(cleanLine).filter(Boolean);
      if (data.costTime) {
        lines.push(...asLines(data.costTime).map(cleanLine).filter(Boolean));
      }
      if (!lines.length) {
        const hint = statusHint(status);
        if (hint) lines.push(hint);
      }
      return lines.length ? '<ul class="result-lines">' + lines.map((line) => '<li>' + escapeHtml(line) + '</li>').join('') + '</ul>' : '';
    }
    function sectionLabel(key) {
      const base = key.replace(/\\s*\\([^)]*\\)\\s*$/, '');
      const labels = {
        'Testcase': '失败用例',
        'Last Testcase': '失败用例',
        'Your Input': '输入',
        'Input': '输入',
        'Answer': '输出',
        'Output': '输出',
        'Expected Answer': '期望',
        'Expected Output': '期望',
        'Expected': '期望',
        'Compile Error': '编译错误',
        'Full Compile Error': '编译错误',
        'Runtime Error': '运行时错误',
        'Error': '错误',
      };
      return labels[base] || key;
    }
    function sectionPriority(key) {
      const base = key.replace(/\\s*\\([^)]*\\)\\s*$/, '');
      const order = ['Error', 'Compile Error', 'Full Compile Error', 'Runtime Error', 'Testcase', 'Last Testcase', 'Your Input', 'Input', 'Answer', 'Output', 'Expected Answer', 'Expected Output'];
      const index = order.indexOf(base);
      return index < 0 ? 99 : index;
    }
    function sectionBase(key) {
      return key.replace(/\\s*\\([^)]*\\)\\s*$/, '');
    }
    function isInputKey(key) {
      return /^(Your Input|Input|Testcase|Last Testcase)$/i.test(sectionBase(key));
    }
    function isOutputKey(key) {
      return /^(Answer|Output)$/i.test(sectionBase(key));
    }
    function isExpectedKey(key) {
      return /^(Expected Answer|Expected Output|Expected)$/i.test(sectionBase(key));
    }
    function diagnostics(payload) {
      const data = getResultData(payload);
      const ignored = new Set(['messages', 'system_message', 'costTime', 'Stdout', 'Std Out', 'stdout', 'msg', 'message', 'error', 'statusCode', 'status_code']);
      const rawKeys = Object.keys(data || {})
        .filter((key) => !ignored.has(key) && !/^stdout$/i.test(key))
        .filter((key) => !isInputKey(key))
        .filter((key) => asLines(data[key]).join('\\n').trim().length > 0)
        .sort((a, b) => sectionPriority(a) - sectionPriority(b));
      const outputKey = rawKeys.find((key) => isOutputKey(key));
      const expectedKey = rawKeys.find((key) => isExpectedKey(key));
      const keys = rawKeys.filter((key) => key !== outputKey && key !== expectedKey);
      if (outputKey) keys.push(outputKey);
      if (expectedKey) keys.push(expectedKey);
      if (!keys.length) return '';
      const equalized = outputKey && expectedKey ? ' equalized has-comparison' : '';
      return '<div class="result-diagnostics-grid' + equalized + '">' + keys.map((key) => {
        const value = asLines(data[key]).join('\\n');
        const wide = /error|compile|runtime/i.test(key) || (!isOutputKey(key) && !isExpectedKey(key) && outputKey && expectedKey) ? ' result-section-wide' : '';
        return '<section class="result-section' + wide + '"><h3 class="result-section-title">' + escapeHtml(sectionLabel(key)) + '</h3><pre class="result-pre">' + escapeHtml(value) + '</pre></section>';
      }).join('') + '</div>';
    }
    function normalizeCaseValue(value) {
      let text = String(value || '').replace(/\\r\\n/g, '\\n').replace(/\\\\n/g, '\\n').trim();
      if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
        text = text.slice(1, -1);
      }
      return text.replace(/\\r\\n/g, '\\n').trim();
    }
    function sectionValue(data, names) {
      const keys = Object.keys(data || {});
      for (const name of names) {
        const key = keys.find((item) => item.toLowerCase().replace(/\\s*\\([^)]*\\)\\s*$/, '') === name.toLowerCase());
        const value = key ? asLines(data[key]).join('\\n') : '';
        if (value.trim()) return value;
      }
      return '';
    }
    function compareValue(value) {
      let text = String(value || '').trim();
      if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) {
        text = text.slice(1, -1);
      }
      text = text.replace(/\\\\n/g, '\\n').replace(/\\r\\n/g, '\\n').trim();
      return text.split('\\n').map((line) => line.trim()).join('\\n');
    }
    function compactCaseValue(value) {
      return normalizeCaseValue(value).replace(/\\s+/g, '');
    }
    function splitAllcaseRows(value) {
      const text = normalizeCaseValue(value);
      if (!text) return [];
      const lines = text.split('\\n').map((line) => line.trim()).filter(Boolean);
      if (lines.length > 1) return lines;
      if (/\\s+\\/\\s+/.test(text)) {
        return text.split(/\\s+\\/\\s+/).map((line) => line.trim()).filter(Boolean);
      }
      return lines;
    }
    function locateCaseStart(value, inputRows) {
      const current = compactCaseValue(value);
      if (!current) return -1;
      for (let start = 0; start < inputRows.length; start++) {
        let collected = '';
        for (let end = start; end < Math.min(inputRows.length, start + 8); end++) {
          collected += (collected ? '\\n' : '') + inputRows[end];
          const compact = compactCaseValue(collected);
          if (compact === current) return start;
          if (compact.length > current.length && !compact.startsWith(current)) break;
        }
      }
      return -1;
    }
    function allcaseIndexForCase(testCase, fallbackIndex, inputRows, allCases) {
      const current = compactCaseValue(testCase.value);
      if (!current || !inputRows.length) return -1;
      const directIndex = inputRows.findIndex((row) => compactCaseValue(row) === current);
      if (directIndex >= 0) return directIndex;
      const currentStart = locateCaseStart(testCase.value, inputRows);
      if (currentStart < 0) return -1;
      const starts = allCases
        .map((item, index) => ({ index, start: locateCaseStart(item.value, inputRows) }))
        .filter((item) => item.start >= 0)
        .sort((a, b) => a.start - b.start);
      const matched = starts.findIndex((item) => item.index === fallbackIndex);
      return matched >= 0 ? matched : -1;
    }
    function allcaseVerdictForCase(testCase, index, payload) {
      const data = getResultData(payload);
      const inputRows = splitAllcaseRows(sectionValue(data, ['Your Input', 'Input', 'Testcase', 'Last Testcase']));
      const outputRows = splitAllcaseRows(sectionValue(data, ['Answer', 'Output']));
      const expectedRows = splitAllcaseRows(sectionValue(data, ['Expected Answer', 'Expected Output', 'Expected']));
      if (!outputRows.length || !expectedRows.length) return '';
      let resultIndex = allcaseIndexForCase(testCase, index, inputRows, state.cases);
      if (resultIndex < 0 && outputRows.length === state.cases.length && expectedRows.length === state.cases.length) {
        resultIndex = index;
      }
      if (resultIndex < 0 || resultIndex >= outputRows.length || resultIndex >= expectedRows.length) return '';
      return compareValue(outputRows[resultIndex]) === compareValue(expectedRows[resultIndex]) ? 'Correct' : 'Wrong Answer';
    }
    function caseVerdict(payload) {
      if (!payload || payload.phase === 'running' || !isCaseResult(payload)) return '';
      const data = getResultData(payload);
      const output = sectionValue(data, ['Answer', 'Output']);
      const expected = sectionValue(data, ['Expected Answer', 'Expected Output', 'Expected']);
      if (!output || !expected) return '';
      return compareValue(output) === compareValue(expected) ? 'Correct' : 'Wrong Answer';
    }
    function failingCaseValue(payload) {
      const data = getResultData(payload);
      return normalizeCaseValue(sectionValue(data, ['Testcase', 'Last Testcase', 'Your Input', 'Input']));
    }
    function isCaseResult(payload) {
      const mode = getMode(payload);
      const action = payload && payload.action;
      return mode === '用例' || mode === '全部用例' || action === 'runCase' || action === 'case' || action === 'allcase';
    }
    function caseClass(testCase, index) {
      const payload = state.result;
      if (!payload || payload.phase === 'running' || !isCaseResult(payload)) return '';
      const data = getResultData(payload);
      const sys = data.system_message || payload.submitEvent || {};
      const mode = getMode(payload);
      const active = normalizeCaseValue(payload.activeTestCase);
      const current = normalizeCaseValue(testCase.value);
      const verdict = caseVerdict(payload);
      const accepted = verdict ? verdict === 'Correct' : (!!sys.accepted || /^(accepted|finished)$/i.test(getStatus(payload)));
      if (mode === '全部用例') {
        const allcaseVerdict = allcaseVerdictForCase(testCase, index, payload);
        if (allcaseVerdict === 'Correct') return ' case-pass';
        if (allcaseVerdict === 'Wrong Answer') return ' case-fail';
        return accepted ? ' case-pass' : '';
      }
      const failed = failingCaseValue(payload);
      if (accepted) {
        if (!active || active === current) return ' case-pass';
        return '';
      }
      if (failed && failed === current) return ' case-fail';
      if (active && active === current) return ' case-fail';
      return '';
    }
    function renderResult() {
      const payload = state.result;
      if (!payload) {
        resultEl.innerHTML = '<div class="result-header tone-neutral"><span class="result-dot"></span><span>空闲</span></div><div class="empty">运行用例、全部用例或提交后，这里会显示最新结果。</div>';
        return;
      }
      const tone = getTone(payload);
      if (payload.phase === 'running') {
        const waitingText = payload.action === 'debug' ? '正在启动 C++ 调试器。' : '等待 LeetCode 返回结果。';
        resultEl.innerHTML = '<div class="result-header tone-running"><span class="result-dot"></span><span>运行</span></div><div class="result-body tone-running"><div class="result-waiting">' + waitingText + '</div></div>';
        return;
      }
      resultEl.innerHTML = '<div class="result-body ' + tone + '">' + resultSummary(payload) + summaryLines(payload) + renderPerformanceCharts(payload) + diagnostics(payload) + '</div>';
    }
    function icon(name) {
      const icons = {
        run: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="7 4 19 12 7 20 7 4"></polygon></svg>',
        debug: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2l1.8 3h4.4L16 2"></path><rect x="7" y="6" width="10" height="14" rx="5"></rect><path d="M3 13h4"></path><path d="M17 13h4"></path><path d="M4 20l3-3"></path><path d="M20 20l-3-3"></path><path d="M12 6v14"></path></svg>',
        delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 15h10l1-15"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>',
        add: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
      };
      return icons[name] || '';
    }
    function autosizeTextarea(textarea) {
      if (!textarea) return;
      textarea.style.height = '30px';
      const next = Math.min(Math.max(textarea.scrollHeight, 30), 180);
      textarea.style.height = next + 'px';
      textarea.style.overflowY = textarea.scrollHeight > 180 ? 'auto' : 'hidden';
    }
    function autosizeAllTextareas() {
      document.querySelectorAll('textarea').forEach(autosizeTextarea);
    }
    function equalizeResultBlocks() {
      const grid = document.querySelector('.result-diagnostics-grid.equalized');
      if (!grid) return;
      const blocks = Array.from(grid.querySelectorAll('.result-pre'));
      if (blocks.length < 2) return;
      blocks.forEach((block) => block.style.height = 'auto');
      const height = Math.min(Math.max(...blocks.map((block) => block.scrollHeight)), 160);
      grid.style.setProperty('--result-pre-height', height + 'px');
    }
    function render() {
      file.innerHTML = escapeHtml(state.problemTitle || state.fileName || '未打开力扣题目') + (state.dirty ? ' <span class="dirty">已修改</span>' : '');
      aiDebugToggle.checked = !!state.aiDebugEnabled;
      renderResult();
      equalizeResultBlocks();
      if (!state.isLeetCodeFile) {
        content.innerHTML = '<div class="empty">打开力扣题目文件后，可以在这里管理操作和测试用例。</div>';
        return;
      }
      if (!state.cases.length) {
        content.innerHTML = '<div class="empty">还没有 @lcpr 测试用例。</div><div class="case-add-row"><button class="case-add-button" data-add-case title="添加用例" aria-label="添加用例">' + icon('add') + '</button></div>';
        return;
      }
      content.innerHTML = '<div class="list">' + state.cases.map((testCase, index) => \`
        <div class="case\${caseClass(testCase, index)}" data-index="\${index}">
          <div class="case-header">
            <div class="case-title">\${escapeHtml(testCase.label || ('用例 ' + (index + 1)))}</div>
            <div class="case-actions">
              <button data-run="\${index}" title="运行" aria-label="运行">\${icon('run')}</button>
              <button data-debug="\${index}" title="调试" aria-label="调试">\${icon('debug')}</button>
              <button data-delete="\${index}" title="删除" aria-label="删除">\${icon('delete')}</button>
            </div>
          </div>
          <div class="case-editor">
            <textarea data-edit="\${index}" spellcheck="false">\${escapeHtml(testCase.value)}</textarea>
          </div>
        </div>\`).join('') + '</div>';
      content.querySelector('.list').insertAdjacentHTML('beforeend', '<div class="case-add-row"><button class="case-add-button" data-add-case title="添加用例" aria-label="添加用例">' + icon('add') + '</button></div>');
      autosizeAllTextareas();
    }
    function currentCases() {
      return state.cases.map((testCase, index) => {
        const textarea = document.querySelector('[data-edit="' + index + '"]');
        return { ...testCase, value: textarea ? textarea.value : testCase.value };
      });
    }
    function trimCaseInput(value) {
      return String(value || '').trim().replace(/(?:\\\\n|\\r?\\n)+$/g, '');
    }
    function visibleAllcaseValue() {
      return currentCases()
        .map((testCase) => trimCaseInput(testCase.value))
        .filter(Boolean)
        .join('\\\\n');
    }
    function firstVisibleCaseValue() {
      const item = currentCases().map((testCase) => trimCaseInput(testCase.value)).find(Boolean);
      return item || '';
    }
    let saveCasesTimer = 0;
    let caseInputComposing = false;
    function updateCaseStateFromInputs() {
      state.cases = currentCases();
    }
    function scheduleCaseAutosave(immediate) {
      clearTimeout(saveCasesTimer);
      const run = () => {
        updateCaseStateFromInputs();
        send({ type: 'saveCases', cases: state.cases, silent: true });
      };
      if (immediate) {
        run();
        return;
      }
      saveCasesTimer = setTimeout(run, 650);
    }
    document.querySelector('.toolbar').addEventListener('click', (event) => {
      const target = event.target && event.target.closest ? event.target.closest('button') : event.target;
      const action = target && target.dataset && target.dataset.action;
      if (action === 'allcase') {
        send({ type: 'action', action, testCase: visibleAllcaseValue(), enableAiDebug: !!state.aiDebugEnabled });
      } else if (action) {
        send({ type: 'action', action, enableAiDebug: !!state.aiDebugEnabled });
      }
    });
    aiDebugToggle.addEventListener('change', () => {
      state.aiDebugEnabled = aiDebugToggle.checked;
      send({ type: 'setAiDebugEnabled', value: state.aiDebugEnabled });
    });
    document.getElementById('refresh').addEventListener('click', () => send({ type: 'refreshOfficial' }));
    content.addEventListener('click', (event) => {
      const target = event.target && event.target.closest ? event.target.closest('button') : event.target;
      if (!target || !target.dataset) return;
      if (target.dataset.addCase !== undefined) {
        state.cases = currentCases().concat([{ label: '用例 ' + (state.cases.length + 1), value: '' }]);
        render();
        const textarea = content.querySelector('[data-edit="' + (state.cases.length - 1) + '"]');
        if (textarea) textarea.focus();
        scheduleCaseAutosave(true);
        return;
      }
      if (target.dataset.run !== undefined) {
        const testCase = currentCases()[Number(target.dataset.run)];
        send({ type: 'action', action: 'runCase', testCase: testCase && testCase.value });
      }
      if (target.dataset.debug !== undefined) {
        const testCase = currentCases()[Number(target.dataset.debug)];
        send({ type: 'action', action: 'debug', testCase: testCase && testCase.value, enableAiDebug: !!state.aiDebugEnabled });
      }
      if (target.dataset.delete !== undefined) {
        const index = Number(target.dataset.delete);
        state.cases = currentCases().filter((_, i) => i !== index).map((testCase, i) => ({ ...testCase, label: '用例 ' + (i + 1) }));
        render();
        scheduleCaseAutosave(true);
      }
    });
    content.addEventListener('input', (event) => {
      if (event.target && event.target.tagName === 'TEXTAREA') {
        autosizeTextarea(event.target);
        const index = Number(event.target.dataset.edit);
        if (Number.isFinite(index) && state.cases[index]) {
          state.cases[index] = { ...state.cases[index], value: event.target.value };
        }
        if (!caseInputComposing) {
          scheduleCaseAutosave(false);
        }
      }
    });
    content.addEventListener('compositionstart', (event) => {
      if (event.target && event.target.tagName === 'TEXTAREA') {
        caseInputComposing = true;
      }
    });
    content.addEventListener('compositionend', (event) => {
      if (event.target && event.target.tagName === 'TEXTAREA') {
        caseInputComposing = false;
        autosizeTextarea(event.target);
        const index = Number(event.target.dataset.edit);
        if (Number.isFinite(index) && state.cases[index]) {
          state.cases[index] = { ...state.cases[index], value: event.target.value };
        }
        scheduleCaseAutosave(false);
      }
    });
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'state') {
        state = event.data.state;
        render();
      }
    });
    send({ type: 'refresh' });
  </script>
</body>
</html>`;
    }
}
function registerLeetCodeWorkbench(context, baba, babaStr) {
    const provider = new LeetCodeWorkbenchProvider(context, baba, babaStr);
    const subscriptions = [
        vscode.window.registerWebviewViewProvider("LCPRWorkbench", provider, { webviewOptions: { retainContextWhenHidden: true } }),
        vscode.window.onDidChangeActiveTextEditor(() => provider.refresh()),
        vscode.workspace.onDidSaveTextDocument((document) => provider.handleSavedDocument(document)),
        vscode.commands.registerCommand("lcpr.workbench.refresh", () => provider.refreshOfficialCases()),
        vscode.commands.registerCommand("lcpr.workbench.showResult", (payload) => provider.showResult(payload)),
        vscode.commands.registerCommand("lcpr.workbench.case", () => provider.runAction("case")),
        vscode.commands.registerCommand("lcpr.workbench.allcase", () => provider.runAction("allcase")),
        vscode.commands.registerCommand("lcpr.workbench.debug", () => provider.runAction("debug")),
    ];
    const disposable = vscode.Disposable.from(...subscriptions, { dispose: () => provider.dispose() });
    context.subscriptions.push(disposable);
    return disposable;
}
export { registerLeetCodeWorkbench };
