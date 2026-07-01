// @ts-nocheck
/*
 * https://github.com/ccagml/leetcode-extension/src/rpc/actionChain/leetcode.ts
 * Path: https://github.com/ccagml/leetcode-extension
 * Created Date: Monday, November 14th 2022, 4:04:31 pm
 * Author: ccagml
 *
 * Copyright (c) 2022 ccagml . All rights reserved.
 */
let util = require("util");
let underscore = require("underscore");
let request = require("request");
let prompt_out = require("prompt");
var { context, CookieJar } = require('fetch-h2');
import * as ToughCookie from 'tough-cookie';
const myJar = new ToughCookie.CookieJar();
const cookieJar = new CookieJar(myJar);
const { fetch } = context({ cookieJar });
var parseCurl = require('parse-curl');
import * as configUtils_1 from "../../utils/configUtils";
import * as commUtils_1 from "../../utils/commUtils";
import * as storageUtils_1 from "../../utils/storageUtils";
import * as ReplyUtils_1 from "../../utils/ReplyUtils";
import * as sessionUtils_1 from "../../utils/sessionUtils";
import * as chainNodeBase_1 from "../chainNodeBase";
import * as queueUtils_1 from "../../utils/queueUtils";
class LeetCode extends chainNodeBase_1.ChainNodeBase {
    constructor() {
        super();
        this.id = 10;
        this.name = "leetcode";
        this.builtin = true;
        this.getProblems = (_, cb) => {
            let that = this;
            let problems = [];
            const getCategory = function (category, _, cb) {
                that.getCategoryProblems(category, function (e, _problems) {
                    if (e) {
                        //
                    }
                    else {
                        problems = problems.concat(_problems);
                    }
                    return cb(e);
                });
            };
            const q = new queueUtils_1.Queue(configUtils_1.configUtils.sys.categories, {}, getCategory);
            q.run(null, function (e) {
                return cb(e, problems);
            });
        };
        /* Getting the problems from the category. */
        this.getCategoryProblems = (category, cb) => {
            const opts = makeOpts(configUtils_1.configUtils.sys.urls.problems.replace("$category", category));
            if (configUtils_1.configUtils.isCN()) {
                request(opts, function (e, resp, body) {
                    e = checkError(e, resp, 200);
                    if (e)
                        return cb(e);
                    const json = JSON.parse(body);
                    if (json.user_name.length === 0) {
                        return cb(sessionUtils_1.sessionUtils.errors.EXPIRED);
                    }
                    const problems = json.stat_status_pairs
                        .filter((p) => !p.stat.question__hide)
                        .map(function (p) {
                        return {
                            state: p.status || "None",
                            id: p.stat.question_id,
                            fid: p.stat.frontend_question_id,
                            name: p.stat.question__title,
                            slug: p.stat.question__title_slug,
                            link: configUtils_1.configUtils.sys.urls.problem.replace("$slug", p.stat.question__title_slug),
                            locked: p.paid_only,
                            percent: (p.stat.total_acs * 100) / p.stat.total_submitted,
                            level: commUtils_1.commUtils.getNameByLevel(p.difficulty.level),
                            starred: p.is_favor,
                            category: json.category_slug,
                        };
                    });
                    return cb(null, problems);
                });
            }
            else {
                this.h2request.get(opts, function (e, resp, json) {
                    e = checkError(e, resp, 200);
                    if (e)
                        return cb(e);
                    if (json.user_name.length === 0) {
                        return cb(sessionUtils_1.sessionUtils.errors.EXPIRED);
                    }
                    const problems = json.stat_status_pairs
                        .filter((p) => !p.stat.question__hide)
                        .map(function (p) {
                        return {
                            state: p.status || "None",
                            id: p.stat.question_id,
                            fid: p.stat.frontend_question_id,
                            name: p.stat.question__title,
                            slug: p.stat.question__title_slug,
                            link: configUtils_1.configUtils.sys.urls.problem.replace("$slug", p.stat.question__title_slug),
                            locked: p.paid_only,
                            percent: (p.stat.total_acs * 100) / p.stat.total_submitted,
                            level: commUtils_1.commUtils.getNameByLevel(p.difficulty.level),
                            starred: p.is_favor,
                            category: json.category_slug,
                        };
                    });
                    return cb(null, problems);
                });
            }
        };
        /* A function that takes in a problem and a callback function. It then makes a request to the leetcode
      server to get the problem's description, test cases, and other information. */
        this.getProblem = (problem, needTranslation, cb) => {
            const user = sessionUtils_1.sessionUtils.getUser();
            if (problem.locked && !user.paid)
                return cb("failed to load locked problem!");
            const opts = makeOpts(configUtils_1.configUtils.sys.urls.graphql);
            opts.headers.Origin = configUtils_1.configUtils.sys.urls.base;
            opts.headers.Referer = problem.link;
            opts.json = true;
            opts.body = {
                query: [
                    "query getQuestionDetail($titleSlug: String!) {",
                    "  question(titleSlug: $titleSlug) {",
                    "    content",
                    "    stats",
                    "    likes",
                    "    dislikes",
                    "    codeDefinition",
                    "    sampleTestCase",
                    "    enableRunCode",
                    "    metaData",
                    "    translatedContent",
                    "  }",
                    "}",
                ].join("\n"),
                variables: { titleSlug: problem.slug },
                operationName: "getQuestionDetail",
            };
            if (configUtils_1.configUtils.isCN()) {
                request.post(opts, function (e, resp, body) {
                    e = checkError(e, resp, 200);
                    if (e)
                        return cb(e);
                    const q = body.data.question;
                    if (!q)
                        return cb("failed to load problem!");
                    problem.totalAC = JSON.parse(q.stats).totalAccepted;
                    problem.totalSubmit = JSON.parse(q.stats).totalSubmission;
                    problem.likes = q.likes;
                    problem.dislikes = q.dislikes;
                    problem.desc = q.translatedContent && needTranslation ? q.translatedContent : q.content;
                    problem.templates = JSON.parse(q.codeDefinition);
                    problem.testcase = q.sampleTestCase;
                    problem.testable = q.enableRunCode;
                    problem.templateMeta = JSON.parse(q.metaData);
                    // @si-yao: seems below property is never used.
                    // problem.discuss =  q.discussCategoryId;
                    return cb(null, problem);
                });
            }
            else {
                opts.json = opts.body;
                delete opts.body;
                this.h2request.post(opts, function (e, resp, body) {
                    e = checkError(e, resp, 200);
                    if (e)
                        return cb(e);
                    const q = body.data.question;
                    if (!q)
                        return cb('failed to load problem!');
                    problem.totalAC = JSON.parse(q.stats).totalAccepted;
                    problem.totalSubmit = JSON.parse(q.stats).totalSubmission;
                    problem.likes = q.likes;
                    problem.dislikes = q.dislikes;
                    problem.desc = (q.translatedContent && needTranslation) ? q.translatedContent : q.content;
                    problem.templates = JSON.parse(q.codeDefinition);
                    problem.testcase = q.sampleTestCase;
                    problem.testable = q.enableRunCode;
                    problem.templateMeta = JSON.parse(q.metaData);
                    return cb(null, problem);
                });
            }
        };
        /* A function that is used to run the code on the server. */
        this.runCode = (opts, problem, cb) => {
            opts.method = "POST";
            opts.headers.Origin = configUtils_1.configUtils.sys.urls.base;
            opts.headers.Referer = problem.link;
            opts.json = true;
            opts._delay = opts._delay || configUtils_1.configUtils.network.delay || 1; // in seconds
            opts.body = opts.body || {};
            underscore.extendOwn(opts.body, {
                lang: problem.lang,
                question_id: parseInt(problem.id, 10),
                test_mode: false,
                typed_code: storageUtils_1.storageUtils.codeData(problem.file),
            });
            let that = this;
            if (configUtils_1.configUtils.isCN()) {
                request(opts, function (e, resp, body) {
                    e = checkError(e, resp, 200);
                    if (e)
                        return cb(e);
                    if (body.error) {
                        if (!body.error.includes("too soon"))
                            return cb(body.error);
                        ++opts._delay;
                        const reRun = underscore.partial(that.runCode, opts, problem, cb);
                        return setTimeout(reRun, opts._delay * 1000);
                    }
                    opts.json = false;
                    opts.body = null;
                    return cb(null, body);
                });
            }
            else {
                let new_opts = {};
                underscore.extendOwn(new_opts, opts);
                new_opts.json = opts.body;
                delete new_opts.body;
                that.h2request.post(new_opts, function (e, resp, body) {
                    e = checkError(e, resp, 200);
                    if (e)
                        return cb(e);
                    if (body.error) {
                        if (!body.error.includes('too soon'))
                            return cb(body.error);
                        ++opts._delay;
                        const reRun = underscore.partial(that.runCode, opts, problem, cb);
                        return setTimeout(reRun, opts._delay * 1000);
                    }
                    opts.json = false;
                    opts.body = null;
                    return cb(null, body);
                });
            }
        };
        /* A function that is used to verify the result of a task. */
        this.verifyResult = (task, queue, cb) => {
            const opts = queue.ctx.opts;
            opts.method = "GET";
            opts.url = configUtils_1.configUtils.sys.urls.verify.replace("$id", task.id);
            let that = this;
            if (configUtils_1.configUtils.isCN()) {
                request(opts, function (e, resp, body) {
                    e = checkError(e, resp, 200);
                    if (e)
                        return cb(e);
                    let result = JSON.parse(body);
                    if (result.state === "SUCCESS") {
                        result = that.formatResult(result);
                        underscore.extendOwn(result, task);
                        queue.ctx.results.push(result);
                    }
                    else {
                        queue.addTask(task);
                    }
                    return cb();
                });
            }
            else {
                this.h2request.get(opts, function (e, resp, result) {
                    e = checkError(e, resp, 200);
                    if (e)
                        return cb(e);
                    if (result.state === 'SUCCESS') {
                        result = that.formatResult(result);
                        underscore.extendOwn(result, task);
                        queue.ctx.results.push(result);
                    }
                    else {
                        queue.addTask(task);
                    }
                    return cb();
                });
            }
        };
        /* Formatting the result of the submission. */
        this.formatResult = (result) => {
            const x = {
                ok: result.run_success,
                lang: result.lang,
                runtime: result.status_runtime || "",
                runtime_percentile: result.runtime_percentile || "",
                memory: result.status_memory || "",
                memory_percentile: result.memory_percentile || "",
                submission_id: result.submission_id || "",
                state: result.status_msg,
                testcase: util.inspect(result.input || result.last_testcase || ""),
                passed: result.total_correct || 0,
                total: result.total_testcases || 0,
                compare_result: result.compare_result || ""
            };
            x.error = underscore
                .chain(result)
                .pick((v, k) => /_error$/.test(k) && v.length > 0)
                .values()
                .value();
            if (/[runcode|interpret].*/.test(result.submission_id)) {
                // It's testing
                let output = result.code_output || [];
                if (Array.isArray(output)) {
                    output = output.join("\n");
                }
                x.stdout = util.inspect(output);
                x.answer = result.code_answer;
                // LeetCode use 'expected_code_answer' to store the expected answer
                x.expected_answer = result.expected_code_answer;
            }
            else {
                // It's submitting
                x.answer = result.code_output;
                x.expected_answer = result.expected_output;
                x.stdout = result.std_output;
            }
            // make sure we pass eveything!
            if (x.passed !== x.total)
                x.ok = false;
            if (x.state !== "Accepted")
                x.ok = false;
            if (x.error.length > 0)
                x.ok = false;
            return x;
        };
        /* Testing the code. */
        this.testProblem = (problem, cb) => {
            const opts = makeOpts(configUtils_1.configUtils.sys.urls.test.replace("$slug", problem.slug));
            opts.body = { data_input: problem.testcase };
            let that = this;
            this.runCode(opts, problem, function (e, task) {
                if (e)
                    return cb(e);
                const tasks = [{ type: "Actual", id: task.interpret_id }];
                // Used by LeetCode-CN
                if (task.interpret_expected_id) {
                    tasks.push({ type: "Expected", id: task.interpret_expected_id });
                }
                const q = new queueUtils_1.Queue(tasks, { opts: opts, results: [] }, that.verifyResult);
                q.run(null, function (e, ctx) {
                    return cb(e, ctx.results);
                });
            });
        };
        /* Submitting a problem to the server. */
        this.submitProblem = (problem, cb) => {
            const opts = makeOpts(configUtils_1.configUtils.sys.urls.submit.replace("$slug", problem.slug));
            opts.body = { judge_type: "large" };
            let that = this;
            this.runCode(opts, problem, function (e, task) {
                if (e)
                    return cb(e);
                const tasks = [{ type: "Actual", id: task.submission_id }];
                const q = new queueUtils_1.Queue(tasks, { opts: opts, results: [] }, that.verifyResult);
                q.run(null, function (e, ctx) {
                    return cb(e, ctx.results);
                });
            });
        };
        /* Getting the submissions for a problem. */
        this.getSubmissions = (problem, cb) => {
            const opts = makeOpts(configUtils_1.configUtils.sys.urls.submissions.replace("$slug", problem.slug));
            opts.headers.Referer = configUtils_1.configUtils.sys.urls.problem.replace("$slug", problem.slug);
            const parseLegacySubmissions = function (body) {
                const parsed = typeof body === "string" ? JSON.parse(body) : body;
                const submissions = parsed.submissions_dump || parsed.submissions || [];
                for (const submission of submissions) {
                    if (!submission.id && submission.url) {
                        submission.id = underscore.last(underscore.compact(submission.url.split("/")));
                    }
                }
                return submissions;
            };
            const fetchCnSubmissionList = function (fallback) {
                const graphqlOpts = makeOpts(configUtils_1.configUtils.sys.urls.graphql);
                graphqlOpts.headers.Origin = configUtils_1.configUtils.sys.urls.base;
                graphqlOpts.headers.Referer = configUtils_1.configUtils.sys.urls.problem.replace("$slug", problem.slug);
                graphqlOpts.json = true;
                graphqlOpts.body = {
                    operationName: "submissionList",
                    variables: {
                        offset: 0,
                        limit: 40,
                        lastKey: null,
                        questionSlug: problem.slug,
                    },
                    query: [
                        "query submissionList($offset: Int!, $limit: Int!, $lastKey: String, $questionSlug: String!, $lang: String, $status: SubmissionStatusEnum) {",
                        "  submissionList(offset: $offset, limit: $limit, lastKey: $lastKey, questionSlug: $questionSlug, lang: $lang, status: $status) {",
                        "    lastKey",
                        "    hasNext",
                        "    submissions {",
                        "      id",
                        "      title",
                        "      status",
                        "      statusDisplay",
                        "      lang",
                        "      langName: langVerboseName",
                        "      runtime",
                        "      timestamp",
                        "      url",
                        "      isPending",
                        "      memory",
                        "      frontendId",
                        "    }",
                        "  }",
                        "}",
                    ].join("\n"),
                };
                request.post(graphqlOpts, function (e, resp, body) {
                    e = checkError(e, resp, 200);
                    const submissions = body && body.data && body.data.submissionList && body.data.submissionList.submissions;
                    if (e || !Array.isArray(submissions)) {
                        return fallback(e);
                    }
                    return cb(null, submissions);
                });
            };
            if (configUtils_1.configUtils.isCN()) {
                return fetchCnSubmissionList(function (firstError) {
                    request(opts, function (e, resp, body) {
                        e = checkError(e, resp, 200);
                        if (e)
                            return cb(firstError || e);
                        try {
                            return cb(null, parseLegacySubmissions(body));
                        }
                        catch (parseError) {
                            return cb(firstError || parseError);
                        }
                    });
                });
            }
            else {
                this.h2request.get(opts, function (e, resp, body) {
                    e = checkError(e, resp, 200);
                    if (e)
                        return cb(e);
                    try {
                        return cb(null, parseLegacySubmissions(body));
                    }
                    catch (parseError) {
                        return cb(parseError);
                    }
                });
            }
        };
        /* Getting the submission code and the runtime distribution chart. */
        this.getSubmission = (submission, cb) => {
            const opts = makeOpts(configUtils_1.configUtils.sys.urls.submission.replace("$id", submission.id));
            opts.timeout = 8000;
            if (configUtils_1.configUtils.isCN()) {
                const graphqlOpts = makeOpts(configUtils_1.configUtils.sys.urls.graphql);
                graphqlOpts.timeout = 8000;
                graphqlOpts.headers.Origin = configUtils_1.configUtils.sys.urls.base;
                graphqlOpts.headers.Referer = configUtils_1.configUtils.sys.urls.submission.replace("$id", submission.id);
                graphqlOpts.json = true;
                graphqlOpts.body = {
                    operationName: "submissionDetails",
                    variables: { submissionId: String(submission.id) },
                    query: [
                        "query submissionDetails($submissionId: ID!) {",
                        "  submissionDetail(submissionId: $submissionId) {",
                        "    code",
                        "    timestamp",
                        "    statusDisplay",
                        "    runtimeDisplay: runtime",
                        "    memoryDisplay: memory",
                        "    memory: rawMemory",
                        "    lang",
                        "    langVerboseName",
                        "    runtimePercentile",
                        "    memoryPercentile",
                        "    passedTestCaseCnt",
                        "    totalTestCaseCnt",
                        "    question {",
                        "      questionId",
                        "      titleSlug",
                        "    }",
                        "  }",
                        "}",
                    ].join("\n"),
                };
                request.post(graphqlOpts, function (e, resp, body) {
                    e = checkError(e, resp, 200);
                    const detail = body && body.data && body.data.submissionDetail;
                    if (!e && detail) {
                        submission.code = detail.code || submission.code || "";
                        submission.statusDisplay = detail.statusDisplay || submission.statusDisplay;
                        submission.runtime = detail.runtimeDisplay || submission.runtime;
                        submission.memory = detail.memoryDisplay || submission.memory;
                        submission.rawMemory = detail.memory;
                        submission.lang = detail.lang || submission.lang;
                        submission.langVerboseName = detail.langVerboseName || submission.langVerboseName;
                        submission.runtimePercentile = detail.runtimePercentile;
                        submission.memoryPercentile = detail.memoryPercentile;
                        submission.passed = detail.passedTestCaseCnt;
                        submission.total = detail.totalTestCaseCnt;
                        submission.timestamp = detail.timestamp || submission.timestamp;
                        submission.source = "officialSubmissionDetail";
                        return cb(null, submission);
                    }
                    request(opts, function (legacyError, legacyResp, body) {
                        legacyError = checkError(legacyError, legacyResp, 200);
                        if (legacyError)
                            return cb(e || legacyError);
                        let re = body.match(/submissionCode:\s('[^']*')/);
                        if (re)
                            submission.code = eval(re[1]);
                        re = body.match(/runtimeDistributionFormatted:\s('[^']+')/);
                        if (re)
                            submission.distributionChart = JSON.parse(eval(re[1]));
                        return cb(null, submission);
                    });
                });
            }
            else {
                this.h2request.getText(opts, function (e, resp, body) {
                    e = checkError(e, resp, 200);
                    if (e)
                        return cb(e);
                    let re = body.match(/submissionCode:\s('[^']*')/);
                    if (re)
                        submission.code = eval(re[1]);
                    re = body.match(/runtimeDistributionFormatted:\s('[^']+')/);
                    if (re)
                        submission.distributionChart = JSON.parse(eval(re[1]));
                    return cb(null, submission);
                });
            }
        };
        this.getSubmissionPerformance = (submission, cb) => {
            const id = Number(submission && (submission.id || submission.submission_id));
            if (!Number.isFinite(id)) {
                return cb("missing submission id");
            }
            const that = this;
            const fallbackLegacy = function (lastError) {
                that.getSubmission({ id }, function (legacyError, legacySubmission) {
                    if (legacyError) {
                        return cb(lastError || legacyError);
                    }
                    legacySubmission.source = "legacySubmissionPage";
                    return cb(null, legacySubmission);
                });
            };
            const fetchCnDistributions = function () {
                const base = configUtils_1.configUtils.sys.urls.base.replace(/\/$/, "");
                const detail = { id, source: "officialDistributionApi" };
                const tasks = [
                    {
                        key: "runtime",
                        url: `${base}/submissions/api/runtime_distribution/${id}/`,
                        apply(body) {
                            detail.runtimeDistribution = (body && body.merged_distribution && body.merged_distribution.length)
                                ? body.merged_distribution
                                : body && body.runtime_distribution_formatted;
                        },
                    },
                    {
                        key: "memory",
                        url: `${base}/submissions/api/memory_distribution/${id}/`,
                        apply(body) {
                            detail.memoryDistribution = (body && body.merged_distribution && body.merged_distribution.length)
                                ? body.merged_distribution
                                : body && body.memory_distribution_formatted;
                        },
                    },
                ];
                let pending = tasks.length;
                let success = false;
                let lastError;
                const done = function () {
                    pending -= 1;
                    if (pending > 0) {
                        return;
                    }
                    if (success && (detail.runtimeDistribution || detail.memoryDistribution)) {
                        return cb(null, detail);
                    }
                    return fallbackLegacy(lastError || "empty distribution api");
                };
                tasks.forEach((task) => {
                    const opts = makeOpts(task.url);
                    opts.timeout = 8000;
                    opts.json = true;
                    opts.headers.Referer = configUtils_1.configUtils.sys.urls.submission.replace("$id", id);
                    request(opts, function (e, resp, body) {
                        e = checkError(e, resp, 200);
                        if (e) {
                            lastError = e;
                            done();
                            return;
                        }
                        task.apply(body);
                        success = true;
                        done();
                    });
                });
            };
            if (configUtils_1.configUtils.isCN()) {
                return fetchCnDistributions();
            }
            const opts = makeOpts(configUtils_1.configUtils.sys.urls.graphql);
            opts.timeout = 8000;
            opts.headers.Origin = configUtils_1.configUtils.sys.urls.base;
            opts.headers.Referer = configUtils_1.configUtils.sys.urls.submission.replace("$id", id);
            opts.json = true;
            opts.body = {
                query: [
                    "query submissionDetails($submissionId: Int!) {",
                    "  submissionDetails(submissionId: $submissionId) {",
                    "    runtime",
                    "    runtimeDistribution",
                    "    memory",
                    "    memoryDistribution",
                    "    code",
                    "  }",
                    "}",
                ].join("\n"),
                variables: { submissionId: id },
                operationName: "submissionDetails",
            };
            const handleResponse = function (e, resp, body) {
                e = checkError(e, resp, 200);
                if (e) {
                    return fallbackLegacy(e);
                }
                const detail = body && body.data && body.data.submissionDetails;
                if (!detail) {
                    return fallbackLegacy("empty submission details");
                }
                return cb(null, Object.assign({ id, source: "officialSubmissionDetails" }, detail));
            };
            opts.json = opts.body;
            delete opts.body;
            this.h2request.post(opts, handleResponse);
        };
        /* A function that is used to star a problem. */
        this.starProblem = (problem, starred, cb) => {
            const user = sessionUtils_1.sessionUtils.getUser();
            const operationName = starred ? "addQuestionToFavorite" : "removeQuestionFromFavorite";
            const opts = makeOpts(configUtils_1.configUtils.sys.urls.graphql);
            opts.headers.Origin = configUtils_1.configUtils.sys.urls.base;
            opts.headers.Referer = problem.link;
            opts.json = true;
            opts.body = {
                query: `mutation ${operationName}($favoriteIdHash: String!, $questionId: String!) {\n  ${operationName}(favoriteIdHash: $favoriteIdHash, questionId: $questionId) {\n    ok\n    error\n    favoriteIdHash\n    questionId\n    __typename\n  }\n}\n`,
                variables: { favoriteIdHash: user.hash, questionId: "" + problem.id },
                operationName: operationName,
            };
            if (configUtils_1.configUtils.isCN()) {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                request.post(opts, function (e, resp, _) {
                    e = checkError(e, resp, 200);
                    if (e)
                        return cb(e);
                    return cb(null, starred);
                });
            }
            else {
                opts.json = opts.body;
                delete opts.body;
                this.h2request.post(opts, function (e, resp, _) {
                    e = checkError(e, resp, 200);
                    if (e)
                        return cb(e);
                    return cb(null, starred);
                });
            }
        };
        this.h2request = {
            h2core(opts, cb) {
                var _a, _b, _c;
                cookieJar.setCookies(((_c = (_b = (_a = opts === null || opts === void 0 ? void 0 : opts.headers) === null || _a === void 0 ? void 0 : _a.cookie) === null || _b === void 0 ? void 0 : _b.split) === null || _c === void 0 ? void 0 : _c.call(_b, ';')) || [], configUtils_1.configUtils.sys.urls.base).then(() => {
                    var _a, _b;
                    if ((_a = opts === null || opts === void 0 ? void 0 : opts.headers) === null || _a === void 0 ? void 0 : _a.cookie)
                        delete opts.headers.cookie;
                    if ((_b = opts === null || opts === void 0 ? void 0 : opts.headers) === null || _b === void 0 ? void 0 : _b.Cookie)
                        delete opts.headers.Cookie;
                    opts.allowForbiddenHeaders = true;
                    opts.timeout = 10000;
                    return fetch(opts.url, opts).then(function (response) {
                        if (!response.ok) {
                            const c = `HTTP ${opts.method} error with opts: ${JSON.stringify(opts)} Response: ${JSON.stringify(response)}`;
                            return cb(new Error(c));
                        }
                        // Save new "Set-Cookie" cookies to cache
                        const user = sessionUtils_1.sessionUtils.getUser();
                        user.my_us_header.cookie = myJar.getCookieStringSync(opts.url);
                        sessionUtils_1.sessionUtils.saveUser(user);
                        if (!response.json) {
                            const c = `HTTP ${opts.method} didn't respond with JSON opts: ${JSON.stringify(opts)} Response: ${JSON.stringify(response)}`;
                            cb(new Error(c));
                        }
                        else {
                            response.json().then((data) => {
                                cb(null, response, data);
                            });
                        }
                    });
                });
            },
            post(opts, cb) {
                opts.method = 'POST';
                this.h2core(opts, cb);
            },
            get(opts, cb) {
                opts.method = 'GET';
                this.h2core(opts, cb);
            },
            h2text(opts, cb) {
                var _a, _b, _c;
                cookieJar.setCookies(((_c = (_b = (_a = opts === null || opts === void 0 ? void 0 : opts.headers) === null || _a === void 0 ? void 0 : _a.cookie) === null || _b === void 0 ? void 0 : _b.split) === null || _c === void 0 ? void 0 : _c.call(_b, ';')) || [], configUtils_1.configUtils.sys.urls.base).then(() => {
                    var _a, _b;
                    if ((_a = opts === null || opts === void 0 ? void 0 : opts.headers) === null || _a === void 0 ? void 0 : _a.cookie)
                        delete opts.headers.cookie;
                    if ((_b = opts === null || opts === void 0 ? void 0 : opts.headers) === null || _b === void 0 ? void 0 : _b.Cookie)
                        delete opts.headers.Cookie;
                    opts.allowForbiddenHeaders = true;
                    opts.timeout = 10000;
                    return fetch(opts.url, opts).then(function (response) {
                        if (!response.ok) {
                            const c = `HTTP ${opts.method} error with opts: ${JSON.stringify(opts)} Response: ${JSON.stringify(response)}`;
                            return cb(new Error(c));
                        }
                        const user = sessionUtils_1.sessionUtils.getUser();
                        user.my_us_header.cookie = myJar.getCookieStringSync(opts.url);
                        sessionUtils_1.sessionUtils.saveUser(user);
                        response.text().then((data) => {
                            cb(null, response, data);
                        }, cb);
                    }, cb);
                }, cb);
            },
            getText(opts, cb) {
                opts.method = 'GET';
                this.h2text(opts, cb);
            }
        };
        /* Making a request to the server to get the favorites. */
        this.getFavorites = (cb) => {
            const opts = makeOpts(configUtils_1.configUtils.sys.urls.favorites);
            if (!configUtils_1.configUtils.isCN()) {
                this.h2request.get(opts, function (e, resp, favorites) {
                    e = checkError(e, resp, 200);
                    if (e)
                        return cb(e);
                    return cb(null, favorites);
                });
            }
            else {
                request(opts, function (e, resp, body) {
                    e = checkError(e, resp, 200);
                    if (e)
                        return cb(e);
                    const favorites = JSON.parse(body);
                    return cb(null, favorites);
                });
            }
        };
        /* Making a POST request to the GraphQL API. */
        this.getUserInfo = (cb) => {
            const opts = makeOpts(configUtils_1.configUtils.sys.urls.graphql);
            opts.headers.Origin = configUtils_1.configUtils.sys.urls.base;
            opts.headers.Referer = configUtils_1.configUtils.sys.urls.base;
            opts.json = true;
            opts.body = {
                query: ["{", "  user {", "    username", "    isCurrentUserPremium", "  }", "}"].join("\n"),
                variables: {},
            };
            if (configUtils_1.configUtils.isCN()) {
                request.post(opts, function (e, resp, body) {
                    e = checkError(e, resp, 200);
                    if (e)
                        return cb(e);
                    const user = body.data.user;
                    return cb(null, user);
                });
            }
            else {
                opts.json = opts.body;
                delete opts.body;
                this.h2request.post(opts, function (e, resp, body) {
                    e = checkError(e, resp, 200);
                    if (e)
                        return cb(e);
                    const user = body.data.user;
                    return cb(null, user);
                });
            }
        };
        /* Making a request to the server and returning the response. */
        this.runSession = (method, data, cb) => {
            const opts = makeOpts(configUtils_1.configUtils.sys.urls.session);
            opts.json = true;
            opts.method = method;
            opts.body = data;
            if (configUtils_1.configUtils.isCN()) {
                request(opts, function (e, resp, body) {
                    e = checkError(e, resp, 200);
                    if (e && e.statusCode === 302)
                        e = sessionUtils_1.sessionUtils.errors.EXPIRED;
                    return e ? cb(e) : cb(null, body.sessions);
                });
            }
            else {
                this.h2request.get(opts, function (e, resp, body) {
                    e = checkError(e, resp, 200);
                    if (e && e.status === 302)
                        e = sessionUtils_1.sessionUtils.errors.EXPIRED;
                    return e ? cb(e) : cb(null, body.sessions);
                });
            }
        };
        this.getSessions = (cb) => {
            this.runSession("POST", {}, cb);
        };
        this.activateSession = (session, cb) => {
            const data = { func: "activate", target: session.id };
            this.runSession("PUT", data, cb);
        };
        this.createSession = (name, cb) => {
            const data = { func: "create", name: name };
            this.runSession("PUT", data, cb);
        };
        this.deleteSession = (session, cb) => {
            const data = { target: session.id };
            this.runSession("DELETE", data, cb);
        };
        /* A function that takes in a user object and a callback function. It then makes a request to the login
      page and gets the csrf token. It then makes a post request to the login page with the csrf token and
      the user's login and password. If the response status code is 302, it saves the user's session id
      and csrf token to the user object and saves the user object to the session. */
        this.signin = (user, cb) => {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            request(configUtils_1.configUtils.sys.urls.login, function (e, resp, _) {
                e = checkError(e, resp, 200);
                if (e)
                    return cb(e);
                user.loginCSRF = commUtils_1.commUtils.getSetCookieValue(resp, "csrftoken");
                const opts = {
                    url: configUtils_1.configUtils.sys.urls.login,
                    headers: {
                        Origin: configUtils_1.configUtils.sys.urls.base,
                        Referer: configUtils_1.configUtils.sys.urls.login,
                        Cookie: "csrftoken=" + user.loginCSRF + ";",
                    },
                    form: {
                        csrfmiddlewaretoken: user.loginCSRF,
                        login: user.login,
                        password: user.pass,
                    },
                };
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                request.post(opts, function (e, resp, _) {
                    if (e)
                        return cb(e);
                    if (resp.statusCode !== 302) {
                        let _temp_msg = JSON.stringify({
                            statusCode: resp.statusCode,
                            body: resp.body,
                            statusMessage: resp.statusMessage,
                            msg: "密码错误?",
                            msg1: "invalid password?",
                            msg2: "要是用浏览器在力扣官网登录过账号还没过期, 插件的登录会被拒绝,使得登录失败,尝试用cookie方式登录",
                        });
                        return cb(_temp_msg);
                    }
                    user.sessionCSRF = commUtils_1.commUtils.getSetCookieValue(resp, "csrftoken");
                    user.sessionId = commUtils_1.commUtils.getSetCookieValue(resp, "LEETCODE_SESSION");
                    sessionUtils_1.sessionUtils.saveUser(user);
                    return cb(null, user);
                });
            });
        };
        /* Retrieving the user's favorites and user info. */
        this.getUser = (user, cb) => {
            let that = this;
            this.getFavorites(function (e, favorites) {
                if (!e) {
                    const f = favorites.favorites.private_favorites.find((f) => f.name === "Favorite");
                    if (f) {
                        user.hash = f.id_hash;
                        user.name = favorites.user_name;
                    }
                    else {
                        // reply.warn("Favorite not found?");
                    }
                }
                else {
                    // return cb(e);
                    // reply.warn("Failed to retrieve user favorites: " + e);
                }
                that.getUserInfo(function (e, _user) {
                    if (!e) {
                        user.paid = _user.isCurrentUserPremium;
                        user.name = _user.username;
                    }
                    sessionUtils_1.sessionUtils.saveUser(user);
                    return cb(null, user);
                });
            });
        };
        this.login = (user, cb) => {
            let that = this;
            that.signin(user, function (e, user) {
                if (e)
                    return cb(e);
                that.getUser(user, cb);
            });
        };
        /* Parsing the cookie to get the sessionId and sessionCSRF. */
        this.parseCookie = (cookie, cb) => {
            const SessionPattern = /LEETCODE_SESSION=(.+?)(;|$)/;
            const csrfPattern = /csrftoken=(.+?)(;|$)/;
            const reCsrfResult = csrfPattern.exec(cookie);
            const reSessionResult = SessionPattern.exec(cookie);
            if (reSessionResult === null || reCsrfResult === null) {
                return cb("invalid cookie?");
            }
            return {
                sessionId: reSessionResult[1],
                sessionCSRF: reCsrfResult[1],
            };
        };
        /* A function that is used to login to leetcode. */
        this.requestLeetcodeAndSave = (request, leetcodeUrl, user, cb) => {
            let that = this;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            request.get({ url: leetcodeUrl }, function (_, resp, __) {
                const redirectUri = resp.request.uri.href;
                if (redirectUri !== configUtils_1.configUtils.sys.urls.leetcode_redirect) {
                    return cb("Login failed. Please make sure the credential is correct.");
                }
                const cookieData = that.parseCookie(resp.request.headers.cookie, cb);
                user.sessionId = cookieData.sessionId;
                user.sessionCSRF = cookieData.sessionCSRF;
                sessionUtils_1.sessionUtils.saveUser(user);
                that.getUser(user, cb);
            });
        };
        this.cookieLogin = (user, cb) => {
            if (configUtils_1.configUtils.isCN()) {
                const cookieData = this.parseCookie(user.cookie, cb);
                user.sessionId = cookieData.sessionId;
                user.sessionCSRF = cookieData.sessionCSRF;
                sessionUtils_1.sessionUtils.saveUser(user);
                this.getUser(user, cb);
            }
            else {
                const curl = parseCurl(user.cookie);
                if (curl.header.referer)
                    delete curl.header.referer;
                if (curl.header.Referer)
                    delete curl.header.Referer;
                user.my_us_header = curl.header;
                sessionUtils_1.sessionUtils.saveUser(user);
                this.getUser(user, cb);
            }
        };
        this.curlcookieLogin = (user, cb) => {
            if (configUtils_1.configUtils.isCN()) {
                const cookieData = this.parseCookie(user.cookie, cb);
                user.sessionId = cookieData.sessionId;
                user.sessionCSRF = cookieData.sessionCSRF;
                sessionUtils_1.sessionUtils.saveUser(user);
                this.getUser(user, cb);
            }
            else {
                const curl = parseCurl(user.curl_data);
                if (curl.header.referer)
                    delete curl.header.referer;
                if (curl.header.Referer)
                    delete curl.header.Referer;
                user.my_us_header = curl.header;
                sessionUtils_1.sessionUtils.saveUser(user);
                this.getUser(user, cb);
            }
        };
        /* A function that is used to login to GitHub. */
        this.githubLogin = (user, cb) => {
            const urls = configUtils_1.configUtils.sys.urls;
            const leetcodeUrl = urls.github_login;
            const _request = request.defaults({ jar: true });
            let that = this;
            _request(urls.github_login_request, function (_, __, body) {
                const authenticityToken = body.match(/name="authenticity_token" value="(.*?)"/);
                let gaId = body.match(/name="ga_id" value="(.*?)"/);
                if (!gaId) {
                    gaId = "";
                }
                let requiredField = body.match(/name="required_field_(.*?)"/);
                const timestamp = body.match(/name="timestamp" value="(.*?)"/);
                const timestampSecret = body.match(/name="timestamp_secret" value="(.*?)"/);
                if (!(authenticityToken && timestamp && timestampSecret && requiredField)) {
                    return cb("Get GitHub payload failed");
                }
                requiredField = "required_field_" + requiredField[1];
                const options = {
                    url: urls.github_session_request,
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    followAllRedirects: true,
                    form: {
                        login: user.login,
                        password: user.pass,
                        authenticity_token: authenticityToken[1],
                        commit: encodeURIComponent("Sign in"),
                        ga_id: gaId,
                        "webauthn-support": "supported",
                        "webauthn-iuvpaa-support": "unsupported",
                        return_to: "",
                        requiredField: "",
                        timestamp: timestamp[1],
                        timestamp_secret: timestampSecret[1],
                    },
                };
                _request(options, function (_, resp, body) {
                    if (resp.statusCode !== 200) {
                        return cb("GitHub login failed");
                    }
                    if (!resp.request.uri.href.startsWith(urls.github_tf_redirect)) {
                        return that.requestLeetcodeAndSave(_request, leetcodeUrl, user, cb);
                    }
                    prompt_out.colors = false;
                    prompt_out.message = "";
                    prompt_out.start();
                    prompt_out.get([
                        {
                            name: "twoFactorCode",
                            required: true,
                        },
                    ], function (e, result) {
                        if (e)
                            return ReplyUtils_1.reply.info(e);
                        const authenticityTokenTwoFactor = body.match(/name="authenticity_token" value="(.*?)"/);
                        if (authenticityTokenTwoFactor === null) {
                            return cb("Get GitHub two-factor token failed");
                        }
                        const optionsTwoFactor = {
                            url: urls.github_tf_session_request,
                            method: "POST",
                            headers: {
                                "Content-Type": "application/x-www-form-urlencoded",
                            },
                            followAllRedirects: true,
                            form: {
                                otp: result.twoFactorCode,
                                authenticity_token: authenticityTokenTwoFactor[1],
                                utf8: encodeURIComponent("✓"),
                            },
                        };
                        // eslint-disable-next-line @typescript-eslint/no-unused-vars
                        _request(optionsTwoFactor, function (_, resp, __) {
                            if (resp.request.uri.href === urls.github_tf_session_request) {
                                return cb("Invalid two-factor code please check");
                            }
                            that.requestLeetcodeAndSave(_request, leetcodeUrl, user, cb);
                        });
                    });
                });
            });
        };
        /* A function that logs into LinkedIn and then logs into LeetCode. */
        this.linkedinLogin = (user, cb) => {
            const urls = configUtils_1.configUtils.sys.urls;
            const leetcodeUrl = urls.linkedin_login;
            const _request = request.defaults({
                jar: true,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.86 Safari/537.36",
                },
            });
            let that = this;
            _request(urls.linkedin_login_request, function (_, resp, body) {
                if (resp.statusCode !== 200) {
                    return cb("Get LinkedIn session failed");
                }
                const csrfToken = body.match(/input type="hidden" name="csrfToken" value="(.*?)"/);
                const loginCsrfToken = body.match(/input type="hidden" name="loginCsrfParam" value="(.*?)"/);
                const sIdString = body.match(/input type="hidden" name="sIdString" value="(.*?)"/);
                const pageInstance = body.match(/input type="hidden" name="pageInstance" value="(.*?)"/);
                if (!(csrfToken && loginCsrfToken && sIdString && pageInstance)) {
                    return cb("Get LinkedIn payload failed");
                }
                const options = {
                    url: urls.linkedin_session_request,
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                    followAllRedirects: true,
                    form: {
                        csrfToken: csrfToken[1],
                        session_key: user.login,
                        ac: 2,
                        sIdString: sIdString[1],
                        parentPageKey: "d_checkpoint_lg_consumerLogin",
                        pageInstance: pageInstance[1],
                        trk: "public_profile_nav-header-signin",
                        authUUID: "",
                        session_redirect: "https://www.linkedin.com/feed/",
                        loginCsrfParam: loginCsrfToken[1],
                        fp_data: "default",
                        _d: "d",
                        showGoogleOneTapLogin: true,
                        controlId: "d_checkpoint_lg_consumerLogin-login_submit_button",
                        session_password: user.pass,
                        loginFlow: "REMEMBER_ME_OPTIN",
                    },
                };
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                _request(options, function (_, resp, __) {
                    if (resp.statusCode !== 200) {
                        return cb("LinkedIn login failed");
                    }
                    that.requestLeetcodeAndSave(_request, leetcodeUrl, user, cb);
                });
            });
        };
        /* A function that is used to get the rating of the problems. */
        this.getRatingOnline = (cb) => {
            const _request = request.defaults({ timeout: 2000, jar: true });
            _request("https://zerotrac.github.io/leetcode_problem_rating/data.json", function (error, _, body) {
                // console.log(error);
                // console.log(info);
                cb(error, body);
            });
        };
        /* A function that gets the question of the day from leetcode. */
        this.getQuestionOfToday = (cb) => {
            const opts = makeOpts(configUtils_1.configUtils.sys.urls.graphql);
            opts.headers.Origin = configUtils_1.configUtils.sys.urls.base;
            opts.headers.Referer = "https://leetcode.com/";
            opts.json = true;
            opts.body = {
                operationName: "questionOfToday",
                variables: {},
                query: [
                    "query questionOfToday {",
                    "  todayRecord {",
                    "    date",
                    "    userStatus",
                    "    question {",
                    "      titleSlug",
                    "      questionId",
                    "      questionFrontendId",
                    // '      content',
                    // '      stats',
                    // '      likes',
                    // '      dislikes',
                    // '      codeDefinition',
                    // '      sampleTestCase',
                    // '      enableRunCode',
                    // '      metaData',
                    // '      translatedContent',
                    "      __typename",
                    "    }",
                    "  __typename",
                    "  }",
                    "}",
                ].join("\n"),
            };
            // request.post(opts, function (e, resp, body) {
            //   e = checkError(e, resp, 200);
            //   if (e) return cb(e);
            //   let result: any = {};
            //   result.titleSlug = body.data.todayRecord[0].question.titleSlug;
            //   result.questionId = body.data.todayRecord[0].question.questionId;
            //   result.fid = body.data.todayRecord[0].question.questionFrontendId;
            //   result.date = body.data.todayRecord[0].data;
            //   result.userStatus = body.data.todayRecord[0].userStatus;
            //   return cb(null, result);
            // });
            cb(null, {});
        };
        /* A function that is used to get the user contest ranking information. */
        this.getUserContestP = (username, cb) => {
            const opts = makeOpts(configUtils_1.configUtils.sys.urls.noj_go);
            opts.headers.Origin = configUtils_1.configUtils.sys.urls.base;
            opts.headers.Referer = configUtils_1.configUtils.sys.urls.u.replace("$username", username);
            opts.json = true;
            opts.body = {
                variables: {
                    userSlug: username,
                },
                query: [
                    "        query userContestRankingInfo($userSlug: String!) {",
                    "          userContestRanking(userSlug: $userSlug) {",
                    "            attendedContestsCount",
                    "            rating",
                    "            globalRanking",
                    "            localRanking",
                    "            globalTotalParticipants",
                    "            localTotalParticipants",
                    "            topPercentage",
                    "        }",
                    // '      userContestRankingHistory(userSlug: $userSlug) {',
                    // '            attended',
                    // '            totalProblems',
                    // '            trendingDirection',
                    // '            finishTimeInSeconds',
                    // '            rating',
                    // '            score',
                    // '            ranking',
                    // '            contest {',
                    // '              title',
                    // '              titleCn',
                    // '              startTime',
                    // '            }',
                    // '        }',
                    "    }",
                ].join("\n"),
            };
            // request.post(opts, function (e, resp, body) {
            //   e = checkError(e, resp, 200);
            //   if (e) return cb(e);
            //   return cb(null, body.data);
            // });
            cb(null, {});
        };
        this.getHelpOnline = (problem, _, lang) => {
            getHelpEn(problem, lang, function (e, solution) {
                if (e)
                    return;
                if (!solution)
                    return ReplyUtils_1.reply.info(JSON.stringify({ code: -1, msg: `Solution not found for ${lang}` }));
                let URL_DISCUSS = "https://leetcode.com/problems/$slug/discuss/$id";
                let link = URL_DISCUSS.replace("$slug", problem.slug).replace("$id", solution.id);
                let content = solution.post.content.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
                let solution_result = {};
                solution_result.problem_name = problem.name;
                solution_result.title = solution.title;
                solution_result.url = link;
                solution_result.lang = lang;
                solution_result.author = solution.post.author.username;
                solution_result.votes = solution.post.voteCount;
                solution_result.body = content;
                solution_result.is_cn = false;
                ReplyUtils_1.reply.info(JSON.stringify({ code: 100, solution: solution_result }));
            });
        };
    }
    init() {
        configUtils_1.configUtils.app = "leetcode";
    }
}
/**
 * It takes a problem object, a language, and a callback. It then makes a request to the LeetCode
 * Discuss API to get the top voted solution for that problem in that language
 * @param problem - the problem object
 * @param lang - The language of the solution.
 * @param cb - callback function
 * @returns A solution to the problem.
 */
function getHelpEn(problem, lang, cb) {
    if (!problem)
        return cb();
    let URL_DISCUSSES = "https://leetcode.com/graphql";
    if (lang === "python3")
        lang = "python";
    const opts11 = makeOpts(URL_DISCUSSES);
    let opts = {
        headers: opts11,
        url: URL_DISCUSSES,
        json: true,
        body: {
            query: [
                "query questionTopicsList($questionId: String!, $orderBy: TopicSortingOption, $skip: Int, $query: String, $first: Int!, $tags: [String!]) {",
                "  questionTopicsList(questionId: $questionId, orderBy: $orderBy, skip: $skip, query: $query, first: $first, tags: $tags) {",
                "    ...TopicsList",
                "  }",
                "}",
                "fragment TopicsList on TopicConnection {",
                "  totalNum",
                "  edges {",
                "    node {",
                "      id",
                "      title",
                "      post {",
                "        content",
                "        voteCount",
                "        author {",
                "          username",
                "        }",
                "      }",
                "    }",
                "  }",
                "}",
            ].join("\n"),
            operationName: "questionTopicsList",
            variables: JSON.stringify({
                query: "",
                first: 1,
                skip: 0,
                orderBy: "most_votes",
                questionId: "" + problem.id,
                tags: [lang],
            }),
        },
    };
    request(opts, function (e, resp, body) {
        if (e)
            return cb(e);
        if (resp.statusCode !== 200)
            return cb({ msg: "http error", statusCode: resp.statusCode });
        const solutions = body.data.questionTopicsList.edges;
        const solution = solutions.length > 0 ? solutions[0].node : null;
        return cb(null, solution);
    });
}
function makeOpts(url) {
    const opts = {};
    opts.url = url;
    opts.headers = {};
    signOpts(opts, sessionUtils_1.sessionUtils.getUser());
    return opts;
}
function signOpts(opts, user) {
    if (user.my_us_header) {
        opts.headers = user.my_us_header;
        return;
    }
    opts.headers.Cookie = "LEETCODE_SESSION=" + user.sessionId + ";csrftoken=" + user.sessionCSRF + ";";
    opts.headers["X-CSRFToken"] = user.sessionCSRF;
    opts.headers["X-Requested-With"] = "XMLHttpRequest";
    opts.headers["x-csrftoken"] = user.sessionCSRF;
    opts.headers['User-Agent'] = configUtils_1.configUtils.sys.my_headers.User_Agent;
    opts.headers['Referer'] = configUtils_1.configUtils.sys.my_headers.Referer;
    opts.headers['Origin'] = configUtils_1.configUtils.sys.my_headers.Origin;
    opts.headers['Host'] = configUtils_1.configUtils.sys.my_headers.Host;
    opts.headers['Content-Type'] = configUtils_1.configUtils.sys.my_headers.Content_Type;
    opts.headers['Accept'] = configUtils_1.configUtils.sys.my_headers.Accept;
    opts.my_us_cookie = user.my_us_cookie;
}
function checkError(e, resp, expectedStatus) {
    if (!e && resp && (resp.statusCode || resp.status) !== expectedStatus) {
        const code = (resp.statusCode || resp.status);
        if (code === 403 || code === 401) {
            e = sessionUtils_1.sessionUtils.errors.EXPIRED;
        }
        else {
            e = { msg: "http error", statusCode: code };
        }
    }
    return e;
}
export const pluginObj = new LeetCode();
