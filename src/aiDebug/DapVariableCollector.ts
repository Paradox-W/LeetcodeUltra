import * as vscode from "vscode";
import { KeyVariable } from "./AiVariableAnalyzer";

export interface VisualNode {
  id: string;
  label: string;
  value?: string;
}

export interface VisualEdge {
  from: string;
  to: string;
  label?: string;
}

export interface VisualPayload {
  kind: { array?: boolean; list?: boolean; graph?: boolean; object?: boolean; text?: boolean };
  values?: Array<{ name: string; value: string; type?: string }>;
  nodes?: VisualNode[];
  edges?: VisualEdge[];
  text?: string;
}

export interface CollectedVariable {
  name: string;
  expression: string;
  declaredType?: string;
  runtimeType?: string;
  value: string;
  variablesReference: number;
  presentationHint?: any;
  visual: VisualPayload;
  error?: string;
}

export interface DapCollectOptions {
  language?: string;
  session?: vscode.DebugSession;
}

interface DapVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference?: number;
  presentationHint?: any;
  evaluateName?: string;
}

function normalizeChildName(name: string): string {
  return String(name || "").replace(/^\[(.*)\]$/, "$1");
}

function isIndexName(name: string): boolean {
  return /^\[?\d+\]?$/.test(String(name || ""));
}

function valuePreview(value: string, maxLength = 160): string {
  const text = String(value === undefined || value === null ? "" : value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

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

function boundedConfigNumber(key: string, fallback: number, min: number, max: number): number {
  const value = Number(getConfig().get<number>(key, fallback));
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function isCppLanguage(language?: string): boolean {
  return /^(c|cpp|c\+\+|cc|cxx)$/i.test(String(language || ""));
}

function isCppNullish(value: any): boolean {
  return /^(0x0+|0|null|nullptr|NULL)$/i.test(String(value === undefined || value === null ? "" : value).trim());
}

function stripCppStringQuotes(value: any): string {
  const text = String(value === undefined || value === null ? "" : value).trim();
  const match = text.match(/^"(.*)"$/s);
  return match ? match[1].replace(/\\"/g, "\"").replace(/\\\\/g, "\\") : text;
}

function splitCppPreviewItems(value: any): string[] {
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
      depth++;
    } else if (char === "}" || char === "]" || char === ")") {
      depth = Math.max(0, depth - 1);
    }
    if (char === "," && depth === 0) {
      if (current.trim()) {
        items.push(current.trim());
      }
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    items.push(current.trim());
  }
  return items;
}

function isCppStringType(typeText: string): boolean {
  return /\b(?:std::)?(?:string|basic_string)(?:<|\b)/i.test(typeText);
}

function isCppSequentialType(typeText: string): boolean {
  return /\b(?:std::)?(?:array|deque|list|priority_queue|queue|stack|vector)(?:<|\b)/i.test(typeText);
}

function isCppSetType(typeText: string): boolean {
  return /\b(?:std::)?(?:set|unordered_set|multiset|unordered_multiset)(?:<|\b)/i.test(typeText);
}

function isCppMapType(typeText: string): boolean {
  return /\b(?:std::)?(?:map|unordered_map|multimap|unordered_multimap)(?:<|\b)/i.test(typeText);
}

function parseCppPairPreview(value: any): { key: string; value: string } | undefined {
  const text = String(value === undefined || value === null ? "" : value).trim();
  if (!text) {
    return undefined;
  }
  const firstSecond = text.match(/\bfirst\s*[:=]\s*([^,}]+)[,\s]+second\s*[:=]\s*([^,}]+)/i);
  if (firstSecond) {
    return { key: stripCppStringQuotes(firstSecond[1].trim()), value: valuePreview(firstSecond[2].trim()) };
  }
  const bracketEntry = text.match(/^\[([^\]]+)\]\s*=\s*(.+)$/);
  if (bracketEntry) {
    return { key: stripCppStringQuotes(bracketEntry[1].trim()), value: valuePreview(bracketEntry[2].trim()) };
  }
  const items = splitCppPreviewItems(text);
  if (items.length >= 2) {
    return { key: stripCppStringQuotes(items[0]), value: valuePreview(items.slice(1).join(", ")) };
  }
  return undefined;
}

