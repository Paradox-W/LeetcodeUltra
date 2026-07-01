// @ts-nocheck
/*
 * Filename: https://github.com/ccagml/leetcode-extension/src/service/SolutionService.ts
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
import * as path from "path";
import * as BABA_1 from "../BABA";
import * as CompanionModule_1 from "../companion/CompanionModule";
class SolutionService extends BaseWebviewService_1.BaseWebViewService {
    constructor() {
        super(...arguments);
        this.viewType = "leetcode.solution";
    }
    show(solutionString, is_hints = false) {
        this.is_hints = is_hints;
        if (is_hints) {
            this.hints = this.parseHints(solutionString);
            CompanionModule_1.companionService.showHints(this.hints);
        }
        else {
            this.solution = this.parseSolution(solutionString);
            if (this.solution.init_data) {
                CompanionModule_1.companionService.showSolution(this.solution);
            }
        }
    }
    getWebviewOption() {
        if (BABA_1.BABA.getProxy(BABA_1.BabaStr.PreviewProxy).isSideMode()) {
            return {
                title: this.is_hints ? "Hints" : "Solution",
                viewColumn: vscode_1.ViewColumn.Two,
                preserveFocus: true,
            };
        }
        else {
            return {
                title: this.is_hints ? "Hints" : `Solution: ${this.problemName}`,
                viewColumn: vscode_1.ViewColumn.One,
            };
        }
    }
    getWebviewContent() {
        if (this.is_hints) {
            return this.getHintsContent();
        }
        else {
            return this.getSolutionContent();
        }
    }
    getHintsContent() {
        var _a;
        const styles = MarkdownService_1.markdownService.getStyles(this.panel);
        let h = this.hints;
        let body = [];
        if (h.length == 0) {
            body.push("本题无提示");
        }
        else {
            for (let index = 0; index < h.length; index++) {
                const element = h[index];
                let hint_body = ["<details><summary>", `提示:${index}`, "</summary>", `${element}`, "</details>"].join("\n");
                body.push(hint_body);
            }
        }
        let kates_css_path = path.join(__dirname, "..", "..", "..", "resources", "katexcss", "kates.min.css");
        const catGifSrc = (_a = this.panel) === null || _a === void 0 ? void 0 : _a.webview.asWebviewUri(vscode_1.Uri.file(kates_css_path));
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta http-equiv="Content-Security-Policy" content="default-src self; img-src vscode-resource:; script-src vscode-resource: 'self' 'unsafe-inline'; style-src vscode-resource: 'self' 'unsafe-inline'; "/>
                ${styles}
                <link rel="stylesheet" type="text/css" href= "${catGifSrc}">
            </head>
            <body class="vscode-body 'scrollBeyondLastLine' 'wordWrap' 'showEditorSelection'" style="tab-size:4">
                ${body.join("\n")}
            </body>
            </html>
        `;
    }
    getSolutionContent() {
        var _a;
        const styles = MarkdownService_1.markdownService.getStyles(this.panel);
        const { title, url, lang, author, votes } = this.solution;
        const head = MarkdownService_1.markdownService.render(`# [${title}](${url})`);
        const auth = this.solution.is_cn
            ? `[${author}](https://leetcode.cn/u/${author}/)`
            : `[${author}](https://leetcode.com/${author}/)`;
        const info = MarkdownService_1.markdownService.render([
            `| Language |  Author  |  Votes   |`,
            `| :------: | :------: | :------: |`,
            `| ${lang}  | ${auth}  | ${votes} |`,
        ].join("\n"));
        // $\textit
        // this.solution.body = this.solution.body.replace(/\$\\textit/g, "$");
        // this.solution.body = this.solution.body.replace(/\$\\texttt/g, "$");
        // this.solution.body = this.solution.body.replace(/\$\\text/g, "$");
        const body = MarkdownService_1.markdownService.render(this.solution.body, {
            lang: this.solution.lang,
            host: "https://discuss.leetcode.com/",
        });
        // "<link rel=\"stylesheet\" type=\"text/css\" href=\"vscode-resource:/home/cc/.vscode-server/bin/30d9c6cd9483b2cc586687151bcbcd635f373630/extensions/markdown-language-features/media/markdown.css\">\n<link rel=\"stylesheet\" type=\"text/css\" href=\"vscode-resource:/home/cc/.vscode-server/bin/30d9c6cd9483b2cc586687151bcbcd635f373630/extensions/markdown-language-features/media/highlight.css\">\n<style>\nbody {\n    font-family: -apple-system, BlinkMacSystemFont, 'Segoe WPC', 'Segoe UI', system-ui, 'Ubuntu', 'Droid Sans', sans-serif;\n    font-size: 14px;\n    line-height: 1.6;\n}\n</style>"
        // <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https:; script-src vscode-resource:; style-src vscode-resource:;"/>
        let kates_css_path = path.join(__dirname, "..", "..", "..", "resources", "katexcss", "kates.min.css");
        const catGifSrc = (_a = this.panel) === null || _a === void 0 ? void 0 : _a.webview.asWebviewUri(vscode_1.Uri.file(kates_css_path));
        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta http-equiv="Content-Security-Policy" content="default-src self; img-src vscode-resource:; script-src vscode-resource: 'self' 'unsafe-inline'; style-src vscode-resource: 'self' 'unsafe-inline'; "/>
                ${styles}
                <link rel="stylesheet" type="text/css" href= "${catGifSrc}">
            </head>
            <body class="vscode-body 'scrollBeyondLastLine' 'wordWrap' 'showEditorSelection'" style="tab-size:4">
                ${head}
                ${info}
                ${body}
            </body>
            </html>
        `;
    }
    onDidDisposeWebview() {
        super.onDidDisposeWebview();
    }
    parseSolution(raw) {
        let obj = JSON.parse(raw);
        let solution = new Solution();
        if (obj.code == 100 && obj.solution) {
            this.problemName = obj.solution.problem_name;
            solution.title = obj.solution.title;
            solution.url = obj.solution.url;
            solution.lang = obj.solution.lang;
            solution.author = obj.solution.author;
            solution.votes = obj.solution.votes || 0;
            solution.body = obj.solution.body;
            solution.is_cn = obj.solution.is_cn;
            solution.init_data = true;
            return solution;
        }
        return solution;
    }
    parseHints(raw) {
        let obj = JSON.parse(raw);
        if (obj.code == 100) {
            return obj.hints;
        }
        return [];
    }
}
// tslint:disable-next-line:max-classes-per-file
class Solution {
    constructor() {
        this.title = "";
        this.url = "";
        this.lang = "";
        this.author = "";
        this.votes = "";
        this.body = ""; // Markdown supported
        this.is_cn = false;
        this.init_data = false;
    }
}
export const solutionService = new SolutionService();
class SolutionProxy extends BABA_1.BABAProxy {
    constructor() {
        super(SolutionProxy.NAME);
    }
    show(solutionString, hints) {
        solutionService.show(solutionString, hints);
    }
}
export { SolutionProxy };
SolutionProxy.NAME = BABA_1.BabaStr.SolutionProxy;
class SolutionMediator extends BABA_1.BABAMediator {
    constructor() {
        super(SolutionMediator.NAME);
    }
    listNotificationInterests() {
        return [BABA_1.BabaStr.VSCODE_DISPOST];
    }
    handleNotification(_notification) {
        return __awaiter(this, void 0, void 0, function* () {
            switch (_notification.getName()) {
                case BABA_1.BabaStr.VSCODE_DISPOST:
                    solutionService.dispose();
                    break;
                default:
                    break;
            }
        });
    }
}
export { SolutionMediator };
SolutionMediator.NAME = BABA_1.BabaStr.SolutionMediator;
