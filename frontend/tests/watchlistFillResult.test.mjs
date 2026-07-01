import assert from "node:assert/strict";
import { buildWatchlistFillLog } from "../src/utils/watchlistFillResult.ts";

const success = buildWatchlistFillLog("周末片单", {
  success: true,
  watchlist_name: "周末片单",
  new_subscriptions: 2,
  existing_subscriptions: 1,
  failed: 0,
  message: "片单「周末片单」补缺完成：新增 2，已有 1，失败 0",
});

assert.equal(success.level, "SUCCESS");
assert.match(success.message, /新增 2/);
assert.match(success.message, /失败 0/);

const partial = buildWatchlistFillLog("周末片单", {
  success: true,
  watchlist_name: "周末片单",
  new_subscriptions: 1,
  existing_subscriptions: 0,
  failed: 2,
  message: "片单「周末片单」补缺完成：新增 1，已有 0，失败 2",
});

assert.equal(partial.level, "WARN");
assert.match(partial.message, /失败 2/);

const failed = buildWatchlistFillLog("周末片单", {
  success: false,
  message: "片单不存在",
});

assert.equal(failed.level, "ERROR");
assert.equal(failed.message, "片单不存在");

console.log("watchlist fill result tests passed");
