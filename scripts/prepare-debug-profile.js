const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const home = os.homedir();
const debugUserData = path.join(repoRoot, ".vscode-test", "user-data");
const debugExtensions = path.join(repoRoot, ".vscode-test", "extensions");
const debugUserDir = path.join(debugUserData, "User");
const debugSettingsPath = path.join(debugUserDir, "settings.json");
const mainCodeUserDir = path.join(home, "Library", "Application Support", "Code", "User");
const mainSettingsPath = path.join(mainCodeUserDir, "settings.json");
const mainGlobalStorage = path.join(mainCodeUserDir, "globalStorage");
const debugGlobalStorage = path.join(debugUserDir, "globalStorage");
const mainExtensions = path.join(home, ".vscode", "extensions");
const leetcodeWorkspace = "/Users/paradox/Documents/Leetcode";
const syncMarkerName = ".lcpr-sync-complete.json";
const forceRefreshExtensions = process.env.LCPR_REFRESH_DEBUG_EXTENSIONS === "1";

const extensionStorageIds = [
  "paradox.leetcodeultra",
  "ccagml.vscode-leetcode-problem-rating",
  "paradox.vscode-leetcode-problem-rating-plus",
];

const requiredExtensionIds = [
  "leetcode.vscode-leetcode",
  "ms-vscode.cpptools",
  "vadimcn.vscode-lldb",
];

async function materializeDatalessFiles(root) {
  if (!fs.existsSync(root)) {
    return;
  }
  const pending = [root];
  const datalessFiles = [];
  let nextFile = 0;
  let materializedFiles = 0;
  let materializedBytes = 0;
  const startedAt = Date.now();
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const stat = fs.statSync(entryPath);
      if (stat.size === 0 || stat.blocks !== 0) {
        continue;
      }
      datalessFiles.push({ path: entryPath, size: stat.size });
    }
  }
  const workerCount = Math.min(12, datalessFiles.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextFile < datalessFiles.length) {
        const file = datalessFiles[nextFile];
        nextFile += 1;
        await fs.promises.readFile(file.path);
        materializedFiles += 1;
        materializedBytes += file.size;
        if (materializedFiles % 250 === 0) {
          console.log(`Materialized ${materializedFiles}/${datalessFiles.length} cloud-backed dependency files...`);
        }
      }
    })
  );
  if (materializedFiles) {
    console.log(
      `Materialized ${materializedFiles} cloud-backed dependency files (${Math.ceil(materializedBytes / 1024 / 1024)} MiB, ${Date.now() - startedAt}ms)`
    );
  }
}

function stripJsonComments(text) {
  let result = "";
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      result += char;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") {
        i += 1;
      }
      result += "\n";
      continue;
    }
    if (char === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        i += 1;
      }
      i += 1;
      continue;
    }
    result += char;
  }
  return result.replace(/,\s*([}\]])/g, "$1");
}

function readJsonObject(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) {
    return {};
  }
  return JSON.parse(stripJsonComments(text));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function syncSettings() {
  const mainSettings = readJsonObject(mainSettingsPath);
  const debugSettings = readJsonObject(debugSettingsPath);
  const merged = Object.assign({}, debugSettings);
  for (const [key, value] of Object.entries(mainSettings)) {
    if (
      key.startsWith("leetcode") ||
      key.startsWith("leetcode-problem-rating") ||
      key.startsWith("leetcode-cpp-debugger") ||
      key.startsWith("lcpr.")
    ) {
      merged[key] = value;
    }
  }
  merged["leetcode.workspaceFolder"] = leetcodeWorkspace;
  merged["leetcode-problem-rating.workspaceFolder"] = leetcodeWorkspace;
  merged["leetcode.defaultLanguage"] = merged["leetcode.defaultLanguage"] || "cpp";
  merged["leetcode-problem-rating.defaultLanguage"] = merged["leetcode-problem-rating.defaultLanguage"] || "cpp";
  merged["leetcode-problem-rating.useVscodeNode"] = true;
  merged["leetcode-problem-rating.nodePath"] = merged["leetcode-problem-rating.nodePath"] || "node";
  writeJson(debugSettingsPath, merged);
}

function syncGlobalStorage() {
  fs.mkdirSync(debugGlobalStorage, { recursive: true });
  for (const id of extensionStorageIds) {
    const source = path.join(mainGlobalStorage, id);
    const target = path.join(debugGlobalStorage, id);
    if (fs.existsSync(source)) {
      fs.cpSync(source, target, { recursive: true, force: true });
    }
  }
}

