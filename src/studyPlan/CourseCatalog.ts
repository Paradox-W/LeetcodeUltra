import {
  CourseMigrationProblem,
  CourseProblem,
  StudyCourseSnapshot,
} from "./StudyPlanTypes";

const TOPICS = [
  "数组、二分、滑窗、前缀和",
  "链表基础、反转、快慢指针",
  "哈希、双指针、基础滑窗",
  "字符串、KMP、栈队列基础",
  "栈队列进阶、树遍历、堆",
  "树的递归性质与路径",
  "二叉搜索树",
  "回溯：组合、分割、子集",
  "排列与贪心入门",
  "跳跃与区间贪心",
  "DP 基础与 0/1 背包",
  "背包、完全背包、打家劫舍",
  "打家劫舍、股票、LIS/LCS",
  "子序列 DP 与单调栈入门",
  "单调栈与图遍历",
  "连通性、拓扑、最短路、Trie/位运算",
];

const WEEKS: string[][] = [
  ["704", "27", "977", "209", "59", "303", "304"],
  ["203", "707", "206", "24", "19", "160", "142"],
  ["242", "349", "202", "1", "454", "383", "15", "3"],
  ["344", "541", "151", "28", "459", "20", "232", "225"],
  ["1047", "150", "347", "239", "144", "94", "145", "102", "215"],
  ["226", "101", "104", "111", "110", "257", "112", "106"],
  ["617", "700", "98", "530", "236", "701", "108", "450"],
  ["77", "216", "17", "39", "40", "131", "78", "90"],
  ["46", "47", "455", "376", "53", "122", "55"],
  ["45", "1005", "134", "860", "452", "435", "763", "56"],
  ["509", "70", "746", "62", "63", "343", "96", "416"],
  ["1049", "494", "474", "518", "377", "322", "139", "198"],
  ["213", "337", "121", "309", "714", "300", "1143"],
  ["718", "1035", "392", "583", "72", "647", "516", "739"],
  ["496", "503", "42", "84", "797", "200", "695", "130"],
  ["417", "1971", "684", "207", "210", "743", "208", "136"],
];

const HEAVY = new Set([
  "239", "106", "236", "450", "40", "131", "47", "45", "134", "416",
  "494", "474", "322", "337", "309", "714", "300", "1143", "72", "516",
  "42", "84", "130", "417", "684", "210", "743",
]);

const COMPARISON_GROUPS: { [fid: string]: string } = {
  "704": "binary-search", "27": "two-pointers", "209": "sliding-window",
  "206": "linked-list-reversal", "24": "linked-list-reversal", "19": "fast-slow-pointers",
  "160": "linked-list-intersection", "142": "fast-slow-pointers", "15": "sorted-two-pointers",
  "3": "sliding-window", "28": "string-matching", "459": "string-matching",
  "232": "stack-queue-conversion", "225": "stack-queue-conversion", "144": "tree-traversal",
  "94": "tree-traversal", "145": "tree-traversal", "104": "tree-depth", "111": "tree-depth",
  "98": "bst-invariant", "530": "bst-invariant", "77": "combination-backtracking",
  "39": "combination-backtracking", "40": "combination-backtracking", "78": "subset-backtracking",
  "90": "subset-backtracking", "46": "permutation-backtracking", "47": "permutation-backtracking",
  "55": "jump-greedy", "45": "jump-greedy", "452": "interval-greedy", "435": "interval-greedy",
  "56": "interval-greedy", "62": "grid-dp", "63": "grid-dp", "416": "knapsack-01",
  "1049": "knapsack-01", "494": "knapsack-01", "474": "knapsack-01", "518": "knapsack-complete",
  "377": "knapsack-complete", "322": "knapsack-complete", "198": "house-robber", "213": "house-robber",
  "337": "house-robber", "121": "stock-dp", "309": "stock-dp", "714": "stock-dp",
  "300": "subsequence-dp", "1143": "subsequence-dp", "718": "subsequence-dp", "1035": "subsequence-dp",
  "392": "subsequence-dp", "583": "edit-distance", "72": "edit-distance", "647": "palindrome-dp",
  "516": "palindrome-dp", "739": "monotonic-stack", "496": "monotonic-stack", "503": "monotonic-stack",
  "42": "monotonic-stack", "84": "monotonic-stack", "797": "graph-traversal", "200": "graph-traversal",
  "695": "graph-traversal", "130": "graph-traversal", "1971": "connectivity", "684": "connectivity",
  "207": "topological-sort", "210": "topological-sort",
};

