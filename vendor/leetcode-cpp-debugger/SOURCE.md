LeetCode C++ Debugger Source Snapshot
=====================================

This directory contains the minimal C++ harness resources vendored from:

https://github.com/xavier-cai/vscode-leetcode-cpp-debug

VS Code extension version: 0.0.9
License: MIT, preserved in LICENSE.txt

Included for the LeetcodeUltra internal C++ debug workflow:

- resources/code/cpp/*.h
- resources/code/cpp/leetcode-main.cpp
- package metadata and README for provenance

Excluded intentionally:

- VS Code extension activation code and command registration
- node_modules and bundled dependencies
- generated out files not needed at runtime

LeetcodeUltra uses its own TypeScript harness generator in
src/debug/LeetCodeCppHarnessGenerator.ts and only reuses these C++ runtime
resources. It no longer invokes the leetcode-cpp-debugger.debug command or
requires the XavierCai extension to be installed.
