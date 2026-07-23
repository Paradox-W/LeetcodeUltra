"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const { CARL_FOUNDATION_V1, validateCourse } = require("../out/src/studyPlan/CourseCatalog");
const { FsrsReviewScheduler } = require("../out/src/studyPlan/ReviewScheduler");
const engine = require("../out/src/studyPlan/StudyPlanEngine");

const tests = [];

function test(name, body) {
  tests.push({ name, body });
}

function config(now) {
  return { ...engine.defaultStudyPlanConfig(now), startDate: engine.localDateKey(now) };
}

function create(now) {
  return engine.createStudyPlan(config(now), now);
}

function understood() {
  return { pattern: true, invariant: true, complexity: true, edgeCases: true };
}

function addTask(document, date, options = {}) {
  const fid = options.fid || "704";
  const task = {
    id: `${engine.localDateKey(date)}-${fid}-${Math.random()}`,
    assignmentDate: engine.localDateKey(date),
    fid,
    mode: options.mode || "review",
    state: options.state || "active",
    requiresFullRewrite: options.fullRewrite !== false,
    requiresServerAccepted: options.requiresServerAccepted !== false,
    serverAccepted: options.serverAccepted === true,
    hints: { direction: false, invariant: false, pseudocode: false, fullSolution: !!options.fullSolution },
    understanding: understood(),
    estimatedMinutes: 35,
    startedAt: date.toISOString(),
  };
  document.assignments[task.assignmentDate] = { date: task.assignmentDate, tasks: [task], generatedAt: date.toISOString() };
  return task;
}

test("课程包含恰好 125 道唯一核心题和固定迁移池", () => {
  assert.deepStrictEqual(validateCourse(CARL_FOUNDATION_V1), []);
  assert.strictEqual(CARL_FOUNDATION_V1.core.length, 125);
  assert.strictEqual(new Set(CARL_FOUNDATION_V1.core.map((item) => item.fid)).size, 125);
  assert.deepStrictEqual(CARL_FOUNDATION_V1.migrationPool.map((item) => item.fid), [
    "283", "643", "724", "2215", "872", "1448", "841", "994", "338", "1268", "901", "1004",
  ]);
  assert.strictEqual(CARL_FOUNDATION_V1.core[0].fid, "704");
  assert.strictEqual(CARL_FOUNDATION_V1.core[124].fid, "136");
  assert(CARL_FOUNDATION_V1.core.some((item) => item.heavy));
  assert(CARL_FOUNDATION_V1.core.every((item) => item.comparisonGroup && item.topic));
});

test("版本化 JSON 资源与课程题号同步", () => {
  const resource = JSON.parse(fs.readFileSync(path.join(__dirname, "../resources/study-plan/carl-foundation-v1.json"), "utf8"));
  const ids = resource.coreByWeek.flat().map(String);
  assert.strictEqual(ids.length, 125);
  assert.deepStrictEqual(ids, CARL_FOUNDATION_V1.core.map((item) => item.fid));
  assert(resource.disclaimer.includes("非官方"));
  assert.strictEqual(resource.sources.length, 8);
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
  assert.strictEqual(packageJson.dependencies["fsrs.js"], "1.2.2");
  assert.strictEqual(packageJson.engines.vscode, "^1.57.0");
});

test("FSRS 四种评分包含分钟级复述和跨日复习", () => {
  const scheduler = new FsrsReviewScheduler(0.9, 365);
  const now = new Date("2026-07-20T08:00:00.000Z");
  const preview = scheduler.preview(undefined, now);
  assert.deepStrictEqual(preview.map((item) => item.rating), ["again", "hard", "good", "easy"]);
  assert(preview.slice(0, 3).every((item) => item.minuteLevel));
  assert.strictEqual(preview[3].minuteLevel, false);
  assert(preview.every((item) => item.intervalDays <= 365));
});

test("FSRS 可重启反序列化并限制最大间隔 365 天", () => {
  const scheduler = new FsrsReviewScheduler(0.9, 365);
  const now = new Date("2026-07-20T08:00:00.000Z");
  const first = scheduler.rate(undefined, "easy", now);
  const restored = JSON.parse(JSON.stringify(first.card));
  const later = new Date("2027-07-20T08:00:00.000Z");
  const next = scheduler.preview(restored, later);
  assert(next.every((item) => item.intervalDays <= 365));
  restored.due = "2026-07-19T08:00:00.000Z";
  assert.strictEqual(scheduler.isDue(restored, now), true);
});

test("本地日期键跨 DST 仍按日历日期生成", () => {
  const before = new Date(2026, 2, 8, 0, 30);
  const after = new Date(2026, 2, 9, 0, 30);
  assert.notStrictEqual(engine.localDateKey(before), engine.localDateKey(after));
});

