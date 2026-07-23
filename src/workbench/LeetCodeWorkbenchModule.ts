// @ts-nocheck
import * as vscode from "vscode";
import * as ConfigUtils_1 from "../utils/ConfigUtils";
import { UserStatus } from "../model/ConstDefind";
import { BABAMediator } from "../BABA";
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
    this.currentActivity = undefined;
    this.activityLoading = false;
    this.activityFetchedAt = 0;
    this.activityCacheMs = 10 * 60 * 1000;
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
  refresh(editor, options = {}) {
    const nextState = this.readState(editor);
    const isTransientEditorMiss = !!(options.preserveCurrentOnTransientMiss && !editor && !nextState.isLeetCodeFile && this.currentState && this.currentState.isLeetCodeFile);
    this.currentState = isTransientEditorMiss
      ? Object.assign({}, this.currentState, {
        isLoggedIn: nextState.isLoggedIn,
        result: this.currentResult,
        activity: this.currentActivity,
        aiDebugEnabled: this.aiDebugEnabled,
      })
      : nextState;
    this.postState();
    this.ensureActivityLoaded();
  }
  setPanelMessage(message, options = {}) {
    this.currentResult = {
      phase: "message",
      tone: options.tone || "tone-neutral",
      label: options.label || "提示",
      message,
      updatedAt: Date.now(),
    };
    this.currentState = this.readState();
    this.postState();
  }
  async ensureActivityLoaded(force = false) {
    if (!this.view) {
      return;
    }
    const now = Date.now();
    if (this.activityLoading) {
      return;
    }
    const cacheMs = this.currentActivity && this.currentActivity.status === "error" ? 60 * 1000 : this.activityCacheMs;
    if (!force && this.currentActivity && now - this.activityFetchedAt < cacheMs) {
      return;
    }
    this.activityLoading = true;
    this.activityFetchedAt = now;
    this.currentActivity = Object.assign({}, this.currentActivity || {}, {
      status: "loading",
    });
    this.currentState = this.readState();
    this.postState();
    try {
      const raw = await this.baba
        .getProxy(this.babaStr.ChildCallProxy)
        .get_instance()
        .getUserActivityCalendar("", 365);
      const parsed = JSON.parse(raw);
      if (parsed && parsed.code === 100) {
        this.currentActivity = Object.assign({ status: "ready", fetchedAt: Date.now() }, parsed);
      }
      else {
        this.currentActivity = {
          status: "error",
          error: (parsed && (parsed.error || parsed.msg)) || "打卡数据不可用",
          fetchedAt: Date.now(),
        };
      }
    }
    catch (error) {
      this.currentActivity = {
        status: "error",
        error: (error === null || error === void 0 ? void 0 : error.message) || String(error || "打卡数据不可用"),
        fetchedAt: Date.now(),
      };
    }
    finally {
      this.activityLoading = false;
      this.currentState = this.readState();
      this.postState();
    }
  }
  async refreshOfficialCases() {
    if (!this.isLoggedIn()) {
      this.setPanelMessage("请先登录 LeetCode 后再操作。");
      return;
    }
    const editor = this.getActiveEditor();
    if (!editor || !this.isLeetCodeDocument(editor.document)) {
      this.setPanelMessage("请先打开一个力扣题目文件。");
      return;
    }
    const meta = (0, problemUtils_1.fileMeta)(editor.document.getText(), editor.document.fileName);
    if (!meta || !meta.id) {
      this.setPanelMessage("无法在当前文件中找到力扣题号。");
      return;
    }
    try {
      this.setPanelMessage("正在刷新官方测试用例。", { tone: "tone-running", label: "加载" });
      const descString = await this.baba
        .getProxy(this.babaStr.ChildCallProxy)
        .get_instance()
        .getDescription(meta.id, (0, ConfigUtils_1.isUseEndpointTranslation)());
      const response = JSON.parse(descString);
      const desc = response && response.code === 100 && response.msg ? response.msg.desc : undefined;
      if (!desc) {
        this.setPanelMessage("无法从题目描述中刷新官方测试用例。");
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
        .map((value, index) => ({ label: this.defaultCaseLabel(index), value, isDefault: true }));
      if (!officialCases.length) {
        this.setPanelMessage("题目描述中没有找到官方测试用例。");
        return;
      }
      await this.saveCases(officialCases);
      this.setPanelMessage(`已恢复 ${officialCases.length} 个官方测试用例。`, { tone: "tone-success", label: "完成" });
    }
    catch (error) {
      vscode.window.showErrorMessage(`刷新官方测试用例失败：${(error === null || error === void 0 ? void 0 : error.message) || error}`);
      this.refresh();
    }
  }
  formatOfficialCase(testCase) {
    if (Array.isArray(testCase)) {
      return testCase.map((item) => this.normalizeCaseText(item)).join("\n");
    }
    return this.normalizeCaseText(testCase || "");
  }
  defaultCaseLabel(index) {
    return `用例 ${index + 1}`;
  }
  normalizeCaseLabel(label, index) {
    const text = String(label || "").trim();
    return text || this.defaultCaseLabel(index);
  }
  normalizeCaseText(value) {
    return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\\n/g, "\n");
  }
  trimVisibleCase(value) {
    return this.normalizeCaseText(value).trim().replace(/\n+$/g, "");
  }
  formatVisibleAllcase(cases) {
    return (cases || [])
      .map((testCase) => this.trimVisibleCase((testCase === null || testCase === void 0 ? void 0 : testCase.value) || ""))
      .filter((value) => value.length > 0)
      .join("\n");
  }
  postState() {
    var _a;
    (_a = this.view) === null || _a === void 0 ? void 0 : _a.webview.postMessage({
      type: "state",
      state: this.currentState || this.readState(),
    });
  }
  getActiveEditor(preferredEditor) {
    const editor = preferredEditor || vscode.window.activeTextEditor;
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
    const meta = (0, problemUtils_1.fileMeta)(document.getText(), document.fileName);
    return !!(meta && meta.id && meta.lang);
  }
  getProblemTitle(text, fileName) {
    const meta = (0, problemUtils_1.fileMeta)(text, fileName);
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
  isLoggedIn() {
    try {
      return this.baba.getProxy(this.babaStr.StatusBarProxy).getStatus() === UserStatus.SignedIn;
    }
    catch (_) {
      return false;
    }
  }
  readState(preferredEditor) {
    const editor = this.getActiveEditor(preferredEditor);
    const isLoggedIn = this.isLoggedIn();
    if (!editor || !this.isLeetCodeDocument(editor.document)) {
      return {
        isLeetCodeFile: false,
        isLoggedIn,
        fileName: "未打开力扣题目",
        problemTitle: "未打开力扣题目",
        cases: [],
        dirty: false,
        result: this.currentResult,
        activity: this.currentActivity,
        aiDebugEnabled: this.aiDebugEnabled,
      };
    }
    const text = editor.document.getText();
    const fileName = editor.document.fileName.split(/[\\/]/).pop() || editor.document.fileName;
    const cases = this.readCases(editor, text);
    return {
      isLeetCodeFile: true,
      isLoggedIn,
      fileName,
      problemTitle: this.getProblemTitle(text, editor.document.fileName),
      uri: editor.document.uri.toString(),
      cases,
      dirty: editor.document.isDirty,
      result: this.currentResult,
      activity: this.currentActivity,
      aiDebugEnabled: this.aiDebugEnabled,
    };
  }
  readCases(editor, text) {
    const meta = (0, problemUtils_1.fileMeta)(text, editor.document.fileName);
    if (!meta || !meta.id) {
      return this.parseCases(text);
    }
    const storedCases = storageUtils_1.storageUtils.readProblemCaseEntries(editor.document.fileName, meta.id);
    if (storedCases.length > 0) {
      if (text.indexOf("@lcpr case=start") >= 0) {
        this.removeCaseBlocks(editor);
      }
      return storedCases.map((testCase, index) => ({
        id: `stored-${index}`,
        label: this.normalizeCaseLabel(testCase === null || testCase === void 0 ? void 0 : testCase.label, index),
        value: this.normalizeCaseText((testCase === null || testCase === void 0 ? void 0 : testCase.value) || ""),
        isDefault: (testCase === null || testCase === void 0 ? void 0 : testCase.isDefault) === true,
        isPinned: (testCase === null || testCase === void 0 ? void 0 : testCase.isPinned) === true,
      }));
    }
    const legacyCases = this.parseCases(text);
    if (legacyCases.length > 0) {
      const values = legacyCases.map((testCase, index) => ({
        label: this.normalizeCaseLabel(testCase === null || testCase === void 0 ? void 0 : testCase.label, index),
        value: testCase.value,
        isDefault: true,
      }));
      storageUtils_1.storageUtils.writeProblemCaseEntries(editor.document.fileName, meta.id, values);
      this.removeCaseBlocks(editor);
      return values.map((testCase, index) => ({
        id: `stored-${index}`,
        label: this.normalizeCaseLabel(testCase === null || testCase === void 0 ? void 0 : testCase.label, index),
        value: this.normalizeCaseText((testCase === null || testCase === void 0 ? void 0 : testCase.value) || ""),
        isDefault: (testCase === null || testCase === void 0 ? void 0 : testCase.isDefault) === true,
        isPinned: false,
      }));
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
          label: this.defaultCaseLabel(cases.length),
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
        this.setPanelMessage("请先打开一个力扣题目文件。");
        resolve(undefined);
        return;
      }
      const document = editor.document;
      const meta = (0, problemUtils_1.fileMeta)(document.getText(), document.fileName);
      if (!meta || !meta.id) {
        this.setPanelMessage("无法在当前文件中找到力扣题号。");
        resolve(undefined);
        return;
      }
      storageUtils_1.storageUtils.writeProblemCaseEntries(document.fileName, meta.id, cases.map((testCase, index) => ({
        label: this.normalizeCaseLabel(testCase === null || testCase === void 0 ? void 0 : testCase.label, index),
        value: this.normalizeCaseText((testCase === null || testCase === void 0 ? void 0 : testCase.value) || ""),
        isDefault: (testCase === null || testCase === void 0 ? void 0 : testCase.isDefault) === true,
        isPinned: (testCase === null || testCase === void 0 ? void 0 : testCase.isPinned) === true,
      })));
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
    const normalizedTestCase = this.normalizeCaseText(testCase || "");
    const enableAiDebug = Object.prototype.hasOwnProperty.call(options, "enableAiDebug")
      ? !!options.enableAiDebug
      : !!this.aiDebugEnabled;
    const requiresLogin = ["submit", "test", "retest", "case", "allcase", "runCase", "debug"].indexOf(action) >= 0;
    if (requiresLogin && !this.isLoggedIn()) {
      this.setPanelMessage("请先登录 LeetCode 后再操作。");
      return;
    }
    if (!uri && requiresLogin) {
      this.setPanelMessage("请先打开一个力扣题目文件。");
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
        const visibleAllcase = normalizedTestCase || this.formatVisibleAllcase((this.currentState && this.currentState.cases) || []);
        if (!visibleAllcase) {
          this.setPanelMessage("没有可运行的测试用例。");
          break;
        }
        this.baba.sendNotification(this.babaStr.BABACMD_tesCaseArea, { uri, testCase: visibleAllcase, runMode: "allcase" });
        break;
      case "solution":
        this.baba.sendNotification(this.babaStr.BABACMD_getHelp, uri);
        break;
      case "debug":
        if (actionDocument) {
          this.setRunningResult("debug", normalizedTestCase);
          await this.baba.sendNotificationAsync(this.babaStr.BABACMD_simpleDebug, {
            document: actionDocument,
            testCase: normalizedTestCase,
            enableAiDebug,
          });
        }
        else {
          this.setPanelMessage("请先打开一个力扣题目文件。");
        }
        break;
      case "runCase":
        this.baba.sendNotification(this.babaStr.BABACMD_tesCaseArea, { uri, testCase: normalizedTestCase });
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
    this.ensureActivityLoaded();
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
    const data = this.getResultData(this.currentResult);
    const sys = data.system_message || this.currentResult.submitEvent || {};
    this.ensureActivityLoaded(this.currentResult.action === "submit" || sys.sub_type === "submit");
  }
  async refreshDebugVisual() {
    if (!this.currentResult) {
      this.currentResult = {
        phase: "complete",
        action: "debug",
        runMode: "debug",
        receivedAt: Date.now(),
        result: {
          messages: ["Debug Visualizer"],
        },
      };
    }
    if (this.refreshingDebugVisual) {
      return;
    }
    this.refreshingDebugVisual = true;
    if (!this.currentResult || !this.currentResult.debugVisual) {
      const nextResult = Object.assign({}, this.currentResult, {
        debugVisualLoading: true,
      });
      this.currentResult = nextResult;
      this.currentState = this.readState();
      this.postState();
    }
    try {
      const model = await vscode.commands.executeCommand("lcpr.debugVisualizer.collect");
      this.currentResult = Object.assign({}, this.currentResult, {
        debugVisual: model,
        debugVisualLoading: false,
        debugVisualUpdatedAt: Date.now(),
      });
    }
    catch (error) {
      this.currentResult = Object.assign({}, this.currentResult, {
        debugVisual: {
          title: "Debug Visualizer",
          status: "采集失败",
          variables: [],
          warnings: [String((error === null || error === void 0 ? void 0 : error.message) || error || "无法采集调试变量。")],
          updatedAt: Date.now(),
          canRefresh: true,
        },
        debugVisualLoading: false,
        debugVisualUpdatedAt: Date.now(),
      });
    }
    this.refreshingDebugVisual = false;
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
      case "refreshDebugVisual":
        await this.refreshDebugVisual();
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
      --lcpr-workbench-bg: var(--vscode-panel-background, var(--vscode-editor-background, #ffffff));
      --lcpr-workbench-canvas: var(--lcpr-workbench-bg);
      --lcpr-workbench-fg: var(--vscode-editor-foreground, var(--vscode-foreground, #222222));
      --lcpr-workbench-muted: color-mix(in srgb, var(--lcpr-workbench-fg) 54%, var(--lcpr-workbench-bg) 46%);
      --lcpr-workbench-border: color-mix(in srgb, var(--lcpr-workbench-bg) 94%, var(--lcpr-workbench-fg) 6%);
      --lcpr-workbench-frame-border: color-mix(in srgb, var(--lcpr-workbench-bg) 92%, var(--lcpr-workbench-fg) 8%);
      --lcpr-workbench-input: var(--vscode-textCodeBlock-background, var(--vscode-input-background, color-mix(in srgb, var(--lcpr-workbench-bg) 95%, var(--lcpr-workbench-fg) 5%)));
      --lcpr-workbench-button-bg: var(--vscode-button-secondaryBackground, var(--lcpr-workbench-input));
      --lcpr-workbench-hover: var(--vscode-toolbar-hoverBackground, color-mix(in srgb, var(--lcpr-workbench-input) 90%, var(--lcpr-workbench-fg) 10%));
      --lcpr-workbench-card-bg: #ffffff;
      --lcpr-workbench-soft-bg: var(--vscode-textCodeBlock-background, color-mix(in srgb, var(--lcpr-workbench-bg) 95%, var(--lcpr-workbench-fg) 5%));
      --lcpr-workbench-soft-border: color-mix(in srgb, var(--lcpr-workbench-bg) 96%, var(--lcpr-workbench-fg) 4%);
      --lcpr-workbench-case-bg: var(--lcpr-workbench-bg);
      --lcpr-case-idle-strip: color-mix(in srgb, var(--lcpr-workbench-muted) 56%, var(--lcpr-workbench-bg) 44%);
      --lcpr-workbench-case-editor-bg: var(--lcpr-workbench-soft-bg);
      --lcpr-workbench-case-editor-border: color-mix(in srgb, var(--lcpr-workbench-soft-bg) 97%, var(--lcpr-workbench-fg) 3%);
      --lcpr-toolbar-disabled-bg: color-mix(in srgb, var(--lcpr-workbench-bg) 92%, var(--lcpr-workbench-fg) 8%);
      --lcpr-toolbar-disabled-fg: color-mix(in srgb, var(--lcpr-workbench-fg) 42%, var(--lcpr-workbench-bg) 58%);
      --lcpr-warning-text: var(--vscode-editorWarning-foreground, #7a5a00);
      --workspace-split: 66.7%;
      --workspace-default-snap-x: 66.7%;
      --workspace-golden-snap-x: 61.8%;
      --workspace-divider-width: 8px;
      --workspace-divider-visual-offset: 4px;
    }
    body.vscode-dark {
      --lcpr-success-deep: #2ea043;
      --lcpr-workbench-bg: var(--vscode-panel-background, var(--vscode-editor-background, #1f2028));
      --lcpr-workbench-canvas: var(--lcpr-workbench-bg);
      --lcpr-workbench-fg: var(--vscode-editor-foreground, #e6edf3);
      --lcpr-workbench-muted: color-mix(in srgb, var(--lcpr-workbench-fg) 64%, var(--lcpr-workbench-bg) 36%);
      --lcpr-workbench-border: color-mix(in srgb, var(--lcpr-workbench-bg) 88%, var(--lcpr-workbench-fg) 12%);
      --lcpr-workbench-frame-border: color-mix(in srgb, var(--lcpr-workbench-bg) 84%, var(--lcpr-workbench-fg) 16%);
      --lcpr-workbench-input: var(--vscode-textCodeBlock-background, var(--vscode-input-background, color-mix(in srgb, var(--lcpr-workbench-bg) 88%, #ffffff 12%)));
      --lcpr-workbench-button-bg: var(--vscode-button-secondaryBackground, var(--lcpr-workbench-input));
      --lcpr-workbench-hover: var(--vscode-toolbar-hoverBackground, color-mix(in srgb, var(--lcpr-workbench-input) 88%, #ffffff 12%));
      --lcpr-workbench-card-bg: #1f2028;
      --lcpr-workbench-soft-bg: var(--vscode-textCodeBlock-background, color-mix(in srgb, var(--lcpr-workbench-bg) 88%, #ffffff 12%));
      --lcpr-workbench-soft-border: color-mix(in srgb, var(--lcpr-workbench-bg) 90%, var(--lcpr-workbench-fg) 10%);
      --lcpr-workbench-case-bg: var(--lcpr-workbench-bg);
      --lcpr-case-idle-strip: color-mix(in srgb, var(--lcpr-workbench-muted) 70%, var(--lcpr-workbench-bg) 30%);
      --lcpr-workbench-case-editor-bg: var(--lcpr-workbench-soft-bg);
      --lcpr-workbench-case-editor-border: color-mix(in srgb, var(--lcpr-workbench-soft-bg) 94%, var(--lcpr-workbench-fg) 6%);
      --lcpr-toolbar-disabled-bg: color-mix(in srgb, var(--lcpr-workbench-bg) 82%, #ffffff 18%);
      --lcpr-toolbar-disabled-fg: color-mix(in srgb, var(--lcpr-workbench-fg) 44%, var(--lcpr-workbench-bg) 56%);
      --lcpr-warning-text: var(--vscode-editorWarning-foreground, #e5c45a);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      height: 100vh;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      color: var(--lcpr-workbench-fg);
      background: var(--lcpr-workbench-canvas);
      font: 12px var(--vscode-font-family);
    }
    button, textarea {
      font: inherit;
    }
    .shell {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
      border: 0;
      background: var(--lcpr-workbench-bg);
    }
    .toolbar {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: start;
      gap: 6px;
      min-height: 30px;
      padding: 2px var(--panel-pad-x);
      border-bottom: 1px solid var(--lcpr-workbench-frame-border);
      background: var(--lcpr-workbench-bg);
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
      gap: 6px;
    }
    .toolbar-edit {
      justify-self: end;
      gap: 6px;
    }
    .toolbar-check {
      height: 22px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      max-width: 0;
      padding: 0 2px;
      color: var(--lcpr-workbench-muted);
      overflow: hidden;
      opacity: 0;
      pointer-events: none;
      white-space: nowrap;
      user-select: none;
      transition: max-width .18s ease, opacity .18s ease;
    }
    .toolbar-edit:hover .toolbar-check,
    .toolbar-edit:focus-within .toolbar-check,
    body.show-ai-debug .toolbar-check {
      max-width: 142px;
      opacity: 1;
      pointer-events: auto;
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
      border-color: var(--lcpr-workbench-muted);
      background: var(--lcpr-workbench-muted);
    }
    .toolbar-check input:checked::after {
      content: "";
      position: absolute;
      left: 4px;
      top: 1px;
      width: 4px;
      height: 8px;
      border: solid var(--lcpr-workbench-bg, #ffffff);
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
    .toolbar-check input:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }
    body.void-workbench .toolbar-check {
      color: var(--lcpr-toolbar-disabled-fg);
    }
    body.void-workbench .toolbar-check input {
      cursor: not-allowed;
      opacity: .55;
    }
    .toolbar button {
      --toolbar-button-bg: var(--vscode-button-secondaryBackground, var(--lcpr-workbench-button-bg));
      height: 22px;
      padding: 0 8px;
      border: 0;
      border-radius: 5px;
      color: var(--vscode-button-secondaryForeground, var(--lcpr-workbench-fg));
      background: var(--toolbar-button-bg);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      line-height: 1;
      user-select: none;
      -webkit-user-select: none;
    }
    .toolbar button:hover:not(:disabled) {
      background: color-mix(in srgb, var(--toolbar-button-bg) 97%, #000 3%);
    }
    body.vscode-dark .toolbar button:hover:not(:disabled) {
      background: color-mix(in srgb, var(--toolbar-button-bg) 85%, #ffffff 15%);
    }
    .toolbar button:disabled {
      color: var(--lcpr-toolbar-disabled-fg);
      background: var(--lcpr-toolbar-disabled-bg);
      opacity: 1;
      cursor: not-allowed;
    }
    .toolbar button:disabled:hover {
      color: var(--lcpr-toolbar-disabled-fg);
      background: var(--lcpr-toolbar-disabled-bg);
    }
    .toolbar .primary {
      --toolbar-button-bg: var(--vscode-button-background, #0b72da);
      color: var(--vscode-button-foreground, #ffffff);
      background: var(--toolbar-button-bg);
    }
    .toolbar .primary:disabled {
      color: var(--lcpr-toolbar-disabled-fg);
      background: var(--lcpr-toolbar-disabled-bg);
    }
    .toolbar .primary:hover:not(:disabled) {
      background: color-mix(in srgb, var(--toolbar-button-bg) 88%, #000 12%);
    }
    .toolbar .important {
      font-weight: 600;
    }
    .problem-title {
      position: absolute;
      left: 50%;
      top: 50%;
      z-index: 1;
      width: min(44vw, 620px);
      min-width: 0;
      padding: 0 6px;
      color: color-mix(in srgb, var(--lcpr-workbench-muted) 88%, transparent);
      font-size: 11px;
      font-weight: 600;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }
    .workspace {
      position: relative;
      display: grid;
      grid-template-columns: minmax(420px, var(--workspace-split)) var(--workspace-divider-width) minmax(220px, 1fr);
      flex: 1 1 auto;
      min-height: 0;
      overflow: hidden;
      background: var(--lcpr-workbench-bg);
    }
    .workspace-snap-target {
      position: absolute;
      top: 50%;
      left: calc(var(--workspace-snap-x, var(--workspace-default-snap-x)) + var(--workspace-divider-width) / 2);
      width: 10px;
      height: 10px;
      border: 1px solid var(--lcpr-workbench-bg);
      border-radius: 50%;
      background: color-mix(in srgb, var(--lcpr-workbench-muted) 72%, var(--lcpr-workbench-bg) 28%);
      box-shadow: 0 0 0 1px var(--lcpr-workbench-frame-border);
      opacity: 0;
      pointer-events: none;
      transform: translate(-50%, -50%);
      transition: opacity 120ms ease;
      z-index: 2;
    }
    .workspace-snap-target.is-default {
      --workspace-snap-x: var(--workspace-default-snap-x);
      width: 11px;
      height: 11px;
      background: color-mix(in srgb, var(--lcpr-workbench-muted) 80%, var(--lcpr-workbench-bg) 20%);
    }
    .workspace-snap-target.is-golden {
      --workspace-snap-x: var(--workspace-golden-snap-x);
      width: 8px;
      height: 8px;
      background: color-mix(in srgb, var(--lcpr-workbench-muted) 58%, var(--lcpr-workbench-bg) 42%);
    }
    body.workspace-resizing .workspace-snap-target {
      opacity: 1;
    }
    .workspace-resizer {
      position: relative;
      width: var(--workspace-divider-width);
      min-width: var(--workspace-divider-width);
      height: 100%;
      cursor: col-resize;
      user-select: none;
      touch-action: none;
      background: transparent;
      z-index: 3;
    }
    .workspace-resizer::before {
      content: "";
      position: absolute;
      top: 8px;
      bottom: 8px;
      left: 50%;
      width: 1px;
      border-radius: 1px;
      background: var(--lcpr-workbench-frame-border);
      transform: translateX(-50%);
      pointer-events: none;
    }
    .case-pane {
      min-width: 0;
      min-height: 0;
      overflow: auto;
      background: var(--lcpr-workbench-bg);
    }
    .result-pane {
      min-width: 0;
      min-height: 0;
      overflow: auto;
      background: var(--lcpr-workbench-bg);
    }
    .result-sticky {
      position: relative;
      min-height: 100%;
    }
    .result-header {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 32px;
      padding: 4px var(--panel-pad-x);
      color: var(--lcpr-workbench-fg);
      font-weight: 600;
    }
    .result-header .muted {
      margin-left: auto;
      color: var(--lcpr-workbench-muted);
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
      background: var(--lcpr-workbench-muted);
    }
    #result .result-dot {
      width: 10px;
      height: 10px;
    }
    .tone-success { --tone: var(--lcpr-success-deep); }
    .tone-danger { --tone: var(--vscode-testing-iconFailed, #d1242f); }
    .tone-warning { --tone: var(--lcpr-warning-text); }
    .tone-running { --tone: var(--vscode-progressBar-background, #0e70c0); }
    .tone-neutral { --tone: var(--lcpr-workbench-muted); }
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
      padding: 8px 10px 10px;
    }
    #result .result-header + .result-body {
      padding-top: 6px;
    }
    .result-waiting {
      color: var(--lcpr-workbench-fg);
      font-size: 13px;
      line-height: 1.45;
    }
    .activity-tip {
      position: absolute;
      right: var(--panel-pad-x);
      bottom: 10px;
      max-width: min(72%, 248px);
      color: var(--lcpr-workbench-muted);
      background: transparent;
      font-size: 11px;
      z-index: 10;
    }
    .activity-trigger {
      display: block;
      max-width: 100%;
      height: 22px;
      padding: 0 0;
      border: 0;
      color: var(--lcpr-workbench-muted);
      background: transparent;
      cursor: pointer;
      font: inherit;
      line-height: 22px;
      text-align: right;
      white-space: nowrap;
    }
    .activity-trigger:hover {
      color: var(--lcpr-workbench-fg);
    }
    .activity-trigger strong,
    .activity-summary strong {
      color: var(--lcpr-workbench-fg);
      font-weight: 700;
    }
    .activity-popover {
      position: absolute;
      right: 0;
      bottom: 28px;
      display: grid;
      gap: 8px;
      width: min(248px, calc(100vw - 28px));
      padding: 9px 10px;
      border: 1px solid var(--lcpr-workbench-border);
      border-radius: 4px;
      background: var(--vscode-editorWidget-background, var(--lcpr-workbench-bg));
      box-shadow: 0 8px 20px var(--vscode-widget-shadow, rgba(0, 0, 0, .32));
      box-sizing: border-box;
      pointer-events: auto;
    }
    .activity-range {
      display: inline-flex;
      justify-self: end;
      gap: 2px;
      padding: 2px;
      border-radius: 3px;
      background: var(--lcpr-workbench-input);
    }
    .activity-range button {
      height: 20px;
      padding: 0 7px;
      border: 0;
      border-radius: 2px;
      color: var(--lcpr-workbench-muted);
      background: var(--lcpr-workbench-input);
      cursor: pointer;
      font-size: 11px;
    }
    .activity-range button.active {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }
    .activity-grid {
      --activity-cell: 8px;
      --activity-gap: 4px;
      --activity-grid-height: 28px;
      display: grid;
      gap: var(--activity-gap);
      align-content: center;
      justify-content: end;
      min-height: var(--activity-grid-height);
      max-width: 100%;
      overflow: hidden;
    }
    .activity-grid.range-week {
      --activity-cell: 10px;
      --activity-gap: 5px;
      grid-template-columns: repeat(7, var(--activity-cell));
    }
    .activity-grid.range-month {
      --activity-cell: 8px;
      --activity-gap: 4px;
      grid-template-columns: repeat(15, var(--activity-cell));
    }
    .activity-grid.range-year {
      --activity-cell: 3px;
      --activity-gap: 1px;
      grid-auto-flow: column;
      grid-auto-columns: var(--activity-cell);
      grid-template-rows: repeat(7, var(--activity-cell));
    }
    .activity-pad,
    .activity-day {
      width: var(--activity-cell);
      height: var(--activity-cell);
      border-radius: 2px;
    }
    .activity-pad {
      background: transparent;
    }
    .activity-day {
      background: var(--lcpr-workbench-input);
    }
    .activity-l1 { background: #2f6f46; }
    .activity-l2 { background: #328a50; }
    .activity-l3 { background: #279047; }
    .activity-l4 { background: var(--lcpr-success-deep); }
    .activity-summary {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 5px 11px;
      color: var(--lcpr-workbench-muted);
      font-size: 11px;
      line-height: 1.35;
    }
    .activity-range button:hover {
      color: var(--lcpr-workbench-fg);
      background: var(--lcpr-workbench-hover);
    }
    .result-status {
      margin: 0;
      color: var(--tone, var(--lcpr-workbench-fg));
      font-size: 18px;
      line-height: 1.25;
      font-weight: 800;
      letter-spacing: .01em;
      word-break: break-word;
    }
    .result-comparison {
      display: grid;
      gap: 8px;
    }
    .result-hero {
      padding: 10px 14px 12px;
      border: 1px solid var(--lcpr-workbench-soft-border);
      border-radius: 5px;
      background: var(--lcpr-workbench-card-bg);
    }
    .result-hero .result-status {
      font-size: 22px;
      line-height: 1.1;
    }
    .result-card-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .result-card {
      position: relative;
      min-width: 0;
      border: 1px solid var(--lcpr-workbench-soft-border);
      border-radius: 5px;
      background: var(--lcpr-workbench-card-bg);
      overflow: hidden;
      --result-card-strip: var(--lcpr-case-idle-strip);
    }
    .result-card.has-input-popover {
      z-index: 5;
      overflow: visible;
    }
    .result-card::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 5px;
      border-radius: 5px 0 0 5px;
      background: var(--lcpr-case-idle-strip);
    }
    .result-card-pass {
      --result-card-strip: var(--lcpr-success-deep);
    }
    .result-card-fail {
      --result-card-strip: var(--vscode-testing-iconFailed, #d1242f);
    }
    .result-card-body {
      display: grid;
      gap: 0;
    }
    .result-card-header {
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      min-width: 0;
      min-height: 24px;
      padding: 7px 8px 3px 15px;
    }
    .result-card-header::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 5px;
      border-radius: 5px 0 0 0;
      background: var(--result-card-strip);
    }
    .result-card-title {
      min-width: 0;
      color: var(--lcpr-workbench-fg);
      font-size: 12px;
      font-weight: 700;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .result-card-pin,
    .case-pin-toggle {
      display: inline-grid;
      place-items: center;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 0;
      border-radius: 3px;
      color: var(--lcpr-workbench-muted);
      background: transparent;
      cursor: pointer;
    }
    .result-card-pin:hover,
    .case-pin-toggle:hover {
      color: var(--lcpr-workbench-fg);
      background: var(--lcpr-workbench-hover);
    }
    .result-card-pin:active,
    .case-pin-toggle:active {
      color: var(--lcpr-workbench-fg);
      background: var(--vscode-toolbar-activeBackground, var(--lcpr-workbench-hover));
    }
    .result-card-pin svg,
    .case-pin-toggle svg {
      width: 16px;
      height: 16px;
      display: block;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.85;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .case-pin-toggle.is-pinned svg {
      fill: currentColor;
    }
    .case-pin-toggle:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }
    .result-card-input,
    .result-card-comparison {
      position: relative;
      padding-left: 15px;
    }
    .result-card-input::before,
    .result-card-comparison::before {
      content: "";
      position: absolute;
      left: 0;
      width: 5px;
    }
    .result-card-input {
      padding: 5px 8px 7px 15px;
    }
    .result-card-input::before {
      top: 0;
      bottom: 0;
      background: var(--result-card-strip);
    }
    .result-card-input::after {
      content: "";
      position: absolute;
      left: 5px;
      right: 0;
      bottom: 0;
      height: 1px;
      background: var(--lcpr-workbench-soft-border);
    }
    .result-card-block {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .result-card-pre-wrap {
      position: relative;
      min-width: 0;
    }
    .result-card-input .result-card-block {
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      column-gap: 8px;
    }
    .result-card-input .result-card-meta {
      display: contents;
    }
    .result-card-input .result-card-label {
      grid-column: 1;
      grid-row: 1;
      min-width: 26px;
      white-space: nowrap;
    }
    .result-card-input .result-card-pre.is-input {
      grid-column: 2;
      grid-row: 1;
      width: 100%;
    }
    .result-card-comparison {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      padding: 6px 8px 8px 15px;
    }
    .result-card-comparison::before {
      content: none;
    }
    .result-card-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .result-card-label {
      color: var(--lcpr-workbench-fg);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0;
    }
    .result-card-pre {
      width: 100%;
      min-height: 88px;
      max-height: 132px;
      margin: 0;
      overflow: auto;
      scrollbar-width: none;
      padding: 6px 8px;
      color: var(--vscode-editor-foreground, var(--lcpr-workbench-fg));
      background: var(--lcpr-workbench-case-editor-bg);
      border: 1px solid var(--lcpr-workbench-case-editor-border);
      border-radius: 5px;
      font: 12px/1.4 var(--vscode-editor-font-family);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .result-card-pre::-webkit-scrollbar {
      width: 0;
      height: 0;
    }
    .result-card-scrollbar {
      display: block;
      position: absolute;
      top: 4px;
      right: 3px;
      bottom: 4px;
      width: 4px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 120ms ease;
    }
    .result-card-pre-wrap.is-scrolling .result-card-scrollbar {
      opacity: 1;
    }
    .result-card-scrollbar-thumb {
      position: absolute;
      top: 0;
      right: 0;
      width: 4px;
      min-height: 24px;
      border-radius: 999px;
      background: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, .62));
      transform: translateY(0);
    }
    .result-card-pre.is-input {
      position: relative;
      height: 27px;
      min-height: 27px;
      max-height: 27px;
      overflow: hidden;
      padding: 5px 8px;
      cursor: pointer;
      white-space: nowrap;
      word-break: normal;
      line-height: 1.25;
    }
    .result-card-pre.is-input:focus {
      border-color: var(--vscode-focusBorder, var(--lcpr-focus-gray));
      box-shadow: 0 0 0 1px var(--vscode-focusBorder, var(--lcpr-focus-gray));
      outline: none;
    }
    .result-card-pre.is-input.has-overflow::after {
      content: "";
      position: absolute;
      top: 1px;
      right: 1px;
      bottom: 1px;
      width: 32px;
      pointer-events: none;
      border-radius: 0 4px 4px 0;
      background: linear-gradient(90deg, color-mix(in srgb, var(--lcpr-workbench-case-editor-bg) 0%, transparent), var(--lcpr-workbench-case-editor-bg) 76%);
    }
    .result-card-input-popover {
      position: absolute;
      z-index: 20;
      top: 42px;
      left: 56px;
      right: 8px;
      max-height: 224px;
      padding: 7px 8px;
      color: var(--vscode-editor-foreground, var(--lcpr-workbench-fg));
      background: var(--lcpr-workbench-case-editor-bg);
      border: 1px solid var(--lcpr-workbench-case-editor-border);
      border-radius: 5px;
      box-shadow: 0 8px 22px var(--vscode-widget-shadow, rgba(0, 0, 0, .24));
    }
    .result-card-input-popover pre {
      max-height: 208px;
      margin: 0;
      overflow: auto;
      scrollbar-width: none;
      color: inherit;
      font: 11px/1.32 var(--vscode-editor-font-family);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .result-card-input-popover pre::-webkit-scrollbar {
      width: 0;
      height: 0;
    }
    .result-card-input-scrollbar {
      display: block;
      position: absolute;
      top: 7px;
      right: 3px;
      bottom: 7px;
      width: 4px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 120ms ease;
    }
    .result-card-input-popover.is-scrolling .result-card-input-scrollbar {
      opacity: 1;
    }
    .result-card-input-scrollbar-thumb {
      position: absolute;
      top: 0;
      right: 0;
      width: 4px;
      min-height: 24px;
      border-radius: 999px;
      background: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, .62));
      transform: translateY(0);
    }
    .result-card-pre.has-diff {
      color: color-mix(in srgb, var(--vscode-editor-foreground, var(--lcpr-workbench-fg)) 84%, var(--vscode-errorForeground, #d1242f) 16%);
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
      border: 1px solid color-mix(in srgb, var(--lcpr-workbench-border) 58%, transparent);
      border-radius: 8px;
      background: var(--lcpr-workbench-card-bg);
    }
    .result-summary-card .result-status {
      font-size: 18px;
      line-height: 1.25;
    }
    .result-summary-case {
      min-width: 0;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--lcpr-workbench-fg);
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
      color: var(--lcpr-workbench-muted);
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
      color: var(--lcpr-workbench-fg);
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
      background: var(--tone, var(--lcpr-workbench-muted));
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
      border: 1px solid var(--lcpr-workbench-border);
      border-radius: 4px;
      background: var(--lcpr-workbench-card-bg);
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
      color: var(--lcpr-workbench-muted);
      font-size: 10px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .performance-value {
      flex: 0 0 auto;
      color: var(--lcpr-workbench-fg);
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
      border-bottom: 1px solid var(--lcpr-workbench-border);
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
      color: var(--lcpr-workbench-muted);
      font-size: 9px;
      font-family: var(--vscode-editor-font-family);
    }
    .performance-note {
      display: none;
      margin-top: 5px;
      color: var(--lcpr-workbench-muted);
      font-size: 10px;
    }
    .performance-strip {
      position: relative;
      height: 10px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--lcpr-workbench-bg);
      border: 1px solid var(--lcpr-workbench-border);
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
      color: var(--lcpr-workbench-muted);
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
      color: var(--lcpr-workbench-muted);
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
    .result-pre.has-diff {
      color: color-mix(in srgb, var(--vscode-editor-foreground) 86%, var(--vscode-errorForeground, #d1242f) 14%);
    }
    .result-diff {
      color: var(--vscode-errorForeground, var(--vscode-testing-iconFailed, #d1242f));
      background: color-mix(in srgb, var(--vscode-errorForeground, #d1242f) 13%, transparent);
      border-radius: 3px;
      padding: 0 2px;
      font-weight: 650;
    }
    .visualize {
      border-top: 1px solid var(--lcpr-workbench-border);
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
      color: var(--lcpr-workbench-muted);
      background: transparent;
      cursor: pointer;
    }
    .visualize-actions button:hover:not(:disabled), .visualize-debug-actions button:hover:not(:disabled) {
      background: var(--lcpr-workbench-hover);
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
      color: var(--lcpr-workbench-muted);
      font-size: 11px;
    }
    .visualize-step {
      padding: 8px 9px;
      border: 1px solid var(--lcpr-workbench-border);
      border-radius: 4px;
      background: var(--lcpr-workbench-input);
    }
    .visualize-title {
      margin: 0 0 5px;
      color: var(--lcpr-workbench-fg);
      font-size: 13px;
      line-height: 1.35;
      font-weight: 600;
    }
    .visualize-text {
      margin: 0;
      color: var(--lcpr-workbench-fg);
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
      color: var(--lcpr-workbench-fg);
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
      color: var(--lcpr-workbench-muted);
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
      color: var(--lcpr-workbench-muted);
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
      border: 1px solid var(--lcpr-workbench-border);
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
      color: var(--lcpr-workbench-muted);
      font-size: 10px;
      line-height: 14px;
    }
    .scene-map {
      border: 1px solid var(--lcpr-workbench-border);
      border-radius: 4px;
      overflow: hidden;
      background: var(--lcpr-workbench-input);
    }
    .scene-map-title {
      padding: 5px 7px;
      color: var(--lcpr-workbench-muted);
      border-bottom: 1px solid var(--lcpr-workbench-border);
      font-size: 11px;
      font-weight: 600;
    }
    .scene-map-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(70px, 1fr));
      gap: 1px;
      background: var(--lcpr-workbench-border);
    }
    .scene-map-item {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      min-width: 0;
      padding: 5px 7px;
      color: var(--lcpr-workbench-fg);
      background: var(--lcpr-workbench-input);
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
      color: var(--lcpr-workbench-muted);
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
    .debug-visual {
      margin-top: 0;
      padding: 0;
    }
    .debug-theme-selector {
      display: flex;
      justify-content: flex-end;
      gap: 4px;
      margin: 0 0 4px;
    }
    .debug-theme-selector button {
      height: 22px;
      padding: 0 7px;
      border: 1px solid color-mix(in srgb, var(--lcpr-workbench-border) 80%, transparent);
      border-radius: 3px;
      color: var(--lcpr-workbench-muted);
      background: transparent;
      cursor: pointer;
      font-size: 11px;
      line-height: 20px;
    }
    .debug-theme-selector button:hover,
    .debug-theme-selector button.active {
      color: var(--lcpr-workbench-fg);
      background: var(--lcpr-workbench-hover);
    }
    .debug-visual-warnings {
      display: grid;
      gap: 4px;
      margin-top: 5px;
      color: var(--vscode-editorWarning-foreground, var(--lcpr-workbench-muted));
      font-size: 10px;
      line-height: 1.4;
    }
    .debug-visual-vars {
      display: grid;
      gap: 10px;
    }
    .debug-var {
      min-width: 0;
      padding: 16px 18px;
      border: 0;
      border-radius: 8px;
      background: transparent;
    }
    .debug-var-layout {
      display: grid;
      gap: 12px;
      min-width: 0;
    }
    .debug-var-figure {
      min-width: 0;
      overflow: visible;
    }
    .debug-var-body {
      display: grid;
      grid-template-columns: minmax(0, 1fr) max-content;
      gap: 22px;
      align-items: start;
      min-width: 0;
    }
    .debug-var-head {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 9px 14px;
      margin-bottom: 8px;
    }
    .debug-var-name {
      min-width: 0;
      color: var(--lcpr-workbench-fg);
      font-weight: 700;
      font-size: 32px;
      letter-spacing: .02em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .debug-var-meta {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .debug-var-pill {
      max-width: min(360px, 50vw);
      padding: 0;
      border: 0;
      border-radius: 0;
      color: var(--lcpr-workbench-muted);
      background: transparent;
      font: 20px var(--vscode-editor-font-family);
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .debug-visual-footer {
      display: grid;
      gap: 4px;
      margin-top: 8px;
      padding-top: 7px;
      border-top: 1px solid color-mix(in srgb, var(--lcpr-workbench-border) 66%, transparent);
      min-width: 0;
    }
    .debug-source {
      display: flex;
      align-items: baseline;
      gap: 6px;
      color: var(--lcpr-workbench-muted);
      font-size: 10px;
      min-width: 0;
    }
    .debug-source strong {
      flex: 0 0 auto;
      color: var(--lcpr-workbench-muted);
      font-weight: 500;
    }
    .debug-source span {
      min-width: 0;
      color: var(--lcpr-workbench-fg);
      font: 10px var(--vscode-editor-font-family);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .debug-marker-legend {
      display: grid;
      align-content: start;
      gap: 8px;
      min-width: 96px;
      padding-top: 8px;
    }
    .debug-marker-legend-item {
      display: grid;
      grid-template-columns: 16px minmax(0, max-content);
      align-items: center;
      gap: 9px;
      min-width: 0;
      color: var(--lcpr-workbench-fg);
      font: 20px var(--vscode-editor-font-family);
      line-height: 1.2;
      white-space: nowrap;
    }
    .debug-legend-marker {
      width: 0;
      height: 0;
      border-top: 8px solid transparent;
      border-bottom: 8px solid transparent;
      border-left: 14px solid currentColor;
    }
    .debug-array {
      display: grid;
      grid-template-columns: repeat(var(--debug-cell-count, 1), minmax(76px, 1fr));
      width: 100%;
      min-width: max-content;
      gap: 8px;
      overflow-x: auto;
      padding-bottom: 30px;
    }
    .debug-grid {
      display: grid;
      gap: 8px;
      overflow-x: auto;
      padding: 34px 0 30px;
    }
    .debug-grid-row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 8px;
      align-items: start;
      min-width: 0;
    }
    .debug-grid-row.no-label {
      grid-template-columns: minmax(0, 1fr);
    }
    .debug-grid-label {
      flex: 0 0 auto;
      min-width: 28px;
      padding-top: 22px;
      color: var(--lcpr-workbench-muted);
      font-size: 10px;
    }
    .debug-grid-cells {
      display: grid;
      grid-template-columns: repeat(var(--debug-cell-count, 1), minmax(76px, 1fr));
      width: 100%;
      min-width: max-content;
      gap: 8px;
    }
    .debug-cell {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 76px;
      min-height: 94px;
      border: 2px solid color-mix(in srgb, #d6a117 88%, var(--vscode-editor-foreground) 12%);
      border-radius: 16px;
      background: var(--vscode-editor-background);
      overflow: visible;
      text-align: center;
    }
    .debug-cell.in-range {
      background: color-mix(in srgb, #ffe08a 34%, var(--vscode-editor-background) 66%);
    }
    .debug-cell > strong {
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 0;
      min-height: 70px;
      padding: 12px 8px;
      color: var(--vscode-editor-foreground);
      font: 30px var(--vscode-editor-font-family);
      line-height: 1.15;
    }
    .debug-cell > span {
      position: absolute;
      left: 0;
      right: 0;
      top: calc(100% + 9px);
      display: block;
      padding: 0 5px;
      color: var(--lcpr-workbench-muted);
      border-top: 0;
      font-size: 18px;
      line-height: 1.2;
    }
    .debug-markers {
      position: absolute;
      left: 50%;
      top: -31px;
      display: flex;
      gap: 2px;
      transform: translateX(-50%);
      white-space: nowrap;
    }
    .debug-marker {
      position: relative;
      width: 24px;
      height: 24px;
      padding: 0;
      border: 0;
      color: var(--vscode-button-background);
      background: transparent;
      overflow: visible;
    }
    .debug-marker::before {
      content: none;
    }
    .debug-marker::after {
      content: "";
      position: absolute;
      left: 50%;
      top: 0;
      width: 0;
      height: 0;
      border-left: 10px solid transparent;
      border-right: 10px solid transparent;
      border-top: 16px solid currentColor;
      transform: translateX(-50%);
    }
    .debug-marker-text {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
    .debug-marker-svg {
      display: none;
    }
    .debug-visual.theme-two {
      --debug-two-blue: #2f80ff;
      --debug-two-fill: #e1edff;
      --debug-two-grid: #9a9a9a;
      --debug-two-ink: #050505;
      --debug-two-muted: #8b8b8b;
      --debug-two-cell: 50px;
      margin: 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      color: var(--debug-two-ink);
      background: transparent;
    }
    .debug-visual.theme-two .debug-theme-selector {
      margin: 0 0 4px;
    }
    .debug-visual.theme-two .debug-theme-selector button {
      height: 20px;
      padding: 0 7px;
      border-color: #d8d8d8;
      color: #747474;
      background: #ffffff;
      font-size: 11px;
      line-height: 18px;
    }
    .debug-visual.theme-two .debug-theme-selector button:hover,
    .debug-visual.theme-two .debug-theme-selector button.active {
      border-color: var(--debug-two-blue);
      color: var(--debug-two-blue);
      background: #eef5ff;
    }
    .debug-visual.theme-two .debug-var {
      padding: 25px 26px 28px;
      border: 1px solid #d9dce2;
      border-radius: 0;
      background: #ffffff;
    }
    .debug-visual.theme-two .debug-var-layout {
      display: grid;
      grid-template-columns: max-content minmax(145px, 210px);
      gap: 20px;
      align-items: center;
      justify-content: start;
      min-width: 0;
    }
    .debug-visual.theme-two .debug-var-main {
      min-width: 0;
      overflow-x: visible;
    }
    .debug-visual.theme-two .debug-var-head {
      align-items: flex-end;
      gap: 5px;
      margin: 0 0 6px;
    }
    .debug-visual.theme-two .debug-var-name {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--debug-two-ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 26px;
      font-weight: 500;
      line-height: 1;
      letter-spacing: 0;
    }
    .debug-visual.theme-two .debug-var-name::before {
      content: "";
      flex: 0 0 auto;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--debug-two-ink);
    }
    .debug-visual.theme-two .debug-var-meta {
      gap: 5px;
      align-items: flex-end;
    }
    .debug-visual.theme-two .debug-var-pill {
      max-width: none;
      color: #6e6e6e;
      font: 12px var(--vscode-editor-font-family);
      line-height: 1;
      margin-bottom: 3px;
    }
    .debug-visual.theme-two .debug-var-pill:not(:first-child) {
      display: none;
    }
    .debug-visual.theme-two .debug-var-body {
      display: block;
    }
    .debug-visual.theme-two .debug-marker-legend {
      display: none;
    }
    .debug-visual.theme-two .debug-grid,
    .debug-visual.theme-two .debug-array {
      gap: 0;
      padding: 0 0 22px;
      overflow-x: auto;
    }
    .debug-visual.theme-two .debug-grid-cells,
    .debug-visual.theme-two .debug-array {
      grid-template-columns: repeat(var(--debug-cell-count, 1), var(--debug-two-cell));
      gap: 0;
      width: max-content;
      min-width: 0;
    }
    .debug-visual.theme-two .debug-grid-row,
    .debug-visual.theme-two .debug-grid-row.no-label {
      display: block;
    }
    .debug-visual.theme-two .debug-grid-label {
      display: none;
    }
    .debug-visual.theme-two .debug-cell {
      width: var(--debug-two-cell);
      height: var(--debug-two-cell);
      min-width: 0;
      min-height: 0;
      border: 1px solid var(--debug-two-grid);
      border-left-width: 0;
      border-radius: 0;
      background: transparent;
      color: var(--debug-two-ink);
    }
    .debug-visual.theme-two .debug-cell:first-child {
      border-left-width: 1px;
      border-top-left-radius: 5px;
      border-bottom-left-radius: 5px;
    }
    .debug-visual.theme-two .debug-cell:last-child {
      border-top-right-radius: 5px;
      border-bottom-right-radius: 5px;
    }
    .debug-visual.theme-two .debug-cell.in-range {
      border-top-color: var(--debug-two-blue);
      border-bottom-color: var(--debug-two-blue);
      background: var(--debug-two-fill);
    }
    .debug-visual.theme-two .debug-cell.range-start {
      border-left-width: 1px;
      border-left-color: var(--debug-two-blue);
    }
    .debug-visual.theme-two .debug-cell.range-end {
      border-right-color: var(--debug-two-blue);
    }
    .debug-visual.theme-two .debug-cell.range-start::before,
    .debug-visual.theme-two .debug-cell.range-end::after {
      content: "";
      position: absolute;
      top: -1px;
      bottom: -1px;
      z-index: 1;
      width: 0;
      border-left: 2px solid var(--debug-two-blue);
      pointer-events: none;
    }
    .debug-visual.theme-two .debug-cell.range-start::before {
      left: -1px;
    }
    .debug-visual.theme-two .debug-cell.range-end::after {
      right: -1px;
    }
    .debug-visual.theme-two .debug-cell > strong {
      min-height: 0;
      padding: 10px 4px 2px;
      color: var(--debug-two-ink);
      font: 23px var(--vscode-editor-font-family);
      line-height: 1;
    }
    .debug-visual.theme-two .debug-cell > span {
      top: calc(100% + 7px);
      color: var(--debug-two-muted);
      font: 11px var(--vscode-editor-font-family);
      line-height: 1;
    }
    .debug-visual.theme-two .debug-cell > span::before {
      content: "[" attr(data-index) "]";
    }
    .debug-visual.theme-two .debug-cell > span {
      font-size: 0;
    }
    .debug-visual.theme-two .debug-cell > span::before {
      font-size: 11px;
    }
    .debug-visual.theme-two .debug-markers {
      left: 0;
      top: 4px;
      z-index: 2;
      display: flex;
      flex-wrap: wrap;
      gap: 2px;
      max-width: calc(100% - 4px);
      transform: translateX(0);
    }
    .debug-visual.theme-two .debug-marker {
      width: 29px;
      height: 14px;
      color: var(--debug-two-blue) !important;
      background: transparent;
      border: 0;
      clip-path: none;
    }
    .debug-visual.theme-two .debug-marker::before,
    .debug-visual.theme-two .debug-marker::after {
      content: none;
    }
    .debug-visual.theme-two .debug-marker-text {
      display: none;
    }
    .debug-visual.theme-two .debug-marker-svg {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .debug-visual.theme-two .debug-source-panel {
      align-self: stretch;
      min-width: 0;
      padding: 16px 0 13px 20px;
      border-left: 1px solid #d9d9d9;
      color: var(--debug-two-ink);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .debug-visual.theme-two .debug-source-title {
      margin-bottom: 8px;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.2;
    }
    .debug-visual.theme-two .debug-source-lines {
      display: grid;
      gap: 6px;
      color: #101010;
      font-size: 11px;
      line-height: 1.4;
      max-width: 100%;
      overflow: hidden;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .debug-visual.theme-two .debug-source-line {
      min-width: 0;
      max-width: 100%;
      overflow-wrap: anywhere;
    }
    .debug-visual.theme-two .debug-source-detail {
      color: #6f6f6f;
      font: 10px var(--vscode-editor-font-family);
      overflow-wrap: anywhere;
    }
    .debug-visual.theme-two .debug-visual-footer {
      margin-top: 6px;
      border-top-color: #dedede;
    }
    .debug-visual.theme-two .debug-source,
    .debug-visual.theme-two .debug-source strong,
    .debug-visual.theme-two .debug-source span,
    .debug-visual.theme-two .debug-visual-warnings {
      color: #777777;
    }
    .debug-list {
      display: flex;
      align-items: center;
      gap: 5px;
      overflow-x: auto;
    }
    .debug-list-node,
    .debug-graph-node {
      flex: 0 0 auto;
      min-width: 32px;
      padding: 6px 8px;
      border: 1px solid var(--lcpr-workbench-border);
      border-radius: 4px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-editor-font-family);
      text-align: center;
    }
    .debug-arrow {
      color: var(--lcpr-workbench-muted);
    }
    .debug-object {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
      gap: 4px;
    }
    .debug-object div {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      min-width: 0;
      padding: 5px 6px;
      border: 1px solid var(--lcpr-workbench-border);
      border-radius: 3px;
      font: 11px var(--vscode-editor-font-family);
    }
    .debug-object span,
    .debug-object strong {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .debug-graph {
      display: grid;
      gap: 6px;
    }
    .debug-graph-nodes {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .debug-edges {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
      color: var(--lcpr-workbench-muted);
      font-size: 10px;
    }
    @media (max-width: 560px) {
      .debug-var-body {
        grid-template-columns: 1fr;
      }
      .debug-marker-legend {
        display: flex;
        flex-wrap: wrap;
        gap: 6px 14px;
        padding-top: 0;
      }
      .debug-grid {
        padding-top: 28px;
      }
      .debug-cell {
        min-width: 58px;
        min-height: 76px;
        border-radius: 12px;
      }
      .debug-cell > strong {
        min-height: 56px;
        font-size: 22px;
      }
      .debug-var-name {
        font-size: 24px;
      }
      .debug-var-pill,
      .debug-marker-legend-item {
        font-size: 14px;
      }
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
    @media (max-width: 760px) {
      .result-card-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 680px) {
      .performance-grid {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 560px) {
      .result-card-grid {
        grid-template-columns: 1fr;
      }
    }
    .empty {
      padding: 18px 12px;
      color: var(--lcpr-workbench-muted);
    }
    .result-pane .empty {
      padding: 6px var(--panel-pad-x) 14px;
      font-size: 13px;
      line-height: 1.45;
    }
    .list {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-items: start;
      gap: 8px;
      padding: 8px 10px 10px calc(10px - var(--workspace-divider-visual-offset));
    }
    .list.is-multicolumn {
      grid-template-columns: repeat(var(--case-columns, 2), minmax(0, 1fr));
    }
    .case {
      position: relative;
      min-width: 0;
      margin: 0;
      padding: 6px 8px 6px 12px;
      border: 1px solid var(--lcpr-workbench-soft-border);
      border-radius: 5px;
      background: var(--lcpr-workbench-card-bg);
      overflow: hidden;
    }
    .case::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 4px;
      border-radius: 4px 0 0 4px;
      background: var(--lcpr-case-idle-strip);
      opacity: 1;
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
      column-gap: 6px;
      min-height: 20px;
      padding: 0 0 4px;
    }
    .case-title {
      min-width: 0;
      color: var(--lcpr-workbench-fg);
      font-weight: 700;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum" 1;
      line-height: 1.2;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .case-title-button,
    .case-title-input {
      width: 100%;
      min-width: 0;
      border-radius: 6px;
      font: inherit;
    }
    .case-title-button {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 2px 6px;
      border: 0;
      color: inherit;
      background: transparent;
      text-align: left;
      cursor: text;
    }
    .case-title-text {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .case-title-display {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 5px;
      width: 100%;
      min-width: 0;
    }
    .case-title-display .case-title-button {
      flex: 0 1 auto;
      width: auto;
    }
    .case-title-edit {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
    }
    .case-title-edit .case-title-input {
      flex: 0 1 120px;
      width: min(120px, 100%);
    }
    .case-default-badge {
      flex: 0 0 auto;
      padding: 0 4px;
      border: 1px solid var(--lcpr-workbench-soft-border);
      border-radius: 999px;
      color: var(--lcpr-workbench-muted);
      background: var(--lcpr-workbench-soft-bg);
      font-size: 10px;
      font-weight: 600;
      line-height: 14px;
    }
    .case-title-button:hover {
      background: var(--lcpr-workbench-hover);
    }
    .case-title-button:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 1px;
    }
    .case-title-input {
      padding: 1px 6px;
      border: 1px solid var(--vscode-focusBorder);
      color: var(--lcpr-workbench-fg);
      background: var(--lcpr-workbench-bg);
    }
    .case-title-input:focus {
      outline: none;
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder) 55%, transparent);
    }
    .case-title-input.is-invalid,
    .case-title-input[aria-invalid="true"] {
      border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-testing-iconFailed, #d1242f));
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-inputValidation-errorBorder, #d1242f) 55%, transparent);
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
      width: 15px;
      height: 15px;
      padding: 0;
      border: 0;
      border-radius: 3px;
      color: var(--lcpr-workbench-muted);
      background: transparent;
      line-height: 1;
    }
    .case-actions button:hover {
      color: var(--lcpr-workbench-fg);
      background: var(--lcpr-workbench-hover);
    }
    .case-actions button:disabled,
    .case-add-button:disabled {
      color: var(--lcpr-toolbar-disabled-fg);
      background: transparent;
      cursor: default;
      opacity: 0.55;
    }
    .case-actions button:disabled:hover,
    .case-add-button:disabled:hover {
      color: var(--lcpr-toolbar-disabled-fg);
      background: transparent;
    }
    .case-actions button:active {
      color: var(--lcpr-workbench-fg);
      background: var(--vscode-toolbar-activeBackground, var(--lcpr-workbench-hover));
    }
    .case-actions svg {
      width: 15px;
      height: 15px;
      display: block;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.85;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .case-editor {
      position: relative;
      padding: 0;
    }
    .case-scrollbar {
      display: block;
      position: absolute;
      top: 5px;
      right: 3px;
      bottom: 5px;
      width: 4px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 120ms ease;
    }
    .case-editor.is-scrolling .case-scrollbar {
      opacity: 1;
    }
    .case-scrollbar-thumb {
      position: absolute;
      top: 0;
      right: 0;
      width: 4px;
      min-height: 24px;
      border-radius: 999px;
      background: var(--vscode-scrollbarSlider-background, rgba(121, 121, 121, .62));
      transform: translateY(0);
    }
    .case-add-row {
      display: flex;
      grid-column: 1 / -1;
      justify-content: center;
      padding: 4px 0 0;
    }
    .case-add-button {
      display: inline-grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border: 1px solid var(--lcpr-workbench-soft-border);
      border-radius: 50%;
      color: var(--lcpr-workbench-muted);
      background: var(--lcpr-workbench-card-bg);
      cursor: pointer;
    }
    .case-add-button:hover {
      color: var(--lcpr-workbench-fg);
      background: var(--lcpr-workbench-hover);
    }
    .case-add-button svg {
      width: 18px;
      height: 18px;
      display: block;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.85;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    textarea {
      width: 100%;
      height: 30px;
      min-height: 30px;
      max-height: 144px;
      resize: none;
      overflow: hidden;
      scrollbar-width: none;
      padding: 6px 8px;
      color: var(--vscode-input-foreground, var(--lcpr-workbench-fg));
      background: var(--lcpr-workbench-case-editor-bg);
      border: 1px solid var(--lcpr-workbench-case-editor-border);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      line-height: 1.35;
      outline: none;
    }
    textarea::-webkit-scrollbar {
      width: 0;
      height: 0;
    }
    textarea:focus {
      border-color: var(--vscode-focusBorder, var(--lcpr-focus-gray));
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
        min-height: 46px;
        padding-top: 6px;
        padding-bottom: 6px;
      }
      .problem-title {
        width: min(58vw, 360px);
        padding: 0 6px;
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
      .workspace-snap-target {
        display: none;
      }
      .workspace-resizer {
        display: none;
      }
      .result-pane {
        overflow: visible;
        border-top: 1px solid var(--lcpr-workbench-frame-border);
      }
      .case-pane {
        overflow: visible;
      }
	      .list {
	        padding-right: var(--panel-pad-x);
	        padding-left: var(--panel-pad-x);
	      }
      .result-sticky {
        min-height: 0;
      }
    }
  </style>
</head>
<body>
  <div class="shell">
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
    <div id="workspace" class="workspace">
      <aside id="resultPane" class="result-pane">
        <div class="result-sticky">
          <div id="result"></div>
        </div>
      </aside>
      <div class="workspace-snap-target is-golden" aria-hidden="true" title="黄金分割位置"></div>
      <div class="workspace-snap-target is-default" aria-hidden="true" title="默认密集布局位置"></div>
      <div id="workspaceResizer" class="workspace-resizer" role="separator" aria-orientation="vertical" aria-label="调整左右分区大小" tabindex="0" aria-valuemin="45" aria-valuemax="78" aria-valuenow="66.7"></div>
      <section class="case-pane">
        <div id="content"></div>
      </section>
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    function storedDebugVisualTheme() {
      try {
        const value = localStorage.getItem('lcpr.debugVisualTheme');
        return value === 'theme-two' ? 'theme-two' : 'theme-one';
      } catch (_) {
        return 'theme-one';
      }
    }
    const WORKSPACE_SPLIT_KEY = 'lcpr.workbench.workspaceSplit';
    const WORKSPACE_SPLIT_VERSION_KEY = 'lcpr.workbench.workspaceSplitVersion';
    const WORKSPACE_SPLIT_VERSION = '2';
    const WORKSPACE_SPLIT_GOLDEN = 61.8;
    const WORKSPACE_SPLIT_DEFAULT = 66.7;
    const WORKSPACE_SPLIT_MIN = 45;
    const WORKSPACE_SPLIT_MAX = 78;
    const WORKSPACE_SPLIT_SNAP_PX = 24;
    const WORKSPACE_SPLIT_SNAP_TARGETS = [WORKSPACE_SPLIT_DEFAULT, WORKSPACE_SPLIT_GOLDEN];
    function clampWorkspaceSplit(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return WORKSPACE_SPLIT_DEFAULT;
      return Math.max(WORKSPACE_SPLIT_MIN, Math.min(WORKSPACE_SPLIT_MAX, number));
    }
    function readWorkspaceSplit() {
      try {
        const raw = localStorage.getItem(WORKSPACE_SPLIT_KEY);
        const version = localStorage.getItem(WORKSPACE_SPLIT_VERSION_KEY);
        const split = clampWorkspaceSplit(raw);
        if (version !== WORKSPACE_SPLIT_VERSION) {
          localStorage.setItem(WORKSPACE_SPLIT_VERSION_KEY, WORKSPACE_SPLIT_VERSION);
          return !raw || Math.abs(split - WORKSPACE_SPLIT_GOLDEN) < 0.05 ? WORKSPACE_SPLIT_DEFAULT : split;
        }
        return split;
      } catch (_) {
        return WORKSPACE_SPLIT_DEFAULT;
      }
    }
    function writeWorkspaceSplit(value) {
      try {
        localStorage.setItem(WORKSPACE_SPLIT_KEY, String(value));
        localStorage.setItem(WORKSPACE_SPLIT_VERSION_KEY, WORKSPACE_SPLIT_VERSION);
      } catch (_) {
        // Ignore webview storage failures.
      }
    }
    let state = { isLeetCodeFile: false, isLoggedIn: false, cases: [], activityExpanded: false, activityRange: 7, debugVisualTheme: storedDebugVisualTheme(), workspaceSplitRatio: readWorkspaceSplit() };
    let editingCaseIndex = -1;
    let editingCaseOriginalLabel = '';
    let editingCaseOriginalIsDefault = false;
    const content = document.getElementById('content');
    const casePane = document.querySelector('.case-pane');
    const file = document.getElementById('file');
    const resultEl = document.getElementById('result');
    const workspace = document.getElementById('workspace');
    const workspaceResizer = document.getElementById('workspaceResizer');
    const aiDebugToggle = document.getElementById('aiDebugToggle');
    const toolbarActionButtons = Array.from(document.querySelectorAll('.toolbar button[data-action], #refresh'));
	    let lastToolbarDisabled;
	    let lastVoidWorkbench;
	    let lastResultRenderKey = "";
	    let activeResultInputPopover;
	    let activeResultInputTarget;
	    let activeResultInputScrollTimer = 0;
	    let activeResultCardScrollWrap;
	    let activeResultCardScrollTimer = 0;
	    let activeCaseScrollEditor;
	    let activeCaseScrollTimer = 0;
	    let caseListLayoutFrame = 0;
	    const send = (message) => vscode.postMessage(message);
	    function applyWorkspaceSplit(ratio, persist = false) {
	      const split = clampWorkspaceSplit(ratio);
	      state.workspaceSplitRatio = split;
	      if (workspace) {
	        workspace.style.setProperty('--workspace-split', split.toFixed(1) + '%');
        workspace.style.setProperty('--workspace-default-snap-x', WORKSPACE_SPLIT_DEFAULT.toFixed(1) + '%');
        workspace.style.setProperty('--workspace-golden-snap-x', WORKSPACE_SPLIT_GOLDEN.toFixed(1) + '%');
      }
      if (workspaceResizer) {
        workspaceResizer.setAttribute('aria-valuenow', split.toFixed(1));
      }
      if (persist) {
        writeWorkspaceSplit(split);
	      }
	      vscode.setState(state);
	      requestAnimationFrame(syncResultInputOverflow);
	      scheduleCaseListLayout();
	      return split;
	    }
    function snapWorkspaceSplit(ratio) {
      const split = clampWorkspaceSplit(ratio);
      const workspaceRect = workspace && workspace.getBoundingClientRect();
      if (!workspaceRect || !workspaceRect.width) {
        return split;
      }
      const currentPx = workspaceRect.width * split / 100;
      const snapPx = Math.max(WORKSPACE_SPLIT_SNAP_PX, workspaceRect.width * 0.018);
      const nearest = WORKSPACE_SPLIT_SNAP_TARGETS
        .map((target) => ({
          target,
          distance: Math.abs(currentPx - workspaceRect.width * target / 100),
        }))
        .sort((a, b) => a.distance - b.distance)[0];
      return nearest && nearest.distance <= snapPx ? nearest.target : split;
    }
    function workspaceSplitFromClientX(clientX) {
      const workspaceRect = workspace && workspace.getBoundingClientRect();
      if (!workspaceRect || !workspaceRect.width) {
        return state.workspaceSplitRatio || WORKSPACE_SPLIT_DEFAULT;
      }
      return clampWorkspaceSplit(((clientX - workspaceRect.left) / workspaceRect.width) * 100);
    }
    function syncWorkspaceSplit() {
      applyWorkspaceSplit(state.workspaceSplitRatio || readWorkspaceSplit(), false);
    }
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
    function isDebugPayload(payload) {
      return !!(payload && (payload.action === 'debug' || payload.runMode === 'debug'));
    }
    function serverAccepted(payload) {
      const data = getResultData(payload);
      const sys = data.system_message || (payload && payload.submitEvent) || {};
      return sys.accepted === true;
    }
    function serverCaseVerdict(payload, index) {
      const data = getResultData(payload);
      const sys = data.system_message || (payload && payload.submitEvent) || {};
      if (serverAccepted(payload)) return 'Correct';
      const compareResult = sys.compare_result;
      if (compareResult === undefined || compareResult === null) return '';
      const marker = compareResult[index];
      if (marker === true || marker === 1 || marker === '1') return 'Correct';
      if (marker === false || marker === 0 || marker === '0') return 'Wrong Answer';
      return '';
    }
    function isPartialAllcaseResult(payload) {
      if (getMode(payload) !== '全部用例') return false;
      const data = getResultData(payload);
      const sys = data.system_message || (payload && payload.submitEvent) || {};
      const compareResult = sys.compare_result;
      if (compareResult === undefined || compareResult === null) return false;
      const markers = Array.isArray(compareResult) ? compareResult : String(compareResult).split('');
      const hasCorrect = markers.some((marker) => marker === true || marker === 1 || marker === '1');
      const hasWrong = markers.some((marker) => marker === false || marker === 0 || marker === '0');
      return hasCorrect && hasWrong;
    }
    function getStatus(payload) {
      if (!payload) return '';
      if (payload.phase === 'running') return '运行中';
      const data = getResultData(payload);
      const sys = data.system_message || payload.submitEvent || {};
      const statusCode = Number(data.statusCode || data.status_code || sys.statusCode || sys.status_code || 0);
      const msg = asLines(data.msg || data.message || data.error || data.messages).join(' ').toLowerCase();
      if (statusCode >= 400 || /http error|too many requests|rate limit|429/.test(msg)) return '请求失败';
      if (serverAccepted(payload)) return 'Accepted';
      if (isPartialAllcaseResult(payload)) return '部分错误';
      const serverStatus = asLines(data.messages)[0] || sys.status || '';
      if (sys.accepted === false && /^(accepted|finished|correct)$/i.test(serverStatus)) return 'Wrong Answer';
      if (!serverStatus || /^error$/i.test(serverStatus)) return '服务端错误';
      return serverStatus;
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
      if (status === '部分错误' || /time limit|memory limit|output limit|exceeded/.test(status)) return 'tone-warning';
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
	      if (payload && (payload.action === 'debug' || payload.runMode === 'debug')) {
	        return '';
	      }
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
	    function displayResultValue(value) {
	      return String(value === undefined || value === null ? '' : value).trim();
	    }
	    function caseLabelForPayload(payload) {
	      const active = normalizeCaseValue(payload && payload.activeTestCase);
	      const matchIndex = active ? state.cases.findIndex((testCase) => normalizeCaseValue(testCase && testCase.value) === active) : -1;
	      if (matchIndex >= 0) {
	        return state.cases[matchIndex].label || ('用例 ' + (matchIndex + 1));
	      }
	      return '用例 1';
	    }
	    function resultDetailCards(payload) {
	      const data = getResultData(payload);
	      const output = sectionValue(data, ['Answer', 'Output']);
	      const expected = sectionValue(data, ['Expected Answer', 'Expected Output', 'Expected']);
	      if (!output && !expected) {
	        return [];
	      }
	      const mode = getMode(payload);
	      if (mode === '全部用例') {
	        const storedCases = Array.isArray(state.cases) ? state.cases : [];
	        const inputRows = splitAllcaseRows(sectionValue(data, ['Your Input', 'Input', 'Testcase', 'Last Testcase']));
	        const outputRows = splitAllcaseRows(output);
	        const expectedRows = splitAllcaseRows(expected);
	        const sourceCases = storedCases.length
	          ? storedCases
	          : outputRows.map((_, index) => ({ label: '用例 ' + (index + 1), value: inputRows[index] || '' }));
	        return sourceCases.map((testCase, index) => {
	          let resultIndex = allcaseIndexForCase(testCase, index, inputRows, sourceCases);
	          if (resultIndex < 0 && outputRows.length === expectedRows.length && outputRows.length === sourceCases.length) {
	            resultIndex = index;
	          }
	          const outputValue = resultIndex >= 0 ? outputRows[resultIndex] || '' : '';
	          const expectedValue = resultIndex >= 0 ? expectedRows[resultIndex] || '' : '';
	          const verdict = allcaseVerdictForCase(testCase, index, payload);
	          return {
	            label: testCase.label || ('用例 ' + (index + 1)),
	            input: displayResultValue((testCase && testCase.value) || inputRows[resultIndex >= 0 ? resultIndex : index] || ''),
	            output: displayResultValue(outputValue),
	            expected: displayResultValue(expectedValue),
	            verdict,
	          };
	        }).filter((card) => card.input || card.output || card.expected);
	      }
	      return [{
	        label: caseLabelForPayload(payload),
	        input: displayResultValue(sectionValue(data, ['Your Input', 'Input', 'Testcase', 'Last Testcase']) || payload.activeTestCase || firstVisibleCaseValue()),
	        output: displayResultValue(output),
	        expected: displayResultValue(expected),
	        verdict: caseVerdict(payload),
	      }].filter((card) => card.input || card.output || card.expected);
	    }
	    function detailCardTone(card, payload) {
	      if (card && card.verdict === 'Correct') return 'result-card-pass';
	      if (card && card.verdict === 'Wrong Answer') return 'result-card-fail';
	      if (getMode(payload) === '全部用例') return 'result-card-neutral';
	      const tone = getTone(payload);
	      if (tone === 'tone-success') return 'result-card-pass';
	      if (tone === 'tone-danger') return 'result-card-fail';
	      return 'result-card-neutral';
	    }
		    function renderResultCardPin(index) {
		      return '<button type="button" class="result-card-pin" data-pin-result-case="' + index + '" title="置顶用例" aria-label="置顶用例">' + icon('bookmark') + '</button>';
		    }
		    function renderResultCardBlock(label, value, comparable, extraClass) {
		      const rendered = comparable ? renderLeetCodeDiffValue(value) : { html: escapeHtml(value), hasDiff: false };
		      const html = rendered.html || '&nbsp;';
		      const classes = 'result-card-pre' + (extraClass ? ' ' + extraClass : '') + (rendered.hasDiff ? ' has-diff' : '');
		      const inputAttrs = extraClass === 'is-input' ? ' tabindex="0" role="button" aria-label="点击查看完整输入"' : '';
		      const body = extraClass === 'is-input'
		        ? '<pre class="' + classes + '"' + inputAttrs + '>' + html + '</pre>'
		        : '<div class="result-card-pre-wrap"><pre class="' + classes + '"' + inputAttrs + '>' + html + '</pre><span class="result-card-scrollbar" aria-hidden="true"><span class="result-card-scrollbar-thumb"></span></span></div>';
			      return '<section class="result-card-block"><div class="result-card-meta"><span class="result-card-label">' + escapeHtml(label) + '</span></div>' + body + '</section>';
		    }
		    function renderResultDetailCard(card, index, payload) {
		      const titleText = card && card.label ? card.label : ('用例 ' + (index + 1));
		      const label = titleText ? ' title="' + escapeHtml(titleText) + '"' : '';
		      return '<article class="result-card ' + detailCardTone(card, payload) + '"' + label + '><div class="result-card-body">' +
		        '<div class="result-card-header"><div class="result-card-title">' + escapeHtml(titleText) + '</div>' + renderResultCardPin(index) + '</div>' +
		        '<section class="result-card-input">' + renderResultCardBlock('输入', card && card.input || '', false, 'is-input') + '</section>' +
		        '<div class="result-card-comparison">' +
		          renderResultCardBlock('输出', card && card.output || '', true, '') +
		          renderResultCardBlock('期望', card && card.expected || '', true, '') +
	        '</div>' +
	      '</div></article>';
	    }
	    function renderResultComparison(payload) {
	      const cards = resultDetailCards(payload);
	      if (!cards.length) {
	        return '';
	      }
	      return '<section class="result-comparison"><div class="result-hero"><h2 class="result-status">' + escapeHtml(zhStatus(getStatus(payload))) + '</h2></div><div class="result-card-grid">' + cards.map((card, index) => renderResultDetailCard(card, index, payload)).join('') + '</div></section>';
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
    function renderLeetCodeDiffValue(value) {
      const text = String(value === undefined || value === null ? '' : value);
      const pattern = /__\\s*\`([^]*?)\`\\s*__|__(?!_)([^]*?)(?<!_)__/g;
      let hasDiff = false;
      let cursor = 0;
      let html = '';
      text.replace(pattern, (match, codeDiff, textDiff, offset) => {
        const inner = codeDiff || textDiff || '';
        if (!String(inner).length) return match;
        hasDiff = true;
        html += escapeHtml(text.slice(cursor, offset));
        html += '<span class="result-diff">' + escapeHtml(inner) + '</span>';
        cursor = offset + match.length;
        return match;
      });
      if (hasDiff) {
        html += escapeHtml(text.slice(cursor));
        return { html, hasDiff };
      }
      return { html: escapeHtml(text), hasDiff: false };
    }
    function renderDiagnosticValue(key, value) {
      const comparable = isOutputKey(key) || isExpectedKey(key);
      const rendered = comparable ? renderLeetCodeDiffValue(value) : { html: escapeHtml(value), hasDiff: false };
      return '<pre class="result-pre' + (rendered.hasDiff ? ' has-diff' : '') + '">' + rendered.html + '</pre>';
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
        return '<section class="result-section' + wide + '"><h3 class="result-section-title">' + escapeHtml(sectionLabel(key)) + '</h3>' + renderDiagnosticValue(key, value) + '</section>';
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
      const sys = data.system_message || (payload && payload.submitEvent) || {};
      const inputRows = splitAllcaseRows(sectionValue(data, ['Your Input', 'Input', 'Testcase', 'Last Testcase']));
      if (serverAccepted(payload)) return 'Correct';
      let resultIndex = allcaseIndexForCase(testCase, index, inputRows, state.cases);
      if (resultIndex < 0 && sys.compare_result && sys.compare_result.length === state.cases.length) {
        resultIndex = index;
      }
      if (resultIndex < 0) return '';
      return serverCaseVerdict(payload, resultIndex);
    }
    function caseVerdict(payload) {
      if (!payload || payload.phase === 'running' || !isCaseResult(payload)) return '';
      const serverVerdict = serverCaseVerdict(payload, 0);
      if (serverVerdict) return serverVerdict;
      if (getMode(payload) === '全部用例') return '';
      return /^wrong answer$/i.test(getStatus(payload)) ? 'Wrong Answer' : '';
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
      if (getStatus(payload) === '服务端错误') return '';
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
    function activityDays(activity) {
      const range = Number(state.activityRange || 7);
      return ((activity && Array.isArray(activity.days)) ? activity.days : [])
        .filter((day) => day && day.date)
        .slice()
        .sort((a, b) => {
          const left = Number(a.timestamp || Date.parse(String(a.date) + 'T00:00:00Z') / 1000);
          const right = Number(b.timestamp || Date.parse(String(b.date) + 'T00:00:00Z') / 1000);
          if (!Number.isFinite(left) || !Number.isFinite(right)) return String(a.date).localeCompare(String(b.date));
          return left - right;
        })
        .slice(-range);
    }
    function activityLevel(count, maxCount) {
      const value = Number(count || 0);
      if (value <= 0) return 0;
      const max = Math.max(Number(maxCount || 0), 1);
      const ratio = value / max;
      if (ratio <= .25) return 1;
      if (ratio <= .5) return 2;
      if (ratio <= .75) return 3;
      return 4;
    }
    function activityStartOffset(days) {
      if (!days.length) return 0;
      const value = new Date(String(days[0].date) + 'T00:00:00Z');
      if (Number.isNaN(value.getTime())) return 0;
      return (value.getUTCDay() + 6) % 7;
    }
    function renderActivityGrid(days, range) {
      const maxCount = Math.max(...days.map((day) => Number(day.count || 0)), 1);
      const pads = Number(range) === 365 ? Array.from({ length: activityStartOffset(days) }, () => '<span class="activity-pad"></span>').join('') : '';
      const cells = days.map((day) => {
        const count = Number(day.count || 0);
        const level = activityLevel(count, maxCount);
        const title = day.date + '：' + count + ' 次';
        return '<span class="activity-day activity-l' + level + '" title="' + escapeHtml(title) + '"></span>';
      }).join('');
      return pads + cells;
    }
    function rangeLabel(value) {
      if (Number(value) === 365) return '近一年';
      if (Number(value) === 30) return '近一月';
      return '近一周';
    }
    function renderRangeButton(value) {
      const active = Number(state.activityRange || 7) === Number(value);
      return '<button type="button" class="' + (active ? 'active' : '') + '" data-activity-range="' + value + '">' + rangeLabel(value) + '</button>';
    }
    function renderActivityTip() {
      const activity = state.activity || {};
      const days = activityDays(activity);
      if (!days.length && activity.status !== 'loading') return '';
      if (activity.status === 'loading') {
        return '<div class="activity-tip"><button class="activity-trigger" data-toggle-activity>打卡加载中</button></div>';
      }
      const activeDays = days.filter((day) => Number(day.count || 0) > 0).length;
      const streak = Number(activity.recentStreak || activity.streak || 0);
      const today = days[days.length - 1] || {};
      const todayCount = Number(today.count || 0);
      const range = Number(state.activityRange || 7);
      const rangeClass = range === 365 ? 'range-year' : (range === 30 ? 'range-month' : 'range-week');
      const trigger = '<button type="button" class="activity-trigger" data-toggle-activity title="显示打卡热力图">' + rangeLabel(range) + ' <strong>' + activeDays + '</strong> 天 · 连续 <strong>' + streak + '</strong> 天 · 今日 <strong>' + todayCount + '</strong> 提交</button>';
      if (!state.activityExpanded) {
        return '<div class="activity-tip">' + trigger + '</div>';
      }
      const popover = '<div class="activity-popover">' +
        '<div class="activity-range">' + renderRangeButton(7) + renderRangeButton(30) + renderRangeButton(365) + '</div>' +
        '<div class="activity-grid ' + rangeClass + '">' + renderActivityGrid(days, range) + '</div>' +
        '<div class="activity-summary"><span>活跃 <strong>' + activeDays + '</strong> 天</span></div>' +
      '</div>';
      return '<div class="activity-tip">' + popover + trigger + '</div>';
    }
    function renderActivityStatus(tone, label, message) {
      return '<div class="result-header ' + tone + '"><span class="result-dot"></span><span>' + escapeHtml(label) + '</span></div><div class="result-body ' + tone + '"><div class="result-waiting">' + escapeHtml(message) + '</div></div>' + renderActivityTip();
    }
    function debugMarkerName(marker) {
      return String(marker && (marker.label || marker.id || '') || '');
    }
    function debugMarkerKey(marker) {
      return debugMarkerName(marker).toLowerCase();
    }
    function debugMarkerClass(marker) {
      const key = debugMarkerKey(marker);
      if (/^(left|start|begin|slow|lo|l)$/.test(key)) return ' debug-marker-left';
      if (/^(mid|middle|m)$/.test(key)) return ' debug-marker-mid';
      if (/^(right|end|fast|hi|r)$/.test(key)) return ' debug-marker-right';
      return '';
    }
    function debugMarkerShortName(marker) {
      const key = debugMarkerKey(marker);
      if (/^(left|start|begin|slow|lo|l)$/.test(key)) return 'L';
      if (/^(mid|middle|m)$/.test(key)) return 'M';
      if (/^(right|end|fast|hi|r)$/.test(key)) return 'R';
      const name = debugMarkerName(marker);
      return name ? name.slice(0, 1).toUpperCase() : '';
    }
    function renderDebugMarkerSvg(marker) {
      const label = debugMarkerShortName(marker);
      const isMid = /^(mid|middle|m)$/.test(debugMarkerKey(marker));
      const fill = isMid ? 'currentColor' : '#ffffff';
      const textFill = isMid ? '#ffffff' : 'currentColor';
      return '<svg class="debug-marker-svg" viewBox="0 0 50 24" aria-hidden="true" focusable="false">' +
        '<path d="M4 1 H32 Q35 1 37 3 L48 12 L37 21 Q35 23 32 23 H4 Q1 23 1 20 V4 Q1 1 4 1 Z" fill="' + fill + '" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"></path>' +
        '<text x="20" y="17" text-anchor="middle" fill="' + textFill + '" font-family="var(--vscode-editor-font-family)" font-size="17" font-weight="500">' + escapeHtml(label) + '</text>' +
      '</svg>';
    }
    function debugMarkerFallbackColor(marker) {
      const key = debugMarkerKey(marker);
      if (/^(left|start|begin|slow|lo|l)$/.test(key)) return '#0b66d8';
      if (/^(mid|middle|m)$/.test(key)) return '#d9a300';
      if (/^(right|end|fast|hi|r)$/.test(key)) return '#c40000';
      return '#8e44ad';
    }
    function debugMarkerColorStyle(marker) {
      const color = String(marker && marker.color || debugMarkerFallbackColor(marker)).replace(/[^#a-zA-Z0-9(),.%\\s-]/g, '');
      return color ? ' style="color:' + escapeHtml(color) + '"' : '';
    }
    function visualMarkers(variable) {
      const visual = variable && variable.visual;
      if (!visual || !Array.isArray(visual.markers)) return [];
      return visual.markers;
    }
    function renderDebugMarkerLegend(variable) {
      const markers = visualMarkers(variable);
      const seen = new Set();
      const items = markers.filter((marker) => {
        const name = debugMarkerName(marker);
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      });
      if (!items.length) return '';
      return '<aside class="debug-marker-legend">' + items.map((marker) =>
        '<div class="debug-marker-legend-item"' + debugMarkerColorStyle(marker) + '><span class="debug-legend-marker"></span><span>' + escapeHtml(debugMarkerName(marker)) + '</span></div>'
      ).join('') + '</aside>';
    }
    function debugVisualColumnCount(variable) {
      const visual = variable && variable.visual;
      if (!visual) return 0;
      if (visual.kind && visual.kind.grid && Array.isArray(visual.rows) && visual.rows[0] && Array.isArray(visual.rows[0].columns)) {
        return visual.rows[0].columns.length;
      }
      if (visual.kind && visual.kind.array && Array.isArray(visual.values)) {
        return visual.values.length;
      }
      return 0;
    }
    function compactRuntimeType(value) {
      return String(value || '')
        .replace(/std::(__1::)?/g, '')
        .replace(/\\s+/g, '')
        .replace(/,allocator<[^<>]*(?:<[^<>]*>[^<>]*)*>/g, '');
    }
    function debugTypeChip(variable) {
      const type = compactRuntimeType(variable && variable.runtimeType);
      const count = debugVisualColumnCount(variable);
      if (type && count > 0) return type + '[' + count + ']';
      return type;
    }
    function renderDebugVarHeader(variable) {
      const chips = [];
      const typeChip = debugTypeChip(variable);
      if (typeChip) {
        chips.push(typeChip);
      }
      if (!typeChip && variable && variable.value) {
        chips.push(variable.value);
      }
      if (variable && variable.expression && variable.expression !== variable.name) {
        chips.push(variable.expression);
      }
      const meta = chips.length
        ? '<div class="debug-var-meta">' + chips.map((item) => '<span class="debug-var-pill" title="' + escapeHtml(item) + '">' + escapeHtml(item) + '</span>').join('') + '</div>'
        : '';
      return '<div class="debug-var-head"><div class="debug-var-name">' + escapeHtml(variable && (variable.name || variable.expression) || '') + '</div>' + meta + '</div>';
    }
    function renderDebugFooter(model, loading) {
      const parts = [];
      const status = loading ? '采集中' : (model && model.status ? model.status : '');
      if (status) {
        parts.push('<div class="debug-source"><strong>来源</strong><span title="' + escapeHtml(status) + '">' + escapeHtml(status) + '</span></div>');
      }
      if (model && Array.isArray(model.warnings) && model.warnings.length) {
        parts.push('<div class="debug-visual-warnings">' + model.warnings.map((warning) => '<div>' + escapeHtml(warning) + '</div>').join('') + '</div>');
      }
      return parts.length ? '<div class="debug-visual-footer">' + parts.join('') + '</div>' : '';
    }
    function wrapSourceLine(text, limit) {
      const value = String(text || '');
      const size = limit || 28;
      const lines = [];
      let current = '';
      value.split(/([,(])/).forEach((part) => {
        if (!part) return;
        if ((current + part).length > size && current) {
          lines.push(current);
          current = part.replace(/^,/, ', ');
        } else {
          current += part;
        }
      });
      if (current) lines.push(current);
      return lines.length ? lines : (value ? [value] : []);
    }
    function renderDebugSourcePanel(model, variable, loading) {
      const status = loading ? '采集中' : (model && model.status ? model.status : '');
      const expression = variable && variable.expression && variable.expression !== variable.name ? variable.expression : '';
      const type = variable && variable.runtimeType ? compactRuntimeType(variable.runtimeType) : debugTypeChip(variable);
      const lines = [];
      if (status) {
        wrapSourceLine(status, 26).forEach((line) => lines.push('<div class="debug-source-line">' + escapeHtml(line) + '</div>'));
      }
      if (expression) {
        lines.push('<div class="debug-source-detail">表达式：' + escapeHtml(expression) + '</div>');
      }
      if (type) {
        lines.push('<div class="debug-source-detail">类型：' + escapeHtml(type) + '</div>');
      }
      if (!lines.length) {
        lines.push('<div class="debug-source-detail">当前暂停栈帧</div>');
      }
      return '<aside class="debug-source-panel"><div class="debug-source-title">来源：</div><div class="debug-source-lines">' + lines.join('') + '</div></aside>';
    }
    function renderDebugGridPayload(visual) {
      const rows = Array.isArray(visual.rows) ? visual.rows : [];
      const markers = Array.isArray(visual.markers) ? visual.markers : [];
      return '<div class="debug-grid">' + rows.map((row, rowIndex) => {
        const cells = Array.isArray(row.columns) ? row.columns : [];
        const markerColumns = markers
          .filter((marker) => Number(marker.row) === rowIndex)
          .map((marker) => Number(marker.column))
          .filter((column) => Number.isFinite(column));
        const rangeStart = markerColumns.length >= 2 ? Math.min.apply(Math, markerColumns) : -1;
        const rangeEnd = markerColumns.length >= 2 ? Math.max.apply(Math, markerColumns) : -1;
        return '<div class="debug-grid-row' + (row.label ? '' : ' no-label') + '">' + (row.label ? '<div class="debug-grid-label">' + escapeHtml(row.label) + '</div>' : '') +
          '<div class="debug-grid-cells" style="--debug-cell-count:' + Math.max(1, cells.length) + '">' + cells.map((cell, columnIndex) => {
            const cellMarkers = markers.filter((marker) => Number(marker.row) === rowIndex && Number(marker.column) === columnIndex);
            const markerHtml = cellMarkers.length
              ? '<div class="debug-markers">' + cellMarkers.map((marker) => '<span class="debug-marker' + debugMarkerClass(marker) + '"' + debugMarkerColorStyle(marker) + ' title="' + escapeHtml(marker.label || marker.id || '') + '">' + renderDebugMarkerSvg(marker) + '<span class="debug-marker-text">' + escapeHtml(debugMarkerShortName(marker)) + '</span></span>').join('') + '</div>'
              : '';
            const inRange = columnIndex >= rangeStart && columnIndex <= rangeEnd;
            const rangeClass = inRange ? ' in-range' + (columnIndex === rangeStart ? ' range-start' : '') + (columnIndex === rangeEnd ? ' range-end' : '') : '';
            const tag = cell && cell.tag || String(columnIndex);
            return '<div class="debug-cell' + rangeClass + '">' + markerHtml + '<strong>' + escapeHtml(cell && cell.content || '') + '</strong><span data-index="' + escapeHtml(tag) + '">' + escapeHtml(tag) + '</span></div>';
          }).join('') + '</div></div>';
      }).join('') + '</div>';
    }
    function renderDebugVisualPayload(variable) {
      const visual = variable && variable.visual;
      if (!visual || !visual.kind) return '<pre class="result-pre">' + escapeHtml(variable && (variable.value || variable.error) || '') + '</pre>';
      if (visual.kind.grid && Array.isArray(visual.rows)) {
        return renderDebugGridPayload(visual);
      }
      if (visual.kind.array && Array.isArray(visual.values)) {
        return '<div class="debug-array" style="--debug-cell-count:' + Math.max(1, visual.values.length) + '">' + visual.values.map((item) =>
          '<div class="debug-cell"><strong>' + escapeHtml(item.value) + '</strong><span data-index="' + escapeHtml(item.name) + '">' + escapeHtml(item.name) + '</span></div>'
        ).join('') + '</div>';
      }
      if (visual.kind.list && Array.isArray(visual.nodes)) {
        return '<div class="debug-list">' + visual.nodes.map((node, index) =>
          '<div class="debug-list-node">' + escapeHtml(node.value || node.label || '') + '</div>' +
          (index < visual.nodes.length - 1 ? '<span class="debug-arrow">→</span>' : '')
        ).join('') + '</div>';
      }
      if (visual.kind.graph && Array.isArray(visual.nodes)) {
        const nodes = visual.nodes.map((node) =>
          '<div class="debug-graph-node"><strong>' + escapeHtml(node.label || '') + '</strong><br><span>' + escapeHtml(node.value || '') + '</span></div>'
        ).join('');
        const edges = Array.isArray(visual.edges) && visual.edges.length
          ? '<div class="debug-edges">' + visual.edges.map((edge) => '<span>' + escapeHtml(edge.from) + ' → ' + escapeHtml(edge.to) + (edge.label ? ' · ' + escapeHtml(edge.label) : '') + '</span>').join('') + '</div>'
          : '';
        return '<div class="debug-graph"><div class="debug-graph-nodes">' + nodes + '</div>' + edges + '</div>';
      }
      if (visual.kind.object && Array.isArray(visual.values)) {
        return '<div class="debug-object">' + visual.values.map((item) =>
          '<div><span>' + escapeHtml(item.name) + '</span><strong>' + escapeHtml(item.value) + '</strong></div>'
        ).join('') + '</div>';
      }
      return '<pre class="result-pre">' + escapeHtml(visual.text || variable.value || variable.error || '') + '</pre>';
    }
    function debugVisualTheme() {
      return state.debugVisualTheme === 'theme-two' ? 'theme-two' : 'theme-one';
    }
    function renderDebugThemeSelector() {
      const theme = debugVisualTheme();
      const button = (value, label) => '<button type="button" class="' + (theme === value ? 'active' : '') + '" data-debug-theme="' + value + '" aria-pressed="' + (theme === value ? 'true' : 'false') + '">' + label + '</button>';
      return '<div class="debug-theme-selector">' + button('theme-one', '主题一') + button('theme-two', '主题二') + '</div>';
    }
    function renderDebugVisual(payload) {
      const isDebug = isDebugPayload(payload);
      if (!isDebug) return '';
      const model = payload.debugVisual;
      const loading = !!payload.debugVisualLoading;
      const variables = model && Array.isArray(model.variables) ? model.variables : [];
      const theme = debugVisualTheme();
      const body = variables.length
        ? '<div class="debug-visual-vars">' + variables.map((variable) => {
          if (theme === 'theme-two') {
            return '<article class="debug-var"><div class="debug-var-layout"><div class="debug-var-main">' + renderDebugVarHeader(variable) + '<div class="debug-var-body"><div class="debug-var-figure">' + renderDebugVisualPayload(variable) + '</div></div></div>' + renderDebugSourcePanel(model, variable, loading) + '</div></article>';
          }
          return '<article class="debug-var"><div class="debug-var-layout">' + renderDebugVarHeader(variable) + '<div class="debug-var-body"><div class="debug-var-figure">' + renderDebugVisualPayload(variable) + '</div>' + renderDebugMarkerLegend(variable) + '</div></div></article>';
        }).join('') + (theme === 'theme-two' ? '' : renderDebugFooter(model, loading)) + '</div>'
        : '<div class="result-waiting">' + (loading ? '正在从当前暂停栈帧采集数组和容器。' : '调试器暂停后会自动显示一维数组、vector 和可计算位置的指针/迭代器。') + '</div>';
      return '<section class="debug-visual ' + theme + '">' + renderDebugThemeSelector() + body + '</section>';
    }
	    function renderResult() {
	      closeResultInputPopover();
	      closeResultCardScrollbar();
	      const payload = state.result;
	      if (!payload) {
	        resultEl.innerHTML = renderActivityStatus('tone-neutral', '空闲', '运行用例、全部用例或提交后，这里会显示最新结果。');
	        return;
      }
      if (payload.phase === 'message') {
        resultEl.innerHTML = renderActivityStatus(payload.tone || 'tone-neutral', payload.label || '提示', payload.message || '');
        return;
      }
      const tone = getTone(payload);
	      if (payload.phase === 'running') {
	        const waitingText = payload.action === 'debug' ? '正在启动 C++ 调试器。' : '等待 LeetCode 返回结果。';
	        resultEl.innerHTML = renderActivityStatus('tone-running', '运行', waitingText);
	        return;
	      }
	      const isDebug = isDebugPayload(payload);
	      const comparison = isDebug ? '' : renderResultComparison(payload);
	      if (comparison) {
	        resultEl.innerHTML = '<div class="result-body ' + tone + '">' + comparison + renderPerformanceCharts(payload) + renderDebugVisual(payload) + '</div>';
	        return;
	      }
	      resultEl.innerHTML = '<div class="result-body ' + tone + '">' + (isDebug ? '' : resultSummary(payload) + summaryLines(payload) + renderPerformanceCharts(payload) + diagnostics(payload)) + renderDebugVisual(payload) + '</div>';
	    }
    function resultRenderKey() {
      const payload = state.result || null;
      const casesKey = payload
        ? (state.cases || []).map((testCase) => [testCase && testCase.label, testCase && testCase.value, testCase && testCase.status]).join('|')
        : '';
      try {
        return JSON.stringify({
          result: payload,
          activity: state.activity || null,
          activityExpanded: !!state.activityExpanded,
          activityRange: Number(state.activityRange || 7) || 7,
          debugVisualTheme: debugVisualTheme(),
          cases: casesKey,
        });
      } catch (_) {
        return String(Date.now());
      }
    }
    function renderResultStable(force = false) {
      const key = resultRenderKey();
      if (!force && key === lastResultRenderKey) {
        return;
      }
	      lastResultRenderKey = key;
		      renderResult();
		      equalizeResultBlocks();
		      syncResultCardScrollbars();
		      requestAnimationFrame(syncResultCardScrollbars);
		      syncResultInputOverflow();
		      requestAnimationFrame(syncResultInputOverflow);
		    }
	    function icon(name) {
	      const icons = {
	        run: '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="7 4 19 12 7 20 7 4"></polygon></svg>',
	        debug: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2l1.8 3h4.4L16 2"></path><rect x="7" y="6" width="10" height="14" rx="5"></rect><path d="M3 13h4"></path><path d="M17 13h4"></path><path d="M4 20l3-3"></path><path d="M20 20l-3-3"></path><path d="M12 6v14"></path></svg>',
	        delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 15h10l1-15"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>',
        bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 20V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15l-5-3-5 3z"></path></svg>',
        add: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
	      };
	      return icons[name] || '';
	    }
	    function closeCaseScrollbar() {
	      clearTimeout(activeCaseScrollTimer);
	      activeCaseScrollTimer = 0;
	      if (activeCaseScrollEditor) {
	        activeCaseScrollEditor.classList.remove('is-scrolling');
	      }
	      activeCaseScrollEditor = undefined;
	    }
	    function syncCaseScrollbar(textarea) {
	      const editor = textarea && textarea.closest ? textarea.closest('.case-editor') : undefined;
	      const track = editor && editor.querySelector ? editor.querySelector('.case-scrollbar') : undefined;
	      const thumb = track && track.querySelector ? track.querySelector('.case-scrollbar-thumb') : undefined;
	      if (!editor || !track || !thumb || !textarea) {
	        return false;
	      }
	      const maxScroll = textarea.scrollHeight - textarea.clientHeight;
	      if (maxScroll <= 1) {
	        editor.classList.remove('is-scrolling');
	        track.style.display = 'none';
	        return false;
	      }
	      track.style.display = 'block';
	      const trackHeight = Math.max(track.clientHeight, 1);
	      const thumbHeight = Math.max(24, Math.round(textarea.clientHeight / textarea.scrollHeight * trackHeight));
	      const thumbTop = Math.round(textarea.scrollTop / maxScroll * Math.max(0, trackHeight - thumbHeight));
	      thumb.style.height = thumbHeight + 'px';
	      thumb.style.transform = 'translateY(' + thumbTop + 'px)';
	      return true;
	    }
	    function showCaseScrollbar(textarea) {
	      const editor = textarea && textarea.closest ? textarea.closest('.case-editor') : undefined;
	      if (!editor || !syncCaseScrollbar(textarea)) {
	        return;
	      }
	      if (activeCaseScrollEditor && activeCaseScrollEditor !== editor) {
	        activeCaseScrollEditor.classList.remove('is-scrolling');
	      }
	      activeCaseScrollEditor = editor;
	      editor.classList.add('is-scrolling');
	      clearTimeout(activeCaseScrollTimer);
	      activeCaseScrollTimer = setTimeout(() => {
	        if (activeCaseScrollEditor === editor) {
	          editor.classList.remove('is-scrolling');
	          activeCaseScrollEditor = undefined;
	        }
	      }, 650);
	    }
	    function autosizeTextarea(textarea) {
	      if (!textarea) return;
	      textarea.style.height = '0px';
	      const computed = window.getComputedStyle(textarea);
      const lineHeight = parseFloat(computed.lineHeight) || 18;
      const paddingTop = parseFloat(computed.paddingTop) || 0;
      const paddingBottom = parseFloat(computed.paddingBottom) || 0;
      const borderTop = parseFloat(computed.borderTopWidth) || 0;
      const borderBottom = parseFloat(computed.borderBottomWidth) || 0;
      const maxHeight = parseFloat(computed.maxHeight) || 160;
      const minHeight = Math.ceil(lineHeight + paddingTop + paddingBottom + borderTop + borderBottom);
	      const next = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
	      textarea.style.height = next + 'px';
	      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
	      syncCaseScrollbar(textarea);
	      scheduleCaseListLayout();
	    }
    function autosizeAllTextareas() {
      document.querySelectorAll('textarea').forEach(autosizeTextarea);
    }
    function preferredCaseColumnCount(singleHeight, availableHeight, availableWidth, itemCount) {
      const minColumnWidth = 220;
      const gap = 8;
      const height = Math.max(0, Number(singleHeight) || 0);
      const viewportHeight = Math.max(0, Number(availableHeight) || 0);
      const width = Math.max(0, Number(availableWidth) || 0);
      const maxByItems = Math.min(3, Math.max(1, Number(itemCount) || 1));
      if (!viewportHeight || height <= viewportHeight + gap || maxByItems < 2) return 1;
      const maxByWidth = Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)));
      if (maxByWidth < 2) return 1;
      const neededByHeight = Math.max(2, Math.ceil(height / viewportHeight));
      return Math.min(maxByItems, maxByWidth, neededByHeight);
    }
    function syncCaseListLayout() {
      const list = content.querySelector('.list');
      if (!list || !casePane) return;
      list.classList.remove('is-multicolumn');
      list.style.removeProperty('--case-columns');
      list.removeAttribute('data-columns');
      const computed = window.getComputedStyle(list);
      const horizontalPadding = (parseFloat(computed.paddingLeft) || 0) + (parseFloat(computed.paddingRight) || 0);
      const availableWidth = Math.max(0, list.clientWidth - horizontalPadding);
      const columns = preferredCaseColumnCount(list.scrollHeight, casePane.clientHeight, availableWidth, state.cases.length);
      if (columns < 2) return;
      list.style.setProperty('--case-columns', String(columns));
      list.setAttribute('data-columns', String(columns));
      list.classList.add('is-multicolumn');
    }
    function scheduleCaseListLayout() {
      if (caseListLayoutFrame) {
        cancelAnimationFrame(caseListLayoutFrame);
      }
      caseListLayoutFrame = requestAnimationFrame(() => {
        caseListLayoutFrame = 0;
        syncCaseListLayout();
      });
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
	    function closeResultCardScrollbar() {
	      clearTimeout(activeResultCardScrollTimer);
	      activeResultCardScrollTimer = 0;
	      if (activeResultCardScrollWrap) {
	        activeResultCardScrollWrap.classList.remove('is-scrolling');
	      }
	      activeResultCardScrollWrap = undefined;
	    }
	    function syncResultCardScrollbar(pre) {
	      const wrap = pre && pre.closest ? pre.closest('.result-card-pre-wrap') : undefined;
	      const track = wrap && wrap.querySelector ? wrap.querySelector('.result-card-scrollbar') : undefined;
	      const thumb = track && track.querySelector ? track.querySelector('.result-card-scrollbar-thumb') : undefined;
	      if (!wrap || !track || !thumb || !pre) {
	        return false;
	      }
	      const maxScroll = pre.scrollHeight - pre.clientHeight;
	      if (maxScroll <= 1) {
	        wrap.classList.remove('is-scrolling');
	        track.style.display = 'none';
	        return false;
	      }
	      track.style.display = 'block';
	      const trackHeight = Math.max(track.clientHeight, 1);
	      const thumbHeight = Math.max(24, Math.round(pre.clientHeight / pre.scrollHeight * trackHeight));
	      const thumbTop = Math.round(pre.scrollTop / maxScroll * Math.max(0, trackHeight - thumbHeight));
	      thumb.style.height = thumbHeight + 'px';
	      thumb.style.transform = 'translateY(' + thumbTop + 'px)';
	      return true;
	    }
	    function showResultCardScrollbar(pre) {
	      const wrap = pre && pre.closest ? pre.closest('.result-card-pre-wrap') : undefined;
	      if (!wrap || !syncResultCardScrollbar(pre)) {
	        return;
	      }
	      if (activeResultCardScrollWrap && activeResultCardScrollWrap !== wrap) {
	        activeResultCardScrollWrap.classList.remove('is-scrolling');
	      }
	      activeResultCardScrollWrap = wrap;
	      wrap.classList.add('is-scrolling');
	      clearTimeout(activeResultCardScrollTimer);
	      activeResultCardScrollTimer = setTimeout(() => {
	        if (activeResultCardScrollWrap === wrap) {
	          wrap.classList.remove('is-scrolling');
	          activeResultCardScrollWrap = undefined;
	        }
	      }, 650);
	    }
	    function syncResultCardScrollbars() {
	      document.querySelectorAll('.result-card-pre-wrap .result-card-pre').forEach(syncResultCardScrollbar);
	    }
	    function syncResultInputOverflow() {
	      document.querySelectorAll('.result-card-pre.is-input').forEach((block) => {
	        block.classList.toggle('has-overflow', block.scrollWidth > block.clientWidth + 1 || block.scrollHeight > block.clientHeight + 1);
	      });
	    }
	    function closeResultInputPopover() {
	      clearTimeout(activeResultInputScrollTimer);
	      activeResultInputScrollTimer = 0;
	      if (activeResultInputPopover && activeResultInputPopover.parentNode) {
	        activeResultInputPopover.parentNode.removeChild(activeResultInputPopover);
	      }
	      if (activeResultInputTarget) {
	        const activeCard = activeResultInputTarget.closest('.result-card');
	        if (activeCard) {
	          activeCard.classList.remove('has-input-popover');
	        }
	        activeResultInputTarget.setAttribute('aria-expanded', 'false');
	      }
	      activeResultInputPopover = undefined;
	      activeResultInputTarget = undefined;
	    }
	    function syncResultInputPopoverScrollbar(popover, scroller) {
	      const track = popover && popover.querySelector ? popover.querySelector('.result-card-input-scrollbar') : undefined;
	      const thumb = track && track.querySelector ? track.querySelector('.result-card-input-scrollbar-thumb') : undefined;
	      if (!track || !thumb || !scroller) {
	        return;
	      }
	      const maxScroll = scroller.scrollHeight - scroller.clientHeight;
	      if (maxScroll <= 1) {
	        popover.classList.remove('is-scrolling');
	        track.style.display = 'none';
	        return;
	      }
	      track.style.display = 'block';
	      const trackHeight = Math.max(track.clientHeight, 1);
	      const thumbHeight = Math.max(24, Math.round(scroller.clientHeight / scroller.scrollHeight * trackHeight));
	      const thumbTop = Math.round(scroller.scrollTop / maxScroll * Math.max(0, trackHeight - thumbHeight));
	      thumb.style.height = thumbHeight + 'px';
	      thumb.style.transform = 'translateY(' + thumbTop + 'px)';
	    }
	    function showResultInputScrollbar(popover, scroller) {
	      syncResultInputPopoverScrollbar(popover, scroller);
	      if (!popover || !popover.querySelector('.result-card-input-scrollbar')) {
	        return;
	      }
	      popover.classList.add('is-scrolling');
	      clearTimeout(activeResultInputScrollTimer);
	      activeResultInputScrollTimer = setTimeout(() => {
	        if (popover === activeResultInputPopover) {
	          popover.classList.remove('is-scrolling');
	        }
	      }, 650);
	    }
	    function openResultInputPopover(target) {
	      const value = target ? target.textContent || '' : '';
	      if (!value.trim()) {
	        return;
	      }
	      if (activeResultInputTarget === target) {
	        closeResultInputPopover();
	        return;
	      }
	      closeResultInputPopover();
	      const host = target.closest('.result-card-input');
	      const card = target.closest('.result-card');
	      if (!host || !card) {
	        return;
	      }
	      const popover = document.createElement('div');
	      popover.className = 'result-card-input-popover';
	      popover.innerHTML = '<pre>' + escapeHtml(value) + '</pre><span class="result-card-input-scrollbar" aria-hidden="true"><span class="result-card-input-scrollbar-thumb"></span></span>';
	      host.appendChild(popover);
	      const scroller = popover.querySelector('pre');
	      if (scroller) {
	        scroller.addEventListener('scroll', () => showResultInputScrollbar(popover, scroller));
	        requestAnimationFrame(() => syncResultInputPopoverScrollbar(popover, scroller));
	      }
	      card.classList.add('has-input-popover');
	      target.setAttribute('aria-expanded', 'true');
	      activeResultInputPopover = popover;
	      activeResultInputTarget = target;
	    }
	    function syncToolbarState(hasLeetCodeFile, isLoggedIn) {
	      const disabled = !hasLeetCodeFile || !isLoggedIn;
      if (lastVoidWorkbench !== disabled) {
        document.body.classList.toggle('void-workbench', disabled);
        lastVoidWorkbench = disabled;
      }
      if (lastToolbarDisabled !== disabled) {
        toolbarActionButtons.forEach((button) => {
          button.disabled = disabled;
          if (disabled) {
            button.setAttribute('aria-disabled', 'true');
          } else {
            button.removeAttribute('aria-disabled');
          }
        });
        if (aiDebugToggle) {
          aiDebugToggle.disabled = disabled;
        }
        lastToolbarDisabled = disabled;
      }
    }
	    function render() {
	      closeCaseScrollbar();
	      file.innerHTML = escapeHtml(state.problemTitle || state.fileName || '未打开力扣题目') + (state.dirty ? ' <span class="dirty">已修改</span>' : '');
	      document.body.classList.toggle('show-ai-debug', !!state.aiDebugEnabled || isDebugPayload(state.result));
	      const hasLeetCodeFile = !!state.isLeetCodeFile;
	      const canUseActions = hasLeetCodeFile && !!state.isLoggedIn;
	      const disabledAttr = canUseActions ? '' : ' disabled aria-disabled="true"';
	      syncToolbarState(hasLeetCodeFile, !!state.isLoggedIn);
	      aiDebugToggle.checked = !!state.aiDebugEnabled;
	      syncWorkspaceSplit();
	      renderResultStable(false);
      if (!hasLeetCodeFile) {
        content.innerHTML = '<div class="empty">打开力扣题目文件后，可以在这里管理操作和测试用例。</div>';
        return;
      }
      if (!state.cases.length) {
        content.innerHTML = '<div class="empty">还没有 @lcpr 测试用例。</div><div class="case-add-row"><button class="case-add-button" data-add-case title="添加用例" aria-label="添加用例"' + disabledAttr + '>' + icon('add') + '</button></div>';
        return;
      }
      content.innerHTML = '<div class="list">' + state.cases.map((testCase, index) => \`
        <div class="case\${caseClass(testCase, index)}" data-index="\${index}">
          <div class="case-header">
            <div class="case-title">\${renderCaseTitle(testCase, index)}</div>
            <div class="case-actions">
              <button data-run="\${index}" title="运行" aria-label="运行"\${disabledAttr}>\${icon('run')}</button>
              <button data-debug="\${index}" title="调试" aria-label="调试"\${disabledAttr}>\${icon('debug')}</button>
              <button data-delete="\${index}" title="删除" aria-label="删除"\${disabledAttr}>\${icon('delete')}</button>
            </div>
	          </div>
	          <div class="case-editor">
	            <textarea data-edit="\${index}" rows="1" spellcheck="false">\${escapeHtml(testCase.value)}</textarea>
	            <span class="case-scrollbar" aria-hidden="true"><span class="case-scrollbar-thumb"></span></span>
	          </div>
	        </div>\`).join('') + '</div>';
      content.querySelector('.list').insertAdjacentHTML('beforeend', '<div class="case-add-row"><button class="case-add-button" data-add-case title="添加用例" aria-label="添加用例"' + disabledAttr + '>' + icon('add') + '</button></div>');
      autosizeAllTextareas();
      scheduleCaseListLayout();
      if (editingCaseIndex >= 0) {
        const labelInput = content.querySelector('[data-edit-label="' + editingCaseIndex + '"]');
        if (labelInput) {
          requestAnimationFrame(() => {
            labelInput.focus();
            if (labelInput.select) {
              labelInput.select();
            }
          });
        } else {
          editingCaseIndex = -1;
        }
      }
    }
    function currentCases() {
      return state.cases.map((testCase, index) => {
        const textarea = content.querySelector('[data-edit="' + index + '"]');
        const labelInput = content.querySelector('[data-edit-label="' + index + '"]');
        const nextLabel = labelInput && !isCaseRenameEmpty(labelInput.value) ? labelInput.value : testCase.label;
        return { ...testCase, label: normalizeCaseLabel(nextLabel, index), value: textarea ? textarea.value : testCase.value };
      });
    }
    function eventElementTarget(event) {
      const target = event && event.target;
      if (!target) return undefined;
      if (target.nodeType === 1) return target;
      if (target.nodeType === 3) return target.parentElement || undefined;
      return undefined;
    }
    function defaultCaseLabel(index) {
      return '用例 ' + (index + 1);
    }
    function renderCaseTitle(testCase, index) {
      const label = testCase && testCase.label ? testCase.label : defaultCaseLabel(index);
      const defaultBadge = testCase && testCase.isDefault ? '<span class="case-default-badge" data-default-badge>默认</span>' : '';
      const isPinned = !!(testCase && testCase.isPinned);
      const pinLabel = isPinned ? '取消置顶' : '置顶用例';
      const pinButton = '<button type="button" class="case-pin-toggle' + (isPinned ? ' is-pinned' : '') + '" data-toggle-pin="' + index + '" title="' + pinLabel + '" aria-label="' + pinLabel + '" aria-pressed="' + (isPinned ? 'true' : 'false') + '">' + icon('bookmark') + '</button>';
      const badges = defaultBadge + pinButton;
      if (editingCaseIndex === index) {
        return '<div class="case-title-edit"><input class="case-title-input" data-edit-label="' + index + '" value="' + escapeHtml(label) + '" maxlength="6" spellcheck="false" aria-label="重命名用例" />' + badges + '</div>';
      }
      return '<div class="case-title-display"><button type="button" class="case-title-button" data-rename="' + index + '" title="重命名用例" aria-label="重命名用例"><span class="case-title-text">' + escapeHtml(label) + '</span></button>' + badges + '</div>';
    }
    function markCaseModified(index) {
      if (!Number.isFinite(index) || !state.cases[index] || !state.cases[index].isDefault) return;
      state.cases[index] = { ...state.cases[index], isDefault: false };
      const caseElement = content.querySelector('.case[data-index="' + index + '"]');
      const badge = caseElement && caseElement.querySelector('[data-default-badge]');
      if (badge) badge.remove();
    }
    function updateCasePinButton(index, isPinned) {
      const button = content.querySelector('[data-toggle-pin="' + index + '"]');
      if (!button) return;
      const label = isPinned ? '取消置顶' : '置顶用例';
      button.classList.toggle('is-pinned', isPinned);
      button.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    }
    function toggleCasePin(index) {
      const numericIndex = Number(index);
      if (!Number.isFinite(numericIndex) || !state.cases[numericIndex]) return;
      state.cases = currentCases();
      if (state.cases[numericIndex].isPinned) {
        state.cases[numericIndex] = { ...state.cases[numericIndex], isPinned: false };
        updateCasePinButton(numericIndex, false);
        scheduleCaseAutosave(true);
        return;
      }
      const pinnedCase = { ...state.cases[numericIndex], isPinned: true };
      const restCases = state.cases
        .filter((_, caseIndex) => caseIndex !== numericIndex)
        .map((testCase) => ({ ...testCase, isPinned: false }));
      state.cases = [pinnedCase].concat(restCases);
      editingCaseIndex = -1;
      editingCaseOriginalLabel = '';
      editingCaseOriginalIsDefault = false;
      render();
      scheduleCaseAutosave(true);
    }
    function caseLabelLength(label) {
      return Array.from(String(label || '')).length;
    }
    function trimCaseLabel(label) {
      return String(label || '').trim();
    }
    function normalizeCaseLabel(label, index) {
      const text = trimCaseLabel(label);
      return text || defaultCaseLabel(index);
    }
    function validateCaseRename(label) {
      const text = trimCaseLabel(label);
      if (!text) {
        return '用例名称不能为空。';
      }
      if (caseLabelLength(text) > 6) {
        return '用例名称最多 6 个字。';
      }
      return '';
    }
    function isCaseRenameEmpty(label) {
      return !trimCaseLabel(label);
    }
    function updateCaseRenameValidity(input) {
      if (!input) return false;
      const invalid = isCaseRenameEmpty(input.value);
      input.classList.toggle('is-invalid', invalid);
      if (invalid) {
        input.setAttribute('aria-invalid', 'true');
      } else {
        input.removeAttribute('aria-invalid');
      }
      return !invalid;
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
	    function pinResultCase(index) {
	      const cards = resultDetailCards(state.result);
	      const card = cards[Number(index)];
	      const input = card && card.input ? String(card.input) : '';
	      const normalizedInput = normalizeCaseValue(input);
	      if (!normalizedInput) {
	        return;
	      }
	      closeResultInputPopover();
	      const cases = currentCases();
	      const existingIndex = cases.findIndex((testCase) => normalizeCaseValue(testCase && testCase.value) === normalizedInput);
	      const pinnedCase = { ...(existingIndex >= 0 ? cases[existingIndex] : { label: defaultCaseLabel(0), value: input }), isPinned: true };
	      const restCases = (existingIndex >= 0 ? cases.filter((_, i) => i !== existingIndex) : cases)
          .map((testCase) => ({ ...testCase, isPinned: false }));
	      state.cases = [pinnedCase].concat(restCases).map((testCase, i) => ({
	        ...testCase,
	        label: normalizeCaseLabel(testCase && testCase.label, i),
	      }));
	      render();
	      scheduleCaseAutosave(true);
	    }
	    let saveCasesTimer = 0;
	    let caseInputComposing = false;
    function updateCaseStateFromInputs() {
      state.cases = currentCases();
    }
    function startCaseRename(index) {
      updateCaseStateFromInputs();
      editingCaseIndex = Number(index);
      editingCaseOriginalLabel = state.cases[editingCaseIndex] ? String(state.cases[editingCaseIndex].label || '') : '';
      editingCaseOriginalIsDefault = !!(state.cases[editingCaseIndex] && state.cases[editingCaseIndex].isDefault);
      render();
    }
    function finishCaseRename(index, shouldSave) {
      const numericIndex = Number(index);
      if (!Number.isFinite(numericIndex) || !state.cases[numericIndex]) {
        editingCaseIndex = -1;
        editingCaseOriginalLabel = '';
        editingCaseOriginalIsDefault = false;
        render();
        return;
      }
      const labelInput = content.querySelector('[data-edit-label="' + numericIndex + '"]');
      const rawLabel = labelInput ? labelInput.value : state.cases[numericIndex].label;
      if (isCaseRenameEmpty(rawLabel)) {
        cancelCaseRename(numericIndex);
        return;
      }
      const nextLabel = normalizeCaseLabel(rawLabel, numericIndex);
      const renamed = nextLabel !== trimCaseLabel(editingCaseOriginalLabel);
      state.cases[numericIndex] = {
        ...state.cases[numericIndex],
        label: nextLabel,
        isDefault: renamed ? false : state.cases[numericIndex].isDefault === true,
      };
      editingCaseIndex = -1;
      editingCaseOriginalLabel = '';
      editingCaseOriginalIsDefault = false;
      render();
      if (shouldSave) {
        scheduleCaseAutosave(true);
      }
    }
    function cancelCaseRename(index) {
      const numericIndex = Number(index);
      if (!Number.isFinite(numericIndex) || !state.cases[numericIndex]) {
        editingCaseIndex = -1;
        editingCaseOriginalLabel = '';
        editingCaseOriginalIsDefault = false;
        render();
        return;
      }
      state.cases[numericIndex] = {
        ...state.cases[numericIndex],
        label: editingCaseOriginalLabel || state.cases[numericIndex].label,
        isDefault: editingCaseOriginalIsDefault,
      };
      editingCaseIndex = -1;
      editingCaseOriginalLabel = '';
      editingCaseOriginalIsDefault = false;
      render();
      scheduleCaseAutosave(true);
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
      if (!target || target.disabled) return;
      const action = target && target.dataset && target.dataset.action;
      if (action === 'allcase') {
        send({ type: 'action', action, testCase: visibleAllcaseValue(), enableAiDebug: !!state.aiDebugEnabled });
      } else if (action) {
        send({ type: 'action', action, enableAiDebug: !!state.aiDebugEnabled });
      }
    });
	    resultEl.addEventListener('click', (event) => {
	      const themeTarget = event.target && event.target.closest ? event.target.closest('[data-debug-theme]') : undefined;
	      if (themeTarget) {
	        const theme = themeTarget.getAttribute('data-debug-theme') === 'theme-two' ? 'theme-two' : 'theme-one';
	        state.debugVisualTheme = theme;
        try {
          localStorage.setItem('lcpr.debugVisualTheme', theme);
        } catch (_) {
          // Ignore webview storage failures.
        }
		        renderResultStable(true);
		        return;
		      }
		      const pinTarget = event.target && event.target.closest ? event.target.closest('[data-pin-result-case]') : undefined;
		      if (pinTarget) {
		        event.preventDefault();
		        pinResultCase(Number(pinTarget.getAttribute('data-pin-result-case')));
		        return;
		      }
		      const inputPopoverTarget = event.target && event.target.closest ? event.target.closest('.result-card-input-popover') : undefined;
		      if (inputPopoverTarget) {
		        return;
	      }
	      const inputTarget = event.target && event.target.closest ? event.target.closest('.result-card-pre.is-input') : undefined;
	      if (inputTarget) {
	        event.preventDefault();
	        openResultInputPopover(inputTarget);
	        return;
	      }
	      if (activeResultInputPopover) {
	        closeResultInputPopover();
	      }
	      const rangeTarget = event.target && event.target.closest ? event.target.closest('[data-activity-range]') : undefined;
	      if (rangeTarget) {
	        state.activityRange = Number(rangeTarget.getAttribute('data-activity-range')) || 7;
	        state.activityExpanded = true;
	        renderResultStable(true);
        return;
      }
      const toggleTarget = event.target && event.target.closest ? event.target.closest('[data-toggle-activity]') : undefined;
      if (!toggleTarget) {
        if (state.activityExpanded) {
          state.activityExpanded = false;
          renderResultStable(true);
        }
        return;
      }
	      state.activityExpanded = !state.activityExpanded;
	      renderResultStable(true);
	    });
		    resultEl.addEventListener('keydown', (event) => {
		      const inputTarget = event.target && event.target.closest ? event.target.closest('.result-card-pre.is-input') : undefined;
		      if (!inputTarget || (event.key !== 'Enter' && event.key !== ' ')) {
		        return;
		      }
		      event.preventDefault();
		      openResultInputPopover(inputTarget);
		    });
		    resultEl.addEventListener('scroll', (event) => {
		      const target = event.target;
		      if (target && target.classList && target.classList.contains('result-card-pre') && !target.classList.contains('is-input')) {
		        showResultCardScrollbar(target);
		      }
		    }, true);
		    document.addEventListener('click', (event) => {
	      const inResult = event.target && event.target.closest ? event.target.closest('#result') : undefined;
	      if (!inResult) {
	        closeResultInputPopover();
	      }
	    });
	    window.addEventListener('keydown', (event) => {
	      if (event.key === 'Escape') {
	        closeResultInputPopover();
	      }
	    });
	    aiDebugToggle.addEventListener('change', () => {
      state.aiDebugEnabled = aiDebugToggle.checked;
      send({ type: 'setAiDebugEnabled', value: state.aiDebugEnabled });
    });
    if (workspaceResizer) {
      let resizing = false;
      let resizePointerId = -1;
      const stopResize = (event) => {
        if (!resizing) return;
        if (event && resizePointerId >= 0 && event.pointerId !== undefined && event.pointerId !== resizePointerId) {
          return;
        }
        resizing = false;
        resizePointerId = -1;
        document.body.classList.remove('workspace-resizing');
        const nextRatio = snapWorkspaceSplit(event && typeof event.clientX === 'number'
          ? workspaceSplitFromClientX(event.clientX)
          : (state.workspaceSplitRatio || WORKSPACE_SPLIT_DEFAULT));
        applyWorkspaceSplit(nextRatio, true);
        window.removeEventListener('pointermove', onResizeMove);
        window.removeEventListener('pointerup', stopResize);
        window.removeEventListener('pointercancel', stopResize);
      };
      const onResizeMove = (event) => {
        if (!resizing) return;
        applyWorkspaceSplit(workspaceSplitFromClientX(event.clientX), false);
      };
      workspaceResizer.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        resizing = true;
        resizePointerId = event.pointerId;
        document.body.classList.add('workspace-resizing');
        try {
          workspaceResizer.setPointerCapture(event.pointerId);
        } catch (_) {
          // Ignore pointer capture failures in webviews.
        }
        applyWorkspaceSplit(workspaceSplitFromClientX(event.clientX), false);
        window.addEventListener('pointermove', onResizeMove);
        window.addEventListener('pointerup', stopResize);
        window.addEventListener('pointercancel', stopResize);
      });
      workspaceResizer.addEventListener('dblclick', () => applyWorkspaceSplit(WORKSPACE_SPLIT_DEFAULT, true));
      workspaceResizer.addEventListener('keydown', (event) => {
        const key = event.key;
        if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
        event.preventDefault();
        const current = Number(state.workspaceSplitRatio || WORKSPACE_SPLIT_DEFAULT);
        const step = event.shiftKey ? 5 : 1.5;
        let next = current;
        if (key === 'ArrowLeft') next -= step;
        else if (key === 'ArrowRight') next += step;
        else if (key === 'Home') next = WORKSPACE_SPLIT_DEFAULT;
        else if (key === 'End') next = WORKSPACE_SPLIT_MAX;
        applyWorkspaceSplit(snapWorkspaceSplit(next), true);
      });
    }
    document.getElementById('refresh').addEventListener('click', () => send({ type: 'refreshOfficial' }));
    content.addEventListener('click', (event) => {
      const elementTarget = eventElementTarget(event);
      const target = elementTarget && elementTarget.closest ? elementTarget.closest('button') : elementTarget;
      if (!target || target.disabled || !target.dataset) return;
      if (target.dataset.togglePin !== undefined) {
        toggleCasePin(Number(target.dataset.togglePin));
        return;
      }
      if (target.dataset.rename !== undefined) {
        startCaseRename(Number(target.dataset.rename));
        return;
      }
      if (target.dataset.addCase !== undefined) {
        state.cases = currentCases().concat([{ label: defaultCaseLabel(state.cases.length), value: '' }]);
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
        state.cases = currentCases().filter((_, i) => i !== index).map((testCase, i) => ({ ...testCase, label: normalizeCaseLabel(testCase && testCase.label, i) }));
        editingCaseIndex = -1;
        render();
        scheduleCaseAutosave(true);
      }
    });
	    content.addEventListener('input', (event) => {
      if (event.target && event.target.tagName === 'TEXTAREA') {
	        autosizeTextarea(event.target);
	        const index = Number(event.target.dataset.edit);
        if (Number.isFinite(index) && state.cases[index]) {
          const changed = event.target.value !== state.cases[index].value;
          state.cases[index] = { ...state.cases[index], value: event.target.value };
          if (changed) markCaseModified(index);
        }
        if (!caseInputComposing) {
          scheduleCaseAutosave(false);
	        }
	      } else if (event.target && event.target.classList && event.target.classList.contains('case-title-input')) {
	        const index = Number(event.target.dataset.editLabel);
        if (Number.isFinite(index) && state.cases[index]) {
          const trimmedValue = Array.from(String(event.target.value || '')).slice(0, 6).join('');
          if (event.target.value !== trimmedValue) {
            event.target.value = trimmedValue;
          }
          if (updateCaseRenameValidity(event.target)) {
            const nextLabel = trimCaseLabel(trimmedValue);
            const changed = nextLabel !== trimCaseLabel(state.cases[index].label);
            state.cases[index] = { ...state.cases[index], label: nextLabel };
            if (changed) markCaseModified(index);
            scheduleCaseAutosave(false);
          } else {
            clearTimeout(saveCasesTimer);
          }
        }
	      }
	    });
	    content.addEventListener('keydown', (event) => {
      if (event.target && event.target.classList && event.target.classList.contains('case-title-input')) {
        const index = Number(event.target.dataset.editLabel);
        if (event.key === 'Enter') {
          event.preventDefault();
          finishCaseRename(index, true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          cancelCaseRename(index);
        }
      }
    });
    content.addEventListener('focusout', (event) => {
      if (event.target && event.target.classList && event.target.classList.contains('case-title-input')) {
        const index = Number(event.target.dataset.editLabel);
        setTimeout(() => {
          if (editingCaseIndex === index) {
            finishCaseRename(index, true);
          }
        }, 0);
      }
    });
    function mergeIncomingCaseDrafts(nextState) {
      if (editingCaseIndex < 0) return nextState;
      if (!nextState || !nextState.isLeetCodeFile || !state.isLeetCodeFile) return nextState;
      if (!nextState.uri || !state.uri || nextState.uri !== state.uri) return nextState;
      const localCases = currentCases();
      if (!localCases.length) return nextState;
      return {
        ...nextState,
        cases: (nextState.cases || []).map((testCase, index) => {
          const localCase = localCases[index];
          if (!localCase) {
            return testCase;
          }
          return {
            ...testCase,
            label: normalizeCaseLabel(localCase.label, index),
            value: localCase.value,
            isDefault: localCase.isDefault === true,
            isPinned: localCase.isPinned === true,
          };
        }),
      };
    }
	    content.addEventListener('scroll', (event) => {
	      if (event.target && event.target.tagName === 'TEXTAREA') {
	        showCaseScrollbar(event.target);
	      }
	    }, true);
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
          const changed = event.target.value !== state.cases[index].value;
          state.cases[index] = { ...state.cases[index], value: event.target.value };
          if (changed) markCaseModified(index);
        }
        scheduleCaseAutosave(false);
      }
    });
    if (casePane && typeof ResizeObserver === 'function') {
      const casePaneResizeObserver = new ResizeObserver(scheduleCaseListLayout);
      casePaneResizeObserver.observe(casePane);
    }
    window.addEventListener('resize', scheduleCaseListLayout);
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'state') {
        const localActivityExpanded = !!state.activityExpanded;
        const localActivityRange = Number(state.activityRange || 7) || 7;
        const localDebugVisualTheme = debugVisualTheme();
        const localWorkspaceSplitRatio = clampWorkspaceSplit(state.workspaceSplitRatio || readWorkspaceSplit());
        const nextState = mergeIncomingCaseDrafts(event.data.state || {});
        state = Object.assign({ activityExpanded: false, activityRange: 7 }, nextState, {
          activityExpanded: localActivityExpanded,
          activityRange: localActivityRange,
          debugVisualTheme: localDebugVisualTheme,
          workspaceSplitRatio: localWorkspaceSplitRatio,
        });
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
  const loginMediatorName = "LeetCodeWorkbenchLoginMediator";
  class LeetCodeWorkbenchLoginMediator extends BABAMediator {
    static NAME = loginMediatorName;
    constructor() {
      super(LeetCodeWorkbenchLoginMediator.NAME);
    }
    listNotificationInterests() {
      return [babaStr.USER_LOGIN_SUC, babaStr.USER_LOGIN_OUT];
    }
    handleNotification() {
      provider.refresh(undefined, { preserveCurrentOnTransientMiss: true });
    }
  }
  if (!baba.fa.hasMediator(loginMediatorName)) {
    new LeetCodeWorkbenchLoginMediator();
  }
  const subscriptions = [
    vscode.window.registerWebviewViewProvider("LCPRWorkbench", provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.onDidChangeActiveTextEditor((editor) => provider.refresh(editor, { preserveCurrentOnTransientMiss: true })),
    vscode.workspace.onDidSaveTextDocument((document) => provider.handleSavedDocument(document)),
    vscode.commands.registerCommand("lcpr.workbench.refresh", () => provider.refreshOfficialCases()),
    vscode.commands.registerCommand("lcpr.workbench.showResult", (payload) => provider.showResult(payload)),
    vscode.commands.registerCommand("lcpr.workbench.refreshDebugVisual", () => provider.refreshDebugVisual()),
    vscode.commands.registerCommand("lcpr.workbench.case", () => provider.runAction("case")),
    vscode.commands.registerCommand("lcpr.workbench.allcase", () => provider.runAction("allcase")),
    vscode.commands.registerCommand("lcpr.workbench.debug", () => provider.runAction("debug")),
  ];
  const disposable = vscode.Disposable.from(...subscriptions, {
    dispose: () => {
      baba.fa.removeMediator(loginMediatorName);
      provider.dispose();
    },
  });
  context.subscriptions.push(disposable);
  return disposable;
}
export { LeetCodeWorkbenchProvider, registerLeetCodeWorkbench };
