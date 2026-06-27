import assert from "node:assert/strict";
import {
  buildTgBotRuntimePayload,
  formatIdListInput,
  parseIdListInput,
} from "../src/utils/tgRuntimeSettings.ts";

assert.deepEqual(parseIdListInput("123, 456\nabc 789 123"), [123, 456, 789]);
assert.equal(formatIdListInput([123, "456", null, ""]), "123\n456");

assert.deepEqual(
  buildTgBotRuntimePayload({
    token: " 123:abc ",
    enabled: true,
    allowedUsersInput: "111\n222",
    notifyChatIdsInput: "-100123,333",
    hdhiveAutoUnlock: true,
  }),
  {
    tg_bot_token: "123:abc",
    tg_bot_enabled: true,
    tg_bot_allowed_users: [111, 222],
    tg_bot_notify_chat_ids: [-100123, 333],
    tg_bot_hdhive_auto_unlock: true,
  },
);

assert.deepEqual(
  buildTgBotRuntimePayload({
    token: "",
    enabled: false,
    allowedUsersInput: "",
    notifyChatIdsInput: "",
    hdhiveAutoUnlock: false,
  }),
  {
    tg_bot_token: null,
    tg_bot_enabled: false,
    tg_bot_allowed_users: [],
    tg_bot_notify_chat_ids: [],
    tg_bot_hdhive_auto_unlock: false,
  },
);

console.log("tg bot runtime settings tests passed");
