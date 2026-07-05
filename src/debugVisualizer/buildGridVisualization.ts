import { GridVisualizationData } from "./VisualizationData";

export interface IndexedDebugChild {
  name: string;
  value: string;
  type?: string;
}

function normalizeIndexName(name: string): string {
  return String(name || "").replace(/^\[(.*)\]$/, "$1");
}

function numericIndex(name: string): number {
  return Number(normalizeIndexName(name));
}

function preview(value: string, maxLength = 160): string {
  const text = String(value === undefined || value === null ? "" : value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export function buildArrayGridVisualization(children: IndexedDebugChild[], pageSize: number): GridVisualizationData | undefined {
  const indexed = children
    .filter((child) => Number.isFinite(numericIndex(child.name)))
    .sort((a, b) => numericIndex(a.name) - numericIndex(b.name))
    .slice(0, pageSize);
  if (!indexed.length) {
    return undefined;
  }
  return {
    kind: { grid: true },
    rows: [{
      columns: indexed.map((child) => ({
        content: preview(child.value),
        tag: normalizeIndexName(child.name),
      })),
    }],
  };
}

export function buildPreviewGridVisualization(items: string[], pageSize: number): GridVisualizationData | undefined {
  const trimmed = items.slice(0, pageSize);
  if (!trimmed.length) {
    return undefined;
  }
  return {
    kind: { grid: true },
    rows: [{
      columns: trimmed.map((item, index) => ({
        content: preview(item),
        tag: String(index),
      })),
    }],
  };
}

