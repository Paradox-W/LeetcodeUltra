LeetCodeUltra-v1.0.0-develop-beta

This extension is derived from ccagml/leetcode-extension, originally published
as vscode-leetcode-problem-rating by ccagml under the MIT License.

Original project:
https://github.com/ccagml/leetcode-extension

LeetcodeUltra itself is distributed under the GNU General Public License,
version 3 only (GPL-3.0-only). Upstream attribution and the original MIT
license notice from ccagml/leetcode-extension are preserved for the upstream
material incorporated into this repository. LeetcodeUltra is published under a
separate extension identity to avoid confusion with the upstream project.

Debug Visualizer source snapshot
--------------------------------

This working branch also contains a minimal source snapshot and derived runtime
work from Debug Visualizer:

https://github.com/hediet/vscode-debug-visualizer

Snapshot commit: 96c26e5388eda9ed81a488f1d95a26a9af166214
License: GPL-3.0, preserved at vendor/debug-visualizer/LICENSE.md.

The snapshot is limited to source references needed for native C++ array grid
visualization in LeetcodeUltra. It excludes Debug Visualizer's standalone VS
Code extension runtime, webview server, bundled dependencies, build artifacts,
and media assets. Because this repository contains GPL-3.0-covered Debug
Visualizer source and derived portions, redistributed combined artifacts such
as a VSIX must comply with GPL-3.0 obligations.

LeetCode C++ Debugger source snapshot
-------------------------------------

This working branch also contains a minimal MIT-licensed source/resource
snapshot from LeetCode C++ Debugger:

https://github.com/xavier-cai/vscode-leetcode-cpp-debug

Version: 0.0.9
License: MIT, preserved at vendor/leetcode-cpp-debugger/LICENSE.txt.

The snapshot is limited to the C++ harness resources needed by LeetcodeUltra's
internal C++ debug workflow. LeetcodeUltra no longer invokes the
leetcode-cpp-debugger.debug VS Code command or requires that extension to be
installed.
