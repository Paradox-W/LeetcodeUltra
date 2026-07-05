# LeetcodeUltra

LeetcodeUltra 是一个面向高频刷题、复盘和本地调试重新设计的 VS Code LeetCode 助手。

它不是只把题目拉到编辑器里，而是把题目阅读、测试用例、运行结果、提交记录、性能分布、备注和 C++ 调试整理成一条连续的工作流。你可以在 VS Code 里打开题目、编辑代码、管理用例、查看提交历史、复盘错误版本，并在需要时启动本地调试。

![LeetcodeUltra workspace overview](https://cdn.jsdelivr.net/gh/Paradox-W/LeetcodeUltra@main/resources/marketplace/workspace-overview.png)

## 为什么做 LeetcodeUltra

原始 LeetCode 插件解决了“能在 VS Code 刷题”的问题，但高频刷题时真正消耗时间的地方往往不是打开题目，而是这些细节：

- 多个测试用例反复复制、修改、保存。
- 运行结果、提交结果和题目描述分散在不同位置。
- 提交记录很难和当时的思路、错误原因对应起来。
- Accepted 之后只看到一个结果，不容易判断性能表现是否稳定。
- C++ 本地调试需要 wrapper、输入文件、断点和调试器配置配合，流程容易断。

LeetcodeUltra 的目标是把这些碎片整理成一个更像 IDE 的 LeetCode 工作台。

## 核心亮点

### 1. 重新设计的力扣控制台

底部控制台被重做为“结果区 + 用例区”的工作台。提交、运行全部用例、单用例运行、单用例调试都在同一处完成，不需要在命令面板、编辑器和终端之间来回切。

- 每个用例独立展示，支持编辑、运行、调试、删除。
- 测试用例直接在控制台里改，自动写回题目文件。
- 支持恢复官方默认用例。
- 通过、答案错误、运行中、请求失败等状态用更清晰的中文结果呈现。
- Accepted 结果首屏展示关键信息，减少无效滚动。

![Workbench correct case result](https://cdn.jsdelivr.net/gh/Paradox-W/LeetcodeUltra@main/resources/marketplace/console-correct.png)

![Workbench wrong answer result](https://cdn.jsdelivr.net/gh/Paradox-W/LeetcodeUltra@main/resources/marketplace/console-wrong-answer.png)

![Workbench accepted result with performance charts](https://cdn.jsdelivr.net/gh/Paradox-W/LeetcodeUltra@main/resources/marketplace/console-accepted.png)

### 2. 提交结果和性能分布

Accepted 不只是一个绿色状态。LeetcodeUltra 会把运行时间和内存占用整理成紧凑的性能卡片，让你快速判断这次提交处在什么位置。

- 展示用例通过数量、语言、运行时间、内存占用。
- 运行时间和内存分布以图表方式展示。
- 支持百分位、局部分布和当前位置标记。
- 小尺寸底部面板也能看清主要信息。

![Submission detail and performance charts](https://cdn.jsdelivr.net/gh/Paradox-W/LeetcodeUltra@main/resources/marketplace/submission-detail.png)

### 3. 右侧题目助手

题目描述、题解、提示和提交记录集中在右侧栏，代码编辑区保持稳定，不再频繁打开临时预览页或打断当前文件。

- 题目描述适配侧栏阅读。
- 示例输入、输出、解释重新排版。
- 题解、讨论、提交记录在题目上下文里切换。
- 难度与标签收纳在题目底部，减少干扰。
- 适合宽屏下“左边题单 / 中间代码 / 右边题目与记录”的布局。

### 4. 提交记录、详情和本地备注

提交记录被做成原生侧栏列表。你可以查看每次提交的状态、语言、时间、运行时间和内存，并打开详情页复盘代码。

- 支持按状态和语言筛选提交记录。
- 支持备注搜索。
- 每条提交可以写本地备注，记录当时的错误原因、优化点或复盘结论。
- 详情页展示提交代码、性能图表和备注编辑区。
- 备注保存在工作区 `.lcpr_data/submission-notes/`，方便跟随刷题目录管理。

![Submission history](https://cdn.jsdelivr.net/gh/Paradox-W/LeetcodeUltra@main/resources/marketplace/submission-history.png)

### 5. 更顺手的 C++ 本地调试

C++ 调试现在由 LeetcodeUltra 内置的 harness generator 生成 wrapper，再通过 CodeLLDB 启动本地调试会话。用户不再需要额外安装 LeetCode Debugger for C++；LeetcodeUltra 会自己把控制台测试用例和调试输入接起来。

- 从控制台单个用例直接启动调试。
- 当前用例自动写入 `test_case.txt`，避免在终端重复手输。
- 自动修补生成的 `leetcode-main.cpp` 输入来源。
- 自动设置入口断点 / 函数断点，避免程序一闪而过。
- 与 `vadimcn.vscode-lldb` 配合使用。

![C++ debugging with LeetcodeUltra](https://cdn.jsdelivr.net/gh/Paradox-W/LeetcodeUltra@main/resources/marketplace/cpp-debug.png)

推荐安装：

- `vadimcn.vscode-lldb`

### 6. 可选的实验性 AI 调试

AI 调试目前是实验能力，默认关闭。普通 C++ 调试不依赖它，也不会自动打开 AI 面板。

当你在控制台勾选 `开启 AI 调试` 后，LeetcodeUltra 会在调试会话启动后打开 AI 调试视图，尝试分析并展示关键变量。它适合继续探索数组、字符串、容器、链表等常见结构的可视化调试，但现阶段仍建议把它当作辅助观察面板，而不是稳定主流程。

这也是为什么开关默认关闭：日常使用先保证本地调试稳定，AI 能力逐步迭代。

![Experimental AI debugging panel](https://cdn.jsdelivr.net/gh/Paradox-W/LeetcodeUltra@main/resources/marketplace/ai-debug-panel.png)

### 7. 题单、评分和练习管理

LeetcodeUltra 保留并增强了原项目的题单能力，适合按难度、标签、分数和复习节奏组织刷题。

- 支持 LeetCode 中文站。
- 支持题目评分数据。
- 支持每日一题、精选分类、剑指 Offer、面试金典等分组。
- 支持收藏、随机一题、按分数范围选题。
- 支持搬砖 / 重复练习数据，刷过的题可以按间隔再练。
- 支持本地 remark 备注。

## 推荐工作流

1. 在左侧题单中选择题目。
2. 在中间编辑器写代码，右侧题目助手查看题面和示例。
3. 在底部控制台管理多个测试用例。
4. 单独运行失败用例，必要时点击该用例的调试按钮。
5. 通过后提交，查看运行时间和内存分布。
6. 在提交记录里为关键版本写备注，方便之后复盘。

## 与原始插件的关系

LeetcodeUltra 是基于 MIT 协议的 [ccagml/leetcode-extension](https://github.com/ccagml/leetcode-extension) 派生增强版本，并使用独立扩展身份发布。

本项目保留原始 MIT 许可证与上游归属，同时在 UI、控制台、提交记录、性能展示、右侧助手和 C++ 调试体验上做了较大幅度的产品化改造。

- 当前项目：https://github.com/Paradox-W/LeetcodeUltra
- 上游项目：https://github.com/ccagml/leetcode-extension
- 许可证：[MIT](./LICENSE)
- 归属说明：[NOTICE.md](./NOTICE.md)

## 运行要求

- VS Code 1.57.0+
- 建议使用 LeetCode 中文站账号。
- C++ 本地调试建议安装 CodeLLDB 与 LeetCode Debugger for C++。

## 常用配置

```json
{
  "leetcode-problem-rating.endpoint": "leetcode.cn",
  "leetcode-problem-rating.useEndpointTranslation": true,
  "leetcode-problem-rating.useVscodeNode": true,
  "leetcode-problem-rating.showCommentDescription": false,
  "leetcode-problem-rating.workspaceFolder": "/path/to/leetcode",
  "leetcode-problem-rating.defaultLanguage": "cpp"
}
```

## 数据位置

LeetcodeUltra 会在刷题工作区保存本地数据：

```text
<workspace>/.lcpr_data/
  bricks.json
  group.json
  remark/
  submission-notes/
```

这些数据用于重复练习、题目分组、备注和提交记录备注。

## 更新日志

请参考 [CHANGELOG.md](./CHANGELOG.md)。
