const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

const events = [];

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
    const stack = await withTimeout(session.customRequest("stackTrace", {
      threadId: thread.id,
      startFrame: 0,
      levels: 1,
    }), 1000);
    const frame = stack && stack.stackFrames && stack.stackFrames[0];
    return frame && { threadId: thread.id, frameId: frame.id, name: frame.name };
  } catch (error) {
    events.push(`pausedFrame failed: ${String(error && error.message || error)}`);
    return undefined;
  }
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
  throw new Error(`Timed out waiting for paused debug session. Events: ${events.join(" | ")}`);
}

async function evaluate(session, frameId, expression) {
  const result = await session.customRequest("evaluate", {
    expression,
    frameId,
    context: "watch",
  });
  events.push(`evaluate ${expression} => ${result && result.result}`);
  return result;
}

async function stopDebugging(session) {
  try {
    await vscode.debug.stopDebugging(session);
    await vscode.debug.stopDebugging();
  } catch (_error) {
    // The adapter may have already exited.
  }
  const startedAt = Date.now();
  while (vscode.debug.activeDebugSession && Date.now() - startedAt < 5000) {
    await wait(100);
  }
}

exports.run = async function run() {
  const programPath = process.env.DEBUG_API_SMOKE_PROGRAM;
  assert(programPath, "DEBUG_API_SMOKE_PROGRAM should be set");
  assert(fs.existsSync(programPath), `debug smoke program should exist: ${programPath}`);

  const extension = vscode.extensions.getExtension("paradox.leetcodeultra");
  assert(extension, "LeetcodeUltra extension should be loaded in the development host");
  await extension.activate();

  const started = await vscode.debug.startDebugging(undefined, {
    type: "pwa-node",
    request: "launch",
    name: "LeetcodeUltra Debug API Smoke",
    program: programPath,
    cwd: path.dirname(programPath),
    console: "internalConsole",
    stopOnEntry: false,
    skipFiles: ["<node_internals>/**"],
  });
  assert.strictEqual(started, true, "debug session should start");

  const { session, frame } = await waitForPausedSession();
  try {
    const total = await evaluate(session, frame.frameId, "total");
    assert.strictEqual(String(total.result), "20");
    const length = await evaluate(session, frame.frameId, "nums.length");
    assert.strictEqual(String(length.result), "4");
    const doubled = await evaluate(session, frame.frameId, "doubled");
    assert(Number(doubled.variablesReference) > 0, "array evaluation should expose variablesReference");
    const variables = await session.customRequest("variables", {
      variablesReference: doubled.variablesReference,
    });
    assert(Array.isArray(variables.variables), "variables response should contain variables array");
    assert(variables.variables.some((item) => item.name === "0" || item.name === "[0]"), "array variables should expose first item");
  } finally {
    await stopDebugging(session);
  }

  if (process.env.DEBUG_API_SMOKE_RESULT) {
    fs.writeFileSync(process.env.DEBUG_API_SMOKE_RESULT, JSON.stringify({
      passed: true,
      tests: ["vscode.debug.startDebugging", "dap.evaluate", "dap.variables"],
      events,
    }, null, 2));
  }
};
