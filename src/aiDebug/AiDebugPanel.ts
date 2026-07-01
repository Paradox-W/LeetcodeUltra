import * as vscode from "vscode";
import { AnalysisResult } from "./AiVariableAnalyzer";
import { CollectedVariable } from "./DapVariableCollector";

export interface AiDebugViewModel {
  title: string;
  status: string;
  analysis?: AnalysisResult;
  variables: CollectedVariable[];
  warnings: string[];
  updatedAt: number;
  canRefresh?: boolean;
}

function escapeHtml(value: any): string {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function panelTheme(): string {
  const raw = String(vscode.workspace.getConfiguration("leetcode-problem-rating").get("aiDebug.visualTheme", "native"));
  return ["native", "dense", "contrast"].indexOf(raw) >= 0 ? raw : "native";
}

function scriptJson(value: any): string {
  return JSON.stringify(value === undefined ? null : value).replace(/</g, "\\u003c");
}

function hintClass(hint: any): string {
  const kind = String(hint && hint.kind || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const attributes = Array.isArray(hint && hint.attributes) ? hint.attributes : [];
  const classes = kind ? [`hint-${kind}`] : [];
  attributes.forEach((attribute) => {
    const text = String(attribute || "").toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (text) {
      classes.push(`hint-${text}`);
    }
  });
  return classes.join(" ");
}

function hintMark(hint: any): string {
  const kind = String(hint && hint.kind || "").toLowerCase();
  const attributes = Array.isArray(hint && hint.attributes) ? hint.attributes.map((item) => String(item || "").toLowerCase()) : [];
  if (attributes.indexOf("readonly") >= 0) {
    return "RO";
  }
  if (attributes.indexOf("static") >= 0) {
    return "S";
  }
  if (kind === "property") {
    return "P";
  }
  if (kind === "class") {
    return "C";
  }
  return kind ? "D" : "";
}

export class AiDebugPanel {
  private panel?: vscode.WebviewPanel;
  private lastModel?: AiDebugViewModel;

  constructor(private readonly context: vscode.ExtensionContext, private readonly refresh: () => Promise<void>) {}

  public get visible(): boolean {
    return !!this.panel && (this.panel as any).visible !== false;
  }

  public show(model?: AiDebugViewModel): void {
    if (model) {
      this.lastModel = model;
    }
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "lcprAiDebug",
        "AI 调试",
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      }, undefined, this.context.subscriptions);
      this.panel.webview.onDidReceiveMessage(async (message) => {
        if (message && message.command === "refresh") {
          await this.refresh();
        }
      }, undefined, this.context.subscriptions);
      this.panel.webview.html = this.renderShell(this.lastModel);
    } else if (model) {
      this.postRender(model);
    }
    this.panel.reveal(undefined, true);
  }

  public update(model: AiDebugViewModel): void {
    this.lastModel = model;
    if (this.panel) {
      this.postRender(model);
    }
  }

  public showDebugEnded(): void {
    if (!this.panel || !this.lastModel) {
      return;
    }
    this.update(Object.assign({}, this.lastModel, {
      status: "调试会话已结束",
      warnings: this.lastModel.warnings.concat(["调试会话已结束，变量值不会继续刷新。"]),
      updatedAt: Date.now(),
      canRefresh: false,
    }));
  }

  private postRender(model: AiDebugViewModel): void {
    if (!this.panel) {
      return;
    }
    this.panel.webview.postMessage({ command: "render", model });
  }

  private renderShell(model?: AiDebugViewModel): string {
    const content = model ? this.renderContent(model) : this.renderEmpty();
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
  <style>${this.style()}</style>
</head>
<body>
  <main class="ai-debug theme-${escapeHtml(panelTheme())}">
    <div id="app">${content}</div>
  </main>
  <script>
    const vscode = acquireVsCodeApi();
    const initialModel = ${scriptJson(model)};
    const app = document.getElementById('app');
    function escapeHtml(value) {
      return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }
    function renderEmpty() {
      return '<section class="empty">' +
        '<div class="empty-title">未捕获关键变量</div>' +
        '<p>启动调试并停在断点后，运行“AI 调试：分析并显示关键变量”。</p>' +
        '<button data-command="refresh" disabled>刷新</button>' +
        '</section>';
    }
    function renderVisual(variable) {
      const visual = variable && variable.visual;
      if (!visual || !visual.kind) return '';
      if (visual.kind.array && Array.isArray(visual.values)) {
        return '<div class="array">' + visual.values.map((item) =>
          '<div class="cell"><span>' + escapeHtml(item.name) + '</span><strong>' + escapeHtml(item.value) + '</strong></div>'
        ).join('') + '</div>';
      }
      if (visual.kind.list && Array.isArray(visual.nodes)) {
        return '<div class="list">' + visual.nodes.map((node, index) =>
          '<div class="list-node"><span>' + escapeHtml(node.value || node.label) + '</span></div>' +
          (index < visual.nodes.length - 1 ? '<div class="arrow">→</div>' : '')
        ).join('') + '</div>';
      }
      if (visual.kind.graph && Array.isArray(visual.nodes)) {
        const nodes = visual.nodes.map((node) =>
          '<div class="graph-node"><span>' + escapeHtml(node.label) + '</span><strong>' + escapeHtml(node.value || '') + '</strong></div>'
        ).join('');
        const edges = Array.isArray(visual.edges) && visual.edges.length
          ? '<div class="edges">' + visual.edges.map((edge) =>
            '<span>' + escapeHtml(edge.from) + ' → ' + escapeHtml(edge.to) + (edge.label ? ' · ' + escapeHtml(edge.label) : '') + '</span>'
          ).join('') + '</div>'
          : '';
        return '<div class="graph"><div class="nodes">' + nodes + '</div>' + edges + '</div>';
      }
      if (visual.kind.object && Array.isArray(visual.values)) {
        return '<div class="object">' + visual.values.map((item) =>
          '<div><span>' + escapeHtml(item.name) + '</span><strong>' + escapeHtml(item.value) + '</strong></div>'
        ).join('') + '</div>';
      }
      return '<pre>' + escapeHtml(visual.text || variable.value || '') + '</pre>';
    }
    function renderVariable(variable) {
      const type = variable.runtimeType || variable.declaredType || '';
      const hint = variable.presentationHint || {};
      const attrs = Array.isArray(hint.attributes) ? hint.attributes : [];
      const hintText = [hint.kind].concat(attrs).filter(Boolean).join(' · ');
      const hintKind = String(hint.kind || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
      const hintClasses = (hintKind ? ['hint-' + hintKind] : []).concat(attrs.map((attr) => 'hint-' + String(attr || '').toLowerCase().replace(/[^a-z0-9_-]/g, '')).filter((item) => item !== 'hint-')).join(' ');
      const hintMark = attrs.map((item) => String(item || '').toLowerCase()).indexOf('readonly') >= 0 ? 'RO' :
        (attrs.map((item) => String(item || '').toLowerCase()).indexOf('static') >= 0 ? 'S' :
          (hintKind === 'property' ? 'P' : (hintKind === 'class' ? 'C' : (hintKind ? 'D' : ''))));
      return '<article class="variable ' + (variable.error ? 'error' : '') + '">' +
        '<div class="variable-head"><div>' +
        '<div class="name-row"><h2>' + escapeHtml(variable.name) + '</h2>' +
        (hintText ? '<span class="hint ' + escapeHtml(hintClasses) + '">' + (hintMark ? '<b>' + escapeHtml(hintMark) + '</b>' : '') + escapeHtml(hintText) + '</span>' : '') + '</div>' +
        '<div class="expr">' + escapeHtml(variable.expression) + (type ? ' · ' + escapeHtml(type) : '') + '</div>' +
        '</div><code>' + escapeHtml(variable.value || variable.error || '') + '</code></div>' +
        renderVisual(variable) +
        '</article>';
    }
    function renderContent(model) {
      const time = new Date(model.updatedAt || Date.now()).toLocaleTimeString();
      const warnings = Array.isArray(model.warnings) && model.warnings.length
        ? '<div class="warnings">' + model.warnings.map((warning) => '<div>' + escapeHtml(warning) + '</div>').join('') + '</div>'
        : '';
      const analysisSource = model.analysis && model.analysis.source ? ' · ' + escapeHtml(model.analysis.source) : '';
      const variables = Array.isArray(model.variables) ? model.variables : [];
      const refreshDisabled = model.canRefresh === false ? ' disabled' : '';
      return '<header class="topbar"><div>' +
        '<h1>' + escapeHtml(model.title) + '</h1>' +
        '<div class="meta">' + escapeHtml(model.status) + ' · ' + escapeHtml(time) + analysisSource + '</div>' +
        '</div><button data-command="refresh"' + refreshDisabled + '>刷新</button></header>' +
        warnings +
        (variables.length ? '<section class="grid">' + variables.map(renderVariable).join('') + '</section>' : renderEmpty());
    }
    function render(model) {
      app.innerHTML = model ? renderContent(model) : renderEmpty();
    }
    document.addEventListener('click', (event) => {
      const target = event.target && event.target.closest ? event.target.closest('[data-command]') : undefined;
      if (!target) return;
      vscode.postMessage({ command: target.getAttribute('data-command') });
    });
    window.addEventListener('message', (event) => {
      const message = event.data || {};
      if (message.command === 'render') {
        render(message.model);
      }
    });
    if (initialModel) {
      render(initialModel);
    }
  </script>
</body>
</html>`;
  }

  private renderEmpty(): string {
    return `<section class="empty">
  <div class="empty-title">未捕获关键变量</div>
  <p>启动调试并停在断点后，运行“AI 调试：分析并显示关键变量”。</p>
  <button data-command="refresh" disabled>刷新</button>
</section>`;
  }

  private renderContent(model: AiDebugViewModel): string {
    const time = new Date(model.updatedAt).toLocaleTimeString();
    const warnings = model.warnings.length
      ? `<div class="warnings">${model.warnings.map((warning) => `<div>${escapeHtml(warning)}</div>`).join("")}</div>`
      : "";
    return `<header class="topbar">
  <div>
    <h1>${escapeHtml(model.title)}</h1>
    <div class="meta">${escapeHtml(model.status)} · ${escapeHtml(time)}${model.analysis ? ` · ${escapeHtml(model.analysis.source)}` : ""}</div>
  </div>
	  <button data-command="refresh"${model.canRefresh === false ? " disabled" : ""}>刷新</button>
</header>
${warnings}
${model.variables.length ? `<section class="grid">${model.variables.map((variable) => this.renderVariable(variable)).join("")}</section>` : this.renderEmpty()}`;
  }

  private renderVariable(variable: CollectedVariable): string {
    const type = variable.runtimeType || variable.declaredType || "";
    const hint = variable.presentationHint || {};
    const hintText = [hint.kind].concat(Array.isArray(hint.attributes) ? hint.attributes : []).filter(Boolean).join(" · ");
    const mark = hintMark(hint);
    const classes = hintClass(hint);
    return `<article class="variable ${variable.error ? "error" : ""}">
  <div class="variable-head">
    <div>
      <div class="name-row"><h2>${escapeHtml(variable.name)}</h2>${hintText ? `<span class="hint ${escapeHtml(classes)}">${mark ? `<b>${escapeHtml(mark)}</b>` : ""}${escapeHtml(hintText)}</span>` : ""}</div>
      <div class="expr">${escapeHtml(variable.expression)}${type ? ` · ${escapeHtml(type)}` : ""}</div>
    </div>
    <code>${escapeHtml(variable.value || variable.error || "")}</code>
  </div>
  ${this.renderVisual(variable)}
</article>`;
  }

  private renderVisual(variable: CollectedVariable): string {
    const visual = variable.visual;
    if (!visual) {
      return "";
    }
    if (visual.kind.array && visual.values) {
      return `<div class="array">${visual.values.map((item) => `<div class="cell"><span>${escapeHtml(item.name)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join("")}</div>`;
    }
    if (visual.kind.list && visual.nodes) {
      return `<div class="list">${visual.nodes.map((node, index) => `<div class="list-node"><span>${escapeHtml(node.value || node.label)}</span></div>${index < visual.nodes!.length - 1 ? `<div class="arrow">→</div>` : ""}`).join("")}</div>`;
    }
    if (visual.kind.graph && visual.nodes) {
      return `<div class="graph">
  <div class="nodes">${visual.nodes.map((node) => `<div class="graph-node"><span>${escapeHtml(node.label)}</span><strong>${escapeHtml(node.value || "")}</strong></div>`).join("")}</div>
  ${visual.edges && visual.edges.length ? `<div class="edges">${visual.edges.map((edge) => `<span>${escapeHtml(edge.from)} → ${escapeHtml(edge.to)}${edge.label ? ` · ${escapeHtml(edge.label)}` : ""}</span>`).join("")}</div>` : ""}
</div>`;
    }
    if (visual.kind.object && visual.values) {
      return `<div class="object">${visual.values.map((item) => `<div><span>${escapeHtml(item.name)}</span><strong>${escapeHtml(item.value)}</strong></div>`).join("")}</div>`;
    }
    return `<pre>${escapeHtml(visual.text || variable.value || "")}</pre>`;
  }

  private style(): string {
    return `
:root {
  --bg: var(--vscode-editor-background, #fff);
  --fg: var(--vscode-editor-foreground, #222);
  --muted: var(--vscode-descriptionForeground, #666);
  --border: var(--vscode-panel-border, rgba(128,128,128,.28));
  --input: var(--vscode-input-background, rgba(128,128,128,.08));
  --hover: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,.12));
  --accent: var(--vscode-button-background, #0e639c);
  --accent-fg: var(--vscode-button-foreground, #fff);
  --error: var(--vscode-errorForeground, #d73a49);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: var(--vscode-font-size, 13px);
}
.ai-debug { padding: 14px; }
.ai-debug.theme-dense { padding: 9px; }
.ai-debug.theme-contrast {
  --input: var(--vscode-editor-background, #fff);
  --border: var(--vscode-focusBorder, rgba(80,160,255,.8));
}
.theme-dense .topbar { padding-bottom: 8px; }
.theme-dense .grid { gap: 7px; margin-top: 8px; }
.theme-dense .variable { padding: 7px; }
.theme-dense h1 { font-size: 16px; }
.theme-dense h2 { font-size: 13px; }
.topbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
h1, h2 { margin: 0; letter-spacing: 0; }
h1 { font-size: 18px; line-height: 1.25; }
h2 { font-size: 14px; line-height: 1.25; }
.name-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
	.hint {
	  display: inline-flex;
	  align-items: center;
	  gap: 4px;
	  min-height: 17px;
	  padding: 0 5px;
	  border: 1px solid var(--border);
  border-radius: 3px;
  color: var(--muted);
  background: var(--bg);
	  font-size: 10px;
	  font-weight: 600;
	}
	.hint b {
	  display: inline-flex;
	  align-items: center;
	  justify-content: center;
	  min-width: 14px;
	  height: 14px;
	  border-radius: 2px;
	  background: var(--accent);
	  color: var(--accent-fg);
	  font-size: 9px;
	  line-height: 1;
	}
	.hint-readonly b { background: var(--vscode-charts-blue, #3794ff); }
	.hint-static b { background: var(--vscode-charts-purple, #b180d7); }
	.hint-property b { background: var(--vscode-charts-green, #89d185); color: var(--vscode-editor-background, #111); }
.meta, .expr { color: var(--muted); font-size: 12px; margin-top: 4px; }
button {
  min-height: 28px;
  padding: 3px 10px;
  border: 1px solid var(--accent);
  border-radius: 4px;
  background: var(--accent);
  color: var(--accent-fg);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
button:hover { opacity: .9; }
.warnings {
  display: grid;
  gap: 5px;
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 12px;
}
.warnings div, .empty {
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--input);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 10px;
  margin-top: 12px;
}
.variable {
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--input);
}
.variable.error { border-color: var(--error); }
.variable-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}
code, pre {
  margin: 0;
  color: var(--muted);
  font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  font-size: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.array, .object {
  display: grid;
  gap: 5px;
  margin-top: 10px;
}
.array {
  grid-template-columns: repeat(auto-fill, minmax(52px, 1fr));
}
.cell, .object div {
  min-width: 0;
  padding: 6px 7px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
}
.cell span, .object span {
  display: block;
  color: var(--muted);
  font-size: 11px;
}
.cell strong, .object strong {
  display: block;
  margin-top: 2px;
  font-weight: 650;
  overflow-wrap: anywhere;
}
.list {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.list-node, .graph-node {
  min-width: 36px;
  min-height: 30px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg);
  text-align: center;
}
.arrow { color: var(--muted); }
.graph { display: grid; gap: 8px; margin-top: 10px; }
.nodes { display: flex; flex-wrap: wrap; gap: 6px; }
.graph-node span { display: block; color: var(--muted); font-size: 10px; }
.edges { display: flex; flex-wrap: wrap; gap: 5px; color: var(--muted); font-size: 11px; }
.edges span {
  padding: 2px 5px;
  border: 1px solid var(--border);
  border-radius: 3px;
}
.empty { margin-top: 18px; color: var(--muted); }
.empty-title { color: var(--fg); font-weight: 700; margin-bottom: 4px; }
`;
  }
}
