/*
 * Filename: https://github.com/ccagml/leetcode-extension/src/statusBarTime/StatusBarTimeModule.ts
 * Path: https://github.com/ccagml/leetcode-extension
 * Created Date: Wednesday, September 27th 2023, 8:26:28 pm
 * Author: ccagml
 *
 * Copyright (c) 2023 ccagml . All rights reserved
 */

import { ConfigurationChangeEvent, Disposable, StatusBarItem, ThemeColor, window, workspace } from "vscode";
import { ISubmitEvent, OutPutType } from "../model/ConstDefind";
import { ShowMessage } from "../utils/OutputUtils";
import { getDayNow } from "../utils/SystemUtils";
import { enableTimerBar } from "../utils/ConfigUtils";
import { BABAMediator, BABAProxy, BaseCC, BabaStr } from "../BABA";

type StatusBarAlertStyle = {
  backgroundColor?: ThemeColor;
  color?: ThemeColor | string;
};

// 状态栏工具
class StatusBarTimeService implements Disposable {
  private configurationChangeListener: Disposable;
  private showBar: StatusBarItem;
  private startBar: StatusBarItem;
  private stopBar: StatusBarItem;
  private resetBar: StatusBarItem;
  private startTime: number;
  private saveTime: number;
  private readonly infoAlertStyle: StatusBarAlertStyle = {
    backgroundColor: new ThemeColor("statusBarItem.prominentBackground"),
    color: new ThemeColor("statusBarItem.prominentForeground"),
  };
  private readonly errorAlertStyle: StatusBarAlertStyle = {
    backgroundColor: new ThemeColor("statusBarItem.errorBackground"),
  };
  private readonly alertThresholds = [
    { seconds: 20 * 60, style: this.infoAlertStyle },
    { seconds: 30 * 60, style: this.infoAlertStyle },
    { seconds: 40 * 60, style: this.errorAlertStyle },
  ];
  private alertedThresholds = new Set<number>();
  private alertTimeout?: ReturnType<typeof setTimeout>;

  constructor() {
    this.showBar = window.createStatusBarItem(undefined, 1004);
    this.showBar.show();

    this.startBar = window.createStatusBarItem(undefined, 1003);
    this.startBar.name = "开始计时";
    this.startBar.text = "$(play) 开始";
    this.startBar.tooltip = "开始计时";
    this.startBar.show();
    this.startBar.command = "lcpr.statusBarTime.start";

    this.stopBar = window.createStatusBarItem(undefined, 1002);
    this.stopBar.name = "暂停计时";
    this.stopBar.text = "$(debug-pause) 暂停";
    this.stopBar.tooltip = "暂停计时";
    this.stopBar.show();
    this.stopBar.command = "lcpr.statusBarTime.stop";

    this.resetBar = window.createStatusBarItem(undefined, 1001);
    this.resetBar.name = "重置计时";
    this.resetBar.text = "$(debug-restart) 重置";
    this.resetBar.tooltip = "重置计时";
    this.resetBar.show();
    this.resetBar.command = "lcpr.statusBarTime.reset";

    this.startTime = 0;
    this.saveTime = 0;

    this.configurationChangeListener = workspace.onDidChangeConfiguration((event: ConfigurationChangeEvent) => {
      if (event.affectsConfiguration("leetcode-problem-rating.enableTimerBar")) {
        this.setStatusBarVisibility();
      }
    }, this);
    this.setStatusBarVisibility();
  }

  public showProblemFinish() {
    if (enableTimerBar()) {
      this.reset();
      this.start();
    }
  }

  private getDiffStr(diff: number) {
    const totalSeconds = Math.min(99 * 3600 + 59 * 60 + 59, Math.max(0, Math.floor(diff)));
    const second = totalSeconds % 60;
    const minute = Math.floor(totalSeconds / 60) % 60;
    const hour = Math.floor(totalSeconds / 3600);
    return [hour, minute, second].map((value) => String(value).padStart(2, "0")).join(":");
  }

  private getElapsedSeconds(): number {
    return (this.startTime > 0 ? getDayNow() - this.startTime : 0) + this.saveTime;
  }

  private clearAlert(): void {
    if (this.alertTimeout) {
      clearTimeout(this.alertTimeout);
      this.alertTimeout = undefined;
    }
    this.setAlertStyle(undefined);
  }

  private setAlertStyle(style: StatusBarAlertStyle | undefined): void {
    [this.showBar, this.startBar, this.stopBar, this.resetBar].forEach((item) => {
      item.backgroundColor = style?.backgroundColor;
      item.color = style?.color;
    });
  }

