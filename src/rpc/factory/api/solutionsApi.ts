// @ts-nocheck
import * as ReplyUtils_1 from "../../utils/ReplyUtils";
import * as sessionUtils_1 from "../../utils/sessionUtils";
import * as apiBase_1 from "../apiBase";
import * as chainManager_1 from "../../actionChain/chainManager";

class SolutionsApi extends apiBase_1.ApiBase {
    constructor() {
        super();
    }
    callArg(argv) {
        let argv_config = this.api_argv()
            .option("d", {
            alias: "detail",
            type: "string",
            default: "",
            describe: "Solution article slug to show",
        })
            .option("s", {
            alias: "skip",
            type: "string",
            default: "0",
            describe: "Number of solution articles to skip",
        })
            .option("n", {
            alias: "first",
            type: "string",
            default: "20",
            describe: "Number of solution articles to load",
        })
            .option("l", {
            alias: "lang",
            type: "string",
            default: "",
            describe: "Solution article language tag",
        })
            .positional("keyword", {
            type: "string",
            default: "",
            describe: "Question name or id",
        });
        argv_config.parseArgFromCmd(argv);
        return argv_config.get_result();
    }
    fetchProblem(keyword, cb) {
        if (!keyword) {
            return cb("missing problem id");
        }
        chainManager_1.chainMgr.getChainHead().getProblem(keyword, true, cb);
    }
    problemPayload(problem) {
        return {
            id: problem.id,
            fid: problem.fid,
            name: problem.name,
            slug: problem.slug,
        };
    }
    call(argv) {
        sessionUtils_1.sessionUtils.argv = argv;
        this.fetchProblem(argv.keyword, (e, problem) => {
            if (e) {
                return ReplyUtils_1.reply.info(JSON.stringify({ code: 102, error: e.msg || e }));
            }
            if (argv.detail) {
                return chainManager_1.chainMgr.getChainHead().getSolutionArticle(problem, argv.detail, (detailError, article) => {
                    if (detailError) {
                        return ReplyUtils_1.reply.info(JSON.stringify({ code: 103, error: detailError.msg || detailError }));
                    }
                    return ReplyUtils_1.reply.info(JSON.stringify({ code: 100, problem: this.problemPayload(problem), article }));
                });
            }
            const options = {
                skip: Number(argv.skip || 0) || 0,
                first: Number(argv.first || 20) || 20,
                orderBy: "DEFAULT",
                lang: String(argv.lang || "").trim(),
            };
            return chainManager_1.chainMgr.getChainHead().getSolutionArticles(problem, options, (listError, result) => {
                if (listError) {
                    return ReplyUtils_1.reply.info(JSON.stringify({ code: 103, error: listError.msg || listError }));
                }
                return ReplyUtils_1.reply.info(JSON.stringify({
                    code: 100,
                    problem: this.problemPayload(problem),
                    articles: (result && result.articles) || [],
                    total: (result && result.total) || 0,
                    skip: (result && result.skip) || options.skip,
                    first: (result && result.first) || options.first,
                }));
            });
        });
    }
}

export const solutionsApi = new SolutionsApi();
