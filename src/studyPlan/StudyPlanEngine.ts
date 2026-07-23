import { CARL_FOUNDATION_V1 } from "./CourseCatalog";
import { FsrsReviewScheduler } from "./ReviewScheduler";
import {
  EMPTY_HINTS,
  EMPTY_UNDERSTANDING,
  ReviewScheduler,
  StudyCourseSnapshot,
  StudyDailyAssignment,
  StudyPlanConfig,
  StudyPlanDocument,
  StudyProblemMetadata,
  StudyProblemProgress,
  StudyRating,
  StudyReviewRecord,
  StudySubmitEvent,
  StudyTaskMode,
  StudyTaskSession,
  StudyUnderstandingCheck,
} from "./StudyPlanTypes";

const DAY_MS = 24 * 60 * 60 * 1000;

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function nextMonday(now: Date): string {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = ((8 - next.getDay()) % 7) || 7;
  next.setDate(next.getDate() + days);
  return localDateKey(next);
}

export function defaultStudyPlanConfig(now = new Date()): StudyPlanConfig {
  return {
    dailyMinutes: 120,
    dailyProblemLimit: 3,
    reviewsCountTowardLimit: true,
    startDate: nextMonday(now),
    sundayRest: true,
    targetRetention: 0.9,
    maximumIntervalDays: 365,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function newProgress(fid: string): StudyProblemProgress {
  return {
    fid,
    status: "not-started",
    historicalAccepted: false,
    pendingDiagnosis: false,
    mastered: false,
    successfulCrossDayReviews: 0,
    hasSevenDayRewrite: false,
    reviewHistory: [],
    seenSubmissionIds: [],
  };
}

export function createStudyPlan(
  config: StudyPlanConfig,
  now: Date,
  course: StudyCourseSnapshot = CARL_FOUNDATION_V1
): StudyPlanDocument {
  const progress: { [fid: string]: StudyProblemProgress } = {};
  course.core.forEach((problem) => {
    progress[problem.fid] = newProgress(problem.fid);
  });
  course.migrationPool.forEach((problem) => {
    progress[problem.fid] = newProgress(problem.fid);
  });
  return {
    schemaVersion: 1,
    course: clone(course),
    config: { ...config, dailyProblemLimit: Math.min(3, Math.max(1, config.dailyProblemLimit)) },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    paused: false,
    progress,
    assignments: {},
    metadata: {},
  };
}

function createSession(
  date: string,
  fid: string,
  mode: StudyTaskMode,
  now: Date,
  options: {
    sourceFid?: string;
    dueAt?: string;
    fullRewrite?: boolean;
    requiresServerAccepted?: boolean;
    estimatedMinutes?: number;
  } = {}
): StudyTaskSession {
  const suffix = Math.random().toString(36).slice(2, 8);
  return {
    id: `${date}-${fid}-${now.getTime()}-${suffix}`,
    assignmentDate: date,
    fid,
    sourceFid: options.sourceFid,
    mode,
    state: "pending",
    dueAt: options.dueAt,
    requiresFullRewrite: !!options.fullRewrite,
    requiresServerAccepted: options.requiresServerAccepted !== false,
    serverAccepted: false,
    hints: { ...EMPTY_HINTS },
    understanding: { ...EMPTY_UNDERSTANDING },
    estimatedMinutes: options.estimatedMinutes || (options.fullRewrite ? 35 : 30),
  };
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function differenceInCalendarDays(left: Date, right: Date): number {
  return Math.round((startOfLocalDay(left).getTime() - startOfLocalDay(right).getTime()) / DAY_MS);
}

function isFullRewriteDue(progress: StudyProblemProgress): boolean {
  if (!progress.fsrsCard) {
    return true;
  }
  const interval = progress.fsrsCard.scheduled_days;
  const last = progress.reviewHistory[progress.reviewHistory.length - 1];
  return interval >= 30 || (!progress.hasSevenDayRewrite && interval >= 7) || !!last && (last.rating === "again" || last.rating === "hard");
}

function isProblemUnavailable(document: StudyPlanDocument, fid: string): boolean {
  const metadata = document.metadata[fid];
  return !!metadata && !metadata.available;
}

function chooseReplacement(document: StudyPlanDocument, sourceFid: string): string | undefined {
  const source = document.course.core.find((problem) => problem.fid === sourceFid);
  if (!source) {
    return undefined;
  }
  return document.course.migrationPool.find((candidate) => {
    const progress = document.progress[candidate.fid];
    return candidate.topic === source.topic && progress && progress.status === "not-started" && !isProblemUnavailable(document, candidate.fid);
  })?.fid;
}

function overdueProgress(document: StudyPlanDocument, now: Date, scheduler: ReviewScheduler): StudyProblemProgress[] {
  return Object.keys(document.progress)
    .map((fid) => document.progress[fid])
    .filter((progress) => progress.pendingDiagnosis || scheduler.isDue(progress.fsrsCard, now))
    .sort((left, right) => {
      if (left.pendingDiagnosis !== right.pendingDiagnosis) {
        return left.pendingDiagnosis ? -1 : 1;
      }
      const leftDue = left.fsrsCard ? new Date(left.fsrsCard.due).getTime() : 0;
      const rightDue = right.fsrsCard ? new Date(right.fsrsCard.due).getTime() : 0;
      return leftDue - rightDue;
    });
}

function plannedCoreProblems(document: StudyPlanDocument): number {
  return document.course.core.filter((problem) => document.progress[problem.fid].historicalAccepted).length;
}

function expectedProgress(document: StudyPlanDocument, now: Date): number {
  const startedAt = new Date(`${document.config.startDate}T00:00:00`);
  const elapsedWeeks = Math.max(0, Math.floor(differenceInCalendarDays(now, startedAt) / 7));
  return Math.min(125, Math.ceil(((elapsedWeeks + 1) / 16) * 125));
}

export function buildDailyAssignment(
  document: StudyPlanDocument,
  now: Date,
  scheduler: ReviewScheduler = new FsrsReviewScheduler(document.config.targetRetention, document.config.maximumIntervalDays)
): StudyDailyAssignment {
  const date = localDateKey(now);
  const existing = document.assignments[date];
  if (existing) {
    return existing;
  }
  const assignment: StudyDailyAssignment = { date, tasks: [], generatedAt: now.toISOString() };
  document.assignments[date] = assignment;
  if (document.paused || date < document.config.startDate) {
    assignment.newProblemsPausedReason = document.paused ? "计划已暂停" : "尚未到开始日期";
    return assignment;
  }

  const sunday = now.getDay() === 0;
  const configuredLimit = Math.min(3, Math.max(1, document.config.dailyProblemLimit));
  const taskLimit = sunday && document.config.sundayRest
    ? Math.min(2, configuredLimit)
    : document.config.reviewsCountTowardLimit ? configuredLimit : 3;
  const previousDates = Object.keys(document.assignments).filter((key) => key < date).sort();
  const carriedFids = new Set<string>();
  for (const previousDate of previousDates) {
    for (const previousTask of document.assignments[previousDate].tasks) {
      const unfinished = previousTask.state === "pending" || previousTask.state === "active" || previousTask.state === "awaiting-rating";
      const problemKey = previousTask.sourceFid || previousTask.fid;
      const sundayNewTask = sunday && document.config.sundayRest && (previousTask.mode === "new" || previousTask.mode === "migration");
      if (!unfinished || sundayNewTask || carriedFids.has(problemKey) || assignment.tasks.length >= taskLimit) {
        continue;
      }
      const carriedTask: StudyTaskSession = {
        ...previousTask,
        id: `${date}-${previousTask.fid}-carry-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
        assignmentDate: date,
        deferredReason: `由 ${previousDate} 顺延`,
      };
      previousTask.state = "deferred";
      previousTask.deferredReason = `顺延至 ${date}`;
      assignment.tasks.push(carriedTask);
      carriedFids.add(problemKey);
    }
  }
  const due = overdueProgress(document, now, scheduler);
  let fullReviewMinutes = 0;
  for (const progress of due) {
    if (assignment.tasks.length >= taskLimit) {
      break;
    }
    if (carriedFids.has(progress.fid)) {
      continue;
    }
    const diagnostic = progress.pendingDiagnosis && !progress.fsrsCard;
    const fullRewrite = diagnostic || isFullRewriteDue(progress);
    const estimatedMinutes = fullRewrite ? 35 : 10;
    if (fullRewrite && fullReviewMinutes + estimatedMinutes > 45) {
      continue;
    }
    if (fullRewrite) {
      fullReviewMinutes += estimatedMinutes;
    }
    assignment.tasks.push(createSession(date, progress.replacementFid || progress.fid, diagnostic ? "diagnostic" : fullRewrite ? "review" : "recall", now, {
      sourceFid: progress.replacementFid ? progress.fid : undefined,
      dueAt: progress.fsrsCard?.due,
      fullRewrite,
      requiresServerAccepted: fullRewrite,
      estimatedMinutes,
    }));
    carriedFids.add(progress.fid);
  }

  if (sunday && document.config.sundayRest) {
    assignment.newProblemsPausedReason = "周日休息，仅保留可选到期复习";
    return assignment;
  }
  if (due.length >= 3) {
    assignment.newProblemsPausedReason = "到期积压达到 3 道，暂停新题";
    return assignment;
  }

  const carriedNewCount = assignment.tasks.filter((task) => task.mode === "new" || task.mode === "migration").length;
  const carriedHeavy = assignment.tasks.some((task) => {
    const sourceFid = task.sourceFid || task.fid;
    return (task.mode === "new" || task.mode === "migration") && !!document.course.core.find((problem) => problem.fid === sourceFid)?.heavy;
  });
  const configuredNewLimit = Math.min(2, configuredLimit);
  let newBudget = carriedHeavy ? 0 : Math.min(Math.max(0, configuredNewLimit - carriedNewCount), Math.max(0, taskLimit - assignment.tasks.length));
  if (now.getDay() === 6) {
    newBudget = Math.min(1, newBudget);
  }
  const remainingMinutes = Math.max(0, document.config.dailyMinutes - assignment.tasks.reduce((sum, task) => sum + task.estimatedMinutes, 0));
  if (remainingMinutes < 20) {
    newBudget = 0;
    assignment.newProblemsPausedReason = "今日复习已占满学习预算";
  }

  const candidates = document.course.core.filter((problem) => document.progress[problem.fid].status === "not-started");
  for (const candidate of candidates) {
    if (newBudget <= 0 || assignment.tasks.length >= taskLimit) {
      break;
    }
    if (carriedFids.has(candidate.fid)) {
      continue;
    }
    if (candidate.heavy && assignment.tasks.some((task) => task.mode === "new" || task.mode === "migration")) {
      continue;
    }
    let fid = candidate.fid;
    let mode: StudyTaskMode = "new";
    if (isProblemUnavailable(document, fid)) {
      const replacement = chooseReplacement(document, fid);
      if (!replacement) {
        document.progress[fid].unavailableReason = document.metadata[fid]?.locked ? "题目为会员题" : "当前站点不可用";
        continue;
      }
      fid = replacement;
      mode = "migration";
      document.progress[candidate.fid].replacementFid = fid;
    }
    assignment.tasks.push(createSession(date, fid, mode, now, {
      sourceFid: fid === candidate.fid ? undefined : candidate.fid,
      fullRewrite: true,
      requiresServerAccepted: true,
      estimatedMinutes: candidate.heavy ? 45 : 35,
    }));
    newBudget = candidate.heavy ? 0 : newBudget - 1;
  }

  if (now.getDay() === 6 && due.length === 0 && plannedCoreProblems(document) >= expectedProgress(document, now)) {
    const migration = document.course.migrationPool.find((problem) => document.progress[problem.fid].status === "not-started");
    if (migration && assignment.tasks.length < taskLimit) {
      assignment.tasks.push(createSession(date, migration.fid, "migration", now, {
        fullRewrite: true,
        requiresServerAccepted: true,
        estimatedMinutes: 35,
      }));
    }
  }
  document.updatedAt = now.toISOString();
  return assignment;
}

export function reconcileProblemMetadata(
  document: StudyPlanDocument,
  metadata: StudyProblemMetadata[],
  now: Date
): void {
  metadata.forEach((problem) => {
    document.metadata[problem.fid] = { ...problem };
    const progress = document.progress[problem.fid];
    if (!progress) {
      return;
    }
    if (problem.accepted && !progress.historicalAccepted) {
      progress.historicalAccepted = true;
      progress.pendingDiagnosis = true;
      progress.status = "diagnosis";
    }
    if (!problem.available) {
      progress.unavailableReason = problem.locked ? "题目为会员题" : "当前站点不可用";
    }
  });
  document.updatedAt = now.toISOString();
}

function findActiveTask(document: StudyPlanDocument, fid: string): StudyTaskSession | undefined {
  const assignments = Object.keys(document.assignments).sort().reverse();
  for (const date of assignments) {
    const task = document.assignments[date].tasks.find((candidate) =>
      (candidate.fid === fid || candidate.sourceFid === fid) &&
      (candidate.state === "active" || candidate.state === "awaiting-rating")
    );
    if (task) {
      return task;
    }
  }
  return undefined;
}

export function applySubmitEvent(document: StudyPlanDocument, event: StudySubmitEvent, now: Date): boolean {
  if (event.sub_type !== "submit" || event.accepted !== true) {
    return false;
  }
  let fid = String(event.fid || "");
  if (!fid && event.qid) {
    const candidate = Object.keys(document.metadata).find((key) => document.metadata[key].qid === String(event.qid));
    fid = candidate || "";
  }
  if (!fid && event.id) {
    fid = String(event.id);
  }
  const active = findActiveTask(document, fid);
  const submittedProgress = document.progress[fid];
  const progress = active && active.sourceFid ? document.progress[active.sourceFid] : submittedProgress;
  if (!fid || !progress) {
    return false;
  }
  const submissionId = String(event.submission_id || "");
  if (submissionId && progress.seenSubmissionIds.indexOf(submissionId) >= 0) {
    return false;
  }
  if (submissionId) {
    progress.seenSubmissionIds.push(submissionId);
    progress.seenSubmissionIds = progress.seenSubmissionIds.slice(-30);
  }
  progress.historicalAccepted = true;
  if (submittedProgress && submittedProgress !== progress) {
    submittedProgress.historicalAccepted = true;
  }
  if (active) {
    active.serverAccepted = true;
    active.submissionId = submissionId || active.submissionId;
    active.state = "awaiting-rating";
    progress.status = "awaiting-assessment";
  } else {
    progress.pendingDiagnosis = true;
    progress.status = "diagnosis";
  }
  document.updatedAt = now.toISOString();
  return true;
}

export function allUnderstandingChecked(value: StudyUnderstandingCheck): boolean {
  return value.pattern && value.invariant && value.complexity && value.edgeCases;
}

export function canRateTask(task: StudyTaskSession, rating: StudyRating): string | undefined {
  if (task.state !== "awaiting-rating" && task.state !== "active") {
    return "任务尚未进入自评阶段";
  }
  if (!allUnderstandingChecked(task.understanding)) {
    return "请先完成四项理解检查";
  }
  if ((rating === "good" || rating === "easy") && task.requiresServerAccepted && !task.serverAccepted) {
    return "顺利或迁移必须先通过服务器提交";
  }
  if (rating === "easy" && task.hints.fullSolution) {
    return "查看完整题解后不能评为迁移";
  }
  return undefined;
}

export function rateTask(
  document: StudyPlanDocument,
  sessionId: string,
  rating: StudyRating,
  now: Date,
  scheduler: ReviewScheduler = new FsrsReviewScheduler(document.config.targetRetention, document.config.maximumIntervalDays)
): StudyReviewRecord {
  let task: StudyTaskSession | undefined;
  Object.keys(document.assignments).some((date) => {
    task = document.assignments[date].tasks.find((candidate) => candidate.id === sessionId);
    return !!task;
  });
  if (!task) {
    throw new Error("找不到学习任务");
  }
  const blocked = canRateTask(task, rating);
  if (blocked) {
    throw new Error(blocked);
  }
  const sourceFid = task.sourceFid || task.fid;
  const progress = document.progress[sourceFid] || document.progress[task.fid];
  const priorIntervalDays = progress.fsrsCard?.scheduled_days || 0;
  const scheduled = scheduler.rate(progress.fsrsCard, rating, now);
  progress.fsrsCard = scheduled.card;
  progress.lastReviewAt = now.toISOString();
  progress.pendingDiagnosis = false;
  const review: StudyReviewRecord = {
    sessionId: task.id,
    fid: task.fid,
    mode: task.mode,
    startedAt: task.startedAt || now.toISOString(),
    completedAt: now.toISOString(),
    rating,
    hints: { ...task.hints },
    serverAccepted: task.serverAccepted,
    submissionId: task.submissionId,
    understanding: { ...task.understanding },
    fullRewrite: task.requiresFullRewrite,
    priorIntervalDays,
    scheduledDue: scheduled.due,
    minuteLevel: scheduled.minuteLevel,
  };
  progress.reviewHistory.push(review);
  progress.reviewHistory = progress.reviewHistory.slice(-100);

  if (rating === "again" || rating === "hard") {
    progress.mastered = false;
    progress.successfulCrossDayReviews = 0;
    progress.status = "review";
  } else {
    const reviewDate = localDateKey(now);
    const priorDate = progress.lastSuccessfulReviewDate;
    if (priorDate && priorDate !== reviewDate) {
      progress.successfulCrossDayReviews++;
    } else if (!priorDate && progress.historicalAccepted && task.mode !== "new") {
      progress.successfulCrossDayReviews = 1;
    }
    progress.lastSuccessfulReviewDate = reviewDate;
    if (task.requiresFullRewrite && priorIntervalDays >= 7) {
      progress.hasSevenDayRewrite = true;
    }
    progress.mastered = progress.successfulCrossDayReviews >= 2 && progress.hasSevenDayRewrite;
    progress.status = progress.mastered ? "mastered" : "review";
  }
  task.state = "completed";
  task.completedAt = now.toISOString();
  document.updatedAt = now.toISOString();
  return review;
}

export function summarizeProgress(document: StudyPlanDocument): {
  completedCore: number;
  masteredCore: number;
  totalCore: number;
  percent: number;
} {
  const core = document.course.core.map((problem) => document.progress[problem.fid]);
  const completedCore = core.filter((progress) => progress.historicalAccepted).length;
  const masteredCore = core.filter((progress) => progress.mastered).length;
  return {
    completedCore,
    masteredCore,
    totalCore: core.length,
    percent: core.length ? Math.round((completedCore / core.length) * 100) : 0,
  };
}
