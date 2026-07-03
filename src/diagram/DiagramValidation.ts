import {
  DiagramReplacement,
  DiagramSpec,
  DiagramValidationIssue,
  DiagramValidationResult,
  LinkedListRow,
} from "./DiagramTypes";

function isObject(value: any): value is { [key: string]: any } {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function push(issues: DiagramValidationIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

function validateNodeList(value: any, path: string, issues: DiagramValidationIssue[]): void {
  if (!Array.isArray(value) || !value.length) {
    push(issues, path, "must be a non-empty array");
    return;
  }
  value.forEach((node, index) => {
    if (typeof node !== "string" && typeof node !== "number") {
      push(issues, `${path}[${index}]`, "must be a string or number");
    }
  });
}

function validateHighlights(row: LinkedListRow, path: string, issues: DiagramValidationIssue[]): void {
  if (row.highlights === undefined) {
    return;
  }
  if (!Array.isArray(row.highlights)) {
    push(issues, `${path}.highlights`, "must be an array");
    return;
  }
  row.highlights.forEach((highlight, index) => {
    const base = `${path}.highlights[${index}]`;
    if (!isObject(highlight)) {
      push(issues, base, "must be an object");
      return;
    }
    if (!Number.isInteger(highlight.index)) {
      push(issues, `${base}.index`, "must be an integer");
    } else if (highlight.index < 0 || highlight.index >= row.nodes.length) {
      push(issues, `${base}.index`, "is outside the node list");
    }
    if (!["danger", "accent", "muted"].includes(String(highlight.tone))) {
      push(issues, `${base}.tone`, "must be danger, accent, or muted");
    }
  });
}

function validateLinkedListRow(value: any, path: string, issues: DiagramValidationIssue[]): void {
  if (!isObject(value)) {
    push(issues, path, "must be an object");
    return;
  }
  validateNodeList(value.nodes, `${path}.nodes`, issues);
  if (Array.isArray(value.nodes)) {
    validateHighlights(value as LinkedListRow, path, issues);
  }
}

function validateDiagram(diagram: any, path: string, issues: DiagramValidationIssue[]): void {
  if (!isObject(diagram)) {
    push(issues, path, "must be an object");
    return;
  }
  if (diagram.type !== "linkedListTransform") {
    push(issues, `${path}.type`, "must be linkedListTransform");
    return;
  }
  validateLinkedListRow(diagram.before, `${path}.before`, issues);
  validateLinkedListRow(diagram.after, `${path}.after`, issues);
  if (diagram.transition !== undefined) {
    if (!isObject(diagram.transition)) {
      push(issues, `${path}.transition`, "must be an object");
    } else if (diagram.transition.type !== "downArrow") {
      push(issues, `${path}.transition.type`, "must be downArrow");
    }
  }
}

function validateReplacement(replacement: DiagramReplacement, path: string, issues: DiagramValidationIssue[]): void {
  if (!isObject(replacement)) {
    push(issues, path, "must be an object");
    return;
  }
  if (!isObject(replacement.match)) {
    push(issues, `${path}.match`, "must be an object");
  } else {
    const hasImage = typeof replacement.match.imageSrcIncludes === "string" && replacement.match.imageSrcIncludes.trim().length > 0;
    const hasExample = Number.isInteger(replacement.match.example);
    if (!hasImage && !hasExample) {
      push(issues, `${path}.match`, "must include imageSrcIncludes or example");
    }
    if (replacement.match.example !== undefined && (!Number.isInteger(replacement.match.example) || replacement.match.example < 1)) {
      push(issues, `${path}.match.example`, "must be a positive integer");
    }
  }
  validateDiagram(replacement.diagram as DiagramSpec, `${path}.diagram`, issues);
}

export function validateDiagramPack(pack: any): DiagramValidationResult {
  const issues: DiagramValidationIssue[] = [];
  if (!isObject(pack)) {
    return { ok: false, issues: [{ path: "$", message: "must be an object" }] };
  }
  if (pack.version !== 1) {
    push(issues, "$.version", "must be 1");
  }
  if (!isObject(pack.problem)) {
    push(issues, "$.problem", "must be an object");
  } else if (typeof pack.problem.qid !== "string" || !pack.problem.qid.trim()) {
    push(issues, "$.problem.qid", "must be a non-empty string");
  }
  if (!Array.isArray(pack.replacements)) {
    push(issues, "$.replacements", "must be an array");
  } else {
    pack.replacements.forEach((replacement: DiagramReplacement, index: number) => {
      validateReplacement(replacement, `$.replacements[${index}]`, issues);
    });
  }
  return { ok: issues.length === 0, issues };
}
