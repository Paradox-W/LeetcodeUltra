#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(extensionDevelopmentPath, "test/debug-visualizer-extension-test.js");
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lcpr-debug-visualizer-"));
  const workspacePath = path.join(runRoot, "workspace");
  const userDataDir = path.join(runRoot, "user-data");
  const extensionsDir = path.join(runRoot, "extensions");
  const resultPath = path.join(extensionDevelopmentPath, ".debug-visualizer-extension-test-result.json");
  const screenshotPath = path.join(extensionDevelopmentPath, "test-artifacts", "debug-visualizer-smoke.png");
  const programPath = path.join(workspacePath, "debug-visualizer-smoke.js");

  fs.rmSync(resultPath, { force: true });
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(path.join(userDataDir, "User"), { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, "User", "settings.json"), JSON.stringify({
    "leetcode-problem-rating.aiDebug.enableAiAnalysis": false,
  }, null, 2));
  fs.writeFileSync(programPath, [
    "const nums = [4, 5, 6];",
    "let left = 1;",
    "globalThis.visNums = JSON.stringify({",
    "  kind: { grid: true },",
    "  rows: [{ columns: [",
    "    { content: '4', tag: '0' },",
    "    { content: '5', tag: '1' },",
    "    { content: '6', tag: '2' }",
    "  ] }],",
    "  markers: [{ row: 0, column: 1, label: 'it', color: '#d73a49' }]",
    "});",
    "debugger;",
    "setTimeout(() => console.log(globalThis.visNums), 1000);",
  ].join("\n"));

  const savedEnv = {};
  for (const key of Object.keys(process.env)) {
    if (key === "ELECTRON_RUN_AS_NODE" || key.startsWith("VSCODE_")) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  }

  try {
    await runTests({
      vscodeExecutablePath: process.env.VSCODE_TEST_EXECUTABLE || undefined,
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv: {
        DEBUG_VISUALIZER_PROGRAM: programPath,
        DEBUG_VISUALIZER_RESULT: resultPath,
        DEBUG_VISUALIZER_SCREENSHOT: screenshotPath,
      },
      launchArgs: [
        workspacePath,
        "--disable-workspace-trust",
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
      ],
    });
  } finally {
    Object.assign(process.env, savedEnv);
  }

  if (!fs.existsSync(resultPath)) {
    throw new Error("Debug Visualizer extension test did not write its result file.");
  }
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  if (!result || result.passed !== true) {
    throw new Error(`Debug Visualizer extension test failed: ${JSON.stringify(result)}`);
  }
  fs.rmSync(runRoot, { recursive: true, force: true });
  console.log(`Debug Visualizer extension test passed: ${result.tests.join(", ")}`);
  if (result.screenshot) {
    console.log(`Screenshot: ${result.screenshot}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
