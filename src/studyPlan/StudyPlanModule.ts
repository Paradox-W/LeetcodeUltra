import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { BABA, BABAMediator, BABAProxy, BabaStr, BaseCC } from "../BABA";
import { ProblemState } from "../model/ConstDefind";
import { fetchProblemLanguage } from "../utils/ConfigUtils";
import { storageUtils } from "../rpc/utils/storageUtils";
import {
  applySubmitEvent,
  buildDailyAssignment,
  createStudyPlan,
  localDateKey,
  rateTask,
  reconcileProblemMetadata,
  summarizeProgress,
} from "./StudyPlanEngine";
import { StudyPlanStorage, pruneReviewDrafts } from "./StudyPlanStorage";
import {
  StudyPlanDocument,
  StudyPlanConfig,
  StudyProblemMetadata,
  StudyRating,
  StudySubmitEvent,
  StudyTaskSession,
} from "./StudyPlanTypes";

function escapeHtml(value: unknown): string {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

class StudyPlanService {
  private storage?: StudyPlanStorage;
  private document?: StudyPlanDocument;
  private context?: vscode.ExtensionContext;
  private view?: vscode.WebviewView;
  private status = "";

  public initialize(context: vscode.ExtensionContext): void {
    this.context = context;
    this.storage = new StudyPlanStorage(context);
    const loaded = this.storage.load();
    this.document = loaded.document;
    if (loaded.recoveredFromCorruption) {
      this.status = `计划文件损坏，已备份${loaded.backupPath ? `至 ${path.basename(loaded.backupPath)}` : ""}`;
    }
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.render();
    view.webview.onDidReceiveMessage((message) => this.handleMessage(message));
  }

  public getDocument(): StudyPlanDocument | undefined {
    return this.document;
  }

  public refresh(): void {
    if (this.document && this.storage) {
      buildDailyAssignment(this.document, new Date());
      this.storage.save(this.document);
    }
    if (this.view) {
      this.view.webview.html = this.render();
    }
  }

  private persist(): void {
    if (this.document && this.storage) {
      this.document.updatedAt = new Date().toISOString();
      this.storage.save(this.document);
    }
    this.refresh();
  }

  public async createOrResume(config?: Partial<StudyPlanConfig>): Promise<void> {
    if (!this.document) {
      const now = new Date();
      const startDate = (() => {
          const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const days = ((8 - date.getDay()) % 7) || 7;
          date.setDate(date.getDate() + days);
          return localDateKey(date);
        })();
      this.document = createStudyPlan({
        dailyMinutes: Math.min(480, Math.max(30, Number(config?.dailyMinutes) || 120)),
        dailyProblemLimit: Math.min(3, Math.max(1, Number(config?.dailyProblemLimit) || 3)),
        reviewsCountTowardLimit: config?.reviewsCountTowardLimit !== false,
        startDate: config?.startDate || startDate,
        sundayRest: config?.sundayRest !== false,
        targetRetention: 0.9,
        maximumIntervalDays: 365,
      }, now);
      this.persist();
    }
    await vscode.commands.executeCommand("lcpr.studyPlan.open");
  }

  public pause(): void {
    if (!this.document) {
      return;
    }
    this.document.paused = !this.document.paused;
    this.status = this.document.paused ? "计划已暂停" : "计划已恢复";
    this.persist();
  }

  public reset(): void {
    this.document = undefined;
    this.storage?.reset();
    this.status = "计划已重置";
    this.refresh();
  }

  public async openTask(task: StudyTaskSession): Promise<void> {
    if (!this.document || !this.context) {
      return;
    }
    if (task.mode === "recall" && task.dueAt && new Date(task.dueAt).getTime() > Date.now()) {
      this.status = `闭卷复述将在 ${new Date(task.dueAt).toLocaleTimeString()} 到期`;
      this.refresh();
      return;
    }
    const progress = this.document.progress[task.sourceFid || task.fid] || this.document.progress[task.fid];
    if (progress) {
      progress.status = "in-progress";
    }
    if (task.mode === "new" || task.mode === "migration") {
      const node = BABA.getProxy(BabaStr.QuestionDataProxy).getNodeById(task.sourceFid || task.fid);
      if (!node) {
        this.status = "当前题目尚不可用";
        this.refresh();
        return;
      }
      task.state = "active";
      task.startedAt = task.startedAt || new Date().toISOString();
      this.persist();
      await vscode.commands.executeCommand("lcpr.showProblem", node);
      return;
    }
    if (task.mode === "recall") {
      task.state = "active";
      task.startedAt = task.startedAt || new Date().toISOString();
      this.status = "请闭卷复述题型、不变量、复杂度和边界，再完成理解检查。";
      this.persist();
      return;
    }
    const language = await fetchProblemLanguage();
    const extension = storageUtils.getFileExtByLanguage(language || "cpp");
    const folder = path.join(this.context.globalStorageUri.fsPath, "study-review", task.fid);
    fs.mkdirSync(folder, { recursive: true });
    const filePath = path.join(folder, `${task.id}${extension}`);
    if (!fs.existsSync(filePath)) {
      const node = BABA.getProxy(BabaStr.QuestionDataProxy).getNodeById(task.sourceFid || task.fid);
      if (!node) {
        this.status = "当前题目尚不可用";
        this.refresh();
        return;
      }
      const result = await BABA.getProxy(BabaStr.ChildCallProxy).get_instance().showProblem(node, language || "cpp", filePath, false, true);
      if (result !== 100) {
        this.status = "复习模板创建失败";
        this.refresh();
        return;
      }
      storageUtils.writeProblemMeta(filePath, {
        app: "leetcode",
        id: task.sourceFid || task.fid,
        fid: task.sourceFid || task.fid,
        lang: language || "cpp",
      });
    }
    task.state = "active";
    task.startedAt = task.startedAt || new Date().toISOString();
    task.draftPath = filePath;
    this.persist();
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case "create":
        await this.createOrResume(message.config || {});
        break;
      case "pause":
        this.pause();
        break;
      case "reset":
        this.reset();
        break;
      case "refresh":
        this.refresh();
        break;
      case "openTask": {
        const task = this.findTask(String(message.sessionId));
        if (task) {
          await this.openTask(task);
        }
        break;
      }
      case "understanding":
        this.updateUnderstanding(String(message.sessionId), message.value || {});
        break;
      case "hints":
        this.updateHints(String(message.sessionId), message.value || {});
        break;
      case "rate":
        this.rate(String(message.sessionId), message.rating as StudyRating);
        break;
      default:
        break;
    }
  }

  private findTask(sessionId: string): StudyTaskSession | undefined {
    if (!this.document) {
      return undefined;
    }
    for (const date of Object.keys(this.document.assignments)) {
      const task = this.document.assignments[date].tasks.find((candidate) => candidate.id === sessionId);
      if (task) {
        return task;
      }
    }
    return undefined;
  }

  private updateUnderstanding(sessionId: string, value: any): void {
    const task = this.findTask(sessionId);
    if (!task) {
      return;
    }
    task.understanding = {
      pattern: !!value.pattern,
      invariant: !!value.invariant,
      complexity: !!value.complexity,
      edgeCases: !!value.edgeCases,
    };
    this.persist();
  }

  private updateHints(sessionId: string, value: any): void {
    const task = this.findTask(sessionId);
    if (!task) {
      return;
    }
    task.hints = {
      direction: !!value.direction,
      invariant: !!value.invariant,
      pseudocode: !!value.pseudocode,
      fullSolution: !!value.fullSolution,
    };
    this.persist();
  }

  private rate(sessionId: string, rating: StudyRating): void {
    if (!this.document) {
      return;
    }
    try {
      const review = rateTask(this.document, sessionId, rating, new Date());
      if (review.minuteLevel) {
        const sourceTask = this.findTask(sessionId);
        if (sourceTask) {
          sourceTask.id = `${sourceTask.assignmentDate}-${sourceTask.fid}-recall-${Date.now()}`;
          sourceTask.mode = "recall";
          sourceTask.state = "pending";
          sourceTask.dueAt = review.scheduledDue;
          sourceTask.requiresFullRewrite = false;
          sourceTask.requiresServerAccepted = false;
          sourceTask.serverAccepted = false;
          sourceTask.submissionId = undefined;
          sourceTask.hints = { direction: false, invariant: false, pseudocode: false, fullSolution: false };
          sourceTask.understanding = { pattern: false, invariant: false, complexity: false, edgeCases: false };
          sourceTask.estimatedMinutes = 10;
          sourceTask.startedAt = undefined;
          sourceTask.completedAt = undefined;
        }
      }
      this.status = "评分已保存";
      this.persist();
    } catch (error) {
      this.status = error instanceof Error ? error.message : String(error);
      this.refresh();
    }
  }

  public onQuestionDataRebuilt(): void {
    if (!this.document) {
      return;
    }
    const proxy = BABA.getProxy(BabaStr.QuestionDataProxy);
    const problemMap = proxy.getfidMapQuestionData();
    if (!problemMap || problemMap.size === 0) {
      this.status = "等待登录后加载题目元数据";
      this.refresh();
      return;
    }
    const metadata: StudyProblemMetadata[] = [];
    const courseProblems: Array<{ fid: string }> = this.document.course.core.concat(this.document.course.migrationPool as any);
    for (const problem of courseProblems) {
      const node = proxy.getNodeById(problem.fid);
      if (node) {
        metadata.push({
          fid: problem.fid,
          qid: String(node.qid),
          name: node.name,
          difficulty: node.difficulty,
          locked: !!node.locked,
          accepted: node.state === ProblemState.AC,
          available: !node.locked,
        });
      } else {
        metadata.push({ fid: problem.fid, qid: "", name: "", difficulty: "", locked: false, accepted: false, available: false });
      }
    }
    reconcileProblemMetadata(this.document, metadata, new Date());
    this.persist();
  }

  public onSubmit(event: StudySubmitEvent): void {
    if (!this.document) {
      return;
    }
    if (applySubmitEvent(this.document, event, new Date())) {
      this.persist();
    }
  }

  private renderTask(task: StudyTaskSession, document: StudyPlanDocument): string {
    const progress = document.progress[task.sourceFid || task.fid];
    const metadata = document.metadata[task.sourceFid || task.fid] || document.metadata[task.fid];
    const recallWaiting = task.mode === "recall" && task.dueAt && new Date(task.dueAt).getTime() > Date.now();
    const status = recallWaiting ? `◷ 闭卷复述 ${new Date(task.dueAt!).toLocaleTimeString()}` : task.state === "awaiting-rating" ? "! 待自评" : task.state === "completed" ? "✓ 已完成" : task.state === "active" ? "↻ 进行中" : "○ 待开始";
    const dueLabel = task.dueAt && !recallWaiting ? ` · 到期 ${new Date(task.dueAt).toLocaleDateString()}` : "";
    const disabled = task.state === "completed" || recallWaiting ? "disabled" : "";
    return `<li class="task"><div class="task-main"><span class="task-kind">${task.mode === "new" || task.mode === "migration" ? "新题" : "复习"}</span><strong>${escapeHtml(task.fid)}. ${escapeHtml(metadata?.name || "题目元数据加载中")}</strong><span class="difficulty">${escapeHtml(metadata?.difficulty || "-")}</span></div><div class="task-meta"><span aria-label="${status}${dueLabel}">${status}${dueLabel}</span><button data-action="openTask" data-session="${escapeHtml(task.id)}" ${disabled}>开始</button></div>${progress?.pendingDiagnosis ? "<small>计划外 AC：需要诊断复习</small>" : ""}</li>`;
  }

  private renderAssessment(task: StudyTaskSession): string {
    const goodBlocked = task.requiresServerAccepted && !task.serverAccepted;
    const easyBlocked = goodBlocked || task.hints.fullSolution;
    const checked = (value: boolean) => value ? "checked" : "";
    return `<article class="assessment"><strong>${escapeHtml(task.fid)} · 理解检查与自评</strong><div class="checks" data-session="${escapeHtml(task.id)}"><label><input type="checkbox" data-understanding="pattern" ${checked(task.understanding.pattern)}>题型</label><label><input type="checkbox" data-understanding="invariant" ${checked(task.understanding.invariant)}>关键不变量</label><label><input type="checkbox" data-understanding="complexity" ${checked(task.understanding.complexity)}>复杂度</label><label><input type="checkbox" data-understanding="edgeCases" ${checked(task.understanding.edgeCases)}>易错边界</label></div><details><summary>提示使用</summary><div class="checks" data-session="${escapeHtml(task.id)}"><label><input type="checkbox" data-hint="direction" ${checked(task.hints.direction)}>方向</label><label><input type="checkbox" data-hint="invariant" ${checked(task.hints.invariant)}>不变量</label><label><input type="checkbox" data-hint="pseudocode" ${checked(task.hints.pseudocode)}>伪代码</label><label><input type="checkbox" data-hint="fullSolution" ${checked(task.hints.fullSolution)}>完整题解</label></div></details><div class="ratings"><button data-action="rate" data-session="${escapeHtml(task.id)}" data-rating="again">忘记</button><button data-action="rate" data-session="${escapeHtml(task.id)}" data-rating="hard">困难</button><button data-action="rate" data-session="${escapeHtml(task.id)}" data-rating="good" ${goodBlocked ? "disabled" : ""}>顺利</button><button data-action="rate" data-session="${escapeHtml(task.id)}" data-rating="easy" ${easyBlocked ? "disabled" : ""}>迁移</button></div>${goodBlocked ? "<small>完整编码任务需先收到服务器 AC。</small>" : ""}${task.hints.fullSolution ? "<small>已查看完整题解，本次不可评为迁移。</small>" : ""}</article>`;
  }

  private render(): string {
    if (!this.document) {
      return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"></head><body class="vscode-body"><main class="empty"><h2>学习计划</h2><p>用 16 周建立系统的数据结构与算法检索能力。</p><form id="create-form"><label>每天分钟<input name="dailyMinutes" type="number" min="30" max="480" value="120"></label><label>每日题目上限<input name="dailyProblemLimit" type="number" min="1" max="3" value="3"></label><label>开始日期<input name="startDate" type="date"></label><label><input name="reviewsCountTowardLimit" type="checkbox" checked>复习计入题量</label><label><input name="sundayRest" type="checkbox" checked>周日休息</label><button type="submit">创建计划</button></form></main>${this.styles()}<script>${this.script()}</script></body></html>`;
    }
    const now = new Date();
    const assignment = buildDailyAssignment(this.document, now);
    const summary = summarizeProgress(this.document);
    const backlog = Object.keys(this.document.progress).map((fid) => this.document!.progress[fid]).filter((progress) => progress.pendingDiagnosis || (progress.fsrsCard && new Date(progress.fsrsCard.due).getTime() <= now.getTime())).length;
    const assessments = assignment.tasks.filter((task) => task.state === "active" || task.state === "awaiting-rating");
    const displayLimit = this.document.config.reviewsCountTowardLimit ? this.document.config.dailyProblemLimit : 3;
    return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';"></head><body class="vscode-body"><main><header><div><h2>学习计划</h2><p>${escapeHtml(this.document.course.disclaimer)}</p></div><div class="actions"><button data-action="refresh">刷新</button><button data-action="pause">${this.document.paused ? "恢复" : "暂停"}</button><button data-action="reset">重置</button></div></header><section class="stats"><div><b>今日任务</b><strong>${assignment.tasks.length}/${displayLimit}</strong></div><div><b>待自评</b><strong>${assessments.length}</strong></div><div><b>到期积压</b><strong>${backlog}</strong></div><div><b>总进度</b><strong>${summary.completedCore}/${summary.totalCore} (${summary.percent}%)</strong></div></section><section><h3>今日任务 · ${escapeHtml(assignment.date)}</h3>${assignment.newProblemsPausedReason ? `<p class="notice">${escapeHtml(assignment.newProblemsPausedReason)}</p>` : ""}<ul>${assignment.tasks.length ? assignment.tasks.map((task) => this.renderTask(task, this.document!)).join("") : "<li class=\"empty-row\">今天没有安排新题，优先处理到期复习。</li>"}</ul></section>${assessments.length ? `<section><h3>待自评</h3>${assessments.map((task) => this.renderAssessment(task)).join("")}</section>` : ""}<section><h3>本周路径</h3><p>第 ${this.document.course.core.find((problem) => problem.fid === assignment.tasks[0]?.sourceFid || problem.fid === assignment.tasks[0]?.fid)?.week || "-"} 周 · 理论 → 闭卷尝试 → 服务器 AC → 理解检查 → 评分</p></section><p class="status" role="status">${escapeHtml(this.status)}</p></main>${this.styles()}<script>${this.script()}</script></body></html>`;
  }

  private styles(): string {
    return `<style>:root{--lcpr-study-primary:#fff;--lcpr-study-primary-foreground:#111;--lcpr-study-primary-soft:rgba(255,255,255,.1);--lcpr-study-primary-border:rgba(255,255,255,.42)}body.vscode-light{--lcpr-study-primary:#111;--lcpr-study-primary-foreground:#fff;--lcpr-study-primary-soft:rgba(17,17,17,.07);--lcpr-study-primary-border:rgba(17,17,17,.42)}body{min-width:0;padding:12px;overflow-x:hidden;color:var(--vscode-foreground);font:var(--vscode-font-weight) var(--vscode-font-size)/1.5 var(--vscode-font-family)}main{width:100%;max-width:720px;min-width:0;margin:0 auto}header,.actions,.stats,.task-main,.task-meta,.checks,.ratings{display:flex;align-items:center;gap:8px}header{justify-content:space-between;border-bottom:1px solid var(--vscode-panel-border);padding-bottom:8px}header>div{min-width:0}h2,h3,p{margin:4px 0;overflow-wrap:anywhere}header p{color:var(--vscode-descriptionForeground);font-size:11px}.actions,.checks,.ratings{flex-wrap:wrap}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,112px),1fr));gap:6px;margin:10px 0}.stats div,.assessment{min-width:0;padding:8px;border:1px solid var(--vscode-panel-border);background:var(--vscode-editor-background)}.stats b,.stats strong{display:block}.stats b{font-size:11px;color:var(--vscode-descriptionForeground)}ul{padding:0}.task{list-style:none;border-bottom:1px solid var(--vscode-panel-border);padding:9px 0}.task-main{min-width:0;flex-wrap:wrap}.task-main strong{flex:1;min-width:min(100%,120px);overflow-wrap:anywhere}.difficulty,.task-meta,.task small,.assessment small{color:var(--vscode-descriptionForeground);font-size:11px}.task-meta{justify-content:space-between;flex-wrap:wrap;margin-top:3px}.task-kind{font-size:11px;border:1px solid var(--lcpr-study-primary-border);padding:1px 4px;color:var(--lcpr-study-primary);background:var(--lcpr-study-primary-soft)}button{border:1px solid var(--lcpr-study-primary-border);background:var(--lcpr-study-primary);color:var(--lcpr-study-primary-foreground);padding:3px 8px;cursor:pointer}button:hover{opacity:.9}button:focus-visible{outline:2px solid var(--lcpr-study-primary-border);outline-offset:2px}button:disabled{opacity:.5;cursor:default}.actions button,.ratings button:not(:last-child){background:transparent;color:var(--lcpr-study-primary)}input[type=checkbox]{accent-color:var(--lcpr-study-primary)}.notice{color:var(--vscode-descriptionForeground);background:var(--vscode-textBlockQuote-background);padding:6px}.empty{text-align:center;margin-top:18vh}.empty form{display:grid;gap:8px;width:100%;max-width:260px;margin:12px auto;text-align:left}.empty label{display:grid;gap:3px}.empty input{min-width:0;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);padding:4px}.empty-row{list-style:none;color:var(--vscode-descriptionForeground)}.assessment{margin:7px 0}.checks{margin:7px 0}.ratings{margin-top:7px}.status{min-height:18px;color:var(--vscode-descriptionForeground);font-size:11px}@media(max-width:420px){header{align-items:flex-start;flex-direction:column}}</style>`;
  }

  private script(): string {
    return `const vscode=acquireVsCodeApi();let composing=false;document.addEventListener('compositionstart',()=>composing=true);document.addEventListener('compositionend',()=>composing=false);document.addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(!b)return;vscode.postMessage({command:b.dataset.action,sessionId:b.dataset.session,rating:b.dataset.rating})});document.addEventListener('change',e=>{if(composing||!e.target.matches('input[type=checkbox]'))return;const box=e.target;const wrap=box.closest('[data-session]');if(!wrap)return;const selector=box.dataset.understanding?'data-understanding':'data-hint';const values={};wrap.querySelectorAll('input['+selector+']').forEach(input=>values[input.dataset[box.dataset.understanding?'understanding':'hint']]=input.checked);vscode.postMessage({command:box.dataset.understanding?'understanding':'hints',sessionId:wrap.dataset.session,value:values})});const form=document.getElementById('create-form');if(form){const d=new Date();d.setDate(d.getDate()+((8-d.getDay())%7||7));form.startDate.value=d.toISOString().slice(0,10);form.addEventListener('submit',e=>{e.preventDefault();if(composing)return;vscode.postMessage({command:'create',config:{dailyMinutes:Number(form.dailyMinutes.value),dailyProblemLimit:Number(form.dailyProblemLimit.value),startDate:form.startDate.value,reviewsCountTowardLimit:form.reviewsCountTowardLimit.checked,sundayRest:form.sundayRest.checked}})})}`;
  }

  public cleanupReviewDrafts(filePath: string): void {
    if (!this.context || filePath.indexOf(path.join(this.context.globalStorageUri.fsPath, "study-review")) !== 0) {
      return;
    }
    const protectedPaths = vscode.workspace.textDocuments.filter((document) => !document.isClosed || document.isDirty).map((document) => document.fileName);
    pruneReviewDrafts(path.dirname(filePath), protectedPaths, 3);
  }

  public dispose(): void {
    this.view = undefined;
  }

  public async testStartReview(sessionId: string): Promise<string> {
    if (!this.document || !this.context) {
      throw new Error("学习计划尚未初始化");
    }
    const task = this.findTask(sessionId);
    if (!task) {
      throw new Error("找不到学习任务");
    }
    task.mode = "diagnostic";
    task.requiresFullRewrite = true;
    task.requiresServerAccepted = true;
    task.state = "active";
    task.startedAt = new Date().toISOString();
    const progress = this.document.progress[task.sourceFid || task.fid] || this.document.progress[task.fid];
    if (progress) {
      progress.status = "in-progress";
    }
    const folder = path.join(this.context.globalStorageUri.fsPath, "study-review", task.fid);
    fs.mkdirSync(folder, { recursive: true });
    const filePath = path.join(folder, `${task.id}.cpp`);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, `/*\n * @lc app=leetcode id=${task.fid} lang=cpp\n * @lcpr study-review session=${task.id}\n */\n\n// @lc code=start\n\n// 请从空白处重写解法。\n\n// @lc code=end\n`, "utf8");
    }
    task.draftPath = filePath;
    this.persist();
    const document = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(document, { preview: false });
    return filePath;
  }

  public testUnderstanding(sessionId: string): void {
    this.updateUnderstanding(sessionId, { pattern: true, invariant: true, complexity: true, edgeCases: true });
  }

  public testRate(sessionId: string, rating: StudyRating): void {
    this.rate(sessionId, rating);
  }

  public testReload(): StudyPlanDocument | undefined {
    this.document = this.storage?.load().document;
    this.refresh();
    return this.document;
  }
}

