#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(extensionDevelopmentPath, "test/debug-api-smoke-test.js");
  const resultPath = path.join(extensionDevelopmentPath, ".debug-api-smoke-result.json");
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lcpr-debug-api-smoke-"));
  const workspacePath = path.join(runRoot, "workspace");
  const userDataDir = path.join(runRoot, "user-data");
  const extensionsDir = path.join(runRoot, "extensions");
  const userSettingsDir = path.join(userDataDir, "User");
  const programPath = path.join(workspacePath, "debug-api-smoke.js");

  fs.rmSync(resultPath, { force: true });
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(userSettingsDir, { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.writeFileSync(path.join(userSettingsDir, "settings.json"), JSON.stringify({
    "debug.javascript.usePreview": true,
    "leetcode-problem-rating.aiDebug.enableAiAnalysis": false,
  }, null, 2));
  fs.writeFileSync(programPath, [
    "const nums = [1, 2, 3, 4];",
    "const doubled = nums.map((item) => item * 2);",
    "const total = doubled.reduce((sum, item) => sum + item, 0);",
    "debugger;",
    "console.log(total);",
  ].join("\n"));

  const savedEnv = {};
  for (const key of Object.keys(process.env)) {
    if (key === "ELECTRON_RUN_AS_NODE" || key.startsWith("VSCODE_")) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  }

  const testRun = runTests({
      vscodeExecutablePath: process.env.VSCODE_TEST_EXECUTABLE || undefined,
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv: {
        DEBUG_API_SMOKE_RESULT: resultPath,
        DEBUG_API_SMOKE_PROGRAM: programPath,
      },
      launchArgs: [
        workspacePath,
        "--disable-workspace-trust",
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
      ],
    });

  try {
    await Promise.race([
      testRun,
      new Promise((_, reject) => setTimeout(() => reject(new Error("Debug API smoke test timed out after 45s.")), 45000)),
    ]);
  } finally {
    Object.assign(process.env, savedEnv);
  }

  if (!fs.existsSync(resultPath)) {
    throw new Error("Debug API smoke test did not write its result file.");
  }
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  fs.rmSync(resultPath, { force: true });
  fs.rmSync(runRoot, { recursive: true, force: true });
  if (!result || result.passed !== true) {
    throw new Error(`Debug API smoke test failed: ${JSON.stringify(result)}`);
  }
  console.log(`Debug API smoke test passed: ${result.tests.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
