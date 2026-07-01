import * as crypto from "crypto";
import * as http from "http";
import * as https from "https";
import * as vscode from "vscode";

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiApiConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  jsonMode: boolean;
  timeoutMs: number;
  path: string;
  headers: { [key: string]: string };
}

export interface AiRequestOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

const AI_DEBUG_SECRET_KEY = "leetcode-problem-rating.aiDebug.apiKey";
const LEGACY_VISUALIZE_SECRET_KEY = "leetcode-problem-rating.aiVisualize.apiKey";

function extensionConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("leetcode-problem-rating");
}

function explicitConfigValue<T = any>(config: vscode.WorkspaceConfiguration, key: string): T | undefined {
  if (!config.inspect) {
    return undefined;
  }
  const inspected = config.inspect<T>(key);
  if (!inspected) {
    return undefined;
  }
  if (inspected.workspaceFolderValue !== undefined) {
    return inspected.workspaceFolderValue;
  }
  if (inspected.workspaceValue !== undefined) {
    return inspected.workspaceValue;
  }
  if (inspected.globalValue !== undefined) {
    return inspected.globalValue;
  }
  return undefined;
}

function stripCodeFence(value: string): string {
  const text = String(value || "").trim();
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : text;
}

export function parseAiJson<T = any>(value: string): T {
  return JSON.parse(stripCodeFence(value));
}

export function stableHash(value: string): string {
  return crypto.createHash("sha256").update(value || "", "utf8").digest("hex").slice(0, 16);
}

export class AiClient {
  constructor(private readonly context: vscode.ExtensionContext) {}

  public async storeApiKey(value: string): Promise<void> {
    await this.context.secrets.store(AI_DEBUG_SECRET_KEY, value.trim());
  }

  public async hasUsableConfig(): Promise<boolean> {
    const api = await this.getApiConfig();
    return !!(api.baseUrl && api.model && (api.apiKey || api.headers.Authorization || api.headers.authorization));
  }

  public async getApiConfig(): Promise<AiApiConfig> {
    const config = extensionConfig();
    const aiDebugApi = explicitConfigValue<any>(config, "aiDebug.api") || {};
    const legacyApi = config.get<any>("aiVisualize.api", {}) || {};
    const api = Object.assign({}, legacyApi, aiDebugApi);
    const explicitBaseUrl = explicitConfigValue<string>(config, "aiDebug.baseUrl");
    const explicitModel = explicitConfigValue<string>(config, "aiDebug.model");
    const fallbackBaseUrl = config.get<string>("aiDebug.baseUrl", "");
    const fallbackModel = config.get<string>("aiDebug.model", "");
    const envName = String(api.apiKeyEnv || "").trim();
    const apiKeyFromEnv = envName ? process.env[envName] : "";
    const apiKey =
      String(api.apiKey || apiKeyFromEnv || (await this.context.secrets.get(AI_DEBUG_SECRET_KEY)) || (await this.context.secrets.get(LEGACY_VISUALIZE_SECRET_KEY)) || "").trim();
    const headers = api.headers && typeof api.headers === "object" ? api.headers : {};
    return {
      baseUrl: String(api.baseUrl || explicitBaseUrl || config.get("aiVisualize.baseUrl", "") || fallbackBaseUrl || "").trim(),
      model: String(api.model || explicitModel || config.get("aiVisualize.model", "") || fallbackModel || "").trim(),
      apiKey,
      temperature: typeof api.temperature === "number" ? api.temperature : 0.15,
      maxTokens: typeof api.maxTokens === "number" ? api.maxTokens : 900,
      jsonMode: api.jsonMode !== false,
      timeoutMs: typeof api.timeoutMs === "number" ? api.timeoutMs : 45000,
      path: String(api.path || "").trim(),
      headers,
    };
  }

  public async requestChat(messages: AiChatMessage[], options: AiRequestOptions = {}): Promise<any> {
    const api = await this.getApiConfig();
    if (!api.baseUrl || !api.model || (!api.apiKey && !api.headers.Authorization && !api.headers.authorization)) {
      throw new Error("AI 服务未配置。请在 leetcode-problem-rating.aiDebug.api 或旧 aiVisualize.api 中设置 baseUrl、model 和 apiKey。");
    }
    const url = this.resolveChatCompletionsUrl(api.baseUrl, api.path);
    const requestBody: any = {
      model: api.model,
      temperature: options.temperature === undefined ? api.temperature : options.temperature,
      max_tokens: options.maxTokens || api.maxTokens,
      messages,
    };
    if (options.jsonMode === undefined ? api.jsonMode : options.jsonMode) {
      requestBody.response_format = { type: "json_object" };
    }
    return this.postJson(url, api.apiKey, JSON.stringify(requestBody), api);
  }

  public async requestJson<T = any>(messages: AiChatMessage[], options: AiRequestOptions = {}): Promise<T> {
    const response = await this.requestChat(messages, Object.assign({ jsonMode: true }, options));
    const content = response && response.choices && response.choices[0] && response.choices[0].message
      ? response.choices[0].message.content
      : "";
    if (!content) {
      throw new Error("AI 服务返回了空内容。");
    }
    return parseAiJson<T>(content);
  }

  private resolveChatCompletionsUrl(baseUrl: string, path: string): string {
    const trimmed = String(baseUrl || "").replace(/\/+$/, "");
    if (path) {
      if (/^https?:\/\//i.test(path)) {
        return path;
      }
      return `${trimmed}/${String(path).replace(/^\/+/, "")}`;
    }
    if (/\/chat\/completions$/.test(trimmed)) {
      return trimmed;
    }
    return `${trimmed}/chat/completions`;
  }

  private postJson(urlString: string, apiKey: string, body: string, api: AiApiConfig): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlString);
      const client = url.protocol === "http:" ? http : https;
      const headers = Object.assign({
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      }, api.headers || {});
      if (apiKey && !headers.Authorization && !headers.authorization) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      const req = client.request({
        method: "POST",
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        headers,
        timeout: api.timeoutMs || 45000,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          if ((res.statusCode || 0) >= 400) {
            reject(new Error(`AI 服务请求失败（${res.statusCode}）：${text.slice(0, 500)}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (_) {
            reject(new Error(`AI 服务返回了非 JSON 响应：${text.slice(0, 500)}`));
          }
        });
      });
      req.on("timeout", () => req.destroy(new Error("AI 服务请求超时。")));
      req.on("error", reject);
      req.end(body);
    });
  }
}
