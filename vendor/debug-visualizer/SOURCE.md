Debug Visualizer Source Snapshot
================================

This directory contains a minimal source snapshot from:

https://github.com/hediet/vscode-debug-visualizer

Source commit: 96c26e5388eda9ed81a488f1d95a26a9af166214
License: GPL-3.0, preserved in LICENSE.md

Included for the LeetcodeUltra debug visualization merge:

- data-extraction/src common visualization data types and helpers
- extension/src/VisualizationBackend generic JSON parsing/backend references
- extension/src/webviewContract.ts type contract reference
- demos/cpp/debug_visualizer.hpp C++ helper header

Excluded intentionally:

- .git, .codegraph, node_modules, dist/build output
- standalone VS Code extension activation, webview server runtime, CI config
- docs media and non-C++ demos

LeetcodeUltra does not register Debug Visualizer commands or run the original
standalone webview server. The first merged runtime target is native C++ array
grid visualization inside LeetcodeUltra's existing debug/AI Debug workflow.