export const studyPlanService = new StudyPlanService();

export class StudyPlanProxy extends BABAProxy {
  public static NAME = "StudyPlanProxy";
  constructor() { super(StudyPlanProxy.NAME); }
  public getDocument(): StudyPlanDocument | undefined { return studyPlanService.getDocument(); }
}

export class StudyPlanMediator extends BABAMediator {
  public static NAME = "StudyPlanMediator";
  constructor() { super(StudyPlanMediator.NAME); }
  public listNotificationInterests(): string[] {
    return [BabaStr.VSCODE_DISPOST, BabaStr.QuestionData_ReBuildQuestionDataFinish, BabaStr.CommitResult_showFinish, BabaStr.StudyPlan_update];
  }
  public handleNotification(notification: BaseCC.BaseCC.INotification): void {
    switch (notification.getName()) {
      case BabaStr.QuestionData_ReBuildQuestionDataFinish:
        studyPlanService.onQuestionDataRebuilt();
        break;
      case BabaStr.CommitResult_showFinish:
        studyPlanService.onSubmit(notification.getBody() || {});
        break;
      case BabaStr.StudyPlan_update:
        studyPlanService.refresh();
        break;
      case BabaStr.VSCODE_DISPOST:
        studyPlanService.dispose();
        break;
      default:
        break;
    }
  }
}

