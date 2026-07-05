import * as path from "path";
import * as vscode from "vscode";

interface ArgMeta {
  type: string;
  name: string;
}

interface FunctionMeta {
  name: string;
  args: ArgMeta[];
  type: string;
}

interface ClassMeta {
  name: string;
  functions: FunctionMeta[];
  isDesignProblem: boolean;
  isInteractiveProblem: boolean;
}

class CodeIndentHelper {
  private count = 0;
  private readonly codes: string[] = [""];

  constructor(private readonly indent = "    ") {}

  public line(code = ""): this {
    let prefix = "";
    for (let index = 0; index < this.count; index++) {
      prefix += this.indent;
    }
    this.codes.push(prefix + code);
    return this;
  }

  public right(): this {
    this.count++;
    return this;
  }

  public left(): this {
    this.count = Math.max(0, this.count - 1);
    return this;
  }

  public append(code: string): this {
    this.codes[this.codes.length - 1] += code;
    return this;
  }

  public str(): string {
    return this.codes.join("\n");
  }
}

function splitArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index <= args.length; index++) {
    if (index >= args.length || (args[index] === "," && depth === 0)) {
      parts.push(args.slice(start, index));
      start = index + 1;
      continue;
    }
    if (args[index] === "<") {
      depth++;
    } else if (args[index] === ">") {
      depth--;
    }
  }
  return parts.map((part) => part.trim()).filter(Boolean);
}

function getArgMetaInfo(arg: string): ArgMeta {
  const match = / *([\w\d<>, :*]+[&* ]+)([\w\d]+) */.exec(arg);
  if (!match) {
    throw new Error(`Can not get meta info from ${arg}.`);
  }
  return { type: match[1].replace("&", "").trim(), name: match[2].trim() };
}

export function leetcodeCppDebuggerResourcesDir(): string {
  const relative = path.join("vendor", "leetcode-cpp-debugger", "resources", "code", "cpp");
  const candidates = [
    path.resolve(__dirname, "..", "..", "..", relative),
    path.resolve(__dirname, "..", "..", relative),
  ];
  return candidates[0];
}

export class LeetCodeCppHarnessGenerator {
  private readonly io = "leetcode-io.h";

  constructor(private readonly codeTemplate: string) {}

