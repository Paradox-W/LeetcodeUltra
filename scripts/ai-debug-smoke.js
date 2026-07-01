const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const vm = require("vm");

const originalLoad = Module._load;

const fakeConfig = {
  "aiDebug.maxVariables": 12,
  "aiDebug.childPageSize": 100,
  "aiDebug.maxListNodes": 50,
  "aiDebug.maxTreeNodes": 80,
  "aiDebug.manualVariables": [],
  "aiDebug.enableAiAnalysis": false,
  "aiDebug.visualTheme": "dense",
  "aiVisualize.api": {
    baseUrl: "https://legacy.example/v1",
    model: "legacy-model",
    apiKey: "legacy-key",
    maxTokens: 321,
  },
};

const fakeSession = {
  id: "js-session",
  async customRequest(command, args) {
    if (command === "threads") {
      return { threads: [{ id: 1, name: "main" }] };
    }
    if (command === "stackTrace") {
      assert.strictEqual(args.threadId, 1);
      return { stackFrames: [{ id: 11, name: "sum" }] };
    }
    if (command === "evaluate") {
      if (args.expression === "JSON.stringify(jsonOnly)") {
        return {
          result: JSON.stringify(JSON.stringify({ a: 1, b: [2, 3] })),
          type: "string",
          variablesReference: 0,
        };
      }
      const table = {
        nums: { result: "Array(3)", type: "number[]", variablesReference: 100, presentationHint: { kind: "data", attributes: ["readOnly"] } },
        s: { result: "6", type: "number", variablesReference: 0 },
        head: { result: "ListNode", type: "ListNode", variablesReference: 200 },
        root: { result: "TreeNode", type: "TreeNode", variablesReference: 300 },
        jsonOnly: { result: "Object", type: "object", variablesReference: 0 },
      };
      if (!table[args.expression]) {
        throw new Error(`Unknown expression ${args.expression}`);
      }
      return table[args.expression];
    }
    if (command === "variables") {
      const refs = {
        100: [
          { name: "0", value: "1", type: "number", variablesReference: 0 },
          { name: "1", value: "2", type: "number", variablesReference: 0 },
          { name: "2", value: "3", type: "number", variablesReference: 0 },
        ],
        200: [
          { name: "val", value: "1", type: "number", variablesReference: 0 },
          { name: "next", value: "ListNode", type: "ListNode", variablesReference: 201 },
        ],
        201: [
          { name: "val", value: "2", type: "number", variablesReference: 0 },
          { name: "next", value: "null", type: "ListNode", variablesReference: 0 },
        ],
        300: [
          { name: "val", value: "2", type: "number", variablesReference: 0 },
          { name: "left", value: "TreeNode", type: "TreeNode", variablesReference: 301 },
          { name: "right", value: "TreeNode", type: "TreeNode", variablesReference: 302 },
        ],
        301: [
          { name: "val", value: "1", type: "number", variablesReference: 0 },
          { name: "left", value: "null", type: "TreeNode", variablesReference: 0 },
          { name: "right", value: "null", type: "TreeNode", variablesReference: 0 },
        ],
        302: [
          { name: "val", value: "3", type: "number", variablesReference: 0 },
          { name: "left", value: "null", type: "TreeNode", variablesReference: 0 },
          { name: "right", value: "null", type: "TreeNode", variablesReference: 0 },
        ],
      };
      return { variables: refs[args.variablesReference] || [] };
    }
    throw new Error(`Unexpected DAP command ${command}`);
  },
};

