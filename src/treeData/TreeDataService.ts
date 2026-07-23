// @ts-nocheck
/*
 * Filename: https://github.com/ccagml/leetcode-extension/src/service/TreeDataService.ts
 * Path: https://github.com/ccagml/leetcode-extension
 * Created Date: Thursday, October 27th 2022, 7:43:29 pm
 * Author: ccagml
 *
 * Copyright (c) 2022 ccagml . All rights reserved.
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
// import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as ConstDefind_1 from "../model/ConstDefind";
import * as TreeViewController_1 from "../controller/TreeViewController";
import * as TreeNodeModel_1 from "../model/TreeNodeModel";
import * as choiceDao_1 from "../dao/choiceDao";
import * as tagsDao_1 from "../dao/tagsDao";
import * as OutputUtils_1 from "../utils/OutputUtils";
import * as BABA_1 from "../BABA";
import * as ConfigUtils_1 from "../utils/ConfigUtils";
import * as SystemUtils_1 from "../utils/SystemUtils";
import * as ProblemListDisplayModule_1 from "../workbench/ProblemListDisplayModule";
import { companionService } from "../companion/CompanionModule";
import { browserLoginService } from "../auth/BrowserLoginService";
class TreeDataService {
    constructor() {
        this.onDidChangeTreeDataEvent = new vscode.EventEmitter();
        this.previewLoadSeq = 0;
        this.rootOrderStorageKey = "leetcodeUltra.questionExplorer.rootOrder";
        this.rootNodeTypes = new Set([
            TreeNodeModel_1.TreeNodeType.Tree_day,
            TreeNodeModel_1.TreeNodeType.Tree_All,
            TreeNodeModel_1.TreeNodeType.Tree_difficulty,
            TreeNodeModel_1.TreeNodeType.Tree_tag,
            TreeNodeModel_1.TreeNodeType.Tree_favorite,
            TreeNodeModel_1.TreeNodeType.Tree_choice,
            TreeNodeModel_1.TreeNodeType.Tree_score,
            TreeNodeModel_1.TreeNodeType.Tree_contest,
            TreeNodeModel_1.TreeNodeType.Tree_search,
            TreeNodeModel_1.TreeNodeType.Tree_carl,
        ]);
        // tslint:disable-next-line:member-ordering
        this.onDidChangeTreeData = this.onDidChangeTreeDataEvent.event;
    }
    initialize(context) {
        this.context = context;
    }
    cleanUserScore() {
        TreeViewController_1.treeViewController.clearUserScore();
    }
    fire() {
        this.onDidChangeTreeDataEvent.fire(null);
    }
    canReorderRootNode(node) {
        return !!node && this.rootNodeTypes.has(node.nodeType);
    }
    getRootNodeIdentity(node) {
        return `${node.nodeType}|${node.id}|${node.input || ""}`;
    }
    getSavedRootOrder() {
        var _a;
        return (((_a = this.context) === null || _a === void 0 ? void 0 : _a.workspaceState.get(this.rootOrderStorageKey)) || []);
    }
    saveRootOrder(order) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!((_a = this.context) === null || _a === void 0 ? void 0 : _a.workspaceState)) {
                return;
            }
            yield this.context.workspaceState.update(this.rootOrderStorageKey, order);
        });
    }
    applySavedRootOrder(nodes) {
        const savedOrder = this.getSavedRootOrder();
        if (!savedOrder.length) {
            return nodes;
        }
        const savedIndex = new Map();
        savedOrder.forEach((key, index) => savedIndex.set(key, index));
        return nodes
            .map((node, index) => ({ node, index, key: this.getRootNodeIdentity(node) }))
            .sort((a, b) => {
            const aSaved = savedIndex.has(a.key) ? savedIndex.get(a.key) : Number.MAX_SAFE_INTEGER;
            const bSaved = savedIndex.has(b.key) ? savedIndex.get(b.key) : Number.MAX_SAFE_INTEGER;
            if (aSaved !== bSaved) {
                return aSaved - bSaved;
            }
            if (a.node.rootNodeSortId !== b.node.rootNodeSortId) {
                return a.node.rootNodeSortId - b.node.rootNodeSortId;
            }
            return a.index - b.index;
        })
            .map((entry) => entry.node);
    }
    reorderRootNodes(sourceKeys, targetNode) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!sourceKeys.length) {
                return;
            }
            if (targetNode && !this.canReorderRootNode(targetNode)) {
                return;
            }
            const currentOrder = this.applySavedRootOrder(TreeViewController_1.treeViewController.getRootNodes())
                .filter((node) => this.canReorderRootNode(node))
                .map((node) => this.getRootNodeIdentity(node));
            const moveKeys = [...new Set(sourceKeys)].filter((key) => currentOrder.includes(key));
            if (!moveKeys.length) {
                return;
            }
            const remaining = currentOrder.filter((key) => !moveKeys.includes(key));
            const targetKey = targetNode ? this.getRootNodeIdentity(targetNode) : undefined;
            const insertIndex = targetKey ? remaining.indexOf(targetKey) : remaining.length;
            remaining.splice(insertIndex >= 0 ? insertIndex : remaining.length, 0, ...moveKeys);
            yield this.saveRootOrder(remaining);
            this.fire();
        });
    }
    refresh() {
        return __awaiter(this, void 0, void 0, function* () {
            yield TreeViewController_1.treeViewController.refreshCache();
            yield TreeViewController_1.treeViewController.refreshCheck();
        });
    }
    checkWorkspaceFolder() {
        return __awaiter(this, void 0, void 0, function* () {
            yield (0, ConfigUtils_1.selectWorkspaceFolderList)();
        });
    }
    getTreeItem(element) {
        if (element.id === ConstDefind_1.BricksNormalId.NotSignIn) {
            return {
                label: element.name,
                collapsibleState: vscode.TreeItemCollapsibleState.None,
                command: {
                    command: "lcpr.signin",
                    title: "未登录",
                },
            };
        }
        const result = {
            label: element.isProblem
                ? this.getProblemLabel(element)
                : element.name,
            description: element.isProblem && element.isFavorite ? "♥" : undefined,
            tooltip: element.isProblem ? this.getProblemTooltip(element) : this.getSubCategoryTooltip(element),
            collapsibleState: element.isProblem
                ? vscode.TreeItemCollapsibleState.None
                : vscode.TreeItemCollapsibleState.Collapsed,
            iconPath: this.getProblemIconPath(element),
            command: element.isProblem ? element.previewCommand : undefined,
            resourceUri: element.TNMUri,
            contextValue: element.viewItem,
        };
        return result;
    }
    getProblemLabel(element) {
        const options = (0, ProblemListDisplayModule_1.getProblemListDisplayOptions)();
        let label = "";
        if (options.showScorePrefix && element.score > "0") {
            label += `[score:${element.score}]`;
        }
        if (options.showProblemId) {
            label += `${element.id}.`;
        }
        return `${label}${element.name}`;
    }
    getProblemIconPath(element) {
        const options = (0, ProblemListDisplayModule_1.getProblemListDisplayOptions)();
        return options.showAcStatus ? this.parseIconPathFromProblemState(element) : "";
    }
    getProblemTooltip(element) {
        const details = [`ID: ${element.id}`, `Name: ${element.name}`];
        if (element.difficulty) {
            details.push(`Difficulty: ${element.difficulty}`);
        }
        if (element.score > "0") {
            details.push(`Score: ${element.score}`);
        }
        return details.join("\n");
    }
    getChildren(element) {
        if (!BABA_1.BABA.getProxy(BABA_1.BabaStr.StatusBarProxy).getUser()) {
            return [
                (0, TreeNodeModel_1.CreateTreeNodeModel)({
                    id: ConstDefind_1.BricksNormalId.NotSignIn,
                    name: "未登录",
                }, TreeNodeModel_1.TreeNodeType.TreeNotSignIn),
            ];
        }
        if (!element) {
            // Root view
            return this.applySavedRootOrder(TreeViewController_1.treeViewController.getRootNodes());
        }
        else {
            if (element.nodeType == TreeNodeModel_1.TreeNodeType.Tree_day) {
                return TreeViewController_1.treeViewController.getDayNodes(element);
            }
            else if (element.nodeType == TreeNodeModel_1.TreeNodeType.Tree_search) {
                if (element.id == ConstDefind_1.SearchSetType.ScoreRange) {
                    return TreeViewController_1.treeViewController.getScoreRangeNodes(element.input);
                }
                else if (element.id == ConstDefind_1.SearchSetType.Context) {
                    return TreeViewController_1.treeViewController.getContestNodes(element.input);
                }
                return [];
            }
            else if (element.nodeType == TreeNodeModel_1.TreeNodeType.Tree_All) {
                return TreeViewController_1.treeViewController.getAllNodes();
            }
            else if (element.nodeType == TreeNodeModel_1.TreeNodeType.Tree_favorite) {
                return TreeViewController_1.treeViewController.getFavoriteNodes();
            }
            else if (element.nodeType == TreeNodeModel_1.TreeNodeType.Tree_difficulty) {
                return TreeViewController_1.treeViewController.getDifficultyChild();
            }
            else if (element.nodeType == TreeNodeModel_1.TreeNodeType.Tree_tag) {
                return TreeViewController_1.treeViewController.getTagChild();
            }
            else if (element.nodeType == TreeNodeModel_1.TreeNodeType.Tree_score) {
                return TreeViewController_1.treeViewController.getScoreChild();
            }
            else if (element.nodeType == TreeNodeModel_1.TreeNodeType.Tree_choice) {
                return TreeViewController_1.treeViewController.getChoiceChild();
            }
            else if (element.nodeType == TreeNodeModel_1.TreeNodeType.Tree_carl) {
                return TreeViewController_1.treeViewController.getCarlChild();
            }
            else if (element.nodeType == TreeNodeModel_1.TreeNodeType.Tree_contest) {
                return TreeViewController_1.treeViewController.getContestChild();
            }
            else {
                if (element.isProblem) {
                    return [];
                }
                return TreeViewController_1.treeViewController.getChildrenSon(element);
            }
        }
    }
    getChoiceData() {
        return choiceDao_1.choiceDao.getChoiceData();
    }
    getTagsData(fid) {
        return tagsDao_1.tagsDao.getTagsData(fid) || ["Unknown"];
    }
    getTagsDataEn(fid) {
        return tagsDao_1.tagsDao.getTagsDataEn(fid) || ["Unknown"];
    }
    parseIconPathFromProblemState(element) {
        if (!element.isProblem) {
            return "";
        }
        switch (element.state) {
            case ConstDefind_1.ProblemState.AC:
                return this.context.asAbsolutePath(path.join("resources", "check.png"));
            case ConstDefind_1.ProblemState.NotAC:
                return this.context.asAbsolutePath(path.join("resources", "x.png"));
            case ConstDefind_1.ProblemState.Unknown:
                if (element.locked) {
                    return this.context.asAbsolutePath(path.join("resources", "lock.png"));
                }
                return this.context.asAbsolutePath(path.join("resources", "blank.png"));
            default:
                return "";
        }
    }
    getSubCategoryTooltip(element) {
        // return '' unless it is a sub-category node
        if (element.isProblem || element.id === "ROOT" || element.id in ConstDefind_1.Category) {
            return "";
        }
        return "";
    }
    switchEndpoint() {
        return __awaiter(this, void 0, void 0, function* () {
            const isCnEnabled = (0, ConfigUtils_1.getLeetCodeEndpoint)() === ConstDefind_1.Endpoint.LeetCodeCN;
            const picks = [];
            picks.push({
                label: `${isCnEnabled ? "" : "$(check) "}LeetCode`,
                description: "leetcode.com",
                detail: `Enable LeetCode.com US`,
                value: ConstDefind_1.Endpoint.LeetCode,
            }, {
                label: `${isCnEnabled ? "$(check) " : ""}力扣`,
                description: "leetcode.cn",
                detail: `启用中国版 LeetCode.cn`,
                value: ConstDefind_1.Endpoint.LeetCodeCN,
            });
            const choice = yield vscode.window.showQuickPick(picks);
            if (!choice || choice.value === (0, ConfigUtils_1.getLeetCodeEndpoint)()) {
                return;
            }
            const leetCodeConfig = vscode.workspace.getConfiguration("leetcode-problem-rating");
            try {
                const endpoint = choice.value;
                yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy).get_instance().switchEndpoint(endpoint);
                yield leetCodeConfig.update("endpoint", endpoint, true /* UserSetting */);
                yield (0, OutputUtils_1.ShowMessage)(`Switched the endpoint to ${endpoint}`, ConstDefind_1.OutPutType.info);
            }
            catch (error) {
                yield (0, OutputUtils_1.ShowMessage)("切换站点出错. 请查看控制台信息~", ConstDefind_1.OutPutType.error);
            }
            try {
                yield vscode.commands.executeCommand("lcpr.signout");
                yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy).get_instance().deleteCache();
                yield (0, OutputUtils_1.promptForSignIn)();
            }
            catch (error) {
                yield (0, OutputUtils_1.ShowMessage)("登录失败. 请查看控制台信息~", ConstDefind_1.OutPutType.error);
            }
        });
    }
    previewProblem(input, isSideMode = false, autoCreate = false) {
        return __awaiter(this, void 0, void 0, function* () {
            const seq = ++this.previewLoadSeq;
            let node;
            if (input instanceof vscode.Uri) {
                const activeFilePath = input.fsPath;
                const id = yield (0, SystemUtils_1.getNodeIdFromFile)(activeFilePath);
                if (!id) {
                    (0, OutputUtils_1.ShowMessage)(`Failed to resolve the problem id from file: ${activeFilePath}.`, ConstDefind_1.OutPutType.error);
                    return;
                }
                const cachedNode = BABA_1.BABA.getProxy(BABA_1.BabaStr.QuestionDataProxy).getNodeById(id);
                if (!cachedNode) {
                    (0, OutputUtils_1.ShowMessage)(`Failed to resolve the problem with id: ${id}.`, ConstDefind_1.OutPutType.error);
                    return;
                }
                node = cachedNode;
                // Move the preview page aside if it's triggered from Code Lens
                isSideMode = true;
            }
            else {
                node = input;
            }
            companionService.showDescriptionLoading(node, 1);
            const needTranslation = (0, ConfigUtils_1.isUseEndpointTranslation)();
            const startedAt = Date.now();
            const timeoutMs = 20000;
            const intervalMs = 1500;
            let attempt = 0;
            let lastError = "";
            while (Date.now() - startedAt <= timeoutMs) {
                attempt += 1;
                companionService.showDescriptionLoading(node, attempt);
                try {
                    const descString = yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy)
                        .get_instance()
                        .getDescription(node.qid, needTranslation);
                    if (seq !== this.previewLoadSeq) {
                        return;
                    }
                    let successResult;
                    try {
                        successResult = JSON.parse(descString);
                    }
                    catch (e) {
                        successResult = {};
                    }
                    if (successResult.code == 100) {
                        BABA_1.BABA.sendNotification(BABA_1.BabaStr.Preview_show, {
                            descString: JSON.stringify(successResult.msg),
                            node: node,
                            isSideMode: isSideMode,
                        });
                        if (autoCreate && (0, ConfigUtils_1.autoCreateFileOnPreview)()) {
                            vscode.commands.executeCommand("lcpr.showProblem", node);
                        }
                        return;
                    }
                    lastError = String(successResult.error || successResult.msg || descString || "题面加载失败。");
                }
                catch (error) {
                    if (seq !== this.previewLoadSeq) {
                        return;
                    }
                    lastError = error && error.message ? error.message : String(error || "题面加载失败。");
                }
                if (Date.now() - startedAt + intervalMs > timeoutMs) {
                    break;
                }
                yield new Promise((resolve) => setTimeout(resolve, intervalMs));
                if (seq !== this.previewLoadSeq) {
                    return;
                }
            }
            companionService.showDescriptionError(node, lastError || "题面加载超时。", attempt, false);
            yield (0, OutputUtils_1.ShowMessage)(`${lastError || "题面加载超时。"} 请查看控制台信息~`, ConstDefind_1.OutPutType.error);
        });
    }
    signIn() {
        return browserLoginService.showLoginPage();
    }
    // 登出
    /**
     * It signs out the user
     */
  signOut() {
    return __awaiter(this, void 0, void 0, function* () {
      try {
        const child = BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy).get_instance();
        yield child.signOut();
        yield (0, OutputUtils_1.ShowMessage)("成功登出", ConstDefind_1.OutPutType.info);
        BABA_1.BABA.sendNotification(BABA_1.BabaStr.USER_LOGIN_OUT, {});
        BABA_1.BABA.sendNotification(BABA_1.BabaStr.BABACMD_refresh);
        BABA_1.BABA.sendNotification(BABA_1.BabaStr.BricksData_refresh);
      }
      catch (error) {
        // ShowMessage(`Failed to signOut. Please open the output channel for details`, OutPutType.error);
      }
        });
    }
    // 删除所有缓存
    /**
     * It signs out, removes old cache, switches to the default endpoint, and refreshes the tree data
     */
    deleteAllCache() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.signOut();
            yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy).get_instance().removeOldCache();
            yield BABA_1.BABA.getProxy(BABA_1.BabaStr.ChildCallProxy).get_instance().switchEndpoint((0, ConfigUtils_1.getLeetCodeEndpoint)());
            BABA_1.BABA.sendNotification(BABA_1.BabaStr.BABACMD_refresh);
            BABA_1.BABA.sendNotification(BABA_1.BabaStr.BricksData_refresh);
        });
    }
}
export { TreeDataService };
export const treeDataService = new TreeDataService();
class TreeDataProxy extends BABA_1.BABAProxy {
    constructor() {
        super(TreeDataProxy.NAME);
    }
    getTagsDataEn(fid) {
        return treeDataService.getTagsDataEn(fid) || ["Unknown"];
    }
    getChoiceData() {
        return treeDataService.getChoiceData();
    }
    getTagsData(fid) {
        return treeDataService.getTagsData(fid);
    }
}
export { TreeDataProxy };
TreeDataProxy.NAME = BABA_1.BabaStr.TreeDataProxy;
class TreeDataMediator extends BABA_1.BABAMediator {
    constructor() {
        super(TreeDataMediator.NAME);
    }
    listNotificationInterests() {
        return [
            BABA_1.BabaStr.VSCODE_DISPOST,
            BABA_1.BabaStr.BABACMD_refresh,
            BABA_1.BabaStr.InitFile,
            BABA_1.BabaStr.TreeData_cleanUserScore,
            BABA_1.BabaStr.TreeData_switchEndpoint,
            BABA_1.BabaStr.BABACMD_previewProblem,
            BABA_1.BabaStr.BABACMD_showProblem,
            BABA_1.BabaStr.BABACMD_pickOne,
            BABA_1.BabaStr.BABACMD_searchScoreRange,
            BABA_1.BabaStr.BABACMD_searchProblem,
            BABA_1.BabaStr.BABACMD_getHelp,
            BABA_1.BabaStr.BABACMD_testSolution,
            BABA_1.BabaStr.BABACMD_reTestSolution,
            BABA_1.BabaStr.BABACMD_testCaseDef,
            BABA_1.BabaStr.BABACMD_tesCaseArea,
            BABA_1.BabaStr.BABACMD_submitSolution,
            BABA_1.BabaStr.BABACMD_setDefaultLanguage,
            BABA_1.BabaStr.BABACMD_addFavorite,
            BABA_1.BabaStr.BABACMD_removeFavorite,
            BABA_1.BabaStr.BABACMD_problems_sort,
            BABA_1.BabaStr.TreeData_rebuildTreeData,
            BABA_1.BabaStr.QuestionData_ReBuildQuestionDataFinish,
            BABA_1.BabaStr.TreeData_searchTodayFinish,
            BABA_1.BabaStr.TreeData_searchUserContestFinish,
            BABA_1.BabaStr.TreeData_searchScoreRangeFinish,
            BABA_1.BabaStr.TreeData_searchContest,
            BABA_1.BabaStr.ConfigChange_hideScore,
            BABA_1.BabaStr.ConfigChange_SortStrategy,
            BABA_1.BabaStr.TreeData_favoriteChange,
            BABA_1.BabaStr.USER_statusChanged,
            BABA_1.BabaStr.statusBar_update_statusFinish,
            BABA_1.BabaStr.StartReadData,
            BABA_1.BabaStr.BABACMD_Login,
            BABA_1.BabaStr.BABACMD_LoginOut,
            BABA_1.BabaStr.USER_LOGIN_SUC,
            BABA_1.BabaStr.USER_LOGIN_OUT,
            BABA_1.BabaStr.BABACMD_deleteAllCache,
            BABA_1.BabaStr.QuestionData_submitNewAccept,
            BABA_1.BabaStr.InitWorkspaceFolder,
        ];
    }
    handleNotification(_notification) {
        return __awaiter(this, void 0, void 0, function* () {
            let body = _notification.getBody();
            switch (_notification.getName()) {
                case BABA_1.BabaStr.VSCODE_DISPOST:
                    TreeViewController_1.treeViewController.dispose();
                    break;
                case BABA_1.BabaStr.StartReadData:
                    break;
                case BABA_1.BabaStr.InitWorkspaceFolder:
                    yield treeDataService.checkWorkspaceFolder();
                    break;
                case BABA_1.BabaStr.BABACMD_refresh:
                case BABA_1.BabaStr.ConfigChange_hideScore:
                case BABA_1.BabaStr.QuestionData_submitNewAccept:
                    yield treeDataService.refresh();
                    break;
                case BABA_1.BabaStr.InitFile:
                    treeDataService.initialize(body);
                    break;
                case BABA_1.BabaStr.TreeData_cleanUserScore:
                    treeDataService.cleanUserScore();
                    break;
                case BABA_1.BabaStr.TreeData_switchEndpoint:
                    treeDataService.switchEndpoint();
                    break;
                case BABA_1.BabaStr.BABACMD_previewProblem:
                    treeDataService.previewProblem(body.input, body.isSideMode, !!body.autoCreate);
                    break;
                case BABA_1.BabaStr.BABACMD_showProblem:
                    TreeViewController_1.treeViewController.showProblem(body);
                    break;
                case BABA_1.BabaStr.BABACMD_pickOne:
                    TreeViewController_1.treeViewController.pickOne();
                    break;
                case BABA_1.BabaStr.BABACMD_searchScoreRange:
                    TreeViewController_1.treeViewController.searchScoreRange();
                    break;
                case BABA_1.BabaStr.BABACMD_searchProblem:
                    TreeViewController_1.treeViewController.searchProblem();
                    break;
                case BABA_1.BabaStr.BABACMD_getHelp:
                    TreeViewController_1.treeViewController.getHelp(body);
                    break;
                case BABA_1.BabaStr.BABACMD_testSolution:
                    TreeViewController_1.treeViewController.testSolution(body.uri);
                    break;
                case BABA_1.BabaStr.BABACMD_reTestSolution:
                    TreeViewController_1.treeViewController.reTestSolution(body.uri);
                    break;
                case BABA_1.BabaStr.BABACMD_testCaseDef:
                    TreeViewController_1.treeViewController.testCaseDef(body.uri, body.allCase);
                    break;
                case BABA_1.BabaStr.BABACMD_tesCaseArea:
                    TreeViewController_1.treeViewController.tesCaseArea(body.uri, body.testCase, body.runMode);
                    break;
                case BABA_1.BabaStr.BABACMD_submitSolution:
                    TreeViewController_1.treeViewController.submitSolution(body.uri);
                    break;
                case BABA_1.BabaStr.BABACMD_setDefaultLanguage:
                    (0, ConfigUtils_1.setDefaultLanguage)();
                    break;
                case BABA_1.BabaStr.BABACMD_addFavorite:
                    TreeViewController_1.treeViewController.addFavorite(body.node);
                    break;
                case BABA_1.BabaStr.BABACMD_removeFavorite:
                    TreeViewController_1.treeViewController.removeFavorite(body.node);
                    break;
                case BABA_1.BabaStr.BABACMD_problems_sort:
                    TreeViewController_1.treeViewController.switchSortingStrategy();
                    break;
                case BABA_1.BabaStr.USER_statusChanged:
                case BABA_1.BabaStr.statusBar_update_statusFinish:
                    treeDataService.cleanUserScore();
                    treeDataService.fire();
                    treeDataService.refresh();
                    break;
                case BABA_1.BabaStr.TreeData_searchUserContestFinish:
                case BABA_1.BabaStr.TreeData_favoriteChange:
                    treeDataService.refresh();
                    break;
                case BABA_1.BabaStr.QuestionData_ReBuildQuestionDataFinish:
                case BABA_1.BabaStr.TreeData_searchTodayFinish:
                case BABA_1.BabaStr.TreeData_rebuildTreeData:
                case BABA_1.BabaStr.TreeData_searchScoreRangeFinish:
                case BABA_1.BabaStr.TreeData_searchContest:
                case BABA_1.BabaStr.ConfigChange_SortStrategy:
                    treeDataService.fire();
                    break;
                case BABA_1.BabaStr.BABACMD_Login:
                    yield treeDataService.signIn();
                    break;
                case BABA_1.BabaStr.BABACMD_LoginOut:
                    yield treeDataService.signOut();
                    break;
                case BABA_1.BabaStr.USER_LOGIN_SUC:
                    yield browserLoginService.setSignedIn(true);
                    break;
                case BABA_1.BabaStr.USER_LOGIN_OUT:
                    yield browserLoginService.setSignedIn(false);
                    break;
                case BABA_1.BabaStr.BABACMD_deleteAllCache:
                    treeDataService.deleteAllCache();
                    break;
                default:
                    break;
            }
        });
    }
}
export { TreeDataMediator };
TreeDataMediator.NAME = BABA_1.BabaStr.TreeDataMediator;
