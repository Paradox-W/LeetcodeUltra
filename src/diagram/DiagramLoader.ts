import * as fse from "fs-extra";
import * as path from "path";
import { DiagramImageCandidate, DiagramPack, DiagramReplacement } from "./DiagramTypes";
import { validateDiagramPack } from "./DiagramValidation";

let packCache: Map<string, DiagramPack | undefined> = new Map();

function diagramsRoot(): string {
  return path.join(__dirname, "..", "..", "..", "resources", "diagrams");
}

function normalizeProblemId(value: any): string {
  return String(value || "").trim();
}

function packFileCandidates(problem: { qid?: any; id?: any; fid?: any; slug?: any; name?: any }): string[] {
  const qid = normalizeProblemId(problem.qid || problem.id || problem.fid);
  if (!qid) {
    return [];
  }
  const slug = String(problem.slug || problem.name || "").trim().replace(/[^a-z0-9-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  const names = slug ? [`${qid}.${slug}.json`, `${qid}.json`] : [`${qid}.json`];
  const root = diagramsRoot();
  const exact = names.map((name) => path.join(root, name));
  try {
    const prefixed = fse.readdirSync(root)
      .filter((name) => name === `${qid}.json` || (name.startsWith(`${qid}.`) && name.endsWith(".json")))
      .map((name) => path.join(root, name));
    return [...new Set(exact.concat(prefixed))];
  } catch (_) {
    return exact;
  }
}

export function loadDiagramPack(problem: { qid?: any; id?: any; fid?: any; slug?: any; name?: any }): DiagramPack | undefined {
  const files = packFileCandidates(problem);
  for (const filePath of files) {
    if (packCache.has(filePath)) {
      const cached = packCache.get(filePath);
      if (cached) {
        return cached;
      }
      continue;
    }
    try {
      if (!fse.existsSync(filePath)) {
        packCache.set(filePath, undefined);
        continue;
      }
      const pack = fse.readJsonSync(filePath);
      const validation = validateDiagramPack(pack);
      if (!validation.ok) {
        packCache.set(filePath, undefined);
        continue;
      }
      packCache.set(filePath, pack as DiagramPack);
      return pack as DiagramPack;
    } catch (_) {
      packCache.set(filePath, undefined);
    }
  }
  return undefined;
}

function replacementMatches(replacement: DiagramReplacement, image: DiagramImageCandidate): boolean {
  const match = replacement.match || {};
  const srcOk = !match.imageSrcIncludes || image.src.includes(match.imageSrcIncludes);
  const exampleOk = !match.example || image.example === match.example;
  return srcOk && exampleOk;
}

export function findDiagramReplacement(pack: DiagramPack | undefined, image: DiagramImageCandidate): DiagramReplacement | undefined {
  if (!pack || !Array.isArray(pack.replacements)) {
    return undefined;
  }
  return pack.replacements.find((replacement) => replacementMatches(replacement, image));
}
