export const ACTIVE_ARCHIVE_TASK_STATUS = "processing";

export const LOG_TOTAL_LIST_PARAMS = { limit: 1 } as const;

export const DEFAULT_EXPLORE_BOARD = "douban";

export function getExplorePosterSrc(url: string): string {
  const value = String(url || "").trim();
  if (!value || value.startsWith("data:") || value.startsWith("/api/")) {
    return value;
  }
  return `/api/search/explore/poster?url=${encodeURIComponent(value)}`;
}
