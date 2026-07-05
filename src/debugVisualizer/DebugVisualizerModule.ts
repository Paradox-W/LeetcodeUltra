import * as vscode from "vscode";
import { buildArrayGridVisualization, buildPreviewGridVisualization, IndexedDebugChild } from "./buildGridVisualization";
import { parseVisualizationData } from "./parseVisualizationData";
import { GridMarker, GridVisualizationData, VisualizationData } from "./VisualizationData";

interface DapVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference?: number;
  evaluateName?: string;
}

interface DebugVisualizerViewModel {
  title: string;
  status: string;
  variables: Array<{
    name: string;
    expression: string;
    runtimeType?: string;
    value: string;
    variablesReference: number;
    visual: VisualizationData;
  }>;
  warnings: string[];
  updatedAt: number;
  canRefresh: boolean;
}

async function withTimeout<T>(promise: Thenable<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function escapeHtml(value: any): string {
  return String(value === undefined || value === null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char] || char));
}

function scriptJson(value: any): string {
  return JSON.stringify(value === undefined ? null : value).replace(/</g, "\\u003c");
}

async function resolveFrameId(session: vscode.DebugSession): Promise<number | undefined> {
  const threads = await withTimeout(session.customRequest("threads", {}), 1500);
  const threadIds = (threads && Array.isArray(threads.threads) ? threads.threads : [])
    .map((thread: any) => Number(thread.id))
    .filter((id: number) => Number.isFinite(id));
  const candidates = Array.from(new Set((threadIds.length ? threadIds : []).concat([1])));
  for (const threadId of candidates) {
    try {
      const stack = await withTimeout(session.customRequest("stackTrace", { threadId, startFrame: 0, levels: 20 }), 1500);
      const frames = stack && Array.isArray(stack.stackFrames) ? stack.stackFrames : [];
      const frame = frames.find((item: any) => Number.isFinite(Number(item && item.id)));
      if (frame) {
        return Number(frame.id);
      }
    } catch (_) {
      // Debug adapters differ while they transition into the stopped state.
    }
  }
  return undefined;
}

async function resolvePausedFrame(session: vscode.DebugSession): Promise<{ threadId: number; frameId: number; name?: string } | undefined> {
  const threads = await withTimeout(session.customRequest("threads", {}), 1500);
  const threadIds = (threads && Array.isArray(threads.threads) ? threads.threads : [])
    .map((thread: any) => Number(thread.id))
    .filter((id: number) => Number.isFinite(id));
  for (const threadId of threadIds.length ? threadIds : [1]) {
    try {
      const stack = await withTimeout(session.customRequest("stackTrace", { threadId, startFrame: 0, levels: 20 }), 1500);
      const frames = stack && Array.isArray(stack.stackFrames) ? stack.stackFrames : [];
      const frame = frames.find((item: any) => Number.isFinite(Number(item && item.id)));
      if (frame) {
        return { threadId, frameId: Number(frame.id), name: frame.name };
      }
    } catch (_) {
      // The adapter may not be paused yet.
    }
  }
  return undefined;
}

async function dapVariables(session: vscode.DebugSession, variablesReference: number, count = 120): Promise<DapVariable[]> {
  if (!variablesReference) {
    return [];
  }
  const response = await withTimeout(session.customRequest("variables", {
    variablesReference,
    start: 0,
    count,
  }), 1500);
  return response && Array.isArray(response.variables) ? response.variables : [];
}

async function localVariables(session: vscode.DebugSession, frameId: number): Promise<DapVariable[]> {
  const scopes = await withTimeout(session.customRequest("scopes", { frameId }), 1500);
  const result: DapVariable[] = [];
  for (const scope of scopes && Array.isArray(scopes.scopes) ? scopes.scopes : []) {
    const name = String(scope && scope.name || "");
    if (/register|global|static/i.test(name)) {
      continue;
    }
    result.push(...await dapVariables(session, Number(scope.variablesReference || 0), 180));
  }
  return result;
}

