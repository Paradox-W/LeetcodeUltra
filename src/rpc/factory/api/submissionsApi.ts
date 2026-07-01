// @ts-nocheck
import * as ReplyUtils_1 from "../../utils/ReplyUtils";
import * as sessionUtils_1 from "../../utils/sessionUtils";
import * as apiBase_1 from "../apiBase";
import * as chainManager_1 from "../../actionChain/chainManager";
import * as submitApi_1 from "./submitApi";
class SubmissionsApi extends apiBase_1.ApiBase {
    constructor() {
        super();
    }
    callArg(argv) {
        let argv_config = this.api_argv()
            .option("d", {
            alias: "detail",
            type: "string",
            default: "",
            describe: "Submission id to show",
        })
            .positional("keyword", {
            type: "string",
            default: "",
            describe: "Question name or id",
        });
        argv_config.parseArgFromCmd(argv);
        return argv_config.get_result();
    }
    isAccepted(status) {
        return /^(accepted|accept|ac|通过)$/i.test(String(status || "").trim());
    }
    normalizeStatus(submission) {
        return submission.status_display || submission.statusDisplay || submission.status || submission.state || "";
    }
    normalizeTime(submission) {
        const value = submission.timestamp || submission.created_at || submission.createdAt || submission.time || "";
        const number = Number(value);
        if (Number.isFinite(number) && number > 0) {
            return number > 100000000000 ? number : number * 1000;
        }
        return value;
    }
    normalizeListItem(submission, index) {
        const status = this.normalizeStatus(submission);
        const id = String(submission.id || submission.submission_id || submission.submissionId || "");
        return {
            id,
            index: index + 1,
            status,
            accepted: this.isAccepted(status),
            lang: submission.langName || submission.lang_name || submission.lang || "",
            runtime: submission.runtime || submission.status_runtime || submission.statusRuntime || "",
            memory: submission.memory || submission.status_memory || submission.statusMemory || "",
            timestamp: this.normalizeTime(submission),
            timeDisplay: submission.time || submission.timeDisplay || submission.created_at || "",
            url: submission.url || "",
        };
    }
    parseFirstNumber(value) {
        if (typeof value === "number") {
            return Number.isFinite(value) ? value : undefined;
        }
        const match = String(value || "").match(/-?\d+(?:\.\d+)?/);
        if (!match) {
            return undefined;
        }
        const number = Number(match[0]);
        return Number.isFinite(number) ? number : undefined;
    }
    normalizeDetail(submission, detail) {
        const merged = Object.assign({}, submission || {}, detail || {});
        const status = this.normalizeStatus(merged);
        const runtime = merged.runtime || merged.status_runtime || merged.statusRuntime || "";
        const memory = merged.memory || merged.status_memory || merged.statusMemory || "";
        const resultForCharts = {
            runtime,
            memory,
            runtime_percentile: merged.runtime_percentile || merged.runtimePercentile || "",
            memory_percentile: merged.memory_percentile || merged.memoryPercentile || "",
        };
        return {
            id: String(merged.id || merged.submission_id || merged.submissionId || ""),
            status,
            accepted: this.isAccepted(status),
            lang: merged.langVerboseName || merged.langName || merged.lang_name || merged.lang || "",
            runtime,
            memory,
            runtimePercentile: resultForCharts.runtime_percentile,
            memoryPercentile: resultForCharts.memory_percentile,
            passed: this.parseFirstNumber(merged.total_correct || merged.passed),
            total: this.parseFirstNumber(merged.total_testcases || merged.total),
            timestamp: this.normalizeTime(merged),
            timeDisplay: merged.time || merged.timeDisplay || merged.created_at || "",
            code: merged.code || merged.submissionCode || "",
            source: merged.source || "",
            performanceCharts: submitApi_1.submitApi.buildPerformanceCharts(resultForCharts, detail),
        };
    }
    fetchProblem(keyword, cb) {
        if (!keyword) {
            return cb("missing problem id");
        }
        chainManager_1.chainMgr.getChainHead().getProblem(keyword, true, cb);
    }
    fetchList(problem, cb) {
        chainManager_1.chainMgr.getChainHead().getSubmissions(problem, (e, submissions) => {
            if (e) {
                return cb(e);
            }
            return cb(null, (submissions || []).map((submission, index) => this.normalizeListItem(submission, index)));
        });
    }
    fetchDetail(problem, submissionId, cb) {
        chainManager_1.chainMgr.getChainHead().getSubmissions(problem, (e, submissions) => {
            if (e) {
                return cb(e);
            }
            const list = submissions || [];
            const submission = list.find((item) => String(item.id || item.submission_id || item.submissionId || "") === String(submissionId)) || { id: submissionId };
            const finish = (detail) => cb(null, this.normalizeDetail(submission, detail));
            chainManager_1.chainMgr.getChainHead().getSubmissionPerformance({ id: submissionId, submission_id: submissionId }, (perfError, perfDetail) => {
                chainManager_1.chainMgr.getChainHead().getSubmission({ id: submissionId }, (codeError, codeDetail) => {
                    if (perfError && codeError) {
                        return cb(perfError || codeError);
                    }
                    finish(Object.assign({}, perfDetail || {}, codeDetail || {}));
                });
            });
        });
    }
    call(argv) {
        sessionUtils_1.sessionUtils.argv = argv;
        this.fetchProblem(argv.keyword, (e, problem) => {
            if (e) {
                return ReplyUtils_1.reply.info(JSON.stringify({ code: 102, error: e.msg || e }));
            }
            if (argv.detail) {
                return this.fetchDetail(problem, argv.detail, (detailError, detail) => {
                    if (detailError) {
                        return ReplyUtils_1.reply.info(JSON.stringify({ code: 103, error: detailError.msg || detailError }));
                    }
                    return ReplyUtils_1.reply.info(JSON.stringify({ code: 100, problem: { id: problem.id, fid: problem.fid, name: problem.name, slug: problem.slug }, detail }));
                });
            }
            return this.fetchList(problem, (listError, submissions) => {
                if (listError) {
                    return ReplyUtils_1.reply.info(JSON.stringify({ code: 103, error: listError.msg || listError }));
                }
                return ReplyUtils_1.reply.info(JSON.stringify({ code: 100, problem: { id: problem.id, fid: problem.fid, name: problem.name, slug: problem.slug }, submissions }));
            });
        });
    }
}
export const submissionsApi = new SubmissionsApi();
