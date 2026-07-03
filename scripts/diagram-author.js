#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const root = path.resolve(__dirname, "..");
const CONFIG_KEY = "leetcode-problem-rating.diagramAuthor.api";
const DEFAULT_DIAGRAM_API = {
  provider: "coze",
  baseUrl: "https://api.coze.cn/v1",
  token: "",
  tokenEnv: "COZE_API_TOKEN",
  workflowId: "",
  botId: "",
  appId: "",
  uploadPath: "/files/upload",
  workflowRunPath: "/workflow/run",
  imageValueType: "file_id_json",
  outputKey: "diagram",
  timeoutMs: 120000,
  headers: {},
  parameterKeys: {
    image: "image",
  },
  workflowModelHints: {
    visionNode: "在扣子工作流内选择支持图片输入和结构化输出的多模态模型",
    compilerNode: "在扣子工作流内选择稳定遵循 JSON Schema 的文本模型",
  },
};

const args = parseArgs(process.argv.slice(2));
const config = loadDiagramApiConfig(args);

if (pickArg(args, "help", "h")) {
  printUsage();
  process.exit(0);
}
if (!pickArg(args, "qid") || !pickArg(args, "image")) {
  printUsage();
  process.exit(1);
}

const token = pickArg(args, "token") || config.token || (config.tokenEnv ? process.env[config.tokenEnv] : "") || "";
const workflowId = pickArg(args, "workflow-id", "workflowId") || config.workflowId || "";
if (!token) {
  fail(`Coze token is required. Set ${config.tokenEnv || "COZE_API_TOKEN"} or fill ${CONFIG_KEY}.token in VS Code settings.`);
}
if (!workflowId) {
  fail(`Coze workflowId is required. Fill ${CONFIG_KEY}.workflowId or pass --workflow-id.`);
}

const qid = String(pickArg(args, "qid"));
const slug = String(pickArg(args, "slug") || "");
const title = String(pickArg(args, "title") || "");
const imageSrcIncludes = String(pickArg(args, "image-src-includes", "imageSrcIncludes") || "");
const example = numberOrUndefined(pickArg(args, "example")) || 1;
const imagePath = path.resolve(pickArg(args, "image"));
const out = pickArg(args, "out")
  ? path.resolve(pickArg(args, "out"))
  : path.resolve(root, "resources", "diagrams", `${qid}${slug ? `.${slug}` : ""}.json`);

