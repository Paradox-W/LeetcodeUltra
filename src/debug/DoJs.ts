import * as vscode from "vscode";
import * as fse from "fs-extra";
import { fileMeta, getEntryFile, IProblemType } from "../utils/problemUtils";

import { ShowMessage } from "../utils/OutputUtils";
import { OutPutType } from "../model/ConstDefind";
import { debugArgDao } from "../dao/debugArgDao";

export class DebugJs {
  static DEBUG_LANG = "javascript";
  private getProblemFunName(language: string, problemType: IProblemType): string {
    if (problemType.specialFunName && problemType.specialFunName[language]) {
      return problemType.specialFunName[language];
    }
    return problemType.funName;
  }

  public async execute(
    document: vscode.TextDocument,
    filePath: string,
    testString: string,
    language: string,
    port: number
  ): Promise<string | undefined> {
    if (language != DebugJs.DEBUG_LANG) {
      return;
    }

    let debugConfig = {
      type: "node",
      program: "",
    };
    const fileContent: Buffer = await fse.readFile(filePath);
    const meta: { id: string; lang: string } | null = fileMeta(fileContent.toString(), filePath);
    if (meta == null) {
      ShowMessage(
        "无法识别当前力扣题目元信息。",
        OutPutType.error
      );
      return;
    }
    const problemType: IProblemType | undefined = debugArgDao.getDebugArgData(meta.id, document);
    if (problemType == undefined) {
      ShowMessage(`Notsupported problem: ${meta.id}.`, OutPutType.error);
      return;
    }

    debugConfig.program = await getEntryFile(meta.lang, meta.id);

    const funName: string = this.getProblemFunName(language, problemType);

    // check whether module.exports is exist or not
    const moduleExportsReg: RegExp = new RegExp(`module.exports = ${problemType.funName};`);
    if (!moduleExportsReg.test(fileContent.toString())) {
      fse.writeFile(
        filePath,
        fileContent.toString() + `\n// @lcpr-after-debug-begin\nmodule.exports = ${funName};\n// @lcpr-after-debug-end`
      );
    }

    const args: string[] = [
      filePath,
      testString,
      problemType.funName,
      problemType.paramTypes.join(","),
      problemType.returnType || "returnType",
      meta.id,
      port.toString(),
    ];
    if (vscode.debug.activeDebugSession) {
      return;
    }
    vscode.debug.startDebugging(
      undefined,
      Object.assign({}, debugConfig, {
        request: "launch",
        name: "Launch Program",
        args,
      })
    );
    return;
  }
}
