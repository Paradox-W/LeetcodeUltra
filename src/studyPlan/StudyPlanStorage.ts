import * as fs from "fs";
import * as path from "path";
import { ExtensionContext, workspace } from "vscode";
import { StudyPlanDocument } from "./StudyPlanTypes";

export interface StudyPlanLoadResult {
  document?: StudyPlanDocument;
  recoveredFromCorruption: boolean;
  backupPath?: string;
}
function ensureDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  ensureDirectory(filePath);
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  try {
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      fs.renameSync(temporaryPath, filePath);
      return;
    }
    throw error;
  } finally {
    if (fs.existsSync(temporaryPath)) {
      fs.unlinkSync(temporaryPath);
    }
  }
}

export function loadStudyPlanFile(filePath: string): StudyPlanLoadResult {
  if (!fs.existsSync(filePath)) {
    return { recoveredFromCorruption: false };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || parsed.schemaVersion !== 1 || !parsed.course || !parsed.progress || !parsed.assignments) {
      throw new Error("unsupported study plan document");
    }
    return { document: parsed as StudyPlanDocument, recoveredFromCorruption: false };
  } catch (_) {
    const backupPath = `${filePath}.corrupt-${Date.now()}.json`;
    fs.renameSync(filePath, backupPath);
    return { recoveredFromCorruption: true, backupPath };
  }
}

export function pruneReviewDrafts(
  directory: string,
  protectedPaths: string[],
  keepClosed = 3
): string[] {
  if (!fs.existsSync(directory)) {
    return [];
  }
  const protectedSet = new Set(protectedPaths.map((filePath) => path.resolve(filePath)));
  const candidates = fs.readdirSync(directory)
    .map((name) => path.join(directory, name))
    .filter((filePath) => fs.statSync(filePath).isFile() && !protectedSet.has(path.resolve(filePath)))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  const removed = candidates.slice(keepClosed);
  removed.forEach((filePath) => fs.unlinkSync(filePath));
  return removed;
}

export class StudyPlanStorage {
  public readonly filePath: string;

  constructor(private readonly context: ExtensionContext, explicitPath?: string) {
    const folder = workspace.workspaceFolders && workspace.workspaceFolders[0];
    this.filePath = explicitPath || (folder
      ? path.join(folder.uri.fsPath, ".lcpr_data", "study-plan.json")
      : path.join(context.globalStorageUri.fsPath, "study-plan.json"));
  }

  public load(): StudyPlanLoadResult {
    return loadStudyPlanFile(this.filePath);
  }

  public save(document: StudyPlanDocument): void {
    writeJsonAtomic(this.filePath, document);
  }

  public reset(): void {
    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath);
    }
  }

  public reviewDirectory(fid: string): string {
    return path.join(this.context.globalStorageUri.fsPath, "study-review", fid);
  }
}