function parseDebuggerJsonResult(value: any): any | undefined {
  const raw = String(value === undefined || value === null ? "" : value).trim();
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "string") {
      try {
        return JSON.parse(parsed);
      } catch (_) {
        return parsed;
      }
    }
    return parsed;
  } catch (_) {
    return undefined;
  }
}

export class DapVariableCollector {
  public async collect(variables: KeyVariable[], options: DapCollectOptions = {}): Promise<{ variables: CollectedVariable[]; warnings: string[] }> {
    const session = options.session || vscode.debug.activeDebugSession;
    if (!session) {
      return {
        variables: variables.map((variable) => ({
          name: variable.name,
          expression: variable.expression || variable.name,
          declaredType: variable.type,
          runtimeType: variable.type,
          value: "未启动调试会话",
          variablesReference: 0,
          visual: { kind: { text: true }, text: "未启动调试会话。请先在断点处暂停，再运行 AI 调试。" },
          error: "未启动调试会话",
        })),
        warnings: ["未找到活动调试会话。"],
      };
    }

    const warnings: string[] = [];
    const frameIds = await this.resolveFrameIds(session);
    if (!frameIds.length) {
      return {
        variables: [],
        warnings: ["调试器没有返回可用栈帧。请确认程序已经停在断点或单步暂停状态。"],
      };
    }

    const output: CollectedVariable[] = [];
    const pageSize = boundedConfigNumber("aiDebug.childPageSize", 100, 10, 500);
    for (const variable of variables) {
      const expression = variable.expression || variable.name;
      try {
        const evaluatedWithFrame = await this.evaluateInFrames(session, expression, frameIds);
        const evaluated = evaluatedWithFrame.evaluated;
        const frameId = evaluatedWithFrame.frameId;
        const children = evaluated.variablesReference > 0
          ? await this.getChildren(session, evaluated.variablesReference, 0, pageSize)
          : [];
        const typeHint = `${variable.type || ""} ${variable.name || ""}`.toLowerCase();
        let jsonValue = await this.evaluateJsonValue(session, expression, frameId, options.language);
        let preferredVisual: VisualPayload | undefined;
        if (/javascript|typescript|js|ts/i.test(options.language || "") && /listnode|linked|head/.test(typeHint)) {
          const listValue = await this.evaluateJsListValue(session, expression, frameId);
          if (listValue !== undefined) {
            jsonValue = listValue;
          }
        }
        if (/javascript|typescript|js|ts/i.test(options.language || "") && /treenode|root|tree/.test(typeHint)) {
          const treeValue = await this.evaluateJsTreeValue(session, expression, frameId);
          if (treeValue !== undefined) {
            jsonValue = treeValue;
          }
          preferredVisual = await this.buildJsTreeFromExpressions(session, expression, frameId);
        }
        if (isCppLanguage(options.language) && /listnode|\bhead\b|\bnode\b/.test(typeHint)) {
          preferredVisual = await this.buildCppListFromExpressions(session, expression, frameId);
        }
        if (isCppLanguage(options.language) && /treenode|root|tree/.test(typeHint)) {
          preferredVisual = await this.buildCppTreeFromExpressions(session, expression, frameId);
        }
        output.push({
          name: variable.name,
          expression,
          declaredType: variable.type,
          runtimeType: evaluated.type,
          value: String(evaluated.result === undefined ? "" : evaluated.result),
          variablesReference: Number(evaluated.variablesReference || 0),
          presentationHint: evaluated.presentationHint,
          visual: await this.toVisualPayload(session, variable, evaluated, children, jsonValue, preferredVisual),
        });
      } catch (_) {
        warnings.push(`跳过 ${expression}：当前栈帧不可求值。`);
      }
    }
    return { variables: output, warnings };
  }