(async () => {
  const fileId = await uploadFile(imagePath);
  const workflowResponse = await runWorkflow(fileId);
  const pack = buildDiagramPack(extractDiagramSpec(workflowResponse));
  validateIfPossible(pack, out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
  console.log(out);
})().catch((error) => fail(error && error.message ? error.message : String(error)));

async function uploadFile(filePath) {
  const body = multipartBody({
    fieldName: "file",
    filePath,
    contentType: mimeFor(filePath),
  });
  const response = await request({
    method: "POST",
    pathName: config.uploadPath || "/files/upload",
    body: body.buffer,
    headers: {
      "Content-Type": `multipart/form-data; boundary=${body.boundary}`,
      "Content-Length": body.buffer.length,
    },
  });
  const data = unwrapCozeResponse(response);
  const fileId = data && (data.id || data.file_id || data.fileId);
  if (!fileId) {
    throw new Error(`Coze upload response did not include file id: ${JSON.stringify(response).slice(0, 800)}`);
  }
  return String(fileId);
}

async function runWorkflow(fileId) {
  const parameters = buildWorkflowParameters(fileId);
  const payload = compactObject({
    workflow_id: workflowId,
    bot_id: pickArg(args, "bot-id", "botId") || config.botId || undefined,
    app_id: pickArg(args, "app-id", "appId") || config.appId || undefined,
    parameters,
  });
  const response = await request({
    method: "POST",
    pathName: config.workflowRunPath || "/workflow/run",
    body: Buffer.from(JSON.stringify(payload), "utf8"),
    headers: {
      "Content-Type": "application/json",
    },
  });
  if (response && response.debug_url) {
    console.error(`Coze debug: ${response.debug_url}`);
  }
  return unwrapCozeResponse(response);
}

function buildWorkflowParameters(fileId) {
  const keys = Object.assign({}, DEFAULT_DIAGRAM_API.parameterKeys, isObject(config.parameterKeys) ? config.parameterKeys : {});
  return compactObject({
    [keys.image]: buildImageValue(fileId),
  });
}

function buildImageValue(fileId) {
  const type = String(pickArg(args, "image-value-type") || config.imageValueType || "file_id_json");
  if (type === "file_id_json") {
    return JSON.stringify({ file_id: fileId });
  }
  if (type === "file_object") {
    return { file_id: fileId };
  }
  if (type === "image_object") {
    return { type: "image", file_id: fileId };
  }
  return fileId;
}

function extractDiagramSpec(value) {
  let current = parseMaybeJson(value);
  const outputKey = String(config.outputKey || "diagram");
  if (isObject(current) && current[outputKey] !== undefined) {
    current = parseMaybeJson(current[outputKey]);
  } else if (isObject(current) && current.diagram !== undefined) {
    current = parseMaybeJson(current.diagram);
  } else if (isObject(current) && current.diagram_json !== undefined) {
    current = parseMaybeJson(current.diagram_json);
  } else if (isObject(current) && current.layout !== undefined) {
    current = parseMaybeJson(current.layout);
  } else if (isObject(current) && current.layout_json !== undefined) {
    current = parseMaybeJson(current.layout_json);
  } else if (isObject(current) && current.output !== undefined) {
    current = parseMaybeJson(current.output);
  } else if (isObject(current) && current.data !== undefined) {
    current = parseMaybeJson(current.data);
  }
  if (isObject(current) && current.diagram !== undefined) {
    current = parseMaybeJson(current.diagram);
  }
  if (!isObject(current)) {
    throw new Error(`workflow output did not contain a diagram layout: ${JSON.stringify(value).slice(0, 1000)}`);
  }
  return current;
}

function unwrapCozeResponse(response) {
  if (!isObject(response)) {
    return response;
  }
  if (response.code !== undefined && Number(response.code) !== 0) {
    throw new Error(`Coze request failed (${response.code}): ${response.msg || response.message || JSON.stringify(response).slice(0, 800)}`);
  }
  return response.data !== undefined ? parseMaybeJson(response.data) : response;
}

function request({ method, pathName, body, headers }) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(`${normalizeBaseUrl(config.baseUrl)}${pathName}`);
    const transport = endpoint.protocol === "http:" ? http : https;
    const requestHeaders = Object.assign({}, isObject(config.headers) ? config.headers : {}, headers || {}, {
      Authorization: `Bearer ${token}`,
    });
    const req = transport.request({
      method,
      protocol: endpoint.protocol,
      hostname: endpoint.hostname,
      port: endpoint.port || undefined,
      path: `${endpoint.pathname}${endpoint.search}`,
      headers: requestHeaders,
      timeout: Number(config.timeoutMs || 120000),
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if ((res.statusCode || 0) >= 400) {
          reject(new Error(`Coze request failed (${res.statusCode}): ${text.slice(0, 800)}`));
          return;
        }
        try {
          resolve(parseMaybeJson(text));
        } catch (error) {
          reject(new Error(`failed to parse Coze response: ${error.message}\n${text.slice(0, 800)}`));
        }
      });
    });
    req.on("timeout", () => req.destroy(new Error("Coze request timed out.")));
    req.on("error", reject);
    req.end(body);
  });
}

function multipartBody({ fieldName, filePath, contentType }) {
  const boundary = `----LeetcodeUltra${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const fileName = path.basename(filePath);
  const header = Buffer.from([
    `--${boundary}`,
    `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"`,
    `Content-Type: ${contentType}`,
    "",
    "",
  ].join("\r\n"), "utf8");
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  return {
    boundary,
    buffer: Buffer.concat([header, fs.readFileSync(filePath), footer]),
  };
}

function buildDiagramPack(diagram) {
  const pack = {
    version: 1,
    problem: {
      qid,
      slug,
      title: title || slug || qid,
    },
    replacements: [],
  };
  if (!isObject(diagram) || diagram.type !== "linkedListTransform") {
    return pack;
  }
  const match = {};
  if (imageSrcIncludes) {
    match.imageSrcIncludes = imageSrcIncludes;
  }
  match.example = example;
  pack.replacements.push({ match, diagram });
  return pack;
}