function normalizeIndexName(name: string): string {
  return String(name || "").replace(/^\[(.*)\]$/, "$1");
}

function isIndexName(name: string): boolean {
  return /^\[?\d+\]?$/.test(String(name || ""));
}

function splitPreviewItems(value: any): string[] {
  const text = String(value === undefined || value === null ? "" : value).trim();
  const match = text.match(/^\{([\s\S]*)\}$/);
  const body = match ? match[1] : text;
  const items: string[] = [];
  let current = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const char of body) {
    if (inString) {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      current += char;
      continue;
    }
    if (char === "{" || char === "[" || char === "(") {
      depth += 1;
    } else if (char === "}" || char === "]" || char === ")") {
      depth = Math.max(0, depth - 1);
    }
    if (char === "," && depth === 0) {
      items.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    items.push(current.trim());
  }
  return items.filter(Boolean);
}

function looksLikeArrayVariable(variable: DapVariable, children: DapVariable[]): boolean {
  const text = `${variable.name || ""} ${variable.type || ""} ${variable.value || ""}`.toLowerCase();
  if (isIteratorLikeVariable(variable)) {
    return false;
  }
  if (children.length && children.every((child) => isIndexName(child.name))) {
    return true;
  }
  return /\b(vector|array|deque)\b|std::(?:vector|array|deque)|\[[0-9]*\]|size\s*=/.test(text);
}

function isIteratorLikeVariable(variable: DapVariable): boolean {
  const text = `${variable.name || ""} ${variable.type || ""} ${variable.value || ""}`.toLowerCase();
  return /\b(iterator\b|__wrap_iter|__normal_iterator|\bconst_iterator\b|\breverse_iterator\b|\bitem\s*:)/.test(text);
}

function isIntegerLikeVariable(variable: DapVariable): boolean {
  const text = `${variable.type || ""} ${variable.value || ""}`.trim();
  return /\b(short|int|long|size_t|ptrdiff_t|std::size_t|std::ptrdiff_t)\b/i.test(text) || /^-?\d+$/.test(String(variable.value || "").trim());
}

function markerColor(name: string, index: number): string {
  const key = String(name || "").toLowerCase();
  if (/^(left|start|begin|slow|lo|l)$/.test(key)) {
    return "#0b66d8";
  }
  if (/^(mid|middle)$/.test(key)) {
    return "#d9a300";
  }
  if (/^(right|end|fast|hi|r)$/.test(key)) {
    return "#c40000";
  }
  return ["#0b66d8", "#d9a300", "#c40000", "#8250df", "#2da44e"][index % 5];
}

function parseIntegerResult(value: any): number | undefined {
  const text = String(value === undefined || value === null ? "" : value).trim();
  const simple = text.match(/^-?\d+$/);
  if (simple) {
    return Number(simple[0]);
  }
  const debuggerScalar = text.match(/(?:^|\s|=)(-?\d+)\s*$/);
  if (debuggerScalar && !/[{}:,]/.test(text)) {
    return Number(debuggerScalar[1]);
  }
  return undefined;
}

function isMarkerCandidate(variable: DapVariable, arrayName: string): boolean {
  const name = String(variable.name || "");
  if (!name || name === arrayName || name === "this") {
    return false;
  }
  return /^(left|right|start|end|begin|first|last|slow|fast|cur|curr|current|prev|next|it|iter|i|j|k|lo|hi|mid|l|r)$/i.test(name);
}

