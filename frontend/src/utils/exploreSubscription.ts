import type { ExploreItem } from "../api/types";

export type ExploreBoardKey = "tmdb" | "douban" | "animation";

export type ExploreSubscriptionCreatePayload = {
  douban_id?: string;
  tmdb_id?: number;
  title: string;
  media_type: "movie" | "tv";
  year?: string;
  rating?: number;
  auto_download: boolean;
};

type BuildResult =
  | { ok: true; payload: ExploreSubscriptionCreatePayload }
  | { ok: false; message: string };

function normalizeTitle(title: string): string {
  return String(title || "未知标题")
    .replace(/\s+\(\d{4}\)\s*$/, "")
    .trim() || "未知标题";
}

function normalizeMediaType(item: ExploreItem, board: ExploreBoardKey): "movie" | "tv" {
  if (board === "animation") return "tv";
  return String(item.media_type || "").toLowerCase() === "tv" ? "tv" : "movie";
}

function normalizeTmdbId(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeDoubanId(item: ExploreItem): string | undefined {
  const id = String(item.douban_id || item.id || "").trim();
  return id && /^\d+$/.test(id) ? id : undefined;
}

export function buildExploreSubscriptionPayload(
  item: ExploreItem,
  board: ExploreBoardKey,
): BuildResult {
  const doubanId = normalizeDoubanId(item);
  const tmdbId = normalizeTmdbId(item.tmdb_id);

  if (!doubanId && !tmdbId) {
    return { ok: false, message: "缺少豆瓣或 TMDB ID，无法创建订阅" };
  }

  const payload: ExploreSubscriptionCreatePayload = {
    title: normalizeTitle(item.title),
    media_type: normalizeMediaType(item, board),
    auto_download: true,
  };

  if (doubanId) payload.douban_id = doubanId;
  if (tmdbId) payload.tmdb_id = tmdbId;
  if (item.year) payload.year = String(item.year).slice(0, 4);
  if (typeof item.rating === "number") payload.rating = item.rating;

  return { ok: true, payload };
}
