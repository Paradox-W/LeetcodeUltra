import { GridMarker, GridRow, VisualizationData } from "./VisualizationData";

function parseJsonCandidate(candidate: string): any | undefined {
  try {
    return JSON.parse(candidate);
  } catch (_) {
    return undefined;
  }
}

function unescapeDebuggerString(value: string): string {
  return value
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

function quotedPayload(value: string): string | undefined {
  const text = value.trim();
  const match = text.match(/(?:std::(?:basic_)?string|std::__\d+::(?:basic_)?string|data)\s*=\s*"([\s\S]*)"\s*$/);
  if (match) {
    return unescapeDebuggerString(match[1]);
  }
  const plain = text.match(/^"([\s\S]*)"$/);
  if (plain) {
    return unescapeDebuggerString(plain[1]);
  }
  const singleQuoted = text.match(/^'([\s\S]*)'$/);
  return singleQuoted ? unescapeDebuggerString(singleQuoted[1]) : undefined;
}

function jsonSubstring(value: string): string | undefined {
  const text = value.trim();
  const objectIndex = text.indexOf("{");
  const arrayIndex = text.indexOf("[");
  const indexes = [objectIndex, arrayIndex].filter((index) => index >= 0);
  if (!indexes.length) {
    return undefined;
  }
  return text.slice(Math.min.apply(undefined, indexes));
}

function candidatesFromDebuggerValue(value: any): string[] {
  const raw = String(value === undefined || value === null ? "" : value).trim();
  if (!raw) {
    return [];
  }
  const candidates: string[] = [raw];
  const quoted = quotedPayload(raw);
  if (quoted) {
    candidates.push(quoted);
  }
  const substring = jsonSubstring(raw);
  if (substring && substring !== raw) {
    candidates.push(substring);
  }
  candidates.slice().forEach((candidate) => {
    const unescaped = unescapeDebuggerString(candidate);
    if (unescaped !== candidate) {
      candidates.push(unescaped);
    }
  });
  return candidates.filter((candidate, index) => candidates.indexOf(candidate) === index);
}

export function parseDebuggerJsonValue(value: any): any | undefined {
  const seen = new Set<string>();
  const queue = candidatesFromDebuggerValue(value);
  for (let depth = 0; queue.length && depth < 24; depth++) {
    const candidate = queue.shift()!;
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    const parsed = parseJsonCandidate(candidate);
    if (parsed === undefined) {
      continue;
    }
    if (typeof parsed === "string") {
      candidatesFromDebuggerValue(parsed).forEach((next) => {
        if (!seen.has(next)) {
          queue.push(next);
        }
      });
      continue;
    }
    return parsed;
  }
  return undefined;
}

function normalizeRows(value: any): GridRow[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const rows: GridRow[] = [];
  value.forEach((row) => {
    const sourceColumns = row && Array.isArray(row.columns) ? row.columns : [];
    const columns = sourceColumns.map((column: any) => ({
      content: String(column && column.content !== undefined ? column.content : ""),
      tag: column && column.tag !== undefined ? String(column.tag) : undefined,
      color: column && column.color !== undefined ? String(column.color) : undefined,
    }));
    rows.push({
      label: row && row.label !== undefined ? String(row.label) : undefined,
      columns,
    });
  });
  return rows;
}

function normalizeMarkers(value: any): GridMarker[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const markers: GridMarker[] = [];
  value.forEach((marker, index) => {
    const row = Number(marker && marker.row);
    const column = Number(marker && marker.column);
    if (!Number.isFinite(row) || !Number.isFinite(column)) {
      return;
    }
    markers.push({
      id: marker && marker.id !== undefined ? String(marker.id) : `marker-${index}`,
      row,
      column,
      rows: marker && Number.isFinite(Number(marker.rows)) ? Number(marker.rows) : undefined,
      columns: marker && Number.isFinite(Number(marker.columns)) ? Number(marker.columns) : undefined,
      label: marker && marker.label !== undefined ? String(marker.label) : undefined,
      color: marker && marker.color !== undefined ? String(marker.color) : undefined,
    });
  });
  return markers.length ? markers : undefined;
}

export function normalizeVisualizationData(value: any): VisualizationData | undefined {
  if (!value || typeof value !== "object" || !value.kind || typeof value.kind !== "object") {
    return undefined;
  }
  if (value.kind.grid) {
    const rows = normalizeRows(value.rows);
    if (!rows) {
      return undefined;
    }
    const markers = normalizeMarkers(value.markers);
    const warnings = Array.isArray(value.warnings) ? value.warnings.map((warning: any) => String(warning)) : undefined;
    return markers ? { kind: { grid: true }, rows, markers, warnings } : { kind: { grid: true }, rows, warnings };
  }
  if (value.kind.text || value.kind.error) {
    const text = String(value.text === undefined ? "" : value.text);
    return value.kind.error ? { kind: { error: true }, text } : { kind: { text: true }, text };
  }
  return undefined;
}

export function parseVisualizationData(value: any): VisualizationData | undefined {
  return normalizeVisualizationData(parseDebuggerJsonValue(value));
}
