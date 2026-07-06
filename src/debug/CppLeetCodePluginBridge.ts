import * as path from "path";
import * as cp from "child_process";
import * as vscode from "vscode";
import * as fse from "fs-extra";
import { ShowMessage } from "../utils/OutputUtils";
import { OutPutType } from "../model/ConstDefind";
import { LeetCodeCppHarnessGenerator, leetcodeCppDebuggerResourcesDir } from "./LeetCodeCppHarnessGenerator";

const INPUT_FILE_NAME = "test_case.txt";
const DEBUG_BINARY_NAME = ".vscode-cpp-debug";
const LINE_DIRECTIVE_MARKER = "// @lcpr-cpp-debug-disabled-line ";
const OUTPUT_CHANNEL = "LeetcodeUltra Debug";
const DEBUG_DEFINITION_RELATIVE_PATH = ".lcpr_data/cpp/leetcode-definition.hpp";
const DEBUG_DEFINITION_MARKER = "// @lcpr-cpp-debug-definition";
const CPP_DEBUG_DEFINITION = [
  "#pragma once",
  "#include <algorithm>",
  "#include <array>",
  "#include <cassert>",
  "#include <bitset>",
  "#include <cctype>",
  "#include <climits>",
  "#include <cmath>",
  "#include <cstddef>",
  "#include <cstdlib>",
  "#include <cstring>",
  "#include <deque>",
  "#include <functional>",
  "#include <iomanip>",
  "#include <initializer_list>",
  "#include <iostream>",
  "#include <iterator>",
  "#include <limits>",
  "#include <list>",
  "#include <map>",
  "#include <memory>",
  "#include <numeric>",
  "#include <queue>",
  "#include <set>",
  "#include <sstream>",
  "#include <stack>",
  "#include <string>",
  "#include <tuple>",
  "#include <unordered_map>",
  "#include <unordered_set>",
  "#include <utility>",
  "#include <vector>",
  "using namespace std;",
  "",
  "struct ListNode {",
  "    int val;",
  "    ListNode *next;",
  "    ListNode() : val(0), next(nullptr) {}",
  "    explicit ListNode(int x) : val(x), next(nullptr) {}",
  "    ListNode(int x, ListNode *next) : val(x), next(next) {}",
  "};",
  "",
  "struct TreeNode {",
  "    int val;",
  "    TreeNode *left;",
  "    TreeNode *right;",
  "    TreeNode() : val(0), left(nullptr), right(nullptr) {}",
  "    explicit TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}",
  "    TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}",
  "};",
  "",
  "class Node {",
  "public:",
  "    int val;",
  "    Node *next;",
  "    Node *random;",
  "    Node *left;",
  "    Node *right;",
  "    vector<Node *> neighbors;",
  "    vector<Node *> children;",
  "    Node() : val(0), next(nullptr), random(nullptr), left(nullptr), right(nullptr) {}",
  "    explicit Node(int _val) : val(_val), next(nullptr), random(nullptr), left(nullptr), right(nullptr) {}",
  "    Node(int _val, vector<Node *> _neighbors) : val(_val), next(nullptr), random(nullptr), left(nullptr), right(nullptr), neighbors(_neighbors) {}",
  "    Node(int _val, Node *_next, Node *_random) : val(_val), next(_next), random(_random), left(nullptr), right(nullptr) {}",
  "    Node(int _val, Node *_left, Node *_right, Node *_next) : val(_val), next(_next), random(nullptr), left(_left), right(_right) {}",
  "};",
  "",
  "class NestedInteger {",
  "public:",
  "    NestedInteger();",
  "    NestedInteger(int value);",
  "    bool isInteger() const;",
  "    int getInteger() const;",
  "    void setInteger(int value);",
  "    void add(const NestedInteger &ni);",
  "    const vector<NestedInteger> &getList() const;",
  "};",
  "",
  "class MountainArray {",
  "public:",
  "    int get(int index);",
  "    int length();",
  "};",
  "",
  "class Master {",
  "public:",
  "    int guess(string word);",
  "};",
  "",
  "bool isBadVersion(int version);",
  "int guess(int num);",
  "bool knows(int a, int b);",
  "",
  "namespace dbgvis {",
  "struct Marker {",
  "    std::string id;",
  "    std::size_t row;",
  "    std::size_t column;",
  "    std::size_t rows;",
  "    std::size_t columns;",
  "    std::string label;",
  "    std::string color;",
  "};",
  "namespace detail {",
  "inline std::string json_escape(const std::string& value) {",
  "    std::string out;",
  "    out.reserve(value.size() + 8);",
  "    for (char ch : value) {",
  "        switch (ch) {",
  "        case '\\\\': out += \"\\\\\\\\\"; break;",
  "        case '\"': out += \"\\\\\\\"\"; break;",
  "        case '\\n': out += \"\\\\n\"; break;",
  "        case '\\r': out += \"\\\\r\"; break;",
  "        case '\\t': out += \"\\\\t\"; break;",
  "        default: out += ch; break;",
  "        }",
  "    }",
  "    return out;",
  "}",
  "template <typename T>",
  "std::string to_string(const T& value) {",
  "    std::ostringstream stream;",
  "    stream << value;",
  "    return stream.str();",
  "}",
  "inline void write_marker(std::ostringstream& json, const Marker& marker) {",
  "    json << \"{\\\"id\\\":\\\"\" << json_escape(marker.id) << \"\\\"\"",
  "         << \",\\\"row\\\":\" << marker.row",
  "         << \",\\\"column\\\":\" << marker.column;",
  "    if (marker.rows > 1) {",
  "        json << \",\\\"rows\\\":\" << marker.rows;",
  "    }",
  "    if (marker.columns > 1) {",
  "        json << \",\\\"columns\\\":\" << marker.columns;",
  "    }",
  "    if (!marker.label.empty()) {",
  "        json << \",\\\"label\\\":\\\"\" << json_escape(marker.label) << \"\\\"\";",
  "    }",
  "    if (!marker.color.empty()) {",
  "        json << \",\\\"color\\\":\\\"\" << json_escape(marker.color) << \"\\\"\";",
  "    }",
  "    json << \"}\";",
  "}",
  "template <typename Iterator>",
  "std::string array_from_iterators(Iterator first, Iterator last, std::initializer_list<Marker> markers = {}) {",
  "    std::ostringstream json;",
  "    json << \"{\\\"kind\\\":{\\\"grid\\\":true},\\\"rows\\\":[{\\\"columns\\\":[\";",
  "    std::size_t index = 0;",
  "    for (Iterator it = first; it != last; ++it, ++index) {",
  "        if (index > 0) {",
  "            json << \",\";",
  "        }",
  "        json << \"{\\\"content\\\":\\\"\" << json_escape(to_string(*it)) << \"\\\",\\\"tag\\\":\\\"\" << index << \"\\\"}\";",
  "    }",
  "    json << \"]}]\";",
  "    if (markers.size() > 0) {",
  "        json << \",\\\"markers\\\":[\";",
  "        std::size_t markerIndex = 0;",
  "        for (std::initializer_list<Marker>::const_iterator it = markers.begin(); it != markers.end(); ++it, ++markerIndex) {",
  "            if (markerIndex > 0) {",
  "                json << \",\";",
  "            }",
  "            write_marker(json, *it);",
  "        }",
  "        json << \"]\";",
  "    }",
  "    json << \"}\";",
  "    return json.str();",
  "}",
  "inline std::string error_text(const std::string& message) {",
  "    return \"{\\\"kind\\\":{\\\"text\\\":true},\\\"text\\\":\\\"\" + json_escape(message) + \"\\\"}\";",
  "}",
  "} // namespace detail",
  "inline Marker marker(std::size_t index, const std::string& label = \"\", const std::string& color = \"\") {",
  "    Marker result;",
  "    result.id = label.empty() ? detail::to_string(index) : label;",
  "    result.row = 0;",
  "    result.column = index;",
  "    result.rows = 1;",
  "    result.columns = 1;",
  "    result.label = label;",
  "    result.color = color;",
  "    return result;",
  "}",
  "inline Marker range(std::size_t start, std::size_t count, const std::string& label = \"\", const std::string& color = \"\") {",
  "    Marker result = marker(start, label, color);",
  "    result.id = label.empty() ? (\"range-\" + detail::to_string(start)) : label;",
  "    result.columns = count == 0 ? 1 : count;",
  "    return result;",
  "}",
  "template <typename Iterator>",
  "Marker marker_at(Iterator first, Iterator it, const std::string& label = \"\", const std::string& color = \"\") {",
  "    return marker(static_cast<std::size_t>(std::distance(first, it)), label, color);",
  "}",
  "template <typename Iterator>",
  "Marker range_at(Iterator first, Iterator rangeFirst, Iterator rangeLast, const std::string& label = \"\", const std::string& color = \"\") {",
  "    return range(static_cast<std::size_t>(std::distance(first, rangeFirst)), static_cast<std::size_t>(std::distance(rangeFirst, rangeLast)), label, color);",
  "}",
  "template <typename Container>",
  "std::string array(const Container& container) {",
  "    using std::begin;",
  "    using std::end;",
  "    return detail::array_from_iterators(begin(container), end(container));",
  "}",
  "template <typename Container>",
  "std::string array(const Container& container, std::initializer_list<Marker> markers) {",
  "    using std::begin;",
  "    using std::end;",
  "    return detail::array_from_iterators(begin(container), end(container), markers);",
  "}",
  "template <typename T, std::size_t N>",
  "std::string array(const T (&items)[N]) {",
  "    return detail::array_from_iterators(items, items + N);",
  "}",
  "template <typename T, std::size_t N>",
  "std::string array(const T (&items)[N], std::initializer_list<Marker> markers) {",
  "    return detail::array_from_iterators(items, items + N, markers);",
  "}",
  "template <typename T>",
  "std::string array(const T* ptr, std::size_t count) {",
  "    return array(ptr, count, {});",
  "}",
  "template <typename T>",
  "std::string array(const T* ptr, std::size_t count, std::initializer_list<Marker> markers) {",
  "    if (!ptr && count > 0) {",
  "        return detail::error_text(\"dbgvis::array received a null pointer with non-zero count.\");",
  "    }",
  "    if (count == 0) {",
  "        return detail::array_from_iterators(ptr, ptr, markers);",
  "    }",
  "    return detail::array_from_iterators(ptr, ptr + count, markers);",
  "}",
  "} // namespace dbgvis",
  "",
].join("\n");

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
    await this.restoreLeetCodeConsoleFocus(document);
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
    await this.restoreLeetCodeConsoleFocus(document);
  }

  private async prepareInputFile(filePath: string, testCase: string): Promise<void> {
    const inputPath = path.join(path.dirname(filePath), INPUT_FILE_NAME);
    await fse.writeFile(inputPath, normalizeTestCase(testCase), "utf8");
  }

  private async executeDebuggerCommand(document: vscode.TextDocument, filePath: string, entryFunctionName?: string): Promise<boolean> {
    const solutionDir = path.dirname(filePath);
    this.log("generate debug harness from internal LeetcodeUltra source");
    await this.generateDebugHarness(document, filePath);
    await this.patchGeneratedMainInput(filePath);
    await this.restoreLeetCodeConsoleFocus(document);
    const started = await this.startFallbackDebugging(solutionDir, document, entryFunctionName);
    await this.restoreLeetCodeConsoleFocus(document);
    return started;
  }

  private async generateDebugHarness(document: vscode.TextDocument, filePath: string): Promise<void> {
    const solutionDir = path.dirname(filePath);
    const resourcesDir = leetcodeCppDebuggerResourcesDir();
    if (!(await fse.pathExists(resourcesDir))) {
      throw new Error(`LeetcodeUltra 内置 C++ 调试资源缺失：${resourcesDir}`);
    }
    const codeTemplate = document.getText();
    const generator = new LeetCodeCppHarnessGenerator(codeTemplate);
    const handler = await generator.genStubCode(path.basename(filePath));
    if (!handler) {
      throw new Error("无法生成 C++ 调试入口。");
    }
    const resourceFiles = await fse.readdir(resourcesDir);
    await Promise.all(resourceFiles.map(async (fileName) => {
      const source = path.join(resourcesDir, fileName);
      const target = path.join(solutionDir, fileName);
      const stat = await fse.stat(source);
      if (stat.isFile()) {
        await fse.copy(source, target, { overwrite: true });
      }
    }));
    await fse.writeFile(path.join(solutionDir, "leetcode-handler.h"), handler, "utf8");
    this.log(`generated debug harness files in ${solutionDir}`);
  }

  private async startFallbackDebugging(solutionDir: string, document: vscode.TextDocument, entryFunctionName?: string): Promise<boolean> {
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
      terminal: "console",
      internalConsoleOptions: "neverOpen",
      externalConsole: false,
      sourceLanguages: ["cpp"],
      expressions: "native",
    };
    if (entryFunctionName) {
      config.preRunCommands = [`breakpoint set --name ${entryFunctionName}`];
    }
    this.log(`fallback startDebugging cwd=${solutionDir} program=${program}`);
    const started = await vscode.debug.startDebugging(undefined, config);
    this.log(`fallback startDebugging result=${started} active=${vscode.debug.activeDebugSession ? vscode.debug.activeDebugSession.id : "none"}`);
    await this.restoreLeetCodeConsoleFocus(document);
    return started;
  }

  private async restoreLeetCodeConsoleFocus(document: vscode.TextDocument): Promise<void> {
    const reveal = async () => {
      try {
        await vscode.commands.executeCommand("LCPRWorkbench.focus");
      } catch (error) {
        this.log(`restore workbench focus failed: ${(error as Error).message || error}`);
        try {
          await vscode.window.showTextDocument(document, {
            viewColumn: vscode.ViewColumn.Active,
            preserveFocus: false,
            preview: false,
          });
          await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
        } catch (fallbackError) {
          this.log(`restore editor focus failed: ${(fallbackError as Error).message || fallbackError}`);
        }
      }
    };
    await reveal();
    [80, 220, 520].forEach((delay) => {
      setTimeout(() => {
        reveal().then(undefined, () => undefined);
      }, delay);
    });
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
        // Avoid Node's text-decoding path here. In some VS Code/Electron sessions
        // StringDecoder can be monkey-patched by other extensions, which breaks
        // execFile's default utf8 stream setup before clang++ even starts.
        { cwd, env, encoding: "buffer" },
        (error, stdout, stderr) => {
          const stdoutText = Buffer.isBuffer(stdout) ? stdout.toString("utf8") : `${stdout || ""}`;
          const stderrText = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : `${stderr || ""}`;
          if (stdoutText) {
            this.log(`fallback build stdout:\n${stdoutText}`);
          }
          if (stderrText) {
            this.log(`fallback build stderr:\n${stderrText}`);
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
    const solutionDir = path.dirname(filePath);
    await this.patchGeneratedHandlerDefinition(solutionDir);
    const mainPath = path.join(solutionDir, "leetcode-main.cpp");
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

  private async ensureCppDebugDefinitionFile(solutionDir: string): Promise<string> {
    const definitionPath = path.join(solutionDir, DEBUG_DEFINITION_RELATIVE_PATH);
    await fse.ensureDir(path.dirname(definitionPath));
    await fse.writeFile(definitionPath, CPP_DEBUG_DEFINITION, "utf8");
    return definitionPath;
  }

  private async patchGeneratedHandlerDefinition(solutionDir: string): Promise<void> {
    const handlerPath = path.join(solutionDir, "leetcode-handler.h");
    if (!(await fse.pathExists(handlerPath))) {
      this.log(`generated handler missing: ${handlerPath}`);
      return;
    }
    const definitionPath = await this.ensureCppDebugDefinitionFile(solutionDir);
    const includePath = path.relative(solutionDir, definitionPath).split(path.sep).join("/");
    const original = await fse.readFile(handlerPath, "utf8");
    if (original.indexOf(DEBUG_DEFINITION_MARKER) >= 0 || original.indexOf(`#include "${includePath}"`) >= 0) {
      this.log(`generated handler already includes ${includePath}`);
      return;
    }
    const includeLine = `${DEBUG_DEFINITION_MARKER}\n#include "${includePath}"`;
    const patched = original.replace(
      /(#define LEETCODE_HANDLER\s*)/,
      `$1\n${includeLine}\n`
    );
    if (patched !== original) {
      await fse.writeFile(handlerPath, patched, "utf8");
      this.log(`patched generated handler with ${includePath}`);
    } else {
      this.log("generated handler definition include pattern not found");
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
    return "C++ 调试器未启动。LeetcodeUltra 已在内部生成调试入口，请确认 CodeLLDB 已安装并查看“LeetcodeUltra Debug”输出里的构建/启动日志。";
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
  }
}

export const cppLeetCodePluginBridge = new CppLeetCodePluginBridge();