function ensureEndpointUser(targetEndpoint) {
  const lcprRoot = path.join(home, ".lcpr");
  const source = path.join(lcprRoot, "leetcode", "user.json");
  const target = path.join(lcprRoot, targetEndpoint, "user.json");
  if (!fs.existsSync(target) && fs.existsSync(source)) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  }
}

function ensureLeetCodeSessions() {
  const pluginsPath = path.join(home, ".lcpr", "plugins.json");
  const plugins = readJsonObject(pluginsPath);
  if (plugins["leetcode.cn"]) {
    ensureEndpointUser("leetcode.cn");
  }
}

function extensionIdFromPackage(extensionPath) {
  const packagePath = path.join(extensionPath, "package.json");
  if (!fs.existsSync(packagePath)) {
    return "";
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return `${String(manifest.publisher || "").toLowerCase()}.${String(manifest.name || "").toLowerCase()}`;
  } catch (_) {
    return "";
  }
}

function findInstalledExtension(extensionId) {
  if (!fs.existsSync(mainExtensions)) {
    return undefined;
  }
  const normalizedId = extensionId.toLowerCase();
  const candidates = fs.readdirSync(mainExtensions)
    .map((name) => path.join(mainExtensions, name))
    .filter((item) => fs.statSync(item).isDirectory())
    .filter((item) => extensionIdFromPackage(item) === normalizedId)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return candidates[0];
}

function readExtensionManifest(extensionPath) {
  const packagePath = path.join(extensionPath, "package.json");
  if (!fs.existsSync(packagePath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch (_) {
    return undefined;
  }
}

function sourceSignature(extensionPath) {
  const manifest = readExtensionManifest(extensionPath) || {};
  return {
    id: extensionIdFromPackage(extensionPath),
    version: String(manifest.version || ""),
    source: path.basename(extensionPath),
  };
}

function hasCompletedExtensionSync(source, target) {
  if (forceRefreshExtensions) {
    return false;
  }
  const markerPath = path.join(target, syncMarkerName);
  const targetManifest = readExtensionManifest(target);
  if (!fs.existsSync(markerPath) || !targetManifest) {
    return false;
  }
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    const signature = sourceSignature(source);
    return marker.id === signature.id && marker.version === signature.version && marker.source === signature.source;
  } catch (_) {
    return false;
  }
}

function markExtensionSyncComplete(source, target) {
  const markerPath = path.join(target, syncMarkerName);
  fs.writeFileSync(markerPath, `${JSON.stringify(sourceSignature(source), null, 2)}\n`);
}

function syncExtensionDirectory(extensionId, source) {
  const target = path.join(debugExtensions, path.basename(source));
  if (hasCompletedExtensionSync(source, target)) {
    console.log(`Debug profile extension already synced: ${path.basename(source)}`);
    return;
  }
  const startedAt = Date.now();
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`Syncing VS Code extension: ${path.basename(source)}`);
  fs.cpSync(source, target, { recursive: true, force: true });
  markExtensionSyncComplete(source, target);
  console.log(`Synced VS Code extension: ${path.basename(source)} (${Date.now() - startedAt}ms)`);
}

function syncRequiredExtensions() {
  fs.mkdirSync(debugExtensions, { recursive: true });
  const missing = [];
  for (const extensionId of requiredExtensionIds) {
    const source = findInstalledExtension(extensionId);
    if (!source) {
      missing.push(extensionId);
      continue;
    }
    syncExtensionDirectory(extensionId, source);
  }
  if (missing.length) {
    console.warn(`Missing required VS Code extensions in ${mainExtensions}: ${missing.join(", ")}`);
  }
}

async function main() {
  fs.mkdirSync(debugUserDir, { recursive: true });
  fs.mkdirSync(debugExtensions, { recursive: true });
  await materializeDatalessFiles(path.join(repoRoot, "node_modules"));
  syncSettings();
  syncGlobalStorage();
  ensureLeetCodeSessions();
  syncRequiredExtensions();
  console.log(`Prepared VS Code debug profile: ${debugUserData}`);
}

main().catch((error) => {
  console.error(`Failed to prepare VS Code debug profile: ${error.stack || error}`);
  process.exitCode = 1;
});
