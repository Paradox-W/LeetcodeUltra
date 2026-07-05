#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const mainExtensionsDir = path.join(os.homedir(), ".vscode", "extensions");
const sandboxExtensionsDir = path.join(repoRoot, ".vscode-test", "extensions");

const requiredExtensions = [
  { id: "vadimcn.vscode-lldb", reason: "CodeLLDB C++ debug sessions" },
  { id: "ms-vscode.cpptools", reason: "cppdbg/cpptools compatibility checks" },
  { id: "leetcode.vscode-leetcode", reason: "LeetCode workspace integration" },
];

const optionalExtensions = [
  { id: "xaviercai.vscode-leetcode-cpp-debug", reason: "legacy compatibility only; LeetcodeUltra now uses its internal C++ harness generator" },
];

const usefulCommands = [
  { command: "code", args: ["--version"], reason: "launch Extension Development Host" },
  { command: "node", args: ["--version"], reason: "run extension tooling" },
  { command: "npm", args: ["--version"], reason: "compile and run scripts" },
  { command: "clang++", args: ["--version"], reason: "compile C++ debug fixtures", optional: true },
  { command: "g++", args: ["--version"], reason: "fallback C++ compiler", optional: true },
  { command: "lldb", args: ["--version"], reason: "LLDB/CodeLLDB environment", optional: true },
  { command: "gdb", args: ["--version"], reason: "cppdbg/GDB environment", optional: true },
];

function run(command, args) {
  const result = childProcess.spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    error: result.error && result.error.message,
  };
}

function readPackageId(extensionPath) {
  const packagePath = path.join(extensionPath, "package.json");
  if (!fs.existsSync(packagePath)) {
    return "";
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    return `${String(manifest.publisher || "").toLowerCase()}.${String(manifest.name || "").toLowerCase()}`;
  } catch (_error) {
    return "";
  }
}

function scanExtensionDir(dir) {
  if (!fs.existsSync(dir)) {
    return new Set();
  }
  const ids = new Set();
  for (const name of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, name);
    if (!fs.statSync(fullPath).isDirectory()) {
      continue;
    }
    const id = readPackageId(fullPath);
    if (id) {
      ids.add(id);
    }
  }
  return ids;
}

function listCodeExtensions() {
  const result = run("code", ["--list-extensions", "--show-versions"]);
  if (!result.ok) {
    return { ok: false, ids: new Set(), error: result.stderr || result.error || "code --list-extensions failed" };
  }
  const ids = new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/@[^@]+$/, "").toLowerCase())
      .filter(Boolean)
  );
  return { ok: true, ids };
}

function printSection(title) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

function main() {
  let failures = 0;
  const codeExtensions = listCodeExtensions();
  const mainExtensions = scanExtensionDir(mainExtensionsDir);
  const sandboxExtensions = scanExtensionDir(sandboxExtensionsDir);

  printSection("Commands");
  for (const item of usefulCommands) {
    const result = run(item.command, item.args);
    const ok = result.ok || item.optional;
    if (!ok) {
      failures++;
    }
    const version = result.stdout.split(/\r?\n/)[0] || result.stderr.split(/\r?\n/)[0] || result.error || "not found";
    console.log(`${result.ok ? "OK " : item.optional ? "WARN" : "FAIL"} ${item.command.padEnd(8)} ${version} (${item.reason})`);
  }

  printSection("VS Code Extensions");
  if (!codeExtensions.ok) {
    failures++;
    console.log(`FAIL code --list-extensions: ${codeExtensions.error}`);
  }
  for (const extension of requiredExtensions) {
    const id = extension.id.toLowerCase();
    const installed = codeExtensions.ids.has(id) || mainExtensions.has(id);
    const inSandbox = sandboxExtensions.has(id);
    if (!installed) {
      failures++;
    }
    console.log(`${installed ? "OK " : "FAIL"} ${extension.id} (${extension.reason})`);
    console.log(`    default=${installed ? "yes" : "no"} sandbox=${inSandbox ? "yes" : "no"}`);
  }
  for (const extension of optionalExtensions) {
    const id = extension.id.toLowerCase();
    const installed = codeExtensions.ids.has(id) || mainExtensions.has(id);
    const inSandbox = sandboxExtensions.has(id);
    console.log(`${installed ? "OK " : "WARN"} ${extension.id} (${extension.reason})`);
    console.log(`    default=${installed ? "yes" : "no"} sandbox=${inSandbox ? "yes" : "no"}`);
  }

  printSection("Sandbox Profile");
  const debugUserData = path.join(repoRoot, ".vscode-test", "user-data");
  const settingsPath = path.join(debugUserData, "User", "settings.json");
  console.log(`${fs.existsSync(settingsPath) ? "OK " : "WARN"} ${settingsPath}`);
  console.log(`${fs.existsSync(sandboxExtensionsDir) ? "OK " : "WARN"} ${sandboxExtensionsDir}`);
  console.log("Run `npm run prepare:debug-profile` to sync settings and required extensions into the sandbox profile.");

  if (failures > 0) {
    console.error(`\nDebug tooling doctor found ${failures} blocking issue(s).`);
    process.exit(1);
  }
  console.log("\nDebug tooling doctor passed.");
}

main();
