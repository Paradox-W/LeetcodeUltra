const fs = require("fs");
const os = require("os");
const path = require("path");
const { runTests } = require("@vscode/test-electron");

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..");
  const extensionTestsPath = path.resolve(extensionDevelopmentPath, "test/ai-debug-extension-test.js");
  const resultPath = path.join(extensionDevelopmentPath, ".ai-debug-extension-test-result.json");
  const realWorkspace = process.env.AI_DEBUG_REAL_WORKSPACE;
  const realFile = process.env.AI_DEBUG_REAL_FILE || (
    realWorkspace ? path.join(realWorkspace, "3-longest-substring-without-repeating-characters.cpp") : undefined
  );
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lcpr-ai-debug-test-"));
  const userDataDir = path.join(runRoot, "user-data");
  const extensionsDir = path.join(runRoot, "extensions");
  const leetcodeFilesDir = path.join(runRoot, "leetcode-files");
  const userSettingsDir = path.join(userDataDir, "User");
  const vscodeExecutablePath = process.env.VSCODE_TEST_EXECUTABLE || undefined;

  if (fs.existsSync(resultPath)) {
    fs.unlinkSync(resultPath);
  }
  fs.mkdirSync(userSettingsDir, { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });
  fs.mkdirSync(leetcodeFilesDir, { recursive: true });
  fs.writeFileSync(path.join(userSettingsDir, "settings.json"), JSON.stringify({
    "leetcode-problem-rating.workspaceFolder": realWorkspace || leetcodeFilesDir,
    "leetcode-problem-rating.aiDebug.enableAiAnalysis": false,
    "leetcode-problem-rating.aiDebug.maxVariables": 8,
    "leetcode-problem-rating.aiDebug.manualVariables": [],
    "leetcode-problem-rating.aiDebug.visualTheme": "dense",
    "leetcode-cpp-debugger.source": "[offline]local",
    "leetcode-cpp-debugger.deleteTemporaryContents": false,
    "leetcode-cpp-debugger.outputFileEncoding": "utf8",
  }, null, 2));

  if (realWorkspace) {
    const requiredExtensions = [
      "xaviercai.vscode-leetcode-cpp-debug-0.0.9",
      "vadimcn.vscode-lldb-1.12.2",
    ];
    for (const extensionName of requiredExtensions) {
      const source = path.join(os.homedir(), ".vscode", "extensions", extensionName);
      const target = path.join(extensionsDir, extensionName);
      if (!fs.existsSync(source)) {
        throw new Error(`Required VS Code extension is missing: ${source}`);
      }
      fs.symlinkSync(source, target, "dir");
    }
  }

  const savedEnv = {};
  for (const key of Object.keys(process.env)) {
    if (key === "ELECTRON_RUN_AS_NODE" || key.startsWith("VSCODE_")) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  }

  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
      extensionTestsPath,
      extensionTestsEnv: {
        AI_DEBUG_EXTENSION_TEST_RESULT: resultPath,
        AI_DEBUG_REAL_WORKSPACE: realWorkspace || "",
        AI_DEBUG_REAL_FILE: realFile || "",
      },
      launchArgs: [
        realWorkspace || extensionDevelopmentPath,
        "--disable-workspace-trust",
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
      ],
    });
  } finally {
    Object.assign(process.env, savedEnv);
  }

  if (!fs.existsSync(resultPath)) {
    throw new Error("AI debug extension test did not write its result file.");
  }
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  if (!result || result.passed !== true) {
    throw new Error(`AI debug extension test result was not successful: ${JSON.stringify(result)}`);
  }
  fs.unlinkSync(resultPath);
  fs.rmSync(runRoot, { recursive: true, force: true });
  console.log(`AI debug extension test passed: ${result.tests.join(", ")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
