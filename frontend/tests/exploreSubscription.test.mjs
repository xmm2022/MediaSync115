import assert from "node:assert/strict";
import { buildExploreSubscriptionPayload } from "../src/utils/exploreSubscription.ts";

const doubanMovie = {
  id: "35211447",
  douban_id: "35211447",
  tmdb_id: null,
  media_type: "movie",
  title: "我看见两朵一样的云 (2026)",
  year: "2026",
  rating: 5.6,
};

const doubanResult = buildExploreSubscriptionPayload(doubanMovie, "douban");
assert.equal(doubanResult.ok, true);
assert.equal(doubanResult.payload.title, "我看见两朵一样的云");
assert.equal(doubanResult.payload.media_type, "movie");
assert.equal(doubanResult.payload.douban_id, "35211447");
assert.equal(doubanResult.payload.tmdb_id, undefined);

const animationResult = buildExploreSubscriptionPayload(
  {
    id: "37441858",
    douban_id: "37441858",
    media_type: "tv",
    title: "躲在超市后门抽烟的两人",
  },
  "animation",
);
assert.equal(animationResult.ok, true);
assert.equal(animationResult.payload.media_type, "tv");
assert.equal(animationResult.payload.douban_id, "37441858");

const missingIdResult = buildExploreSubscriptionPayload(
  {
    id: "",
    media_type: "movie",
    title: "未知条目",
  },
  "tmdb",
);
assert.equal(missingIdResult.ok, false);
assert.match(missingIdResult.message, /缺少/);

console.log("explore subscription payload tests passed");