test("每日计划最多三题、最多两道新题", () => {
  const now = new Date(2026, 6, 20, 9, 0);
  const document = create(now);
  const assignment = engine.buildDailyAssignment(document, now);
  assert(assignment.tasks.length <= 3);
  assert(assignment.tasks.filter((task) => task.mode === "new" || task.mode === "migration").length <= 2);
});

test("复习不计入配置题量时仍保持三题绝对上限", () => {
  const now = new Date(2026, 6, 20, 9, 0);
  const document = create(now);
  document.config.dailyProblemLimit = 2;
  document.config.reviewsCountTowardLimit = false;
  const scheduler = new FsrsReviewScheduler();
  document.progress["704"].fsrsCard = scheduler.rate(undefined, "easy", new Date(2026, 6, 1)).card;
  document.progress["704"].fsrsCard.due = new Date(2026, 6, 19).toISOString();
  const assignment = engine.buildDailyAssignment(document, now, scheduler);
  assert(assignment.tasks.length <= 3);
  assert(assignment.tasks.filter((task) => task.mode === "new" || task.mode === "migration").length <= 2);
});

test("周日不排新题且只显示最多两项复习", () => {
  const sunday = new Date(2026, 6, 19, 9, 0);
  const document = create(sunday);
  const scheduler = new FsrsReviewScheduler();
  ["704", "27", "977"].forEach((fid) => {
    document.progress[fid].fsrsCard = scheduler.rate(undefined, "easy", new Date(2026, 6, 1)).card;
    document.progress[fid].fsrsCard.due = new Date(2026, 6, 18).toISOString();
  });
  const assignment = engine.buildDailyAssignment(document, sunday, scheduler);
  assert(assignment.tasks.length <= 2);
  assert(assignment.tasks.every((task) => task.mode !== "new" && task.mode !== "migration"));
});

test("三道逾期会暂停新题，完整复习预算不超过 45 分钟", () => {
  const now = new Date(2026, 6, 20, 9, 0);
  const document = create(now);
  const scheduler = new FsrsReviewScheduler();
  ["704", "27", "977"].forEach((fid) => {
    const progress = document.progress[fid];
    progress.fsrsCard = scheduler.rate(undefined, "hard", new Date(2026, 6, 1)).card;
    progress.fsrsCard.due = new Date(2026, 6, 19).toISOString();
    progress.fsrsCard.scheduled_days = 30;
  });
  const assignment = engine.buildDailyAssignment(document, now, scheduler);
  assert(assignment.newProblemsPausedReason.includes("积压"));
  assert.strictEqual(assignment.tasks.filter((task) => task.mode === "new").length, 0);
  assert(assignment.tasks.filter((task) => task.requiresFullRewrite).reduce((sum, task) => sum + task.estimatedMinutes, 0) <= 45);
});

test("重题日最多一道新题", () => {
  const now = new Date(2026, 6, 20, 9, 0);
  const document = create(now);
  const firstHeavyIndex = document.course.core.findIndex((item) => item.heavy);
  document.course.core.slice(0, firstHeavyIndex).forEach((item) => { document.progress[item.fid].status = "review"; });
  const assignment = engine.buildDailyAssignment(document, now);
  const newTasks = assignment.tasks.filter((task) => task.mode === "new" || task.mode === "migration");
  assert.strictEqual(newTasks.length, 1);
});

test("暂停计划不生成新任务", () => {
  const now = new Date(2026, 6, 20, 9, 0);
  const document = create(now);
  document.paused = true;
  const assignment = engine.buildDailyAssignment(document, now);
  assert.strictEqual(assignment.tasks.length, 0);
  assert(assignment.newProblemsPausedReason.includes("暂停"));
});

test("遗漏任务只顺延且仍遵守每日上限", () => {
  const monday = new Date(2026, 6, 20, 9, 0);
  const document = create(monday);
  const first = engine.buildDailyAssignment(document, monday);
  first.tasks[0].state = "active";
  first.tasks[1].state = "pending";
  const tuesday = new Date(2026, 6, 21, 9, 0);
  const next = engine.buildDailyAssignment(document, tuesday);
  assert(next.tasks.length <= 3);
  assert.strictEqual(next.tasks[0].deferredReason, `由 ${first.date} 顺延`);
  assert(first.tasks.slice(0, 2).every((task) => task.state === "deferred"));
  assert(next.tasks.filter((task) => task.mode === "new" || task.mode === "migration").length <= 2);
});