const fakeCppSession = {
  id: "cpp-session",
  async customRequest(command, args) {
    if (command === "threads") {
      return { threads: [{ id: 1, name: "main" }] };
    }
    if (command === "stackTrace") {
      assert.strictEqual(args.threadId, 1);
      return { stackFrames: [{ id: 21, name: "Solution::solve" }] };
    }
    if (command === "evaluate") {
      const table = {
        nums: { result: "std::vector of length 3", type: "std::vector<int>", variablesReference: 500 },
        word: { result: "\"leetcode\"", type: "std::string", variablesReference: 0 },
        freq: { result: "std::unordered_map with 2 elements", type: "std::unordered_map<int, int>", variablesReference: 600 },
        seen: { result: "std::unordered_set with 2 elements", type: "std::unordered_set<int>", variablesReference: 610 },
        st: { result: "{3, 2, 1}", type: "std::stack<int>", variablesReference: 0 },
        q: { result: "{1, 2, 3}", type: "std::queue<int>", variablesReference: 0 },
        window: { result: "std::deque of length 3", type: "std::deque<int>", variablesReference: 620 },
        linkedValues: { result: "{8, 9, 10}", type: "std::list<int>", variablesReference: 0 },
        ordered: { result: "std::map with 2 elements", type: "std::map<int, int>", variablesReference: 630 },
        heap: { result: "{9, 5, 1}", type: "std::priority_queue<int>", variablesReference: 0 },
        head: { result: "0x1000", type: "ListNode *", variablesReference: 700 },
        "*(head)": { result: "{val = 1, next = 0x1001}", type: "ListNode", variablesReference: 700 },
        "(head)->val": { result: "1", type: "int", variablesReference: 0 },
        "(head)->next": { result: "0x1001", type: "ListNode *", variablesReference: 701 },
        "((head)->next)->val": { result: "2", type: "int", variablesReference: 0 },
        "((head)->next)->next": { result: "nullptr", type: "ListNode *", variablesReference: 0 },
      };
      if (!table[args.expression]) {
        throw new Error(`Unknown C++ expression ${args.expression}`);
      }
      return table[args.expression];
    }
    if (command === "variables") {
      const refs = {
        500: [
          { name: "[0]", value: "4", type: "int", variablesReference: 0 },
          { name: "[1]", value: "5", type: "int", variablesReference: 0 },
          { name: "[2]", value: "6", type: "int", variablesReference: 0 },
        ],
        600: [
          { name: "[0]", value: "{first = 1, second = 2}", type: "std::pair<const int, int>", variablesReference: 0 },
          { name: "[1]", value: "", type: "std::pair<const int, int>", variablesReference: 601 },
        ],
        601: [
          { name: "first", value: "3", type: "int", variablesReference: 0 },
          { name: "second", value: "4", type: "int", variablesReference: 0 },
        ],
        610: [
          { name: "[0]", value: "7", type: "int", variablesReference: 0 },
          { name: "[1]", value: "9", type: "int", variablesReference: 0 },
        ],
        620: [
          { name: "[0]", value: "11", type: "int", variablesReference: 0 },
          { name: "[1]", value: "12", type: "int", variablesReference: 0 },
          { name: "[2]", value: "13", type: "int", variablesReference: 0 },
        ],
        630: [
          { name: "[0]", value: "{first = 2, second = 20}", type: "std::pair<const int, int>", variablesReference: 0 },
          { name: "[1]", value: "{first = 4, second = 40}", type: "std::pair<const int, int>", variablesReference: 0 },
        ],
        700: [
          { name: "val", value: "1", type: "int", variablesReference: 0 },
          { name: "next", value: "0x1001", type: "ListNode *", variablesReference: 701 },
        ],
        701: [
          { name: "val", value: "2", type: "int", variablesReference: 0 },
          { name: "next", value: "nullptr", type: "ListNode *", variablesReference: 0 },
        ],
      };
      return { variables: refs[args.variablesReference] || [] };
    }
    throw new Error(`Unexpected C++ DAP command ${command}`);
  },
};

const fakeRunningSession = {
  id: "running-session",
  async customRequest(command, args) {
    if (command === "threads") {
      return { threads: [{ id: 1, name: "main" }] };
    }
    if (command === "stackTrace") {
      throw new Error(`Program is running: ${args.threadId}`);
    }
    throw new Error(`Unexpected running-session DAP command ${command}`);
  },
};

const registeredCommands = new Map();
const inputBoxResponses = [];
const quickPickResponses = [];
const infoMessages = [];
const webviewMessages = [];
const createdWebviewPanels = [];
const debugStartListeners = [];
const debugCustomEventListeners = [];
const debugTerminateListeners = [];
let activeDocument;

class FakeDisposable {
  constructor(callback) {
    this.callback = callback;
  }
  dispose() {
    if (this.callback) {
      this.callback();
    }
  }
  static from(...items) {
    return {
      dispose() {
        items.forEach((item) => item && item.dispose && item.dispose());
      },
    };
  }
}

