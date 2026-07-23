#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(extensionDevelopmentPath, "test/study-plan-extension-test.js");
  const shortTempRoot = process.platform === "darwin" ? "/tmp" : os.tmpdir();
  const runRoot = fs.mkdtempSync(path.join(shortTempRoot, "lcsp-"));
  const workspacePath = path.join(runRoot, "workspace");
  const userDataDir = path.join(runRoot, "user-data");
  const extensionsDir = path.join(runRoot, "extensions");
  const resultPath = path.join(extensionDevelopmentPath, ".study-plan-extension-test-result.json");
  fs.rmSync(resultPath, { force: true });
  fs.mkdirSync(workspacePath, { recursive: true });
  fs.mkdirSync(path.join(userDataDir, "User"), { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, "User", "settings.json"), JSON.stringify({
    "leetcode-problem-rating.useVscodeNode": true,
  }, null, 2));

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
      extensionTestsEnv: { STUDY_PLAN_EXTENSION_RESULT: resultPath },
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
    throw new Error("Study plan extension test did not write its result file.");
  }
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  if (!result || result.passed !== true) {
    throw new Error(`Study plan extension test failed: ${JSON.stringify(result)}`);
  }
  fs.rmSync(runRoot, { recursive: true, force: true });
  fs.rmSync(resultPath, { force: true });
  console.log(`Study plan extension test passed: ${result.tests.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
