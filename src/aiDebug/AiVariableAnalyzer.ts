import * as vscode from "vscode";
import * as ts from "typescript";
import { AiClient, stableHash } from "../ai/AiClient";
import { fileMetaFromDocument } from "../utils/problemUtils";

export interface KeyVariable {
  name: string;
  type?: string;
  reason?: string;
  expression?: string;
}

export interface AnalysisResult {
  variables: KeyVariable[];
  source: "ai" | "static" | "cache" | "mixed";
  warnings: string[];
  codeHash: string;
  language: string;
  problemId?: string;
}

interface CachedAnalysis {
  codeHash: string;
  language: string;
  problemId?: string;
  variables: KeyVariable[];
}

function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("leetcode-problem-rating");
}

function uniqueVariables(variables: KeyVariable[], maxCount: number): KeyVariable[] {
  const seen = new Set<string>();
  const output: KeyVariable[] = [];
  for (const variable of variables) {
    const name = String(variable && (variable.expression || variable.name) || "").trim();
    if (!isSafeDebugExpression(name)) {
      continue;
    }
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    output.push({
      name: String(variable.name || name).trim(),
      expression: String(variable.expression || name).trim(),
      type: String(variable.type || "").trim() || undefined,
      reason: String(variable.reason || "").trim() || undefined,
    });
    if (output.length >= maxCount) {
      break;
    }
  }
  return output;
}

function isSafeDebugExpression(expression: string): boolean {
  const text = String(expression || "").trim();
  if (!text || text.length > 120) {
    return false;
  }
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(text)
    && !/^[A-Za-z_]\w*(?:\s*(?:->|\.)\s*[A-Za-z_]\w*|\s*\[\s*(?:\d+|[A-Za-z_]\w*)\s*\])*$/.test(text)
    && !/^\(\s*\*\s*[A-Za-z_]\w*\s*\)(?:\s*\.\s*[A-Za-z_]\w*)+$/.test(text)) {
    return false;
  }
  return !/[;{}=]/.test(text);
}

export class AiVariableAnalyzer {
  constructor(private readonly context: vscode.ExtensionContext, private readonly aiClient: AiClient) {}

  public invalidate(document: vscode.TextDocument): void {
    const key = this.cacheKey(document.uri);
    this.context.workspaceState.update(key, undefined);
  }

  public async analyze(document: vscode.TextDocument): Promise<AnalysisResult> {
    const extracted = this.extractLeetCodeSource(document);
    const codeHash = stableHash(`${extracted.language}\n${extracted.code}`);
    const maxVariables = Math.max(1, Math.min(12, getConfig().get<number>("aiDebug.maxVariables", 6)));
    const manualVariables = this.getManualVariables();
    const key = this.cacheKey(document.uri);
    const cached = this.context.workspaceState.get<CachedAnalysis>(key);
    if (cached && cached.codeHash === codeHash) {
      return {
        variables: uniqueVariables(manualVariables.concat(cached.variables), maxVariables),
        source: "cache",
        warnings: [],
        codeHash,
        language: cached.language,
        problemId: cached.problemId,
      };
    }

    const staticVariables = uniqueVariables(manualVariables.concat(this.staticAnalyze(extracted.code, extracted.language)), maxVariables);
    const warnings: string[] = [];
    let variables = staticVariables;
    let source: AnalysisResult["source"] = "static";

    const useAi = getConfig().get<boolean>("aiDebug.enableAiAnalysis", true);
    if (useAi) {
      try {
        const aiVariables = uniqueVariables(await this.aiAnalyze(extracted, staticVariables, maxVariables), maxVariables);
        if (aiVariables.length) {
          variables = aiVariables;
          source = staticVariables.length ? "mixed" : "ai";
        }
      } catch (error) {
        warnings.push(`AI 分析失败，已使用静态分析：${String((error as Error).message || error)}`);
      }
    }

    if (!variables.length) {
      warnings.push("没有识别到关键变量。可以在设置中关闭 AI 自动分析后手动补充变量。");
    }

    await this.context.workspaceState.update(key, {
      codeHash,
      language: extracted.language,
      problemId: extracted.problemId,
      variables,
    } as CachedAnalysis);

    return {
      variables,
      source,
      warnings,
      codeHash,
      language: extracted.language,
      problemId: extracted.problemId,
    };
  }

