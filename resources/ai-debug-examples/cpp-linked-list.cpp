#include <vector>

using namespace std;

struct ListNode {
    int val;
    ListNode* next;
    ListNode() : val(0), next(nullptr) {}
    explicit ListNode(int x) : val(x), next(nullptr) {}
    ListNode(int x, ListNode* next) : val(x), next(next) {}
};

// @lc app=leetcode.cn id=206 lang=cpp
// @lc code=start
class Solution {
public:
    ListNode* reverseList(ListNode* head) {
        ListNode* newHead = nullptr;
        ListNode* current = head;
        while (current) {
            ListNode* next = current->next;
            current->next = newHead;
            newHead = current;
            current = next;
            // Break here: head, newHead, current, next
        }
        return newHead;
    }
};
// @lc code=end

int main() {
    ListNode third(3);
    ListNode second(2, &third);
    ListNode head(1, &second);
    Solution solution;
    solution.reverseList(&head);
    return 0;
}
