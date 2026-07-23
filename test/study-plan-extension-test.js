"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

exports.run = async function run() {
  const extension = vscode.extensions.getExtension("paradox.leetcodeultra");
  assert(extension, "LeetcodeUltra extension should be loaded in the development host");
  await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "lcpr.studyPlan.open",
    "lcpr.studyPlan.createOrResume",
    "lcpr.studyPlan.pause",
    "lcpr.studyPlan.refresh",
    "lcpr.studyPlan.reset",
  ]) {
    assert(commands.includes(command), `study plan command should be registered: ${command}`);
  }

  await vscode.commands.executeCommand("lcpr.studyPlan.reset");
  const today = new Date();
  const dateKey = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");
  await vscode.commands.executeCommand("lcpr.studyPlan.createOrResume", {
    startDate: dateKey,
    dailyMinutes: 120,
    dailyProblemLimit: 3,
    reviewsCountTowardLimit: true,
    sundayRest: false,
  });

  let document = await vscode.commands.executeCommand("lcpr.studyPlan.__inspect");
  assert(document, "study plan document should be created");
  assert.strictEqual(document.course.id, "carl-foundation-v1");
  const assignment = document.assignments[dateKey];
  assert(assignment && assignment.tasks.length > 0, "today assignment should be generated");
  const task = assignment.tasks[0];

  const draftPath = await vscode.commands.executeCommand("lcpr.studyPlan.__startReview", task.id);
  assert(fs.existsSync(draftPath), "blank review draft should be created");
  assert(draftPath.includes(path.join("study-review", task.fid)), "draft should live under global study-review storage");
  const draft = fs.readFileSync(draftPath, "utf8");
  assert(draft.includes("请从空白处重写解法"), "review draft should start without a historical implementation");
  const sidecarDir = path.join(path.dirname(draftPath), ".lcpr_data", "problem-meta");
  assert(fs.existsSync(sidecarDir) && fs.readdirSync(sidecarDir).length > 0, "review draft should keep submit metadata in the sidecar");
  assert(!draft.includes("历史答案"), "review draft must not contain a historical answer");

  await vscode.commands.executeCommand("lcpr.studyPlan.__submit", {
    fid: task.fid,
    sub_type: "submit",
    accepted: true,
    submission_id: "study-plan-extension-smoke",
    status: "Accepted",
  });
  await vscode.commands.executeCommand("lcpr.studyPlan.__understanding", task.id);
  await vscode.commands.executeCommand("lcpr.studyPlan.__rate", task.id, "good");

  document = await vscode.commands.executeCommand("lcpr.studyPlan.__inspect");
  const progress = document.progress[task.sourceFid || task.fid];
  assert(progress.fsrsCard && progress.fsrsCard.due, "rating should generate the next FSRS due date");
  assert(progress.reviewHistory.length === 1, "one accepted session should create one review record");
  assert.strictEqual(progress.reviewHistory[0].serverAccepted, true);

  await vscode.commands.executeCommand("lcpr.studyPlan.__reload");
  const restored = await vscode.commands.executeCommand("lcpr.studyPlan.__inspect");
  assert.strictEqual(restored.progress[task.sourceFid || task.fid].reviewHistory.length, 1, "restart reload should preserve review state");
  await vscode.commands.executeCommand("lcpr.studyPlan.pause");
  const paused = await vscode.commands.executeCommand("lcpr.studyPlan.__inspect");
  assert.strictEqual(paused.paused, true, "pause command should persist plan state");

  const resultPath = process.env.STUDY_PLAN_EXTENSION_RESULT;
  if (resultPath) {
    fs.writeFileSync(resultPath, JSON.stringify({
      passed: true,
      tests: [
        "study-plan-command-registration",
        "blank-review-draft",
        "server-ac-understanding-rating",
        "fsrs-next-date",
        "reload-persistence",
      ],
    }, null, 2));
  }
};
