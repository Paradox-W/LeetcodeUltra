/*
 * Filename: /home/cc/leetcode-extension/src/model/TreeNodeModel.ts
 * Path: /home/cc/leetcode-extension
 * Created Date: Tuesday, October 24th 2023, 7:45:05 pm
 * Author: ccagml
 *
 * Copyright (c) 2023 ccagml . All rights reserved
 */

import { Command, Uri } from "vscode";
import { BABA, BabaStr } from "../BABA";
import { IScoreData, ProblemState, RootNodeSort } from "./ConstDefind";

// 普通节点数据
export interface ITreeDataNormal {
  id: string;
  name: string;
  rootNodeSortId: RootNodeSort;
}

// 查询节点
export interface ITreeDataSearch {
  id: string;
  name: string;
  rootNodeSortId: RootNodeSort;
  input: string;
  isSearchResult: boolean;
}

// 每日一题的节点
export interface ITreeDataDay {
  id: string;
  name: string;
  rootNodeSortId: RootNodeSort;
  input: string;
  isSearchResult: boolean;
  todayData: ITodayDataResponse | undefined;
}

export interface IQuestionData {
  isFavorite: boolean;
  locked: boolean;
  state: ProblemState;
  id: string; // 题目编号 fid
  qid: string;
  name: string;
  cn_name: string;
  en_name: string;
  difficulty: string;
  passRate: string;
  companies: string[];
}

// 今天搬砖的点
export interface IBricksToday {
  id: string;
  name: string;
  collapsibleState?;
  groupTime?;
  toolTip?;
}

// 每日一题的数据
// "{\"titleSlug\":\"number-of-dice-rolls-with-target-sum\",\"questionId\":\"1263\",\"fid\":\"1155\",\"userStatus\":\"NOT_START\"}\n"
export interface ITodayDataResponse {
  date: string; // 日期
  userStatus: string; // 状态   'NOT_START' 'FINISH'
  titleSlug: string;
  questionId: string;
  fid: string;
  time: number;
}

// 竞赛的数据
export interface IContestData {
  index: number;
  title: string;
  titleSlug: string;
  startTime: number;
  duration: number;
}

export enum TreeNodeType {

  // 功能节点
  TreeNotSignIn = 30100,
  BricksNotSignIn = 30200,
  TreeQuestionData = 30300,

  // 四位
  // 万位  1:题目列表 2:搬砖工地
  // 千位  第一层的标识
  // 百位  第一层的标识
  // 十位  第二层的标识
  // 个位  第三层标识

  Tree_day = 10100,  // 题目列表 每日一题
  Tree_day_leaf = 10111,  // 题目列表 每日一题的叶子
  Tree_All = 10200,   // all层
  Tree_All_leaf = 10211, // all层 的题目

  Tree_difficulty = 10300,   // difficulty
  Tree_difficulty_easy = 10310,   // difficulty/easy
  Tree_difficulty_easy_leaf = 10311,   // difficulty/easy
  Tree_difficulty_mid = 10320,   // difficulty/medium
  Tree_difficulty_mid_leaf = 10321,   // difficulty/medium
  Tree_difficulty_hard = 10330,   // difficulty/hard
  Tree_difficulty_hard_leaf = 10331,   // difficulty/hard

  Tree_tag = 10400, // tag
  Tree_tag_fenlei = 10410, // tag
  Tree_tag_fenlei_leaf = 10411, // tag

  Tree_favorite = 10500, // favorite
  Tree_favorite_leaf = 10511, // 题目

  Tree_choice = 10600, // choice
  Tree_choice_fenlei = 10610, // choice 分类层
  Tree_choice_fenlei_leaf = 10611, // choice 分类层

  Tree_score = 10700,// score
  Tree_score_fen = 10710, //具体分数层
  Tree_score_fen_leaf = 10711, //具体分数层

  Tree_contest = 10800, // contest
  Tree_contest_Q1 = 10810, // contest q1
  Tree_contest_Q1_leaf = 10811, // contest q1
  Tree_contest_Q2 = 10820, // contest q2
  Tree_contest_Q2_leaf = 10821, // contest q2
  Tree_contest_Q3 = 10830, // contest q3
  Tree_contest_Q3_leaf = 10831, // contest q3
  Tree_contest_Q4 = 10840, // contest q4
  Tree_contest_Q4_leaf = 10841, // contest q4