const MIGRATION_POOL: CourseMigrationProblem[] = [
  { fid: "283", topic: TOPICS[0] },
  { fid: "643", topic: TOPICS[0] },
  { fid: "724", topic: TOPICS[0] },
  { fid: "2215", topic: TOPICS[2] },
  { fid: "872", topic: TOPICS[5] },
  { fid: "1448", topic: TOPICS[5] },
  { fid: "841", topic: TOPICS[14] },
  { fid: "994", topic: TOPICS[14] },
  { fid: "338", topic: TOPICS[15] },
  { fid: "1268", topic: TOPICS[15] },
  { fid: "901", topic: TOPICS[14] },
  { fid: "1004", topic: TOPICS[2] },
];

function buildCore(): CourseProblem[] {
  const core: CourseProblem[] = [];
  let order = 0;
  WEEKS.forEach((weekProblems, weekIndex) => {
    weekProblems.forEach((fid) => {
      order++;
      core.push({
        fid,
        week: weekIndex + 1,
        order,
        topic: TOPICS[weekIndex],
        heavy: HEAVY.has(fid),
        comparisonGroup: COMPARISON_GROUPS[fid] || `week-${weekIndex + 1}`,
      });
    });
  });
  return core;
}
export const CARL_FOUNDATION_V1: StudyCourseSnapshot = {
  id: "carl-foundation-v1",
  version: 1,
  syncedAt: "2026-07-22",
  disclaimer: "本课程是 LeetcodeUltra 编排的非官方日历，不代表代码随想录或 LeetCode 官方训练安排。",
  sources: [
    { label: "代码随想录官方路线", url: "https://github.com/youngyangyang04/leetcode-master" },
    { label: "代码随想录训练营说明", url: "https://programmercarl.com/xunlian/xunlianying.html" },
    { label: "LeetCode 75", url: "https://leetcode.com/studyplan/leetcode-75/" },
    { label: "间隔学习元分析", url: "https://doi.org/10.1037/0033-2909.132.3.354" },
    { label: "检索练习课堂元分析", url: "https://doi.org/10.1037/bul0000309" },
    { label: "检索练习迁移元分析", url: "https://doi.org/10.1037/bul0000151" },
    { label: "交错学习元分析", url: "https://doi.org/10.1037/bul0000209" },
    { label: "Ebbinghaus 曲线复现", url: "https://doi.org/10.1371/journal.pone.0120644" },
  ],
  core: buildCore(),
  migrationPool: MIGRATION_POOL,
};

export function validateCourse(course: StudyCourseSnapshot): string[] {
  const issues: string[] = [];
  if (course.core.length !== 125) {
    issues.push(`核心题数量应为 125，实际为 ${course.core.length}`);
  }
  const unique = new Set(course.core.map((problem) => problem.fid));
  if (unique.size !== course.core.length) {
    issues.push("核心题存在重复题号");
  }
  const expectedOrder = course.core.every((problem, index) => problem.order === index + 1);
  if (!expectedOrder) {
    issues.push("核心题顺序字段不连续");
  }
  if (course.core.some((problem) => problem.week < 1 || problem.week > 16)) {
    issues.push("核心题周次超出 1-16");
  }
  const migrationIds = course.migrationPool.map((problem) => problem.fid);
  if (new Set(migrationIds).size !== migrationIds.length || migrationIds.some((fid) => unique.has(fid))) {
    issues.push("迁移池必须唯一且不能与核心题重复");
  }
  if (!course.sources.length || !course.syncedAt || !course.disclaimer) {
    issues.push("课程来源、同步日期和非官方声明不能为空");
  }
  return issues;
}