  private cacheKey(uri: vscode.Uri): string {
    return `lcpr.aiDebug.analysis.v2.${stableHash(uri.toString())}`;
  }

  private getManualVariables(): KeyVariable[] {
    const configured = getConfig().get<any[]>("aiDebug.manualVariables", []) || [];
    return configured.map((item) => {
      if (typeof item === "string") {
        return { name: item, expression: item, reason: "用户指定" };
      }
      return {
        name: String(item.name || item.expression || "").trim(),
        expression: String(item.expression || item.name || "").trim(),
        type: String(item.type || "").trim() || undefined,
        reason: "用户指定",
      };
    });
  }

  private extractLeetCodeSource(document: vscode.TextDocument): { code: string; language: string; problemId?: string } {
    const text = document.getText();
    const storedMeta = fileMetaFromDocument(document);
    const commentMeta = text.match(/@lc app=.* id=([^\s]+) lang=([^\s]+)/);
    const lines = text.split(/\r?\n/);
    const codeStart = lines.findIndex((line) => line.indexOf("@lc code=start") >= 0);
    const codeEnd = lines.findIndex((line) => line.indexOf("@lc code=end") >= 0);
    const code = codeStart >= 0 && codeEnd > codeStart
      ? lines.slice(codeStart + 1, codeEnd).join("\n")
      : text;
    return {
      code,
      language: storedMeta ? storedMeta.lang : (commentMeta ? commentMeta[2] : document.languageId),
      problemId: storedMeta ? storedMeta.id : (commentMeta ? commentMeta[1] : undefined),
    };
  }

  private staticAnalyze(code: string, language: string): KeyVariable[] {
    const variables: KeyVariable[] = [];
    const add = (name: string, type?: string, reason?: string) => {
      variables.push({ name, expression: name, type, reason });
    };
    const source = String(code || "");

    if (/javascript|typescript/i.test(language)) {
      variables.push(...this.staticAnalyzeJsTsAst(source, language));
    }

    const jsFunction = source.match(/(?:function\s+\w+\s*|\([^)]*\)\s*=>|^\s*\w+\s*\()?\(([^)]*)\)/m);
    if (/javascript|typescript/i.test(language) && jsFunction && jsFunction[1]) {
      jsFunction[1].split(",").map((part) => part.trim().replace(/=.*$/, "").trim()).filter(Boolean)
        .forEach((name) => add(name, undefined, "函数参数"));
    }

    const cppLikeFunction = source.match(/(?:public:\s*)?[\w:<>,\s*&]+\s+\w+\s*\(([^)]*)\)\s*\{/m);
    if (cppLikeFunction && cppLikeFunction[1]) {
      cppLikeFunction[1].split(",").map((part) => part.trim()).filter(Boolean).forEach((part) => {
        const match = part.match(/^(.+?)\s*([A-Za-z_]\w*)$/);
        if (match) {
          add(match[2], match[1].replace(/\s+/g, " "), "函数参数");
        }
      });
    }

