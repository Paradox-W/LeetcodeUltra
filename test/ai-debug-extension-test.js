const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

const ROOT = path.resolve(__dirname, "..");
const debugEvents = [];

function frameMatches(frameName, expectedFrameName) {
  return !expectedFrameName || frameName === expectedFrameName || frameName.endsWith(`.${expectedFrameName}`);
}

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
  try {
    const threads = await withTimeout(session.customRequest("threads", {}), 1000);
    const thread = threads && threads.threads && threads.threads[0];
    if (!thread) {
      return undefined;
    }
    const stack = await withTimeout(session.customRequest("stackTrace", { threadId: thread.id, startFrame: 0, levels: 1 }), 1000);
    const frame = stack && stack.stackFrames && stack.stackFrames[0];
    return frame && { threadId: thread.id, frameId: frame.id, name: frame.name };
  } catch (error) {
    debugEvents.push(`stackTrace failed: ${String(error && error.message || error)}`);
    return undefined;
  }
}

async function waitForPausedSession(timeoutMs = 15000) {
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
  throw new Error(`Timed out waiting for paused debug session. Events: ${debugEvents.slice(-20).join(" | ")}`);
}

async function waitForNextPause(session, previousFrame, expectedFrameName, timeoutMs = 15000) {
  const startedAt = Date.now();
  let sawRunning = false;
  while (Date.now() - startedAt < timeoutMs) {
    const frame = await pausedFrame(session);
    if (!frame) {
      sawRunning = true;
    } else if (
      (sawRunning || frame.frameId !== previousFrame.frameId)
      && frame.frameId !== previousFrame.frameId
      && frameMatches(frame.name, expectedFrameName)
    ) {
      return { session, frame };
    }
    await wait(150);
  }
  throw new Error(`Timed out waiting for next paused frame. Events: ${debugEvents.slice(-20).join(" | ")}`);
}

async function openExample(fileName) {
  const uri = vscode.Uri.file(path.join(ROOT, "resources/ai-debug-examples", fileName));
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  debugEvents.push(`opened ${fileName}`);
  return document;
}

function markerLine(document) {
  const text = document.getText();
  const lines = text.split(/\r?\n/);
  const index = lines.findIndex((line) => line.indexOf("run AI Debug") >= 0);
  assert(index >= 0, `missing AI Debug marker in ${document.fileName}`);
  return index;
}

async function runAtMarker(document, expectedFrameName) {
  vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
  const breakpoint = new vscode.SourceBreakpoint(
    new vscode.Location(document.uri, new vscode.Position(markerLine(document), 0)),
    true
  );
  vscode.debug.addBreakpoints([breakpoint]);
  debugEvents.push(`breakpoint ${document.fileName}:${markerLine(document) + 1}`);

  const started = await vscode.debug.startDebugging(undefined, {
    type: "pwa-node",
    request: "launch",
    name: `AI Debug Integration: ${path.basename(document.fileName)}`,
    program: document.fileName,
    cwd: path.dirname(document.fileName),
    console: "internalConsole",
    stopOnEntry: true,
    skipFiles: ["<node_internals>/**"],
  });
  debugEvents.push(`startDebugging=${started}`);
  assert.strictEqual(started, true, "debug session should start");
  const entry = await waitForPausedSession();
  debugEvents.push(`entry pause ${entry.frame.name}:${entry.frame.frameId}`);
  if (frameMatches(entry.frame.name, expectedFrameName)) {
    return entry.session;
  }
  await entry.session.customRequest("continue", { threadId: entry.frame.threadId });
  const { session, frame } = await waitForNextPause(entry.session, entry.frame, expectedFrameName);
  debugEvents.push(`marker pause ${frame.name}:${frame.frameId}`);
  assert(vscode.debug.activeDebugSession, "debug session should be active after stopped event");
  return session;
}