async function evaluateIndex(session: vscode.DebugSession, frameId: number, arrayExpression: string, marker: DapVariable): Promise<number | undefined> {
  const markerName = marker.evaluateName || marker.name;
  const expressions = [
    `(int)(${markerName} - ${arrayExpression}.begin())`,
    `(int)std::distance(${arrayExpression}.begin(), ${markerName})`,
    `(int)(${markerName} - ${arrayExpression}.data())`,
    `(int)(${markerName} - &${arrayExpression}[0])`,
    `(int)(${markerName} - ${arrayExpression})`,
  ];
  if (isIntegerLikeVariable(marker)) {
    expressions.push(`(int)(${markerName})`);
  }
  for (const expression of expressions) {
    try {
      const response = await withTimeout(session.customRequest("evaluate", {
        expression,
        frameId,
        context: "watch",
      }), 900);
      const value = parseIntegerResult(response && response.result);
      if (value !== undefined) {
        return value;
      }
    } catch (_) {
      // Try the next expression form; C++ iterator support differs by adapter.
    }
  }
  return undefined;
}

async function attachMarkers(
  session: vscode.DebugSession,
  frameId: number,
  visual: GridVisualizationData,
  arrayVariable: DapVariable,
  allVariables: DapVariable[]
): Promise<string[]> {
  const warnings: string[] = [];
  const columns = visual.rows[0] && Array.isArray(visual.rows[0].columns) ? visual.rows[0].columns.length : 0;
  const markers: GridMarker[] = [];
  const arrayExpression = arrayVariable.evaluateName || arrayVariable.name;
  const candidates = allVariables.filter((variable) => isMarkerCandidate(variable, arrayVariable.name)).slice(0, 8);
  for (const candidate of candidates) {
    const index = await evaluateIndex(session, frameId, arrayExpression, candidate);
    if (index === undefined) {
      continue;
    }
    if (index < 0 || index >= columns) {
      continue;
    }
    markers.push({
      id: candidate.name,
      row: 0,
      column: index,
      label: candidate.name,
      color: markerColor(candidate.name, markers.length),
    });
  }
  if (markers.length) {
    visual.markers = markers;
  }
  return warnings;
}

async function collectDebugVisualizerModel(session: vscode.DebugSession): Promise<DebugVisualizerViewModel> {
  const frame = await resolvePausedFrame(session);
  if (!frame) {
    return {
      title: "Debug Visualizer",
      status: "等待调试暂停",
      variables: [],
      warnings: ["当前调试会话还没有可用栈帧。请先停在断点或单步暂停。"],
      updatedAt: Date.now(),
      canRefresh: true,
    };
  }
  const variables = await localVariables(session, frame.frameId);
  const output: DebugVisualizerViewModel["variables"] = [];
  const warnings: string[] = [];
  for (const variable of variables) {
    if (output.length >= 4) {
      break;
    }
    const children = await dapVariables(session, Number(variable.variablesReference || 0), 160);
    if (!looksLikeArrayVariable(variable, children)) {
      continue;
    }
    const indexedChildren: IndexedDebugChild[] = children
      .filter((child) => isIndexName(child.name))
      .map((child) => ({
        name: normalizeIndexName(child.name),
        value: child.value,
        type: child.type,
      }));
    let visual = buildArrayGridVisualization(indexedChildren, 120);
    if (!visual) {
      visual = buildPreviewGridVisualization(splitPreviewItems(variable.value), 120);
    }
    if (!visual) {
      continue;
    }
    warnings.push(...await attachMarkers(session, frame.frameId, visual, variable, variables));
    output.push({
      name: variable.name,
      expression: variable.evaluateName || variable.name,
      runtimeType: variable.type,
      value: variable.value,
      variablesReference: Number(variable.variablesReference || 0),
      visual,
    });
  }
  return {
    title: "Debug Visualizer",
    status: output.length ? `已从 ${frame.name || "当前栈帧"} 可视化 ${output.length} 个数组/容器` : "当前栈帧未发现一维数组或 vector",
    variables: output,
    warnings,
    updatedAt: Date.now(),
    canRefresh: true,
  };
}

function isSupportedDebugSession(session: vscode.DebugSession | undefined): boolean {
  if (!session) {
    return false;
  }
  return /^(lldb|cppdbg|cppvsdbg|pwa-node|node)$/i.test(String(session.type || ""));
}

