import * as vscode from "vscode";
import { URLSearchParams } from "url";
import { BABA, BabaStr } from "../BABA";
import { Endpoint, OutPutType } from "../model/ConstDefind";
import { getLeetCodeEndpoint } from "../utils/ConfigUtils";
import { ShowMessage } from "../utils/OutputUtils";

type LoginMethod = "LeetCode" | "Cookie" | "GitHub" | "LinkedIn";

interface LoginCredentials {
  login?: string;
  password?: string;
  cookie?: string;
  csrfToken?: string;
  leetcodeSession?: string;
}

class BrowserLoginService implements vscode.Disposable, vscode.WebviewViewProvider {
  private context: vscode.ExtensionContext | undefined;
  private view: vscode.WebviewView | undefined;
  private endpointSwitchSequence = 0;
  private endpointSwitchTask: Promise<void> = Promise.resolve();
  private loginInProgress = false;
  private challengeSequence = 0;
  private pendingChallenge: { id: number; resolve: (value: string | undefined) => void } | undefined;

  public initialize(context: vscode.ExtensionContext): void {
    this.context = context;
    context.subscriptions.push(
      this,
      vscode.window.registerWebviewViewProvider("LCPRLoginView", this, {
        webviewOptions: { retainContextWhenHidden: true },
      })
    );
    void vscode.commands.executeCommand("setContext", "leetcodeUltra.signedIn", false);
  }