function validateIfPossible(pack, outPath) {
  const validatorPath = path.join(root, "out", "src", "diagram", "DiagramValidation.js");
  if (!fs.existsSync(validatorPath)) {
    console.warn("skip local validation because out/src/diagram/DiagramValidation.js does not exist; run npm run diagram:validate after npm run compile.");
    return;
  }
  const { validateDiagramPack } = require(validatorPath);
  const result = validateDiagramPack(pack);
  if (!result.ok) {
    const details = result.issues.map((issue) => `  ${issue.path}: ${issue.message}`).join("\n");
    fail(`generated diagram pack is invalid and was not written to ${outPath}:\n${details}`);
  }
}

function loadDiagramApiConfig(parsedArgs) {
  const packageDefaults = readPackageDefaults();
  const vscodeSettingsPath = path.join(root, ".vscode", "settings.json");
  const localSettings = fs.existsSync(vscodeSettingsPath) ? readSettingsConfig(vscodeSettingsPath) : {};
  const explicitConfig = pickArg(parsedArgs, "config") ? readSettingsConfig(path.resolve(pickArg(parsedArgs, "config"))) : {};
  const cliConfig = compactObject({
    baseUrl: pickArg(parsedArgs, "base-url"),
    token: pickArg(parsedArgs, "token"),
    tokenEnv: pickArg(parsedArgs, "token-env"),
    workflowId: pickArg(parsedArgs, "workflow-id"),
    botId: pickArg(parsedArgs, "bot-id"),
    appId: pickArg(parsedArgs, "app-id"),
    uploadPath: pickArg(parsedArgs, "upload-path"),
    workflowRunPath: pickArg(parsedArgs, "workflow-run-path"),
    imageValueType: pickArg(parsedArgs, "image-value-type"),
    outputKey: pickArg(parsedArgs, "output-key"),
    timeoutMs: numberOrUndefined(pickArg(parsedArgs, "timeout-ms")),
  });
  return Object.assign({}, DEFAULT_DIAGRAM_API, packageDefaults, localSettings, explicitConfig, cliConfig);
}

function readPackageDefaults() {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const configuration = packageJson.contributes && packageJson.contributes.configuration;
    const blocks = Array.isArray(configuration) ? configuration : [configuration];
    for (const block of blocks) {
      const properties = block && block.properties;
      const entry = properties && properties[CONFIG_KEY];
      if (entry && isObject(entry.default)) {
        return entry.default;
      }
    }
  } catch (_) {
    return {};
  }
  return {};
}

function readSettingsConfig(filePath) {
  const json = JSON.parse(stripJsonComments(fs.readFileSync(filePath, "utf8")));
  if (isObject(json[CONFIG_KEY])) {
    return json[CONFIG_KEY];
  }
  if (isObject(json.diagramAuthor)) {
    return json.diagramAuthor;
  }
  return isObject(json) ? json : {};
}

function parseMaybeJson(value) {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      return JSON.parse(fenced[1]);
    }
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    return value;
  }
}

function stripJsonComments(text) {
  let output = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
        output += char;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
    } else if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
    } else {
      output += char;
    }
  }
  return output.replace(/,\s*([}\]])/g, "$1");
}

function compactObject(value) {
  const result = {};
  for (const key of Object.keys(value)) {
    if (value[key] !== undefined && value[key] !== "") {
      result[key] = value[key];
    }
  }
  return result;
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_DIAGRAM_API.baseUrl).replace(/\/+$/, "");
}

function numberOrUndefined(value) {
  if (value === undefined || value === "") {
    return undefined;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = "true";
    } else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function pickArg(source, ...keys) {
  for (const key of keys) {
    if (source[key] !== undefined) {
      return source[key];
    }
    const camel = key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (source[camel] !== undefined) {
      return source[camel];
    }
  }
  return undefined;
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") {
    return "image/jpeg";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  return "image/png";
}

function printUsage() {
  console.error([
    "Usage: npm run diagram:author -- --qid 203 --slug remove-linked-list-elements --image /path/to/image.png --image-src-includes removelinked-list --out resources/diagrams/203.remove-linked-list-elements.json",
    "",
    "Required config: COZE_API_TOKEN plus leetcode-problem-rating.diagramAuthor.api.workflowId, or --token and --workflow-id.",
    "Optional flags: --config .vscode/settings.json --base-url https://api.coze.cn/v1 --output-key diagram --image-value-type file_id_json",
  ].join("\n"));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
