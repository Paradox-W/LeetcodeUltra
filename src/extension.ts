/*
 * Filename: https://github.com/ccagml/leetcode-extension/src/extension.ts
 * Path: https://github.com/ccagml/leetcode-extension
 * Created Date: Monday, October 31st 2022, 10:16:47 am
 * Author: ccagml
 *
 * Copyright (c) 2022 ccagml . All rights reserved.
 */

import { ConfigurationTarget, ExtensionContext, ExtensionMode, window, commands, Uri, CommentReply, TextDocument, workspace } from "vscode";
import * as vscode from "vscode";
import { TreeNodeModel } from "./model/TreeNodeModel";
import { treeColor } from "./treeColor/TreeColorModule";
import { ShowMessage } from "./utils/OutputUtils";
import { ChildCallMediator, ChildCallProxy } from "./childCall/childCallModule";
import { markdownService } from "./service/MarkdownService";
import { BricksType, OutPutType, RemarkComment } from "./model/ConstDefind";
import { BricksDataMediator, BricksDataProxy, bricksDataService } from "./bricksData/BricksDataService";
import { BABA, BabaStr } from "./BABA";
import { StatusBarTimeMediator, StatusBarTimeProxy } from "./statusBarTime/StatusBarTimeModule";
import { StatusBarMediator, StatusBarProxy } from "./statusBar/StatusBarModule";
import { LogOutputMediator, LogOutputProxy } from "./logOutput/logOutputModule";
import { RemarkMediator, RemarkProxy } from "./remark/RemarkServiceModule";
import { FileButtonMediator, FileButtonProxy } from "./fileButton/FileButtonModule";
import { QuestionDataMediator, QuestionDataProxy } from "./questionData/QuestionDataModule";
import { TreeDataMediator, TreeDataProxy, treeDataService } from "./treeData/TreeDataService";
import { CommitResultMediator, CommitResultProxy } from "./commitResult/CommitResultModule";
import { SolutionProxy, SolutionMediator } from "./solution/SolutionModule";
import { PreviewMediator, PreviewProxy } from "./preView/PreviewModule";
import { DebugMediator, DebugProxy } from "./debug/DebugModule";
import { RankScoreDataMediator, RankScoreDataProxy } from "./rankScore/RankScoreDataModule";
import { TodayDataMediator, TodayDataProxy } from "./todayData/TodayDataModule";
import { RecentContestMediator, RecentContestProxy } from "./recentContestData/RecentContestDataModule";
import { ContestQuestionMediator, ContestQuestionProxy } from "./recentContestData/ContestQuestionDataModule";
import { registerLeetCodeWorkbench } from "./workbench/LeetCodeWorkbenchModule";
import { companionService, registerLeetCodeCompanion } from "./companion/CompanionModule";
import { registerLeetCodeFolding } from "./workbench/LeetCodeFoldingModule";
import { registerProblemListDisplayOptions } from "./workbench/ProblemListDisplayModule";
import { registerAiDebug } from "./aiDebug/AiDebugModule";
import { registerDebugVisualizer } from "./debugVisualizer/DebugVisualizerModule";
import { treeViewController } from "./controller/TreeViewController";
import { browserLoginService } from "./auth/BrowserLoginService";
import {
  createOrResumeStudyPlan,
  openStudyPlan,
  pauseStudyPlan,
  refreshStudyPlan,
  registerStudyPlanView,
  resetStudyPlan,
  studyPlanService,
  StudyPlanMediator,
  StudyPlanProxy,
} from "./studyPlan/StudyPlanModule";

//==================================BABA========================================

// 激活插件
/**
 * The main function of the extension. It is called when the extension is activated.
 * @param {ExtensionContext} context - ExtensionContext
 */

let lcpr_timer_sec;
let lcpr_timer_min;
const QUESTION_EXPLORER_ROOT_MIME = "application/vnd.leetcodeultra.question-explorer-root";
const BRICKS_EXPLORER_ROOT_MIME = "application/vnd.leetcodeultra.bricks-explorer-root";

