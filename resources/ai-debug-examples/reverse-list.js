// @lc app=leetcode.cn id=ai-debug-reverse-list lang=javascript
// @lc code=start
function reverseList(head) {
  let newHead = null;
  let current = head;
  while (current) {
    debugger; // AI Debug integration stop.
    const next = current.next; // Set a breakpoint here, then run AI Debug.
    current.next = newHead;
    newHead = current;
    current = next;
  }
  return newHead;
}
// @lc code=end

const head = { val: 1, next: { val: 2, next: null } };
console.log(reverseList(head));
