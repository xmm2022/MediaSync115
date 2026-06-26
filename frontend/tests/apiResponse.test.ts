import assert from "node:assert/strict";
import { extractItems, extractRecord } from "../src/api/response";

const subscriptions = [
  { id: "1", title: "A", media_type: "tv", is_active: true },
  { id: "2", title: "B", media_type: "movie", is_active: false },
];

assert.deepEqual(
  extractItems<typeof subscriptions[number]>(subscriptions),
  subscriptions,
  "plain array responses should remain arrays",
);

assert.deepEqual(
  extractItems<typeof subscriptions[number]>({ items: subscriptions }),
  subscriptions,
  "object responses with items should return the items array",
);

assert.deepEqual(
  extractItems({ items: null }),
  [],
  "malformed list responses should fall back to an empty array",
);

assert.deepEqual(
  extractRecord({ items: { "tv:1": { exists_in_emby: true } } }, ["status_map", "items"]),
  { "tv:1": { exists_in_emby: true } },
  "status map endpoints may return the map under items",
);

assert.deepEqual(
  extractRecord({ status_map: { "movie:2": { exists_in_emby: false } } }, ["status_map", "items"]),
  { "movie:2": { exists_in_emby: false } },
  "legacy status map payloads may return status_map directly",
);

console.log("apiResponse normalization tests passed");
