export type DiagramTone = "danger" | "accent" | "muted";

export interface DiagramProblemRef {
  qid: string;
  slug?: string;
  title?: string;
}

export interface DiagramImageMatch {
  imageSrcIncludes?: string;
  example?: number;
}

export interface DiagramReplacement {
  match: DiagramImageMatch;
  diagram: DiagramSpec;
}

export interface DiagramPack {
  version: 1;
  problem: DiagramProblemRef;
  replacements: DiagramReplacement[];
}

export interface DiagramHighlight {
  index: number;
  tone: DiagramTone;
}

export interface LinkedListRow {
  nodes: Array<string | number>;
  highlights?: DiagramHighlight[];
}

export interface LinkedListTransition {
  type: "downArrow";
  fromIndex?: number;
  toIndex?: number;
}

export interface LinkedListTransformDiagram {
  type: "linkedListTransform";
  before: LinkedListRow;
  after: LinkedListRow;
  transition?: LinkedListTransition;
}

export type DiagramSpec = LinkedListTransformDiagram;

export interface DiagramImageCandidate {
  src: string;
  alt?: string;
  example?: number;
  index: number;
}

export interface DiagramValidationIssue {
  path: string;
  message: string;
}

export interface DiagramValidationResult {
  ok: boolean;
  issues: DiagramValidationIssue[];
}
