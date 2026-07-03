import { DiagramHighlight, LinkedListRow, LinkedListTransformDiagram } from "../DiagramTypes";

const NODE_RADIUS = 20;
const NODE_GAP = 56;
const ROW_GAP = 82;
const EDGE_COLOR = "var(--lcpr-diagram-edge, var(--lcpr-fg))";
const TEXT_COLOR = "var(--lcpr-diagram-text, var(--lcpr-fg))";

function escapeHtml(value: any): string {
  return String(value === undefined || value === null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char] || char));
}

function highlightMap(row: LinkedListRow): Map<number, DiagramHighlight> {
  const map = new Map<number, DiagramHighlight>();
  (row.highlights || []).forEach((highlight) => map.set(highlight.index, highlight));
  return map;
}

function toneFill(tone: string): string {
  switch (tone) {
    case "danger":
      return "var(--lcpr-diagram-danger, color-mix(in srgb, var(--vscode-testing-iconFailed, #f85149) 28%, transparent))";
    case "accent":
      return "var(--lcpr-diagram-accent, color-mix(in srgb, var(--vscode-textLink-foreground, #3794ff) 24%, transparent))";
    case "muted":
      return "var(--lcpr-diagram-muted-fill, var(--lcpr-input))";
    default:
      return "var(--lcpr-bg)";
  }
}

function renderRow(row: LinkedListRow, y: number, width: number): string {
  const count = row.nodes.length;
  const span = Math.max(0, (count - 1) * NODE_GAP);
  const startX = Math.max(NODE_RADIUS + 2, (width - span) / 2);
  const highlights = highlightMap(row);
  const edges = row.nodes.slice(0, -1).map((_node, index) => {
    const x1 = startX + index * NODE_GAP + NODE_RADIUS;
    const x2 = startX + (index + 1) * NODE_GAP - NODE_RADIUS - 3;
    return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${EDGE_COLOR}" stroke-width="2.2" marker-end="url(#lcpr-diagram-arrow)" />`;
  }).join("");
  const nodes = row.nodes.map((node, index) => {
    const x = startX + index * NODE_GAP;
    const highlight = highlights.get(index);
    const fill = highlight ? toneFill(highlight.tone) : "var(--lcpr-bg)";
    return `<g class="lcpr-diagram-node" transform="translate(${x} ${y})">
  <circle r="${NODE_RADIUS}" fill="${fill}" stroke="${EDGE_COLOR}" stroke-width="2.2" />
  <text text-anchor="middle" dominant-baseline="central" fill="${TEXT_COLOR}" font-size="16" font-weight="650">${escapeHtml(node)}</text>
</g>`;
  }).join("");
  return `${edges}${nodes}`;
}

function renderDownArrow(width: number, y1: number, y2: number): string {
  const x = width / 2;
  return `<path d="M ${x} ${y1} L ${x} ${y2 - 18} M ${x - 13} ${y2 - 18} L ${x} ${y2} L ${x + 13} ${y2 - 18}" fill="none" stroke="${EDGE_COLOR}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />`;
}

export function renderLinkedListTransform(diagram: LinkedListTransformDiagram): string {
  const maxNodes = Math.max(diagram.before.nodes.length, diagram.after.nodes.length);
  const width = Math.max(220, NODE_RADIUS * 2 + 24 + Math.max(0, maxNodes - 1) * NODE_GAP);
  const height = 150;
  const beforeY = 34;
  const afterY = beforeY + ROW_GAP;
  return `<svg class="lcpr-diagram-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="链表变化图" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <marker id="lcpr-diagram-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${EDGE_COLOR}" />
    </marker>
  </defs>
  ${renderRow(diagram.before, beforeY, width)}
  ${diagram.transition ? renderDownArrow(width, beforeY + NODE_RADIUS + 8, afterY - NODE_RADIUS - 8) : ""}
  ${renderRow(diagram.after, afterY, width)}
</svg>`;
}
