import { DiagramSpec } from "./DiagramTypes";
import { renderLinkedListTransform } from "./renderers/linkedListTransform";
import { validateDiagramPack } from "./DiagramValidation";

export function renderDiagram(diagram: DiagramSpec): string {
  if (diagram.type === "linkedListTransform") {
    return renderLinkedListTransform(diagram);
  }
  return "";
}

export function sanitizeRenderedSvg(svg: string): string {
  const value = String(svg || "");
  if (!value.trim()) {
    return "";
  }
  if (/<script\b/i.test(value) || /\son[a-z]+\s*=/i.test(value) || /\b(?:href|src)\s*=\s*["']https?:/i.test(value)) {
    return "";
  }
  return value;
}

export function renderDiagramPackPreview(pack: any): string {
  const validation = validateDiagramPack(pack);
  if (!validation.ok) {
    return "";
  }
  return pack.replacements.map((replacement: any) => sanitizeRenderedSvg(renderDiagram(replacement.diagram))).join("\n");
}