const fakeVscode = {
  workspace: {
    getConfiguration() {
      return {
        get(key, fallback) {
          return Object.prototype.hasOwnProperty.call(fakeConfig, key) ? fakeConfig[key] : fallback;
        },
        inspect(key) {
          if (!Object.prototype.hasOwnProperty.call(fakeConfig, key)) {
            return undefined;
          }
          return { globalValue: fakeConfig[key] };
        },
        async update(key, value) {
          fakeConfig[key] = value;
        },
      };
    },
    onDidChangeTextDocument() {
      return { dispose() {} };
    },
  },
  debug: {
    activeDebugSession: fakeSession,
    onDidStartDebugSession(callback) {
      debugStartListeners.push(callback);
      return { dispose() {} };
    },
    onDidReceiveDebugSessionCustomEvent(callback) {
      debugCustomEventListeners.push(callback);
      return { dispose() {} };
    },
    onDidChangeActiveDebugSession() {
      return { dispose() {} };
    },
    onDidTerminateDebugSession(callback) {
      debugTerminateListeners.push(callback);
      return { dispose() {} };
    },
  },
  commands: {
    registerCommand(name, callback) {
      registeredCommands.set(name, callback);
      return { dispose() {} };
    },
    async executeCommand(name, ...args) {
      const command = registeredCommands.get(name);
      assert(command, `command ${name} should be registered`);
      return await command(...args);
    },
  },
  window: {
    activeTextEditor: undefined,
    visibleTextEditors: [],
    async withProgress(_options, task) {
      return await task();
    },
    async showInputBox(options) {
      const value = inputBoxResponses.shift();
      if (options && options.validateInput && value !== undefined) {
        const validation = options.validateInput(value);
        assert.strictEqual(validation, undefined, `unexpected validation error for ${value}: ${validation}`);
      }
      return value;
    },
    async showQuickPick(items) {
      const value = quickPickResponses.shift();
      if (value === undefined) {
        return undefined;
      }
      if (typeof value === "number") {
        return items[value];
      }
      return items.find((item) => item.value === value || item.label === value);
    },
    showInformationMessage(message) {
      infoMessages.push(message);
    },
    createWebviewPanel() {
      const panel = {
        visible: true,
        webview: {
          html: "",
          async postMessage(message) {
            webviewMessages.push(message);
            return true;
          },
          onDidReceiveMessage() {
            return { dispose() {} };
          },
        },
        reveal() {
          this.visible = true;
        },
        onDidDispose() {
          return { dispose() {} };
        },
      };
      createdWebviewPanels.push(panel);
      return panel;
    },
  },
  ProgressLocation: {
    Window: 10,
  },
  ViewColumn: {
    Beside: 2,
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
  },
  Disposable: FakeDisposable,
  Uri: {
    parse(value) {
      return { toString: () => value };
    },
  },
};

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "vscode") {
    return fakeVscode;
  }
  return originalLoad.call(this, request, parent, isMain);
};

function runWebviewRenderer(html) {
  const scriptMatch = String(html || "").match(/<script>([\s\S]*?)<\/script>/i);
  assert(scriptMatch, "webview html should include an inline renderer script");
  const app = { innerHTML: "" };
  const listeners = {};
  const postedMessages = [];
  const context = {
    acquireVsCodeApi() {
      return {
        postMessage(message) {
          postedMessages.push(message);
        },
      };
    },
    document: {
      getElementById(id) {
        assert.strictEqual(id, "app");
        return app;
      },
      addEventListener(name, listener) {
        listeners[`document:${name}`] = listener;
      },
    },
    window: {
      addEventListener(name, listener) {
        listeners[`window:${name}`] = listener;
      },
    },
    console,
  };
  vm.runInNewContext(scriptMatch[1], context, { timeout: 1000 });
  return { app, listeners, postedMessages };
}

function findCppCompiler() {
  for (const candidate of ["clang++", "g++"]) {
    const result = childProcess.spawnSync(candidate, ["--version"], {
      encoding: "utf8",
    });
    if (result.status === 0) {
      return candidate;
    }
  }
  return undefined;
}

function compileCppExamples() {
  const compiler = findCppCompiler();
  if (!compiler) {
    console.warn("Skipping C++ example compilation: no clang++ or g++ found");
    return;
  }

  const examples = ["cpp-basics.cpp", "cpp-linked-list.cpp"];
  for (const example of examples) {
    const sourcePath = path.join(__dirname, "..", "resources", "ai-debug-examples", example);
    const outputPath = path.join(
      "/tmp",
      `lcpr-ai-debug-${path.basename(example, ".cpp")}-${process.pid}.o`,
    );
    const result = childProcess.spawnSync(
      compiler,
      ["-std=c++17", "-Wall", "-Wextra", "-pedantic", "-c", sourcePath, "-o", outputPath],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(
        [
          `C++ example ${example} failed to compile with ${compiler}`,
          result.stdout,
          result.stderr,
        ].filter(Boolean).join("\n"),
      );
    }
    try {
      fs.unlinkSync(outputPath);
    } catch (_error) {
      // Best-effort cleanup only; the object file lives in /tmp.
    }
  }
}

