// @ts-nocheck
/*
 * Filename: https://github.com/ccagml/leetcode-extension/src/service/previewService.ts
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
import * as ConstDefind_1 from "../model/ConstDefind";
import * as ConfigUtils_1 from "../utils/ConfigUtils";
import * as BaseWebviewService_1 from "../service/BaseWebviewService";
import * as MarkdownService_1 from "../service/MarkdownService";
import * as BABA_1 from "../BABA";
import * as CompanionModule_1 from "../companion/CompanionModule";
class PreviewService extends BaseWebviewService_1.BaseWebViewService {
    constructor() {
        super(...arguments);
        this.viewType = "leetcode.preview";
        this.sideMode = false;
    }
    isSideMode() {
        return this.sideMode;
    }
    show(descString, node, isSideMode = false) {
        this.description = this.parseDescription(descString, node);
        this.node = node;
        this.sideMode = isSideMode;
        CompanionModule_1.companionService.showDescription(this.description, this.node);
        // Comment out this operation since it sometimes may cause the webview become empty.
        // Waiting for the progress of the VS Code side issue: https://github.com/microsoft/vscode/issues/3742
        // if (this.sideMode) {
        //     this.hideSideBar(); // For better view area
        // }
    }
    getWebviewOption() {
        if (!this.sideMode) {
            return {
                title: `${this.node.name}: Preview`,
                viewColumn: vscode_1.ViewColumn.One,
            };
        }
        else {
            return {
                title: "Description",
                viewColumn: vscode_1.ViewColumn.Two,
                preserveFocus: true,
            };
        }
    }
    getWebviewContent() {
        const button = {
            element: `<button id="solve">Code Now</button>`,
            script: `const button = document.getElementById('solve');
                    button.onclick = () => vscode.postMessage({
                        command: 'ShowProblem',
                    });`,
	            style: `<style>
	                #solve {
	                    position: fixed;
	                    bottom: 1.25rem;
	                    right: 1.25rem;
	                    border: 1px solid var(--lcpr-solve-border);
	                    border-radius: 10px;
	                    margin: 0;
	                    padding: 0.35rem 0.95rem;
	                    min-height: 2.15rem;
	                    color: var(--lcpr-solve-fg);
	                    background-color: var(--lcpr-solve-bg);
	                    font-weight: 700;
	                    cursor: pointer;
	                    box-shadow: none;
	                    transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
	                }
	                #solve:hover {
	                    color: var(--lcpr-solve-hover-fg);
	                    border-color: var(--lcpr-solve-hover-border);
	                    background-color: var(--lcpr-solve-bg);
	                    transform: none;
	                }
	                #solve:active {
	                    border: 1px solid var(--lcpr-solve-border);
	                    transform: none;
	                }
	                </style>`,
        };
        const { title, url, category, difficulty, likes, dislikes, body, contest_slug, problem_index, problem_score } = this.description;
        const head = MarkdownService_1.markdownService.render(`# [${title}](${url})`);
        const info = MarkdownService_1.markdownService.render([
            `| Category | ContestSlug | ProblemIndex | Score |`,
            `| :------: | :---------: | :----------: | :---: |`,
            `| ${category} | ${contest_slug} | ${problem_index} | ${problem_score} | `,
        ].join("\n"));
        const tags = [
            `<details open>`,
            `<summary><strong>Tags</strong></summary>`,
            MarkdownService_1.markdownService.render(this.description.tags.map((t) => `[\`${t}\`](https://leetcode.com/tag/${t})`).join(" | ")),
            `</details>`,
        ].join("\n");
        const links = [
            `<div class="lcpr-actions">`,
            `<a class="lcpr-action-button" href="${this.getDiscussionLink(url)}">讨论</a>`,
            `<a class="lcpr-action-button" href="${this.getSolutionLink(url)}">解决方案</a>`,
            `</div>`,
        ].join("\n");
        const difficultyInfo = [
            `<details class="lcpr-difficulty">`,
            `<summary><strong>Difficulty</strong></summary>`,
            `<p><code>${difficulty}</code></p>`,
            `</details>`,
        ].join("\n");
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; script-src vscode-resource: 'unsafe-inline'; style-src vscode-resource: 'unsafe-inline';"/>
                ${MarkdownService_1.markdownService.getStyles(this.panel)}
                ${!this.sideMode ? button.style : ""}
                <style>
                    pre code { white-space: pre-wrap; }
                </style>
            </head>
            <body>
                ${head}
                ${info}
                ${tags}
                ${body}
                ${difficultyInfo}
                <hr />
                ${links}
                ${!this.sideMode ? button.element : ""}
                <script>
                    const vscode = acquireVsCodeApi();
                    ${!this.sideMode ? button.script : ""}
                </script>
            </body>
            </html>
        `;
    }
    onDidDisposeWebview() {
        super.onDidDisposeWebview();
        this.sideMode = false;
    }
    onDidReceiveMessage(message) {
        return __awaiter(this, void 0, void 0, function* () {
            switch (message.command) {
                case "ShowProblem": {
                    yield vscode_1.commands.executeCommand("lcpr.showProblem", this.node);
                    break;
                }
            }
        });
    }
    parseDescription(descString, problem) {
        var _a, _b, _c;
        let preview_data = JSON.parse(descString);
        return {
            title: problem.name,
            url: preview_data.url,
            tags: problem.tags,
            companies: problem.companies,
            category: preview_data.category,
            difficulty: preview_data.difficulty,
            likes: preview_data.likes,
            dislikes: preview_data.dislikes,
            body: preview_data.desc.replace(/<pre>[\r\n]*([^]+?)[\r\n]*<\/pre>/g, "<pre><code>$1</code></pre>"),
            contest_slug: ((_a = problem === null || problem === void 0 ? void 0 : problem.scoreData) === null || _a === void 0 ? void 0 : _a.ContestSlug) || "-",
            problem_index: ((_b = problem === null || problem === void 0 ? void 0 : problem.scoreData) === null || _b === void 0 ? void 0 : _b.ProblemIndex) || "-",
            problem_score: ((_c = problem === null || problem === void 0 ? void 0 : problem.scoreData) === null || _c === void 0 ? void 0 : _c.score) || "0",
        };
    }
    getDiscussionLink(url) {
        const endPoint = (0, ConfigUtils_1.getLeetCodeEndpoint)();
        if (endPoint === ConstDefind_1.Endpoint.LeetCodeCN) {
            return url.replace("/description/", "/comments/");
        }
        else if (endPoint === ConstDefind_1.Endpoint.LeetCode) {
            return url.replace("/description/", "/discuss/?currentPage=1&orderBy=most_votes&query=");
        }
        return "https://leetcode.com";
    }
    getSolutionLink(url) {
        return url.replace("/description/", "/solution/");
    }
}
export const previewService = new PreviewService();
class PreviewProxy extends BABA_1.BABAProxy {
    constructor() {
        super(PreviewProxy.NAME);
    }
    isSideMode() {
        return previewService.isSideMode();
    }
}
export { PreviewProxy };
PreviewProxy.NAME = BABA_1.BabaStr.PreviewProxy;
class PreviewMediator extends BABA_1.BABAMediator {
    constructor() {
        super(PreviewMediator.NAME);
    }
    listNotificationInterests() {
        return [BABA_1.BabaStr.VSCODE_DISPOST, BABA_1.BabaStr.Preview_show];
    }
    handleNotification(_notification) {
        return __awaiter(this, void 0, void 0, function* () {
            let body = _notification.getBody();
            switch (_notification.getName()) {
                case BABA_1.BabaStr.VSCODE_DISPOST:
                    previewService.dispose();
                    break;
                case BABA_1.BabaStr.Preview_show:
                    previewService.show(body.descString, body.node, body.isSideMode);
                    break;
                default:
                    break;
            }
        });
    }
}
export { PreviewMediator };
PreviewMediator.NAME = BABA_1.BabaStr.PreviewMediator;