  private flashAlert(style: StatusBarAlertStyle): void {
    this.clearAlert();
    this.setAlertStyle(style);
    let flashes = 0;
    const toggle = () => {
      flashes += 1;
      if (flashes >= 5) {
        this.clearAlert();
        return;
      }
      this.setAlertStyle(flashes % 2 === 0 ? style : undefined);
      this.alertTimeout = setTimeout(toggle, 400);
    };
    this.alertTimeout = setTimeout(toggle, 400);
  }

  private maybeAlert(elapsedSeconds: number): void {
    const threshold = this.alertThresholds.find(
      ({ seconds }) => elapsedSeconds >= seconds && !this.alertedThresholds.has(seconds)
    );
    if (!threshold) {
      return;
    }

    this.alertedThresholds.add(threshold.seconds);
    this.flashAlert(threshold.style);
  }

  public getCostTimeStr() {
    if (enableTimerBar()) {
      if (this.startTime && this.startTime > 0) {
        let diff = getDayNow() - this.startTime + this.saveTime;
        return this.getDiffStr(diff);
      }
    }
    return;
  }

  public async checkSubmit(e: ISubmitEvent) {
    if (e.sub_type == "submit" && e.accepted) {
      let msg = this.getCostTimeStr();
      if (msg) {
        ShowMessage(`${e.fid}耗时${msg}`, OutPutType.info);
      }
      this.stop();
    }
  }

  public start() {
    if (this.startTime <= 0) {
      this.startTime = getDayNow();
      this.flashAlert(this.infoAlertStyle);
    }
    this.update_instance();
  }
  public stop() {
    if (this.startTime > 0) {
      this.saveTime += getDayNow() - this.startTime;
      this.startTime = 0;
    }
    this.update_instance();
  }

  public reset() {
    this.clearAlert();
    this.startTime = 0;
    this.saveTime = 0;
    this.alertedThresholds.clear();
    this.update_instance();
  }

  // 更新状态栏的数据
  public update_instance(): void {
    const elapsedSeconds = this.getElapsedSeconds();
    this.showBar.text = `$(watch) ${this.getDiffStr(elapsedSeconds)}`;
    if (this.startTime > 0) {
      this.maybeAlert(elapsedSeconds);
    }
  }

  // 更新数据
  public updateSecond(): void {
    this.update_instance();
  }

  //销毁数据
  public dispose(): void {
    this.clearAlert();
    this.showBar.dispose();
    this.startBar.dispose();
    this.stopBar.dispose();
    this.resetBar.dispose();
    this.configurationChangeListener.dispose();
  }
  // 设置可见性
  private setStatusBarVisibility(): void {
    if (enableTimerBar()) {
      this.showBar.show();
      this.startBar.show();
      this.stopBar.show();
      this.resetBar.show();
    } else {
      this.showBar.hide();
      this.startBar.hide();
      this.stopBar.hide();
      this.resetBar.hide();
      this.reset();
    }
  }
}

export class StatusBarTimeProxy extends BABAProxy {
  static NAME = BabaStr.StatusBarTimeProxy;
  constructor() {
    super(StatusBarTimeProxy.NAME);
  }

  public getCostTimeStr() {
    return statusBarTimeService.getCostTimeStr();
  }
}

export class StatusBarTimeMediator extends BABAMediator {
  static NAME = BabaStr.StatusBarTimeMediator;
  constructor() {
    super(StatusBarTimeMediator.NAME);
  }

  listNotificationInterests(): string[] {
    return [
      BabaStr.every_second,
      BabaStr.submit,
      BabaStr.CommitResult_showFinish,
      BabaStr.showProblemFinish,
      BabaStr.VSCODE_DISPOST,
      BabaStr.BABACMD_statusBarTime_start,
      BabaStr.BABACMD_statusBarTime_stop,
      BabaStr.BABACMD_statusBarTime_reset,
    ];
  }
  async handleNotification(_notification: BaseCC.BaseCC.INotification) {
    switch (_notification.getName()) {
      case BabaStr.every_second:
        statusBarTimeService.updateSecond();
        break;
      case BabaStr.CommitResult_showFinish:
        statusBarTimeService.checkSubmit(_notification.getBody());
        break;
      case BabaStr.showProblemFinish:
        statusBarTimeService.showProblemFinish();
        break;
      case BabaStr.VSCODE_DISPOST:
        statusBarTimeService.dispose();
        break;
      case BabaStr.BABACMD_statusBarTime_start:
        statusBarTimeService.start();
        break;
      case BabaStr.BABACMD_statusBarTime_stop:
        statusBarTimeService.stop();
        break;
      case BabaStr.BABACMD_statusBarTime_reset:
        statusBarTimeService.reset();
        break;
      default:
        break;
    }
  }
}

export const statusBarTimeService: StatusBarTimeService = new StatusBarTimeService();
