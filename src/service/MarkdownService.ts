/*
 * Filename: https://github.com/ccagml/leetcode-extension/src/service/markdownService.ts
 * Path: https://github.com/ccagml/leetcode-extension
 * Created Date: Thursday, October 27th 2022, 7:43:29 pm
 * Author: ccagml
 *
 * Copyright (c) 2022 ccagml . All rights reserved.
 */

import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { BABA, BabaStr } from "../BABA";
import { isWindows } from "../utils/SystemUtils";

class MarkdownService implements vscode.Disposable {
  private engine: any;
  private config: MarkdownConfiguration;
  private listener: vscode.Disposable;
  private highlighter: any;

  public constructor() {
    this.reload();
    this.listener = vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
      if (event.affectsConfiguration("markdown")) {
        this.reload();
      }
    }, this);
  }

  public get localResourceRoots(): vscode.Uri[] {
    return [
      vscode.Uri.file(path.join(this.config.extRoot, "media")),
      vscode.Uri.file(path.join(__dirname, "..", "..", "..", "resources", "katexcss")),
    ];
  }

  public dispose(): void {
    this.listener.dispose();
  }

  public reload(): void {
    this.config = new MarkdownConfiguration();
    this.engine = undefined;
  }

  public render(md: string, env?: any): string {
    const normalized = this.normalizeMath(md);
    return this.restoreMathFallbacks(this.getEngine().render(normalized.text, env), normalized.fallbacks);
  }

  public getStyles(panel: vscode.WebviewPanel | undefined): string {
    return [this.getBuiltinStyles(panel), this.getDefaultStyle()].join(os.EOL);
  }

  private getBuiltinStyles(panel: vscode.WebviewPanel | undefined): string {
    let styles: vscode.Uri[] = [];
    try {
      const stylePaths: string[] = require(path.join(this.config.extRoot, "package.json"))["contributes"][
        "markdown.previewStyles"
      ];
      styles = stylePaths.map((p: string) =>
        vscode.Uri.file(path.join(this.config.extRoot, p))
      );
    } catch (error) {
      BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine("[Error] Fail to load built-in markdown style file.");
    }
    let bbb = styles
      .map((style: vscode.Uri) => `<link rel="stylesheet" type="text/css" href="${panel?.webview.asWebviewUri(style)}">`)
      .join(os.EOL);
    return bbb
  }

  private getDefaultStyle(): string {
    return [
      `<style>`,
      `body {`,
      `    ${this.config.fontFamily ? `font-family: ${this.config.fontFamily};` : ``}`,
      `    ${isNaN(this.config.fontSize) ? `` : `font-size: ${this.config.fontSize}px;`}`,
      `    ${isNaN(this.config.lineHeight) ? `` : `line-height: ${this.config.lineHeight};`}`,
      `}`,
      `</style>`,
    ].join(os.EOL);
  }

  private getEngine(): any {
    if (!this.engine) {
      this.engine = this.initEngine();
    }
    return this.engine;
  }

  private initEngine(): any {
    const MarkdownIt = require("markdown-it");
    const MarkDownItKatex = require("markdown-it-katex");
    const md: any = new MarkdownIt({
      linkify: true,
      typographer: true,
      highlight: (code: string, lang?: string): string => {
        switch (lang && lang.toLowerCase()) {
          case "mysql":
            lang = "sql";
            break;
          case "json5":
            lang = "json";
            break;
          case "python3":
            lang = "python";
            break;
        }
        const highlighter = lang ? this.getHighlighter() : undefined;
        if (lang && highlighter && highlighter.getLanguage(lang)) {
          try {
            return highlighter.highlight(lang, code, true).value;
          } catch (error) {
            /* do not highlight */
          }
        }
        return ""; // use external default escaping
      },
    });

    md.use(MarkDownItKatex);
    this.addCodeBlockHighlight(md);
    this.addImageUrlCompletion(md);
    this.addLinkValidator(md);
    return md;
  }

  private getHighlighter(): any {
    if (!this.highlighter) {
      this.highlighter = require("highlight.js");
    }
    return this.highlighter;
  }

  private normalizeMath(md: string): { text: string; fallbacks: string[] } {
    const lines: string[] = String(md || "").split(/\n/);
    const result: string[] = [];
    const fallbacks: string[] = [];
    let textBuffer: string[] = [];
    let inFence: string | undefined;
    const flushText = (): void => {
      if (!textBuffer.length) {
        return;
      }
      result.push(this.normalizeMathText(textBuffer.join("\n"), fallbacks));
      textBuffer = [];
    };
    lines.forEach((line: string) => {
      const fence = line.match(/^\s*(```|~~~)/);
      if (fence) {
        if (!inFence) {
          flushText();
          inFence = fence[1];
          result.push(line);
          return;
        }
        result.push(line);
        if (fence[1] === inFence) {
          inFence = undefined;
        }
        return;
      }
      if (inFence) {
        result.push(line);
      } else {
        textBuffer.push(line);
      }
    });
    flushText();
    return { text: result.join("\n"), fallbacks };
  }

  private normalizeMathText(text: string, fallbacks: string[]): string {
    return this.normalizeKatexCompatibility(String(text || ""))
      .replace(/\\\[([\s\S]*?)\\\]/g, (_match: string, expr: string) => `\n\n$$${expr}$$\n\n`)
      .replace(/\$\$([\s\S]*?)\$\$/g, (_match: string, expr: string) => this.normalizeDisplayMath(expr, fallbacks))
      .replace(/\\\(([\s\S]*?)\\\)/g, (_match: string, expr: string) => `$${expr}$`);
  }

  private normalizeKatexCompatibility(text: string): string {
    return String(text || "")
      .replace(/\\begin\{alignedat\*?\}(?:\{\d+\})?/g, "\\begin{aligned}")
      .replace(/\\end\{alignedat\*?\}/g, "\\end{aligned}")
      .replace(/\\textrm\b/g, "\\text")
      .replace(/\\textit\b/g, "\\text")
      .replace(/\\texttt\b/g, "\\text")
      .replace(/\\text\{``([^{}]*)''\}/g, (_match: string, value: string) => `\\text{"${value}"}`)
      .replace(/\\xRightarrow(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, "\\Longrightarrow")
      .replace(/\\xrightarrow(?:\[[^\]]*\])?(?:\{[^}]*\})?/g, "\\longrightarrow");
  }

  private normalizeDisplayMath(expr: string, fallbacks: string[]): string {
    const normalized: string = this.normalizeKatexCompatibility(expr);
    const fallback: string | undefined = this.renderCasesFallback(normalized);
    if (!fallback) {
      return `\n\n$$${normalized}$$\n\n`;
    }
    const token: string = this.mathFallbackToken(fallbacks.length);
    fallbacks.push(fallback);
    return `\n\n${token}\n\n`;
  }

  private renderCasesFallback(expr: string): string | undefined {
    if (!/[^\x00-\x7F]/.test(expr) || !/\\begin\{cases\}/.test(expr)) {
      return undefined;
    }
    const match: RegExpMatchArray | null = expr.match(/^([\s\S]*?)\\begin\{cases\}([\s\S]*?)\\end\{cases\}([\s\S]*?)$/);
    if (!match) {
      return undefined;
    }
    const prefix: string = match[1].trim();
    const body: string = match[2].trim();
    const suffix: string = match[3].trim();
    const rows = body
      .split(/\\\\/)
      .map((row: string) => row.trim())
      .filter((row: string) => row.length > 0)
      .map((row: string) => {
        const parts: string[] = row.split(/&+/);
        const value: string = (parts.shift() || "").trim();
        const condition: string = parts.join(" ").trim();
        return `<div class="lcpr-math-case-row"><div class="lcpr-math-case-value">${this.escapeHtml(this.plainMathText(value))}</div><div class="lcpr-math-case-condition">${this.escapeHtml(this.plainMathText(condition))}</div></div>`;
      });
    if (!rows.length) {
      return undefined;
    }
    return [
      `<div class="lcpr-math-fallback">`,
      prefix ? `<div class="lcpr-math-prefix">${this.escapeHtml(this.plainMathText(prefix))}</div>` : "",
      `<div class="lcpr-math-brace">{</div>`,
      `<div class="lcpr-math-cases">${rows.join("")}</div>`,
      suffix ? `<div class="lcpr-math-suffix">${this.escapeHtml(this.plainMathText(suffix))}</div>` : "",
      `</div>`,
    ].join("");
  }

  private plainMathText(expr: string): string {
    return String(expr || "")
      .replace(/\\quad/g, " ")
      .replace(/\\qquad/g, " ")
      .replace(/\\dots/g, "...")
      .replace(/\\ldots/g, "...")
      .replace(/\\text\{([^{}]*)\}/g, "$1")
      .replace(/\\mathrm\{([^{}]*)\}/g, "$1")
      .replace(/~/g, " ")
      .replace(/[{}]/g, "")
      .replace(/\\([A-Za-z]+)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  private restoreMathFallbacks(html: string, fallbacks: string[]): string {
    return fallbacks.reduce((result: string, fallback: string, index: number) => {
      const token: string = this.mathFallbackToken(index);
      const wrapped: RegExp = new RegExp(`<p>\\s*${token}\\s*</p>`, "g");
      return result.replace(wrapped, fallback).replace(new RegExp(token, "g"), fallback);
    }, html);
  }

  private mathFallbackToken(index: number): string {
    return `LCPR_MATH_FALLBACK_${index}`;
  }

  private addCodeBlockHighlight(md: any): void {
    const codeBlock: any = md.renderer.rules["code_block"];
    // tslint:disable-next-line:typedef
    md.renderer.rules["code_block"] = (tokens, idx, options, env, self) => {
      // if any token uses lang-specified code fence, then do not highlight code block
      if (tokens.some((token: any) => token.type === "fence")) {
        return codeBlock(tokens, idx, options, env, self);
      }
      // otherwise, highlight with default lang in env object.
      const highlighted: string = options.highlight(tokens[idx].content, env.lang);
      return [
        `<pre><code ${self.renderAttrs(tokens[idx])} >`,
        highlighted || md.utils.escapeHtml(tokens[idx].content),
        "</code></pre>",
      ].join(os.EOL);
    };
  }

  private addImageUrlCompletion(md: any): void {
    const image: any = md.renderer.rules["image"];
    // tslint:disable-next-line:typedef
    md.renderer.rules["image"] = (tokens, idx, options, env, self) => {
      const token: any = tokens[idx];
      const imageSrc: string[] | undefined = token.attrs.find((value: string[]) => value[0] === "src");
      const rawSrc: string = imageSrc ? String(imageSrc[1] || "") : "";
      const alt: string = String(token.content || "");
      if (this.isVideoImage(rawSrc, alt)) {
        return this.renderVideoImage(rawSrc, alt, env);
      }
      if (env.host && imageSrc && imageSrc[1].startsWith("/")) {
        imageSrc[1] = `${env.host}${imageSrc[1]}`;
      }
      return image(tokens, idx, options, env, self);
    };
  }

  private isVideoImage(src: string, alt: string): boolean {
    const text: string = `${src || ""} ${alt || ""}`;
    if (/\.(?:mp4|webm|mov|m4v)(?:[?#]|\s|$)/i.test(text)) {
      return true;
    }
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(src)
      && /视频|video/i.test(alt);
  }

  private renderVideoImage(src: string, alt: string, env: any): string {
    const title: string = alt || "视频题解";
    if (/^https?:\/\//i.test(src) && /\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i.test(src)) {
      const escapedSrc: string = this.escapeHtmlAttr(src);
      const escapedTitle: string = this.escapeHtml(title);
      return `<figure class="lcpr-video-card"><video controls preload="metadata" src="${escapedSrc}" aria-label="${escapedTitle}"></video></figure>`;
    }
    const articleUrl: string = String((env && (env.articleUrl || env.url)) || "");
    const action: string = articleUrl
      ? `<a class="lcpr-video-action" href="${this.escapeHtmlAttr(articleUrl)}">打开视频</a>`
      : "";
    return [
      `<figure class="lcpr-video-card" data-lcpr-video-id="${this.escapeHtmlAttr(src)}">`,
      `<div class="lcpr-video-body">`,
      `<div class="lcpr-video-kind">视频题解</div>`,
      `<div class="lcpr-video-title">${this.escapeHtml(title)}</div>`,
      `</div>`,
      action,
      `</figure>`,
    ].join("");
  }

  private escapeHtml(value: string): string {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private escapeHtmlAttr(value: string): string {
    return this.escapeHtml(value).replace(/'/g, "&#39;");
  }

  private addLinkValidator(md: any): void {
    const validateLink: (link: string) => boolean = md.validateLink;
    md.validateLink = (link: string): boolean => {
      // support file:// protocal link
      return validateLink(link) || link.startsWith("file:");
    };
  }
}

// tslint:disable-next-line: max-classes-per-file
class MarkdownConfiguration {
  public readonly extRoot: string; // root path of vscode built-in markdown extension
  public readonly lineHeight: number;
  public readonly fontSize: number;
  public readonly fontFamily: string;

  public constructor() {
    const markdownConfig: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("markdown", null);
    this.extRoot = path.join(vscode.env.appRoot, "extensions", "markdown-language-features");
    this.lineHeight = Math.max(0.6, +markdownConfig.get<number>("preview.lineHeight", NaN));
    this.fontSize = Math.max(8, +markdownConfig.get<number>("preview.fontSize", NaN));
    this.fontFamily = this.resolveFontFamily(markdownConfig);
  }

  private resolveFontFamily(config: vscode.WorkspaceConfiguration): string {
    let fontFamily: string = config.get<string>("preview.fontFamily", "");
    if (isWindows() && fontFamily === config.inspect<string>("preview.fontFamily")!.defaultValue) {
      fontFamily = `${fontFamily}, 'Microsoft Yahei UI'`;
    }
    return fontFamily;
  }
}

export const markdownService: MarkdownService = new MarkdownService();
