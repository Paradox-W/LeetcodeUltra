#!/usr/bin/env node
"use strict";

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const outputDir = process.argv[2] || path.join("/tmp", "leetcodeultra-screenshots");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath = path.join(outputDir, `vscode-${stamp}.png`);

fs.mkdirSync(outputDir, { recursive: true });

if (process.platform !== "darwin") {
  console.error("capture-vscode-window currently supports macOS via screencapture.");
  process.exit(1);
}

const activate = childProcess.spawnSync("osascript", [
  "-e",
  'tell application "Visual Studio Code" to activate',
], { encoding: "utf8" });
if (activate.status !== 0) {
  console.error(activate.stderr || activate.stdout || "Failed to activate Visual Studio Code.");
  process.exit(1);
}

const capture = childProcess.spawnSync("screencapture", ["-x", outputPath], {
  encoding: "utf8",
});
if (capture.status !== 0) {
  console.error(capture.stderr || capture.stdout || "screencapture failed.");
  process.exit(1);
}

console.log(outputPath);
