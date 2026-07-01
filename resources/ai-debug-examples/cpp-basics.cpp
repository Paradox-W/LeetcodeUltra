#include <deque>
#include <list>
#include <map>
#include <queue>
#include <stack>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

using namespace std;

// @lc app=leetcode.cn id=1001 lang=cpp
// @lc code=start
class Solution {
public:
    vector<int> inspectBasics(vector<int>& nums, string s) {
        unordered_map<int, int> freq;
        unordered_set<char> seen;
        stack<int> st;
        queue<int> q;
        deque<int> window;
        list<int> linkedValues;
        map<int, int> ordered;
        priority_queue<int> heap;
        vector<int> ans;

        for (int value : nums) {
            freq[value]++;
            st.push(value);
            q.push(value);
            window.push_back(value);
            linkedValues.push_back(value);
            ordered[value] = freq[value];
            heap.push(value);
        }
        for (char ch : s) {
            seen.insert(ch);
        }

        // Break here: nums, s, freq, seen, st, q, window, linkedValues, ordered, heap, ans
        if (!nums.empty()) {
            ans.push_back(nums[0]);
        }
        return ans;
    }
};
// @lc code=end

int main() {
    vector<int> nums = {4, 5, 4, 7};
    string s = "leetcode";
    Solution solution;
    solution.inspectBasics(nums, s);
    return 0;
}
