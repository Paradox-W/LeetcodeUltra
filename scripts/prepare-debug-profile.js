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
const leetcodeWorkspace = "/Users/paradox/Documents/Leetcode";

const extensionStorageIds = [
  "paradox.leetcodeultra",
  "ccagml.vscode-leetcode-problem-rating",
  "paradox.vscode-leetcode-problem-rating-plus",
];

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
  merged["leetcode-problem-rating.useVscodeNode"] = false;
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

fs.mkdirSync(debugUserDir, { recursive: true });
fs.mkdirSync(debugExtensions, { recursive: true });
syncSettings();
syncGlobalStorage();
ensureLeetCodeSessions();

console.log(`Prepared VS Code debug profile: ${debugUserData}`);