  public getMetaInfo(code = this.codeTemplate): ClassMeta {
    const meta: ClassMeta = {
      name: "",
      functions: [],
      isDesignProblem: false,
      isInteractiveProblem: false,
    };
    const classPattern = /class +(Solution|[\w\d]+) *{?/;
    const initPattern = / *([\w\d]+) *\(((?:[, ]*[\w\d<>, :*]+[ &*]+[\w\d]+)*)\)[ {]*/;
    const funcPattern = / *([\w\d<>, :*]+) +([\w\d]+) *\(((?:[, ]*[\w\d<>, :*]+[ &*]+[\w\d]+)*)\)[ {]*/;

    const normalize = (type: string, name: string, args: string): FunctionMeta => ({
      name,
      args: args.replace(" ", "").length > 0 ? splitArgs(args).map(getArgMetaInfo) : [],
      type,
    });

    const getFuncMetaInfo = (line: string): FunctionMeta | undefined => {
      const eol = line.lastIndexOf(";");
      if (eol >= 0 && eol > line.lastIndexOf("}")) {
        return undefined;
      }
      if (meta.name.length > 0) {
        const initMatch = initPattern.exec(line);
        if (initMatch && initMatch[1] === meta.name) {
          return normalize("void", initMatch[1].trim(), initMatch[2]);
        }
      }
      const match = funcPattern.exec(line);
      if (!match || match[1].trim().length <= 0) {
        return undefined;
      }
      return normalize(match[1].trim(), match[2].trim(), match[3]);
    };

    for (const line of code.split("\n")) {
      const classMatch = classPattern.exec(line);
      if (classMatch) {
        meta.name = classMatch[1];
        meta.functions = [];
        meta.isDesignProblem = meta.name !== "Solution";
        continue;
      }
      if (meta.name.length > 0) {
        const func = getFuncMetaInfo(line);
        if (func) {
          meta.functions.push(func);
        }
      }
    }
    return meta;
  }

  public async genStubCode(solution: string): Promise<string | undefined> {
    const meta = this.getMetaInfo();
    if (meta.name.length <= 0) {
      throw new Error("Invalid meta info.");
    }
    if (meta.isInteractiveProblem) {
      throw new Error("Unsupported problem type.");
    }
    if (meta.functions.length <= 0) {
      throw new Error("Can not find the entry function.");
    }

    const genArgsCode = (func: FunctionMeta) => func.args.map((arg) => arg.name).join(", ");
    const genInputCode = (func: FunctionMeta, helper: CodeIndentHelper) => {
      if (func.args.length <= 0) {
        return;
      }
      const tupleCode: string[] = [];
      for (const arg of func.args) {
        helper.line(`${arg.type} ${arg.name};`);
        tupleCode.push(`${arg.type}&`);
      }
      const tupleName = "__tuple__value";
      helper.line(`std::tuple<${tupleCode.join(", ")}> ${tupleName} { ${genArgsCode(func)} };`);
      helper.line(`conv::FromJson(${tupleName}, in);`);
    };

    const code = new CodeIndentHelper();
    code.append("#ifndef LEETCODE_HANDLER")
      .line("#define LEETCODE_HANDLER")
      .line()
      .line(`#include "${solution}"`)
      .line(`#include "${this.io}"`)
      .line()
      .line("namespace lc {")
      .line()
      .line("class Handler {")
      .line("public:").right()
      .line(`static std::string GetClassName() { return "${meta.name}"; } `)
      .line("Handler(const json::Json& in) {").right();

    if (!meta.isDesignProblem) {
      code.line(`solution_ = new ${meta.name}();`);
    } else {
      const ctor = meta.functions.find((value) => value.name === meta.name && value.type === "void");
      if (ctor && ctor.args.length > 0) {
        genInputCode(ctor, code);
        code.line(`solution_ = new ${meta.name}(${genArgsCode(ctor)});`);
      } else {
        code.line(`solution_ = new ${meta.name}();`);
      }
    }

    code.left().line("}")
      .line("~Handler() { delete solution_; }");

    if (!meta.isDesignProblem) {
      const candidates = meta.functions.map((func) => ({
        label: `> ${func.name}(${func.args.map((arg) => arg.type).join(", ")}) => ${func.type}`,
        value: func,
      }));
      if (candidates.length < 1) {
        throw new Error(`Can not find entry function in class [${meta.name}].`);
      }
      let func = candidates[0].value;
      if (candidates.length > 1) {
        const choice = await vscode.window.showQuickPick(candidates, {
          placeHolder: "Please choose the entry function. (Press ESC to cancel)",
          ignoreFocusOut: true,
        });
        if (!choice) {
          return undefined;
        }
        func = choice.value;
      }
      code.line("json::Json Handle(const json::Json& in, const std::string& fname) { return json::Create<json::JNull>(); }");
      code.line("void Handle(io::SI& in, io::MO& out) {").right();
      for (const arg of func.args) {
        code.line(`${arg.type} ${arg.name};`)
          .line(`in >> ${arg.name};`);
      }
      code.line("#ifdef LAZY_INTERACTION")
        .line("in.Input(LAZY_INTERACTION);")
        .line("#endif");
      if (func.type !== "void") {
        code.line(`out << solution_->${func.name}(${genArgsCode(func)}) << std::endl;`);
      } else {
        code.line(`solution_->${func.name}(${genArgsCode(func)});`);
        for (const arg of func.args) {
          code.line(`out << ${arg.name} << std::endl;`);
        }
      }
      code.left().line("}");
    } else {
      code.line("void Handle(io::SI& in, io::MO& out) {}");
      code.line("json::Json Handle(const json::Json& in, const std::string& fname) {").right()
        .line(`if (fname == "") throw std::string("Empty function name.");`)
        .line("#define CASE(func) else if (fname == #func)");
      for (const func of meta.functions) {
        if (func.name === meta.name) {
          continue;
        }
        code.line(`CASE (${func.name}) {`).right();
        genInputCode(func, code);
        const callCode = `solution_->${func.name}(${genArgsCode(func)})`;
        if (func.type === "void") {
          code.line(`${callCode};`)
            .line("return json::Create<json::JNull>();");
        } else {
          code.line(`return conv::ToJson(${callCode});`);
        }
        code.left().line("}");
      }
      code.line("#undef CASE")
        .line(`throw std::string("Invalid function name.");`)
        .line("return json::Create<json::JNull>();")
        .left().line("}");
    }

    code.line().left().line("private:").right()
      .line(`${meta.name}* solution_;`)
      .left().line("};")
      .line()
      .line("} // namespace lc")
      .line();
    if (meta.isDesignProblem) {
      code.line("#define SYSTEM_DESIGN");
    }
    code.line("#endif // LEETCODE_HANDLER");
    return code.str();
  }
}
