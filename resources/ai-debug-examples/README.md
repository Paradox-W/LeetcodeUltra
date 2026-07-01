# AI Debug Examples

这些文件是 LeetCode 形状的小程序，用来在 Extension Development Host 里验证 AI 调试。
C++ 的基础结构支持通过 `scripts/ai-debug-smoke.js` 的 mock DAP 会话验证；真实运行时取决于本机 C++ 调试适配器。

1. 打开一个示例文件。
2. 用 VS Code JavaScript 调试器运行，并停在文件里标注的断点行。
3. 执行 `LeetCode: AI 调试：分析并显示关键变量`。
4. 也可以执行兼容命令 `leetcodeEnhanced.analyzeAndShow` 或 `leetcodeEnhanced.showKeyVariables`。

预期变量：

- `sum.js`: `nums`, `s`
- `reverse-list.js`: `head`, `newHead`, `current`, `next`
- `inorder-tree.js`: `root`, `stack`, `current`, `result`
- `cpp-basics.cpp`: `nums`, `s`, `freq`, `seen`, `st`, `q`, `window`, `linkedValues`, `ordered`, `heap`, `ans`
- `cpp-linked-list.cpp`: `head`, `newHead`, `current`, `next`

预期展示：

- 数组变量展示为带下标的格子。
- `ListNode` / `head` 类变量展示为链表节点和箭头。
- `TreeNode` / `root` 类变量展示为节点和边。
- C++ `string` 展示为文本；`map` / `unordered_map` 展示为键值表；`set` / `stack` / `queue` / `vector` 展示为序列。
- 调试器不支持展开或 JSON 化的变量会回退为文本。