  Tree_search = 10900, // 查询分数范围,周赛期数
  Tree_search_score_leaf = 10911, // 分数范围的叶子
  Tree_search_contest_leaf = 10921, // 分数范围的叶子

  Tree_recentContestList = 11000,  // 题目列表 最近比赛列表
  Tree_recentContestList_contest = 11010,  // 题目列表 最近比赛列表/比赛
  Tree_recentContestList_contest_leaf = 11011,  // 题目列表 最近比赛列表/比赛/题目

  Tree_carl = 11100, // 代码随想录题单
  Tree_carl_section = 11110, // 代码随想录题单/板块
  Tree_carl_section_leaf = 11111, // 代码随想录题单/板块/题目

  // 工地=================

  Bricks_NeedReview = 20100,  // 工地 有需要复习
  Bricks_NeedReview_Day = 20110,  // 工地 有需要复习,日期那层
  Bricks_NeedReview_Day_leaf = 20111, // 工地 有需要复习,题目

  Bricks_NoReview = 20200, // 工地 没有需要复习

  Bricks_TodaySubmit = 20300, // 工地 今日提交
  Bricks_TodaySubmit_leaf = 20301, // 工地 今日提交


  Bricks_Diy = 20400, // 工地 自己创建的那层
  Bricks_Diy_leaf = 20401, // 工地 自己创建的那层


}


export function is_problem_by_nodeType(nt) {
  let nodeType = Number(nt)
  return (
    nodeType == TreeNodeType.Tree_search_score_leaf ||
    nodeType == TreeNodeType.Tree_search_contest_leaf ||
    nodeType == TreeNodeType.Tree_day_leaf ||
    nodeType == TreeNodeType.Tree_All_leaf ||
    nodeType == TreeNodeType.Tree_difficulty_easy_leaf ||
    nodeType == TreeNodeType.Tree_difficulty_mid_leaf ||
    nodeType == TreeNodeType.Tree_difficulty_hard_leaf ||
    nodeType == TreeNodeType.Tree_tag_fenlei_leaf ||
    nodeType == TreeNodeType.Tree_favorite_leaf ||
    nodeType == TreeNodeType.Tree_choice_fenlei_leaf ||
    nodeType == TreeNodeType.Tree_score_fen_leaf ||
    nodeType == TreeNodeType.Tree_contest_Q1_leaf ||
    nodeType == TreeNodeType.Tree_contest_Q2_leaf ||
    nodeType == TreeNodeType.Tree_contest_Q3_leaf ||
    nodeType == TreeNodeType.Tree_contest_Q4_leaf ||
    nodeType == TreeNodeType.Bricks_NeedReview_Day_leaf ||
    nodeType == TreeNodeType.Bricks_TodaySubmit_leaf ||
    nodeType == TreeNodeType.Bricks_Diy_leaf ||
    nodeType == TreeNodeType.Tree_recentContestList_contest_leaf ||
    nodeType == TreeNodeType.Tree_carl_section_leaf
  );

}

export function CreateTreeNodeModel(data: ITreeDataNormal | ITreeDataSearch | ITreeDataDay | IQuestionData | IBricksToday, nodeType: TreeNodeType): TreeNodeModel {
  return new TreeNodeModel(data, nodeType);
}


export class TreeNodeModel {
  __DataPool: Map<TreeNodeType, any> = new Map<TreeNodeType, any>();

  constructor(
    data: ITreeDataNormal | ITreeDataSearch | ITreeDataDay | IQuestionData | IBricksToday,
    public nodeType: TreeNodeType
  ) {
    this.init_data(data);
  }

  public get_data() {
    return this.__DataPool.get(this.nodeType);
  }
  public init_data(data: ITreeDataNormal | ITreeDataSearch | ITreeDataDay | IQuestionData | IBricksToday) {
    this.__DataPool.set(this.nodeType, data);
  }