function createRootReorderController(
  mimeType: string,
  canDrag: (node?: TreeNodeModel) => boolean,
  getIdentity: (node: TreeNodeModel) => string,
  onDrop: (sourceKeys: string[], targetNode?: TreeNodeModel) => Promise<void>
): any {
  return {
    dragMimeTypes: [mimeType],
    dropMimeTypes: [mimeType],
    handleDrag: async (sourceNodes: TreeNodeModel[], dataTransfer: any) => {
      const sourceKeys = (sourceNodes || []).filter((node) => canDrag(node)).map((node) => getIdentity(node));
      if (!sourceKeys.length) {
        return;
      }
      const DataTransferItemCtor = (vscode as any).DataTransferItem;
      if (!DataTransferItemCtor) {
        return;
      }
      dataTransfer.set(mimeType, new DataTransferItemCtor(JSON.stringify(sourceKeys)));
    },
    handleDrop: async (targetNode: TreeNodeModel | undefined, dataTransfer: any) => {
      const item = dataTransfer.get(mimeType);
      if (!item) {
        return;
      }
      let raw = item.value;
      if (raw === undefined && typeof item.asString === "function") {
        raw = await item.asString();
      }
      let sourceKeys: string[] = [];
      if (typeof raw === "string") {
        try {
          sourceKeys = JSON.parse(raw);
        } catch (_) {
          sourceKeys = [];
        }
      } else if (Array.isArray(raw)) {
        sourceKeys = raw;
      }
      if (!sourceKeys.length) {
        return;
      }
      await onDrop(sourceKeys, targetNode);
    },
  };
}

function runStartupTaskInBackground(name: string, task: () => Promise<void>, delayMs: number = 1500): void {
  setTimeout(() => {
    task().catch((error) => {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      try {
        BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine(`[startup:${name}] ${message}`);
      } catch (_) {
        // The output proxy may be unavailable if startup failed very early.
      }
      ShowMessage(`${name} 初始化失败. 请查看控制台信息~`, OutPutType.error);
    });
  }, delayMs);
}