async function stopDebugging(session) {
  try {
    await vscode.debug.stopDebugging(session);
    await vscode.debug.stopDebugging();
  } catch (_) {
    // The adapter may have already exited after the test command.
  }
  vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
  const startedAt = Date.now();
  while (vscode.debug.activeDebugSession && Date.now() - startedAt < 5000) {
    await wait(150);
  }
  await wait(250);
}

async function waitForRealCppPausedSession(timeoutMs = 45000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const session = vscode.debug.activeDebugSession;
    if (session) {
      const frame = await pausedFrame(session);
      if (frame) {
        debugEvents.push(`real cpp pause ${frame.name}:${frame.frameId}`);
        return { session, frame };
      }
    }
    await wait(200);
  }
  throw new Error(`Timed out waiting for real C++ pause. Events: ${debugEvents.slice(-30).join(" | ")}`);
}

async function configureAiDebug() {
  vscode.debug.onDidStartDebugSession((session) => {
    debugEvents.push(`started session ${session.type}:${session.name}:${session.id}`);
  });
  vscode.debug.onDidChangeActiveDebugSession((session) => {
    debugEvents.push(`active session ${session ? `${session.type}:${session.name}:${session.id}` : "none"}`);
  });
  vscode.debug.onDidTerminateDebugSession((session) => {
    debugEvents.push(`terminated session ${session.type}:${session.name}:${session.id}`);
  });
  const extension = vscode.extensions.getExtension("paradox.leetcodeultra");
  assert(extension, "LeetcodeUltra extension should be loaded in development host");
  await extension.activate();

  const config = vscode.workspace.getConfiguration("leetcode-problem-rating");
  await config.update("aiDebug.enableAiAnalysis", false, vscode.ConfigurationTarget.Global);
  await config.update("aiDebug.maxVariables", 8, vscode.ConfigurationTarget.Global);
  await config.update("aiDebug.manualVariables", [], vscode.ConfigurationTarget.Global);
  await config.update("aiDebug.visualTheme", "dense", vscode.ConfigurationTarget.Global);
}

function byName(model) {
  return new Map((model.variables || []).map((variable) => [variable.name, variable]));
}

function dumpVariable(variable) {
  return JSON.stringify(variable, null, 2);
}

async function collectFor(fileName, expectedFrameName) {
  await stopDebugging();
  const document = await openExample(fileName);
  const session = await runAtMarker(document, expectedFrameName);
  try {
    const model = await vscode.commands.executeCommand("leetcodeEnhanced.analyzeAndShow");
    assert(model, "AI debug command should return a model");
    assert.strictEqual(model.status, "已捕获调试变量");
    return model;
  } finally {
    await stopDebugging(session);
  }
}

async function testArray() {
  const model = await collectFor("sum.js", "sum");
  const variables = byName(model);
  assert(variables.has("nums"), "sum.js should collect nums");
  assert(variables.has("s"), "sum.js should collect s");
  assert.strictEqual(variables.get("nums").visual.kind.array, true, `nums should render as array: ${dumpVariable(variables.get("nums"))}`);
  assert.deepStrictEqual(
    variables.get("nums").visual.values.map((item) => item.value),
    ["1", "2", "3", "4"]
  );
  console.log("[ai-debug-extension] sum.js passed");
}

async function testList() {
  const model = await collectFor("reverse-list.js", "reverseList");
  const variables = byName(model);
  assert(variables.has("head"), "reverse-list.js should collect head");
  assert(variables.has("newHead"), "reverse-list.js should collect newHead");
  assert.strictEqual(variables.get("head").visual.kind.list, true, `head should render as list: ${dumpVariable(variables.get("head"))}`);
  assert.strictEqual(variables.get("head").visual.nodes[0].value, "1", `head should expose the first list node: ${dumpVariable(variables.get("head"))}`);
  console.log("[ai-debug-extension] reverse-list.js passed");
}

