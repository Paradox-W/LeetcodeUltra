// @ts-nocheck
/*
 * https://github.com/ccagml/leetcode-extension/src/rpc/factory/api/submitApi.ts
 * Path: https://github.com/ccagml/leetcode-extension
 * Created Date: Thursday, November 17th 2022, 11:44:14 am
 * Author: ccagml
 *
 * Copyright (c) 2022 ccagml . All rights reserved.
 */
let util = require("util");
let lodash = require("lodash");
import * as storageUtils_1 from "../../utils/storageUtils";
import * as ReplyUtils_1 from "../../utils/ReplyUtils";
import * as sessionUtils_1 from "../../utils/sessionUtils";
import * as apiBase_1 from "../apiBase";
import * as chainManager_1 from "../../actionChain/chainManager";
class SubmitApi extends apiBase_1.ApiBase {
    constructor() {
        super();
    }
    callArg(argv) {
        let argv_config = this.api_argv().positional("filename", {
            type: "string",
            describe: "Code file to submit",
            default: "",
        });
        argv_config.parseArgFromCmd(argv);
        return argv_config.get_result();
    }
    printResult(actual, k, log_obj) {
        if (!actual.hasOwnProperty(k))
            return;
        const v = actual[k] || "";
        const lines = Array.isArray(v) ? v : [v];
        for (let line of lines) {
            if (k !== "state") {
                if (!log_obj.hasOwnProperty(lodash.startCase(k))) {
                    log_obj[lodash.startCase(k)] = [line];
                }
                else {
                    log_obj[lodash.startCase(k)].push(line);
                }
            }
            else {
                log_obj.messages.push(line);
            }
        }
    }
    printLine(log_obj, ...ret) {
        const args = ret.slice(1);
        const line = util.format.apply(util, args);
        log_obj.messages.push(line);
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
    parseRuntimeMs(value) {
        const number = this.parseFirstNumber(value);
        if (number === undefined) {
            return undefined;
        }
        const text = String(value || "").toLowerCase();
        if (/\bs\b/.test(text) && !/ms\b/.test(text)) {
            return number * 1000;
        }
        return number;
    }
    parseMemoryKb(value) {
        const number = this.parseFirstNumber(value);
        if (number === undefined) {
            return undefined;
        }
        const text = String(value || "").toLowerCase();
        if (/\bmb\b/.test(text)) {
            return number * 1024;
        }
        if (/\bgb\b/.test(text)) {
            return number * 1024 * 1024;
        }
        return number;
    }
    parseDistributionSource(raw) {
        if (!raw) {
            return [];
        }
        let value = raw;
        if (typeof value === "string") {
            try {
                value = JSON.parse(value);
            }
            catch (_) {
                return [];
            }
        }
        if (Array.isArray(value)) {
            return value;
        }
        if (value && Array.isArray(value.distribution)) {
            return value.distribution;
        }
        if (value && typeof value === "object") {
            return Object.keys(value).map((key) => [key, value[key]]);
        }
        return [];
    }
    ownValue(item, names) {
        for (const name of names) {
            if (Object.prototype.hasOwnProperty.call(item, name) && item[name] !== undefined && item[name] !== null) {
                return item[name];
            }
        }
        return undefined;
    }
    normalizeDistribution(raw, valueParser) {
        const parseValue = valueParser || ((value) => this.parseFirstNumber(value));
        return this.parseDistributionSource(raw)
            .map((item) => {
            let value;
            let weight;
            if (Array.isArray(item)) {
                value = parseValue(item[0]);
                weight = this.parseFirstNumber(item[1]);
            }
            else if (item && typeof item === "object") {
                value = parseValue(this.ownValue(item, ["displayed_value", "displayedValue", "value", "runtime", "memory", "x", 0]));
                weight = this.parseFirstNumber(this.ownValue(item, ["percent", "percentage", "weight", "count", "y", 1]));
            }
            if (value === undefined || weight === undefined) {
                return undefined;
            }
            return { value, weight };
        })
            .filter((item) => item && Number.isFinite(item.value) && Number.isFinite(item.weight))
            .sort((a, b) => a.value - b.value);
    }
    buildPerformanceCharts(result, detail) {
        const runtimeDisplay = result.runtime || (detail && detail.runtime) || "";
        const memoryDisplay = result.memory || (detail && detail.memory) || "";
        const runtimeDistribution = this.normalizeDistribution(detail && (detail.runtimeDistribution || detail.distributionChart), (value) => this.parseRuntimeMs(value));
        const memoryDistribution = this.normalizeDistribution(detail && detail.memoryDistribution, (value) => this.parseMemoryKb(value));
        const source = runtimeDistribution.length || memoryDistribution.length
            ? ((detail && detail.source) || "officialSubmissionDetails")
            : "percentileOnly";
        return {
            source,
            runtime: {
                display: runtimeDisplay,
                value: this.parseRuntimeMs(runtimeDisplay),
                unit: "ms",
                percentile: result.runtime_percentile !== undefined && result.runtime_percentile !== null ? result.runtime_percentile : "",
                distribution: runtimeDistribution,
            },
            memory: {
                display: memoryDisplay,
                value: this.parseMemoryKb(memoryDisplay),
                unit: "KB",
                percentile: result.memory_percentile !== undefined && result.memory_percentile !== null ? result.memory_percentile : "",
                distribution: memoryDistribution,
            },
        };
    }
    attachPerformanceCharts(result, log_obj, done) {
        const submissionId = result.submission_id || result.id || "";
        const finish = (detail) => {
            log_obj.system_message.performance_charts = this.buildPerformanceCharts(result, detail);
            done();
        };
        if (!submissionId) {
            finish(undefined);
            return;
        }
        const chain = chainManager_1.chainMgr.getChainHead();
        const getter = chain && (chain.getSubmissionPerformance || chain.getSubmission);
        if (typeof getter !== "function") {
            finish(undefined);
            return;
        }
        getter.call(chain, { id: submissionId, submission_id: submissionId }, (e, detail) => {
            finish(e ? undefined : detail);
        });
    }
    call(argv) {
        sessionUtils_1.sessionUtils.argv = argv;
        if (!storageUtils_1.storageUtils.exist(argv.filename))
            return ReplyUtils_1.reply.fatal("File " + argv.filename + " not exist!");
        const meta = storageUtils_1.storageUtils.meta(argv.filename);
        let that = this;
        // translation doesn't affect problem lookup
        chainManager_1.chainMgr.getChainHead().getProblem(meta, true, function (e, problem) {
            if (e)
                return ReplyUtils_1.reply.info(e);
            problem.file = argv.filename;
            problem.lang = meta.lang;
            chainManager_1.chainMgr.getChainHead().submitProblem(problem, function (e, results) {
                if (e)
                    return ReplyUtils_1.reply.info(e);
                const result = results[0];
                let log_obj = {};
                log_obj.messages = [];
                log_obj.system_message = {};
                log_obj.system_message.fid = problem.fid;
                log_obj.system_message.id = problem.id;
                log_obj.system_message.qid = problem.id;
                log_obj.system_message.sub_type = "submit";
                log_obj.system_message.accepted = false;
                log_obj.system_message.status = result.state;
                log_obj.system_message.passed = result.passed;
                log_obj.system_message.total = result.total;
                log_obj.system_message.runtime = result.runtime;
                log_obj.system_message.memory = result.memory;
                log_obj.system_message.lang = result.lang;
                log_obj.system_message.runtime_percentile = result.runtime_percentile;
                log_obj.system_message.memory_percentile = result.memory_percentile;
				log_obj.system_message.submission_id = result.submission_id || result.id || "";
				log_obj.system_message.submittedAt = new Date().toISOString();
                that.printResult(result, "state", log_obj);
                that.printLine(log_obj, result, "%d/%d cases passed (%s)", result.passed, result.total, result.runtime);
                const finish = () => {
                    ReplyUtils_1.reply.info(JSON.stringify(log_obj));
                    chainManager_1.chainMgr.getChainHead().updateProblem(problem, {
                        state: result.ok ? "ac" : "notac",
                    });
                };
                if (result.ok) {
                    sessionUtils_1.sessionUtils.updateStat("ac", 1);
                    sessionUtils_1.sessionUtils.updateStat("ac.set", problem.fid);
                    log_obj.system_message.accepted = true;
                    (function () {
                        if (result.runtime_percentile)
                            that.printLine(log_obj, result, "Your runtime beats %d %% of %s submissions", result.runtime_percentile.toFixed(2), result.lang);
                        if (result.memory && result.memory_percentile)
                            that.printLine(log_obj, result, "Your memory usage beats %d %% of %s submissions (%s)", result.memory_percentile.toFixed(2), result.lang, result.memory);
                    })();
                    that.attachPerformanceCharts(result, log_obj, finish);
                    return;
                }
                else {
                    result.testcase = result.testcase.slice(1, -1).replace(/\\n/g, "\n");
                    that.printResult(result, "error", log_obj);
                    that.printResult(result, "testcase", log_obj);
                    that.printResult(result, "answer", log_obj);
                    that.printResult(result, "expected_answer", log_obj);
                    that.printResult(result, "stdout", log_obj);
                }
                finish();
            });
        });
    }
}
export const submitApi = new SubmitApi();
