import * as path from "path";
import * as cp from "child_process";
import * as vscode from "vscode";
import * as fse from "fs-extra";
import { ShowMessage } from "../utils/OutputUtils";
import { OutPutType } from "../model/ConstDefind";

const DEBUG_COMMAND = "leetcode-cpp-debugger.debug";
const INPUT_FILE_NAME = "test_case.txt";
const DEBUG_BINARY_NAME = ".vscode-cpp-debug";
const LINE_DIRECTIVE_MARKER = "// @lcpr-cpp-debug-disabled-line ";
const OUTPUT_CHANNEL = "LeetcodeUltra Debug";

interface CppLeetCodeDebugOptions {
  enableAiDebug?: boolean;
}

function normalizeTestCase(testCase: string): string {
  return String(testCase || "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+$/g, "");
}

class CppLeetCodePluginBridge {
  private cleanupDisposables: vscode.Disposable[] = [];
  private readonly output = vscode.window.createOutputChannel(OUTPUT_CHANNEL);

  public async start(document: vscode.TextDocument, filePath: string, testCase: string, options: CppLeetCodeDebugOptions = {}): Promise<void> {
    const enableAiDebug = !!options.enableAiDebug;
    this.log(`start file=${filePath} enableAiDebug=${enableAiDebug}`);
    const commandAvailable = await this.hasDebuggerCommand();
    this.log(`debuggerCommandAvailable=${commandAvailable}`);
    if (!commandAvailable) {
      ShowMessage("未找到 LeetCode C++ Debugger 插件。请先安装 XavierCai.vscode-leetcode-cpp-debug。", OutPutType.error);
      return;
    }

    await this.prepareInputFile(filePath, testCase);
    const disabledLineDirective = await this.disableLineDirective(document);
    document = await vscode.workspace.openTextDocument(document.uri);
    const temporaryBreakpoint = this.ensureEntryBreakpoint(document);
    const entryFunctionName = this.findEntryFunctionName(document);
    const cleanupDisposable = this.registerCleanup(
      document.uri,
      disabledLineDirective || !!temporaryBreakpoint,
      temporaryBreakpoint
    );
    this.log(`prepared input=${path.join(path.dirname(filePath), INPUT_FILE_NAME)} disabledLine=${disabledLineDirective} tempBreakpoint=${temporaryBreakpoint ? temporaryBreakpoint.location.range.start.line + 1 : "none"} function=${entryFunctionName || "none"}`);

    if (document.isDirty) {
      await document.save();
    }

    let started = false;
    try {
      started = await this.executeDebuggerCommand(document, filePath, entryFunctionName);
    } catch (error) {
      this.log(`debug command threw: ${(error as Error).stack || (error as Error).message || error}`);
      if (cleanupDisposable) {
        cleanupDisposable.dispose();
      }
      await this.cleanupDocumentEdits(document.uri);
      throw error;
    }
    if (!started) {
      this.log("debug session did not start");
      if (cleanupDisposable) {
        cleanupDisposable.dispose();
      }
      await this.cleanupDebugSessionState(document.uri, temporaryBreakpoint);
      ShowMessage(await this.describeStartupFailure(document), OutPutType.warning);
    } else {
      this.log("debug session started");
      if (enableAiDebug) {
        vscode.commands.executeCommand("lcpr.aiDebug.analyzeAndShow").then(undefined, () => undefined);
      }
    }
    await vscode.commands.executeCommand("lcpr.workbench.showResult", {
      action: "debug",
      runMode: "debug",
      result: {
        messages: [started ? "调试器已启动" : "调试器未启动"],
        Input: [normalizeTestCase(testCase).trimEnd()],
      },
    });
  }

  private async hasDebuggerCommand(): Promise<boolean> {
    let commands = await vscode.commands.getCommands(true);
    if (commands.indexOf(DEBUG_COMMAND) >= 0) {
      return true;
    }

    const extension = vscode.extensions.getExtension("XavierCai.vscode-leetcode-cpp-debug")
      || vscode.extensions.getExtension("xaviercai.vscode-leetcode-cpp-debug");
    if (extension) {
      await extension.activate();
      commands = await vscode.commands.getCommands(true);
    }
    return commands.indexOf(DEBUG_COMMAND) >= 0;
  }

  private async prepareInputFile(filePath: string, testCase: string): Promise<void> {
    const inputPath = path.join(path.dirname(filePath), INPUT_FILE_NAME);
    await fse.writeFile(inputPath, normalizeTestCase(testCase), "utf8");
  }

  private async executeDebuggerCommand(document: vscode.TextDocument, filePath: string, entryFunctionName?: string): Promise<boolean> {
    const solutionDir = path.dirname(filePath);
    const activeBefore = vscode.debug.activeDebugSession && vscode.debug.activeDebugSession.id;
    this.log(`generate with ${DEBUG_COMMAND} activeBefore=${activeBefore || "none"}`);
    let generatedSession: vscode.DebugSession | undefined;
    const sessionDisposable = vscode.debug.onDidStartDebugSession((session) => {
      this.log(`generator started session type=${session.type} name=${session.name} id=${session.id}`);
      if (!activeBefore || session.id !== activeBefore) {
        generatedSession = session;
      }
    });
    const restoreSource = await this.overrideDebuggerConfig(document, "source", "[offline]local");
    const restoreDeleteTemporary = await this.overrideDebuggerConfig(document, "deleteTemporaryContents", false);
    try {
      const value = await this.withTimeout(vscode.commands.executeCommand(DEBUG_COMMAND, document.uri), 45000);
      this.log(`generator commandFinished value=${JSON.stringify(value)} active=${vscode.debug.activeDebugSession ? vscode.debug.activeDebugSession.id : "none"}`);
      const active = vscode.debug.activeDebugSession;
      if (!generatedSession && active && (!activeBefore || active.id !== activeBefore)) {
        generatedSession = active;
      }
      if (generatedSession) {
        await this.stopGeneratedSession(generatedSession);
      }
      await this.patchGeneratedMainInput(filePath);
    } finally {
      sessionDisposable.dispose();
      await restoreDeleteTemporary();
      await restoreSource();
    }
    return await this.startFallbackDebugging(solutionDir, entryFunctionName);
  }

  private async withTimeout<T>(promise: Thenable<T>, timeoutMs: number): Promise<T | undefined> {
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

  private async overrideDebuggerConfig<T>(
    document: vscode.TextDocument,
    key: string,
    value: T
  ): Promise<() => Promise<void>> {
    const config = vscode.workspace.getConfiguration("leetcode-cpp-debugger", document.uri);
    const inspected = config.inspect<T>(key);
    const hadGlobalValue = !!inspected && inspected.globalValue !== undefined;
    const previousGlobalValue = inspected && inspected.globalValue;
    const current = config.get<T>(key);
    if (current !== value) {
      this.log(`override leetcode-cpp-debugger.${key}=${JSON.stringify(value)}`);
      await config.update(key, value, vscode.ConfigurationTarget.Global);
    }
    return async () => {
      if (current !== value) {
        this.log(`restore leetcode-cpp-debugger.${key}`);
        await config.update(key, hadGlobalValue ? previousGlobalValue : undefined, vscode.ConfigurationTarget.Global);
      }
    };
  }

  private async stopGeneratedSession(session: vscode.DebugSession): Promise<void> {
    this.log(`stop generator session id=${session.id} type=${session.type} name=${session.name}`);
    const terminated = this.waitForSessionTermination(session, 8000);
    try {
      await vscode.debug.stopDebugging(session);
    } catch (error) {
      this.log(`stop generator session failed: ${(error as Error).message || error}`);
    }
    await terminated;
  }

  private async waitForSessionTermination(session: vscode.DebugSession, timeoutMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const disposable = vscode.debug.onDidTerminateDebugSession((terminatedSession) => {
        if (terminatedSession.id === session.id) {
          if (timer) {
            clearTimeout(timer);
          }
          disposable.dispose();
          resolve();
        }
      });
      timer = setTimeout(() => {
        disposable.dispose();
        resolve();
      }, timeoutMs);
    });
  }

  private async startFallbackDebugging(solutionDir: string, entryFunctionName?: string): Promise<boolean> {
    const generatedMain = path.join(solutionDir, "leetcode-main.cpp");
    if (!(await fse.pathExists(generatedMain))) {
      this.log(`fallback skipped: generated main missing ${generatedMain}`);
      return false;
    }

    const program = path.join(solutionDir, DEBUG_BINARY_NAME);
    await this.buildFallbackExecutable(generatedMain, program, solutionDir);
    const config: vscode.DebugConfiguration = {
      name: "LeetcodeUltra C++ Debug",
      type: "lldb",
      request: "launch",
      program,
      cwd: solutionDir,
      terminal: "integrated",
      sourceLanguages: ["cpp"],
      expressions: "native",
    };
    if (entryFunctionName) {
      config.preRunCommands = [`breakpoint set --name ${entryFunctionName}`];
    }
    this.log(`fallback startDebugging cwd=${solutionDir} program=${program}`);
    const started = await vscode.debug.startDebugging(undefined, config);
    this.log(`fallback startDebugging result=${started} active=${vscode.debug.activeDebugSession ? vscode.debug.activeDebugSession.id : "none"}`);
    return started;
  }

  private async buildFallbackExecutable(generatedMain: string, program: string, cwd: string): Promise<void> {
    this.log(`fallback build ${generatedMain}`);
    const env = { ...process.env };
    delete env.NODE_OPTIONS;
    delete env.VSCODE_INSPECTOR_OPTIONS;
    delete env.ELECTRON_RUN_AS_NODE;
    return new Promise((resolve, reject) => {
      const child = cp.execFile(
        "/usr/bin/clang++",
        ["-std=c++23", "-g", "-O0", "-Wall", "-Wextra", generatedMain, "-o", program],
        { cwd, env },
        (error, stdout, stderr) => {
          if (stdout) {
            this.log(`fallback build stdout:\n${stdout}`);
          }
          if (stderr) {
            this.log(`fallback build stderr:\n${stderr}`);
          }
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }
      );
      child.on("error", reject);
    });
  }

  private async patchGeneratedMainInput(filePath: string): Promise<void> {
    const mainPath = path.join(path.dirname(filePath), "leetcode-main.cpp");
    if (!(await fse.pathExists(mainPath))) {
      this.log(`generated main missing: ${mainPath}`);
      return;
    }
    const original = await fse.readFile(mainPath, "utf8");
    let patched = original.replace(
      /#ifndef INPUT\r?\n#define INPUT std::cin\r?\n#endif/,
      [
        "#ifndef INPUT",
        `#define INPUT "${INPUT_FILE_NAME}"`,
        "#endif",
      ].join("\n")
    );
    patched = patched.replace(
      /\s*\/\/ pause here in terminal\r?\n\s*std::cout << "Press Any Key to Continue\.\.\." << std::endl;\r?\n\s*std::cin\.clear\(\);\r?\n\s*std::cin\.sync\(\);\r?\n\s*std::cin\.get\(\); \/\/ pause\r?\n/,
      "\n"
    );
    if (patched !== original) {
      await fse.writeFile(mainPath, patched, "utf8");
      this.log(`patched generated main INPUT=${INPUT_FILE_NAME} and removed terminal pause`);
    } else {
      this.log("generated main INPUT already patched or pattern not found");
    }
  }

  private async disableLineDirective(document: vscode.TextDocument): Promise<boolean> {
    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      if (text.indexOf(LINE_DIRECTIVE_MARKER) >= 0) {
        return false;
      }
      if (/^\s*#\s*line\s+\d+\s*$/.test(text)) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, document.lineAt(line).range, `${LINE_DIRECTIVE_MARKER}${text}`);
        const success = await vscode.workspace.applyEdit(edit);
        if (!success) {
          throw new Error("无法临时禁用 #line 调试指令。");
        }
        await document.save();
        return true;
      }
    }
    return false;
  }

  private ensureEntryBreakpoint(document: vscode.TextDocument): vscode.SourceBreakpoint | undefined {
    const line = this.findEntryLine(document);
    if (line < 0) {
      return undefined;
    }
    const exists = vscode.debug.breakpoints.some((breakpoint) => {
      if (!(breakpoint instanceof vscode.SourceBreakpoint)) {
        return false;
      }
      const location = breakpoint.location;
      return location.uri.toString() === document.uri.toString() && location.range.start.line === line;
    });
    if (exists) {
      return undefined;
    }
    const breakpoint = new vscode.SourceBreakpoint(
      new vscode.Location(document.uri, new vscode.Position(line, 0)),
      true
    );
    vscode.debug.addBreakpoints([breakpoint]);
    return breakpoint;
  }

  private findEntryLine(document: vscode.TextDocument): number {
    const textContent = document.getText();
    const hasCodeMarkers = textContent.indexOf("@lc code=start") >= 0 && textContent.indexOf("@lc code=end") >= 0;
    let inCode = !hasCodeMarkers;
    let inFunction = false;
    let bodyOpen = false;
    let depth = 0;
    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      if (text.indexOf("@lc code=start") >= 0) {
        inCode = true;
        continue;
      }
      if (text.indexOf("@lc code=end") >= 0) {
        return -1;
      }
      if (!inCode) {
        continue;
      }
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("//") || trimmed === "public:" || trimmed === "private:" || trimmed === "protected:") {
        continue;
      }
      if (!inFunction) {
        if (/\)\s*(const\s*)?(\{|$)/.test(trimmed) && !/^(if|for|while|switch|catch)\b/.test(trimmed) && !/;\s*$/.test(trimmed)) {
          inFunction = true;
          bodyOpen = trimmed.indexOf("{") >= 0;
          depth = this.braceDelta(trimmed);
        }
        continue;
      }

      if (!bodyOpen) {
        if (trimmed.indexOf("{") >= 0) {
          bodyOpen = true;
          depth += this.braceDelta(trimmed);
        }
        continue;
      }

      if (trimmed !== "{" && trimmed !== "}" && !/^(public|private|protected):$/.test(trimmed)) {
        return line;
      }
      depth += this.braceDelta(trimmed);
      if (depth <= 0) {
        return -1;
      }
    }
    return -1;
  }

  private findEntryFunctionName(document: vscode.TextDocument): string | undefined {
    const text = document.getText();
    const code = this.extractCodeBlock(text);
    const classMatch = code.match(/\bclass\s+([A-Za-z_]\w*)\s*[\{:]/);
    const className = classMatch ? classMatch[1] : "Solution";
    const functionMatch = code.match(
      /(?:^|\n)\s*(?:[[\]\w:<>,\s*&]+\s+)+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?\{/m
    );
    if (!functionMatch || functionMatch[1] === className) {
      return undefined;
    }
    return `${className}::${functionMatch[1]}`;
  }

  private extractCodeBlock(text: string): string {
    const lines = text.split(/\r?\n/);
    const codeStart = lines.findIndex((line) => line.indexOf("@lc code=start") >= 0);
    const codeEnd = lines.findIndex((line) => line.indexOf("@lc code=end") >= 0);
    if (codeStart >= 0 && codeEnd > codeStart) {
      return lines.slice(codeStart + 1, codeEnd).join("\n");
    }
    return text;
  }

  private braceDelta(text: string): number {
    const opens = (text.match(/\{/g) || []).length;
    const closes = (text.match(/\}/g) || []).length;
    return opens - closes;
  }

  private registerCleanup(
    uri: vscode.Uri,
    shouldCleanup: boolean,
    temporaryBreakpoint?: vscode.SourceBreakpoint
  ): vscode.Disposable | undefined {
    if (!shouldCleanup) {
      return undefined;
    }
    const disposable = vscode.debug.onDidTerminateDebugSession(async () => {
      disposable.dispose();
      this.cleanupDisposables = this.cleanupDisposables.filter((item) => item !== disposable);
      await this.cleanupDebugSessionState(uri, temporaryBreakpoint);
    });
    this.cleanupDisposables.push(disposable);
    return disposable;
  }

  private async cleanupDebugSessionState(uri: vscode.Uri, temporaryBreakpoint?: vscode.SourceBreakpoint): Promise<void> {
    if (temporaryBreakpoint) {
      vscode.debug.removeBreakpoints([temporaryBreakpoint]);
    }
    await this.cleanupDocumentEdits(uri);
  }

  private async cleanupDocumentEdits(uri: vscode.Uri): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      let text = document.getText();
      let changed = false;
      const edit = new vscode.WorkspaceEdit();

      text = document.getText();
      const lineIndex = text.split(/\r?\n/).findIndex((line) => line.indexOf(LINE_DIRECTIVE_MARKER) >= 0);
      if (lineIndex >= 0) {
        const line = document.lineAt(lineIndex);
        edit.replace(uri, line.range, line.text.replace(LINE_DIRECTIVE_MARKER, ""));
        changed = true;
      }

      if (changed && await vscode.workspace.applyEdit(edit)) {
        await document.save();
      }
    } catch (error) {
      ShowMessage(`清理临时 INPUT 宏失败：${(error as Error).message || error}`, OutPutType.warning);
    }
  }

  private async describeStartupFailure(document: vscode.TextDocument): Promise<string> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) {
      return `C++ 调试器未启动。请先用 VS Code 打开题目所在文件夹：${path.dirname(document.uri.fsPath)}`;
    }
    const launch = vscode.workspace.getConfiguration("launch", document.uri).get<any[]>("configurations") || [];
    if (!launch.length) {
      return `C++ 调试器未启动。工作区 ${folder.uri.fsPath} 缺少 .vscode/launch.json 调试配置。`;
    }
    const tasksPath = path.join(folder.uri.fsPath, ".vscode", "tasks.json");
    if (!(await fse.pathExists(tasksPath))) {
      return `C++ 调试器未启动。工作区 ${folder.uri.fsPath} 缺少 .vscode/tasks.json 构建任务。`;
    }
    const source = vscode.workspace.getConfiguration("leetcode-cpp-debugger", document.uri).get<string>("source");
    if (source && source !== "[offline]local") {
      return `C++ 调试器未启动。请把 leetcode-cpp-debugger.source 设置为 [offline]local。`;
    }
    return "C++ 调试器未启动。已生成输入文件，但 VS Code 没有创建调试会话；请查看终端里的构建/CodeLLDB 输出。";
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
  }
}

export const cppLeetCodePluginBridge = new CppLeetCodePluginBridge();
