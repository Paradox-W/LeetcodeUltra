function sum(nums) {
  let s = 0;
  for (const value of nums) {
    debugger; // AI Debug integration stop.
    s += value; // Set a breakpoint here, then run AI Debug.
  }
  return s;
}
console.log(sum([1, 2, 3, 4]));
