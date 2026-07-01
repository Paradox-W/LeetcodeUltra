// @ts-nocheck
/*
 * Filename: /home/cc/leetcode-extension/src/childCall/ExecuteService.ts
 * Path: /home/cc/leetcode-extension
 * Created Date: Thursday, October 19th 2023, 1:24:54 am
 * Author: ccagml
 *
 * Copyright (c) 2023 ccagml . All rights reserved
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
import * as fse from "fs-extra";
import * as os from "os";
import * as path from "path";
import * as vscode_1 from "vscode";
import * as vscode_2 from "vscode";
import * as ConstDefind_1 from "../model/ConstDefind";
import * as ConfigUtils_1 from "../utils/ConfigUtils";
import * as OutputUtils_1 from "../utils/OutputUtils";
import * as systemUtils from "../utils/SystemUtils";
import * as SystemUtils_1 from "../utils/SystemUtils";
import * as ConfigUtils_2 from "../utils/ConfigUtils";
import * as BABA_1 from "../BABA";
import * as SystemUtils_2 from "../utils/SystemUtils";
class ExecuteService {
    constructor() {
        // this.leetCodeCliResourcesRootPath = path.join(__dirname, "..", "..", "node_modules", "rpc");
        if (!systemUtils.useVscodeNode()) {
            this.leetCodeCliResourcesRootPath = path.join(__dirname, "..", "..", "..", "resources");
        }
        this.leetCodeCliRootPath = path.join(__dirname, "..", "..", "..", "out", "src", "rpc");
        this.nodeExecutable = this.initNodePath();
        this.configurationChangeListener = vscode_2.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("leetcode-problem-rating.nodePath")) {
                this.nodeExecutable = this.initNodePath();
            }
        }, this);
    }
    getLeetCodeBinaryPath() {
        return __awaiter(this, void 0, void 0, function* () {
            if (systemUtils.useVscodeNode()) {
                return `${path.join(this.leetCodeCliRootPath, "childMain.js")}`;
            }
            else {
                if (systemUtils.useWsl()) {
                    return `${yield systemUtils.toWslPath(`"${path.join(this.leetCodeCliResourcesRootPath, "bin", "leetcode")}"`)}`;
                }
                return `"${path.join(this.leetCodeCliResourcesRootPath, "bin", "leetcode")}"`;
            }
        });
    }
    checkNodeEnv(context) {
        return __awaiter(this, void 0, void 0, function* () {
            const hasInited = context.globalState.get(ConstDefind_1.leetcodeHasInited);
            if (!hasInited) {
                yield this.removeOldCache();
            }
            if (this.nodeExecutable !== "node") {
                if (!(yield fse.pathExists(this.nodeExecutable))) {
                    throw new Error(`The Node.js executable does not exist on path ${this.nodeExecutable}`);
                }
                // Wrap the executable with "" to avoid space issue in the path.
                this.nodeExecutable = `"${this.nodeExecutable}"`;
                if ((0, SystemUtils_1.useWsl)()) {
                    this.nodeExecutable = yield (0, SystemUtils_1.toWslPath)(this.nodeExecutable);
                }
            }
            try {
                yield this.callWithMsg("正在检查Node环境~", this.nodeExecutable, ["-v"]);
            }
            catch (error) {
                const choice = yield vscode_2.window.showErrorMessage("LeetCode extension needs Node.js installed in environment path", ConstDefind_1.DialogOptions.open);
                if (choice === ConstDefind_1.DialogOptions.open) {
                    (0, OutputUtils_1.openUrl)("https://nodejs.org");
                }
                return false;
            }
            context.globalState.update(ConstDefind_1.leetcodeHasInited, true);
            return true;
        });
    }
    // 多机同步,可能题目缓存会导致不一致
    deleteProblemCache() {
        return __awaiter(this, void 0, void 0, function* () {
            if ((0, ConfigUtils_2.isOpenClearProblemCache)()) {
                try {
                    yield this.callWithMsg("正在清除缓存~", this.nodeExecutable, [
                        yield this.getLeetCodeBinaryPath(),
                        "cache",
                        "-d",
                        "problems",
                        "-t",
                        (0, ConfigUtils_2.getOpenClearProblemCacheTime)().toString(),
                    ]);
                }
                catch (error) {
                    yield (0, OutputUtils_1.ShowMessage)("Failed to delete cache. 请查看控制台信息~", ConstDefind_1.OutPutType.error);
                }
            }
        });
    }
    deleteCache() {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield this.callWithMsg("正在清除缓存~", this.nodeExecutable, [yield this.getLeetCodeBinaryPath(), "cache", "-d"]);
            }
            catch (error) {
                yield (0, OutputUtils_1.ShowMessage)("Failed to delete cache. 请查看控制台信息~", ConstDefind_1.OutPutType.error);
            }
        });
    }
    getUserInfo() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.callWithMsg("正在获取角色信息~", this.nodeExecutable, [
                yield this.getLeetCodeBinaryPath(),
                "user",
            ]);
        });
    }
    signOut() {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.callWithMsg("正在登出~", this.nodeExecutable, [yield this.getLeetCodeBinaryPath(), "user", "-L"]);
        });
    }
    getAllProblems(showLocked, needTranslation) {
        return __awaiter(this, void 0, void 0, function* () {
            const cmd = [yield this.getLeetCodeBinaryPath(), "query", "-d"];
            if (!needTranslation) {
                cmd.push("-T"); // use -T to prevent translation
            }
            if (!showLocked) {
                cmd.push("-q");
                cmd.push("L");
            }
            return yield this.callWithMsg("正在获取题目数据~", this.nodeExecutable, cmd);
        });
    }
    showProblem(problemNode, language, filePath, showDescriptionInComment = false, needTranslation) {
        return __awaiter(this, void 0, void 0, function* () {
            const templateType = showDescriptionInComment ? "-cx" : "-c";
            const cmd = [yield this.getLeetCodeBinaryPath(), "show", problemNode.qid, templateType, "-l", language];
            if (!needTranslation) {
                cmd.push("-T"); // use -T to force English version
            }
            if (!(yield fse.pathExists(filePath))) {
                const codeTemplate = yield this.callWithMsg("正在获取题目数据~", this.nodeExecutable, cmd);
                let successResult;
                try {
                    successResult = JSON.parse(codeTemplate);
                }
                catch (e) {
                    successResult = { code: -1 };
                }
                if (successResult.code == 100) {
                    yield fse.createFile(filePath);
                    yield fse.writeFile(filePath, successResult.msg);
                    return successResult.code;
                }
                else {
                    yield (0, OutputUtils_1.ShowMessage)(`${codeTemplate} 请查看控制台信息~`, ConstDefind_1.OutPutType.error);
                }
                return successResult.code;
            }
            return 100;
        });
    }
    getHelp(input, language, needTranslation, cn_help) {
        return __awaiter(this, void 0, void 0, function* () {
            // solution don't support translation
            const cmd = [yield this.getLeetCodeBinaryPath(), "query", input, "-e", "-g", language];
            if (!needTranslation) {
                cmd.push("-T");
            }
            let solution;
            if (cn_help) {
                cmd.push("-f");
                solution = yield this.callWithMsg("正在获取中文题解~~~", this.nodeExecutable, cmd, undefined, this.tryCnMulSolution, {});
            }
            else {
                solution = yield this.callWithMsg("正在获取题解~~~", this.nodeExecutable, cmd);
            }
            return solution;
        });
    }
    getHints(input) {
        return __awaiter(this, void 0, void 0, function* () {
            // solution don't support translation
            const cmd = [yield this.getLeetCodeBinaryPath(), "query", input, "-h"];
            let solution = yield this.callWithMsg("正在获取提示~~~", this.nodeExecutable, cmd);
            return solution;
        });
    }
    tryCnMulSolution(_, child_process, resolve, reject) {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            (_a = child_process.stdout) === null || _a === void 0 ? void 0 : _a.on("data", (data) => __awaiter(this, void 0, void 0, function* () {
                var _c, _d, _e;
                data = data.toString();
                BABA_1.BABA.getProxy(BABA_1.BabaStr.LogOutputProxy).get_log().append(data);
                let successMatch;
                try {
                    successMatch = JSON.parse(data);
                }
                catch (e) {
                    successMatch = {};
                }
                if (successMatch.oper == "requireOper") {
                    let cookie = successMatch.cookie;
                    let arg = successMatch.arg;
                    if (arg.oper == "need_select") {
                        let canSelect = arg.canSelect || [];
                        const picks = [];
                        canSelect.forEach((element) => {
                            var _a, _b, _c, _d;
                            if ((_a = element === null || element === void 0 ? void 0 : element.node) === null || _a === void 0 ? void 0 : _a.slug) {
                                picks.push({
                                    label: `${element === null || element === void 0 ? void 0 : element.node.title}`,
                                    description: `作者:${(_c = (_b = element === null || element === void 0 ? void 0 : element.node) === null || _b === void 0 ? void 0 : _b.author) === null || _c === void 0 ? void 0 : _c.username}`,
                                    detail: "",
                                    value: (_d = element === null || element === void 0 ? void 0 : element.node) === null || _d === void 0 ? void 0 : _d.slug,
                                });
                            }
                        });
                        const choice = yield vscode_2.window.showQuickPick(picks, {
                            ignoreFocusOut: true,
                        });
                        let select_result = {
                            c: cookie,
                            slug: choice ? choice.value : "",
                        };
                        (_c = child_process.stdin) === null || _c === void 0 ? void 0 : _c.write(JSON.stringify(select_result));
                    }
                    return;
                }
                if (successMatch.code == 100) {
                    (_d = child_process.stdin) === null || _d === void 0 ? void 0 : _d.end();
                    return resolve(data);
                }
                else if (successMatch.code < 0) {
                    (_e = child_process.stdin) === null || _e === void 0 ? void 0 : _e.end();
                    return reject(new Error(successMatch.msg));
                }
            }));
            (_b = child_process.stderr) === null || _b === void 0 ? void 0 : _b.on("data", (data) => {
                BABA_1.BABA.getProxy(BABA_1.BabaStr.LogOutputProxy).get_log().append(data.toString());
            });
            child_process.on("error", reject);
        });
    }
    getUserContest(needTranslation, username) {
        return __awaiter(this, void 0, void 0, function* () {
            // solution don't support translation
            const cmd = [yield this.getLeetCodeBinaryPath(), "query", "-b", username];
            if (!needTranslation) {
                cmd.push("-T");
            }
            const solution = yield this.callWithMsg("正在获取竞赛分信息~", this.nodeExecutable, cmd);
            return solution;
        });
    }
    getScoreDataOnline() {
        return __awaiter(this, void 0, void 0, function* () {
            // solution don't support translation
            const cmd = [yield this.getLeetCodeBinaryPath(), "query", "-c"];
            const solution = yield this.callWithMsg("正在获取分数数据~", this.nodeExecutable, cmd);
            return solution;
        });
    }
    getTestApi(username) {
        return __awaiter(this, void 0, void 0, function* () {
            // solution don't support translation
            const cmd = [yield this.getLeetCodeBinaryPath(), "query", "-z", username];
            const solution = yield this.callWithMsg("Fetching testapi...", this.nodeExecutable, cmd);
            return solution;
        });
    }
    getTodayQuestion(needTranslation) {
        return __awaiter(this, void 0, void 0, function* () {
            // solution don't support translation
            const cmd = [yield this.getLeetCodeBinaryPath(), "query", "-a"];
            if (!needTranslation) {
                cmd.push("-T");
            }
            const solution = yield this.callWithMsg("正在获取每日一题~", this.nodeExecutable, cmd);
            return solution;
        });
    }
    getDescription(problemNodeId, needTranslation) {
        return __awaiter(this, void 0, void 0, function* () {
            const cmd = [yield this.getLeetCodeBinaryPath(), "show", problemNodeId, "-x"];
            if (!needTranslation) {
                cmd.push("-T");
            }
            return yield this.callWithMsg("正在获取题目详情~", this.nodeExecutable, cmd);
        });
    }
    getSubmissionHistory(problemNodeId) {
        return __awaiter(this, void 0, void 0, function* () {
            const cmd = [yield this.getLeetCodeBinaryPath(), "submissions", problemNodeId];
            return yield this.callWithMsg("正在获取提交记录~", this.nodeExecutable, cmd);
        });
    }
    getSubmissionHistoryDetail(problemNodeId, submissionId) {
        return __awaiter(this, void 0, void 0, function* () {
            const cmd = [yield this.getLeetCodeBinaryPath(), "submissions", problemNodeId, "-d", submissionId];
            return yield this.callWithMsg("正在获取提交详情~", this.nodeExecutable, cmd);
        });
    }
    submitSolution(filePath) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                if (systemUtils.useVscodeNode()) {
                    return yield this.callWithMsg("正在提交代码~", this.nodeExecutable, [
                        yield this.getLeetCodeBinaryPath(),
                        "submit",
                        `${filePath}`,
                    ]);
                }
                return yield this.callWithMsg("正在提交代码~", this.nodeExecutable, [
                    yield this.getLeetCodeBinaryPath(),
                    "submit",
                    `"${filePath}"`,
                ]);
            }
            catch (error) {
                if (error.result) {
                    return error.result;
                }
                throw error;
            }
        });
    }
    testSolution(filePath, testString, allCase) {
        return __awaiter(this, void 0, void 0, function* () {
            if (testString) {
                if (systemUtils.useVscodeNode()) {
                    return yield this.callWithMsg("正在提交代码~", this.nodeExecutable, [
                        yield this.getLeetCodeBinaryPath(),
                        "test",
                        `${filePath}`,
                        "-t",
                        `${testString}`,
                    ]);
                }
                return yield this.callWithMsg("正在提交代码~", this.nodeExecutable, [
                    yield this.getLeetCodeBinaryPath(),
                    "test",
                    `"${filePath}"`,
                    "-t",
                    `${testString}`,
                ]);
            }
            if (allCase) {
                if (systemUtils.useVscodeNode()) {
                    return yield this.callWithMsg("正在提交代码~", this.nodeExecutable, [
                        yield this.getLeetCodeBinaryPath(),
                        "test",
                        `${filePath}`,
                        "-a",
                    ]);
                }
                return yield this.callWithMsg("正在提交代码~", this.nodeExecutable, [
                    yield this.getLeetCodeBinaryPath(),
                    "test",
                    `"${filePath}"`,
                    "-a",
                ]);
            }
            if (systemUtils.useVscodeNode()) {
                return yield this.callWithMsg("正在提交代码~", this.nodeExecutable, [
                    yield this.getLeetCodeBinaryPath(),
                    "test",
                    `${filePath}`,
                ]);
            }
            return yield this.callWithMsg("正在提交代码~", this.nodeExecutable, [
                yield this.getLeetCodeBinaryPath(),
                "test",
                `"${filePath}"`,
            ]);
        });
    }
    switchEndpoint(endpoint) {
        return __awaiter(this, void 0, void 0, function* () {
            switch (endpoint) {
                case ConstDefind_1.Endpoint.LeetCodeCN:
                    return yield this.callWithMsg("正在切换登录点~", this.nodeExecutable, [
                        yield this.getLeetCodeBinaryPath(),
                        "plugin",
                        "-e",
                        "leetcode.cn",
                    ]);
                case ConstDefind_1.Endpoint.LeetCode:
                default:
                    return yield this.callWithMsg("正在切换登录点~", this.nodeExecutable, [
                        yield this.getLeetCodeBinaryPath(),
                        "plugin",
                        "-d",
                        "leetcode.cn",
                    ]);
            }
        });
    }
    toggleFavorite(node, addToFavorite) {
        return __awaiter(this, void 0, void 0, function* () {
            const commandParams = [yield this.getLeetCodeBinaryPath(), "star", node.qid];
            if (!addToFavorite) {
                commandParams.push("-d");
            }
            yield this.callWithMsg("正在更新收藏列表~", this.nodeExecutable, commandParams);
        });
    }
    trySignIn(loginMethod) {
        return __awaiter(this, void 0, void 0, function* () {
            const loginArgsMapping = new Map([
                ["LeetCode", "-l"],
                ["Cookie", "-c"],
                ["GitHub", "-g"],
                ["LinkedIn", "-i"],
                ["curltype", "-r"],
            ]);
            let commandArg = loginArgsMapping.get(loginMethod);
            if (!commandArg) {
                throw new Error(`不支持 "${loginMethod}" 方式登录`);
            }
            const cmd = [yield this.getLeetCodeBinaryPath(), "user", commandArg];
            return yield this.callWithMsg("正在登录中~~~~", this.nodeExecutable, cmd, undefined, this.trySignInProcInit, {
                loginMethod: loginMethod,
            });
        });
    }
    trySignInProcInit(arg, child_process, resolve, reject) {
        var _a, _b, _c, _d;
        return __awaiter(this, void 0, void 0, function* () {
            (_a = child_process.stdout) === null || _a === void 0 ? void 0 : _a.on("data", (data) => __awaiter(this, void 0, void 0, function* () {
                var _e, _f, _g;
                data = data.toString();
                // vscode.window.showInformationMessage(`cc login msg ${data}.`);
                BABA_1.BABA.getProxy(BABA_1.BabaStr.LogOutputProxy).get_log().append(data);
                if (data.includes("twoFactorCode")) {
                    const twoFactor = yield vscode_2.window.showInputBox({
                        prompt: "Enter two-factor code.",
                        ignoreFocusOut: true,
                        validateInput: (s) => (s && s.trim() ? undefined : "The input must not be empty"),
                    });
                    if (!twoFactor) {
                        child_process.kill();
                        return resolve(undefined);
                    }
                    (_e = child_process.stdin) === null || _e === void 0 ? void 0 : _e.write(`${twoFactor}\n`);
                }
                let successMatch;
                try {
                    successMatch = JSON.parse(data);
                }
                catch (e) {
                    successMatch = {};
                }
                if (successMatch.code == 100) {
                    (_f = child_process.stdin) === null || _f === void 0 ? void 0 : _f.end();
                    let result = successMatch.user_name || name || "没有取到用户名"; //successMatch.user_name;
                    return resolve(result);
                }
                else if (successMatch.code < 0) {
                    (_g = child_process.stdin) === null || _g === void 0 ? void 0 : _g.end();
                    return reject(new Error(successMatch.msg));
                }
            }));
            (_b = child_process.stderr) === null || _b === void 0 ? void 0 : _b.on("data", (data) => {
                BABA_1.BABA.getProxy(BABA_1.BabaStr.LogOutputProxy).get_log().append(data.toString());
            });
            child_process.on("error", reject);
            const name = yield vscode_2.window.showInputBox({
                prompt: "Enter username or E-mail.",
                ignoreFocusOut: true,
                validateInput: (s) => (s && s.trim() ? undefined : "The input must not be empty"),
            });
            if (!name) {
                child_process.kill();
                return resolve(undefined);
            }
            (_c = child_process.stdin) === null || _c === void 0 ? void 0 : _c.write(`${name}\n`);
            const isByCookie = arg.loginMethod === "Cookie";
            let pwd = undefined;
            if (isByCookie) {
                let cf_v = yield vscode_2.window.showInputBox({
                    title: '正确的cookie例子csrftoken="xxx"; LEETCODE_SESSION="yyy";',
                    prompt: "输入例子中csrftoken的值xxx",
                    ignoreFocusOut: true,
                    validateInput: (s) => (s ? undefined : "csrftoken不为空"),
                });
                let ls_v = yield vscode_2.window.showInputBox({
                    title: '正确的cookie例子csrftoken="xxx"; LEETCODE_SESSION="yyy";',
                    prompt: "输入例子中LEETCODE_SESSION的值yyy",
                    ignoreFocusOut: true,
                    validateInput: (s) => (s && s.trim() ? undefined : "LEETCODE_SESSION不为空"),
                });
                if (cf_v && ls_v) {
                    let cf_v_t = cf_v.trim();
                    let ls_v_t = ls_v.trim();
                    // 判断输入的有没有 " '
                    let cf_flag = cf_v_t[0] == '"' || cf_v_t[0] == "'";
                    let ls_flag = ls_v_t[0] == '"' || ls_v_t[0] == "'";
                    if (cf_flag && ls_flag) {
                        pwd = `csrftoken=${cf_v_t};LEETCODE_SESSION=${ls_v_t};`;
                    }
                    else if (cf_flag) {
                        pwd = `csrftoken=${cf_v_t};LEETCODE_SESSION="${ls_v_t}";`;
                    }
                    else if (ls_flag) {
                        pwd = `csrftoken="${cf_v_t}";LEETCODE_SESSION=${ls_v_t};`;
                    }
                    else {
                        pwd = `csrftoken="${cf_v_t}";LEETCODE_SESSION="${ls_v_t}";`;
                    }
                }
                // csrftoken="xxxx"; LEETCODE_SESSION="xxxx";
            }
            else if (arg.loginMethod === "curltype") {
                pwd = yield vscode_2.window.showInputBox({
                    prompt: "输入从浏览器复制来的cURL请求.",
                    password: true,
                    ignoreFocusOut: true,
                    validateInput: (s) => (s ? undefined : "Password must not be empty"),
                });
                pwd = pwd === null || pwd === void 0 ? void 0 : pwd.trim();
                pwd = pwd === null || pwd === void 0 ? void 0 : pwd.replace(/\\  /g, ' ');
            }
            else {
                pwd = yield vscode_2.window.showInputBox({
                    prompt: "Enter password.",
                    password: true,
                    ignoreFocusOut: true,
                    validateInput: (s) => (s ? undefined : "Password must not be empty"),
                });
            }
            if (!pwd) {
                child_process.kill();
                return resolve(undefined);
            }
            (_d = child_process.stdin) === null || _d === void 0 ? void 0 : _d.write(`${pwd}\n`);
        });
    }
    get node() {
        return this.nodeExecutable;
    }
    dispose() {
        this.configurationChangeListener.dispose();
    }
    initNodePath() {
        if (systemUtils.useVscodeNode()) {
            return "node";
        }
        return (0, ConfigUtils_1.getNodePath)();
    }
    callWithMsg(message, command, args, options = { shell: true }, procInitCallback, procInitCallbackArg) {
        return __awaiter(this, void 0, void 0, function* () {
            if (systemUtils.useWsl()) {
                return yield this.cCall(message, "wsl", [command].concat(args), options, procInitCallback, procInitCallbackArg);
            }
            return yield this.cCall(message, command, args, options, procInitCallback, procInitCallbackArg);
        });
    }
    cCall(message, command, args, options = { shell: true }, procInitCallback, procInitCallbackArg) {
        return __awaiter(this, void 0, void 0, function* () {
            let result = "";
            yield vscode_2.window.withProgress({ location: vscode_1.ProgressLocation.Notification }, (p) => __awaiter(this, void 0, void 0, function* () {
                return new Promise((resolve, reject) => __awaiter(this, void 0, void 0, function* () {
                    p.report({ message });
                    try {
                        result = yield (0, SystemUtils_2.sysCall)(command, args, options, procInitCallback, procInitCallbackArg);
                        resolve();
                    }
                    catch (e) {
                        reject(e);
                    }
                }));
            }));
            return result;
        });
    }
    removeOldCache() {
        return __awaiter(this, void 0, void 0, function* () {
            const oldPath = path.join(os.homedir(), ".lcpr");
            if (yield fse.pathExists(oldPath)) {
                yield fse.remove(oldPath);
            }
        });
    }
}
export const executeService = new ExecuteService();
class ChildCallProxy extends BABA_1.BABAProxy {
    constructor() {
        super(ChildCallProxy.NAME);
    }
    get_instance() {
        return executeService;
    }
}
export { ChildCallProxy };
ChildCallProxy.NAME = BABA_1.BabaStr.ChildCallProxy;
class ChildCallMediator extends BABA_1.BABAMediator {
    constructor() {
        super(ChildCallMediator.NAME);
    }
    listNotificationInterests() {
        return [BABA_1.BabaStr.VSCODE_DISPOST, BABA_1.BabaStr.InitEnv, BABA_1.BabaStr.DeleteCache];
    }
    handleNotification(_notification) {
        return __awaiter(this, void 0, void 0, function* () {
            switch (_notification.getName()) {
                case BABA_1.BabaStr.VSCODE_DISPOST:
                    executeService.dispose();
                    break;
                case BABA_1.BabaStr.InitEnv:
                    if (!systemUtils.useVscodeNode()) {
                        yield executeService.checkNodeEnv(_notification.getBody());
                    }
                    yield executeService.deleteProblemCache();
                    yield executeService.switchEndpoint((0, ConfigUtils_1.getLeetCodeEndpoint)());
                    break;
                case BABA_1.BabaStr.DeleteCache:
                    executeService.deleteCache();
                    break;
                default:
                    break;
            }
        });
    }
}
export { ChildCallMediator };
ChildCallMediator.NAME = BABA_1.BabaStr.ChildCallMediator;
