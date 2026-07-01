import * as vscode from "vscode";
import { AiClient } from "../ai/AiClient";
import { AiVariableAnalyzer } from "./AiVariableAnalyzer";
import { AiDebugPanel, AiDebugViewModel } from "./AiDebugPanel";
import { DapVariableCollector } from "./DapVariableCollector";

function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("leetcode-problem-rating");
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

class AiDebugService {
  private readonly aiClient: AiClient;
  private readonly analyzer: AiVariableAnalyzer;
  private readonly collector: DapVariableCollector;
  private readonly panel: AiDebugPanel;
  private lastDocument?: vscode.TextDocument;
  private lastAutoFrameKey = "";
  private autoRefreshing = false;
  private readonly debugSessions = new Map<string, vscode.DebugSession>();

  constructor(context: vscode.ExtensionContext) {
    this.aiClient = new AiClient(context);
    this.analyzer = new AiVariableAnalyzer(context, this.aiClient);
    this.collector = new DapVariableCollector();
    this.panel = new AiDebugPanel(context, async () => {
      await this.analyzeAndShow(false);
    });
  }

  public register(): vscode.Disposable {
    return vscode.Disposable.from(
      vscode.commands.registerCommand("lcpr.aiDebug.analyzeAndShow", () => this.analyzeAndShow(true)),
      vscode.commands.registerCommand("leetcodeEnhanced.analyzeAndShow", () => this.analyzeAndShow(true)),
      vscode.commands.registerCommand("leetcodeEnhanced.showKeyVariables", () => this.analyzeAndShow(true)),
      vscode.commands.registerCommand("lcpr.aiDebug.refresh", () => this.analyzeAndShow(true)),
      vscode.commands.registerCommand("lcpr.aiDebug.collect", () => this.collectModel()),
      vscode.commands.registerCommand("lcpr.aiDebug.setApiKey", () => this.setApiKey()),
      vscode.commands.registerCommand("lcpr.aiDebug.toggleAiAnalysis", () => this.toggleAiAnalysis()),
      vscode.commands.registerCommand("lcpr.aiDebug.setManualVariables", () => this.setManualVariables()),
      vscode.commands.registerCommand("lcpr.aiDebug.setMaxVariables", () => this.setMaxVariables()),
      vscode.commands.registerCommand("lcpr.aiDebug.setVisualTheme", () => this.setVisualTheme()),
      vscode.workspace.onDidChangeTextDocument((event) => this.analyzer.invalidate(event.document)),
      vscode.debug.onDidStartDebugSession((session) => {
        this.debugSessions.set(session.id, session);
        const document = this.resolveDocument();
        if (document) {
          this.analyzer.invalidate(document);
        }
        this.lastAutoFrameKey = "";
      }),
      vscode.debug.onDidReceiveDebugSessionCustomEvent((event) => {
        if (event.event === "stopped" && this.panel.visible && getConfig().get<boolean>("aiDebug.autoRefreshOnStop", true)) {
          return this.refreshIfPaused();
        }
        return undefined;
      }),
      vscode.debug.onDidChangeActiveDebugSession(() => this.refreshIfPaused()),
      this.createAutoRefreshTimer(),
      vscode.debug.onDidTerminateDebugSession((session) => {
        this.debugSessions.delete(session.id);
        this.panel.showDebugEnded();
      })
    );
  }

  public async analyzeAndShow(reveal: boolean): Promise<AiDebugViewModel> {
    const model = await this.collectModel();
    if (reveal) {
      this.panel.show(model);
    } else {
      this.panel.update(model);
    }
    return model;
  }