  private async evaluateInFrames(session: vscode.DebugSession, expression: string, frameIds: number[]): Promise<{ evaluated: any; frameId: number }> {
    let lastError: any;
    for (const frameId of frameIds) {
      try {
        const evaluated = await withTimeout(session.customRequest("evaluate", {
          expression,
          frameId,
          context: "watch",
        }), 1200);
        if (!evaluated) {
          throw new Error(`求值超时：${expression}`);
        }
        return { evaluated, frameId };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error(`无法求值 ${expression}`);
  }

  private async resolveFrameIds(session: vscode.DebugSession): Promise<number[]> {
    const frameIds: number[] = [];
    const threadIds = await this.resolveThreadIds(session);
    for (const threadId of threadIds) {
      try {
        const stack = await withTimeout(session.customRequest("stackTrace", { threadId, startFrame: 0, levels: 20 }), 1000);
        const frames = stack && Array.isArray(stack.stackFrames) ? stack.stackFrames : [];
        frames.forEach((frame: any) => {
          if (frame && Number.isFinite(Number(frame.id))) {
            frameIds.push(Number(frame.id));
          }
        });
      } catch (_) {
        // Try the next thread, or fall back to thread 1.
      }
    }
    return frameIds;
  }

  private async resolveThreadIds(session: vscode.DebugSession): Promise<number[]> {
    try {
      const threads = await withTimeout(session.customRequest("threads", {}), 1000);
      const ids = (threads && threads.threads || []).map((thread: any) => Number(thread.id)).filter((id: number) => Number.isFinite(id));
      return ids.length ? ids : [1];
    } catch (_) {
      return [1];
    }
  }

  private async getChildren(session: vscode.DebugSession, variablesReference: number, start = 0, count = 100): Promise<DapVariable[]> {
    if (!variablesReference) {
      return [];
    }
    const response = await withTimeout(session.customRequest("variables", {
      variablesReference,
      filter: undefined,
      start,
      count,
    }), 1200);
    return response && Array.isArray(response.variables) ? response.variables : [];
  }

  private async toVisualPayload(
    session: vscode.DebugSession,
    keyVariable: KeyVariable,
    evaluated: any,
    children: DapVariable[],
    jsonValue?: any,
    preferredVisual?: VisualPayload
  ): Promise<VisualPayload> {
    const typeText = `${keyVariable.type || ""} ${evaluated.type || ""} ${keyVariable.name || ""}`.toLowerCase();
    if (preferredVisual) {
      return preferredVisual;
    }
    if (isCppStringType(typeText)) {
      return { kind: { text: true }, text: stripCppStringQuotes(evaluated.result) };
    }
    if (isCppMapType(typeText)) {
      const mapVisual = await this.buildCppMapVisual(session, children, evaluated.result);
      if (mapVisual) {
        return mapVisual;
      }
    }
    const indexedChildren = children.filter((child) => isIndexName(child.name));
    if (indexedChildren.length && (indexedChildren.length === children.length || /\b(array|vector)\b|std::(?:array|vector)|\[[^\]]*\]/i.test(`${typeText} ${evaluated.result || ""}`))) {
      return {
        kind: { array: true },
        values: indexedChildren.map((child) => ({
          name: normalizeChildName(child.name),
          value: valuePreview(child.value),
          type: child.type,
        })),
      };
    }
    if (isCppSetType(typeText) || isCppSequentialType(typeText)) {
      const sequenceVisual = this.buildCppSequenceVisual(children, evaluated.result);
      if (sequenceVisual) {
        return sequenceVisual;
      }
    }
    const fromJson = this.toVisualPayloadFromJson(typeText, jsonValue);
    if (fromJson && (fromJson.kind.list || fromJson.kind.graph)) {
      if (!fromJson.kind.graph || (fromJson.edges && fromJson.edges.length)) {
        return fromJson;
      }
    }
    if (children.length && /listnode|\bhead\b|\bnode\b/.test(typeText)) {
      const list = await this.buildList(session, evaluated.variablesReference);
      if (list.nodes.length) {
        return { kind: { list: true }, nodes: list.nodes, edges: list.edges };
      }
    }
    if (children.length && /treenode|root|tree/.test(typeText)) {
      const graph = await this.buildTree(session, evaluated.variablesReference);
      if (graph.nodes.length > 1 || graph.edges.length) {
        return { kind: { graph: true }, nodes: graph.nodes, edges: graph.edges };
      }
      const previewGraph = this.buildTreeFromPreview(evaluated.result);
      if (previewGraph) {
        return previewGraph;
      }
      if (graph.nodes.length) {
        return { kind: { graph: true }, nodes: graph.nodes, edges: graph.edges };
      }
    }
    if (children.length) {
      return {
        kind: { object: true },
        values: children.map((child) => ({
          name: child.name,
          value: valuePreview(child.value),
          type: child.type,
        })),
      };
    }
    if (fromJson) {
      return fromJson;
    }
    return {
      kind: { text: true },
      text: valuePreview(evaluated.result),
    };
  }

  private async evaluateJsonValue(session: vscode.DebugSession, expression: string, frameId: number, language?: string): Promise<any | undefined> {
    const normalized = String(language || "").toLowerCase();
    const jsonExpression = /javascript|typescript|js|ts/.test(normalized) ? `JSON.stringify(${expression})` : "";
    if (!jsonExpression) {
      return undefined;
    }
    try {
      const response = await withTimeout(session.customRequest("evaluate", {
        expression: jsonExpression,
        frameId,
        context: "watch",
      }), 1200);
      return parseDebuggerJsonResult(response && response.result);
    } catch (_) {
      return undefined;
    }
  }

  private async evaluateJsListValue(session: vscode.DebugSession, expression: string, frameId: number): Promise<any | undefined> {
    const maxNodes = boundedConfigNumber("aiDebug.maxListNodes", 50, 5, 200);
    const safeExpression = `(() => {
      const seen = new Set();
      let source = ${expression};
      let root = null;
      let tail = null;
      for (let index = 0; source && typeof source === "object" && !seen.has(source) && index < ${maxNodes}; index++) {
        seen.add(source);
        const copy = { val: source.val ?? source.value ?? source.data, next: null };
        if (!root) root = copy;
        if (tail) tail.next = copy;
        tail = copy;
        source = source.next;
      }
      return JSON.stringify(root);
    })()`;
    try {
      const response = await withTimeout(session.customRequest("evaluate", {
        expression: safeExpression,
        frameId,
        context: "watch",
      }), 1200);
      return parseDebuggerJsonResult(response && response.result);
    } catch (_) {
      return undefined;
    }
  }

  private async evaluateJsTreeValue(session: vscode.DebugSession, expression: string, frameId: number): Promise<any | undefined> {
    const maxNodes = boundedConfigNumber("aiDebug.maxTreeNodes", 80, 5, 300);
    const safeExpression = `(() => {
      const seen = new Set();
      let count = 0;
      const clone = (source) => {
        if (!source || typeof source !== "object" || seen.has(source) || count >= ${maxNodes}) return null;
        seen.add(source);
        count++;
        return {
          val: source.val ?? source.value ?? source.data,
          left: clone(source.left),
          right: clone(source.right)
        };
      };
      return JSON.stringify(clone(${expression}));
    })()`;
    try {
      const response = await withTimeout(session.customRequest("evaluate", {
        expression: safeExpression,
        frameId,
        context: "watch",
      }), 1200);
      return parseDebuggerJsonResult(response && response.result);
    } catch (_) {
      return undefined;
    }
  }

  private async buildJsTreeFromExpressions(session: vscode.DebugSession, expression: string, frameId: number): Promise<VisualPayload | undefined> {
    const nodes: VisualNode[] = [];
    const edges: VisualEdge[] = [];
    const queue: Array<{ expression: string; id: string; depth: number }> = [{ expression, id: "root", depth: 0 }];
    const maxNodes = boundedConfigNumber("aiDebug.maxTreeNodes", 80, 5, 300);
    const seen = new Set<string>();
    while (queue.length && nodes.length < maxNodes) {
      const item = queue.shift()!;
      if (seen.has(item.expression) || item.depth > 8) {
        continue;
      }
      seen.add(item.expression);
      const summary = await this.evaluateJsTreeNodeSummary(session, item.expression, frameId);
      if (!summary || !summary.exists) {
        continue;
      }
      nodes.push({ id: item.id, label: item.id, value: valuePreview(String(summary.value === undefined || summary.value === null ? "" : summary.value)) });
      (["left", "right"] as const).forEach((side) => {
        if (!summary[side]) {
          return;
        }
        const childId = `${item.id}-${side}`;
        edges.push({ from: item.id, to: childId, label: side });
        queue.push({ expression: `(${item.expression}).${side}`, id: childId, depth: item.depth + 1 });
      });
    }
    return nodes.length ? { kind: { graph: true }, nodes, edges } : undefined;
  }

  private async evaluateJsTreeNodeSummary(session: vscode.DebugSession, expression: string, frameId: number): Promise<{ exists: boolean; value?: any; left?: boolean; right?: boolean } | undefined> {
    const target = `(${expression})`;
    const valueExpression = `(${target}.val !== undefined ? ${target}.val : (${target}.value !== undefined ? ${target}.value : ${target}.data))`;
    const summaryExpression = `JSON.stringify({exists:!!${target}&&typeof ${target}==="object",value:${target}?${valueExpression}:undefined,left:!!(${target}&&${target}.left),right:!!(${target}&&${target}.right)})`;
    try {
      const response = await withTimeout(session.customRequest("evaluate", {
        expression: summaryExpression,
        frameId,
        context: "watch",
      }), 1200);
      const parsed = parseDebuggerJsonResult(response && response.result);
      return parsed && typeof parsed === "object" ? parsed : undefined;
    } catch (_) {
      return undefined;
    }
  }

  private async buildCppListFromExpressions(session: vscode.DebugSession, expression: string, frameId: number): Promise<VisualPayload | undefined> {
    const nodes: VisualNode[] = [];
    const edges: VisualEdge[] = [];
    const maxNodes = boundedConfigNumber("aiDebug.maxListNodes", 50, 5, 200);
    let current = expression;
    const seen = new Set<string>();
    for (let index = 0; current && index < maxNodes && !seen.has(current); index++) {
      seen.add(current);
      const nodeEval = await this.evaluateFirst(session, this.cppNodeExpressions(current), frameId);
      if (!nodeEval || isCppNullish(nodeEval.result)) {
        break;
      }
      const valueEval = await this.evaluateFirst(session, this.cppFieldExpressions(current, "val"), frameId)
        || await this.evaluateFirst(session, this.cppFieldExpressions(current, "value"), frameId)
        || await this.evaluateFirst(session, this.cppFieldExpressions(current, "data"), frameId);
      const id = `node-${index}`;
      nodes.push({ id, label: String(index), value: valuePreview(valueEval ? valueEval.result : nodeEval.result) });
      if (index > 0) {
        edges.push({ from: `node-${index - 1}`, to: id, label: "next" });
      }
      const nextExpression = this.cppFieldExpressions(current, "next")[0];
      const nextEval = await this.evaluateFirst(session, this.cppFieldExpressions(current, "next"), frameId);
      if (!nextEval || isCppNullish(nextEval.result)) {
        break;
      }
      current = nextEval.evaluateName || nextExpression;
    }
    return nodes.length ? { kind: { list: true }, nodes, edges } : undefined;
  }

  private async buildCppTreeFromExpressions(session: vscode.DebugSession, expression: string, frameId: number): Promise<VisualPayload | undefined> {
    const nodes: VisualNode[] = [];
    const edges: VisualEdge[] = [];
    const maxNodes = boundedConfigNumber("aiDebug.maxTreeNodes", 80, 5, 300);
    const queue: Array<{ expression: string; id: string; depth: number }> = [{ expression, id: "root", depth: 0 }];
    const seen = new Set<string>();
    while (queue.length && nodes.length < maxNodes) {
      const item = queue.shift()!;
      if (!item.expression || seen.has(item.expression) || item.depth > 8) {
        continue;
      }
      seen.add(item.expression);
      const nodeEval = await this.evaluateFirst(session, this.cppNodeExpressions(item.expression), frameId);
      if (!nodeEval || isCppNullish(nodeEval.result)) {
        continue;
      }
      const valueEval = await this.evaluateFirst(session, this.cppFieldExpressions(item.expression, "val"), frameId)
        || await this.evaluateFirst(session, this.cppFieldExpressions(item.expression, "value"), frameId)
        || await this.evaluateFirst(session, this.cppFieldExpressions(item.expression, "data"), frameId);
      nodes.push({ id: item.id, label: item.id, value: valuePreview(valueEval ? valueEval.result : nodeEval.result) });
      (["left", "right"] as const).forEach((side) => {
        const childExpressions = this.cppFieldExpressions(item.expression, side);
        const childExpression = childExpressions[0];
        edges.push({ from: item.id, to: `${item.id}-${side}`, label: side });
        queue.push({ expression: childExpression, id: `${item.id}-${side}`, depth: item.depth + 1 });
      });
    }
    const liveNodeIds = new Set(nodes.map((node) => node.id));
    const liveEdges = edges.filter((edge) => liveNodeIds.has(edge.from) && liveNodeIds.has(edge.to));
    return nodes.length ? { kind: { graph: true }, nodes, edges: liveEdges } : undefined;
  }

  private buildCppSequenceVisual(children: DapVariable[], preview: any): VisualPayload | undefined {
    const pageSize = boundedConfigNumber("aiDebug.childPageSize", 100, 10, 500);
    const indexedChildren = children.filter((child) => isIndexName(child.name));
    if (indexedChildren.length) {
      return {
        kind: { array: true },
        values: indexedChildren.slice(0, pageSize).map((child, index) => ({
          name: isIndexName(child.name) ? normalizeChildName(child.name) : String(index),
          value: valuePreview(child.value),
          type: child.type,
        })),
      };
    }
    const items = splitCppPreviewItems(preview);
    if (items.length > 1 || /^\{/.test(String(preview || "").trim())) {
      return {
        kind: { array: true },
        values: items.slice(0, pageSize).map((item, index) => ({
          name: String(index),
          value: valuePreview(item),
        })),
      };
    }
    return undefined;
  }

  private async buildCppMapVisual(session: vscode.DebugSession, children: DapVariable[], preview: any): Promise<VisualPayload | undefined> {
    const pageSize = boundedConfigNumber("aiDebug.childPageSize", 100, 10, 500);
    const values: Array<{ name: string; value: string; type?: string }> = [];
    for (const child of children.slice(0, pageSize)) {
      const parsed = parseCppPairPreview(child.value);
      if (parsed) {
        values.push({ name: parsed.key, value: parsed.value, type: child.type });
        continue;
      }
      if (child.variablesReference) {
        const pairChildren = await this.getChildren(session, Number(child.variablesReference), 0, pageSize);
        const keyChild = pairChildren.find((candidate) => /^(first|key)$/i.test(candidate.name));
        const valueChild = pairChildren.find((candidate) => /^(second|value|mapped)$/i.test(candidate.name));
        if (keyChild && valueChild) {
          values.push({
            name: stripCppStringQuotes(keyChild.value),
            value: valuePreview(valueChild.value),
            type: valueChild.type || child.type,
          });
          continue;
        }
      }
      if (isIndexName(child.name)) {
        values.push({ name: normalizeChildName(child.name), value: valuePreview(child.value), type: child.type });
      }
    }
    if (!values.length) {
      const items = splitCppPreviewItems(preview)
        .map((item) => parseCppPairPreview(item))
        .filter(Boolean) as Array<{ key: string; value: string }>;
      items.slice(0, pageSize).forEach((item) => values.push({ name: item.key, value: item.value }));
    }
    return values.length ? { kind: { object: true }, values } : undefined;
  }

  private cppNodeExpressions(expression: string): string[] {
    const base = String(expression || "").trim();
    return [base, `*(${base})`];
  }

  private cppFieldExpressions(expression: string, field: string): string[] {
    const base = String(expression || "").trim();
    return [`(${base})->${field}`, `(${base}).${field}`, `(*(${base})).${field}`];
  }

  private async evaluateFirst(session: vscode.DebugSession, expressions: string[], frameId: number): Promise<any | undefined> {
    for (const expression of expressions) {
      try {
        const response = await withTimeout(session.customRequest("evaluate", {
          expression,
          frameId,
          context: "watch",
        }), 1200);
        if (!response) {
          throw new Error(`求值超时：${expression}`);
        }
        return Object.assign({}, response, { evaluateName: response && (response.evaluateName || expression) });
      } catch (_) {
        // Try the next expression form; C++ adapters differ on pointer vs value syntax.
      }
    }
    return undefined;
  }

  private toVisualPayloadFromJson(typeText: string, value: any): VisualPayload | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (Array.isArray(value)) {
      return {
        kind: { array: true },
        values: value.slice(0, boundedConfigNumber("aiDebug.childPageSize", 100, 10, 500)).map((item, index) => ({
          name: String(index),
          value: valuePreview(typeof item === "object" ? JSON.stringify(item) : String(item)),
        })),
      };
    }
    if (value && typeof value === "object") {
      if (/listnode|linked|head/.test(typeText)) {
        const list = this.buildListFromObject(value);
        if (list.nodes.length) {
          return { kind: { list: true }, nodes: list.nodes, edges: list.edges };
        }
      }
      if (/treenode|root|tree/.test(typeText)) {
        const graph = this.buildTreeFromObject(value);
        if (graph.nodes.length) {
          return { kind: { graph: true }, nodes: graph.nodes, edges: graph.edges };
        }
      }
      return {
        kind: { object: true },
        values: Object.keys(value).slice(0, boundedConfigNumber("aiDebug.childPageSize", 100, 10, 500)).map((name) => ({
          name,
          value: valuePreview(typeof value[name] === "object" ? JSON.stringify(value[name]) : String(value[name])),
        })),
      };
    }
    return { kind: { text: true }, text: valuePreview(String(value)) };
  }

  private buildTreeFromPreview(value: any): VisualPayload | undefined {
    const text = String(value === undefined || value === null ? "" : value);
    const hasLeft = /\bleft\s*:/i.test(text) && !/\bleft\s*:\s*(null|undefined)/i.test(text);
    const hasRight = /\bright\s*:/i.test(text) && !/\bright\s*:\s*(null|undefined)/i.test(text);
    if (!hasLeft && !hasRight) {
      return undefined;
    }
    const rootValue = text.match(/\b(?:val|value|data)\s*:\s*([^,\]}]+)/i);
    const nodes: VisualNode[] = [{ id: "root", label: "root", value: valuePreview(rootValue ? rootValue[1].trim() : text) }];
    const edges: VisualEdge[] = [];
    if (hasLeft) {
      nodes.push({ id: "root-left", label: "root-left", value: "..." });
      edges.push({ from: "root", to: "root-left", label: "left" });
    }
    if (hasRight) {
      nodes.push({ id: "root-right", label: "root-right", value: "..." });
      edges.push({ from: "root", to: "root-right", label: "right" });
    }
    return { kind: { graph: true }, nodes, edges };
  }

  private async buildList(session: vscode.DebugSession, rootReference: number): Promise<{ nodes: VisualNode[]; edges: VisualEdge[] }> {
    const nodes: VisualNode[] = [];
    const edges: VisualEdge[] = [];
    let reference = rootReference;
    const seen = new Set<number>();
    const maxNodes = boundedConfigNumber("aiDebug.maxListNodes", 50, 5, 200);
    for (let index = 0; reference && index < maxNodes && !seen.has(reference); index++) {
      seen.add(reference);
      const children = await this.getChildren(session, reference, 0, boundedConfigNumber("aiDebug.childPageSize", 100, 10, 500));
      const valueChild = children.find((child) => /^(val|value|data)$/i.test(child.name));
      const nextChild = children.find((child) => /^next$/i.test(child.name));
      const id = `node-${index}`;
      nodes.push({ id, label: String(index), value: valuePreview(valueChild ? valueChild.value : "") });
      if (index > 0) {
        edges.push({ from: `node-${index - 1}`, to: id, label: "next" });
      }
      reference = nextChild && nextChild.variablesReference ? Number(nextChild.variablesReference) : 0;
      if (!reference || /null|nil|none/i.test(nextChild ? nextChild.value : "")) {
        break;
      }
    }
    return { nodes, edges };
  }

  private buildListFromObject(root: any): { nodes: VisualNode[]; edges: VisualEdge[] } {
    const nodes: VisualNode[] = [];
    const edges: VisualEdge[] = [];
    const seen = new Set<any>();
    let current = root;
    const maxNodes = boundedConfigNumber("aiDebug.maxListNodes", 50, 5, 200);
    for (let index = 0; current && typeof current === "object" && index < maxNodes && !seen.has(current); index++) {
      seen.add(current);
      const id = `node-${index}`;
      nodes.push({ id, label: String(index), value: valuePreview(String(current.val === undefined ? current.value === undefined ? current.data === undefined ? "" : current.data : current.value : current.val)) });
      if (index > 0) {
        edges.push({ from: `node-${index - 1}`, to: id, label: "next" });
      }
      current = current.next;
    }
    return { nodes, edges };
  }

  private async buildTree(session: vscode.DebugSession, rootReference: number): Promise<{ nodes: VisualNode[]; edges: VisualEdge[] }> {
    const nodes: VisualNode[] = [];
    const edges: VisualEdge[] = [];
    const queue: Array<{ reference: number; id: string; depth: number }> = [{ reference: rootReference, id: "root", depth: 0 }];
    const seen = new Set<number>();
    const maxNodes = boundedConfigNumber("aiDebug.maxTreeNodes", 80, 5, 300);
    const pageSize = boundedConfigNumber("aiDebug.childPageSize", 100, 10, 500);
    while (queue.length && nodes.length < maxNodes) {
      const item = queue.shift()!;
      if (!item.reference || seen.has(item.reference) || item.depth > 8) {
        continue;
      }
      seen.add(item.reference);
      const children = await this.getChildren(session, item.reference, 0, pageSize);
      const valueChild = children.find((child) => /^(val|value|data)$/i.test(child.name));
      nodes.push({ id: item.id, label: item.id, value: valuePreview(valueChild ? valueChild.value : "") });
      ["left", "right"].forEach((name) => {
        const child = children.find((candidate) => candidate.name === name);
        if (!child || /null|nil|none|undefined/i.test(child.value)) {
          return;
        }
        const childId = `${item.id}-${name}`;
        edges.push({ from: item.id, to: childId, label: name });
        if (child.variablesReference) {
          queue.push({ reference: Number(child.variablesReference), id: childId, depth: item.depth + 1 });
        } else {
          nodes.push({ id: childId, label: childId, value: valuePreview(child.value) });
        }
      });
    }
    return { nodes, edges };
  }

  private buildTreeFromObject(root: any): { nodes: VisualNode[]; edges: VisualEdge[] } {
    const nodes: VisualNode[] = [];
    const edges: VisualEdge[] = [];
    const queue: Array<{ node: any; id: string; depth: number }> = [{ node: root, id: "root", depth: 0 }];
    const seen = new Set<any>();
    const maxNodes = boundedConfigNumber("aiDebug.maxTreeNodes", 80, 5, 300);
    while (queue.length && nodes.length < maxNodes) {
      const item = queue.shift()!;
      if (!item.node || typeof item.node !== "object" || seen.has(item.node) || item.depth > 8) {
        continue;
      }
      seen.add(item.node);
      const value = item.node.val === undefined ? item.node.value === undefined ? item.node.data === undefined ? "" : item.node.data : item.node.value : item.node.val;
      nodes.push({ id: item.id, label: item.id, value: valuePreview(String(value)) });
      ["left", "right"].forEach((name) => {
        const child = item.node[name];
        if (!child || typeof child !== "object") {
          return;
        }
        const childId = `${item.id}-${name}`;
        edges.push({ from: item.id, to: childId, label: name });
        queue.push({ node: child, id: childId, depth: item.depth + 1 });
      });
    }
    return { nodes, edges };
  }
}
