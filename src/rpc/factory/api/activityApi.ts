// @ts-nocheck
import { reply } from "../../utils/ReplyUtils";
import { sessionUtils } from "../../utils/sessionUtils";
import { ApiBase } from "../apiBase";
import { chainMgr } from "../../actionChain/chainManager";

const DAY_SECONDS = 24 * 60 * 60;

class ActivityApi extends ApiBase {
  constructor() {
    super();
  }

  callArg(argv) {
    const result = {
      username: "",
      days: 0,
      year: 0,
    };
    const positionals = [];
    for (let index = 3; index < argv.length; index += 1) {
      const value = argv[index];
      if (value === "-u" || value === "--username") {
        result.username = argv[index + 1] || "";
        index += 1;
      } else if (value && value.startsWith("--username=")) {
        result.username = value.slice("--username=".length);
      } else if (value === "-d" || value === "--days") {
        result.days = Number(argv[index + 1] || 0);
        index += 1;
      } else if (value && value.startsWith("--days=")) {
        result.days = Number(value.slice("--days=".length));
      } else if (value === "-y" || value === "--year") {
        result.year = Number(argv[index + 1] || 0);
        index += 1;
      } else if (value && value.startsWith("--year=")) {
        result.year = Number(value.slice("--year=".length));
      } else if (value && value[0] !== "-") {
        positionals.push(value);
      }
    }
    if (!result.username && positionals.length) {
      result.username = positionals[0];
    }
    return result;
  }

  parseCalendar(value) {
    if (!value) {
      return {};
    }
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch (_) {
        return {};
      }
    }
    if (typeof value === "object") {
      return value;
    }
    return {};
  }

  utcTodaySeconds() {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  }

  dateToSeconds(year, month, date) {
    return Date.UTC(year, month, date) / 1000;
  }

  toDate(ts) {
    return new Date(Number(ts) * 1000).toISOString().slice(0, 10);
  }

  buildRange(year, activeTimestamps) {
    const today = this.utcTodaySeconds();
    const requestedYear = Number(year);
    if (Number.isFinite(requestedYear) && requestedYear > 0) {
      const currentYear = new Date(today * 1000).getUTCFullYear();
      const start = this.dateToSeconds(requestedYear, 0, 1);
      const endOfYear = this.dateToSeconds(requestedYear, 11, 31);
      return {
        start,
        end: requestedYear === currentYear ? Math.min(today, endOfYear) : endOfYear,
      };
    }
    if (activeTimestamps.length) {
      return {
        start: activeTimestamps[0],
        end: Math.max(today, activeTimestamps[activeTimestamps.length - 1]),
      };
    }
    return {
      start: today - 365 * DAY_SECONDS,
      end: today,
    };
  }

  normalize(raw, daysLimit) {
    const calendar = raw.calendar || {};
    const rawMap = this.parseCalendar(calendar.submissionCalendar);
    const activeTimestamps = Object.keys(rawMap)
      .map((key) => Number(key))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);
    const range = this.buildRange(raw.year, activeTimestamps);
    let start = range.start;
    const end = range.end;
    const days = Number(daysLimit);
    if (Number.isFinite(days) && days > 0) {
      start = Math.max(start, end - (Math.floor(days) - 1) * DAY_SECONDS);
    }

    const denseDays = [];
    for (let ts = start; ts <= end; ts += DAY_SECONDS) {
      const count = Number(rawMap[String(ts)] || 0);
      denseDays.push({
        date: this.toDate(ts),
        timestamp: ts,
        count: Number.isFinite(count) ? count : 0,
        active: count > 0,
      });
    }

    return {
      code: 100,
      endpoint: raw.endpoint,
      source: raw.source,
      username: raw.username || raw.userSlug,
      year: raw.year || null,
      range: {
        from: this.toDate(start),
        to: this.toDate(end),
        days: denseDays.length,
      },
      streak: Number(calendar.streak || 0),
      recentStreak: Number(calendar.recentStreak || calendar.streak || 0),
      totalActiveDays: Number(calendar.totalActiveDays || activeTimestamps.length || 0),
      activeYears: calendar.activeYears || [],
      days: denseDays,
      activeDays: denseDays.filter((day) => day.active),
    };
  }

  resolveUsername(preferred, cb) {
    const username = String(preferred || "").trim();
    if (username) {
      return cb(null, username);
    }

    const chain = chainMgr.getChainHead();
    if (chain && typeof chain.getUserInfo === "function") {
      return chain.getUserInfo((e, user) => {
        if (!e && user && user.username) {
          return cb(null, user.username);
        }
        const cachedUser = sessionUtils.getUser();
        const fallback = cachedUser && (cachedUser.name || cachedUser.login);
        return fallback ? cb(null, fallback) : cb(e || "missing username");
      });
    }

    const cachedUser = sessionUtils.getUser();
    const fallback = cachedUser && (cachedUser.name || cachedUser.login);
    return fallback ? cb(null, fallback) : cb("missing username");
  }

  call(argv) {
    sessionUtils.argv = argv;
    if (!sessionUtils.getUser()) {
      return reply.info(JSON.stringify({ code: -7, msg: "You are not login yet?" }));
    }
    this.resolveUsername(argv.username, (usernameError, username) => {
      if (usernameError) {
        return reply.info(JSON.stringify({ code: 101, error: usernameError.msg || usernameError }));
      }
      chainMgr.getChainHead().getUserActivityCalendar(username, argv.year, (calendarError, rawCalendar) => {
        if (calendarError) {
          return reply.info(JSON.stringify({ code: 102, error: calendarError.msg || calendarError }));
        }
        return reply.info(JSON.stringify(this.normalize(rawCalendar, argv.days)));
      });
    });
  }
}

export const activityApi: ActivityApi = new ActivityApi();