  public get rootNodeSortId(): RootNodeSort {
    return this.get_data()?.rootNodeSortId;
  }

  public get qid(): string {
    return this.get_data()?.qid || "";
  }
  public get id(): string {
    return this.get_data()?.id || "";
  }
  public get fid(): string {
    return this.get_data()?.id || "";
  }
  public get toolTip(): string {
    return this.get_data()?.toolTip || "";
  }

  public get name(): string {
    return this.get_data()?.name || "";
  }
  public get cn_name(): string {
    return this.get_data()?.cn_name;
  }
  public get en_name(): string {
    return this.get_data()?.en_name;
  }

  public get collapsibleState() {
    return this.get_data()?.collapsibleState;
  }

  public get acceptanceRate(): number {
    return Number(this.get_data()?.passRate) || 50;
  }
  public get groupTime(): number {
    return Number(this.get_data()?.groupTime) || 0;
  }

  public get locked(): boolean {
    return this.get_data()?.locked;
  }

  public get passRate(): string {
    return this.get_data()?.passRate;
  }

  public get difficulty(): string {
    return this.get_data()?.difficulty;
  }

  public get companies(): string[] {
    return this.get_data()?.companies;
  }

  public get input(): string {
    return this.get_data()?.input || "";
  }

  public get isFavorite(): boolean {
    return this.get_data()?.isFavorite;
  }

  public get isSearchResult(): boolean {
    return this.nodeType == TreeNodeType.Tree_search || this.nodeType == TreeNodeType.Tree_day;
  }

  public get isProblem(): boolean {
    return is_problem_by_nodeType(this.nodeType)
  }

  public get viewItem(): string {
    if (this.isProblem) {
      return `leaf#${this.nodeType}#${this.isFavorite ? "fav-on" : "fav-off"}`
    }
    return `cc#${this.nodeType}#`
  }  // rank分
  public get score(): string {
    return BABA.getProxy(BabaStr.RankScoreDataProxy).getDataByFid(this.fid)?.score || "0";
  }
  // 周赛名称
  public get ContestID_en(): string {
    return BABA.getProxy(BabaStr.RankScoreDataProxy).getDataByFid(this.fid)?.ContestID_en || "";
  }
  // 周赛第几题
  public get ProblemIndex(): string {
    return BABA.getProxy(BabaStr.RankScoreDataProxy).getDataByFid(this.fid)?.ProblemIndex || "";
  }
  // 周赛名称符号链接
  public get ContestSlug(): string {
    return BABA.getProxy(BabaStr.RankScoreDataProxy).getDataByFid(this.fid)?.ContestSlug || "";
  }

  public get scoreData(): IScoreData | undefined {
    return BABA.getProxy(BabaStr.RankScoreDataProxy).getDataByFid(this.fid);
  }

  public get tags(): string[] {
    return BABA.getProxy(BabaStr.TreeDataProxy).getTagsData(this.fid) || [];
  }

  public get state(): ProblemState {
    // 每日一题的修正

    if (BABA.getProxy(BabaStr.TodayDataProxy).getTodayData(this.fid)) {
      const us = BABA.getProxy(BabaStr.TodayDataProxy).getTodayData(this.fid)?.userStatus || "";
      if (us == "FINISH") {
        return ProblemState.AC;
      } else {
        return ProblemState.Unknown;
      }
    }
    return this.get_data()?.state;
  }

  public get previewCommand(): Command {
    return {
      title: "Preview Problem",
      command: "lcpr.previewProblem",
      arguments: [this],
    };
  }

  public nodeUri_Query() {
    if (this.isProblem) {
      return `nodeType=${this.nodeType}&difficulty=${this.difficulty}&score=${this.score}`
    }
    return `nodeType=${this.nodeType}&groupTime=${this.groupTime || 0}`;
  }

  public get TNMUri(): Uri {

    // scheme://authority/path?query#fragment

    return Uri.from({
      scheme: "lcpr",
      authority: `${this.nodeType}`,
      path: `/${this.id}`, // path must begin with slash /
      query: this.nodeUri_Query(),
      fragment: this.viewItem
    });
  }
}
