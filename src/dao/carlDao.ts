export interface ICarlProblemSection {
  id: string;
  name: string;
  questions: string[];
}

class CarlDao {
  // Source: https://github.com/youngyangyang04/leetcode-master README
  // Synced on 2026-07-01. Non-LeetCode, theory, summary, and duplicate-in-section entries are omitted.
  private readonly problemList: ICarlProblemSection[] = [
    {
      id: "array",
      name: "数组",
      questions: ["704", "27", "977", "209", "59"],
    },
    {
      id: "linked-list",
      name: "链表",
      questions: ["203", "707", "206", "24", "19", "面试题 02.07", "142"],
    },
    {
      id: "hash-table",
      name: "哈希表",
      questions: ["242", "1002", "349", "202", "1", "454", "383", "15", "18"],
    },
    {
      id: "string",
      name: "字符串",
      questions: ["344", "541", "151", "28", "459"],
    },
    {
      id: "two-pointers",
      name: "双指针法",
      questions: ["27", "344", "151", "206", "19", "面试题 02.07", "142", "15", "18"],
    },
    {
      id: "stack-queue",
      name: "栈与队列",
      questions: ["232", "225", "20", "1047", "150", "239", "347"],
    },
    {
      id: "binary-tree",
      name: "二叉树",
      questions: [
        "102", "226", "101", "104", "111", "222", "110", "257", "404", "513", "112", "106", "654", "617", "700",
        "98", "530", "501", "236", "235", "701", "450", "669", "108", "538",
      ],
    },
    {
      id: "backtracking",
      name: "回溯算法",
      questions: ["77", "216", "17", "39", "40", "131", "93", "78", "90", "491", "46", "47", "332", "51", "37"],
    },
    {
      id: "greedy",
      name: "贪心算法",
      questions: ["455", "376", "53", "122", "55", "45", "1005", "134", "135", "860", "406", "452", "435", "763", "56", "738", "968"],
    },
    {
      id: "dynamic-programming",
      name: "动态规划",
      questions: [
        "509", "70", "746", "62", "63", "343", "96", "416", "1049", "494", "474", "518", "377", "322", "279",
        "139", "198", "213", "337", "121", "122", "123", "188", "309", "714", "300", "674", "718", "1143",
        "1035", "53", "392", "115", "583", "72", "647", "516",
      ],
    },
    {
      id: "monotonic-stack",
      name: "单调栈",
      questions: ["739", "496", "503", "42", "84"],
    },
  ];

  public getProblemList(): ICarlProblemSection[] {
    return this.problemList;
  }

  public getSection(id: string): ICarlProblemSection | undefined {
    return this.problemList.find((section) => section.id === id);
  }
}

export const carlDao = new CarlDao();
