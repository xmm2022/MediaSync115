import assert from "node:assert/strict";
import {
  buildTgRuntimePayload,
  formatTgChannelsInput,
  parseTgChannelsInput,
} from "../src/utils/tgRuntimeSettings.ts";

assert.deepEqual(parseTgChannelsInput("@alpha, beta\nhttps://t.me/gamma  @alpha"), [
  "@alpha",
  "beta",
  "https://t.me/gamma",
]);

assert.equal(formatTgChannelsInput(["@alpha", "beta", ""]), "@alpha\nbeta");

assert.deepEqual(
  buildTgRuntimePayload({
    apiId: " 123456 ",
    apiHash: " abcdef ",
    phone: " +8613800000000 ",
    channelsInput: "@alpha\nbeta",
    searchDays: 45,
    maxMessagesPerChannel: 500,
  }),
  {
    tg_api_id: "123456",
    tg_api_hash: "abcdef",
    tg_phone: "+8613800000000",
    tg_channel_usernames: ["@alpha", "beta"],
    tg_search_days: 45,
    tg_max_messages_per_channel: 500,
  },
);

assert.deepEqual(
  buildTgRuntimePayload({
    apiId: "",
    apiHash: "",
    phone: "",
    channelsInput: "",
    searchDays: 0,
    maxMessagesPerChannel: 0,
  }),
  {
    tg_api_id: null,
    tg_api_hash: null,
    tg_phone: null,
    tg_channel_usernames: [],
    tg_search_days: null,
    tg_max_messages_per_channel: null,
  },
);

console.log("tg runtime settings tests passed");
