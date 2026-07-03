#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { renderDiagramPackPreview, sanitizeRenderedSvg } = require("../out/src/diagram/DiagramRenderer");

const root = path.resolve(__dirname, "..");
const diagramsDir = path.join(root, "resources", "diagrams");
const outputDir = path.join(root, "out", "diagram-fixtures");
const outputFile = path.join(outputDir, "index.html");
const files = fs.readdirSync(diagramsDir).filter((file) => file.endsWith(".json")).sort();

fs.mkdirSync(outputDir, { recursive: true });

const sections = files.map((file) => {
  const pack = JSON.parse(fs.readFileSync(path.join(diagramsDir, file), "utf8"));
  const svg = sanitizeRenderedSvg(renderDiagramPackPreview(pack));
  if (!svg) {
    throw new Error(`Failed to render ${file}`);
  }
  return `<section><h2>${escapeHtml(file)}</h2>${svg}</section>`;
});

fs.writeFileSync(outputFile, `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>LeetcodeUltra diagram fixtures</title>
  <style>
    :root {
      --lcpr-bg: #1f1f1f;
      --lcpr-fg: #d4d4d4;
      --lcpr-input: #2a2a2a;
      --vscode-testing-iconFailed: #f85149;
      --vscode-textLink-foreground: #3794ff;
    }
    body { margin: 24px; background: var(--lcpr-bg); color: var(--lcpr-fg); font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; }
    section { margin: 0 0 28px; }
    h2 { font-size: 14px; font-weight: 600; }
    .lcpr-diagram-svg { width: min(920px, 100%); }
    .lcpr-diagram-node text { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  </style>
</head>
<body>
${sections.join("\n")}
</body>
</html>
`, "utf8");

console.log(outputFile);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}