test("不可用核心题由同主题迁移题替补，活动计划不会被远程变化重排", () => {
  const now = new Date(2026, 6, 20, 9, 0);
  const document = create(now);
  engine.reconcileProblemMetadata(document, [{
    fid: "704", qid: "704", name: "Binary Search", difficulty: "Easy", locked: true, accepted: false, available: false,
  }], now);
  const assignment = engine.buildDailyAssignment(document, now);
  assert.strictEqual(assignment.tasks[0].sourceFid, "704");
  assert.strictEqual(assignment.tasks[0].fid, "283");
  assert.strictEqual(assignment.tasks[0].mode, "migration");
  engine.reconcileProblemMetadata(document, [{
    fid: "27", qid: "27", name: "Remove Element", difficulty: "Easy", locked: true, accepted: false, available: false,
  }], new Date(now.getTime() + 1000));
  assert.strictEqual(engine.buildDailyAssignment(document, now), assignment);
});

test("历史 AC 题转为诊断复习，不直接算掌握", () => {
  const now = new Date(2026, 6, 20, 9, 0);
  const document = create(now);
  engine.reconcileProblemMetadata(document, [{
    fid: "704", qid: "704", name: "Binary Search", difficulty: "Easy", locked: false, accepted: true, available: true,
  }], now);
  assert.strictEqual(document.progress["704"].status, "diagnosis");
  assert.strictEqual(document.progress["704"].mastered, false);
  const assignment = engine.buildDailyAssignment(document, now);
  assert.strictEqual(assignment.tasks[0].mode, "diagnostic");
});

test("仅服务器 submit AC 推进；测试、失败和重复事件不推进", () => {
  const now = new Date(2026, 6, 20, 9, 0);
  const document = create(now);
  const task = addTask(document, now, { mode: "new" });
  assert.strictEqual(engine.applySubmitEvent(document, { fid: "704", sub_type: "test", accepted: true }, now), false);
  assert.strictEqual(engine.applySubmitEvent(document, { fid: "704", sub_type: "submit", accepted: false, statusCode: 500 }, now), false);
  assert.strictEqual(task.serverAccepted, false);
  assert.strictEqual(engine.applySubmitEvent(document, { fid: "704", sub_type: "submit", accepted: true, submission_id: "s1" }, now), true);
  assert.strictEqual(task.state, "awaiting-rating");
  assert.strictEqual(engine.applySubmitEvent(document, { fid: "704", sub_type: "submit", accepted: true, submission_id: "s1" }, now), false);
});

test("计划外 AC 只标记待诊断，不直接推进调度", () => {
  const now = new Date(2026, 6, 20, 9, 0);
  const document = create(now);
  assert.strictEqual(engine.applySubmitEvent(document, { fid: "704", sub_type: "submit", accepted: true }, now), true);
  assert.strictEqual(document.progress["704"].pendingDiagnosis, true);
  assert.strictEqual(document.progress["704"].fsrsCard, undefined);
});

test("顺利和迁移受服务器 AC、理解检查和题解使用限制", () => {
  const now = new Date(2026, 6, 20, 9, 0);
  const document = create(now);
  const task = addTask(document, now, { serverAccepted: false });
  assert(engine.canRateTask(task, "good").includes("服务器"));
  task.serverAccepted = true;
  task.hints.fullSolution = true;
  assert(engine.canRateTask(task, "easy").includes("完整题解"));
  task.understanding.edgeCases = false;
  assert(engine.canRateTask(task, "hard").includes("理解检查"));
});

test("一次 AC 不掌握；两次跨日成功和 7 天完整重写后掌握；lapse 会重新打开", () => {
  const day0 = new Date("2026-07-20T08:00:00.000Z");
  const document = create(day0);
  let task = addTask(document, day0, { mode: "new", serverAccepted: true });
  document.progress["704"].historicalAccepted = true;
  engine.rateTask(document, task.id, "good", day0);
  assert.strictEqual(document.progress["704"].mastered, false);

  const day1 = new Date("2026-07-21T08:00:00.000Z");
  task = addTask(document, day1, { mode: "review", serverAccepted: true });
  engine.rateTask(document, task.id, "good", day1);
  assert.strictEqual(document.progress["704"].mastered, false);

  document.progress["704"].fsrsCard.scheduled_days = 7;
  const day8 = new Date("2026-07-28T08:00:00.000Z");
  task = addTask(document, day8, { mode: "review", serverAccepted: true, fullRewrite: true });
  engine.rateTask(document, task.id, "good", day8);
  assert.strictEqual(document.progress["704"].hasSevenDayRewrite, true);
  assert.strictEqual(document.progress["704"].mastered, true);

  const day9 = new Date("2026-07-29T08:00:00.000Z");
  task = addTask(document, day9, { mode: "review", serverAccepted: false });
  engine.rateTask(document, task.id, "again", day9);
  assert.strictEqual(document.progress["704"].mastered, false);
  assert.strictEqual(document.progress["704"].status, "review");
});

