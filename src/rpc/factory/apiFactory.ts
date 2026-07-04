// @ts-nocheck
import * as cacheApi_1 from "./api/cacheApi";
import * as pluginApi_1 from "./api/pluginApi";
import * as queryApi_1 from "./api/queryApi";
import * as showApi_1 from "./api/showApi";
import * as starApi_1 from "./api/starApi";
import * as submitApi_1 from "./api/submitApi";
import * as submissionsApi_1 from "./api/submissionsApi";
import * as solutionsApi_1 from "./api/solutionsApi";
import * as testApi_1 from "./api/testApi";
import * as activityApi_1 from "./api/activityApi";
import * as userApi_1 from "./api/userApi";
class ApiFactory {
    constructor() { }
    getApi(api) {
        if (api == "cache") {
            return cacheApi_1.cacheApi;
        }
        else if (api == "plugin") {
            return pluginApi_1.pluginApi;
        }
        else if (api == "query") {
            return queryApi_1.queryApi;
        }
        else if (api == "show") {
            return showApi_1.showApi;
        }
        else if (api == "star") {
            return starApi_1.starApi;
        }
        else if (api == "submit") {
            return submitApi_1.submitApi;
        }
        else if (api == "submissions") {
            return submissionsApi_1.submissionsApi;
        }
        else if (api == "solutions") {
            return solutionsApi_1.solutionsApi;
        }
        else if (api == "activity") {
            return activityApi_1.activityApi;
        }
        else if (api == "test") {
            return testApi_1.testApi;
        }
        else if (api == "user") {
            return userApi_1.userApi;
        }
        return undefined;
    }
}
export const apiFactory = new ApiFactory();
