import type { WatchlistFillResult } from "../api/types";

export type WatchlistFillLogLevel = "SUCCESS" | "WARN" | "ERROR";

export interface WatchlistFillLog {
  level: WatchlistFillLogLevel;
  message: string;
}

function normalizeCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

export function buildWatchlistFillLog(
  watchlistName: string,
  result?: WatchlistFillResult | null,
): WatchlistFillLog {
  const name = String(result?.watchlist_name || watchlistName || "未命名片单").trim();
  const backendMessage = String(result?.message || "").trim();
  const failed = normalizeCount(result?.failed);

  if (result?.success === false) {
    return {
      level: "ERROR",
      message: backendMessage || `片单 [${name}] 自动填充失败`,
    };
  }

  if (failed > 0) {
    return {
      level: "WARN",
      message: backendMessage || `片单 [${name}] 自动填充部分失败：失败 ${failed}`,
    };
  }

  return {
    level: "SUCCESS",
    message: backendMessage || `片单 [${name}] 自动填充完成`,
  };
}