test("课程快照与活动计划创建后相互隔离", () => {
  const now = new Date(2026, 6, 20, 9, 0);
  const document = create(now);
  document.course.core[0].topic = "local snapshot";
  assert.notStrictEqual(CARL_FOUNDATION_V1.core[0].topic, "local snapshot");
});

test("原子写入、损坏备份和草稿保留规则", () => {
  const originalLoad = Module._load;
  const vscodeStub = { workspace: {} };
  Module._load = function patched(request, parent, isMain) {
    if (request === "vscode") return vscodeStub;
    return originalLoad.call(this, request, parent, isMain);
  };
  const storage = require("../out/src/studyPlan/StudyPlanStorage");
  Module._load = originalLoad;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lcpr-study-plan-core-"));
  try {
    const planPath = path.join(root, ".lcpr_data", "study-plan.json");
    const bricksPath = path.join(root, ".lcpr_data", "bricks.json");
    fs.mkdirSync(path.dirname(bricksPath), { recursive: true });
    fs.writeFileSync(bricksPath, "legacy-bricks", "utf8");
    storage.writeJsonAtomic(planPath, { schemaVersion: 1, course: {}, progress: {}, assignments: {} });
    assert.strictEqual(storage.loadStudyPlanFile(planPath).recoveredFromCorruption, false);
    assert.strictEqual(fs.readFileSync(bricksPath, "utf8"), "legacy-bricks");
    assert.strictEqual(fs.readdirSync(path.dirname(planPath)).some((name) => name.endsWith(".tmp")), false);
    const globalStorage = new storage.StudyPlanStorage({ globalStorageUri: { fsPath: path.join(root, "global") } });
    assert.strictEqual(globalStorage.filePath, path.join(root, "global", "study-plan.json"));
    fs.writeFileSync(planPath, "broken", "utf8");
    const recovered = storage.loadStudyPlanFile(planPath);
    assert.strictEqual(recovered.recoveredFromCorruption, true);
    assert(fs.existsSync(recovered.backupPath));

    const draftDir = path.join(root, "study-review", "704");
    fs.mkdirSync(draftDir, { recursive: true });
    const files = [];
    for (let index = 0; index < 6; index++) {
      const file = path.join(draftDir, `${index}.cpp`);
      fs.writeFileSync(file, String(index));
      fs.utimesSync(file, new Date(2026, 0, index + 1), new Date(2026, 0, index + 1));
      files.push(file);
    }
    storage.pruneReviewDrafts(draftDir, [files[0]], 3);
    assert(fs.existsSync(files[0]), "受保护的打开或未保存文件不得删除");
    assert.strictEqual(fs.readdirSync(draftDir).length, 4);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Webview 使用主题变量、键盘原生控件和中文 IME 保护", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/studyPlan/StudyPlanModule.ts"), "utf8");
  assert(source.includes("var(--vscode-foreground)"));
  assert(source.includes("var(--vscode-input-background)"));
  assert(source.includes("compositionstart"));
  assert(source.includes("compositionend"));
  assert(source.includes("data-understanding"));
  assert(source.includes("data-rating"));
  assert(source.includes("服务器 AC"));
});

test("Webview 横向拖动时使用流式排版", () => {
  const studySource = fs.readFileSync(path.join(__dirname, "../src/studyPlan/StudyPlanModule.ts"), "utf8");
  const loginSource = fs.readFileSync(path.join(__dirname, "../src/auth/BrowserLoginService.ts"), "utf8");

  assert(studySource.includes("grid-template-columns:repeat(auto-fit,minmax(min(100%,112px),1fr))"));
  assert(!studySource.includes("grid-template-columns:repeat(4,1fr)"));

  assert(loginSource.includes("grid-template-columns: clamp(50px, 28vw, 110px) 1px minmax(0, 1fr)"));
  assert(loginSource.includes("grid-template-columns: repeat(auto-fit, minmax(min(100%, 76px), 1fr))"));
  assert(loginSource.includes("overflow-y: auto"));
  assert(!loginSource.includes("grid-template-columns: 110px 1px minmax(0, 1fr)"));
  assert(!loginSource.includes("grid-template-columns: 84px 1px minmax(0, 1fr)"));
  assert(!loginSource.includes("grid-template-columns: repeat(4, minmax(0, 1fr))"));
  assert(!loginSource.includes("width: min(100%, 393px)"));
  assert(!loginSource.includes("\n      height: 100vh"));
});

(async () => {
  let failed = 0;
  for (const entry of tests) {
    try {
      await entry.body();
      console.log(`ok - ${entry.name}`);
    } catch (error) {
      failed++;
      console.error(`not ok - ${entry.name}`);
      console.error(error && error.stack || error);
    }
  }
  if (failed) {
    process.exitCode = 1;
  } else {
    console.log(`study plan core tests passed: ${tests.length}`);
  }
})();
