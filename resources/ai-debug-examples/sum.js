// @lc app=leetcode.cn id=ai-debug-sum lang=javascript
// @lc code=start
function sum(nums) {
  let s = 0;
  for (const value of nums) {
    debugger; // AI Debug integration stop.
    s += value; // Set a breakpoint here, then run AI Debug.
  }
  return s;
}
// @lc code=end

console.log(sum([1, 2, 3, 4]));