async function testTree() {
  const model = await collectFor("inorder-tree.js", "inorderTraversal");
  const variables = byName(model);
  assert(variables.has("root"), "inorder-tree.js should collect root");
  assert(variables.has("stack"), "inorder-tree.js should collect stack");
  assert.strictEqual(variables.get("root").visual.kind.graph, true, "root should render as graph");
  assert.strictEqual(variables.get("root").visual.nodes.length, 3, `root graph should include three nodes: ${dumpVariable(variables.get("root"))}`);
  assert.strictEqual(variables.get("root").visual.edges.length, 2, `root graph should include two edges: ${dumpVariable(variables.get("root"))}`);
  console.log("[ai-debug-extension] inorder-tree.js passed");
}

async function testRealCppPluginDebug() {
  const realFile = process.env.AI_DEBUG_REAL_FILE;
  assert(realFile, "AI_DEBUG_REAL_FILE should be set for real C++ debug test");
  assert(fs.existsSync(realFile), `real C++ file should exist: ${realFile}`);
  const config = vscode.workspace.getConfiguration("leetcode-problem-rating");
  await config.update("aiDebug.maxVariables", 1, vscode.ConfigurationTarget.Global);
  await config.update("aiDebug.manualVariables", [{ name: "s", expression: "s", type: "string" }], vscode.ConfigurationTarget.Workspace);
  await config.update("aiDebug.autoRefreshOnStop", false, vscode.ConfigurationTarget.Global);
  await stopDebugging();
  const before = fs.readFileSync(realFile, "utf8");
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(realFile));
  await vscode.window.showTextDocument(document, { preview: false });
  vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
  debugEvents.push(`opened real cpp ${realFile}`);

  try {
    await vscode.commands.executeCommand("lcpr.simpleDebug", document, "\"abcabbb\"\\n");
    const { session, frame } = await waitForRealCppPausedSession();
    assert(
      /Solution::|lengthOfLongestSubstring/.test(frame.name),
      `real C++ debug should pause in Solution frame, got ${frame.name}`
    );
    const model = await vscode.commands.executeCommand("leetcodeEnhanced.analyzeAndShow");
    assert(model, "AI debug command should return a model for real C++");
    assert.strictEqual(model.status, "已捕获调试变量");
    assert(
      (model.variables || []).some((variable) => variable.name === "s" || variable.name === "lastSeen"),
      `real C++ model should include key variables: ${JSON.stringify(model.variables || [])}`
    );
    await stopDebugging(session);
  } finally {
    await stopDebugging();
  }

  const after = fs.readFileSync(realFile, "utf8");
  assert(!after.includes("@lcpr-cpp-debug-input-begin"), "temporary INPUT macro should be cleaned");
  assert(!after.includes("@lcpr-cpp-debug-disabled-line"), "temporary #line marker should be cleaned");
  assert(after.includes("#line 1"), "#line directive should be restored");
  assert.strictEqual(after, before, "real C++ source should be restored after debug session");
  const inputPath = path.join(path.dirname(realFile), "test_case.txt");
  assert.strictEqual(fs.readFileSync(inputPath, "utf8"), "\"abcabbb\"");
  console.log("[ai-debug-extension] real C++ plugin debug passed");
}

exports.run = async function run() {
  await configureAiDebug();
  if (process.env.AI_DEBUG_REAL_WORKSPACE) {
    await testRealCppPluginDebug();
    if (process.env.AI_DEBUG_EXTENSION_TEST_RESULT) {
      fs.writeFileSync(process.env.AI_DEBUG_EXTENSION_TEST_RESULT, JSON.stringify({
        passed: true,
        tests: ["real-cpp-plugin-debug"],
      }, null, 2));
    }
    console.log("[ai-debug-extension] real C++ plugin debug integration check passed");
    return;
  }
  await testArray();
  await testList();
  await testTree();
  if (process.env.AI_DEBUG_EXTENSION_TEST_RESULT) {
    fs.writeFileSync(process.env.AI_DEBUG_EXTENSION_TEST_RESULT, JSON.stringify({
      passed: true,
      tests: ["sum.js", "reverse-list.js", "inorder-tree.js"],
    }, null, 2));
  }
  console.log("[ai-debug-extension] all AI debug integration checks passed");
};