async function main() {
  compileCppExamples();

  const { AiVariableAnalyzer } = require("../out/src/aiDebug/AiVariableAnalyzer");
  const { AiClient } = require("../out/src/ai/AiClient");
  const { DapVariableCollector } = require("../out/src/aiDebug/DapVariableCollector");

  const code = [
    "// @lc app=leetcode.cn id=999 lang=javascript",
    "// @lc code=start",
    "function sum(nums) {",
    "  let s = 0;",
    "  for (let i of nums) s += i;",
    "  return s;",
    "}",
    "function reverse(head) {",
    "  let newHead = null;",
    "  return head;",
    "}",
    "function walk(root) {",
    "  const stack = [];",
    "  return root;",
    "}",
    "// @lc code=end",
  ].join("\n");

  const workspaceStateStore = new Map();
  const context = {
    workspaceState: {
      get(key) {
        return workspaceStateStore.get(key);
      },
      async update(key, value) {
        if (value === undefined) {
          workspaceStateStore.delete(key);
        } else {
          workspaceStateStore.set(key, value);
        }
      },
    },
  };
  const document = {
    uri: { toString: () => "file:///tmp/999.js", scheme: "file" },
    languageId: "javascript",
    fileName: "/tmp/999.js",
    getText: () => code,
  };
  activeDocument = document;
  fakeVscode.window.activeTextEditor = { document: activeDocument };
  fakeVscode.window.visibleTextEditors = [{ document: activeDocument }];

  const analyzer = new AiVariableAnalyzer(context, {});
  const analysis = await analyzer.analyze(document);
  const names = analysis.variables.map((variable) => variable.name);
  assert(names.includes("nums"), "static analysis should include nums");
  assert(names.includes("s"), "static analysis should include s");
  assert(names.includes("head"), "static analysis should include head");
  assert(names.includes("newHead"), "AST analysis should include newHead");
  assert(names.includes("root"), "static analysis should include root");
  assert(names.includes("stack"), "AST analysis should include stack");

  fakeConfig["aiDebug.enableAiAnalysis"] = true;
  let aiRequestCount = 0;
  const aiDocument = {
    uri: { toString: () => "file:///tmp/ai.cpp", scheme: "file" },
    languageId: "cpp",
    fileName: "/tmp/ai.cpp",
    getText: () => [
      "// @lc app=leetcode.cn id=2 lang=cpp",
      "// @lc code=start",
      "class Solution { public: ListNode* solve(ListNode* head, vector<int>& nums) { return head; } };",
      "// @lc code=end",
    ].join("\n"),
  };
  const aiAnalyzer = new AiVariableAnalyzer(context, {
    async requestJson(messages, options) {
      aiRequestCount++;
      assert.strictEqual(options.jsonMode, true, "AI analyzer should request JSON mode");
      assert(messages.some((message) => /只返回 JSON/.test(message.content)), "AI prompt should request strict JSON");
      return {
        variables: [
          { name: "headNext", expression: "head->next", type: "ListNode*", reason: "AI pointer candidate" },
          { name: "firstNum", expression: "nums[0]", type: "int", reason: "AI indexed candidate" },
        ],
      };
    },
  });
  const aiAnalysis = await aiAnalyzer.analyze(aiDocument);
  assert.strictEqual(aiAnalysis.source, "mixed", "AI variables should be marked as mixed when static candidates also exist");
  assert.deepStrictEqual(aiAnalysis.variables.map((variable) => variable.expression), ["head->next", "nums[0]"]);
  assert.strictEqual(aiRequestCount, 1, "AI analyzer should call the model once");
  const cachedAiAnalysis = await aiAnalyzer.analyze(aiDocument);
  assert.strictEqual(cachedAiAnalysis.source, "cache", "AI analysis should be cached by document hash");
  assert.strictEqual(aiRequestCount, 1, "cached AI analysis should not call the model again");
  aiAnalyzer.invalidate(aiDocument);
  const refreshedAiAnalysis = await aiAnalyzer.analyze(aiDocument);
  assert.strictEqual(refreshedAiAnalysis.source, "mixed", "invalidated AI analysis should rerun");
  assert.strictEqual(aiRequestCount, 2, "invalidating the document should force another AI request");

  const failingAiAnalyzer = new AiVariableAnalyzer(context, {
    async requestJson() {
      throw new Error("model offline");
    },
  });
  const failingDocument = Object.assign({}, aiDocument, {
    uri: { toString: () => "file:///tmp/ai-fallback.cpp", scheme: "file" },
  });
  const fallbackAnalysis = await failingAiAnalyzer.analyze(failingDocument);
  assert.strictEqual(fallbackAnalysis.source, "static", "AI failure should fall back to static analysis");
  assert(fallbackAnalysis.variables.some((variable) => variable.name === "head"), "static fallback should still include C++ parameters");
  assert(fallbackAnalysis.warnings.some((warning) => /AI 分析失败/.test(warning)), "AI failure should produce a user-facing warning");
  fakeConfig["aiDebug.enableAiAnalysis"] = false;

  const aiClient = new AiClient({
    secrets: {
      get: async () => "",
      store: async () => undefined,
    },
  });
  const apiConfig = await aiClient.getApiConfig();
  assert.strictEqual(apiConfig.baseUrl, "https://legacy.example/v1", "AI client should reuse legacy visualizer baseUrl when aiDebug.api is not explicitly configured");
  assert.strictEqual(apiConfig.model, "legacy-model", "AI client should reuse legacy visualizer model when aiDebug.api is not explicitly configured");
  assert.strictEqual(apiConfig.apiKey, "legacy-key", "AI client should reuse legacy visualizer API key");

  const collector = new DapVariableCollector();
  const collected = await collector.collect([
    { name: "nums", expression: "nums", type: "number[]" },
    { name: "s", expression: "s", type: "number" },
    { name: "head", expression: "head", type: "ListNode" },
    { name: "root", expression: "root", type: "TreeNode" },
    { name: "jsonOnly", expression: "jsonOnly", type: "object" },
  ], { language: "javascript" });
  assert.deepStrictEqual(collected.warnings, []);

  const byName = new Map(collected.variables.map((variable) => [variable.name, variable]));
  assert.strictEqual(byName.get("nums").visual.kind.array, true);
  assert.deepStrictEqual(byName.get("nums").visual.values.map((item) => item.value), ["1", "2", "3"]);
  assert.strictEqual(byName.get("nums").presentationHint.kind, "data");
  assert.strictEqual(byName.get("s").visual.kind.text, true);
  assert.strictEqual(byName.get("head").visual.kind.list, true);
  assert.deepStrictEqual(byName.get("head").visual.nodes.map((node) => node.value), ["1", "2"]);
  assert.strictEqual(byName.get("root").visual.kind.graph, true);
  assert.strictEqual(byName.get("root").visual.nodes.length, 3);
  assert.strictEqual(byName.get("root").visual.edges.length, 2);
  assert.strictEqual(byName.get("jsonOnly").visual.kind.object, true);
  assert.deepStrictEqual(byName.get("jsonOnly").visual.values.map((item) => item.name), ["a", "b"]);

  const cppCode = [
    "// @lc app=leetcode.cn id=1 lang=cpp",
    "// @lc code=start",
    "class Solution {",
    "public:",
    "  vector<int> twoSum(vector<int>& nums, int target) {",
    "    unordered_map<int, int> freq;",
    "    unordered_set<int> seen;",
    "    string word = \"leetcode\";",
    "    stack<int> st;",
    "    queue<int> q;",
    "    deque<int> window;",
    "    list<int> linkedValues;",
    "    map<int, int> ordered;",
    "    priority_queue<int> heap;",
    "    ListNode* head = nullptr;",
    "    return nums;",
    "  }",
    "};",
    "// @lc code=end",
  ].join("\n");
  const cppDocument = {
    uri: { toString: () => "file:///tmp/1.cpp", scheme: "file" },
    languageId: "cpp",
    fileName: "/tmp/1.cpp",
    getText: () => cppCode,
  };
  const cppAnalysis = await analyzer.analyze(cppDocument);
  const cppNames = cppAnalysis.variables.map((variable) => variable.name);
  assert(cppNames.includes("nums"), "C++ static analysis should include vector parameter");
  assert(cppNames.includes("freq"), "C++ static analysis should include unordered_map");
  assert(cppNames.includes("seen"), "C++ static analysis should include unordered_set");
  assert(cppNames.includes("word"), "C++ static analysis should include string");
  assert(cppNames.includes("st"), "C++ static analysis should include stack");
  assert(cppNames.includes("q"), "C++ static analysis should include queue");
  assert(cppNames.includes("window"), "C++ static analysis should include deque");
  assert(cppNames.includes("linkedValues"), "C++ static analysis should include list");
  assert(cppNames.includes("ordered"), "C++ static analysis should include map");
  assert(cppNames.includes("heap"), "C++ static analysis should include priority_queue");
  assert(cppNames.includes("head"), "C++ static analysis should include ListNode pointer");

  const cppFixtures = [
    {
      name: "two-sum",
      code: "class Solution { public: vector<int> twoSum(vector<int>& nums, int target) { unordered_map<int, int> pos; vector<int> ans; return ans; } };",
      expected: ["nums", "target", "pos", "ans"],
    },
    {
      name: "longest-substring",
      code: "class Solution { public: int lengthOfLongestSubstring(string s) { unordered_set<char> seen; int left = 0; int ans = 0; return ans; } };",
      expected: ["s", "seen", "left", "ans"],
    },
    {
      name: "valid-parentheses",
      code: "class Solution { public: bool isValid(string s) { stack<char> st; for (char c : s) {} return st.empty(); } };",
      expected: ["s", "st"],
    },
    {
      name: "reverse-list",
      code: "class Solution { public: ListNode* reverseList(ListNode* head) { ListNode* prev = nullptr; ListNode* cur = head; return prev; } };",
      expected: ["head", "prev", "cur"],
    },
    {
      name: "top-k",
      code: "class Solution { public: vector<int> topKFrequent(vector<int>& nums, int k) { unordered_map<int, int> freq; priority_queue<pair<int, int>> heap; vector<int> res; return res; } };",
      expected: ["nums", "freq", "heap", "res"],
    },
    {
      name: "window-queue",
      code: "class Solution { public: vector<int> maxSlidingWindow(vector<int>& nums, int k) { deque<int> window; queue<int> pending; vector<int> ans; return ans; } };",
      expected: ["nums", "window", "pending", "ans"],
    },
    {
      name: "ordered-containers",
      code: "class Solution { public: int containsNearbyAlmostDuplicate(vector<int>& nums) { map<int, int> ordered; set<int> seen; list<int> recent; return ordered.size() + seen.size() + recent.size(); } };",
      expected: ["nums", "ordered", "seen", "recent"],
    },
    {
      name: "numeric-state",
      code: "class Solution { public: long long countPairs(vector<int>& nums) { long long total = 0; size_t n = nums.size(); pair<int, int> best; unsigned long long mask = 0; return total + n + mask + best.first; } };",
      expected: ["nums", "total", "n", "best", "mask"],
      forbidden: ["long"],
    },
  ];
  for (const fixture of cppFixtures) {
    const fixtureDocument = {
      uri: { toString: () => `file:///tmp/${fixture.name}.cpp`, scheme: "file" },
      languageId: "cpp",
      fileName: `/tmp/${fixture.name}.cpp`,
      getText: () => `// @lc app=leetcode.cn id=${fixture.name} lang=cpp\n// @lc code=start\n${fixture.code}\n// @lc code=end`,
    };
    const fixtureNames = (await analyzer.analyze(fixtureDocument)).variables.map((variable) => variable.name);
    fixture.expected.forEach((name) => assert(fixtureNames.includes(name), `C++ fixture ${fixture.name} should include ${name}`));
    (fixture.forbidden || []).forEach((name) => assert(!fixtureNames.includes(name), `C++ fixture ${fixture.name} should not mis-detect ${name} as a variable`));
  }

  const cppExampleFixtures = [
    {
      fileName: "cpp-basics.cpp",
      expected: ["nums", "s", "freq", "seen", "st", "q", "window", "linkedValues", "ordered", "heap", "ans"],
    },
    {
      fileName: "cpp-linked-list.cpp",
      expected: ["head", "newHead", "current", "next"],
    },
  ];
  for (const fixture of cppExampleFixtures) {
    const filePath = path.join(__dirname, "..", "resources", "ai-debug-examples", fixture.fileName);
    const fixtureDocument = {
      uri: { toString: () => `file://${filePath}`, scheme: "file" },
      languageId: "cpp",
      fileName: filePath,
      getText: () => fs.readFileSync(filePath, "utf8"),
    };
    const fixtureNames = (await analyzer.analyze(fixtureDocument)).variables.map((variable) => variable.name);
    fixture.expected.forEach((name) => assert(fixtureNames.includes(name), `C++ example ${fixture.fileName} should include ${name}`));
  }

  fakeConfig["aiDebug.manualVariables"] = ["head->next", "nums[0]", "(*node).val"];
  const cppManualDocument = {
    uri: { toString: () => "file:///tmp/manual.cpp", scheme: "file" },
    languageId: "cpp",
    fileName: "/tmp/manual.cpp",
    getText: () => "// @lc app=leetcode.cn id=manual lang=cpp\n// @lc code=start\nclass Solution { public: int test(ListNode* head, vector<int>& nums) { ListNode* node = head; return nums[0]; } };\n// @lc code=end",
  };
  const cppManualNames = (await analyzer.analyze(cppManualDocument)).variables.map((variable) => variable.expression);
  assert(cppManualNames.includes("head->next"), "C++ manual variables should allow pointer member access");
  assert(cppManualNames.includes("nums[0]"), "C++ manual variables should allow indexed access");
  assert(cppManualNames.includes("(*node).val"), "C++ manual variables should allow simple dereference member access");
  fakeConfig["aiDebug.manualVariables"] = [];

  fakeVscode.debug.activeDebugSession = fakeCppSession;
  const cppCollected = await collector.collect([
    { name: "nums", expression: "nums", type: "vector<int>" },
    { name: "word", expression: "word", type: "string" },
    { name: "freq", expression: "freq", type: "unordered_map<int,int>" },
    { name: "seen", expression: "seen", type: "unordered_set<int>" },
    { name: "st", expression: "st", type: "stack<int>" },
    { name: "q", expression: "q", type: "queue<int>" },
    { name: "window", expression: "window", type: "deque<int>" },
    { name: "linkedValues", expression: "linkedValues", type: "list<int>" },
    { name: "ordered", expression: "ordered", type: "map<int,int>" },
    { name: "heap", expression: "heap", type: "priority_queue<int>" },
    { name: "head", expression: "head", type: "ListNode*" },
  ], { language: "cpp" });
  assert.deepStrictEqual(cppCollected.warnings, []);
  const cppByName = new Map(cppCollected.variables.map((variable) => [variable.name, variable]));
  assert.strictEqual(cppByName.get("nums").visual.kind.array, true);
  assert.deepStrictEqual(cppByName.get("nums").visual.values.map((item) => item.value), ["4", "5", "6"]);
  assert.strictEqual(cppByName.get("word").visual.kind.text, true);
  assert.strictEqual(cppByName.get("word").visual.text, "leetcode");
  assert.strictEqual(cppByName.get("freq").visual.kind.object, true);
  assert.deepStrictEqual(cppByName.get("freq").visual.values.map((item) => `${item.name}:${item.value}`), ["1:2", "3:4"]);
  assert.strictEqual(cppByName.get("seen").visual.kind.array, true);
  assert.deepStrictEqual(cppByName.get("seen").visual.values.map((item) => item.value), ["7", "9"]);
  assert.strictEqual(cppByName.get("st").visual.kind.array, true);
  assert.deepStrictEqual(cppByName.get("st").visual.values.map((item) => item.value), ["3", "2", "1"]);
  assert.strictEqual(cppByName.get("q").visual.kind.array, true);
  assert.deepStrictEqual(cppByName.get("q").visual.values.map((item) => item.value), ["1", "2", "3"]);
  assert.strictEqual(cppByName.get("window").visual.kind.array, true);
  assert.deepStrictEqual(cppByName.get("window").visual.values.map((item) => item.value), ["11", "12", "13"]);
  assert.strictEqual(cppByName.get("linkedValues").visual.kind.array, true);
  assert.deepStrictEqual(cppByName.get("linkedValues").visual.values.map((item) => item.value), ["8", "9", "10"]);
  assert.strictEqual(cppByName.get("ordered").visual.kind.object, true);
  assert.deepStrictEqual(cppByName.get("ordered").visual.values.map((item) => `${item.name}:${item.value}`), ["2:20", "4:40"]);
  assert.strictEqual(cppByName.get("heap").visual.kind.array, true);
  assert.deepStrictEqual(cppByName.get("heap").visual.values.map((item) => item.value), ["9", "5", "1"]);
  assert.strictEqual(cppByName.get("head").visual.kind.list, true);
  assert.deepStrictEqual(cppByName.get("head").visual.nodes.map((node) => node.value), ["1", "2"]);
  fakeVscode.debug.activeDebugSession = fakeSession;

  const { registerAiDebug } = require("../out/src/aiDebug/AiDebugModule");
  let storedSecret = "";
  workspaceStateStore.clear();
  const disposable = registerAiDebug({
    subscriptions: [],
    workspaceState: context.workspaceState,
    secrets: {
      get: async () => "",
      store: async (_key, value) => {
        storedSecret = value;
      },
    },
  });
  const commandModel = await fakeVscode.commands.executeCommand("lcpr.aiDebug.collect");
  assert(commandModel.variables.length > 0, "collect command should return variables");
  assert.strictEqual(commandModel.canRefresh, true, "collect command should allow refresh when the debugger is paused");
  assert.strictEqual(commandModel.analysis.source, "static", "first collect should analyze the active document");
  const cachedCommandModel = await fakeVscode.commands.executeCommand("lcpr.aiDebug.collect");
  assert.strictEqual(cachedCommandModel.analysis.source, "cache", "second collect should reuse cached analysis");
  assert(debugStartListeners.length > 0, "AI debug should listen for debug session starts");
  debugStartListeners.forEach((listener) => listener(fakeSession));
  const afterStartModel = await fakeVscode.commands.executeCommand("lcpr.aiDebug.collect");
  assert.strictEqual(afterStartModel.analysis.source, "static", "debug start should invalidate active document analysis cache");
  debugTerminateListeners.forEach((listener) => listener(fakeSession));
  const commandNames = commandModel.variables.map((variable) => variable.name);
  assert(commandNames.includes("nums"), "collect command should include nums");
  assert(commandNames.includes("head"), "collect command should include head");
  const aliasModel = await fakeVscode.commands.executeCommand("leetcodeEnhanced.analyzeAndShow");
  assert(aliasModel.variables.length > 0, "leetcodeEnhanced alias command should return variables");
  assert(createdWebviewPanels[0].webview.html.includes("hint-data"), "webview should style DAP data presentation hints");
  assert(createdWebviewPanels[0].webview.html.includes("hint-readonly"), "webview should style DAP readOnly presentation hints");
  assert(createdWebviewPanels[0].webview.html.includes("<b>RO</b>"), "webview should render a compact readOnly hint mark");
  const renderer = runWebviewRenderer(createdWebviewPanels[0].webview.html);
  assert(renderer.app.innerHTML.includes('class="array"'), "webview renderer should render array visuals from the initial model");
  assert(renderer.app.innerHTML.includes('class="list"'), "webview renderer should render list visuals from the initial model");
  assert(renderer.app.innerHTML.includes('class="graph"'), "webview renderer should render graph visuals from the initial model");
  assert(renderer.listeners["document:click"], "webview renderer should listen for refresh button clicks");
  renderer.listeners["document:click"]({
    target: {
      closest(selector) {
        assert.strictEqual(selector, "[data-command]");
        return {
          getAttribute(name) {
            assert.strictEqual(name, "data-command");
            return "refresh";
          },
        };
      },
    },
  });
  const refreshMessage = renderer.postedMessages.pop();
  assert.strictEqual(refreshMessage && refreshMessage.command, "refresh", "webview refresh button should post a refresh command");
  assert(renderer.listeners["window:message"], "webview renderer should listen for extension render messages");
  renderer.listeners["window:message"]({
    data: {
      command: "render",
      model: {
        title: "Renderer smoke",
        status: "已捕获调试变量",
        variables: [
          { name: "arr", expression: "arr", value: "[1,2]", visual: { kind: { array: true }, values: [{ name: "0", value: "1" }, { name: "1", value: "2" }] } },
          { name: "list", expression: "head", value: "ListNode", visual: { kind: { list: true }, nodes: [{ id: "n0", label: "0", value: "1" }, { id: "n1", label: "1", value: "2" }] } },
          { name: "tree", expression: "root", value: "TreeNode", visual: { kind: { graph: true }, nodes: [{ id: "root", label: "root", value: "2" }, { id: "left", label: "left", value: "1" }], edges: [{ from: "root", to: "left", label: "left" }] } },
          { name: "obj", expression: "freq", value: "Object", visual: { kind: { object: true }, values: [{ name: "x", value: "3" }] } },
          { name: "text", expression: "s", value: "abc", visual: { kind: { text: true }, text: "abc" } },
        ],
        warnings: [],
        updatedAt: Date.now(),
        canRefresh: true,
      },
    },
  });
  assert(renderer.app.innerHTML.includes('class="object"'), "webview renderer should render object visuals from posted models");
  assert(renderer.app.innerHTML.includes("<pre>abc</pre>"), "webview renderer should render text visuals from posted models");
  await fakeVscode.commands.executeCommand("lcpr.aiDebug.refresh");
  assert(webviewMessages.some((message) => message && message.command === "render" && message.model && message.model.variables.length > 0), "refresh should send render JSON to the webview");
  webviewMessages.length = 0;
  assert(debugCustomEventListeners.length > 0, "AI debug should listen for debug custom events");
  await Promise.all(debugCustomEventListeners.map((listener) => listener({ event: "stopped", session: fakeSession, body: { reason: "breakpoint" } })));
  assert(webviewMessages.some((message) => message && message.command === "render" && message.model && message.model.variables.length > 0), "stopped debug event should auto-refresh the visible webview");
  createdWebviewPanels[0].visible = false;
  webviewMessages.length = 0;
  await Promise.all(debugCustomEventListeners.map((listener) => listener({ event: "stopped", session: fakeSession, body: { reason: "step" } })));
  assert.strictEqual(webviewMessages.length, 0, "stopped debug event should not auto-refresh a hidden webview");
  createdWebviewPanels[0].visible = true;
  fakeVscode.debug.activeDebugSession = undefined;
  const noSessionModel = await fakeVscode.commands.executeCommand("lcpr.aiDebug.collect");
  assert.strictEqual(noSessionModel.canRefresh, false, "collect command should disable refresh without an active paused debugger");
  assert.strictEqual(noSessionModel.status, "等待调试暂停");
  assert.strictEqual(noSessionModel.variables.length, 0, "collect command should not render variable error cards without an active debugger");
  assert(noSessionModel.warnings.some((warning) => /未找到活动调试会话/.test(warning)), "missing debugger should produce a friendly warning");
  fakeVscode.debug.activeDebugSession = fakeRunningSession;
  const runningModel = await fakeVscode.commands.executeCommand("lcpr.aiDebug.collect");
  assert.strictEqual(runningModel.canRefresh, false, "collect command should disable refresh while the debugger is running");
  assert.strictEqual(runningModel.variables.length, 0, "collect command should wait for a paused frame before collecting variables");
  assert(runningModel.warnings.some((warning) => /调试会话正在运行/.test(warning)), "running debugger should produce a friendly pause warning");
  fakeVscode.debug.activeDebugSession = fakeSession;

  await fakeVscode.commands.executeCommand("lcpr.aiDebug.toggleAiAnalysis");
  assert.strictEqual(fakeConfig["aiDebug.enableAiAnalysis"], true, "toggle should enable AI analysis");
  await fakeVscode.commands.executeCommand("lcpr.aiDebug.toggleAiAnalysis");
  assert.strictEqual(fakeConfig["aiDebug.enableAiAnalysis"], false, "toggle should disable AI analysis");

  inputBoxResponses.push("nums, head, root.left");
  await fakeVscode.commands.executeCommand("lcpr.aiDebug.setManualVariables");
  assert.deepStrictEqual(fakeConfig["aiDebug.manualVariables"], ["nums", "head", "root.left"]);

  inputBoxResponses.push("5");
  await fakeVscode.commands.executeCommand("lcpr.aiDebug.setMaxVariables");
  assert.strictEqual(fakeConfig["aiDebug.maxVariables"], 5);

  quickPickResponses.push("contrast");
  await fakeVscode.commands.executeCommand("lcpr.aiDebug.setVisualTheme");
  assert.strictEqual(fakeConfig["aiDebug.visualTheme"], "contrast");

  inputBoxResponses.push("test-secret");
  await fakeVscode.commands.executeCommand("lcpr.aiDebug.setApiKey");
  assert.strictEqual(storedSecret, "test-secret");
  assert(infoMessages.some((message) => /API Key/.test(message)), "set API key should show a confirmation");

  disposable.dispose();

  console.log("AI debug smoke passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