  public dispose(): void {
    this.cancelPendingChallenge();
    this.view = undefined;
  }

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.title = "";
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: this.context ? [vscode.Uri.joinPath(this.context.extensionUri, "resources")] : [],
    };
    view.webview.html = this.getLoginPageHtml(view.webview);
    view.webview.onDidReceiveMessage((message) => this.handleLoginPageMessage(message));
    view.onDidDispose(() => {
      if (this.view === view) {
        this.cancelPendingChallenge();
        this.view = undefined;
      }
    });
  }

  public async showLoginPage(): Promise<void> {
    await this.setSignedIn(false);
    await vscode.commands.executeCommand("workbench.view.extension.lcpr_bar");
    try {
      await vscode.commands.executeCommand("LCPRLoginView.focus");
    } catch (_) {
      // The container reveal is sufficient on older VS Code versions.
    }
  }

  public async setSignedIn(signedIn: boolean): Promise<void> {
    await vscode.commands.executeCommand("setContext", "leetcodeUltra.signedIn", signedIn);
    if (!signedIn && this.view) {
      this.view.webview.html = this.getLoginPageHtml(this.view.webview);
    }
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
          await this.setSignedIn(true);
          vscode.window.showInformationMessage(`LeetCode 浏览器登录成功：${userName}`);
        } catch (error) {
          await this.handleError(`浏览器授权登录失败: ${this.stringifyError(error)}`);
          this.postStatus("授权失败，请重试", "error");
        }
      }
    );
  };

  private async handleLoginPageMessage(message: any): Promise<void> {
    const command = String(message?.command || "");
    switch (command) {
      case "close":
        await vscode.commands.executeCommand("workbench.action.closeSidebar");
        return;
      case "selectEndpoint":
        await this.selectEndpoint(String(message.endpoint || ""));
        return;
      case "browserAuth":
        await this.startBrowserAuthorization();
        return;
      case "submitLogin":
        await this.signInWith(
          String(message.method || "") as LoginMethod,
          this.normalizeCredentials(message.credentials)
        );
        return;
      case "loginChallengeResponse":
        this.resolveLoginChallenge(Number(message.requestId), String(message.value || "").trim() || undefined);
        return;
      case "openLegal":
        await this.openLegalPage(String(message.page || ""));
        return;
      default:
        return;
    }
  }

  private async selectEndpoint(value: string): Promise<void> {
    const endpoint = value === Endpoint.LeetCode ? Endpoint.LeetCode : Endpoint.LeetCodeCN;
    const sequence = ++this.endpointSwitchSequence;
    this.postStatus("", "idle");

    this.endpointSwitchTask = this.endpointSwitchTask.then(async () => {
      if (sequence !== this.endpointSwitchSequence) {
        return;
      }

      const previousEndpoint = getLeetCodeEndpoint();
      if (endpoint === previousEndpoint) {
        this.view?.webview.postMessage({ command: "endpointChanged", endpoint });
        return;
      }

      const childCall = BABA.getProxy(BabaStr.ChildCallProxy).get_instance();
      const configuration = vscode.workspace.getConfiguration("leetcode-problem-rating");
      try {
        await childCall.switchEndpoint(endpoint);
        await configuration.update("endpoint", endpoint, vscode.ConfigurationTarget.Global);
        await childCall.deleteCache();
        if (sequence === this.endpointSwitchSequence) {
          this.view?.webview.postMessage({ command: "endpointChanged", endpoint });
        }
      } catch (error) {
        this.appendLogMessage(`切换站点失败: ${this.stringifyError(error)}`);
        try {
          await childCall.switchEndpoint(previousEndpoint);
          await configuration.update("endpoint", previousEndpoint, vscode.ConfigurationTarget.Global);
        } catch (rollbackError) {
          this.appendLogMessage(`恢复原站点失败: ${this.stringifyError(rollbackError)}`);
        }
        if (sequence === this.endpointSwitchSequence) {
          this.view?.webview.postMessage({ command: "endpointChanged", endpoint: previousEndpoint });
          this.postStatus("站点切换失败，请重试", "error");
        }
      }
    });

    await this.endpointSwitchTask;
  }

  private async startBrowserAuthorization(): Promise<void> {
    this.postStatus("正在打开浏览器…", "loading");
    try {
      await this.signIn();
      this.postStatus("请在浏览器中完成授权", "waiting");
      await vscode.window.showInformationMessage("已打开浏览器，请在网页中完成 LeetCode 授权登录。");
    } catch (error) {
      await this.handleError(`打开浏览器登录失败: ${this.stringifyError(error)}`);
      this.postStatus("无法打开浏览器", "error");
    }
  }

  private async signInWith(method: LoginMethod, credentials: LoginCredentials): Promise<void> {
    const allowedMethods: LoginMethod[] = ["LeetCode", "Cookie", "GitHub", "LinkedIn"];
    if (!allowedMethods.includes(method)) {
      return;
    }
    if (this.loginInProgress) {
      return;
    }
    if (method === "LeetCode" && getLeetCodeEndpoint() !== Endpoint.LeetCodeCN) {
      this.postLoginState("error", "账号密码登录仅支持中文站");
      return;
    }
    const needsCookie = method === "Cookie";
    const hasCookie = Boolean(
      String(credentials.cookie || "").trim() ||
      (String(credentials.csrfToken || "").trim() && String(credentials.leetcodeSession || "").trim())
    );
    if ((!needsCookie && !credentials.login) || (needsCookie ? !hasCookie : !credentials.password)) {
      this.postLoginState("error", "请完整填写登录信息");
      return;
    }

    const label = method === "Cookie" ? "Cookie 登录" : "登录";
    this.loginInProgress = true;
    this.postLoginState("loading", `正在${label}…`);
    try {
      const userName: string | undefined = await BABA.getProxy(BabaStr.ChildCallProxy)
        .get_instance()
        .trySignIn(method, credentials, (challenge) => this.requestLoginChallenge(method, challenge));
      if (!userName) {
        this.postLoginState("idle", "登录已取消");
        return;
      }
      BABA.sendNotification(BabaStr.USER_LOGIN_SUC, { userName });
      this.view?.webview.postMessage({ command: "loginState", state: "success", message: `${label}成功` });
      await this.setSignedIn(true);
    } catch (error) {
      this.appendLogMessage(`${label}失败: ${this.stringifyError(error)}`);
      this.postLoginState("error", `${label}失败，请检查输入后重试`);
    } finally {
      this.loginInProgress = false;
      this.cancelPendingChallenge();
    }
  }

  private normalizeCredentials(value: any): LoginCredentials {
    return {
      login: String(value?.login || "").trim().slice(0, 320),
      password: String(value?.password || "").slice(0, 10000),
      cookie: String(value?.cookie || "").trim().slice(0, 30000),
      csrfToken: String(value?.csrfToken || value?.csrftoken || "").trim().slice(0, 12000),
      leetcodeSession: String(value?.leetcodeSession || value?.LEETCODE_SESSION || "").trim().slice(0, 20000),
    };
  }

  private requestLoginChallenge(method: LoginMethod, challenge: any): Promise<string | undefined> {
    this.cancelPendingChallenge();
    if (!this.view) {
      return Promise.resolve(undefined);
    }
    const id = ++this.challengeSequence;
    return new Promise((resolve) => {
      this.pendingChallenge = { id, resolve };
      void this.view?.webview.postMessage({
        command: "loginChallenge",
        requestId: id,
        method,
        type: String(challenge?.type || "twoFactorCode"),
        message: "请输入 GitHub 两步验证码",
      });
    });
  }

  private resolveLoginChallenge(id: number, value: string | undefined): void {
    if (!this.pendingChallenge || this.pendingChallenge.id !== id) {
      return;
    }
    const pending = this.pendingChallenge;
    this.pendingChallenge = undefined;
    pending.resolve(value);
  }

  private cancelPendingChallenge(): void {
    if (!this.pendingChallenge) {
      return;
    }
    const pending = this.pendingChallenge;
    this.pendingChallenge = undefined;
    pending.resolve(undefined);
  }

  private postLoginState(state: string, message: string): void {
    this.view?.webview.postMessage({ command: "loginState", state, message });
  }

  private async openLegalPage(page: string): Promise<void> {
    const baseUrl = getLeetCodeEndpoint() === Endpoint.LeetCodeCN ? "https://leetcode.cn" : "https://leetcode.com";
    const path = page === "privacy" ? "/privacy/" : "/terms/";
    await vscode.env.openExternal(vscode.Uri.parse(`${baseUrl}${path}`));
  }

  private postStatus(message: string, tone: string): void {
    this.view?.webview.postMessage({ command: "status", message, tone });
  }

  private getAuthLoginUrl(): string {
    const baseUrl = getLeetCodeEndpoint() === Endpoint.LeetCodeCN ? "https://leetcode.cn" : "https://leetcode.com";
    return `${baseUrl}/authorize-login/${vscode.env.uriScheme}/?path=${encodeURIComponent(this.getExtensionId())}`;
  }

  private getExtensionId(): string {
    return this.context?.extension.id || "paradox.leetcodeultra";
  }

  private getLoginPageHtml(webview: vscode.Webview): string {
    const nonce = this.createNonce();
    const endpoint = getLeetCodeEndpoint();
    const logoUri = this.context
      ? webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "resources", "leetcode-logo.png"))
      : "";
    const lightLogoUri = this.context
      ? webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "resources", "leetcode-logo-light.png"))
      : "";
    const ultraWordmarkUri = this.context
      ? webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "resources", "ultra-wordmark.png"))
      : "";
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>登录 LeetcodeUltra</title>
  <style>
    :root {
      color-scheme: dark;
      --page-bg: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
      --surface: rgba(18, 27, 35, 0.78);
      --surface-hover: rgba(238, 242, 245, 0.08);
      --border: #26323c;
      --border-strong: #34434f;
      --text: #eef2f5;
      --muted: #8c97a3;
      --muted-dim: #697581;
      --primary: #ffffff;
      --primary-foreground: #111111;
      --primary-soft: rgba(255, 255, 255, 0.1);
      --primary-border: rgba(255, 255, 255, 0.42);
      --control-bg: rgba(13, 22, 30, 0.76);
      --control-fg: #b4bec7;
      --control-hover-bg: rgba(255, 255, 255, 0.07);
      --control-selected-bg: rgba(0, 0, 0, 0.38);
      --control-selected-border: rgba(255, 255, 255, 0.18);
      --method-bg: rgba(14, 23, 31, 0.48);
      --method-fg: #b9c3cc;
      --font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", sans-serif);
    }

    body.vscode-light {
      color-scheme: light;
      --page-bg: var(--vscode-sideBar-background, var(--vscode-editor-background, #ffffff));
      --surface: rgba(255, 255, 255, 0.78);
      --surface-hover: rgba(17, 17, 17, 0.06);
      --border: rgba(17, 17, 17, 0.14);
      --border-strong: rgba(17, 17, 17, 0.26);
      --text: #111111;
      --muted: #606975;
      --muted-dim: #7a838c;
      --primary: #111111;
      --primary-foreground: #ffffff;
      --primary-soft: rgba(17, 17, 17, 0.08);
      --primary-border: rgba(17, 17, 17, 0.5);
      --control-bg: rgba(17, 17, 17, 0.035);
      --control-fg: #3f4852;
      --control-hover-bg: rgba(17, 17, 17, 0.055);
      --control-selected-bg: rgba(17, 17, 17, 0.18);
      --control-selected-border: rgba(17, 17, 17, 0.24);
      --method-bg: rgba(17, 17, 17, 0.025);
      --method-fg: #30363d;
    }

    * { box-sizing: border-box; }
    [hidden] { display: none !important; }
    html, body { width: 100%; height: 100%; min-width: 0; margin: 0; overflow: hidden; }
    body {
      min-width: 0;
      color: var(--text);
      background-color: var(--page-bg);
      font-family: var(--font);
      font-size: var(--vscode-font-size, 13px);
      letter-spacing: 0;
    }

    button, a { font: inherit; }
    button { color: inherit; }

    .page {
      width: 100%;
      max-width: 393px;
      min-height: 100%;
      margin: 0 auto;
      padding: 11px clamp(12px, 5.35vw, 21px) 24px;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
      overflow-y: auto;
    }

    .hero {
      margin-top: 46.5px;
      display: grid;
      grid-template-columns: clamp(50px, 28vw, 110px) 1px minmax(0, 1fr);
      align-items: center;
      column-gap: clamp(9px, 5vw, 20.5px);
      min-height: 115px;
    }

    .brand-symbol {
      width: clamp(50px, 28vw, 110px);
      height: auto;
      max-height: 103px;
      object-fit: contain;
      overflow: visible;
    }
    body.vscode-light .brand-symbol { content: url("${lightLogoUri}"); }

    .hero-divider {
      width: 1px;
      height: 95.5px;
      background: var(--border-strong);
    }

    .hero-copy h1 {
      margin: 0 0 6.5px;
      font-size: 18px;
      line-height: 1.35;
      font-weight: 600;
    }
    .hero-copy { min-width: 0; }
    .product-name {
      margin: 0 0 10px;
      white-space: nowrap;
      font-size: 21px;
      line-height: 1.2;
      font-weight: 700;
    }
    .ultra-wordmark {
      display: inline-block;
      width: auto;
      height: .8em;
      margin-left: .18em;
      vertical-align: -.055em;
      object-fit: contain;
      filter:
        brightness(1.04)
        saturate(1.24)
        contrast(1.06)
        drop-shadow(0 0 3px rgba(238, 179, 43, 0.24));
    }
    body.vscode-light .ultra-wordmark {
      filter:
        brightness(.78)
        saturate(1.35)
        contrast(1.18)
        drop-shadow(0 1px 1px rgba(91, 58, 5, 0.2));
    }
    .tagline {
      margin: 0;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.6;
    }

    .feature-list {
      margin-top: 60px;
      padding: 0 19.5px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
    }
    .feature {
      min-height: 64px;
      display: grid;
      grid-template-columns: minmax(28px, 44.5px) minmax(0, 1fr);
      align-items: center;
      column-gap: clamp(10px, 4.85vw, 19px);
      border-bottom: 1px solid var(--border);
    }
    .feature:last-child { border-bottom: 0; }
    .feature-icon {
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      border: 1px solid color-mix(in srgb, var(--icon-color) 20%, var(--border));
      border-radius: 10.5px;
      color: var(--icon-color);
      background: var(--primary-soft);
    }
    .feature-icon svg { width: 24px; height: 24px; stroke: currentColor; }
    .feature-copy h2 { margin: 0; overflow-wrap: anywhere; text-wrap: pretty; font-size: 13px; line-height: 1.35; font-weight: 600; }

    .auth { margin-top: auto; padding-top: 58px; flex: 0 0 auto; }
    .section-label { margin: 0 0 9px; color: var(--muted); font-size: 11px; line-height: 1.4; }
    .endpoint-switch {
      height: 40px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      overflow: hidden;
      border: 1px solid var(--border);
      border-radius: 4.5px;
      background: var(--control-bg);
    }
    .endpoint {
      border: 0;
      color: var(--control-fg);
      background: transparent;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      transition: background-color 150ms ease, color 150ms ease;
    }
    .endpoint span { margin-left: 4px; color: var(--muted-dim); font-size: 11px; font-weight: 400; }
    .endpoint:not(.is-active):hover { background: var(--control-hover-bg); color: var(--text); }
    .endpoint.is-active {
      color: var(--primary);
      background: var(--control-selected-bg);
      box-shadow: inset 0 0 0 1px var(--control-selected-border);
    }
    .endpoint.is-active span { color: var(--primary); }

    .primary {
      width: 100%;
      height: 40px;
      margin-top: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      border: 0;
      border-radius: 4px;
      color: var(--primary-foreground);
      background: var(--primary);
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      transition: opacity 150ms ease, transform 100ms ease;
    }
    .primary:hover { opacity: .9; }
    .primary:active { transform: translateY(1px); }
    .primary svg { width: 15.5px; height: 15.5px; stroke: currentColor; }

    .security-note {
      min-height: 38.5px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6.5px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.45;
    }
    .security-note svg { width: 10px; height: 10px; stroke: currentColor; }
    .status { min-height: 14px; margin-top: -4px; text-align: center; color: var(--muted); font-size: 11px; line-height: 1.3; }
    .status:empty { display: none; }
    .status[data-tone="error"] { color: var(--vscode-errorForeground, #d1242f); }
    .status[data-tone="waiting"] { color: var(--primary); }

    .other-divider { margin: 18px 0 15.5px; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 11.5px; color: var(--muted); font-size: 11px; line-height: 1.4; }
    .other-divider::before, .other-divider::after { content: ""; height: 1px; background: var(--border-strong); }
    .other-methods { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 76px), 1fr)); gap: 7.5px; }
    .method {
      min-width: 0;
      height: 36px;
      padding: 0 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      border: 1px solid var(--border-strong);
      border-radius: 4px;
      color: var(--method-fg);
      background: var(--method-bg);
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
      white-space: normal;
      line-height: 1.25;
      transition: color 140ms ease, border-color 140ms ease, background-color 140ms ease;
    }
    .method:hover { color: var(--text); border-color: var(--primary-border); background: var(--surface-hover); }
    .method:focus-visible, .primary:focus-visible, .endpoint:focus-visible { outline: 2px solid var(--primary-border); outline-offset: -3px; }
    .method svg { width: 14px; height: 14px; flex: 0 0 auto; }
    .method-account,
    .method-cookie,
    .method-github,
    .method-linkedin { color: var(--primary); }
    .method-linkedin { font-weight: 700; font-size: 14px; line-height: 1; }

    .login-panel {
      margin-top: 12px;
      padding: 12px;
      border: 1px solid var(--border-strong);
      border-radius: 6px;
      background: var(--surface);
    }
    .login-panel-header {
      min-height: 25px;
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr) 24px;
      align-items: center;
      column-gap: 6px;
    }
    .login-panel-header h2 {
      margin: 0;
      overflow: hidden;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      line-height: 1.4;
      font-weight: 600;
    }
    .login-back {
      width: 24px;
      height: 24px;
      padding: 0;
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 3px;
      color: var(--muted);
      background: transparent;
      cursor: pointer;
    }
    .login-back:hover { color: var(--text); background: var(--surface-hover); }
    .login-back:disabled { opacity: .35; cursor: default; }
    .login-back svg { width: 15px; height: 15px; stroke: currentColor; }
    .login-description {
      margin: 3px 0 9px;
      color: var(--muted);
      text-align: center;
      font-size: 10.5px;
      line-height: 1.35;
    }
    .login-fields { display: grid; gap: 7px; }
    .login-field { display: grid; gap: 4px; }
    .login-field > span { color: var(--muted); font-size: 10.5px; line-height: 1.2; }
    .login-field input,
    .login-field textarea {
      width: 100%;
      min-width: 0;
      border: 1px solid var(--border-strong);
      border-radius: 3px;
      color: var(--text);
      background: var(--control-bg);
      outline: none;
      font: inherit;
      font-size: 12px;
    }
    .login-field input { height: 31px; padding: 0 8px; }
    .login-field textarea { height: 48px; padding: 7px 8px; resize: none; line-height: 1.35; }
    .login-field input:focus,
    .login-field textarea:focus {
      border-color: var(--vscode-focusBorder, #007acc);
      box-shadow: none;
    }
    .login-field input::placeholder,
    .login-field textarea::placeholder { color: var(--muted-dim); opacity: 1; }
    .login-message {
      min-height: 14px;
      margin-top: 6px;
      color: var(--muted);
      text-align: center;
      font-size: 10.5px;
      line-height: 1.3;
    }
    .login-message[data-tone="error"] { color: var(--vscode-errorForeground, #d1242f); }
    .login-message[data-tone="waiting"] { color: var(--primary); }
    .login-submit {
      width: 100%;
      height: 32px;
      margin-top: 7px;
      border: 0;
      border-radius: 3px;
      color: var(--primary-foreground);
      background: var(--primary);
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
    }
    .login-submit:hover:not(:disabled) { opacity: .9; }
    .login-submit:disabled { opacity: .48; cursor: default; }
    .login-back:focus-visible,
    .login-submit:focus-visible { outline: 2px solid var(--primary-border); outline-offset: 1px; }

    .legal {
      margin-top: 0;
      padding-top: 28px;
      flex: 0 0 auto;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.5;
      text-align: center;
      text-wrap: pretty;
    }
    .legal svg { width: 11px; height: 11px; flex: 0 0 auto; stroke: var(--primary); }
    .legal a { color: var(--primary); text-decoration: none; }
    .legal a:hover { text-decoration: underline; }

    @media (max-height: 900px) {
      .page { padding-block: 8px 16px; }
      .hero { margin-top: 24px; min-height: 95px; }
      .brand-symbol { height: 72px; }
      .hero-divider { height: 72px; }
      .hero-copy h1 { font-size: 17px; }
      .product-name { margin-bottom: 8px; font-size: 19px; }
      .tagline { font-size: 11px; }
      .feature-list { margin-top: 22px; }
      .feature { min-height: 64px; }
      .feature-icon { width: 38px; height: 38px; border-radius: 9px; }
      .feature-icon svg { width: 21px; height: 21px; }
      .feature-copy h2 { font-size: 12px; }
      .auth { padding-top: 24px; }
      .legal { padding-top: 18px; }
    }

    @media (max-height: 700px) {
      .page { padding-block: 6px 10px; }
      .hero { margin-top: 10px; min-height: 68px; }
      .brand-symbol { height: 56px; }
      .hero-divider { height: 56px; }
      .hero-copy h1 { margin-bottom: 4px; font-size: 16px; }
      .product-name { margin-bottom: 5px; font-size: 18px; }
      .tagline { font-size: 11px; line-height: 1.45; }
      .feature-list { margin-top: 12px; padding-inline: 12px; }
      .feature { min-height: 50px; grid-template-columns: 34px minmax(0, 1fr); column-gap: 11px; }
      .feature-icon { width: 32px; height: 32px; border-radius: 8px; }
      .feature-icon svg { width: 18px; height: 18px; }
      .feature-copy h2 { margin: 0; font-size: 12px; }
      .auth { padding-top: 14px; }
      .section-label { margin-bottom: 5px; }
      .endpoint-switch, .primary { height: 34px; }
      .primary { margin-top: 10px; }
      .security-note { min-height: 26px; }
      .status { min-height: 8px; }
      .other-divider { margin-block: 8px; }
      .method { height: 32px; }
      .login-panel { margin-top: 8px; padding: 9px; }
      .login-description { margin-bottom: 6px; }
      .login-fields { gap: 5px; }
      .login-field input { height: 29px; }
      .login-field textarea { height: 42px; }
      .login-submit { height: 30px; margin-top: 5px; }
      .legal { padding-top: 12px; }
    }

    @media (max-height: 560px) {
      .page { padding-block: 4px 8px; }
      .hero { margin-top: 4px; min-height: 52px; }
      .brand-symbol { height: 47px; }
      .hero-divider { height: 45px; }
      .hero-copy h1 { font-size: 16px; }
      .product-name { font-size: 18px; }
      .tagline { display: none; }
      .feature-list { margin-top: 8px; }
      .feature { min-height: 41px; }
      .feature-icon { width: 28px; height: 28px; }
      .feature-icon svg { width: 16px; height: 16px; }
      .feature-copy h2 { margin: 0; font-size: 12px; }
      .auth { padding-top: 8px; }
      .security-note { min-height: 22px; }
      .other-divider { margin-block: 5px; }
      .legal { padding-top: 8px; font-size: 11px; }
    }

    @media (max-width: 360px) {
      .other-methods { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 340px) {
      .hero { margin-top: 40px; display: block; text-align: center; }
      .brand-symbol { width: 60px; }
      .hero-divider { display: none; }
      .hero-copy { width: 100%; margin-top: 14px; }
      .product-name { max-width: 100%; display: flex; align-items: baseline; justify-content: center; }
      .leetcode-word { flex: 0 0 auto; }
      .ultra-wordmark { min-width: 0; flex: 0 1 auto; }
      .tagline { display: none; }
      .legal { flex-wrap: wrap; }
    }

    @media (max-width: 340px) and (max-height: 900px) {
      .hero { margin-top: 24px; }
    }

    @media (max-width: 340px) and (max-height: 700px) {
      .hero { margin-top: 10px; }
    }

    @media (max-width: 340px) and (max-height: 560px) {
      .hero { margin-top: 4px; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero" aria-labelledby="welcome-heading">
      <img class="brand-symbol" src="${logoUri}" alt="LeetCode">
      <div class="hero-divider" aria-hidden="true"></div>
      <div class="hero-copy">
        <h1 id="welcome-heading">欢迎使用</h1>
        <p class="product-name"><span class="leetcode-word">LeetCode</span><img class="ultra-wordmark" src="${ultraWordmarkUri}" alt="ULTRA"></p>
        <p class="tagline">更强大的 LeetCode 体验，<br>助你高效刷题与成长</p>
      </div>
    </section>

    <section class="feature-list" aria-label="产品能力">
      <article class="feature">
        <div class="feature-icon" style="--icon-color:var(--primary)">
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="M13.2 1.8 4.7 13.1h6.1l-1 9.1 8.8-12.4h-6.2l.8-8z"/></svg>
        </div>
        <div class="feature-copy"><h2>原生自然的交互体验</h2></div>
      </article>
      <article class="feature">
        <div class="feature-icon" style="--icon-color:var(--primary)">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"/></svg>
        </div>
        <div class="feature-copy"><h2>稳定多语言的本地调试体验</h2></div>
      </article>
      <article class="feature">
        <div class="feature-icon" style="--icon-color:var(--primary)">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.8"/></svg>
        </div>
        <div class="feature-copy"><h2>AI 代码可视化</h2></div>
      </article>
      <article class="feature">
        <div class="feature-icon" style="--icon-color:var(--primary)">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="13" r="7"/><circle cx="11" cy="13" r="3.4"/><path d="m15.5 8.5 4-4m-1 0h2v2M11 13l7.5-7.5"/></svg>
        </div>
        <div class="feature-copy"><h2>严谨高效的学习计划模式</h2></div>
      </article>
    </section>

    <section class="auth" aria-label="登录">
      <p class="section-label">选择站点</p>
      <div class="endpoint-switch" role="group" aria-label="选择 LeetCode 站点">
        <button class="endpoint" type="button" data-endpoint="${Endpoint.LeetCodeCN}">中文站 <span>CN</span></button>
        <button class="endpoint" type="button" data-endpoint="${Endpoint.LeetCode}">国际站 <span>COM</span></button>
      </div>

	      <div class="login-overview">
	        <button class="primary" type="button" data-command="browserAuth">
	          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.7 20 6v5.2c0 5-3.3 8.5-8 10.1-4.7-1.6-8-5.1-8-10.1V6l8-3.3z"/><path d="m8.8 12.1 2.1 2.1 4.5-4.7"/></svg>
	          <span>在浏览器中授权登录</span>
	        </button>
	        <div class="security-note">
	          <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="10" width="13" height="10" rx="2"/><path d="M8.5 10V7a3.5 3.5 0 0 1 7 0v3"/></svg>
	          <span>安全可靠，不会获取你的密码</span>
	        </div>
	        <div class="status" role="status" aria-live="polite" data-tone="idle"></div>

	        <div class="other-divider"><span>使用其他方式登录</span></div>
	        <div class="other-methods">
	          <button class="method" type="button" data-login="LeetCode"><span class="method-account">
	            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="10" width="13" height="10" rx="2"/><path d="M8.5 10V7a3.5 3.5 0 0 1 7 0v3"/></svg>
	          </span><span>账号密码</span></button>
	          <button class="method" type="button" data-login="Cookie"><span class="method-cookie">
	            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.6 13.1a3.2 3.2 0 0 1-3.7-3.7A3.2 3.2 0 0 1 13 5.5 3.2 3.2 0 0 1 10.3 2 10 10 0 1 0 22 13.7a3.2 3.2 0 0 1-1.4-.6zM8 9.4a1.4 1.4 0 1 1 0-2.8 1.4 1.4 0 0 1 0 2.8zm-1.1 6.2a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm5.7 2a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z"/></svg>
	          </span><span>浏览器 Cookie</span></button>
	          <button class="method" type="button" data-login="GitHub"><span class="method-github">
	            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.9c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 0 1.6 1 1.6 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.2.7-1.4-2.3-.3-4.7-1.1-4.7-5a3.9 3.9 0 0 1 1-2.7c-.1-.3-.4-1.3.1-2.7 0 0 .9-.3 2.8 1a9.7 9.7 0 0 1 5.1 0c2-1.3 2.8-1 2.8-1 .6 1.4.2 2.4.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.7 5 .4.3.7 1 .7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/></svg>
	          </span><span>GitHub</span></button>
	          <button class="method" type="button" data-login="LinkedIn"><span class="method-linkedin">in</span><span>LinkedIn</span></button>
	        </div>
	      </div>

	      <form class="login-panel" hidden novalidate>
	        <div class="login-panel-header">
	          <button class="login-back" type="button" aria-label="返回登录方式">
	            <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
	          </button>
	          <h2 class="login-panel-title">登录</h2>
	          <span aria-hidden="true"></span>
	        </div>
	        <p class="login-description"></p>
	        <div class="login-fields">
	          <label class="login-field login-credential-field">
	            <span class="login-label">账号或邮箱</span>
	            <input class="login-name" type="text" autocomplete="username" spellcheck="false" maxlength="320">
	          </label>
	          <label class="login-field login-password-field">
	            <span>密码</span>
	            <input class="login-password" type="password" autocomplete="current-password" maxlength="10000">
	          </label>
	          <label class="login-field login-cookie-csrf-field" hidden>
	            <span>csrftoken</span>
	            <input class="login-cookie-csrf" type="text" autocomplete="off" spellcheck="false" maxlength="12000" placeholder="输入 csrftoken 的值">
	          </label>
	          <label class="login-field login-cookie-session-field" hidden>
	            <span>LEETCODE_SESSION</span>
	            <input class="login-cookie-session" type="text" autocomplete="off" spellcheck="false" maxlength="20000" placeholder="输入 LEETCODE_SESSION 的值">
	          </label>
	        </div>
	        <label class="login-field login-challenge-field" hidden>
	          <span>两步验证码</span>
	          <input class="login-challenge" type="text" inputmode="numeric" autocomplete="one-time-code" spellcheck="false" maxlength="32">
	        </label>
	        <div class="login-message" role="status" aria-live="polite" data-tone="idle"></div>
	        <button class="login-submit" type="submit">继续登录</button>
	      </form>
	    </section>

    <footer class="legal">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 20 6v5.2c0 5-3.3 8.5-8 9.8-4.7-1.3-8-4.8-8-9.8V6l8-3z"/><path d="m9.2 12 1.8 1.8 3.8-4"/></svg>
      <span>登录即表示你同意我们的 <a href="#" data-legal="privacy">隐私政策</a> 和 <a href="#" data-legal="terms">使用条款</a></span>
    </footer>
  </main>

	  <script nonce="${nonce}">
	    const vscode = acquireVsCodeApi();
	    let currentEndpoint = ${JSON.stringify(endpoint)};
	    const leetCodeCnEndpoint = ${JSON.stringify(Endpoint.LeetCodeCN)};
	    let activeLoginMethod = '';
	    let loginBusy = false;
	    let challengeRequestId = null;
	    let composing = false;
	    const status = document.querySelector('.status');
	    const endpointButtons = Array.from(document.querySelectorAll('[data-endpoint]'));
	    const overview = document.querySelector('.login-overview');
	    const loginPanel = document.querySelector('.login-panel');
	    const loginBack = document.querySelector('.login-back');
	    const loginTitle = document.querySelector('.login-panel-title');
	    const loginDescription = document.querySelector('.login-description');
	    const credentialFields = document.querySelector('.login-fields');
	    const credentialField = document.querySelector('.login-credential-field');
	    const loginLabel = document.querySelector('.login-label');
	    const loginName = document.querySelector('.login-name');
	    const passwordField = document.querySelector('.login-password-field');
	    const loginPassword = document.querySelector('.login-password');
	    const cookieCsrfField = document.querySelector('.login-cookie-csrf-field');
	    const loginCookieCsrf = document.querySelector('.login-cookie-csrf');
	    const cookieSessionField = document.querySelector('.login-cookie-session-field');
	    const loginCookieSession = document.querySelector('.login-cookie-session');
	    const challengeField = document.querySelector('.login-challenge-field');
	    const loginChallenge = document.querySelector('.login-challenge');
	    const loginMessage = document.querySelector('.login-message');
	    const loginSubmit = document.querySelector('.login-submit');
	    const loginConfigs = {
	      LeetCode: {
	        title: '账号密码登录',
	        description: '使用 LeetCode 中文站账号登录',
	        label: '账号或邮箱',
	        cookie: false,
	      },
	      Cookie: {
	        title: '浏览器 Cookie 登录',
	        description: '填写当前站点的 csrftoken 与 LEETCODE_SESSION',
	        cookie: true,
	      },
	      GitHub: {
	        title: 'GitHub 登录',
	        description: '通过关联的 GitHub 账号登录 LeetCode',
	        label: 'GitHub 账号或邮箱',
	        cookie: false,
	      },
	      LinkedIn: {
	        title: 'LinkedIn 登录',
	        description: '通过关联的 LinkedIn 账号登录 LeetCode',
	        label: 'LinkedIn 账号或邮箱',
	        cookie: false,
	      },
	    };

	    function renderEndpoint() {
	      endpointButtons.forEach((button) => {
	        const active = button.dataset.endpoint === currentEndpoint;
	        button.classList.toggle('is-active', active);
	        button.setAttribute('aria-pressed', String(active));
	      });
	      updateLoginAvailability();
	    }

	    function setLoginMessage(message, tone = 'idle') {
	      loginMessage.textContent = message || '';
	      loginMessage.dataset.tone = tone;
	    }

	    function setLoginBusy(busy) {
	      loginBusy = busy;
	      loginBack.disabled = busy;
	      loginName.disabled = busy;
	      loginPassword.disabled = busy;
	      loginCookieCsrf.disabled = busy;
	      loginCookieSession.disabled = busy;
	      loginChallenge.disabled = busy;
	      loginSubmit.disabled = busy;
	      if (busy) loginSubmit.textContent = '正在登录…';
	      else if (challengeRequestId !== null) loginSubmit.textContent = '验证并继续';
	      else loginSubmit.textContent = '继续登录';
	      updateLoginAvailability();
	    }

	    function updateLoginAvailability() {
	      if (loginPanel.hidden || !activeLoginMethod) return;
	      const unavailable = activeLoginMethod === 'LeetCode' && currentEndpoint !== leetCodeCnEndpoint;
	      loginSubmit.disabled = loginBusy || unavailable;
	      if (unavailable) setLoginMessage('账号密码登录仅支持中文站', 'error');
	      else if (!loginBusy && loginMessage.textContent === '账号密码登录仅支持中文站') setLoginMessage('');
	    }

	    function showCredentialFields() {
	      challengeRequestId = null;
	      credentialFields.hidden = false;
	      challengeField.hidden = true;
	      loginChallenge.value = '';
	      const config = loginConfigs[activeLoginMethod];
	      if (config) {
	        loginTitle.textContent = config.title;
	        loginDescription.textContent = config.description;
	      }
	      loginSubmit.textContent = '继续登录';
	    }

	    function openLoginPanel(method) {
	      const config = loginConfigs[method];
	      if (!config) return;
	      activeLoginMethod = method;
	      challengeRequestId = null;
	      overview.hidden = true;
	      loginPanel.hidden = false;
	      loginPanel.reset();
	      loginTitle.textContent = config.title;
	      loginDescription.textContent = config.description;
	      if (config.label) loginLabel.textContent = config.label;
	      credentialField.hidden = config.cookie;
	      passwordField.hidden = config.cookie;
	      cookieCsrfField.hidden = !config.cookie;
	      cookieSessionField.hidden = !config.cookie;
	      credentialFields.hidden = false;
	      challengeField.hidden = true;
	      setLoginMessage('');
	      setLoginBusy(false);
	      requestAnimationFrame(() => (config.cookie ? loginCookieCsrf : loginName).focus());
	    }

	    function closeLoginPanel() {
	      if (loginBusy) return;
	      if (challengeRequestId !== null) {
	        vscode.postMessage({ command: 'loginChallengeResponse', requestId: challengeRequestId, value: '' });
	      }
	      challengeRequestId = null;
	      activeLoginMethod = '';
	      loginPanel.reset();
	      loginPanel.hidden = true;
	      overview.hidden = false;
	      setLoginMessage('');
	    }

	    loginBack.addEventListener('click', closeLoginPanel);
	    loginPanel.addEventListener('compositionstart', () => { composing = true; });
	    loginPanel.addEventListener('compositionend', () => { composing = false; });
	    loginPanel.addEventListener('submit', (event) => {
	      event.preventDefault();
	      if (composing || loginBusy) return;
	      if (challengeRequestId !== null) {
	        const value = loginChallenge.value.trim();
	        if (!value) {
	          setLoginMessage('请输入两步验证码', 'error');
	          loginChallenge.focus();
	          return;
	        }
	        const requestId = challengeRequestId;
	        setLoginBusy(true);
	        setLoginMessage('正在验证…', 'waiting');
	        vscode.postMessage({ command: 'loginChallengeResponse', requestId, value });
	        return;
	      }
	      const config = loginConfigs[activeLoginMethod];
	      const login = config.cookie ? '' : loginName.value.trim();
	      const csrfToken = loginCookieCsrf.value.trim();
	      const leetcodeSession = loginCookieSession.value.trim();
	      const secret = config.cookie ? (csrfToken && leetcodeSession) : loginPassword.value;
	      if ((!config.cookie && !login) || !secret) {
	        setLoginMessage('请完整填写登录信息', 'error');
	        (!config.cookie && !login
	          ? loginName
	          : (config.cookie ? (!csrfToken ? loginCookieCsrf : loginCookieSession) : loginPassword)
	        ).focus();
	        return;
	      }
	      setLoginBusy(true);
	      setLoginMessage('正在登录…', 'waiting');
	      vscode.postMessage({
	        command: 'submitLogin',
	        method: activeLoginMethod,
	        credentials: {
	          login,
	          password: config.cookie ? '' : loginPassword.value,
	          cookie: '',
	          csrfToken: config.cookie ? csrfToken : '',
	          leetcodeSession: config.cookie ? leetcodeSession : '',
	        },
	      });
	    });

	    document.addEventListener('click', (event) => {
	      const target = event.target.closest('button, a');
      if (!target) return;
      const endpoint = target.dataset.endpoint;
      const loginMethod = target.dataset.login;
      const command = target.dataset.command;
      const legal = target.dataset.legal;
      if (endpoint) {
	        currentEndpoint = endpoint;
	        renderEndpoint();
	        vscode.postMessage({ command: 'selectEndpoint', endpoint });
	      } else if (loginMethod) {
	        openLoginPanel(loginMethod);
      } else if (command) {
        vscode.postMessage({ command });
      } else if (legal) {
        event.preventDefault();
        vscode.postMessage({ command: 'openLegal', page: legal });
      }
    });

    window.addEventListener('message', (event) => {
      const message = event.data || {};
	      if (message.command === 'endpointChanged') {
	        currentEndpoint = message.endpoint;
	        renderEndpoint();
	      } else if (message.command === 'status') {
	        status.textContent = message.message || '';
	        status.dataset.tone = message.tone || 'idle';
	      } else if (message.command === 'loginChallenge') {
	        challengeRequestId = message.requestId;
	        credentialFields.hidden = true;
	        challengeField.hidden = false;
	        loginTitle.textContent = 'GitHub 两步验证';
	        loginDescription.textContent = message.message || '请输入两步验证码';
	        setLoginMessage('');
	        setLoginBusy(false);
	        requestAnimationFrame(() => loginChallenge.focus());
	      } else if (message.command === 'loginState') {
	        const state = message.state || 'idle';
	        if (state === 'loading') {
	          setLoginBusy(true);
	          setLoginMessage(message.message || '正在登录…', 'waiting');
	        } else if (state === 'error') {
	          showCredentialFields();
	          setLoginBusy(false);
	          setLoginMessage(message.message || '登录失败，请重试', 'error');
	        } else if (state === 'success') {
	          setLoginBusy(true);
	          setLoginMessage(message.message || '登录成功', 'waiting');
	        } else {
	          setLoginBusy(false);
	          setLoginMessage(message.message || '');
	        }
	      }
	    });

	    document.addEventListener('keydown', (event) => {
	      if (event.key === 'Escape' && !loginPanel.hidden && !loginBusy) closeLoginPanel();
	    });

    renderEndpoint();
  </script>
</body>
</html>`;
  }

  private createNonce(): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let value = "";
    for (let index = 0; index < 32; index += 1) {
      value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return value;
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