export async function activate(context: ExtensionContext): Promise<void> {
  try {
    browserLoginService.initialize(context);
    studyPlanService.initialize(context);
    const questionExplorerDragAndDropController = createRootReorderController(
      QUESTION_EXPLORER_ROOT_MIME,
      (node) => treeDataService.canReorderRootNode(node),
      (node) => treeDataService.getRootNodeIdentity(node),
      (sourceKeys, targetNode) => treeDataService.reorderRootNodes(sourceKeys, targetNode)
    );
    const bricksExplorerDragAndDropController = createRootReorderController(
      BRICKS_EXPLORER_ROOT_MIME,
      (node) => bricksDataService.canReorderRootNode(node),
      (node) => bricksDataService.getRootNodeIdentity(node),
      (sourceKeys, targetNode) => bricksDataService.reorderRootNodes(sourceKeys, targetNode)
    );

    BABA.init([
      StatusBarTimeMediator,
      StatusBarTimeProxy,
      StatusBarProxy,
      StatusBarMediator,
      RemarkProxy,
      RemarkMediator,
      LogOutputProxy,
      LogOutputMediator,
      FileButtonProxy,
      FileButtonMediator,
      QuestionDataProxy,
      QuestionDataMediator,
      TreeDataProxy,
      TreeDataMediator,
      BricksDataProxy,
      BricksDataMediator,
      CommitResultProxy,
      CommitResultMediator,
      SolutionProxy,
      SolutionMediator,
      PreviewProxy,
      PreviewMediator,
      DebugProxy,
      DebugMediator,
      ChildCallProxy,
      ChildCallMediator,
      RankScoreDataProxy,
      RankScoreDataMediator,
      TodayDataProxy,
      TodayDataMediator,
      RecentContestProxy,
      RecentContestMediator,
      ContestQuestionProxy,
      ContestQuestionMediator,
      StudyPlanProxy,
      StudyPlanMediator,
    ]);

    // 资源管理
    context.subscriptions.push(
      markdownService,
      BABA,
      registerLeetCodeWorkbench(context, BABA, BabaStr),
      registerLeetCodeCompanion(context),
      registerLeetCodeFolding(context),
      registerProblemListDisplayOptions(context, treeDataService),
      registerAiDebug(context),
      registerDebugVisualizer(context),
      registerStudyPlanView(context),
      window.registerUriHandler({ handleUri: browserLoginService.handleUriSignIn }),
      workspace.onDidOpenTextDocument((document) => treeViewController.ensureCppIntelliSenseForDocument(document)),
      window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          treeViewController.ensureCppIntelliSenseForDocument(editor.document);
        }
      }),
      window.registerFileDecorationProvider(treeColor),
      window.createTreeView("QuestionExplorer", {
        treeDataProvider: treeDataService,
        showCollapseAll: true,
        dragAndDropController: questionExplorerDragAndDropController,
      } as any),
      window.createTreeView("BricksExplorer", {
        treeDataProvider: bricksDataService,
        showCollapseAll: true,
        dragAndDropController: bricksExplorerDragAndDropController,
      } as any),
      commands.registerCommand("lcpr.deleteCache", () => BABA.sendNotification(BabaStr.DeleteCache)),
      commands.registerCommand("lcpr.studyPlan.open", openStudyPlan),
      commands.registerCommand("lcpr.studyPlan.createOrResume", createOrResumeStudyPlan),
      commands.registerCommand("lcpr.studyPlan.pause", pauseStudyPlan),
      commands.registerCommand("lcpr.studyPlan.refresh", refreshStudyPlan),
      commands.registerCommand("lcpr.studyPlan.reset", resetStudyPlan),
      commands.registerCommand("lcpr.toggleLeetCodeCn", () => {
        BABA.sendNotification(BabaStr.TreeData_switchEndpoint);
      }),
      commands.registerCommand("lcpr.signin", () => BABA.sendNotification(BabaStr.BABACMD_Login)),
      commands.registerCommand("lcpr.signout", () => BABA.sendNotification(BabaStr.BABACMD_LoginOut)),
      commands.registerCommand("lcpr.previewProblem", (node: TreeNodeModel) => {
        BABA.sendNotification(BabaStr.BABACMD_previewProblem, { input: node, isSideMode: false, autoCreate: true });
      }),
      commands.registerCommand("lcpr.autoCreateFileOptions", async () => {
        const config = workspace.getConfiguration("leetcode-problem-rating");
        const current = !!config.get<boolean>("autoCreateFileOnPreview", false);
        const next = !current;
        await config.update("autoCreateFileOnPreview", next, ConfigurationTarget.Global);
        companionService.revealAndRender(true);
        await ShowMessage(next ? "已开启自动创建文件。" : "已关闭自动创建文件。", OutPutType.info);
      }),
      commands.registerCommand("lcpr.showProblem", (node: TreeNodeModel) => {
        BABA.sendNotification(BabaStr.BABACMD_showProblem, node);
      }),
      commands.registerCommand("lcpr.pickOne", () => {
        BABA.sendNotification(BabaStr.BABACMD_pickOne);
      }),
      commands.registerCommand("lcpr.deleteAllCache", () => BABA.sendNotification(BabaStr.BABACMD_deleteAllCache)),
      commands.registerCommand("leetcode.searchScoreRange", () => {
        BABA.sendNotification(BabaStr.BABACMD_searchScoreRange);
      }),
      commands.registerCommand("lcpr.searchProblem", () => BABA.sendNotification(BabaStr.BABACMD_searchProblem)),
      commands.registerCommand("lcpr.getHelp", (input: TreeNodeModel | Uri) =>
        BABA.sendNotification(BabaStr.BABACMD_getHelp, input)
      ),
      commands.registerCommand("lcpr.refresh", () => {
        BABA.sendNotification(BabaStr.BABACMD_refresh);
      }),
      commands.registerCommand("lcpr.testSolution", (uri?: Uri) => {
        BABA.sendNotification(BabaStr.BABACMD_testSolution, { uri: uri });
      }),

      commands.registerCommand("lcpr.reTestSolution", (uri?: Uri) => {
        BABA.sendNotification(BabaStr.BABACMD_reTestSolution, { uri: uri });
      }),
      commands.registerCommand("lcpr.testCaseDef", (uri?, allCase?) => {
        BABA.sendNotification(BabaStr.BABACMD_testCaseDef, { uri: uri, allCase: allCase });
      }),
      commands.registerCommand("lcpr.tesCaseArea", (uri, testCase?) => {
        BABA.sendNotification(BabaStr.BABACMD_tesCaseArea, { uri: uri, testCase: testCase });
      }),

      commands.registerCommand("lcpr.submitSolution", (uri?: Uri) => {
        BABA.sendNotification(BabaStr.BABACMD_submitSolution, { uri: uri });
      }),
      commands.registerCommand("lcpr.setDefaultLanguage", () => {
        BABA.sendNotification(BabaStr.BABACMD_setDefaultLanguage);
      }),
      commands.registerCommand("lcpr.addFavorite", (node: TreeNodeModel) => {
        BABA.sendNotification(BabaStr.BABACMD_addFavorite, { node: node });
      }),

      commands.registerCommand("lcpr.removeFavorite", (node: TreeNodeModel) => {
        BABA.sendNotification(BabaStr.BABACMD_removeFavorite, { node: node });
      }),
      commands.registerCommand("lcpr.problems.sort", () => {
        BABA.sendNotification(BabaStr.BABACMD_problems_sort);
      }),
      commands.registerCommand("lcpr.statusBarTime.start", () => {
        BABA.sendNotification(BabaStr.BABACMD_statusBarTime_start);
      }),
      commands.registerCommand("lcpr.statusBarTime.stop", () => {
        BABA.sendNotification(BabaStr.BABACMD_statusBarTime_stop);
      }),
      commands.registerCommand("lcpr.statusBarTime.reset", () => {
        BABA.sendNotification(BabaStr.BABACMD_statusBarTime_reset);
      }),
      commands.registerCommand("lcpr.setBricksType0", (node: TreeNodeModel) =>
        BABA.sendNotification(BabaStr.BABACMD_setBricksType, { node: node, type: BricksType.TYPE_0 })
      ),
      commands.registerCommand("lcpr.setBricksType1", (node: TreeNodeModel) =>
        BABA.sendNotification(BabaStr.BABACMD_setBricksType, { node: node, type: BricksType.TYPE_1 })
      ),
      commands.registerCommand("lcpr.setBricksType2", (node: TreeNodeModel) =>
        BABA.sendNotification(BabaStr.BABACMD_setBricksType, { node: node, type: BricksType.TYPE_2 })
      ),
      commands.registerCommand("lcpr.setBricksType3", (node: TreeNodeModel) =>
        BABA.sendNotification(BabaStr.BABACMD_setBricksType, { node: node, type: BricksType.TYPE_3 })
      ),
      commands.registerCommand("lcpr.setBricksType4", (node: TreeNodeModel) =>
        BABA.sendNotification(BabaStr.BABACMD_setBricksType, { node: node, type: BricksType.TYPE_4 })
      ),
      commands.registerCommand("lcpr.setBricksType5", (node: TreeNodeModel) =>
        BABA.sendNotification(BabaStr.BABACMD_setBricksType, { node: node, type: BricksType.TYPE_5 })
      ),
      commands.registerCommand("lcpr.setBricksType6", (node: TreeNodeModel) =>
        BABA.sendNotification(BabaStr.BABACMD_setBricksType, { node: node, type: BricksType.TYPE_6 })
      ),
      commands.registerCommand("lcpr.newBrickGroup", () => BABA.sendNotification(BabaStr.BABACMD_newBrickGroup)),
      commands.registerCommand("lcpr.addQidToGroup", (a) => BABA.sendNotification(BabaStr.BABACMD_addQidToGroup, a)),
      commands.registerCommand("lcpr.removeBrickGroup", (a) =>
        BABA.sendNotification(BabaStr.BABACMD_removeBrickGroup, a)
      ),
      commands.registerCommand("lcpr.removeBricksNeedReviewDay", (a) =>
        BABA.sendNotification(BabaStr.BABACMD_removeBricksNeedReviewDay, a)
      ),
      commands.registerCommand("lcpr.removeBricksNeedReviewDayNode", (a) =>
        BABA.sendNotification(BabaStr.BABACMD_removeBricksNeedReviewDayNode, a)
      ),

      commands.registerCommand("lcpr.removeBricksHave", (a) =>
        BABA.sendNotification(BabaStr.BABACMD_removeBricksHave, a)
      ),
      commands.registerCommand("lcpr.removeQidFromGroup", (node) =>
        BABA.sendNotification(BabaStr.BABACMD_removeQidFromGroup, node)
      ),

      commands.registerCommand("lcpr.remarkCreateNote", (reply: CommentReply) => {
        BABA.sendNotification(BabaStr.BABACMD_remarkCreateNote, reply);
      }),
      commands.registerCommand("lcpr.remarkClose", (a) => {
        BABA.sendNotification(BabaStr.BABACMD_remarkClose, a);
      }),
      commands.registerCommand("lcpr.remarkReplyNote", (reply: CommentReply) => {
        BABA.sendNotification(BabaStr.BABACMD_remarkReplyNote, reply);
      }),
      commands.registerCommand("lcpr.remarkDeleteNoteComment", (comment: RemarkComment) => {
        BABA.sendNotification(BabaStr.BABACMD_remarkDeleteNoteComment, comment);
      }),
      commands.registerCommand("lcpr.remarkCancelsaveNote", (comment: RemarkComment) => {
        BABA.sendNotification(BabaStr.BABACMD_remarkCancelsaveNote, comment);
      }),
      commands.registerCommand("lcpr.remarkSaveNote", (comment: RemarkComment) => {
        BABA.sendNotification(BabaStr.BABACMD_remarkSaveNote, comment);
      }),
      commands.registerCommand("lcpr.remarkEditNote", (comment: RemarkComment) => {
        BABA.sendNotification(BabaStr.BABACMD_remarkEditNote, comment);
      }),
      commands.registerCommand("lcpr.startRemark", (document: TextDocument) => {
        BABA.sendNotification(BabaStr.BABACMD_startRemark, document);
      }),
      commands.registerCommand("lcpr.includeTemplates", (document: TextDocument) => {
        BABA.sendNotification(BabaStr.BABACMD_includeTemplates, document);
      }),
      commands.registerCommand("lcpr.simpleDebug", (document: TextDocument, testCase?, enableAiDebug?) =>
        BABA.sendNotificationAsync(BabaStr.BABACMD_simpleDebug, { document: document, testCase: testCase, enableAiDebug: !!enableAiDebug })
      ),
      commands.registerCommand("lcpr.addDebugType", (document: TextDocument, addType) =>
        BABA.sendNotification(BabaStr.BABACMD_addDebugType, { document: document, addType: addType })
      ),
      commands.registerCommand("lcpr.resetDebugType", (document: TextDocument, addType) =>
        BABA.sendNotification(BabaStr.BABACMD_resetDebugType, { document: document, addType: addType })
      )
    );

    if (context.extensionMode === ExtensionMode.Test) {
      context.subscriptions.push(
        commands.registerCommand("lcpr.studyPlan.__inspect", () => studyPlanService.getDocument()),
        commands.registerCommand("lcpr.studyPlan.__submit", (event) => studyPlanService.onSubmit(event || {})),
        commands.registerCommand("lcpr.studyPlan.__startReview", (sessionId) => studyPlanService.testStartReview(String(sessionId))),
        commands.registerCommand("lcpr.studyPlan.__understanding", (sessionId) => studyPlanService.testUnderstanding(String(sessionId))),
        commands.registerCommand("lcpr.studyPlan.__rate", (sessionId, rating) => studyPlanService.testRate(String(sessionId), rating)),
        commands.registerCommand("lcpr.studyPlan.__reload", () => studyPlanService.testReload())
      );
    }

    await BABA.sendNotificationAsync(BabaStr.InitWorkspaceFolder, context);
    workspace.textDocuments.forEach((document) => treeViewController.ensureCppIntelliSenseForDocument(document));
    if (window.activeTextEditor) {
      treeViewController.ensureCppIntelliSenseForDocument(window.activeTextEditor.document);
    }
    await BABA.sendNotificationAsync(BabaStr.InitFile, context);
    await BABA.sendNotificationAsync(BabaStr.InitEnv, context);
    runStartupTaskInBackground(
      "InitLoginStatus",
      async () => {
        await BABA.sendNotificationAsync(BabaStr.InitLoginStatus);
        await BABA.sendNotificationAsync(BabaStr.StartReadData);
      },
      0
    );
  } catch (error) {
    BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine(error.toString());
    ShowMessage("Extension initialization failed. Please open output channel for details.", OutPutType.error);
  } finally {
    lcpr_timer_sec = setInterval(() => {
      new Promise(async (resolve, _) => {
        await BABA.sendNotificationAsync(BabaStr.every_second);
        resolve(1);
      });
    }, 1000);
    lcpr_timer_min = setInterval(() => {
      new Promise(async (resolve, _) => {
        await BABA.sendNotificationAsync(BabaStr.every_minute);
        resolve(1);
      });
    }, 60000);
  }
}

export function deactivate(): void {
  // Do nothing.
  if (lcpr_timer_sec != undefined) {
    clearInterval(lcpr_timer_sec);
    lcpr_timer_sec = undefined;
  }
  if (lcpr_timer_min != undefined) {
    clearInterval(lcpr_timer_min);
    lcpr_timer_min = undefined;
  }
}
