// @ts-nocheck
import * as vscode from "vscode";
import * as fse from "fs-extra";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import * as hljs from "highlight.js";
import * as ConstDefind_1 from "../model/ConstDefind";
import * as ConfigUtils_1 from "../utils/ConfigUtils";
import * as MarkdownService_1 from "../service/MarkdownService";
import * as BABA_1 from "../BABA";
import { findDiagramReplacement, loadDiagramPack } from "../diagram/DiagramLoader";
import { renderDiagram, sanitizeRenderedSvg } from "../diagram/DiagramRenderer";
class LeetCodeCompanionProvider {
    constructor(context) {
        this.context = context;
        this.view = undefined;
        this.descriptionRequestSeq = 0;
        this.problemImageDataCache = new Map();
        this.state = {
            activeTab: "empty",
            description: undefined,
            descriptionZh: undefined,
            descriptionEn: undefined,
            descriptionMode: ConfigUtils_1.isUseEndpointTranslation() ? "zh" : "en",
            descriptionStatus: undefined,
            node: undefined,
            solution: undefined,
            hints: undefined,
            submissions: {
                list: [],
                detail: undefined,
                notes: {},
                noteNotice: undefined,
                filters: { status: "all", lang: "all", note: "" },
                loading: false,
                error: "",
            },
        };
    }
    getMarkdownMediaRoot() {
        const markdownExtension = vscode.extensions.getExtension("vscode.markdown-language-features");
        if (markdownExtension && markdownExtension.extensionUri && markdownExtension.extensionUri.fsPath) {
            return path.join(markdownExtension.extensionUri.fsPath, "media");
        }
        return path.join(vscode.env.appRoot, "extensions", "markdown-language-features", "media");
    }
    getLocalResourceRoots() {
        return MarkdownService_1.markdownService.localResourceRoots;
    }
    getCurrentColorTheme() {
        return vscode.workspace.getConfiguration("workbench").get("colorTheme", "");
    }
    readJsonFile(filePath) {
        try {
            return fse.readJsonSync(filePath);
        }
        catch (_) {
            return {};
        }
    }
    findColorThemeDefinition(themeName) {
        const wanted = String(themeName || "").trim();
        if (!wanted) {
            return undefined;
        }
        for (const extension of vscode.extensions.all) {
            const themes = extension.packageJSON && extension.packageJSON.contributes && extension.packageJSON.contributes.themes;
            if (!Array.isArray(themes)) {
                continue;
            }
            for (const theme of themes) {
                const candidates = [theme.id, theme.label, theme.name].filter(Boolean).map((value) => String(value));
                if (!candidates.includes(wanted)) {
                    continue;
                }
                const extensionPath = extension.extensionUri && extension.extensionUri.fsPath;
                if (!extensionPath || !theme.path) {
                    continue;
                }
                return {
                    extensionPath,
                    themePath: path.join(extensionPath, theme.path),
                };
            }
        }
        return undefined;
    }
    loadThemeFile(themePath, visited = new Set()) {
        const normalizedPath = path.normalize(themePath);
        if (visited.has(normalizedPath)) {
            return { colors: {}, tokenColors: [] };
        }
        visited.add(normalizedPath);
        const theme = this.readJsonFile(normalizedPath);
        let base = { colors: {}, tokenColors: [] };
        if (theme.include) {
            base = this.loadThemeFile(path.resolve(path.dirname(normalizedPath), theme.include), visited);
        }
        return {
            colors: Object.assign({}, base.colors || {}, theme.colors || {}),
            tokenColors: []
                .concat(base.tokenColors || [])
                .concat(Array.isArray(theme.tokenColors) ? theme.tokenColors : []),
        };
    }
    getConfiguredTextMateRules() {
        const config = vscode.workspace.getConfiguration("editor");
        const customizations = config.get("tokenColorCustomizations") || {};
        const themeName = this.getCurrentColorTheme();
        const rules = [];
        if (Array.isArray(customizations.textMateRules)) {
            rules.push(...customizations.textMateRules);
        }
        const themeRules = customizations[`[${themeName}]`];
        if (themeRules && Array.isArray(themeRules.textMateRules)) {
            rules.push(...themeRules.textMateRules);
        }
        return rules;
    }
    getEditorThemeTokens() {
        const definition = this.findColorThemeDefinition(this.getCurrentColorTheme());
        const theme = definition ? this.loadThemeFile(definition.themePath) : { colors: {}, tokenColors: [] };
        return {
            colors: theme.colors || {},
            tokenColors: []
                .concat(theme.tokenColors || [])
                .concat(this.getConfiguredTextMateRules()),
        };
    }
    normalizeScopes(scope) {
        if (Array.isArray(scope)) {
            return scope.map((item) => String(item || "").trim()).filter(Boolean);
        }
        if (typeof scope === "string") {
            return scope.split(",").map((item) => item.trim()).filter(Boolean);
        }
        return [];
    }
    scopeMatches(ruleScope, wantedScope) {
        if (!ruleScope || !wantedScope) {
            return false;
        }
        return wantedScope === ruleScope || wantedScope.startsWith(`${ruleScope}.`);
    }
    findTokenForeground(tokenColors, wantedScopes) {
        for (const wanted of wantedScopes) {
            let color = "";
            let bestScore = -1;
            tokenColors.forEach((rule, index) => {
                const foreground = rule && rule.settings && rule.settings.foreground;
                if (!foreground) {
                    return;
                }
                const scopes = this.normalizeScopes(rule.scope);
                scopes.forEach((scope) => {
                    if (!this.scopeMatches(scope, wanted)) {
                        return;
                    }
                    const score = scope.length * 1000 + index;
                    if (score > bestScore) {
                        bestScore = score;
                        color = foreground;
                    }
                });
            });
            if (color) {
                return color;
            }
        }
        return "";
    }
    buildSubmissionCodeHighlightStyle() {
        const tokens = this.getEditorThemeTokens();
        const foreground = tokens.colors["editor.foreground"] || tokens.colors.foreground || "var(--vscode-editor-foreground, var(--lcpr-fg))";
        const resolve = (scopes, fallback) => this.findTokenForeground(tokens.tokenColors, scopes) || fallback || foreground;
        const colors = {
            keyword: resolve(["keyword", "storage", "storage.type"], "#cf222e"),
            functionName: resolve(["entity.name.function", "support.function"], "#8250df"),
            type: resolve(["support.type", "storage.type", "entity.name.type", "entity.name.class"], "#0550ae"),
            string: resolve(["string"], "#0a3069"),
            number: resolve(["constant.numeric", "constant"], "#0550ae"),
            comment: resolve(["comment", "punctuation.definition.comment"], "#6e7781"),
            variable: resolve(["variable", "entity.name", "meta.definition.variable"], "#953800"),
            meta: resolve(["meta.preprocessor", "keyword.control.directive", "meta"], "#0550ae"),
            property: resolve(["meta.property-name", "support.variable", "support"], "#0550ae"),
            literal: resolve(["constant.language", "constant"], "#0550ae"),
        };
        return `
/* lcpr-submission-highlight-v2: theme-derived, isolated from VSCode markdown highlight.css */
body .submission-code code.hljs,
body .submission-code code.hljs * {
  background: transparent !important;
  font-style: normal !important;
}
body .submission-code code.hljs {
  color: ${foreground} !important;
}
body .submission-code code.hljs .hljs-keyword,
body .submission-code code.hljs .hljs-selector-tag,
body .submission-code code.hljs .hljs-doctag {
  color: ${colors.keyword} !important;
}
body .submission-code code.hljs .hljs-title {
  color: ${colors.functionName} !important;
}
body .submission-code code.hljs .hljs-class,
body .submission-code code.hljs .hljs-type,
body .submission-code code.hljs .hljs-class .hljs-title {
  color: ${colors.type} !important;
}
body .submission-code code.hljs .hljs-function,
body .submission-code code.hljs .hljs-params {
  color: ${foreground} !important;
}
body .submission-code code.hljs .hljs-function .hljs-title {
  color: ${colors.functionName} !important;
}
body .submission-code code.hljs .hljs-built_in,
body .submission-code code.hljs .hljs-builtin-name {
  color: ${colors.property} !important;
}
body .submission-code code.hljs .hljs-string,
body .submission-code code.hljs .hljs-regexp,
body .submission-code code.hljs .hljs-symbol,
body .submission-code code.hljs .hljs-bullet,
body .submission-code code.hljs .hljs-addition {
  color: ${colors.string} !important;
}
body .submission-code code.hljs .hljs-number {
  color: ${colors.number} !important;
}
body .submission-code code.hljs .hljs-comment,
body .submission-code code.hljs .hljs-quote {
  color: ${colors.comment} !important;
}
body .submission-code code.hljs .hljs-variable,
body .submission-code code.hljs .hljs-template-variable,
body .submission-code code.hljs .hljs-name {
  color: ${colors.variable} !important;
}
body .submission-code code.hljs .hljs-meta,
body .submission-code code.hljs .hljs-meta-keyword,
body .submission-code code.hljs .hljs-tag {
  color: ${colors.meta} !important;
}
body .submission-code code.hljs .hljs-attr,
body .submission-code code.hljs .hljs-attribute,
body .submission-code code.hljs .hljs-link {
  color: ${colors.property} !important;
}
body .submission-code code.hljs .hljs-literal {
  color: ${colors.literal} !important;
}
body .submission-code code.hljs .hljs-deletion {
  color: var(--vscode-errorForeground, #cf222e) !important;
}
body .submission-code code.hljs .hljs-strong {
  font-weight: 700 !important;
}`;
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            enableCommandUris: true,
            localResourceRoots: this.getLocalResourceRoots(),
        };
        webviewView.webview.html = this.getHtml(webviewView);
        webviewView.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    }
    showDescription(description, node) {
        const incomingMode = ConfigUtils_1.isUseEndpointTranslation() ? "zh" : "en";
        const wantedMode = this.normalizeDescriptionMode(this.state.descriptionMode || incomingMode);
        this.state.descriptionMode = wantedMode;
        this.state.descriptionZh = incomingMode === "zh" ? description : undefined;
        this.state.descriptionEn = incomingMode === "en" ? description : undefined;
        this.state.description = incomingMode === "zh" ? this.state.descriptionZh : this.state.descriptionEn;
        this.state.descriptionStatus = undefined;
        this.state.node = node;
        this.state.activeTab = "description";
        this.revealAndRender(true);
        if ((wantedMode === "zh" && incomingMode !== "zh")
            || (wantedMode === "en" && incomingMode !== "en")
            || wantedMode === "both") {
            this.switchDescriptionMode(wantedMode);
        }
    }
    showDescriptionLoading(node, attempt = 1) {
        this.descriptionRequestSeq += 1;
        this.state.node = node;
        this.state.description = {
            title: node && node.name ? node.name : "力扣助手",
            url: "",
            body: "",
        };
        this.state.descriptionZh = undefined;
        this.state.descriptionEn = undefined;
        this.state.descriptionStatus = {
            loading: true,
            error: "",
            attempt,
            willRetry: true,
        };
        this.state.activeTab = "description";
        this.revealAndRender(true);
    }
    showDescriptionError(node, error, attempt = 1, willRetry = false) {
        this.descriptionRequestSeq += 1;
        this.state.node = node || this.state.node;
        this.state.description = {
            title: node && node.name ? node.name : "力扣助手",
            url: "",
            body: "",
        };
        this.state.descriptionZh = undefined;
        this.state.descriptionEn = undefined;
        this.state.descriptionStatus = {
            loading: false,
            error: String(error || "题面加载失败。"),
            attempt,
            willRetry: !!willRetry,
        };
        this.state.activeTab = "description";
        this.revealAndRender(true);
    }
    showSolution(solution) {
        this.state.solution = solution;
        this.state.activeTab = "solution";
        this.revealAndRender(true);
    }
    showHints(hints) {
        this.state.hints = Array.isArray(hints) ? hints : [];
        this.state.activeTab = this.state.description ? "description" : "hints";
        this.revealAndRender(true);
    }
    showSubmissions() {
        if (!this.state.node) {
            vscode.window.showWarningMessage("请先打开一道力扣题目。");
            return;
        }
        this.state.activeTab = "submissions";
        this.state.submissions.detail = undefined;
        this.revealAndRender(true);
        this.loadSubmissions();
    }
    getProblemInput() {
        const node = this.state.node || {};
        return String(node.qid || node.id || node.fid || "").trim();
    }
    getChildCall() {
        return BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy).get_instance();
    }
    parseJsonResponse(raw) {
        const text = String(raw || "").trim();
        if (!text) {
            return {};
        }
        try {
            return JSON.parse(text);
        }
        catch (_) {
            const start = text.indexOf("{");
            const end = text.lastIndexOf("}");
            if (start >= 0 && end > start) {
                try {
                    return JSON.parse(text.slice(start, end + 1));
                }
                catch (_) {
                    return {};
                }
            }
        }
        return {};
    }
    normalizeDescriptionMode(mode) {
        return ["zh", "en", "both"].includes(mode) ? mode : "zh";
    }
    activeDescriptionForMode(mode = this.state.descriptionMode) {
        const normalized = this.normalizeDescriptionMode(mode);
        if (normalized === "en") {
            return this.state.descriptionEn || this.state.description;
        }
        return this.state.descriptionZh || this.state.description;
    }
    descriptionTitleForMode(mode) {
        const node = this.state.node || {};
        if (mode === "en") {
            return node.en_name || node.enName || (this.state.descriptionEn && this.state.descriptionEn.title) || node.name || "力扣助手";
        }
        return node.cn_name || node.cnName || (this.state.descriptionZh && this.state.descriptionZh.title) || node.name || "力扣助手";
    }
    buildDescriptionFromPayload(payload, mode) {
        const msg = payload && payload.msg ? payload.msg : {};
        const rawDesc = String(msg.desc || "");
        return {
            title: msg.title || this.descriptionTitleForMode(mode),
            url: msg.url || "",
            tags: (this.state.node && this.state.node.tags) || [],
            companies: (this.state.node && this.state.node.companies) || [],
            category: msg.category || "",
            difficulty: msg.difficulty || "",
            likes: msg.likes || "",
            dislikes: msg.dislikes || "",
            body: rawDesc.replace(/<pre>[\r\n]*([^]+?)[\r\n]*<\/pre>/g, "<pre><code>$1</code></pre>"),
            contest_slug: (this.state.node && this.state.node.scoreData && this.state.node.scoreData.ContestSlug) || "-",
            problem_index: (this.state.node && this.state.node.scoreData && this.state.node.scoreData.ProblemIndex) || "-",
            problem_score: (this.state.node && this.state.node.scoreData && this.state.node.scoreData.score) || "0",
        };
    }
    async fetchDescriptionMode(mode, seq) {
        const normalized = this.normalizeDescriptionMode(mode);
        const raw = await this.getChildCall().getDescription(this.getProblemInput(), normalized === "zh");
        if (seq !== this.descriptionRequestSeq) {
            return;
        }
        const payload = this.parseJsonResponse(raw);
        if (payload.code !== 100 || !payload.msg) {
            throw new Error(String(payload.error || payload.msg || raw || "题面读取失败"));
        }
        const description = this.buildDescriptionFromPayload(payload, normalized);
        if (normalized === "zh") {
            this.state.descriptionZh = description;
        }
        else {
            this.state.descriptionEn = description;
        }
    }
    async switchDescriptionMode(mode) {
        const normalized = this.normalizeDescriptionMode(mode);
        if (!this.state.node) {
            return;
        }
        this.state.descriptionMode = normalized;
        this.state.activeTab = "description";
        this.state.descriptionStatus = undefined;
        const needsZh = (normalized === "zh" || normalized === "both") && !this.state.descriptionZh;
        const needsEn = (normalized === "en" || normalized === "both") && !this.state.descriptionEn;
        if (!needsZh && !needsEn) {
            this.state.description = this.activeDescriptionForMode(normalized);
            this.revealAndRender(true);
            return;
        }
        const seq = ++this.descriptionRequestSeq;
        this.state.description = this.activeDescriptionForMode(normalized);
        const target = normalized === "both" ? "双语题面" : normalized === "en" ? "英文题面" : "中文题面";
        this.state.descriptionStatus = {
            loading: true,
            error: "",
            detail: `正在加载${target}。`,
        };
        this.revealAndRender(true);
        try {
            if (needsZh) {
                await this.fetchDescriptionMode("zh", seq);
            }
            if (needsEn) {
                await this.fetchDescriptionMode("en", seq);
            }
            if (seq !== this.descriptionRequestSeq) {
                return;
            }
            this.state.description = this.activeDescriptionForMode(normalized);
            this.state.descriptionStatus = undefined;
        }
        catch (error) {
            if (seq !== this.descriptionRequestSeq) {
                return;
            }
            this.state.descriptionStatus = {
                loading: false,
                error: error && error.message ? error.message : String(error || "题面读取失败"),
                willRetry: false,
            };
        }
        this.revealAndRender(true);
    }
    async loadSubmissions() {
        const problemInput = this.getProblemInput();
        if (!problemInput) {
            this.state.submissions.error = "当前题目缺少题号，无法读取提交记录。";
            this.revealAndRender(true);
            return;
        }
        this.state.submissions.loading = true;
        this.state.submissions.error = "";
        this.state.submissions.detail = undefined;
        this.revealAndRender(true);
        try {
            const notes = await this.readSubmissionNotes();
            const raw = await this.getChildCall().getSubmissionHistory(problemInput);
            const payload = this.parseJsonResponse(raw);
            if (payload.code !== 100) {
                throw new Error(String(payload.error || payload.msg || raw || "提交记录读取失败"));
            }
            this.state.submissions.list = Array.isArray(payload.submissions) ? payload.submissions : [];
            this.sanitizeSubmissionFilters();
            this.state.submissions.notes = notes;
        }
        catch (error) {
            this.state.submissions.error = error && error.message ? error.message : String(error || "提交记录读取失败");
        }
        finally {
            this.state.submissions.loading = false;
            this.state.activeTab = "submissions";
            this.revealAndRender(true);
        }
    }
    async loadSubmissionDetail(id) {
        const problemInput = this.getProblemInput();
        const submissionId = String(id || "").trim();
        if (!problemInput || !submissionId) {
            return;
        }
        this.state.submissions.loading = true;
        this.state.submissions.error = "";
        this.revealAndRender(true);
        try {
            const raw = await this.getChildCall().getSubmissionHistoryDetail(problemInput, submissionId);
            const payload = this.parseJsonResponse(raw);
            if (payload.code !== 100) {
                throw new Error(String(payload.error || payload.msg || raw || "提交详情读取失败"));
            }
            const base = this.state.submissions.list.find((item) => String(item.id) === submissionId) || {};
            this.state.submissions.detail = Object.assign({}, base, payload.detail || {});
        }
        catch (error) {
            this.state.submissions.error = error && error.message ? error.message : String(error || "提交详情读取失败");
        }
        finally {
            this.state.submissions.loading = false;
            this.state.activeTab = "submissions";
            this.revealAndRender(true);
        }
    }
    getSubmissionNotesPath() {
        const problemInput = this.getProblemInput() || "unknown";
        const fileName = `${problemInput.replace(/[^a-z0-9_.-]/gi, "_")}.json`;
        const workspaceFolder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
        const globalStoragePath = this.context && this.context.globalStorageUri && this.context.globalStorageUri.fsPath
            ? this.context.globalStorageUri.fsPath
            : this.context && this.context.globalStoragePath
                ? this.context.globalStoragePath
                : path.join(require("os").homedir(), ".lcpr", "submission-notes");
        const base = workspaceFolder ? path.join(workspaceFolder.uri.fsPath, ".lcpr_data", "submission-notes") : path.join(globalStoragePath, "submission-notes");
        return path.join(base, fileName);
    }
    async readSubmissionNotes() {
        const notesPath = this.getSubmissionNotesPath();
        try {
            if (!(await fse.pathExists(notesPath))) {
                return {};
            }
            const data = await fse.readJson(notesPath);
            return this.normalizeSubmissionNotes(data);
        }
        catch (_) {
            return {};
        }
    }
    normalizeSubmissionNotes(notes) {
        if (!notes || typeof notes !== "object") {
            return {};
        }
        return Object.keys(notes).reduce((result, key) => {
            const value = this.normalizeNoteText(notes[key]);
            if (value) {
                result[key] = value;
            }
            return result;
        }, {});
    }
    normalizeNoteText(value) {
        if (typeof value === "string") {
            const text = value.trim();
            return text === "[object Object]" ? "" : text;
        }
        if (value && typeof value === "object") {
            const candidate = value.value || value.text || value.note || value.content;
            if (typeof candidate !== "string") {
                return "";
            }
            const text = candidate.trim();
            return text === "[object Object]" ? "" : text;
        }
        const text = String(value || "").trim();
        return text === "[object Object]" ? "" : text;
    }
    normalizeNoteSearch(value) {
        return this.normalizeNoteText(value).replace(/\s+/g, " ");
    }
    normalizeSearchText(value) {
        return this.normalizeNoteSearch(value).toLocaleLowerCase();
    }
    async writeSubmissionNotes(notes) {
        const notesPath = this.getSubmissionNotesPath();
        await fse.ensureDir(path.dirname(notesPath));
        await fse.writeJson(notesPath, notes || {}, { spaces: 2 });
    }
    async saveSubmissionNote(id, text) {
        const submissionId = String(id || "");
        if (!submissionId) {
            return;
        }
        const notes = Object.assign({}, this.normalizeSubmissionNotes(this.state.submissions.notes));
        const value = this.normalizeNoteText(text);
        try {
            if (value) {
                notes[submissionId] = value;
            }
            else {
                delete notes[submissionId];
            }
            this.state.submissions.notes = notes;
            await this.writeSubmissionNotes(notes);
            this.state.submissions.noteNotice = {
                id: submissionId,
                tone: "success",
                text: value ? "保存成功" : "已清空",
            };
        }
        catch (error) {
            this.state.submissions.noteNotice = {
                id: submissionId,
                tone: "error",
                text: error && error.message ? error.message : "备注保存失败",
            };
        }
        this.revealAndRender(true);
    }
    dispose() {
        this.view = undefined;
    }
    revealAndRender(preserveFocus) {
        if (this.view) {
            this.view.webview.html = this.getHtml(this.view);
            this.view.show(preserveFocus);
            return;
        }
        vscode.commands.executeCommand("workbench.view.extension.lcpr_companion_container").then(() => {
            if (this.view) {
                this.view.webview.html = this.getHtml(this.view);
                this.view.show(preserveFocus);
            }
        }, () => undefined);
    }
    handleMessage(message) {
        switch (message === null || message === void 0 ? void 0 : message.command) {
            case "showProblem":
                vscode.commands.executeCommand("lcpr.showProblem", this.state.node);
                break;
            case "showSubmissions":
                this.showSubmissions();
                break;
            case "refreshSubmissions":
                this.loadSubmissions();
                break;
            case "filterSubmissions":
                this.state.submissions.filters = Object.assign({}, this.state.submissions.filters, message.filters || {});
                this.revealAndRender(true);
                break;
            case "selectSubmission":
                this.loadSubmissionDetail(message.id);
                break;
            case "backSubmissions":
                this.state.submissions.detail = undefined;
                this.state.activeTab = "submissions";
                this.revealAndRender(true);
                break;
            case "showDescription":
                this.state.submissions.detail = undefined;
                this.state.activeTab = this.state.description ? "description" : "empty";
                this.revealAndRender(true);
                break;
            case "switchDescriptionLanguage":
                this.switchDescriptionMode(message.mode);
                break;
            case "loadProblemImageData":
                this.loadProblemImageData(message.requestId, message.src);
                break;
            case "saveSubmissionNote":
                this.saveSubmissionNote(message.id, message.text);
                break;
            case "copySubmissionCode":
                vscode.env.clipboard.writeText(String(message.code || ""));
                break;
            case "openExternal":
                if (message.href) {
                    vscode.env.openExternal(vscode.Uri.parse(message.href));
                }
                break;
            default:
                break;
        }
    }
    normalizeRemoteImageUrl(src) {
        const value = String(src || "").trim();
        if (!value) {
            return "";
        }
        const withProtocol = value.startsWith("//") ? `https:${value}` : value;
        try {
            const url = new URL(withProtocol);
            if (url.protocol !== "https:" && url.protocol !== "http:") {
                return "";
            }
            return url.toString();
        }
        catch (_) {
            return "";
        }
    }
    async loadProblemImageData(requestId, src) {
        const id = String(requestId || "");
        const url = this.normalizeRemoteImageUrl(src);
        if (!id || !this.view) {
            return;
        }
        if (!url) {
            this.view.webview.postMessage({ command: "problemImageData", requestId: id, src: String(src || ""), ok: false });
            return;
        }
        try {
            let dataUri = this.problemImageDataCache.get(url);
            if (!dataUri) {
                const image = await this.downloadRemoteImage(url);
                const mime = image.contentType && /^image\//i.test(image.contentType) ? image.contentType : "image/png";
                dataUri = `data:${mime};base64,${image.buffer.toString("base64")}`;
                this.problemImageDataCache.set(url, dataUri);
                if (this.problemImageDataCache.size > 60) {
                    const firstKey = this.problemImageDataCache.keys().next().value;
                    if (firstKey) {
                        this.problemImageDataCache.delete(firstKey);
                    }
                }
            }
            this.view.webview.postMessage({ command: "problemImageData", requestId: id, src: url, ok: true, dataUri });
        }
        catch (error) {
            if (this.view) {
                this.view.webview.postMessage({
                    command: "problemImageData",
                    requestId: id,
                    src: url,
                    ok: false,
                    error: error && error.message ? error.message : String(error || "图片读取失败"),
                });
            }
        }
    }
    downloadRemoteImage(urlString, redirects = 0) {
        return new Promise((resolve, reject) => {
            let url;
            try {
                url = new URL(urlString);
            }
            catch (error) {
                reject(error);
                return;
            }
            const client = url.protocol === "http:" ? http : https;
            const request = client.get(url, {
                headers: {
                    "User-Agent": "LeetcodeUltra/3.2.4",
                    "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
                },
            }, (response) => {
                const status = response.statusCode || 0;
                const location = response.headers.location;
                if (status >= 300 && status < 400 && location) {
                    response.resume();
                    if (redirects >= 4) {
                        reject(new Error("图片重定向次数过多"));
                        return;
                    }
                    const nextUrl = new URL(location, url).toString();
                    this.downloadRemoteImage(nextUrl, redirects + 1).then(resolve, reject);
                    return;
                }
                if (status < 200 || status >= 300) {
                    response.resume();
                    reject(new Error(`图片读取失败: HTTP ${status}`));
                    return;
                }
                const chunks = [];
                let total = 0;
                const maxBytes = 8 * 1024 * 1024;
                response.on("data", (chunk) => {
                    total += chunk.length;
                    if (total > maxBytes) {
                        request.destroy(new Error("图片过大"));
                        return;
                    }
                    chunks.push(chunk);
                });
                response.on("end", () => {
                    resolve({
                        buffer: Buffer.concat(chunks),
                        contentType: String(response.headers["content-type"] || "").split(";")[0].trim(),
                    });
                });
            });
            request.setTimeout(12000, () => request.destroy(new Error("图片读取超时")));
            request.on("error", reject);
        });
    }
    getHtml(webviewView) {
        const webview = webviewView.webview;
        const katesCssPath = path.join(__dirname, "..", "..", "..", "resources", "katexcss", "kates.min.css");
        const katexCssUri = webview.asWebviewUri(vscode.Uri.file(katesCssPath));
        const builtinStyles = MarkdownService_1.markdownService.getBuiltinStyles(webviewView);
        const activeTab = this.resolveActiveTab();
        const stateJson = JSON.stringify({ activeTab });
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
	  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data: ${webview.cspSource}; script-src 'unsafe-inline'; style-src ${webview.cspSource} 'unsafe-inline';">
	  ${builtinStyles}
	  <link rel="stylesheet" type="text/css" href="${katexCssUri}">
	  ${this.getStyle()}
</head>
<body>
  <svg class="lcpr-svg-filters" aria-hidden="true" focusable="false" width="0" height="0">
    <defs>
      <filter id="lcpr-invert-luminance" color-interpolation-filters="linearRGB">
        <feComponentTransfer>
          <feFuncR type="gamma" amplitude="1" exponent="0.5" offset="0" />
          <feFuncG type="gamma" amplitude="1" exponent="0.5" offset="0" />
          <feFuncB type="gamma" amplitude="1" exponent="0.5" offset="0" />
          <feFuncA type="gamma" amplitude="1" exponent="1" offset="0" />
        </feComponentTransfer>
        <feColorMatrix type="matrix" values="
          1 -1 -1 0 1
         -1 1 -1 0 1
         -1 -1 1 0 1
          0 0 0 1 0
        " />
      </filter>
    </defs>
  </svg>
  <main class="lcpr-companion">
    ${this.renderHeader()}
    <section class="lcpr-content">
      ${activeTab === "description" ? this.renderDescription() : ""}
      ${activeTab === "solution" ? this.renderSolution() : ""}
      ${activeTab === "hints" ? this.renderHints() : ""}
      ${activeTab === "submissions" ? this.renderSubmissions() : ""}
      ${activeTab === "empty" ? this.renderEmpty() : ""}
    </section>
  </main>
  <script>
    const vscode = acquireVsCodeApi();
    const state = Object.assign({}, vscode.getState() || {}, ${stateJson});
    vscode.setState(state);
    const FONT_LEVEL_MIN = -3;
    const FONT_LEVEL_MAX = 5;
    function clampFontLevel(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return 0;
      return Math.max(FONT_LEVEL_MIN, Math.min(FONT_LEVEL_MAX, Math.round(number)));
    }
    function getBaseFontSize() {
      const rootStyle = getComputedStyle(document.documentElement);
      const bodyStyle = getComputedStyle(document.body);
      const raw = rootStyle.getPropertyValue('--vscode-font-size') || bodyStyle.fontSize || '13px';
      const parsed = parseFloat(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 13;
    }
    function applyReadingFontSize() {
      state.readerFontLevel = clampFontLevel(state.readerFontLevel);
      const size = Math.max(11, Math.min(22, getBaseFontSize() + state.readerFontLevel));
      document.documentElement.style.setProperty('--lcpr-reading-font-size', size + 'px');
      document.querySelectorAll('[data-font-control]').forEach((button) => {
        const action = button.getAttribute('data-font-control');
        const disabled = action === 'decrease' ? state.readerFontLevel <= FONT_LEVEL_MIN : state.readerFontLevel >= FONT_LEVEL_MAX;
        button.disabled = disabled;
        button.setAttribute('aria-disabled', disabled ? 'true' : 'false');
      });
      vscode.setState(state);
    }
    applyReadingFontSize();
    function isDarkImageTheme() {
      return document.body.classList.contains('vscode-dark') ||
        (document.body.classList.contains('vscode-high-contrast') && !document.body.classList.contains('vscode-high-contrast-light'));
    }
    function pixelLuminance(r, g, b) {
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    function channelDistance(r, g, b, target) {
      return Math.max(Math.abs(r - target.r), Math.abs(g - target.g), Math.abs(b - target.b));
    }
    function findEdgeBackground(imageData, width, height) {
      const data = imageData.data;
      const step = Math.max(1, Math.floor(Math.max(width, height) / 160));
      const stats = {
        light: { count: 0, r: 0, g: 0, b: 0 },
        dark: { count: 0, r: 0, g: 0, b: 0 },
      };
      let samples = 0;
      function sample(x, y) {
        const index = (y * width + x) * 4;
        const a = data[index + 3];
        if (a < 32) return;
        samples += 1;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const chroma = max - min;
        const lum = pixelLuminance(r, g, b);
        const bucket = lum > 218 && chroma < 46 ? stats.light : lum < 42 && chroma < 46 ? stats.dark : null;
        if (!bucket) return;
        bucket.count += 1;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
      }
      for (let x = 0; x < width; x += step) {
        sample(x, 0);
        sample(x, height - 1);
      }
      for (let y = 0; y < height; y += step) {
        sample(0, y);
        sample(width - 1, y);
      }
      if (samples < 8) return null;
      const lightWins = stats.light.count >= stats.dark.count;
      const winner = lightWins ? stats.light : stats.dark;
      if (winner.count < Math.max(8, samples * 0.34)) return null;
      const kind = lightWins ? 'light' : 'dark';
      return {
        kind,
        r: winner.r / winner.count,
        g: winner.g / winner.count,
        b: winner.b / winner.count,
        luminance: pixelLuminance(winner.r / winner.count, winner.g / winner.count, winner.b / winner.count),
      };
    }
    function isNearEdgeBackground(data, index, target) {
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];
      if (a < 16) return true;
      const distance = channelDistance(r, g, b, target);
      const lumDelta = Math.abs(pixelLuminance(r, g, b) - target.luminance);
      return distance <= 58 && lumDelta <= 58;
    }
    function removeEdgeConnectedBackground(imageData, width, height, target) {
      const data = imageData.data;
      const total = width * height;
      const seen = new Uint8Array(total);
      const stack = [];
      let changed = 0;
      function push(pixel) {
        if (pixel < 0 || pixel >= total || seen[pixel]) return;
        const index = pixel * 4;
        if (!isNearEdgeBackground(data, index, target)) return;
        seen[pixel] = 1;
        stack.push(pixel);
      }
      for (let x = 0; x < width; x += 1) {
        push(x);
        push((height - 1) * width + x);
      }
      for (let y = 0; y < height; y += 1) {
        push(y * width);
        push(y * width + width - 1);
      }
      while (stack.length) {
        const pixel = stack.pop();
        const index = pixel * 4;
        const originalAlpha = data[index + 3];
        const distance = channelDistance(data[index], data[index + 1], data[index + 2], target);
        const alphaRatio = Math.max(0, Math.min(1, (distance - 12) / 42));
        const nextAlpha = Math.round(originalAlpha * alphaRatio);
        if (nextAlpha !== originalAlpha) {
          data[index + 3] = nextAlpha;
          changed += 1;
        }
        const x = pixel % width;
        if (x > 0) push(pixel - 1);
        if (x + 1 < width) push(pixel + 1);
        if (pixel >= width) push(pixel - width);
        if (pixel + width < total) push(pixel + width);
      }
      return changed;
    }
    function invertOpaquePixels(imageData) {
      const data = imageData.data;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] < 4) continue;
        data[index] = 255 - data[index];
        data[index + 1] = 255 - data[index + 1];
        data[index + 2] = 255 - data[index + 2];
      }
    }
    const imageDataRequests = new Map();
    let imageDataRequestSeq = 0;
    function processBackgroundAwareImage(img, sourceImage, source) {
      const width = sourceImage.naturalWidth || sourceImage.width;
      const height = sourceImage.naturalHeight || sourceImage.height;
      if (!width || !height || width * height > 4000000) {
        img.dataset.lcprBgProcessed = 'skipped';
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        img.dataset.lcprBgProcessed = 'skipped';
        return;
      }
      try {
        context.drawImage(sourceImage, 0, 0, width, height);
        const imageData = context.getImageData(0, 0, width, height);
        const target = findEdgeBackground(imageData, width, height);
        if (!target) {
          img.dataset.lcprBgProcessed = 'skipped';
          return;
        }
        const changed = removeEdgeConnectedBackground(imageData, width, height, target);
        if (changed < Math.max(16, width * height * 0.01)) {
          img.dataset.lcprBgProcessed = 'skipped';
          return;
        }
        const sourceIsDark = target.kind === 'dark';
        if (sourceIsDark !== isDarkImageTheme()) {
          invertOpaquePixels(imageData);
        }
        context.putImageData(imageData, 0, 0);
        img.dataset.lcprOriginalSrc = source;
        img.src = canvas.toDataURL('image/png');
        img.classList.add('lcpr-image-bg-transparent');
        img.dataset.lcprBgProcessed = 'done';
      } catch (_) {
        img.dataset.lcprBgProcessed = 'skipped';
      }
    }
    function processBackgroundAwareImageData(img, dataUri, source) {
      const sourceImage = new Image();
      sourceImage.decoding = 'async';
      sourceImage.onload = () => processBackgroundAwareImage(img, sourceImage, source);
      sourceImage.onerror = () => fallbackBackgroundAwareImage(img, source);
      sourceImage.src = dataUri;
    }
    function fallbackBackgroundAwareImage(img, source) {
      const sourceImage = new Image();
      sourceImage.crossOrigin = 'anonymous';
      sourceImage.decoding = 'async';
      sourceImage.onload = () => processBackgroundAwareImage(img, sourceImage, source);
      sourceImage.onerror = () => {
        img.dataset.lcprBgProcessed = 'skipped';
      };
      sourceImage.src = source;
    }
    function prepareBackgroundAwareImage(img) {
      if (!img || img.dataset.lcprBgProcessed === 'pending' || img.dataset.lcprBgProcessed === 'done') return;
      const source = img.dataset.lcprOriginalSrc || img.currentSrc || img.getAttribute('src') || '';
      if (!source || source.startsWith('file:')) {
        img.dataset.lcprBgProcessed = 'skipped';
        return;
      }
      img.dataset.lcprBgProcessed = 'pending';
      if (source.startsWith('data:')) {
        processBackgroundAwareImageData(img, source, source);
        return;
      }
      const requestId = 'lcpr-image-' + (++imageDataRequestSeq);
      imageDataRequests.set(requestId, { img, source });
      vscode.postMessage({ command: 'loadProblemImageData', requestId, src: source });
    }
    window.addEventListener('message', (event) => {
      const message = event.data || {};
      if (message.command !== 'problemImageData') return;
      const pending = imageDataRequests.get(message.requestId);
      if (!pending) return;
      imageDataRequests.delete(message.requestId);
      const img = pending.img;
      if (!img || !img.isConnected || img.dataset.lcprBgProcessed !== 'pending') return;
      if (message.ok && message.dataUri) {
        processBackgroundAwareImageData(img, message.dataUri, pending.source);
      } else {
        fallbackBackgroundAwareImage(img, pending.source);
      }
    });
    function applyBackgroundAwareImages() {
      document.querySelectorAll('img[data-lcpr-problem-image="true"]').forEach(prepareBackgroundAwareImage);
    }
    function resetBackgroundAwareImages() {
      document.querySelectorAll('img[data-lcpr-problem-image="true"]').forEach((img) => {
        const original = img.dataset.lcprOriginalSrc;
        if (original) img.src = original;
        img.classList.remove('lcpr-image-bg-transparent');
        delete img.dataset.lcprBgProcessed;
      });
      window.setTimeout(applyBackgroundAwareImages, 0);
    }
    applyBackgroundAwareImages();
    new MutationObserver((records) => {
      if (records.some((record) => record.attributeName === 'class')) {
        resetBackgroundAwareImages();
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const noteSearch = document.querySelector('[data-submission-note-search]');
    function normalizeClientSearch(value) {
      return String(value || '').trim().replace(/\\s+/g, ' ').toLocaleLowerCase();
    }
    function applySubmissionNoteSearch() {
      if (!noteSearch) return;
      const query = normalizeClientSearch(noteSearch.value);
      state.submissionNoteSearch = noteSearch.value || '';
      vscode.setState(state);
      const rows = Array.from(document.querySelectorAll('[data-submission-row]'));
      let visible = 0;
      rows.forEach((row) => {
        const note = normalizeClientSearch(row.getAttribute('data-note') || '');
        const matched = !query || note.includes(query);
        row.hidden = !matched;
        if (matched) visible += 1;
      });
      const count = document.querySelector('[data-submission-count]');
      if (count) {
        const total = count.getAttribute('data-total-count') || String(rows.length);
        count.textContent = visible + ' / ' + total;
      }
      const empty = document.querySelector('[data-submission-note-empty]');
      if (empty) {
        empty.hidden = !query || visible > 0;
      }
    }
    if (noteSearch && typeof state.submissionNoteSearch === 'string') {
      noteSearch.value = state.submissionNoteSearch;
    }
    let noteSearchComposing = false;
    applySubmissionNoteSearch();
    function closeSubmissionFilters(except) {
      document.querySelectorAll('[data-filter-root].open').forEach((root) => {
        if (except && root === except) return;
        root.classList.remove('open');
        const button = root.querySelector('[data-filter-toggle]');
        if (button) button.setAttribute('aria-expanded', 'false');
      });
    }
    document.addEventListener('click', (event) => {
      const clicked = event.target && event.target.closest ? event.target : event.target && event.target.parentElement;
      if (!clicked || !clicked.closest) return;
      const fontControl = clicked.closest('[data-font-control]');
      if (fontControl) {
        const action = fontControl.getAttribute('data-font-control');
        state.readerFontLevel = clampFontLevel(state.readerFontLevel) + (action === 'increase' ? 1 : -1);
        applyReadingFontSize();
        return;
      }
      const toggle = clicked.closest('[data-toggle-code]');
      if (toggle) {
        const code = document.querySelector('[data-submission-code]');
        if (code) {
          const collapsed = code.classList.toggle('is-collapsed');
          toggle.textContent = collapsed ? '查看更多' : '收起代码';
        }
        return;
      }
      const filterToggle = clicked.closest('[data-filter-toggle]');
      if (filterToggle) {
        const root = filterToggle.closest('[data-filter-root]');
        const willOpen = root && !root.classList.contains('open');
        closeSubmissionFilters(root);
        if (root) {
          root.classList.toggle('open', willOpen);
          filterToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
        }
        return;
      }
      const filterOption = clicked.closest('[data-filter-value]');
      if (filterOption) {
        const kind = filterOption.getAttribute('data-filter-kind');
        const value = filterOption.getAttribute('data-filter-value');
        closeSubmissionFilters();
        vscode.postMessage({ command: 'filterSubmissions', filters: { [kind]: value } });
        return;
      }
      const target = clicked.closest('[data-command]');
      if (!target) {
        closeSubmissionFilters();
        return;
      }
      const command = target.getAttribute('data-command');
      if (command === 'selectSubmission') {
        vscode.postMessage({ command, id: target.getAttribute('data-id') });
      } else if (command === 'switchDescriptionLanguage') {
        vscode.postMessage({ command, mode: target.getAttribute('data-mode') });
      } else if (command === 'saveSubmissionNote') {
        const textarea = document.querySelector('[data-submission-note]');
        vscode.postMessage({ command, id: target.getAttribute('data-id'), text: textarea ? textarea.value : '' });
      } else if (command === 'copySubmissionCode') {
        const code = document.querySelector('[data-submission-code]');
        vscode.postMessage({ command, code: code ? code.textContent : '' });
      } else {
        vscode.postMessage({ command });
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeSubmissionFilters();
      }
    });
    function autosizeSubmissionNote(textarea) {
      if (!textarea) return;
      textarea.style.height = 'auto';
      const next = Math.min(Math.max(textarea.scrollHeight, 60), 220);
      textarea.style.height = next + 'px';
      textarea.style.overflowY = textarea.scrollHeight > 220 ? 'auto' : 'hidden';
    }
    document.querySelectorAll('[data-submission-note]').forEach(autosizeSubmissionNote);
    document.addEventListener('input', (event) => {
      if (event.target && event.target.matches('[data-submission-note]')) {
        autosizeSubmissionNote(event.target);
      } else if (event.target && event.target.matches('[data-submission-note-search]')) {
        if (!noteSearchComposing) {
          applySubmissionNoteSearch();
        }
      }
    });
    document.addEventListener('compositionstart', (event) => {
      if (event.target && event.target.matches('[data-submission-note-search]')) {
        noteSearchComposing = true;
      }
    });
    document.addEventListener('compositionend', (event) => {
      if (event.target && event.target.matches('[data-submission-note-search]')) {
        noteSearchComposing = false;
        applySubmissionNoteSearch();
      }
    });
    document.querySelectorAll('a[href]').forEach((link) => {
      link.addEventListener('click', (event) => {
        const href = link.getAttribute('href');
        if (/^https?:/.test(href || '')) {
          event.preventDefault();
          vscode.postMessage({ command: 'openExternal', href });
        }
      });
    });
  </script>
</body>
</html>`;
    }
    resolveActiveTab() {
        if (this.state.activeTab === "description" && this.state.description) {
            return "description";
        }
        if (this.state.activeTab === "description" && this.state.descriptionStatus) {
            return "description";
        }
        if (this.state.activeTab === "solution" && this.state.solution) {
            return "solution";
        }
        if (this.state.activeTab === "hints" && this.state.hints) {
            return "hints";
        }
        if (this.state.activeTab === "submissions" && this.state.node) {
            return "submissions";
        }
        if (this.state.description) {
            return "description";
        }
        if (this.state.solution) {
            return "solution";
        }
        if (this.state.hints) {
            return "hints";
        }
        return "empty";
    }
    renderHeader() {
        const d = this.activeDescriptionForMode();
        const s = this.state.solution;
        const activeTab = this.resolveActiveTab();
        if (activeTab === "submissions") {
            return "";
        }
        const title = this.formatProblemTitle((d === null || d === void 0 ? void 0 : d.title) || (s === null || s === void 0 ? void 0 : s.title) || "力扣助手");
        const url = (d === null || d === void 0 ? void 0 : d.url) || (s === null || s === void 0 ? void 0 : s.url);
        return `<header class="lcpr-header">
  <div class="lcpr-title-row">
    <h1>${url ? `<a href="${this.escapeAttr(url)}">${this.escapeHtml(title)}</a>` : this.escapeHtml(title)}</h1>
    ${this.shouldShowCodeNow(activeTab) ? `<button class="lcpr-icon-button" data-command="showProblem" title="开始写代码" aria-label="开始写代码">&lt;/&gt;</button>` : ""}
  </div>
  ${activeTab === "description" ? this.renderDescriptionToolbar() : ""}
</header>`;
    }
    renderDescriptionToolbar() {
        return `<div class="lcpr-header-tools">${this.renderDescriptionModeControls()}${this.renderFontControls()}</div>`;
    }
    renderDescriptionModeControls() {
        if (!this.state.node) {
            return "";
        }
        const current = this.normalizeDescriptionMode(this.state.descriptionMode);
        const modes = [
            ["zh", "中文"],
            ["en", "EN"],
            ["both", "对照"],
        ];
        return `<span class="lcpr-lang-segment" role="group" aria-label="题面语言">
  ${modes.map(([mode, label]) => `<button type="button" data-command="switchDescriptionLanguage" data-mode="${mode}" class="${current === mode ? "current" : ""}" aria-pressed="${current === mode ? "true" : "false"}">${label}</button>`).join("")}
</span>`;
    }
    shouldShowCodeNow(activeTab) {
        return !!(this.state.node && activeTab !== "submissions" && !ConfigUtils_1.autoCreateFileOnPreview());
    }
    renderFontControls() {
        return `<span class="lcpr-font-controls" role="group" aria-label="题面字号">
  <button class="lcpr-font-button" type="button" data-font-control="decrease" title="缩小字号" aria-label="缩小字号">A-</button>
  <button class="lcpr-font-button" type="button" data-font-control="increase" title="放大字号" aria-label="放大字号">A+</button>
</span>`;
    }
    renderDescription() {
        const mode = this.normalizeDescriptionMode(this.state.descriptionMode);
        const d = this.activeDescriptionForMode(mode);
        if (this.state.descriptionStatus) {
            return this.renderDescriptionStatus();
        }
        if (!d) {
            return this.renderEmpty("还没有题面。");
        }
        if (mode === "both") {
            return this.renderBilingualDescription();
        }
        const links = [
            `<a class="lcpr-secondary-link" href="${this.escapeAttr(this.getSolutionLink(d.url))}">题解</a>`,
            `<a class="lcpr-secondary-link" href="${this.escapeAttr(this.getDiscussionLink(d.url))}">讨论</a>`,
            `<button class="lcpr-secondary-link" data-command="showSubmissions">提交记录</button>`,
        ].join("");
        return `<article class="lcpr-pane lcpr-markdown">
  <div class="lcpr-body">${this.refineProblemBody(d.body || "")}</div>
  ${this.renderInlineHints()}
  <div class="lcpr-meta-footer">
    <div class="lcpr-secondary-actions"><span class="lcpr-secondary-links">${links}</span></div>
    ${this.renderTargets(d)}
  </div>
</article>`;
    }
    renderBilingualDescription() {
        const zh = this.state.descriptionZh;
        const en = this.state.descriptionEn;
        const d = zh || en || this.state.description;
        if (!zh || !en || !d) {
            return this.renderEmpty("双语题面还没有加载完成。");
        }
        const links = [
            `<a class="lcpr-secondary-link" href="${this.escapeAttr(this.getSolutionLink(d.url))}">题解</a>`,
            `<a class="lcpr-secondary-link" href="${this.escapeAttr(this.getDiscussionLink(d.url))}">讨论</a>`,
            `<button class="lcpr-secondary-link" data-command="showSubmissions">提交记录</button>`,
        ].join("");
        return `<article class="lcpr-pane lcpr-markdown">
  <div class="lcpr-bilingual">
    <section class="lcpr-bilingual-section">
      <div class="lcpr-bilingual-label">中文</div>
      <div class="lcpr-body">${this.refineProblemBody(zh.body || "")}</div>
    </section>
    <section class="lcpr-bilingual-section">
      <div class="lcpr-bilingual-label">English</div>
      <div class="lcpr-body">${this.refineProblemBody(en.body || "")}</div>
    </section>
  </div>
  ${this.renderInlineHints()}
  <div class="lcpr-meta-footer">
    <div class="lcpr-secondary-actions"><span class="lcpr-secondary-links">${links}</span></div>
    ${this.renderTargets(d)}
  </div>
</article>`;
    }
    renderDescriptionStatus() {
        const status = this.state.descriptionStatus || {};
        const title = status.loading ? "正在加载题面" : "题面加载失败";
        const detail = status.loading
            ? (status.detail || `正在请求题面${status.attempt ? `（第 ${status.attempt} 次）` : ""}。`)
            : `${status.error || "题面加载失败。"}${status.willRetry ? " 正在重试。" : ""}`;
        return `<article class="lcpr-pane">
  <div class="lcpr-load-state ${status.loading ? "loading" : "error"}">
    <div class="lcpr-load-title">${this.escapeHtml(title)}</div>
    <p>${this.escapeHtml(detail)}</p>
  </div>
</article>`;
    }
    renderSolution() {
        const s = this.state.solution;
        if (!s) {
            return this.renderEmpty("还没有题解。");
        }
        const auth = s.is_cn ? `https://leetcode.cn/u/${s.author}/` : `https://leetcode.com/${s.author}/`;
        const body = this.prepareProblemImages(MarkdownService_1.markdownService.render(s.body || "", {
            lang: s.lang,
            host: "https://discuss.leetcode.com/",
        }));
        return `<article class="lcpr-pane lcpr-markdown">
  <div class="lcpr-section-meta">
    <span>${this.escapeHtml(s.lang || "-")}</span>
    <a href="${this.escapeAttr(auth)}">${this.escapeHtml(s.author || "-")}</a>
    <span>${this.escapeHtml(s.votes || "0")} votes</span>
  </div>
  <div class="lcpr-body">${body}</div>
</article>`;
    }
    renderHints() {
        const hints = this.state.hints;
        if (!hints || !hints.length) {
            return this.renderEmpty("本题无提示。");
        }
        return `<article class="lcpr-pane lcpr-hints">
${hints.map((hint, index) => `<details class="lcpr-hint" ${index === 0 ? "open" : ""}>
  <summary>提示 ${index + 1}</summary>
  <div class="lcpr-markdown">${this.prepareProblemImages(MarkdownService_1.markdownService.render(String(hint || "")))}</div>
</details>`).join("")}
</article>`;
    }
    renderInlineHints() {
        const hints = this.state.hints;
        if (!hints || !hints.length) {
            return "";
        }
        return `<section class="lcpr-inline-hints">
  <div class="lcpr-inline-title">提示</div>
  ${hints.map((hint, index) => `<details class="lcpr-hint" ${index === 0 ? "open" : ""}>
    <summary>提示 ${index + 1}</summary>
    <div class="lcpr-markdown">${this.prepareProblemImages(MarkdownService_1.markdownService.render(String(hint || "")))}</div>
  </details>`).join("")}
</section>`;
    }
    renderSubmissions() {
        const submissions = this.state.submissions;
        const detail = submissions.detail;
        return `<article class="lcpr-pane lcpr-submissions">
  ${submissions.error ? `<div class="lcpr-callout lcpr-error">${this.escapeHtml(submissions.error)}</div>` : ""}
  ${submissions.loading ? `<div class="lcpr-loading">正在读取提交记录...</div>` : ""}
  ${detail ? this.renderSubmissionDetail(detail) : this.renderSubmissionList()}
</article>`;
    }
    filteredSubmissions() {
        this.sanitizeSubmissionFilters();
        const state = this.state.submissions;
        const filters = state.filters || {};
        return (state.list || []).filter((item) => {
            const status = String(item.status || "");
            const lang = String(item.lang || "");
            const statusMatch = filters.status === "all" || !filters.status
                || (filters.status === "accepted" && item.accepted)
                || (filters.status === "failed" && !item.accepted)
                || status === filters.status;
            const langMatch = filters.lang === "all" || !filters.lang || lang === filters.lang;
            return statusMatch && langMatch;
        });
    }
    sanitizeSubmissionFilters() {
        const submissions = this.state.submissions;
        const filters = Object.assign({ status: "all", lang: "all" }, submissions.filters || {});
        const list = submissions.list || [];
        const langs = new Set(list.map((item) => String(item.lang || "").trim()).filter(Boolean));
        const statuses = new Set(list.map((item) => String(item.status || "").trim()).filter(Boolean));
        if (filters.lang !== "all" && !langs.has(filters.lang)) {
            filters.lang = "all";
        }
        if (!["all", "accepted", "failed"].includes(filters.status) && !statuses.has(filters.status)) {
            filters.status = "all";
        }
        delete filters.note;
        submissions.filters = filters;
    }
    renderSubmissionList() {
        const submissions = this.state.submissions;
        const list = submissions.list || [];
        const filtered = this.filteredSubmissions();
        const statusValue = (submissions.filters && submissions.filters.status) || "all";
        const langValue = (submissions.filters && submissions.filters.lang) || "all";
        const statusItems = [
            { label: "全部状态", value: "all" },
            { label: "通过", value: "accepted" },
            { label: "错误", value: "failed" },
        ];
        const langItems = [{ label: "全部语言", value: "all" }].concat([...new Set(list.map((item) => String(item.lang || "").trim()).filter(Boolean))].map((lang) => ({ label: lang, value: lang })));
        return `<section class="submission-list-view">
  <div class="submission-titlebar">
    <div>
      <div class="submission-title">提交记录</div>
      <div class="submission-count" data-submission-count data-total-count="${this.escapeAttr(String(list.length))}">${this.escapeHtml(String(filtered.length))} / ${this.escapeHtml(String(list.length))}</div>
    </div>
    <div class="submission-title-actions">
      <button class="lcpr-plain-button" data-command="showDescription">返回题目</button>
      <button class="lcpr-plain-button" data-command="refreshSubmissions">刷新</button>
    </div>
  </div>
  <div class="submission-toolbar">
    ${this.renderSubmissionStatusSegments(statusValue, statusItems)}
    ${this.renderSubmissionLanguageFilter(langValue, langItems)}
  </div>
  <label class="submission-note-search">
    <span>备注搜索</span>
    <input type="text" role="searchbox" autocomplete="off" autocorrect="off" spellcheck="false" data-submission-note-search>
  </label>
  ${filtered.length ? `<div class="submission-rows" data-submission-rows>${filtered.map((item, index) => this.renderSubmissionRow(item, index)).join("")}</div><div class="lcpr-empty compact submission-search-empty" data-submission-note-empty hidden><div class="lcpr-empty-title">没有匹配的备注</div><p>换一个关键词试试。</p></div>` : `<div class="lcpr-empty compact"><div class="lcpr-empty-title">暂无提交</div><p>当前筛选条件下没有提交记录。</p></div>`}
</section>`;
    }
    renderSubmissionStatusSegments(currentValue, items) {
        const current = String(currentValue || "all");
        const labels = {
            all: "全部",
            accepted: "通过",
            failed: "错误",
        };
        const buttons = (items || []).map((item) => {
            const value = String(item.value || "");
            const selected = value === current;
            return `<button class="submission-status-segment${selected ? " current" : ""}" type="button" aria-pressed="${selected ? "true" : "false"}" data-filter-kind="status" data-filter-value="${this.escapeAttr(value)}">${this.escapeHtml(labels[value] || item.label || value)}</button>`;
        }).join("");
        return `<div class="submission-status-segments" role="group" aria-label="提交状态筛选">${buttons}</div>`;
    }
    renderSubmissionLanguageFilter(currentValue, items) {
        const current = String(currentValue || "all");
        const text = this.langFilterText(current);
        const options = (items || []).map((item) => {
            const value = String(item.value || "");
            const selected = value === current;
            return `<button class="submission-filter-option${selected ? " current" : ""}" type="button" role="option" aria-selected="${selected ? "true" : "false"}" data-filter-kind="lang" data-filter-value="${this.escapeAttr(value)}">
  <span class="submission-filter-check">${selected ? "✓" : ""}</span>
  <span>${this.escapeHtml(item.label || value)}</span>
</button>`;
        }).join("");
        return `<div class="submission-filter" data-filter-root data-kind="lang">
  <button class="submission-filter-button" type="button" data-filter-toggle aria-haspopup="listbox" aria-expanded="false">
    <span class="submission-filter-label">语言</span>
    <span class="submission-filter-value">${this.escapeHtml(text)}</span>
    <span class="submission-filter-mark" aria-hidden="true"><span></span><span></span></span>
  </button>
  <div class="submission-filter-menu" role="listbox">
    ${options}
  </div>
</div>`;
    }
    renderSubmissionMetricIcon(kind) {
        if (kind === "memory") {
            return `<svg class="submission-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 12v-2"></path><path d="M12 18v-2"></path><path d="M16 12v-2"></path><path d="M16 18v-2"></path><path d="M2 11h1.5"></path><path d="M20 18v-2"></path><path d="M20.5 11H22"></path><path d="M4 18v-2"></path><path d="M8 12v-2"></path><path d="M8 18v-2"></path><rect x="2" y="6" width="20" height="10" rx="2"></rect></svg>`;
        }
        return `<svg class="submission-row-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>`;
    }
    renderSubmissionRow(item, index) {
        const id = String(item.id || "");
        const rawNote = this.normalizeNoteSearch((this.state.submissions.notes || {})[id]);
        const note = this.notePreview(rawNote);
        const status = this.statusText(item.status);
        const tone = item.accepted ? "accepted" : "failed";
        const lang = String(item.lang || "-");
        const runtime = item.runtime || "-";
        const memory = item.memory || "-";
        return `<button class="submission-row ${tone}" data-command="selectSubmission" data-id="${this.escapeAttr(id)}" data-submission-row data-note="${this.escapeAttr(rawNote)}">
  <span class="submission-status-group"><span class="submission-status">${this.escapeHtml(status)}</span><span class="submission-lang-pill">${this.escapeHtml(lang)}</span></span>
  <span class="submission-row-time">${this.escapeHtml(this.formatTime(item))}</span>
  <span class="submission-note-preview">${note ? this.escapeHtml(note) : `<span class="submission-note-empty">无备注</span>`}</span>
  <span class="submission-row-metrics"><span class="submission-row-metric" title="内存">${this.renderSubmissionMetricIcon("memory")}<em>${this.escapeHtml(memory)}</em></span><span class="submission-row-divider"></span><span class="submission-row-metric" title="时间">${this.renderSubmissionMetricIcon("time")}<em>${this.escapeHtml(runtime)}</em></span></span>
</button>`;
    }
    renderSubmissionDetail(detail) {
        const id = String(detail.id || "");
        const note = this.normalizeNoteText((this.state.submissions.notes || {})[id]);
        const notice = this.state.submissions.noteNotice;
        const noticeHtml = notice && notice.id === id
            ? `<span class="submission-note-notice ${this.escapeAttr(notice.tone || "success")}">${this.escapeHtml(notice.text || "")}</span>`
            : "";
        const code = String(detail.code || "");
        const lang = String(detail.lang || "-");
        const highlightedCode = this.highlightSubmissionCode(code, lang);
        const codeLang = this.resolveHighlightLanguage(lang);
        const codeClass = codeLang ? ` class="hljs language-${this.escapeAttr(codeLang)}"` : ` class="hljs"`;
        return `<section class="submission-detail-view">
  <div class="submission-detail-nav">
    <button class="lcpr-plain-button" data-command="backSubmissions">返回记录</button>
    <div class="submission-title-actions">
      <button class="lcpr-plain-button" data-command="showDescription">返回题目</button>
      <button class="lcpr-plain-button" data-command="refreshSubmissions">刷新</button>
    </div>
  </div>
  <div class="submission-detail-head ${detail.accepted ? "accepted" : "failed"}">
    <div class="submission-detail-status">${this.escapeHtml(this.statusText(detail.status))}</div>
    <div class="submission-detail-case">${this.escapeHtml(this.caseText(detail))}</div>
    <div class="submission-detail-meta"><span class="submission-lang-pill">${this.escapeHtml(lang)}</span></div>
    <div class="submission-detail-time">${this.escapeHtml(this.formatTime(detail))}</div>
  </div>
  ${this.renderPerformance(detail)}
  <section class="submission-section">
    <div class="submission-section-head">
      <span>代码</span>
      <button class="lcpr-plain-button" data-command="copySubmissionCode">复制</button>
    </div>
    ${code ? `<pre class="submission-code is-collapsed" data-submission-code data-highlight-version="v2"><code${codeClass}>${highlightedCode}</code></pre><button class="lcpr-plain-button submission-code-toggle" data-toggle-code>查看更多</button>` : `<div class="lcpr-empty compact"><div class="lcpr-empty-title">暂无代码</div><p>力扣没有返回本次提交代码。</p></div>`}
  </section>
  <section class="submission-section">
    <div class="submission-section-head"><span>备注</span></div>
    <textarea data-submission-note placeholder="为这次提交留一点线索">${this.escapeHtml(note)}</textarea>
    <div class="submission-note-actions">
      <button class="lcpr-action-button" data-command="saveSubmissionNote" data-id="${this.escapeAttr(id)}">保存备注</button>
      ${noticeHtml}
    </div>
  </section>
</section>`;
    }
    renderEmpty(message = "打开一道题或获取题解后，这里会显示上下文。") {
        return `<div class="lcpr-empty">
  <div class="lcpr-empty-title">暂无内容</div>
  <p>${this.escapeHtml(message)}</p>
</div>`;
    }
    renderTargets(description) {
        const tags = Array.isArray(description.tags) ? description.tags : [];
        const rows = [
            description.difficulty ? `<span class="lcpr-chip lcpr-${String(description.difficulty).toLowerCase()}">${this.escapeHtml(description.difficulty)}</span>` : "",
            description.problem_score ? `<span class="lcpr-chip">分数 ${this.escapeHtml(description.problem_score)}</span>` : "",
            description.category ? `<span class="lcpr-chip">${this.escapeHtml(description.category)}</span>` : "",
            description.contest_slug && description.contest_slug !== "-" ? `<span class="lcpr-chip">${this.escapeHtml(description.contest_slug)}</span>` : "",
            description.problem_index && description.problem_index !== "-" ? `<span class="lcpr-chip">${this.escapeHtml(description.problem_index)}</span>` : "",
        ].filter(Boolean).join("");
        const tagHtml = tags.length ? `<div class="lcpr-tags">${tags.map((tag) => `<a href="https://leetcode.com/tag/${this.escapeAttr(tag)}">${this.escapeHtml(tag)}</a>`).join("")}</div>` : "";
        if (!rows && !tagHtml) {
            return "";
        }
        return `<details class="lcpr-targets">
  <summary>难度与标签</summary>
  ${rows ? `<div class="lcpr-chips">${rows}</div>` : ""}
  ${tagHtml}
</details>`;
    }
    formatProblemTitle(title) {
        const number = this.state.node && (this.state.node.qid || this.state.node.id || this.state.node.fid);
        const raw = String(title || "");
        if (!number || raw.startsWith(`${number}.`) || raw.startsWith(`${number} `)) {
            return raw;
        }
        return `${number}. ${raw}`;
    }
    refineProblemBody(body) {
        const refined = String(body || "")
            .replace(/(<h[1-6][^>]*>\s*)提示\s*[:：]?\s*(<\/h[1-6]>)/g, "$1约束$2")
            .replace(/(<strong[^>]*>\s*)提示\s*[:：]?\s*(<\/strong>)/g, "$1约束$2")
            .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g, (match, rawCode) => {
            const code = rawCode.replace(/<\/?code\b[^>]*>/g, "");
            const blocks = this.parseExampleCode(code);
            if (!blocks) {
                return match;
            }
            return `<div class="lcpr-example-split">${blocks.map((block) => `<div class="lcpr-example-row">
  <div class="lcpr-example-label">${this.escapeHtml(block.label)}</div>
  <code class="lcpr-example-value">${block.value}</code>
</div>`).join("")}</div>`;
        });
        return this.prepareProblemImages(this.replaceProblemDiagrams(refined));
    }
    prepareProblemImages(body) {
        return String(body || "").replace(/<img\b([^>]*)>/gi, (match, attrs) => {
            const src = this.extractHtmlAttr(attrs, "src");
            if (!src || this.extractHtmlAttr(attrs, "data-lcpr-problem-image")) {
                return match;
            }
            const selfClosing = /\/\s*$/.test(String(attrs || ""));
            const cleanAttrs = String(attrs || "").replace(/\/\s*$/, "");
            const additions = [` data-lcpr-problem-image="true"`];
            if (!this.extractHtmlAttr(cleanAttrs, "decoding")) {
                additions.push(` decoding="async"`);
            }
            if (!this.extractHtmlAttr(cleanAttrs, "loading")) {
                additions.push(` loading="lazy"`);
            }
            return `<img${cleanAttrs}${additions.join("")}${selfClosing ? " /" : ""}>`;
        });
    }
    replaceProblemDiagrams(body) {
        const pack = loadDiagramPack(this.state.node || {});
        if (!pack) {
            return body;
        }
        let imageIndex = 0;
        return String(body || "").replace(/<img\b([^>]*)>/gi, (match, attrs, offset, source) => {
            const src = this.extractHtmlAttr(attrs, "src");
            if (!src) {
                return match;
            }
            imageIndex += 1;
            const image = {
                src,
                alt: this.extractHtmlAttr(attrs, "alt"),
                example: this.inferImageExample(source, offset, imageIndex),
                index: imageIndex,
            };
            const replacement = findDiagramReplacement(pack, image);
            if (!replacement) {
                return match;
            }
            const svg = sanitizeRenderedSvg(renderDiagram(replacement.diagram));
            if (!svg) {
                return match;
            }
            const alt = image.alt ? ` aria-label="${this.escapeAttr(image.alt)}"` : "";
            return `<figure class="lcpr-diagram"${alt}>${svg}</figure>`;
        });
    }
    extractHtmlAttr(attrs, name) {
        const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>` + "`" + `]+))`, "i");
        const match = String(attrs || "").match(pattern);
        return match ? this.decodeHtmlAttr(match[1] || match[2] || match[3] || "") : "";
    }
    decodeHtmlAttr(value) {
        return String(value || "")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">");
    }
    inferImageExample(source, offset, fallback) {
        const prefix = String(source || "").slice(0, offset);
        const matches = [...prefix.matchAll(/示例\s*(\d+)|Example\s*(\d+)/gi)];
        if (!matches.length) {
            return fallback;
        }
        const last = matches[matches.length - 1];
        const value = Number(last[1] || last[2]);
        return Number.isFinite(value) && value > 0 ? value : fallback;
    }
    parseExampleCode(code) {
        const source = this.htmlToPlainText(code).trim();
        if (!/(输入|输出|解释)\s*[:：]/.test(source)) {
            return undefined;
        }
        const matches = [...source.matchAll(/(?:^|\n)\s*(输入|输出|解释)\s*[:：]\s*/g)];
        if (matches.length < 2) {
            return undefined;
        }
        const blocks = matches.map((match, index) => {
            const start = match.index + match[0].length;
            const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
            return {
                label: match[1],
                value: this.escapeHtml(source.slice(start, end).trim()),
            };
        }).filter((block) => block.value.length > 0);
        return blocks.length ? blocks : undefined;
    }
    htmlToPlainText(value) {
        return String(value || "")
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\r\n/g, "\n");
    }
    renderPerformance(detail) {
        if (!detail || !detail.accepted) {
            return "";
        }
        const charts = detail.performanceCharts || {};
        const metrics = [
            this.performanceMetric(charts, "runtime", detail),
            this.performanceMetric(charts, "memory", detail),
        ].filter((metric) => metric.display || metric.percentile || (metric.distribution && metric.distribution.length));
        if (!metrics.length) {
            return "";
        }
        return `<section class="submission-performance">${metrics.map((metric, index) => this.renderPerformanceCard(metric, index)).join("")}</section>`;
    }
    performanceMetric(charts, key, detail) {
        const raw = charts && charts[key] ? charts[key] : {};
        const isRuntime = key === "runtime";
        const display = raw.display || (isRuntime ? detail.runtime : detail.memory) || "";
        let value = Number(raw.value);
        if (!Number.isFinite(value)) {
            value = this.parseMetricValue(display, isRuntime ? "runtime" : "memory");
        }
        return {
            key,
            title: isRuntime ? "运行时间" : "内存占用",
            display,
            value,
            unit: raw.unit || (isRuntime ? "ms" : "KB"),
            percentile: raw.percentile !== undefined && raw.percentile !== null ? raw.percentile : (isRuntime ? detail.runtimePercentile : detail.memoryPercentile),
            distribution: raw.distribution || [],
        };
    }
    renderPerformanceCard(metric, index) {
        const points = this.normalizeDistribution(metric.distribution, metric.key);
        const hasDistribution = points.length > 1;
        const focused = hasDistribution ? this.buildFocusedDistribution(metric, points) : undefined;
        const body = focused ? this.renderFocusedDistribution(metric, focused) : this.renderPercentileStrip(metric);
        const value = metric.display || (Number.isFinite(Number(metric.value)) ? this.formatBucketValue(metric.value, metric.unit) : "--");
        const percent = this.formatPercent(metric.percentile);
        const tier = focused ? focused.tier : this.performanceTier(this.clampPercent(metric.percentile), false);
        return `<section class="submission-perf-card">
  <div class="submission-perf-head">
    <span>${this.escapeHtml(metric.title)}</span>
    <strong>${this.escapeHtml(value)}</strong>
  </div>
  ${body}
  <div class="submission-perf-result"><span>${percent ? `击败 ${this.escapeHtml(percent)}%` : "暂无击败率"}</span>${tier ? `<em>${this.escapeHtml(tier)}</em>` : ""}</div>
</section>`;
    }
    renderFocusedDistribution(metric, focused) {
        const columns = focused.bars.map((bar) => bar.type === "tail" ? "8px" : "minmax(2px,1fr)").join(" ");
        const bars = focused.bars.map((bar, index) => {
            const cls = [
                "submission-perf-bar",
                bar.type === "tail" ? "tail" : "",
                bar.tail ? `${bar.tail}-tail` : "",
                bar.beaten ? "before" : "",
                bar.active ? "active" : "",
                bar.quiet ? "quiet" : "",
            ].filter(Boolean).join(" ");
            const title = bar.title || "";
            return `<span class="${cls}" style="height:${bar.height}%;" title="${this.escapeAttr(title)}"></span>`;
        }).join("");
        return `<div class="submission-perf-chart">
  <div class="submission-perf-bars" style="grid-template-columns:${columns};">${bars}</div>
  <div class="submission-perf-axis"><span>${this.escapeHtml(focused.leftLabel)}</span><span>${this.escapeHtml(focused.rightLabel)}</span></div>
  <div class="submission-perf-note">${this.escapeHtml(focused.note)}</div>
</div>`;
    }
    buildFocusedDistribution(metric, points) {
        const sorted = points
            .map((point) => ({ value: Number(point.value), weight: Number(point.weight) }))
            .filter((point) => Number.isFinite(point.value) && Number.isFinite(point.weight) && point.weight > 0)
            .sort((a, b) => a.value - b.value);
        const totalWeight = sorted.reduce((sum, point) => sum + point.weight, 0);
        const userValue = Number(metric.value);
        if (sorted.length < 2 || totalWeight <= 0 || !Number.isFinite(userValue)) {
            return undefined;
        }
        const q05 = this.weightedQuantile(sorted, 0.05);
        const q25 = this.weightedQuantile(sorted, 0.25);
        const q75 = this.weightedQuantile(sorted, 0.75);
        const q95 = this.weightedQuantile(sorted, 0.95);
        const minValue = sorted[0].value;
        const maxValue = sorted[sorted.length - 1].value;
        const iqr = Math.max(0, q75 - q25);
        const fenceLow = iqr > 0 ? q25 - 1.5 * iqr : q05;
        const fenceHigh = iqr > 0 ? q75 + 1.5 * iqr : q95;
        let coreMin = Math.max(minValue, q05, fenceLow);
        let coreMax = Math.min(maxValue, q95, fenceHigh);
        if (!Number.isFinite(coreMin) || !Number.isFinite(coreMax) || coreMin >= coreMax) {
            coreMin = minValue;
            coreMax = maxValue;
        }
        const badTail = sorted.filter((point) => point.value > coreMax);
        const goodTail = sorted.filter((point) => point.value < coreMin);
        const coreSource = sorted.filter((point) => point.value >= coreMin && point.value <= coreMax);
        if (coreSource.length < 2 || coreMin >= coreMax) {
            return undefined;
        }
        const targetBars = Math.max(12, Math.min(22, Math.round(Math.sqrt(coreSource.length) * 4)));
        const bins = Array.from({ length: targetBars }, (_, index) => {
            const start = coreMin + (coreMax - coreMin) * (index / targetBars);
            const end = coreMin + (coreMax - coreMin) * ((index + 1) / targetBars);
            return { type: "bin", start, end, value: (start + end) / 2, weight: 0 };
        });
        coreSource.forEach((point) => {
            const rawIndex = Math.floor(((point.value - coreMin) / (coreMax - coreMin)) * targetBars);
            const index = Math.max(0, Math.min(targetBars - 1, rawIndex));
            bins[index].weight += point.weight;
        });
        const maxWeight = Math.max(...bins.map((bin) => bin.weight), 1);
        const badTailWeight = badTail.reduce((sum, point) => sum + point.weight, 0);
        const goodTailWeight = goodTail.reduce((sum, point) => sum + point.weight, 0);
        let displayBars = bins.slice().reverse().map((bin) => this.focusBarFromBin(bin, maxWeight, totalWeight, metric));
        if (badTailWeight > 0) {
            displayBars.unshift(this.focusTailBar("bad", badTailWeight, totalWeight, coreMax, metric));
        }
        if (goodTailWeight > 0) {
            displayBars.push(this.focusTailBar("good", goodTailWeight, totalWeight, coreMin, metric));
        }
        let activeIndex = displayBars.findIndex((bar) => bar.active);
        if (activeIndex < 0) {
            activeIndex = this.nearestFocusedBar(displayBars, userValue);
            if (activeIndex >= 0) {
                displayBars[activeIndex].active = true;
            }
        }
        displayBars = displayBars.map((bar, index) => Object.assign({}, bar, { beaten: activeIndex >= 0 && index < activeIndex }));
        const estimatedPercent = this.clampPercent(metric.percentile) !== undefined
            ? this.clampPercent(metric.percentile)
            : this.estimateBeatPercent(sorted, userValue);
        const tailPercent = ((badTailWeight + goodTailWeight) / totalWeight) * 100;
        const noteParts = ["核心 P5-P95"];
        if (tailPercent >= 0.1) {
            noteParts.push(`尾部压缩 ${this.formatCompactNumber(tailPercent)}%`);
        }
        noteParts.push(`噪声桶弱化`);
        return {
            bars: displayBars,
            leftLabel: badTailWeight > 0 ? `>${this.formatBucketValue(coreMax, metric.unit)}` : this.formatBucketValue(coreMax, metric.unit),
            rightLabel: goodTailWeight > 0 ? `<${this.formatBucketValue(coreMin, metric.unit)}` : this.formatBucketValue(coreMin, metric.unit),
            note: noteParts.join(" · "),
            tier: this.performanceTier(estimatedPercent, userValue < coreMin || userValue > coreMax),
        };
    }
    focusBarFromBin(bin, maxWeight, totalWeight, metric) {
        const userValue = Number(metric.value);
        const active = Number.isFinite(userValue) && userValue >= bin.start && userValue <= bin.end;
        const share = totalWeight > 0 ? bin.weight / totalWeight : 0;
        const quiet = !active && (share < 0.0025 || bin.weight < maxWeight * 0.015);
        const scaled = Math.sqrt(Math.max(0, bin.weight) / Math.max(1, maxWeight)) * 100;
        const height = quiet ? Math.max(3, Math.min(10, Math.round(scaled))) : Math.max(6, Math.round(scaled));
        const range = `${this.formatBucketValue(bin.start, metric.unit)} - ${this.formatBucketValue(bin.end, metric.unit)}`;
        return {
            type: "bin",
            value: bin.value,
            weight: bin.weight,
            height,
            active,
            quiet,
            title: `${range} / ${this.formatCompactNumber(share * 100)}%`,
        };
    }
    focusTailBar(tail, weight, totalWeight, boundary, metric) {
        const userValue = Number(metric.value);
        const active = tail === "bad" ? userValue > boundary : userValue < boundary;
        const share = totalWeight > 0 ? (weight / totalWeight) * 100 : 0;
        const label = tail === "bad" ? "偏慢尾部" : "优秀尾部";
        return {
            type: "tail",
            tail,
            value: boundary,
            weight,
            height: Math.max(8, Math.min(34, Math.round(share * 2.4))),
            active,
            quiet: true,
            title: `${label} / ${this.formatCompactNumber(share)}%`,
        };
    }
    nearestFocusedBar(bars, value) {
        if (!Number.isFinite(Number(value))) {
            return -1;
        }
        let bestIndex = -1;
        let bestDistance = Infinity;
        bars.forEach((bar, index) => {
            if (!Number.isFinite(Number(bar.value))) {
                return;
            }
            const distance = Math.abs(Number(bar.value) - Number(value));
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = index;
            }
        });
        return bestIndex;
    }
    weightedQuantile(points, probability) {
        const total = points.reduce((sum, point) => sum + Number(point.weight || 0), 0);
        if (total <= 0) {
            return points.length ? Number(points[0].value) : 0;
        }
        const target = total * Math.max(0, Math.min(1, probability));
        let cumulative = 0;
        for (const point of points) {
            cumulative += Number(point.weight || 0);
            if (cumulative >= target) {
                return Number(point.value);
            }
        }
        return Number(points[points.length - 1].value);
    }
    estimateBeatPercent(points, userValue) {
        if (!Number.isFinite(Number(userValue))) {
            return undefined;
        }
        const total = points.reduce((sum, point) => sum + Number(point.weight || 0), 0);
        if (total <= 0) {
            return undefined;
        }
        const beaten = points.reduce((sum, point) => {
            if (Number(point.value) > Number(userValue)) {
                return sum + Number(point.weight || 0);
            }
            if (Number(point.value) === Number(userValue)) {
                return sum + Number(point.weight || 0) * 0.5;
            }
            return sum;
        }, 0);
        return Math.max(0, Math.min(100, (beaten / total) * 100));
    }
    performanceTier(percent, outsideCore) {
        if (percent === undefined) {
            return "";
        }
        const value = Number(percent);
        if (outsideCore && value >= 80) {
            return "尾部优秀";
        }
        if (outsideCore && value <= 20) {
            return "尾部偏慢";
        }
        if (value >= 80) {
            return "核心区优秀";
        }
        if (value >= 60) {
            return "核心区偏快";
        }
        if (value >= 40) {
            return "核心区中游";
        }
        if (value >= 20) {
            return "核心区偏慢";
        }
        return "尾部偏慢";
    }
    renderPercentileStrip(metric) {
        const percent = this.clampPercent(metric.percentile);
        if (percent === undefined) {
            return `<div class="submission-perf-empty">暂无官方性能数据</div>`;
        }
        return `<div class="submission-perf-strip"><span class="submission-perf-strip-fill" style="width:${percent}%"></span><span class="submission-perf-strip-marker" style="left:${percent}%"></span></div><div class="submission-perf-axis"><span>0%</span><span>100%</span></div>`;
    }
    normalizeDistribution(raw, metricKey) {
        if (!raw) {
            return [];
        }
        const source = Array.isArray(raw) ? raw : (raw.distribution || []);
        return source.map((item) => {
            let value;
            let weight;
            if (Array.isArray(item)) {
                value = this.parseMetricValue(item[0], metricKey);
                weight = this.parseFirstNumber(item[1]);
            }
            else if (item && typeof item === "object") {
                value = this.parseMetricValue(item.displayed_value || item.displayedValue || item.value || item.runtime || item.memory || item.x, metricKey);
                weight = this.parseFirstNumber(item.percent || item.percentage || item.weight || item.count || item.y);
            }
            if (!Number.isFinite(value) || !Number.isFinite(weight)) {
                return undefined;
            }
            return { value, weight };
        }).filter(Boolean).sort((a, b) => a.value - b.value);
    }
    parseFirstNumber(value) {
        if (typeof value === "number") {
            return Number.isFinite(value) ? value : undefined;
        }
        const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
        return match ? Number(match[0]) : undefined;
    }
    parseMetricValue(value, metricKey) {
        const number = this.parseFirstNumber(value);
        if (number === undefined) {
            return undefined;
        }
        const text = String(value || "").toLowerCase();
        if (metricKey === "runtime" && /\bs\b/.test(text) && !/ms\b/.test(text)) {
            return number * 1000;
        }
        if (metricKey === "memory" && /\bgb\b/.test(text)) {
            return number * 1024 * 1024;
        }
        if (metricKey === "memory" && /\bmb\b/.test(text)) {
            return number * 1024;
        }
        return number;
    }
    formatBucketValue(value, unit) {
        if (unit === "KB" && Number(value) >= 1024) {
            return `${this.formatCompactNumber(Number(value) / 1024)} MB`;
        }
        return `${this.formatCompactNumber(value)}${unit ? ` ${unit}` : ""}`;
    }
    formatCompactNumber(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) {
            return "";
        }
        if (Math.abs(number) >= 100) {
            return String(Math.round(number));
        }
        if (Math.abs(number) >= 10) {
            return number.toFixed(1).replace(/\.0$/, "");
        }
        return number.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
    }
    clampPercent(value) {
        const number = this.parseFirstNumber(value);
        if (number === undefined) {
            return undefined;
        }
        return Math.max(0, Math.min(100, number));
    }
    formatPercent(value) {
        const percent = this.clampPercent(value);
        if (percent === undefined) {
            return "";
        }
        return this.formatCompactNumber(percent);
    }
    statusText(status) {
        const raw = String(status || "").trim();
        if (!raw) {
            return "未知状态";
        }
        const lower = raw.toLowerCase();
        if (lower === "accepted" || raw === "通过") {
            return "通过";
        }
        if (/wrong answer/i.test(raw)) {
            return "答案错误";
        }
        if (/time limit/i.test(raw)) {
            return "超出时间限制";
        }
        if (/memory limit/i.test(raw)) {
            return "超出内存限制";
        }
        if (/runtime error/i.test(raw)) {
            return "运行错误";
        }
        if (/compile error/i.test(raw)) {
            return "编译错误";
        }
        return raw;
    }
    statusFilterText(value) {
        if (value === "accepted") {
            return "通过";
        }
        if (value === "failed") {
            return "错误";
        }
        return "全部状态";
    }
    langFilterText(value) {
        const raw = String(value || "");
        return raw && raw !== "all" ? raw : "全部语言";
    }
    caseText(detail) {
        if (Number.isFinite(Number(detail.passed)) && Number.isFinite(Number(detail.total))) {
            return `${detail.passed} / ${detail.total}`;
        }
        return detail.accepted ? "全部通过" : "未通过";
    }
    notePreview(note) {
        const text = this.normalizeNoteText(note).replace(/\s+/g, " ").trim();
        return text.length > 28 ? `${text.slice(0, 28)}...` : text;
    }
    formatTime(item) {
        if (item && item.timeDisplay) {
            return String(item.timeDisplay);
        }
        const value = item && item.timestamp;
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) {
            return new Date(number).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
        }
        return value ? String(value) : "-";
    }
    getDiscussionLink(url) {
        const endPoint = (0, ConfigUtils_1.getLeetCodeEndpoint)();
        if (endPoint === ConstDefind_1.Endpoint.LeetCodeCN) {
            return String(url || "").replace("/description/", "/comments/");
        }
        if (endPoint === ConstDefind_1.Endpoint.LeetCode) {
            return String(url || "").replace("/description/", "/discuss/?currentPage=1&orderBy=most_votes&query=");
        }
        return "https://leetcode.com";
    }
    getSolutionLink(url) {
        return String(url || "https://leetcode.com").replace("/description/", "/solution/");
    }
    resolveHighlightLanguage(lang) {
        const raw = String(lang || "").trim().toLowerCase();
        const normalized = raw.replace(/\s+/g, "").replace(/#/g, "sharp").replace(/\+\+/g, "pp");
        const aliases = {
            "c++": "cpp",
            cpp: "cpp",
            "csharp": "csharp",
            "c#": "csharp",
            golang: "go",
            go: "go",
            javascript: "javascript",
            js: "javascript",
            typescript: "typescript",
            ts: "typescript",
            python3: "python",
            python: "python",
            py: "python",
            mysql: "sql",
            sql: "sql",
            bash: "bash",
            shell: "bash",
            sh: "bash",
        };
        const language = aliases[raw] || aliases[normalized] || normalized;
        return language && hljs.getLanguage(language) ? language : "";
    }
    highlightSubmissionCode(code, lang) {
        const source = String(code || "");
        const language = this.resolveHighlightLanguage(lang);
        if (language) {
            try {
                return hljs.highlight(source, { language, ignoreIllegals: true }).value;
            }
            catch (_) {
                return this.escapeHtml(source);
            }
        }
        return this.escapeHtml(source);
    }
    escapeHtml(value) {
        return String(value !== null && value !== void 0 ? value : "").replace(/[&<>"']/g, (char) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        }[char]));
    }
    escapeAttr(value) {
        return this.escapeHtml(value).replace(/`/g, "&#96;");
    }
    getStyle() {
        return `<style>
:root {
  --lcpr-bg: var(--vscode-sideBar-background, var(--vscode-editor-background));
  --lcpr-fg: var(--vscode-sideBar-foreground, var(--vscode-foreground));
  --lcpr-muted: var(--vscode-descriptionForeground);
  --lcpr-border: var(--vscode-sideBar-border, var(--vscode-widget-border));
  --lcpr-hover: var(--vscode-toolbar-hoverBackground);
  --lcpr-input: var(--vscode-input-background);
  --lcpr-code-bg: var(--vscode-textCodeBlock-background, var(--vscode-editor-inactiveSelectionBackground));
  --lcpr-reading-font-size: var(--vscode-font-size, 13px);
  --lcpr-success-deep: #137333;
  --lcpr-success: #2ea043;
  --lcpr-focus-gray: #b7b7b7;
}
body.vscode-dark {
  --lcpr-success-deep: #2ea043;
  --lcpr-success: #3fb950;
  --lcpr-bg: var(--vscode-sideBar-background, #1f2028);
  --lcpr-fg: color-mix(in srgb, var(--vscode-editor-foreground, #e6edf3) 94%, #ffffff 6%);
  --lcpr-muted: color-mix(in srgb, var(--vscode-editor-foreground, #e6edf3) 76%, var(--vscode-sideBar-background, #1f2028) 24%);
  --lcpr-border: color-mix(in srgb, var(--vscode-editor-foreground, #e6edf3) 20%, transparent);
  --lcpr-input: color-mix(in srgb, var(--vscode-sideBar-background, #1f2028) 84%, #ffffff 10%);
  --lcpr-code-bg: color-mix(in srgb, var(--vscode-editor-background, #1f2028) 82%, #ffffff 12%);
  --lcpr-hover: color-mix(in srgb, var(--vscode-sideBar-background, #1f2028) 72%, #ffffff 15%);
}
body.vscode-high-contrast {
  --lcpr-fg: var(--vscode-foreground, #ffffff);
  --lcpr-muted: var(--vscode-foreground, #ffffff);
  --lcpr-border: var(--vscode-contrastBorder, var(--vscode-sideBar-border));
}
html, body {
  min-height: 100%;
  margin: 0;
  padding: 0;
  background: var(--lcpr-bg);
  color: var(--lcpr-fg);
  font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: var(--vscode-font-size, 13px);
  line-height: 1.48;
}
body { overflow-x: hidden; }
.lcpr-svg-filters {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}
.lcpr-companion {
  box-sizing: border-box;
  min-height: 100vh;
  padding: 0;
  background: var(--lcpr-bg);
}
.lcpr-companion [hidden] {
  display: none !important;
}
.lcpr-companion *, .lcpr-companion *::before, .lcpr-companion *::after {
  box-sizing: border-box;
}
.lcpr-header {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--lcpr-border);
  background: var(--lcpr-bg);
}
.lcpr-title-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
h1 {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding-bottom: 0 !important;
  border: 0 !important;
  border-bottom: 0 !important;
  box-shadow: none !important;
  color: var(--lcpr-fg);
  font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: 20px;
  font-weight: 700;
  line-height: 1.3;
  letter-spacing: 0;
}
h1 a {
  color: inherit;
  text-decoration: none !important;
  border-bottom: 0 !important;
}
h1 a:hover, h1 a:focus, h1 a:active {
  color: inherit;
  text-decoration: none !important;
  border-bottom: 0 !important;
}
.lcpr-icon-button {
  flex: 0 0 auto;
  min-width: 32px;
  height: 30px;
  border: 1px solid var(--vscode-button-background);
  border-radius: 4px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}
.lcpr-icon-button:hover {
  border-color: var(--vscode-button-hoverBackground);
  background: var(--vscode-button-hoverBackground);
  color: var(--vscode-button-foreground);
}
.lcpr-icon-button:focus {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 2px;
}
.lcpr-header-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  margin-top: 7px;
  min-height: 22px;
}
.lcpr-lang-segment {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-height: 22px;
}
.lcpr-lang-segment button {
  min-width: 0;
  min-height: 22px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--lcpr-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  line-height: 22px;
  cursor: pointer;
}
.lcpr-lang-segment button:hover {
  color: var(--lcpr-fg);
  background: transparent;
}
.lcpr-lang-segment button.current {
  color: var(--lcpr-fg);
  background: transparent;
  box-shadow: none;
}
.lcpr-lang-segment button:focus,
.lcpr-lang-segment button:focus-visible,
.lcpr-lang-segment button:active {
  outline: none;
  background: transparent;
  box-shadow: none;
}
.lcpr-font-controls {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 12px;
  min-height: 22px;
}
.lcpr-font-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 22px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--lcpr-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 22px;
  letter-spacing: 0;
  cursor: pointer;
}
.lcpr-font-button:hover:not(:disabled) {
  background: transparent;
  color: var(--lcpr-fg);
}
.lcpr-font-button:focus,
.lcpr-font-button:focus-visible,
.lcpr-font-button:active {
  outline: none;
  background: transparent;
  box-shadow: none;
}
.lcpr-font-button:disabled {
  color: var(--lcpr-muted);
  cursor: default;
  opacity: .48;
}
.lcpr-chips, .lcpr-tags, .lcpr-section-meta, .lcpr-secondary-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.lcpr-chips { margin-top: 8px; }
.lcpr-chip, .lcpr-tags a, .lcpr-section-meta span, .lcpr-section-meta a {
  display: inline-flex;
  align-items: center;
  min-height: 18px;
  padding: 1px 6px;
  border: 1px solid var(--lcpr-border);
  border-radius: 4px;
  color: var(--lcpr-muted);
  background: var(--lcpr-input);
  font-size: 11px;
  line-height: 16px;
  text-decoration: none;
}
.lcpr-easy { color: var(--vscode-testing-iconPassed, #3fb950); }
.lcpr-medium { color: var(--vscode-testing-iconQueued, #d29922); }
.lcpr-hard { color: var(--vscode-testing-iconFailed, #f85149); }
.lcpr-content { padding: 14px 16px 24px; }
.lcpr-pane { display: flex; flex-direction: column; gap: 14px; }
.lcpr-tags a { background: transparent; }
.lcpr-markdown {
  font-size: var(--lcpr-reading-font-size);
}
.lcpr-body {
  min-width: 0;
  overflow-x: hidden;
  padding-bottom: 2px;
}
.lcpr-markdown h1, .lcpr-markdown h2, .lcpr-markdown h3, .lcpr-markdown h4 {
  margin: 18px 0 9px;
  padding: 0;
  border: 0;
  color: var(--lcpr-fg);
  font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: calc(var(--lcpr-reading-font-size) + 2px);
  font-weight: 700;
  text-align: left;
}
.lcpr-markdown p, .lcpr-markdown ul, .lcpr-markdown ol, .lcpr-markdown blockquote, .lcpr-markdown table {
  margin: 10px 0;
}
.lcpr-markdown a { color: var(--vscode-textLink-foreground); }
.lcpr-markdown table {
  display: block;
  width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  font-size: 12px;
}
.lcpr-markdown th, .lcpr-markdown td {
  padding: 4px 6px;
  border: 1px solid var(--lcpr-border);
  text-align: left;
  white-space: normal;
}
.lcpr-markdown pre {
  box-sizing: border-box;
  width: 100%;
  margin: 10px 0;
  padding: 10px 12px;
  overflow-x: hidden;
  border: 1px solid var(--lcpr-border);
  border-radius: 4px;
  background: var(--lcpr-code-bg);
}
.lcpr-markdown pre code {
  padding: 0;
  background: transparent;
  border: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.lcpr-markdown code {
  padding: 1px 4px;
  border-radius: 3px;
  background: var(--lcpr-code-bg);
  font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 0.92em;
  overflow-wrap: anywhere;
}
.lcpr-markdown img {
  display: block;
  box-sizing: border-box;
  width: auto;
  max-width: 100% !important;
  height: auto !important;
  object-fit: contain;
  margin: 8px auto;
}
body.vscode-dark .lcpr-markdown img,
body.vscode-high-contrast .lcpr-markdown img {
  filter: url("#lcpr-invert-luminance");
}
.lcpr-markdown img.lcpr-image-bg-transparent {
  background: transparent;
  filter: none !important;
}
.lcpr-diagram {
  --lcpr-diagram-edge: color-mix(in srgb, var(--lcpr-fg) 82%, transparent);
  --lcpr-diagram-text: var(--lcpr-fg);
  --lcpr-diagram-danger: color-mix(in srgb, var(--vscode-testing-iconFailed, #f85149) 30%, var(--lcpr-bg));
  --lcpr-diagram-accent: color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 24%, var(--lcpr-bg));
  --lcpr-diagram-muted-fill: var(--lcpr-input);
  width: 100%;
  margin: 10px 0 12px;
  padding: 8px 0;
  overflow-x: hidden;
}
.lcpr-diagram-svg {
  display: block;
  width: auto;
  min-width: 0;
  max-width: 100%;
  height: auto;
  max-height: 210px;
}
.lcpr-diagram-node text {
  font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
}
.lcpr-markdown blockquote {
  padding: 2px 0 2px 10px;
  border-left: 2px solid var(--lcpr-border);
  color: var(--lcpr-muted);
}
.lcpr-bilingual {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.lcpr-bilingual-section {
  min-width: 0;
  padding-top: 2px;
}
.lcpr-bilingual-section + .lcpr-bilingual-section {
  padding-top: 14px;
  border-top: 1px solid var(--lcpr-border);
}
.lcpr-bilingual-label {
  margin-bottom: 8px;
  color: var(--lcpr-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0;
  text-transform: uppercase;
}
.lcpr-meta-footer {
  margin-top: 16px;
}
.lcpr-secondary-actions {
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  padding: 0 0 7px;
  border-bottom: 1px solid var(--lcpr-border);
}
.lcpr-secondary-links {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 10px;
  min-width: 0;
}
.lcpr-secondary-actions a, .lcpr-secondary-actions button {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 1px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--vscode-textLink-foreground);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  cursor: pointer;
  transition: color 120ms ease;
}
.lcpr-secondary-actions a:hover, .lcpr-secondary-actions button:hover {
  background: transparent;
  color: var(--vscode-textLink-activeForeground, var(--vscode-foreground));
}
.lcpr-secondary-actions button:disabled,
.lcpr-secondary-actions button:disabled:hover {
  color: var(--lcpr-muted);
  cursor: default;
  opacity: .48;
}
.lcpr-example-split {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 8px 0 10px;
}
.lcpr-example-row {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: start;
  gap: 8px;
}
.lcpr-example-label {
  min-height: 24px;
  padding-top: 2px;
  color: var(--lcpr-muted);
  font-size: 12px;
  font-weight: 650;
  line-height: 20px;
}
.lcpr-example-value {
  box-sizing: border-box;
  display: block;
  min-width: 0;
  width: 100%;
  min-height: 24px;
  margin: 0;
  padding: 2px 7px;
  border: 0;
  border-radius: 4px;
  background: var(--lcpr-code-bg);
  color: var(--lcpr-fg);
  font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 0.92em;
  line-height: 20px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.lcpr-inline-hints {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.lcpr-inline-title {
  color: var(--lcpr-muted);
  font-size: 12px;
  font-weight: 650;
}
.lcpr-targets {
  margin-top: 0;
  padding-top: 8px;
  border-top: 0;
}
.lcpr-targets summary {
  color: var(--lcpr-muted);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}
.lcpr-targets .lcpr-chips, .lcpr-targets .lcpr-tags {
  margin-top: 8px;
}
.lcpr-hint {
  border: 1px solid var(--lcpr-border);
  border-radius: 4px;
  background: var(--lcpr-input);
}
.lcpr-hint summary {
  padding: 7px 8px;
  cursor: pointer;
  font-weight: 600;
}
.lcpr-hint > div {
  padding: 0 8px 8px;
}
.lcpr-empty {
  margin-top: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  color: var(--lcpr-muted);
}
.lcpr-empty.compact {
  margin-top: 8px;
  padding: 10px;
  border: 1px dashed var(--lcpr-border);
  border-radius: 4px;
}
.lcpr-empty-title {
  margin-bottom: 4px;
  color: var(--lcpr-fg);
  font-weight: 650;
}
.lcpr-empty p { margin: 0; }
.lcpr-load-state {
  margin: 0;
  padding: 0;
  color: var(--lcpr-muted);
}
.lcpr-load-title {
  margin-bottom: 4px;
  color: var(--lcpr-fg);
  font-weight: 650;
}
.lcpr-load-state p {
  margin: 0;
}
.lcpr-load-state.error .lcpr-load-title {
  color: var(--vscode-errorForeground, var(--lcpr-fg));
}
.lcpr-callout, .lcpr-loading {
  padding: 8px 10px;
  border: 1px solid var(--lcpr-border);
  border-radius: 4px;
  background: var(--lcpr-input);
  color: var(--lcpr-muted);
  font-size: 12px;
}
.lcpr-error {
  border-color: var(--vscode-inputValidation-errorBorder, var(--lcpr-border));
  color: var(--vscode-errorForeground, var(--lcpr-fg));
}
.lcpr-plain-button {
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--vscode-textLink-foreground);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.lcpr-plain-button:hover {
  color: var(--vscode-textLink-activeForeground, var(--vscode-foreground));
}
.lcpr-action-button {
  align-self: flex-start;
  min-height: 28px;
  padding: 4px 10px;
  border: 1px solid var(--vscode-button-background);
  border-radius: 4px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}
.lcpr-action-button:hover {
  border-color: var(--vscode-button-hoverBackground);
  background: var(--vscode-button-hoverBackground);
}
.submission-list-view, .submission-detail-view {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.submission-titlebar, .submission-detail-nav, .submission-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.submission-title-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}
.submission-title {
  font-size: 20px;
  font-weight: 800;
  line-height: 1.18;
}
.submission-count {
  margin-top: 4px;
  color: var(--lcpr-muted);
  font-size: 15px;
  font-weight: 650;
  line-height: 1.2;
}
.submission-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: visible;
}
.submission-status-segments {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  flex: 1 1 auto;
  min-width: 0;
  height: 30px;
  padding: 2px;
  border: 1px solid var(--lcpr-border);
  border-radius: 4px;
  background: var(--lcpr-input);
}
.submission-status-segment {
  min-width: 0;
  height: 24px;
  padding: 0 7px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--lcpr-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 24px;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
}
.submission-status-segment:hover {
  color: var(--lcpr-fg);
  background: var(--lcpr-hover);
}
.submission-status-segment.current {
  color: var(--lcpr-fg);
  background: var(--vscode-button-secondaryBackground, var(--lcpr-bg));
  box-shadow: inset 0 0 0 1px var(--lcpr-border);
}
.submission-filter {
  position: relative;
  flex: 0 1 138px;
  min-width: 0;
}
.submission-filter-button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 5px;
  min-width: 0;
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border: 1px solid var(--lcpr-border);
  border-radius: 4px;
  background: var(--lcpr-input);
  color: var(--lcpr-fg);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.submission-filter-button:hover {
  background: var(--lcpr-hover);
}
.submission-filter-button:focus,
.submission-filter-button:focus-visible,
.submission-status-segment:focus,
.submission-status-segment:focus-visible,
.submission-filter-option:focus,
.submission-filter-option:focus-visible,
.submission-row:focus,
.submission-row:focus-visible,
.lcpr-submissions .lcpr-plain-button:focus,
.lcpr-submissions .lcpr-plain-button:focus-visible {
  outline: none;
  box-shadow: none;
}
.submission-filter.open .submission-filter-button {
  border-color: var(--vscode-focusBorder, var(--lcpr-border));
  background: var(--lcpr-hover);
}
.submission-filter-label {
  color: var(--lcpr-muted);
  font-size: 11px;
  font-weight: 600;
}
.submission-filter-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  font-weight: 600;
}
.submission-filter-mark {
  flex: 0 0 auto;
  display: grid;
  align-content: center;
  justify-items: center;
  gap: 2px;
  width: 12px;
  height: 12px;
  opacity: .72;
}
.submission-filter-mark span {
  display: block;
  width: 8px;
  height: 1.5px;
  border-radius: 999px;
  background: var(--lcpr-muted);
}
.submission-filter.open .submission-filter-mark {
  opacity: 1;
}
.submission-filter-menu {
  position: absolute;
  top: calc(100% + 5px);
  right: 0;
  z-index: 10;
  display: none;
  min-width: 136px;
  width: 100%;
  max-height: 210px;
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--lcpr-border);
  border-radius: 4px;
  background: var(--vscode-dropdown-background, var(--lcpr-bg));
  box-shadow: 0 8px 22px rgba(0, 0, 0, .16);
}
.submission-filter.open .submission-filter-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.submission-filter-option {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: center;
  gap: 5px;
  width: 100%;
  min-height: 26px;
  padding: 3px 7px;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--lcpr-fg);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.submission-filter-option:hover {
  background: var(--lcpr-hover);
}
.submission-filter-option.current {
  color: var(--vscode-list-activeSelectionForeground, var(--vscode-button-foreground));
  background: var(--vscode-list-activeSelectionBackground, var(--vscode-button-background));
}
.submission-filter-check {
  color: inherit;
  font-weight: 700;
  text-align: center;
}
.submission-filter-option span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.submission-note-search {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--vscode-input-border, var(--lcpr-border));
  border-radius: 4px;
  background: var(--lcpr-input);
}
.submission-note-search span {
  color: var(--lcpr-muted);
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
}
.submission-note-search input {
  min-width: 0;
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--lcpr-fg);
  outline: none;
  font: inherit;
  font-size: 13px;
  text-align: right;
}
.submission-note-search input::placeholder {
  color: var(--vscode-input-placeholderForeground, var(--lcpr-muted));
}
.submission-rows {
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.submission-row {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 12px;
  row-gap: 10px;
  width: 100%;
  min-width: 0;
  padding: 12px 14px 12px 16px;
  border: 1px solid var(--vscode-input-border, var(--lcpr-border));
  border-radius: 4px;
  background: var(--lcpr-input);
  color: var(--lcpr-fg);
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: background-color .12s ease, border-color .12s ease;
}
.submission-row::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: transparent;
}
.submission-row:hover {
  border-color: var(--vscode-input-border, var(--lcpr-border));
  background: var(--vscode-list-hoverBackground, var(--lcpr-hover));
}
.submission-row.accepted::before {
  background: var(--lcpr-success-deep);
}
.submission-row.failed::before {
  background: var(--vscode-testing-iconFailed, #f85149);
}
.submission-status-group {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  justify-self: start;
  gap: 10px;
}
.submission-status {
  align-self: center;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 16px;
  font-weight: 800;
  line-height: 1.2;
}
.submission-row.accepted .submission-status, .submission-detail-head.accepted .submission-detail-status {
  color: var(--lcpr-success-deep);
}
.submission-row.failed .submission-status, .submission-detail-head.failed .submission-detail-status {
  color: var(--vscode-testing-iconFailed, #f85149);
}
.submission-meta, .submission-note-preview, .submission-detail-meta, .submission-row-time {
  min-width: 0;
  color: var(--lcpr-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.submission-meta, .submission-detail-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}
.submission-lang-pill {
  display: inline-flex;
  align-items: center;
  max-width: 92px;
  min-height: 21px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: color-mix(in srgb, var(--vscode-textLink-foreground, #0069cc) 10%, transparent);
  color: var(--vscode-textLink-foreground, #0069cc);
  font-size: 12px;
  font-weight: 700;
  line-height: 19px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.submission-row-metric {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: max-content;
}
.submission-row-icon {
  flex: 0 0 auto;
  width: 15px;
  height: 15px;
  color: var(--lcpr-muted);
  stroke-width: 2;
}
.submission-row-metric em {
  color: var(--lcpr-fg);
  font-style: normal;
  font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 13px;
  line-height: 1.2;
  font-weight: 650;
  white-space: nowrap;
}
.submission-row-metrics {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  justify-self: end;
  gap: 10px;
  min-width: 0;
  max-width: 100%;
  color: var(--lcpr-muted);
}
.submission-row-divider {
  width: 1px;
  height: 18px;
  background: var(--lcpr-border);
}
.submission-note-preview {
  display: block;
  justify-self: start;
  min-width: 0;
  max-width: 100%;
  color: var(--lcpr-fg);
  opacity: .86;
}
.submission-note-empty {
  color: var(--lcpr-muted);
  opacity: .7;
}
.submission-row-time {
  justify-self: end;
  max-width: 120px;
  text-align: right;
  font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 13px;
}
@media (max-width: 340px) {
  .submission-toolbar {
    grid-template-columns: 1fr;
  }
  .submission-row {
    grid-template-columns: minmax(0, 1fr);
  }
  .submission-row-time,
  .submission-row-metrics {
    justify-content: flex-start;
    justify-self: start;
    max-width: 100%;
    text-align: left;
  }
}
.submission-detail-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto auto;
  align-items: center;
  column-gap: 16px;
  row-gap: 9px;
  width: 100%;
  min-width: 0;
  padding: 14px 16px 15px;
  border: 1px solid var(--lcpr-border);
  border-radius: 4px;
  background: var(--lcpr-input);
}
.submission-detail-status {
  min-width: 0;
  font-size: 24px;
  font-weight: 800;
  line-height: 1.12;
}
.submission-detail-meta .submission-lang-pill {
  min-height: 19px;
  padding: 0 8px;
  font-size: 11px;
  line-height: 17px;
}
.submission-detail-case {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--lcpr-fg);
  font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
  text-align: right;
  white-space: nowrap;
}
.submission-detail-time {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--lcpr-muted);
  font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 13px;
  line-height: 1.2;
  text-align: right;
  white-space: nowrap;
}
.submission-performance {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 9px;
}
.submission-perf-card {
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--lcpr-border);
  border-radius: 4px;
  background: var(--lcpr-input);
}
.submission-perf-head, .submission-perf-axis {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.submission-perf-head {
  align-items: baseline;
  min-width: 0;
  margin-bottom: 7px;
}
.submission-perf-head span {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--lcpr-muted);
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.submission-perf-head strong {
  flex: 0 0 auto;
  color: var(--lcpr-fg);
  font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
}
.submission-perf-chart {
  display: grid;
  gap: 3px;
}
.submission-perf-bars {
  position: relative;
  display: grid;
  align-items: end;
  gap: 2px;
  height: 58px;
  padding-top: 4px;
  border-bottom: 1px solid var(--lcpr-border);
}
.submission-perf-bars::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--lcpr-success-deep), transparent);
  opacity: .55;
}
.submission-perf-bar {
  min-width: 2px;
  border-radius: 2px 2px 0 0;
  background: rgba(128, 128, 128, .42);
}
.submission-perf-bar.quiet {
  background: rgba(128, 128, 128, .24);
}
.submission-perf-bar.before {
  background: rgba(19, 115, 51, .28);
}
.submission-perf-bar.before.quiet {
  background: rgba(19, 115, 51, .16);
}
.submission-perf-bar.active {
  position: relative;
  background: var(--lcpr-success-deep);
  min-width: 3px;
}
.submission-perf-bar.active::after {
  content: "";
  position: absolute;
  left: 50%;
  top: -5px;
  bottom: -3px;
  width: 1px;
  background: var(--lcpr-success-deep);
  transform: translateX(-50%);
}
.submission-perf-bar.tail {
  border-radius: 2px;
  background: repeating-linear-gradient(
    135deg,
    rgba(128, 128, 128, .34) 0,
    rgba(128, 128, 128, .34) 2px,
    rgba(128, 128, 128, .16) 2px,
    rgba(128, 128, 128, .16) 4px
  );
}
.submission-perf-bar.tail.active {
  background: var(--lcpr-success-deep);
}
.submission-perf-axis {
  color: var(--lcpr-muted);
  font-size: 10px;
  font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
}
.submission-perf-note {
  color: var(--lcpr-muted);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.submission-perf-strip {
  position: relative;
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--lcpr-bg);
  border: 1px solid var(--lcpr-border);
}
.submission-perf-strip-fill {
  display: block;
  height: 100%;
  background: rgba(19, 115, 51, .38);
}
.submission-perf-strip-marker {
  position: absolute;
  top: -3px;
  bottom: -3px;
  width: 2px;
  background: var(--lcpr-success-deep);
  transform: translateX(-1px);
}
.submission-perf-empty {
  padding: 8px 0;
  color: var(--lcpr-muted);
  font-size: 12px;
}
.submission-perf-result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 7px;
  color: var(--lcpr-success-deep);
  font-size: 13px;
  font-weight: 600;
}
.submission-perf-result em {
  flex: 0 1 auto;
  color: var(--lcpr-muted);
  font-style: normal;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.submission-section {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 8px 9px;
  border: 1px solid var(--lcpr-border);
  border-radius: 4px;
  background: var(--lcpr-input);
}
.submission-section-head span {
  font-size: 12px;
  font-weight: 650;
}
.submission-code {
  box-sizing: border-box;
  width: 100%;
  max-height: 320px;
  margin: 0;
  padding: 8px 9px;
  overflow: auto;
  border: 1px solid var(--lcpr-border);
  border-radius: 4px;
  background: var(--vscode-editor-background, var(--lcpr-code-bg));
  color: var(--vscode-editor-foreground, var(--lcpr-fg));
}
.submission-code.is-collapsed {
  max-height: 156px;
}
.submission-code code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: var(--vscode-editor-font-size, 12px);
  line-height: var(--vscode-editor-line-height, 1.45);
  tab-size: 2;
}
.submission-code .hljs {
  display: block;
  background: transparent;
  color: var(--vscode-editor-foreground, var(--lcpr-fg));
}
.submission-code-toggle {
  align-self: flex-start;
}
.submission-section textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 60px;
  max-height: 220px;
  resize: none;
  overflow: hidden;
  padding: 5px 8px;
  border: 1px solid var(--vscode-input-border, var(--lcpr-border));
  border-radius: 3px;
  background: var(--vscode-input-background, var(--lcpr-bg));
  color: var(--vscode-input-foreground, var(--lcpr-fg));
  outline: none;
  font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 12px;
  line-height: 20px;
}
.submission-section textarea:focus {
  border-color: var(--lcpr-focus-gray);
  box-shadow: none;
}
.submission-note-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.submission-note-notice {
  margin-left: auto;
  color: var(--lcpr-muted);
  font-size: 11px;
  opacity: 0;
  animation: lcpr-fade-in 180ms ease both;
}
.submission-note-notice.success {
  color: var(--lcpr-success-deep);
}
.submission-note-notice.error {
  color: var(--vscode-errorForeground, var(--lcpr-fg));
}
@keyframes lcpr-fade-in {
  from { opacity: 0; transform: translateY(2px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .submission-note-notice {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
}
.katex-display {
  overflow-x: auto;
  overflow-y: hidden;
}
${this.buildSubmissionCodeHighlightStyle()}
</style>`;
    }
}
export const companionService = new LeetCodeCompanionProvider();
function registerLeetCodeCompanion(context) {
    companionService.context = context;
    const disposable = vscode.Disposable.from(vscode.window.registerWebviewViewProvider("LCPRCompanionView", companionService, { webviewOptions: { retainContextWhenHidden: true } }), { dispose: () => companionService.dispose() });
    context.subscriptions.push(disposable);
    return disposable;
}
export { registerLeetCodeCompanion };
