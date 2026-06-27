export interface TgRuntimeFormValues {
  apiId: string;
  apiHash: string;
  phone: string;
  channelsInput: string;
  searchDays: number;
  maxMessagesPerChannel: number;
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