class DebugVisualizerPanel {
  private panel?: vscode.WebviewPanel;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public show(expression: string, data: VisualizationData, raw: string): void {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "lcprDebugVisualizer",
        "Debug Visualizer",
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      }, undefined, this.context.subscriptions);
    }
    this.panel.webview.html = this.renderHtml(expression, data, raw);
    this.panel.reveal(undefined, true);
  }

  private renderHtml(expression: string, data: VisualizationData, raw: string): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
  <style>${this.style()}</style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(expression)}</h1>
      <code>${escapeHtml(raw)}</code>
    </header>
    <section id="visual"></section>
  </main>
  <script>
    const data = ${scriptJson(data)};
    const root = document.getElementById('visual');
    function escapeHtml(value) {
      return String(value === undefined || value === null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function markerStyle(marker) {
      const color = String(marker && marker.color || '').replace(/[^#a-zA-Z0-9(),.%\\s-]/g, '');
      return color ? ' style="border-color:' + escapeHtml(color) + ';color:' + escapeHtml(color) + '"' : '';
    }
    function renderGrid(visual) {
      const rows = Array.isArray(visual.rows) ? visual.rows : [];
      const markers = Array.isArray(visual.markers) ? visual.markers : [];
      return '<div class="dv-grid">' + rows.map((row, rowIndex) => {
        const cells = Array.isArray(row.columns) ? row.columns : [];
        return '<div class="dv-row">' + (row.label ? '<div class="dv-row-label">' + escapeHtml(row.label) + '</div>' : '') +
          '<div class="dv-cells">' + cells.map((cell, columnIndex) => {
            const cellMarkers = markers.filter((marker) => Number(marker.row) === rowIndex && Number(marker.column) === columnIndex);
            const markerHtml = cellMarkers.length
              ? '<div class="dv-markers">' + cellMarkers.map((marker) => '<span class="dv-marker"' + markerStyle(marker) + '>' + escapeHtml(marker.label || marker.id || '') + '</span>').join('') + '</div>'
              : '';
            return '<div class="dv-cell">' + markerHtml + '<strong>' + escapeHtml(cell && cell.content || '') + '</strong><span>' + escapeHtml(cell && cell.tag || String(columnIndex)) + '</span></div>';
          }).join('') + '</div></div>';
      }).join('') + '</div>';
    }
    if (data && data.kind && data.kind.grid) {
      root.innerHTML = renderGrid(data);
    } else {
      root.innerHTML = '<pre>' + escapeHtml(data && data.text || '') + '</pre>';
    }
  </script>
</body>
</html>`;
  }

  private style(): string {
    return `
:root {
  --bg: var(--vscode-editor-background, #fff);
  --fg: var(--vscode-editor-foreground, #222);
  --muted: var(--vscode-descriptionForeground, #666);
  --border: var(--vscode-panel-border, rgba(128,128,128,.3));
  --accent: var(--vscode-button-background, #0e639c);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  color: var(--fg);
  background: var(--bg);
  font: 13px var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
}
main { padding: 14px; }
header {
  display: grid;
  gap: 6px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
}
h1 {
  margin: 0;
  font-size: 16px;
  line-height: 1.3;
  letter-spacing: 0;
}
code, pre {
  margin: 0;
  color: var(--muted);
  font: 12px var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
#visual { margin-top: 18px; }
.dv-grid {
  display: grid;
  gap: 8px;
  overflow-x: auto;
  padding-top: 18px;
}
.dv-row {
  display: flex;
  align-items: stretch;
  gap: 6px;
}
.dv-row-label {
  flex: 0 0 auto;
  min-width: 32px;
  padding-top: 24px;
  color: var(--muted);
  font-size: 11px;
}
.dv-cells {
  display: flex;
  gap: 5px;
}
.dv-cell {
  position: relative;
  flex: 0 0 auto;
  min-width: 46px;
  border: 1px solid var(--border);
  border-radius: 4px;
  text-align: center;
}
.dv-cell strong {
  display: block;
  min-height: 32px;
  padding: 8px 8px 4px;
  color: var(--fg);
  font: 13px var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace);
}
.dv-cell span {
  display: block;
  padding: 2px 6px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 10px;
  line-height: 14px;
}
.dv-markers {
  position: absolute;
  left: 50%;
  top: -17px;
  display: flex;
  gap: 2px;
  transform: translateX(-50%);
  white-space: nowrap;
}
.dv-marker {
  max-width: 64px;
  padding: 0 4px;
  border: 1px solid var(--accent);
  border-radius: 3px;
  background: var(--bg);
  color: var(--accent);
  font-size: 10px;
  line-height: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
}`;
  }
}

export function registerDebugVisualizer(context: vscode.ExtensionContext): vscode.Disposable {
  const panel = new DebugVisualizerPanel(context);
  let refreshTimer: NodeJS.Timeout | undefined;
  const scheduleWorkbenchRefresh = (session?: vscode.DebugSession) => {
    if (!isSupportedDebugSession(session || vscode.debug.activeDebugSession)) {
      return;
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      vscode.commands.executeCommand("lcpr.workbench.refreshDebugVisual").then(undefined, () => undefined);
    }, 250);
  };
  const showCommand = vscode.commands.registerCommand("lcpr.debugVisualizer.show", async (input?: string | { expression?: string; frameId?: number }) => {
    const session = vscode.debug.activeDebugSession;
    if (!session) {
      vscode.window.showWarningMessage("Debug Visualizer 需要一个已暂停的调试会话。");
      return { error: "no-active-debug-session" };
    }
    const providedExpression = typeof input === "string" ? input : input && input.expression;
    const providedFrameId = typeof input === "object" && input ? Number(input.frameId) : undefined;
    const finalExpression = providedExpression || await vscode.window.showInputBox({
      title: "Debug Visualizer",
      prompt: "输入会返回 Debug Visualizer JSON 的表达式，例如 visNums 或 dbgvis::array(nums)",
      value: "visNums",
      ignoreFocusOut: true,
    });
    if (!finalExpression) {
      return { error: "empty-expression" };
    }
    const frameId = Number.isFinite(providedFrameId) ? providedFrameId : await resolveFrameId(session);
    const evaluateArgs: any = {
      expression: finalExpression,
      context: "watch",
    };
    if (frameId) {
      evaluateArgs.frameId = frameId;
    }
    const evaluated = await withTimeout(session.customRequest("evaluate", {
      ...evaluateArgs,
    }), 1500);
    const raw = String(evaluated && evaluated.result !== undefined ? evaluated.result : "");
    const data = parseVisualizationData(raw);
    if (!data) {
      vscode.window.showWarningMessage("表达式结果不是 Debug Visualizer JSON。");
      return { error: "not-debug-visualizer-json", raw };
    }
    panel.show(finalExpression, data, raw);
    return { expression: finalExpression, raw, visual: data };
  });
  const collectCommand = vscode.commands.registerCommand("lcpr.debugVisualizer.collect", async () => {
    const session = vscode.debug.activeDebugSession;
    if (!session) {
      return {
        title: "Debug Visualizer",
        status: "未启动调试会话",
        variables: [],
        warnings: ["未找到活动调试会话。"],
        updatedAt: Date.now(),
        canRefresh: true,
      };
    }
    return collectDebugVisualizerModel(session);
  });
  const tracker = vscode.debug.registerDebugAdapterTrackerFactory("*", {
    createDebugAdapterTracker(session: vscode.DebugSession) {
      return {
        onDidSendMessage(message: any) {
          if (message && message.type === "event" && message.event === "stopped") {
            scheduleWorkbenchRefresh(session);
          }
        },
      };
    },
  });
  const activeListener = vscode.debug.onDidChangeActiveDebugSession((session) => {
    scheduleWorkbenchRefresh(session);
  });
  const terminatedListener = vscode.debug.onDidTerminateDebugSession(() => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
    }
  });
  return vscode.Disposable.from(showCommand, collectCommand, tracker, activeListener, terminatedListener);
}
