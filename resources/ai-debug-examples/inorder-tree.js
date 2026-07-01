// @lc app=leetcode.cn id=ai-debug-inorder-tree lang=javascript
// @lc code=start
function inorderTraversal(root) {
  const stack = [];
  const result = [];
  let current = root;
  while (current || stack.length) {
    while (current) {
      debugger; // AI Debug integration stop.
      stack.push(current); // Set a breakpoint here, then run AI Debug.
      current = current.left;
    }
    current = stack.pop();
    result.push(current.val);
    current = current.right;
  }
  return result;
}
// @lc code=end

const root = { val: 2, left: { val: 1, left: null, right: null }, right: { val: 3, left: null, right: null } };
console.log(inorderTraversal(root));