    const pyFunction = source.match(/def\s+\w+\s*\(([^)]*)\)\s*:/m);
    if (pyFunction && pyFunction[1]) {
      pyFunction[1].split(",").map((part) => part.trim().replace(/:.*$/, "").replace(/=.*$/, "").trim())
        .filter((name) => name && name !== "self")
        .forEach((name) => add(name, undefined, "函数参数"));
    }

    const declarationPattern = /\b(?:let|const|var|(?:unsigned\s+)?long\s+long|(?:unsigned\s+)?int|(?:unsigned\s+)?long|short|size_t|double|float|char|boolean|bool|string|std::string|auto|ListNode\s*\*?|TreeNode\s*\*?|Map<[^;=]+>|Set<[^;=]+>|(?:std::)?(?:array|deque|list|map|multimap|multiset|pair|priority_queue|queue|set|stack|unordered_map|unordered_multimap|unordered_multiset|unordered_set|vector)<[^;=]+>)\s*(?:&|\*)?\s*([A-Za-z_]\w*)/g;
    let match: RegExpExecArray | null;
    while ((match = declarationPattern.exec(source))) {
      const nextChar = source.slice(declarationPattern.lastIndex).trimStart()[0];
      if (nextChar === "(") {
        continue;
      }
      const full = match[0] || "";
      const type = full.replace(/\s+[A-Za-z_]\w*$/, "").trim();
      add(match[1], type, "局部变量");
    }

    const pythonAssignmentPattern = /^\s*([A-Za-z_]\w*)\s*=\s*[^=]/gm;
    while ((match = pythonAssignmentPattern.exec(source))) {
      add(match[1], undefined, "局部变量");
    }

    ["head", "root", "node", "cur", "curr", "current", "prev", "next", "left", "right", "stack", "queue", "pq", "heap", "freq", "count", "counts", "seen", "visited", "memo", "dp", "nums", "arr", "grid", "s", "t", "ans", "res", "result"].forEach((name) => {
      if (new RegExp(`\\b${name}\\b`).test(source)) {
        add(name, undefined, "常见关键变量");
      }
    });

    return variables;
  }

  private staticAnalyzeJsTsAst(code: string, language: string): KeyVariable[] {
    const sourceFile = ts.createSourceFile(
      `lcpr-ai-debug.${/typescript/i.test(language) ? "ts" : "js"}`,
      code,
      ts.ScriptTarget.Latest,
      true,
      /typescript/i.test(language) ? ts.ScriptKind.TS : ts.ScriptKind.JS
    );
    const variables: KeyVariable[] = [];
    const add = (name: string, type?: string, reason?: string) => {
      if (!name || !/^[A-Za-z_$][\w$]*$/.test(name)) {
        return;
      }
      variables.push({ name, expression: name, type, reason });
    };
    const addBindingName = (name: ts.BindingName, type?: string, reason?: string) => {
      if (ts.isIdentifier(name)) {
        add(name.text, type, reason);
        return;
      }
      name.elements.forEach((element) => {
        if (ts.isBindingElement(element)) {
          addBindingName(element.name, type, reason);
        }
      });
    };
    const typeText = (node?: ts.TypeNode) => node ? node.getText(sourceFile) : undefined;
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
        node.parameters.forEach((parameter) => addBindingName(parameter.name, typeText(parameter.type), "AST 函数参数"));
      }
      if (ts.isVariableDeclaration(node)) {
        addBindingName(node.name, typeText(node.type), "AST 局部变量");
      }
      if (ts.isForOfStatement(node) || ts.isForInStatement(node)) {
        const initializer = node.initializer;
        if (ts.isVariableDeclarationList(initializer)) {
          initializer.declarations.forEach((declaration) => addBindingName(declaration.name, typeText(declaration.type), "AST 循环变量"));
        } else if (ts.isIdentifier(initializer)) {
          add(initializer.text, undefined, "AST 循环变量");
        }
      }
      if (ts.isReturnStatement(node) && node.expression && ts.isIdentifier(node.expression)) {
        add(node.expression.text, undefined, "AST 返回值相关变量");
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return variables;
  }

  private async aiAnalyze(
    extracted: { code: string; language: string; problemId?: string },
    staticVariables: KeyVariable[],
    maxVariables: number
  ): Promise<KeyVariable[]> {
    const result = await this.aiClient.requestJson<{ variables?: KeyVariable[] }>([
      {
        role: "system",
        content: "Return strict JSON only. Analyze LeetCode solution code and choose debugger watch variables.",
      },
      {
        role: "user",
        content: [
          "请识别调试时最值得监视的关键变量，最多返回指定数量。",
          "只返回 JSON：{\"variables\":[{\"name\":\"head\",\"expression\":\"head\",\"type\":\"ListNode\",\"reason\":\"...\"}]}",
          "expression 必须是当前栈帧可 evaluate 的简单表达式，优先使用变量名。",
          "优先包含函数参数、返回值相关变量、循环指针、数组、链表/树根、栈/队列、动态规划状态。",
          `最大数量：${maxVariables}`,
          `题号：${extracted.problemId || "unknown"}`,
          `语言：${extracted.language}`,
          `静态候选：${JSON.stringify(staticVariables)}`,
          "代码：",
          extracted.code.slice(0, 12000),
        ].join("\n"),
      },
    ], { temperature: 0.1, maxTokens: 700, jsonMode: true });
    return Array.isArray(result.variables) ? result.variables : [];
  }
}
