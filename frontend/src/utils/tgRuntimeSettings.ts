export interface TgRuntimeFormValues {
  apiId: string;
  apiHash: string;
  phone: string;
  channelsInput: string;
  searchDays: number;
  maxMessagesPerChannel: number;
}

export interface TgBotRuntimeFormValues {
  token: string;
  enabled: boolean;
  allowedUsersInput: string;
  notifyChatIdsInput: string;
  hdhiveAutoUnlock: boolean;
}

export function parseTgChannelsInput(value: string): string[] {
  const seen = new Set<string>();
  const channels: string[] = [];

  String(value || "")
    .split(/[\s,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      if (seen.has(item)) return;
      seen.add(item);
      channels.push(item);
    });

  return channels;
}

export function formatTgChannelsInput(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join("\n");
}

export function parseIdListInput(value: string): number[] {
  const seen = new Set<number>();
  const ids: number[] = [];

  String(value || "")
    .split(/[\s,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      const id = Number(item);
      if (!Number.isSafeInteger(id) || seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    });

  return ids;
}

export function formatIdListInput(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

export function buildTgRuntimePayload(values: TgRuntimeFormValues): Record<string, unknown> {
  return {
    tg_api_id: values.apiId.trim() || null,
    tg_api_hash: values.apiHash.trim() || null,
    tg_phone: values.phone.trim() || null,
    tg_channel_usernames: parseTgChannelsInput(values.channelsInput),
    tg_search_days: Number.isFinite(values.searchDays) && values.searchDays > 0
      ? Math.round(values.searchDays)
      : null,
    tg_max_messages_per_channel:
      Number.isFinite(values.maxMessagesPerChannel) && values.maxMessagesPerChannel > 0
        ? Math.round(values.maxMessagesPerChannel)
        : null,
  };
}

export function buildTgBotRuntimePayload(values: TgBotRuntimeFormValues): Record<string, unknown> {
  return {
    tg_bot_token: values.token.trim() || null,
    tg_bot_enabled: values.enabled,
    tg_bot_allowed_users: parseIdListInput(values.allowedUsersInput),
    tg_bot_notify_chat_ids: parseIdListInput(values.notifyChatIdsInput),
    tg_bot_hdhive_auto_unlock: values.hdhiveAutoUnlock,
  };
}