export function registerStudyPlanView(context: vscode.ExtensionContext): vscode.Disposable {
  const provider: vscode.WebviewViewProvider = { resolveWebviewView: (view) => studyPlanService.resolveWebviewView(view) };
  const disposable = vscode.window.registerWebviewViewProvider("LCPRStudyPlanView", provider, { webviewOptions: { retainContextWhenHidden: true } });
  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => studyPlanService.cleanupReviewDrafts(document.fileName));
  const combined = vscode.Disposable.from(disposable, closeListener);
  context.subscriptions.push(combined);
  return combined;
}

export async function openStudyPlan(): Promise<void> {
  await vscode.commands.executeCommand("workbench.view.extension.lcpr_bar");
  await vscode.commands.executeCommand("LCPRStudyPlanView.focus");
  studyPlanService.refresh();
}

export async function createOrResumeStudyPlan(config?: Partial<StudyPlanConfig>): Promise<void> {
  await studyPlanService.createOrResume(config);
}

export function pauseStudyPlan(): void { studyPlanService.pause(); }
export function refreshStudyPlan(): void { studyPlanService.refresh(); }
export async function resetStudyPlan(): Promise<void> {
  if (!studyPlanService.getDocument()) {
    studyPlanService.reset();
    return;
  }
  const choice = await vscode.window.showWarningMessage("重置后将清除当前学习计划进度。", { modal: true }, "重置");
  if (choice === "重置") {
    studyPlanService.reset();
  }
}
