// @ts-nocheck
/*
 * Filename: /home/cc/leetcode-extension/src/treeColor/TreeColorModule.ts
 * Path: /home/cc/leetcode-extension
 * Created Date: Thursday, October 19th 2023, 00:40:45 am
 * Author: ccagml
 *
 * Copyright (c) 2023 ccagml . All rights reserved
 */
import * as url_1 from "url";
import * as vscode_1 from "vscode";
import * as BABA_1 from "../BABA";
import * as TreeNodeModel_1 from "../model/TreeNodeModel";
import * as SystemUtils_1 from "../utils/SystemUtils";
import * as ProblemListDisplayModule_1 from "../workbench/ProblemListDisplayModule";
class TreeColor {
    constructor() {
        this.ITEM_COLOR = {
            easy: new vscode_1.ThemeColor("lcpr.problem.easyForeground"),
            medium: new vscode_1.ThemeColor("lcpr.problem.mediumForeground"),
            hard: new vscode_1.ThemeColor("lcpr.problem.hardForeground"),
            green: new vscode_1.ThemeColor("lcpr.problem.easyForeground"),
            blue: new vscode_1.ThemeColor("lcpr.problem.warmupForeground"),
            purple: new vscode_1.ThemeColor("lcpr.problem.normalForeground"),
            yellow: new vscode_1.ThemeColor("lcpr.problem.mediumForeground"),
            red: new vscode_1.ThemeColor("lcpr.problem.hardForeground"), // 高于200
        };
    }
    provideFileDecoration(uri) {
        if (!this.isDifficultyBadgeEnabled()) {
            return;
        }
        // 不是插件的上色点
        if (uri.scheme !== "lcpr") {
            return;
        }
        if ((0, TreeNodeModel_1.is_problem_by_nodeType)(uri.authority)) {
            return this.leafColor(uri);
        }
        // 看是不是日期节点
        if (Number(uri.authority) == TreeNodeModel_1.TreeNodeType.Bricks_NeedReview_Day) {
            return this.NeedReview_Day_Color(uri);
        }
        return;
    }
    // 复习过期颜色
    NeedReview_Day_Color(uri) {
        const params = new url_1.URLSearchParams(uri.query);
        const groupTimeStr = params.get("groupTime") || "0";
        const groupTime = Number(groupTimeStr);
        const file_color = {};
        if (groupTime > 0) {
            let cur_time = (0, SystemUtils_1.getDayNow)();
            if (cur_time > (groupTime + 86400)) {
                file_color.color = this.ITEM_COLOR.red;
                file_color.tooltip = `已过期${(0, SystemUtils_1.getYMD)(groupTime)}`;
            }
        }
        return file_color;
    }
    // 叶子的颜色既问题难度分的颜色
    leafColor(uri) {
        const params = new url_1.URLSearchParams(uri.query);
        // const difficulty: string = params.get("difficulty")!.toLowerCase();
        const score = params.get("score") || "0";
        // const user_score: string = params.get("user_score") || "0";
        const user_score = BABA_1.BABA.getProxy(BABA_1.BabaStr.StatusBarProxy).getUserContestScore();
        const file_color = {};
        const score_num = Number(score);
        const user_score_num = Number(user_score);
        if (score_num > 0) {
            if (user_score_num > 0) {
                const diff_num = score_num - user_score_num;
                // green: 低于玩家分数 200 分
                // blue: 低于玩家分数 50 - 199 分
                // purple: 高于玩家 50 到低于 49
                // yellow: 高于玩家 50 - 199
                // red: 高于 200
                if (diff_num < -200) {
                    file_color.color = this.ITEM_COLOR.green;
                    file_color.tooltip = "秒杀难度";
                }
                else if (diff_num < -50) {
                    file_color.color = this.ITEM_COLOR.blue;
                    file_color.tooltip = "热身难度";
                }
                else if (diff_num < 50) {
                    file_color.color = this.ITEM_COLOR.purple;
                    file_color.tooltip = "普通难度";
                }
                else if (diff_num < 199) {
                    file_color.color = this.ITEM_COLOR.yellow;
                    file_color.tooltip = "吃力难度";
                }
                else {
                    file_color.color = this.ITEM_COLOR.red;
                    file_color.tooltip = "劝退难度";
                }
            }
            else {
                file_color.tooltip = "还没有竞赛分";
            }
        }
        else {
            const difficulty = params.get("difficulty") || "0";
            if (difficulty == "Easy") {
                file_color.color = this.ITEM_COLOR.green;
                file_color.tooltip = "简单难度";
            }
            else if (difficulty == "Medium") {
                file_color.color = this.ITEM_COLOR.yellow;
                file_color.tooltip = "中等难度";
            }
            else if (difficulty == "Hard") {
                file_color.color = this.ITEM_COLOR.red;
                file_color.tooltip = "困难难度";
            }
        }
        return file_color;
    }
    isDifficultyBadgeEnabled() {
        const options = (0, ProblemListDisplayModule_1.getProblemListDisplayOptions)();
        if (Object.prototype.hasOwnProperty.call(options, "showDifficultyColor")) {
            return !!options.showDifficultyColor;
        }
        const configuration = vscode_1.workspace.getConfiguration("leetcode-problem-rating");
        return configuration.get("colorizeProblems", false);
    }
}
export { TreeColor };
export const treeColor = new TreeColor();
