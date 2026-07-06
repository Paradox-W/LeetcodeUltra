import * as vscode from "vscode";
import { URLSearchParams } from "url";
import { BABA, BabaStr } from "../BABA";
import { Endpoint, OutPutType } from "../model/ConstDefind";
import { getLeetCodeEndpoint } from "../utils/ConfigUtils";
import { ShowMessage } from "../utils/OutputUtils";

class BrowserLoginService {
  private context: vscode.ExtensionContext | undefined;

  public initialize(context: vscode.ExtensionContext): void {
    this.context = context;
  }

  public async signIn(): Promise<void> {
    const opened = await vscode.env.openExternal(vscode.Uri.parse(this.getAuthLoginUrl()));
    if (!opened) {
      throw new Error("无法打开 LeetCode 浏览器登录页面。");
    }
  }

  public handleUriSignIn = async (uri: vscode.Uri): Promise<void> => {
    const queryParams = new URLSearchParams(uri.query);
    const cookie = String(queryParams.get("cookie") || "").trim();
    const userHint = String(queryParams.get("username") || queryParams.get("user") || "browser-login").trim() || "browser-login";

    if (!cookie) {
      await this.handleError("浏览器授权未返回 cookie，请重新登录。");
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "正在同步 LeetCode 浏览器登录状态",
      },
      async () => {
        try {
          const userName: string | undefined = await BABA.getProxy(BabaStr.ChildCallProxy)
            .get_instance()
            .trySignInByCookie(userHint, cookie);

          if (!userName) {
            throw new Error("未能从浏览器授权中获取有效用户信息。");
          }

          BABA.sendNotification(BabaStr.USER_LOGIN_SUC, { userName });
          vscode.window.showInformationMessage(`LeetCode 浏览器登录成功：${userName}`);
        } catch (error) {
          await this.handleError(`浏览器授权登录失败: ${this.stringifyError(error)}`);
        }
      }
    );
  };

  private getAuthLoginUrl(): string {
    const baseUrl = getLeetCodeEndpoint() === Endpoint.LeetCodeCN ? "https://leetcode.cn" : "https://leetcode.com";
    return `${baseUrl}/authorize-login/${vscode.env.uriScheme}/?path=${encodeURIComponent(this.getExtensionId())}`;
  }

  private getExtensionId(): string {
    return this.context?.extension.id || "paradox.leetcodeultra";
  }

  private async handleError(message: string): Promise<void> {
    this.appendLogMessage(message);
    await ShowMessage(message, OutPutType.error);
  }

  private appendLogMessage(message: string): void {
    try {
      BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine(`[browser-login] ${message}`);
    } catch (_) {
      // Logging should not block browser auth handling.
    }
  }

  private stringifyError(error: unknown): string {
    if (error instanceof Error) {
      return error.stack || error.message;
    }
    return String(error);
  }
}

export const browserLoginService: BrowserLoginService = new BrowserLoginService();
