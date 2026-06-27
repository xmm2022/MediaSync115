import type { MediaResource } from "../types";
import { getExplorePosterSrc } from "./runtimeDefaults.ts";

export interface SearchResourceItem {
  id?: string | number;
  title?: string;
  name?: string;
  poster_path?: string;
  poster_url?: string;
  rating?: number;
  vote_average?: number;
  year?: number | string;
  release_date?: string;
  first_air_date?: string;
  media_type?: "movie" | "tv" | "collection" | string;
  tmdb_id?: number;
  douban_id?: string;
  overview?: string;
  intro?: string;
  genres?: string[];
  genre_ids?: number[];
  tags?: string[];
}

export function normalizeSearchPosterSrc(rawPoster?: string): string {
  const value = String(rawPoster || "").trim();
  if (!value) return "";
  if (value.startsWith("/") && !value.startsWith("/api/")) {
    return getExplorePosterSrc(`https://image.tmdb.org/t/p/w200${value}`);
  }
  return getExplorePosterSrc(value);
}

function normalizeTmdbId(item: SearchResourceItem): number | undefined {
  const value = item.tmdb_id ?? item.id;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeYear(item: SearchResourceItem): number {
  if (typeof item.year === "number") return item.year;
  const rawYear = String(item.year || item.release_date || item.first_air_date || "").slice(0, 4);
  const parsed = Number(rawYear);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function mapSearchItemToResource(
  item: SearchResourceItem,
  sectionTag?: string,
): MediaResource {
  const rawMediaType = String(item.media_type || "movie").toLowerCase();
  const mediaType: "movie" | "tv" | "collection" =
    rawMediaType === "tv" ? "tv" : rawMediaType === "collection" ? "collection" : "movie";
  const tmdbId = normalizeTmdbId(item);
  const category: "Movie" | "TV" | "Anime" = mediaType === "movie" ? "Movie" : "TV";
  const tags = [
    ...(item.genres || []),
    ...(item.tags || []),
    ...(sectionTag ? [sectionTag] : []),
  ].slice(0, 5);

  return {
    id: String(tmdbId || item.douban_id || item.id || Math.random()),
    title: item.title || item.name || "未命名",
    poster: normalizeSearchPosterSrc(item.poster_path || item.poster_url),
    rating: Number(item.rating || item.vote_average || 0),
    year: normalizeYear(item),
    category,
    description: item.overview || item.intro || "",
    tags,
    links: [],
    tmdb_id: tmdbId,
    media_type: mediaType,
  };
}
