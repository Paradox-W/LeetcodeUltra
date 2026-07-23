export type StudyRating = "again" | "hard" | "good" | "easy";

export type StudyProblemStatus =
  | "not-started"
  | "in-progress"
  | "awaiting-assessment"
  | "review"
  | "diagnosis"
  | "mastered";

export type StudyTaskMode = "new" | "review" | "diagnostic" | "recall" | "migration";

export type StudyTaskState = "pending" | "active" | "awaiting-rating" | "completed" | "deferred";

export interface CourseSource {
  label: string;
  url: string;
}

export interface CourseProblem {
  fid: string;
  week: number;
  order: number;
  topic: string;
  heavy: boolean;
  comparisonGroup: string;
}

export interface CourseMigrationProblem {
  fid: string;
  topic: string;
}

export interface StudyCourseSnapshot {
  id: string;
  version: number;
  syncedAt: string;
  disclaimer: string;
  sources: CourseSource[];
  core: CourseProblem[];
  migrationPool: CourseMigrationProblem[];
}

export interface SerializableFsrsCard {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string;
}

export interface SchedulerPreview {
  rating: StudyRating;
  due: string;
  intervalDays: number;
  minuteLevel: boolean;
}

export interface SchedulerRateResult extends SchedulerPreview {
  card: SerializableFsrsCard;
}

export interface ReviewScheduler {
  preview(card: SerializableFsrsCard | undefined, now: Date): SchedulerPreview[];
  rate(card: SerializableFsrsCard | undefined, rating: StudyRating, now: Date): SchedulerRateResult;
  isDue(card: SerializableFsrsCard | undefined, now: Date): boolean;
}

export interface StudyUnderstandingCheck {
  pattern: boolean;
  invariant: boolean;
  complexity: boolean;
  edgeCases: boolean;
}

export interface StudyHintUsage {
  direction: boolean;
  invariant: boolean;
  pseudocode: boolean;
  fullSolution: boolean;
}

export interface StudyReviewRecord {
  sessionId: string;
  fid: string;
  mode: StudyTaskMode;
  startedAt: string;
  completedAt: string;
  rating: StudyRating;
  hints: StudyHintUsage;
  serverAccepted: boolean;
  submissionId?: string;
  understanding: StudyUnderstandingCheck;
  fullRewrite: boolean;
  priorIntervalDays: number;
  scheduledDue: string;
  minuteLevel: boolean;
}

export interface StudyProblemProgress {
  fid: string;
  status: StudyProblemStatus;
  historicalAccepted: boolean;
  pendingDiagnosis: boolean;
  fsrsCard?: SerializableFsrsCard;
  mastered: boolean;
  successfulCrossDayReviews: number;
  hasSevenDayRewrite: boolean;
  lastSuccessfulReviewDate?: string;
  lastReviewAt?: string;
  replacementFid?: string;
  unavailableReason?: string;
  reviewHistory: StudyReviewRecord[];
  seenSubmissionIds: string[];
}

export interface StudyTaskSession {
  id: string;
  assignmentDate: string;
  fid: string;
  sourceFid?: string;
  mode: StudyTaskMode;
  state: StudyTaskState;
  dueAt?: string;
  startedAt?: string;
  completedAt?: string;
  requiresFullRewrite: boolean;
  requiresServerAccepted: boolean;
  serverAccepted: boolean;
  submissionId?: string;
  hints: StudyHintUsage;
  understanding: StudyUnderstandingCheck;
  estimatedMinutes: number;
  deferredReason?: string;
  draftPath?: string;
}

export interface StudyDailyAssignment {
  date: string;
  tasks: StudyTaskSession[];
  generatedAt: string;
  newProblemsPausedReason?: string;
}

export interface StudyPlanConfig {
  dailyMinutes: number;
  dailyProblemLimit: number;
  reviewsCountTowardLimit: boolean;
  startDate: string;
  sundayRest: boolean;
  targetRetention: number;
  maximumIntervalDays: number;
}

export interface StudyProblemMetadata {
  fid: string;
  qid: string;
  name: string;
  difficulty: string;
  locked: boolean;
  accepted: boolean;
  available: boolean;
}

export interface StudyPlanDocument {
  schemaVersion: number;
  course: StudyCourseSnapshot;
  config: StudyPlanConfig;
  createdAt: string;
  updatedAt: string;
  paused: boolean;
  progress: { [fid: string]: StudyProblemProgress };
  assignments: { [date: string]: StudyDailyAssignment };
  metadata: { [fid: string]: StudyProblemMetadata };
}

export interface StudySubmitEvent {
  fid?: string;
  qid?: string;
  id?: string;
  sub_type?: string;
  accepted?: boolean;
  submission_id?: string;
  status?: string;
  submittedAt?: string;
  statusCode?: number;
}

export const EMPTY_UNDERSTANDING: StudyUnderstandingCheck = {
  pattern: false,
  invariant: false,
  complexity: false,
  edgeCases: false,
};
export const EMPTY_HINTS: StudyHintUsage = {
  direction: false,
  invariant: false,
  pseudocode: false,
  fullSolution: false,
};
