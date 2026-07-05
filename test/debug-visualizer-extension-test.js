const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function pausedFrame(session) {
  const threads = await withTimeout(session.customRequest("threads", {}), 1000);
  const thread = threads && threads.threads && threads.threads[0];
  if (!thread) {
    return undefined;
  }
  const stack = await withTimeout(session.customRequest("stackTrace", {
    threadId: thread.id,
    startFrame: 0,
    levels: 1,
  }), 1000);
  const frame = stack && stack.stackFrames && stack.stackFrames[0];
  return frame && { threadId: thread.id, frameId: frame.id, name: frame.name };
}

async function waitForPausedSession(timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const session = vscode.debug.activeDebugSession;
    if (session) {
      const frame = await pausedFrame(session);
      if (frame) {
        return { session, frame };
      }
    }
    await wait(150);
  }
  throw new Error("Timed out waiting for paused debug session.");
}

function captureScreenshot(outputPath) {
  if (!outputPath || process.platform !== "darwin") {
    return "";
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  childProcess.spawnSync("osascript", ["-e", 'tell application "Visual Studio Code" to activate'], { encoding: "utf8" });
  const result = childProcess.spawnSync("screencapture", ["-x", outputPath], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "screencapture failed");
  }
  return outputPath;
}

exports.run = async function run() {
  const programPath = process.env.DEBUG_VISUALIZER_PROGRAM;
  const resultPath = process.env.DEBUG_VISUALIZER_RESULT;
  const screenshotPath = process.env.DEBUG_VISUALIZER_SCREENSHOT;
  assert(programPath && fs.existsSync(programPath), `program should exist: ${programPath}`);

  const extension = vscode.extensions.getExtension("paradox.leetcodeultra");
  assert(extension, "LeetcodeUltra extension should be loaded");
  await extension.activate();
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(programPath));
  await vscode.window.showTextDocument(document, { preview: false });

  const started = await vscode.debug.startDebugging(undefined, {
    type: "pwa-node",
    request: "launch",
    name: "Debug Visualizer Smoke",
    program: programPath,
    cwd: path.dirname(programPath),
    console: "internalConsole",
    stopOnEntry: false,
    skipFiles: ["<node_internals>/**"],
  });
  assert.strictEqual(started, true, "debug session should start");
  const { session } = await waitForPausedSession();
  try {
    const frame = await pausedFrame(session);
    assert(frame, "debug session should still expose a paused frame");
    const result = await vscode.commands.executeCommand("lcpr.debugVisualizer.show", {
      expression: "globalThis.visNums",
      frameId: frame.frameId,
    });
    assert(result, "Debug Visualizer command should return a result");
    assert(!result.error, `Debug Visualizer command should not fail: ${JSON.stringify(result)}`);
    assert.strictEqual(result.visual.kind.grid, true, "Debug Visualizer should render grid data");
    assert.deepStrictEqual(result.visual.rows[0].columns.map((cell) => cell.content), ["4", "5", "6"]);
    assert.strictEqual(result.visual.markers[0].label, "it");
    const collected = await vscode.commands.executeCommand("lcpr.debugVisualizer.collect");
    assert(collected, "Debug Visualizer collect command should return a model");
    assert.strictEqual(collected.title, "Debug Visualizer");
    const nums = (collected.variables || []).find((variable) => variable.name === "nums");
    assert(nums, `Debug Visualizer collect should find local nums: ${JSON.stringify(collected)}`);
    assert.strictEqual(nums.visual.kind.grid, true, "local nums should render as grid");
    assert.deepStrictEqual(nums.visual.rows[0].columns.map((cell) => cell.content), ["4", "5", "6"]);
    await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
    await wait(1200);
    const screenshot = captureScreenshot(screenshotPath);
    if (resultPath) {
      fs.writeFileSync(resultPath, JSON.stringify({
        passed: true,
        tests: ["debug-visualizer-expression-grid"],
        screenshot,
      }, null, 2));
    }
  } finally {
    await vscode.debug.stopDebugging(session);
    await vscode.debug.stopDebugging();
  }
};
