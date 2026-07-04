// @ts-nocheck
/*
 * Filename: https://github.com/ccagml/leetcode-extension/src/service/SubmissionService.ts
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
import * as vscode_1 from "vscode";
import * as BaseWebviewService_1 from "../service/BaseWebviewService";
import * as MarkdownService_1 from "../service/MarkdownService";
import * as OutputUtils_1 from "../utils/OutputUtils";
import * as ConfigUtils_1 from "../utils/ConfigUtils";
import * as BABA_1 from "../BABA";
import * as ConstDefind_1 from "../model/ConstDefind";
class SubmissionService extends BaseWebviewService_1.BaseWebViewService {
    constructor() {
        super(...arguments);
        this.viewType = "leetcode.submission";
        this.tempTestCase = new Map();
    }
    getTSDByQid(qid) {
        return this.tempTestCase.get(qid);
    }
    inferWorkbenchRunMode(submitEvent, tsd) {
        if ((submitEvent === null || submitEvent === void 0 ? void 0 : submitEvent.sub_type) === "submit") {
            return "submit";
        }
        if (!tsd) {
            return undefined;
        }
        if (tsd.allCase) {
            return "allcase";
        }
        if (tsd.type === 3 || tsd.type === 4) {
            return "case";
        }
        return "test";
    }
    show(resultString, tsd) {
        var _a;
        this.result = this.parseResult(resultString);
        const temp = this.getSubmitEvent();
        let costTime = BABA_1.BABA.getProxy(BABA_1.BabaStr.StatusBarTimeProxy).getCostTimeStr();
        if ((temp === null || temp === void 0 ? void 0 : temp.accepted) && (temp === null || temp === void 0 ? void 0 : temp.sub_type) == "submit" && costTime) {
            this.result["costTime"] = [`耗时 ${costTime}`];
        }
        vscode_1.commands.executeCommand("lcpr.workbench.showResult", {
            result: this.result,
            submitEvent: temp,
            runMode: this.inferWorkbenchRunMode(temp, tsd),
        }).then(undefined, () => this.showWebviewInternal());
        this.showKeybindingsHint();
        let submit_event = this.getSubmitEvent();
        if (tsd != undefined) {
            let qid = (_a = submit_event === null || submit_event === void 0 ? void 0 : submit_event.qid) === null || _a === void 0 ? void 0 : _a.toString();
            this.tempTestCase.set(qid, tsd);
        }
        this.triggerRaycastConfetti(submit_event);
        BABA_1.BABA.sendNotification(BABA_1.BabaStr.CommitResult_showFinish, submit_event);
    }
    triggerRaycastConfetti(submitEvent) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!submitEvent || submitEvent.sub_type !== "submit" || submitEvent.accepted !== true) {
                return;
            }
            try {
                const opened = yield vscode_1.env.openExternal(vscode_1.Uri.parse("raycast://confetti"));
                if (!opened) {
                    yield (0, OutputUtils_1.ShowMessage)("LeetCode AC celebration needs Raycast installed and its confetti URL handler enabled.", ConstDefind_1.OutPutType.warning);
                }
            }
            catch (error) {
                yield (0, OutputUtils_1.ShowMessage)("LeetCode AC celebration needs Raycast installed and its confetti URL handler enabled.", ConstDefind_1.OutPutType.warning);
            }
        });
    }
    getSubmitEvent() {
        return this.result.system_message;
    }
    getWebviewOption() {
        return {
            title: "Submission",
            viewColumn: vscode_1.ViewColumn.Two,
        };
    }
    sections_filtter(key) {
        if (key.substring(0, 6) == "Output" || key.substring(0, 6) == "Answer") {
            return false;
        }
        else if (key.substring(0, 8) == "Expected") {
            return false;
        }
        else if (key == "messages") {
            return false;
        }
        else if (key == "system_message") {
            return false;
        }
        else if (key == "costTime") {
            return false;
        }
        return true;
    }
    getAnswerKey(result) {
        let ans;
        let exp;
        for (const key in result) {
            if (key.substring(0, 6) == "Output" || key.substring(0, 6) == "Answer") {
                ans = key;
            }
            else if (key.substring(0, 8) == "Expected") {
                exp = key;
            }
            if (ans != undefined && exp != undefined) {
                break;
            }
        }
        let key = [];
        key.push(ans);
        key.push(exp);
        return key;
    }
    getWebviewContent() {
        const styles = MarkdownService_1.markdownService.getStyles(this.panel);
        const submitEvent = this.getSubmitEvent();
        if ((submitEvent === null || submitEvent === void 0 ? void 0 : submitEvent.sub_type) === "submit") {
            return this.renderSubmissionResultView(styles, submitEvent);
        }
        return this.renderMarkdownResultView(styles);
    }
    renderMarkdownResultView(styles) {
        const title = `## ${this.result.messages[0]}`;
        const resultMessages = this.result.messages.slice();
        if (this.result.costTime && this.result.costTime.length > 0 && resultMessages.indexOf(this.result.costTime[0]) < 0) {
            resultMessages.push(this.result.costTime[0]);
        }
        const messages = resultMessages.slice(1).map((m) => `* ${m}`);
        const sections = this.getResultSectionsMarkdown(false);
        let body = MarkdownService_1.markdownService.render([title, ...messages, ...sections].join("\n"));
        let aaa = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; script-src vscode-resource:; style-src vscode-resource:;"/>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${styles}
    </head>
    <body class="vscode-body 'scrollBeyondLastLine' 'wordWrap' 'showEditorSelection'" style="tab-size:4">
        ${body}
    </body>
    </html>
`;
        return aaa;
    }
    getResultSectionsMarkdown(forCustomView) {
        let sections = [];
        if ((0, ConfigUtils_1.isAnswerDiffColor)()) {
            sections = Object.keys(this.result)
                .filter(this.sections_filtter)
                .map((key) => [`### ${key}`, "```", this.result[key].join("\n"), "```"].join("\n"));
            let ans_key = this.getAnswerKey(this.result);
            if (ans_key[0] != undefined && ans_key[1] != undefined) {
                sections.push(`### Answer\n`);
                sections.push(`| ${ans_key[0]} | ${ans_key[1]}  | `);
                sections.push(`|  :---------:  | :---------:    | `);
                let ans = this.result[ans_key[0]];
                let exp = this.result[ans_key[1]];
                let max_len = Math.max(ans.length, exp.length);
                for (let index = 0; index < max_len; index++) {
                    sections.push(`| ${ans[index] || ""} | ${exp[index] || ""}  | `);
                }
            }
            // require("../utils/testHot").test_add_table(sections);
        }
        else {
            sections = Object.keys(this.result)
                .filter((key) => key !== "messages" && key !== "system_message")
                .map((key) => [`### ${key}`, "```", this.result[key].join("\n"), "```"].join("\n"));
        }
        if (forCustomView) {
            return sections.filter((section) => section.trim());
        }
        return sections;
    }
    renderSubmissionResultView(styles, submitEvent) {
        const accepted = submitEvent.accepted === true;
        const status = this.escapeHtml(this.result.messages[0] || submitEvent.status || (accepted ? "Accepted" : "Submission"));
        const statusClass = accepted ? "is-accepted" : "is-failed";
        const eyebrow = accepted ? "Submission complete" : "Submission needs attention";
        const chips = this.renderMetricChips(submitEvent);
        const subtitleLines = this.renderSubtitleLines(submitEvent);
        const diagnostics = this.renderDiagnostics();
        return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; script-src vscode-resource:; style-src vscode-resource: 'unsafe-inline';"/>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        ${styles}
        <style>
            :root {
                --lcpr-success: #137333;
                --lcpr-success-soft: rgba(19, 115, 51, 0.16);
                --lcpr-success-line: rgba(19, 115, 51, 0.42);
                --lcpr-failed: #ff6b6b;
                --lcpr-failed-soft: rgba(255, 107, 107, 0.14);
                --lcpr-failed-line: rgba(255, 107, 107, 0.36);
                --lcpr-panel: color-mix(in srgb, var(--vscode-editor-background, #171922) 84%, #ffffff 6%);
                --lcpr-panel-line: rgba(255,255,255,0.1);
                --lcpr-muted: var(--vscode-descriptionForeground, #a9adb7);
            }
            html {
                background: var(--vscode-editor-background, #171922);
            }
            body.lcpr-result-body {
                --lcpr-page-glow: rgba(19,115,51,0.13);
                max-width: 980px;
                min-height: 100vh;
                margin: 0 auto;
                padding: clamp(28px, 5vw, 58px);
                box-sizing: border-box;
                background:
                    radial-gradient(circle at 18% 12%, var(--lcpr-page-glow), transparent 28rem),
                    radial-gradient(circle at 82% 8%, rgba(255,255,255,0.08), transparent 24rem),
                    var(--vscode-editor-background, #171922);
                color: var(--vscode-editor-foreground, #f7f7f8);
                font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
                letter-spacing: 0;
            }
            body.lcpr-result-body.is-failed {
                --lcpr-page-glow: rgba(255,107,107,0.12);
            }
            .lcpr-result-shell {
                display: grid;
                gap: 18px;
            }
            .lcpr-result-card {
                position: relative;
                overflow: hidden;
                border: 1px solid var(--lcpr-panel-line);
                border-radius: 18px;
                background: linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.035)), var(--lcpr-panel);
                box-shadow: 0 24px 60px rgba(0,0,0,0.26);
                padding: clamp(24px, 4vw, 42px);
                animation: lcprPanelIn 420ms cubic-bezier(.2,.8,.2,1) both;
            }
            .lcpr-result-card::before {
                content: "";
                position: absolute;
                inset: 0 0 auto 0;
                height: 3px;
                background: var(--lcpr-state);
                opacity: 0.9;
            }
            .lcpr-result-card.is-accepted {
                --lcpr-state: var(--lcpr-success);
                --lcpr-state-soft: var(--lcpr-success-soft);
                --lcpr-state-line: var(--lcpr-success-line);
            }
            .lcpr-result-card.is-failed {
                --lcpr-state: var(--lcpr-failed);
                --lcpr-state-soft: var(--lcpr-failed-soft);
                --lcpr-state-line: var(--lcpr-failed-line);
            }
            .lcpr-kicker {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                color: var(--lcpr-muted);
                font-size: 12px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.08em;
            }
            .lcpr-pulse {
                width: 8px;
                height: 8px;
                border-radius: 999px;
                background: var(--lcpr-state);
                box-shadow: 0 0 0 0 var(--lcpr-state-soft);
                animation: lcprPulse 1800ms ease-out 2;
            }
            .lcpr-title {
                margin: 16px 0 18px;
                color: var(--lcpr-state);
                font-size: clamp(44px, 8vw, 82px);
                font-weight: 850;
                line-height: 0.94;
                letter-spacing: 0;
                text-wrap: balance;
                animation: lcprTitleIn 520ms cubic-bezier(.2,.9,.2,1) 90ms both;
            }
            .lcpr-rule {
                height: 1px;
                margin: 0 0 22px;
                background: linear-gradient(90deg, var(--lcpr-state-line), rgba(255,255,255,0.08), transparent);
            }
            .lcpr-chip-grid {
                display: flex;
                flex-wrap: wrap;
                gap: 10px;
                margin: 0 0 24px;
            }
            .lcpr-chip {
                min-width: 116px;
                border: 1px solid rgba(255,255,255,0.1);
                border-radius: 12px;
                background: rgba(255,255,255,0.045);
                padding: 10px 12px;
                animation: lcprItemIn 420ms cubic-bezier(.2,.8,.2,1) both;
            }
            .lcpr-chip:nth-child(1) { animation-delay: 160ms; }
            .lcpr-chip:nth-child(2) { animation-delay: 230ms; }
            .lcpr-chip:nth-child(3) { animation-delay: 300ms; }
            .lcpr-chip:nth-child(4) { animation-delay: 370ms; }
            .lcpr-chip-label {
                display: block;
                margin-bottom: 4px;
                color: var(--lcpr-muted);
                font-size: 11px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.06em;
            }
            .lcpr-chip-value {
                display: block;
                color: var(--vscode-editor-foreground, #fff);
                font-family: var(--vscode-editor-font-family, "SF Mono", Menlo, monospace);
                font-size: 15px;
                font-weight: 700;
                white-space: nowrap;
            }
            .lcpr-subtitles {
                display: grid;
                gap: 10px;
                margin-top: 4px;
            }
            .lcpr-subtitle {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                color: var(--vscode-editor-foreground, #fff);
                font-size: clamp(16px, 2.1vw, 20px);
                font-weight: 650;
                line-height: 1.45;
                text-wrap: pretty;
                animation: lcprSubtitleIn 520ms cubic-bezier(.2,.8,.2,1) both;
            }
            .lcpr-subtitle:nth-child(1) { animation-delay: 520ms; }
            .lcpr-subtitle:nth-child(2) { animation-delay: 780ms; }
            .lcpr-subtitle:nth-child(3) { animation-delay: 1040ms; }
            .lcpr-subtitle:nth-child(4) { animation-delay: 1300ms; }
            .lcpr-subtitle::before {
                content: "";
                flex: 0 0 auto;
                width: 6px;
                height: 6px;
                margin-top: 0.58em;
                border-radius: 999px;
                background: var(--lcpr-state);
                opacity: 0.85;
            }
            .lcpr-footer {
                display: flex;
                justify-content: space-between;
                gap: 16px;
                margin-top: 30px;
                padding-top: 16px;
                border-top: 1px solid rgba(255,255,255,0.08);
                color: var(--lcpr-muted);
                font-size: 12px;
                font-weight: 650;
            }
            .lcpr-diagnostics {
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 14px;
                background: rgba(255,255,255,0.028);
                padding: 18px 20px;
                animation: lcprItemIn 420ms cubic-bezier(.2,.8,.2,1) 440ms both;
            }
            .lcpr-diagnostics-title {
                margin: 0 0 10px;
                color: var(--lcpr-muted);
                font-size: 12px;
                font-weight: 800;
                text-transform: uppercase;
                letter-spacing: 0.08em;
            }
            .lcpr-diagnostics h3 {
                margin-top: 0;
                color: var(--vscode-editor-foreground, #fff);
            }
            .lcpr-diagnostics pre {
                border-color: rgba(255,255,255,0.08);
                background: rgba(0,0,0,0.16);
            }
            @keyframes lcprPanelIn {
                from { opacity: 0; transform: translateY(10px) scale(0.985); }
                to { opacity: 1; transform: translateY(0) scale(1); }
            }
            @keyframes lcprTitleIn {
                from { opacity: 0; transform: translateY(12px); filter: blur(8px); }
                to { opacity: 1; transform: translateY(0); filter: blur(0); }
            }
            @keyframes lcprItemIn {
                from { opacity: 0; transform: translateY(8px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes lcprSubtitleIn {
                from { opacity: 0; transform: translateY(12px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @keyframes lcprPulse {
                0% { box-shadow: 0 0 0 0 var(--lcpr-state-soft); }
                70% { box-shadow: 0 0 0 12px rgba(19,115,51,0); }
                100% { box-shadow: 0 0 0 0 rgba(19,115,51,0); }
            }
            @media (prefers-reduced-motion: reduce) {
                *, *::before, *::after {
                    animation-duration: 1ms !important;
                    animation-iteration-count: 1 !important;
                    transition-duration: 1ms !important;
                }
            }
        </style>
    </head>
    <body class="vscode-body lcpr-result-body ${statusClass}" style="tab-size:4">
        <main class="lcpr-result-shell">
            <section class="lcpr-result-card ${statusClass}">
                <div class="lcpr-kicker"><span class="lcpr-pulse"></span>${eyebrow}</div>
                <h1 class="lcpr-title">${status}</h1>
                <div class="lcpr-rule"></div>
                <div class="lcpr-chip-grid">${chips}</div>
                <div class="lcpr-subtitles">${subtitleLines}</div>
                <div class="lcpr-footer">
                    <span>LeetCode submission</span>
                    <span>${this.escapeHtml(submitEvent.lang || "")}</span>
                </div>
            </section>
            ${diagnostics}
        </main>
    </body>
    </html>
`;
    }
    renderMetricChips(submitEvent) {
        const cases = submitEvent.total ? `${submitEvent.passed || 0}/${submitEvent.total}` : this.extractCasesText();
        const metrics = [
            ["Cases", cases || "--"],
            ["Runtime", submitEvent.runtime || "--"],
            ["Memory", submitEvent.memory || "--"],
            ["Language", submitEvent.lang || "--"],
        ];
        return metrics.map(([label, value]) => `
            <div class="lcpr-chip">
                <span class="lcpr-chip-label">${this.escapeHtml(label)}</span>
                <span class="lcpr-chip-value">${this.escapeHtml(value)}</span>
            </div>
        `).join("");
    }
    renderSubtitleLines(submitEvent) {
        const lines = [];
        const casesText = this.extractCasesText();
        if (casesText) {
            lines.push(casesText);
        }
        if (submitEvent.runtime_percentile) {
            lines.push(`Your runtime beats ${this.formatPercent(submitEvent.runtime_percentile)}% of ${submitEvent.lang || "all"} submissions`);
        }
        if (submitEvent.memory_percentile) {
            lines.push(`Your memory usage beats ${this.formatPercent(submitEvent.memory_percentile)}% of ${submitEvent.lang || "all"} submissions${submitEvent.memory ? ` (${submitEvent.memory})` : ""}`);
        }
        if (this.result.costTime && this.result.costTime[0]) {
            lines.push(this.result.costTime[0]);
        }
        if (lines.length === 0) {
            lines.push(...this.result.messages.slice(1));
        }
        return lines.map((line) => `<div class="lcpr-subtitle">${this.escapeHtml(line)}</div>`).join("");
    }
    renderDiagnostics() {
        const sections = this.getResultSectionsMarkdown(true);
        if (!sections.length) {
            return "";
        }
        const body = MarkdownService_1.markdownService.render(sections.join("\n"));
        return `<section class="lcpr-diagnostics"><div class="lcpr-diagnostics-title">Diagnostics</div>${body}</section>`;
    }
    extractCasesText() {
        return this.result.messages.find((message) => /cases passed/.test(message)) || "";
    }
    formatPercent(value) {
        const numeric = Number(value);
        if (Number.isNaN(numeric)) {
            return `${value}`;
        }
        return numeric.toFixed(2).replace(/\.?0+$/, "");
    }
    escapeHtml(value) {
        return `${value === undefined || value === null ? "" : value}`
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
    onDidDisposeWebview() {
        super.onDidDisposeWebview();
    }
    showKeybindingsHint() {
        return __awaiter(this, void 0, void 0, function* () {
            let that = this;
            yield (0, OutputUtils_1.promptHintMessage)("hint.commandShortcut", 'You can customize shortcut key bindings in File > Preferences > Keyboard Shortcuts with query "leetcode".', "Open Keybindings", () => that.openKeybindingsEditor("leetcode solution"));
        });
    }
    openKeybindingsEditor(query) {
        return __awaiter(this, void 0, void 0, function* () {
            yield vscode_1.commands.executeCommand("workbench.action.openGlobalKeybindings", query);
        });
    }
    add_color_str(str1, str2) {
        let result = [];
        let min_len = Math.min(str1.length, str2.length);
        let dif_len = 0;
        for (let index = 0; index < min_len; index++) {
            if (str1[index] != str2[index]) {
                dif_len = index;
                break;
            }
        }
        let str1_left = str1.substring(0, dif_len);
        let str1_right = str1.substring(dif_len);
        let str2_left = str2.substring(0, dif_len);
        let str2_right = str2.substring(dif_len);
        result.push(str1_left + this.getRedPre() + str1_right + this.getRedEnd());
        result.push(str2_left + this.getRedPre() + str2_right + this.getRedEnd());
        return result;
    }
    add_color(temp) {
        // let;
        let output_key;
        let expected_key;
        for (const key in temp) {
            if (typeof key == "string") {
                if (key.substring(0, 6) == "Output" || key.substring(0, 6) == "Answer") {
                    output_key = key;
                }
                else if (key.substring(0, 8) == "Expected") {
                    expected_key = key;
                }
                if (output_key && expected_key) {
                    break;
                }
            }
        }
        if (output_key && expected_key) {
            let output_str = temp[output_key] || [];
            let expected_str = temp[expected_key] || [];
            let min_len = Math.min(output_str.length, expected_str.length);
            let compare_result = temp.system_message.compare_result || "";
            for (let index = 0; index < min_len; index++) {
                if (compare_result[index] != '1' && output_str[index] != expected_str[index]) {
                    let temp_result = this.add_color_str(output_str[index], expected_str[index]);
                    output_str[index] = temp_result[0] || "";
                    expected_str[index] = temp_result[1] || "";
                }
            }
        }
    }
    getRedPre() {
        return "__`";
    }
    getRedEnd() {
        return "`__";
    }
    parseResult(raw) {
        var _a;
        let temp = JSON.parse(raw);
        // 当结果是正确的时候,不用判断上色
        if ((_a = temp === null || temp === void 0 ? void 0 : temp.system_message) === null || _a === void 0 ? void 0 : _a.accepted) {
            return temp;
        }
        if ((0, ConfigUtils_1.isAnswerDiffColor)()) {
            this.add_color(temp);
        }
        return temp;
    }
}
export const submissionService = new SubmissionService();
class CommitResultProxy extends BABA_1.BABAProxy {
    constructor() {
        super(CommitResultProxy.NAME);
    }
    getTSDByQid(qid) {
        return submissionService.getTSDByQid(qid);
    }
}
export { CommitResultProxy };
CommitResultProxy.NAME = BABA_1.BabaStr.CommitResultProxy;
class CommitResultMediator extends BABA_1.BABAMediator {
    constructor() {
        super(CommitResultMediator.NAME);
    }
    listNotificationInterests() {
        return [BABA_1.BabaStr.VSCODE_DISPOST, BABA_1.BabaStr.CommitResult_testSolutionResult, BABA_1.BabaStr.CommitResult_submitSolutionResult];
    }
    handleNotification(_notification) {
        return __awaiter(this, void 0, void 0, function* () {
            let body = _notification.getBody();
            switch (_notification.getName()) {
                case BABA_1.BabaStr.VSCODE_DISPOST:
                    submissionService.dispose();
                    break;
                case BABA_1.BabaStr.CommitResult_testSolutionResult:
                    submissionService.show(body.resultString, body.tsd);
                    break;
                case BABA_1.BabaStr.CommitResult_submitSolutionResult:
                    submissionService.show(body.resultString);
                    break;
                default:
                    break;
            }
        });
    }
}
export { CommitResultMediator };
CommitResultMediator.NAME = BABA_1.BabaStr.CommitResultMediator;
