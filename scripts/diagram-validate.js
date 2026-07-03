#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { validateDiagramPack } = require("../out/src/diagram/DiagramValidation");

const root = path.resolve(__dirname, "..");
const diagramsDir = path.join(root, "resources", "diagrams");
const files = fs.readdirSync(diagramsDir).filter((file) => file.endsWith(".json")).sort();
let failed = false;

for (const file of files) {
  const filePath = path.join(diagramsDir, file);
  const pack = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const result = validateDiagramPack(pack);
  if (!result.ok) {
    failed = true;
    console.error(`diagram invalid: ${file}`);
    for (const issue of result.issues) {
      console.error(`  ${issue.path}: ${issue.message}`);
    }
  } else {
    console.log(`diagram ok: ${file}`);
  }
}

if (failed) {
  process.exit(1);
}
