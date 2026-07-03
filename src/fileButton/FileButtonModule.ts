/*
 * Filename: https://github.com/ccagml/leetcode-extension/src/fileButton/FileButtonModule.ts
 * Path: https://github.com/ccagml/leetcode-extension
 * Created Date: Friday, October 13th 2023, 10:35:28 am
 * Author: ccagml
 *
 * Copyright (c) 2023 ccagml . All rights reserved
 */

import * as vscode from "vscode";
import { BABA, BABAMediator, BABAProxy, BabaStr, BaseCC } from "../BABA";
import { isStarShortcut } from "../utils/ConfigUtils";

export class FileButtonService implements vscode.CodeLensProvider {
  private onDidChangeCodeLensesEmitter: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();

  get onDidChangeCodeLenses(): vscode.Event<void> {
    return this.onDidChangeCodeLensesEmitter.event;
  }

  public fire(): void {
    this.onDidChangeCodeLensesEmitter.fire();
  }

  public provideCodeLenses(_document: vscode.TextDocument): vscode.ProviderResult<vscode.CodeLens[]> {
    return [];
  }
}

export const fileButtonService: FileButtonService = new FileButtonService();

class FileButtonConfigChange implements vscode.Disposable {
  private registeredProvider: vscode.Disposable | undefined;
  private configurationChangeListener: vscode.Disposable;

  constructor() {
    this.configurationChangeListener = vscode.workspace.onDidChangeConfiguration(
      (event: vscode.ConfigurationChangeEvent) => {
        if (event.affectsConfiguration("leetcode-problem-rating.editor.shortcuts")) {
          BABA.sendNotification(BabaStr.FileButton_ConfigChange);
        }
      },
      this
    );

    this.registeredProvider = vscode.languages.registerCodeLensProvider({ scheme: "file" }, fileButtonService);
  }

  public dispose(): void {
    if (this.registeredProvider) {
      this.registeredProvider.dispose();
    }
    this.configurationChangeListener.dispose();
  }
}

export const fileButtonConfigChange: FileButtonConfigChange = new FileButtonConfigChange();

export class FileButtonProxy extends BABAProxy {
  static NAME = BabaStr.FileButtonProxy;
  constructor() {
    super(FileButtonProxy.NAME);
  }
}

export class FileButtonMediator extends BABAMediator {
  static NAME = BabaStr.FileButtonMediator;
  constructor() {
    super(FileButtonMediator.NAME);
  }

  listNotificationInterests(): string[] {
    return [BabaStr.VSCODE_DISPOST, BabaStr.FileButton_ConfigChange, BabaStr.TreeData_favoriteChange];
  }
  async handleNotification(_notification: BaseCC.BaseCC.INotification) {
    switch (_notification.getName()) {
      case BabaStr.VSCODE_DISPOST:
        fileButtonConfigChange.dispose();
        break;

      case BabaStr.TreeData_favoriteChange:
        if (isStarShortcut()) {
          fileButtonService.fire();
        }
        break;
      case BabaStr.FileButton_ConfigChange:
        fileButtonService.fire();
        break;
      default:
        break;
    }
  }
}