  public async collectModel(): Promise<AiDebugViewModel> {
    const document = this.resolveDocument();
    if (!document) {
      return {
        title: "AI 调试",
        status: "未打开力扣代码文件",
        variables: [],
        warnings: ["请先打开一个 LeetCode 代码文件。"],
        updatedAt: Date.now(),
        canRefresh: false,
      };
    }

    this.lastDocument = document;
    const analysis = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: "AI 调试：分析关键变量",
    }, () => this.analyzer.analyze(document));
    const debugState = await this.resolveDebugSessionState();
    const debugSession = debugState.session;
    if (!debugState.paused) {
      return {
        title: this.titleForDocument(document, analysis.problemId),
        status: "等待调试暂停",
        analysis,
        variables: [],
        warnings: analysis.warnings.concat([
          debugSession ? "调试会话正在运行。请在断点或单步暂停后刷新 AI 调试。" : "未找到活动调试会话。请先启动调试并停在断点处。",
        ]),
        updatedAt: Date.now(),
        canRefresh: false,
      };
    }
    const collected = await this.collector.collect(analysis.variables, { language: analysis.language, session: debugSession });
    const model: AiDebugViewModel = {
      title: this.titleForDocument(document, analysis.problemId),
      status: debugState.paused ? "已捕获调试变量" : "等待调试暂停",
      analysis,
      variables: collected.variables,
      warnings: analysis.warnings.concat(collected.warnings),
      updatedAt: Date.now(),
      canRefresh: debugState.paused,
    };
    return model;
  }

  private async setApiKey(): Promise<void> {
    const value = await vscode.window.showInputBox({
      title: "设置 AI 调试 API Key",
      prompt: "输入 OpenAI 兼容服务的 API Key。留空不会覆盖现有设置。",
      password: true,
      ignoreFocusOut: true,
    });
    if (!value) {
      return;
    }
    await this.aiClient.storeApiKey(value);
    vscode.window.showInformationMessage("AI 调试 API Key 已保存。");
  }

  private async toggleAiAnalysis(): Promise<void> {
    const config = getConfig();
    const current = config.get<boolean>("aiDebug.enableAiAnalysis", true);
    await config.update("aiDebug.enableAiAnalysis", !current, vscode.ConfigurationTarget.Global);
    this.invalidateLastDocument();
    vscode.window.showInformationMessage(!current ? "AI 调试自动分析已启用。" : "AI 调试自动分析已关闭。");
  }

  private async setManualVariables(): Promise<void> {
    const current = this.formatManualVariables(getConfig().get<any[]>("aiDebug.manualVariables", []) || []);
    const value = await vscode.window.showInputBox({
      title: "AI 调试：手动变量",
      prompt: "输入要监视的变量或表达式，用逗号分隔。例如 nums, head, root.left",
      value: current,
      ignoreFocusOut: true,
    });
    if (value === undefined) {
      return;
    }
    const variables = value.split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    await getConfig().update("aiDebug.manualVariables", variables, vscode.ConfigurationTarget.Workspace);
    this.invalidateLastDocument();
    vscode.window.showInformationMessage(variables.length ? `AI 调试手动变量已更新：${variables.join(", ")}` : "AI 调试手动变量已清空。");
  }

  private async setMaxVariables(): Promise<void> {
    const current = String(getConfig().get<number>("aiDebug.maxVariables", 6));
    const value = await vscode.window.showInputBox({
      title: "AI 调试：变量数量",
      prompt: "输入一次最多展示的关键变量数量（1-12）。",
      value: current,
      ignoreFocusOut: true,
      validateInput: (text) => {
        const parsed = Number(text);
        return Number.isInteger(parsed) && parsed >= 1 && parsed <= 12 ? undefined : "请输入 1 到 12 之间的整数。";
      },
    });
    if (value === undefined) {
      return;
    }
    const maxVariables = Math.max(1, Math.min(12, Math.trunc(Number(value))));
    await getConfig().update("aiDebug.maxVariables", maxVariables, vscode.ConfigurationTarget.Global);
    this.invalidateLastDocument();
    vscode.window.showInformationMessage(`AI 调试变量数量已设为 ${maxVariables}。`);
  }

  private async setVisualTheme(): Promise<void> {
    const picked = await vscode.window.showQuickPick([
      { label: "原生", description: "跟随 VS Code 面板密度", value: "native" },
      { label: "紧凑", description: "更适合窄面板和底部调试", value: "dense" },
      { label: "高对比", description: "更明显的边框和层级", value: "contrast" },
    ], {
      title: "AI 调试：可视化主题",
      placeHolder: "选择 Webview 展示样式",
      ignoreFocusOut: true,
    });
    if (!picked) {
      return;
    }
    await getConfig().update("aiDebug.visualTheme", picked.value, vscode.ConfigurationTarget.Global);
    if (this.panel.visible) {
      await this.analyzeAndShow(false);
    }
    vscode.window.showInformationMessage(`AI 调试主题已切换为${picked.label}。`);
  }

  private formatManualVariables(items: any[]): string {
    return items.map((item) => {
      if (typeof item === "string") {
        return item;
      }
      return String(item.expression || item.name || "").trim();
    }).filter(Boolean).join(", ");
  }

  private invalidateLastDocument(): void {
    if (this.lastDocument) {
      this.analyzer.invalidate(this.lastDocument);
    }
  }

  private createAutoRefreshTimer(): vscode.Disposable {
    const timer = setInterval(() => {
      this.refreshIfPaused();
    }, 800);
    return new vscode.Disposable(() => clearInterval(timer));
  }

  private async refreshIfPaused(): Promise<void> {
    if (!this.panel.visible || this.autoRefreshing || !getConfig().get<boolean>("aiDebug.autoRefreshOnStop", true)) {
      return;
    }
    const frameKey = await this.resolveActiveFrameKey();
    if (!frameKey) {
      this.lastAutoFrameKey = "";
      return;
    }
    if (frameKey === this.lastAutoFrameKey) {
      return;
    }
    this.lastAutoFrameKey = frameKey;
    this.autoRefreshing = true;
    try {
      await this.analyzeAndShow(false);
    } finally {
      this.autoRefreshing = false;
    }
  }

  private async resolveActiveFrameKey(): Promise<string> {
    const session = await this.resolvePausedSession();
    if (!session) {
      return "";
    }
    try {
      const threads = await withTimeout(session.customRequest("threads", {}), 800);
      const threadIds = (threads && threads.threads || [])
        .map((thread: any) => Number(thread.id))
        .filter((id: number) => Number.isFinite(id));
      for (const threadId of threadIds.length ? threadIds : [1]) {
        const stack = await withTimeout(session.customRequest("stackTrace", { threadId, startFrame: 0, levels: 1 }), 800);
        const frame = stack && stack.stackFrames && stack.stackFrames[0];
        if (frame && Number.isFinite(Number(frame.id))) {
          return `${session.id}:${threadId}:${frame.id}`;
        }
      }
    } catch (_) {
      // The adapter is running but not paused, or does not support this request yet.
    }
    return "";
  }

  private async resolvePausedSession(): Promise<vscode.DebugSession | undefined> {
    const state = await this.resolveDebugSessionState();
    return state.paused ? state.session : state.session;
  }

  private async resolveDebugSessionState(): Promise<{ session?: vscode.DebugSession; paused: boolean }> {
    const active = vscode.debug.activeDebugSession;
    const candidates = [
      active,
      ...Array.from(this.debugSessions.values()).filter((session) => !active || session.id !== active.id),
    ].filter(Boolean) as vscode.DebugSession[];
    for (const session of candidates) {
      if (await this.sessionHasPausedFrame(session)) {
        return { session, paused: true };
      }
    }
    return { session: active, paused: false };
  }

  private async sessionHasPausedFrame(session: vscode.DebugSession): Promise<boolean> {
    try {
      const threads = await withTimeout(session.customRequest("threads", {}), 800);
      const threadIds = (threads && threads.threads || [])
        .map((thread: any) => Number(thread.id))
        .filter((id: number) => Number.isFinite(id));
      for (const threadId of threadIds.length ? threadIds : [1]) {
        const stack = await withTimeout(session.customRequest("stackTrace", { threadId, startFrame: 0, levels: 1 }), 800);
        const frame = stack && stack.stackFrames && stack.stackFrames[0];
        if (frame && Number.isFinite(Number(frame.id))) {
          return true;
        }
      }
    } catch (_) {
      return false;
    }
    return false;
  }

  private resolveDocument(): vscode.TextDocument | undefined {
    const active = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
    if (active && this.isLeetCodeDocument(active)) {
      return active;
    }
    if (this.lastDocument && this.isLeetCodeDocument(this.lastDocument)) {
      return this.lastDocument;
    }
    const visible = vscode.window.visibleTextEditors.find((editor) => this.isLeetCodeDocument(editor.document));
    return visible && visible.document;
  }

  private isLeetCodeDocument(document: vscode.TextDocument): boolean {
    return document.uri.scheme === "file" && /@lc app=.* id=.* lang=.*/.test(document.getText());
  }

  private titleForDocument(document: vscode.TextDocument, problemId?: string): string {
    const fileName = document.fileName.split(/[\\/]/).pop() || "当前题目";
    return problemId ? `AI 调试 · ${problemId}` : `AI 调试 · ${fileName}`;
  }
}

export function registerAiDebug(context: vscode.ExtensionContext): vscode.Disposable {
  const service = new AiDebugService(context);
  return service.register();
}
