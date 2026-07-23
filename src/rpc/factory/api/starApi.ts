/*
 * https://github.com/ccagml/leetcode-extension/src/rpc/factory/api/starApi.ts
 * Path: https://github.com/ccagml/leetcode-extension
 * Created Date: Thursday, November 17th 2022, 11:44:14 am
 * Author: ccagml
 *
 * Copyright (c) 2022 ccagml . All rights reserved.
 */

import { reply } from "../../utils/ReplyUtils";

import { sessionUtils } from "../../utils/sessionUtils";
import { ApiBase } from "../apiBase";
import { chainMgr } from "../../actionChain/chainManager";

class StarApi extends ApiBase {
  constructor() {
    super();
  }

  callArg(argv) {
    let argv_config = this.api_argv()
      .option("d", {
        alias: "delete",
        type: "boolean",
        describe: "Unstar question",
        default: false,
      })
      .positional("keyword", {
        type: "string",
        describe: "Question name or id",
        default: "",
      });

    argv_config.parseArgFromCmd(argv);

    return argv_config.get_result();
  }

  call(argv) {
    sessionUtils.argv = argv;
    // translation doesn't affect question lookup
    chainMgr.getChainHead().getProblem(argv.keyword, true, function (e, problem) {
      if (e) return reply.info(JSON.stringify({ code: -1, msg: e.msg || e }));

      chainMgr.getChainHead().starProblem(problem, !argv.delete, function (e, flag) {
        if (e) return reply.info(JSON.stringify({ code: -2, msg: e.msg || e }));
        chainMgr.getChainHead().updateProblem(problem, { starred: flag });
        reply.info(
          JSON.stringify({
            code: 100,
            fid: problem.fid,
            qid: problem.id,
            name: problem.name,
            starred: flag,
            icon: flag ? "icon.like" : "icon.unlike",
          })
        );
      });
    });
  }
}

export const starApi: StarApi = new StarApi();
