/*
 * Filename: https://github.com/ccagml/leetcode-extension/src/utils/OutputUtils.ts
 * Path: https://github.com/ccagml/leetcode-extension
 * Created Date: Thursday, October 27th 2022, 7:43:29 pm
 * Author: ccagml
 *
 * Copyright (c) 2022 ccagml . All rights reserved.
 */

import * as vscode from "vscode";
import { BABA, BabaStr } from "../BABA";
import { DialogOptions, OutPutType } from "../model/ConstDefind";
import { getVsCodeConfig } from "./ConfigUtils";

export async function openUrl(url: string): Promise<void> {
  vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(url));
}

export async function promptHintMessage(
  config: string,
  message: string,
  choiceConfirm: string,
  _onConfirm: () => Promise<any>
): Promise<void> {
  if (getVsCodeConfig().get<boolean>(config)) {
    appendLogMessage(`${message} ${choiceConfirm ? `(${choiceConfirm})` : ""}`.trim(), OutPutType.info);
  }
}

export async function promptForSignIn(): Promise<void> {
  await vscode.commands.executeCommand("lcpr.signin");
}

export async function ShowMessage(message: string, type: OutPutType): Promise<void> {
  let result: vscode.MessageItem | undefined;
  switch (type) {
    case OutPutType.info:
      appendLogMessage(message, type);
      break;
    case OutPutType.warning:
      appendLogMessage(message, type);
      break;
    case OutPutType.error:
      result = await vscode.window.showErrorMessage(message, DialogOptions.open, DialogOptions.no);
      break;
    default:
      break;
  }

  if (result === DialogOptions.open) {
    BABA.getProxy(BabaStr.LogOutputProxy).get_log().show();
  }
}

function appendLogMessage(message: string, type: OutPutType): void {
  try {
    BABA.getProxy(BabaStr.LogOutputProxy).get_log().appendLine(`[${type}] ${message}`);
  } catch (_) {
    // Logging is best-effort; non-error notices should not interrupt the user.
  }
}
