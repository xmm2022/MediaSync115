import React, { useState, useEffect, useCallback } from "react";
import {
  Sparkles,
  Trophy,
  Star,
  Search,
  BookmarkCheck,
  ArrowRight,
  Eye,
  Loader2,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { motion } from "motion/react";
import { searchApi } from "../api/search";
import { getApiErrorMessage } from "../api/errors";
import EmptyState from "./ui/EmptyState";
import type { ExploreItem } from "../api/types";
import { DEFAULT_EXPLORE_BOARD, getExplorePosterSrc } from "../utils/runtimeDefaults";
import type { ExploreBoardKey } from "../utils/exploreSubscription";
import { PageName, type DetailContext, type MediaResourceLink } from "../types";
import { mapSearchItemToResource, type SearchResourceItem } from "../utils/searchResources";
import LibraryBadge, { buildBadgeKey, mergeStatusMap, type BadgeStatus } from "./LibraryBadge";

interface ExploreTabProps {
  onNavigateToDetail: (ctx: DetailContext) => void;
}

/*
 * 后端探索 API 真实支持的 source 参数：
 *   - "douban"：豆瓣榜单 (9 个 section，含 movie_hot/movie_showing/movie_latest/
 *     movie_top250/tv_hot/tv_variety/tv_domestic/tv_american/tv_animation)
 *   - "tmdb"：TMDB 榜单 (12 个 section，含 trending/popular/top_rated 等)
 *   - 另有独立 /explore/popular (stevenlu) 端点，非 primary explore source
 *
 * 后端不存在 "netflix" 或 "anime" 独立 source。
 * 三个 tab 映射策略：
 *   1. "TMDB 流行趋势" (原 Netflix)  → source=tmdb，展平全部 TMDB section
 *   2. "豆瓣电影榜单"                → source=douban，仅电影类 section
 *   3. "豆瓣动画" (原 当季新番)       → source=douban，仅 tv_animation section
 *
 * Tab 标题已据实标注来源名，不虚构 Netflix/Anime 榜单。
 */

const DOUBAN_MOVIE_SECTION_KEYS = [
  "movie_hot",
  "movie_showing",
  "movie_latest",
  "movie_top250",
] as const;

const DOUBAN_ANIME_SECTION_KEY = "tv_animation";

const FALLBACK_POSTER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='176' viewBox='0 0 120 176'%3E%3Crect fill='%23e2e8f0' width='120' height='176'/%3E%3Ctext x='60' y='92' text-anchor='middle' fill='%2394a3b8' font-size='12'%3ENo Poster%3C/text%3E%3C/svg%3E";

type DirectResourceSourceKey = "115_hdhive" | "115_tg" | "magnet_seedhub";
type ExploreMediaType = "movie" | "tv" | "collection" | "person";

const DIRECT_RESOURCE_SOURCES: { key: DirectResourceSourceKey; label: string; desc: string }[] = [
  { key: "115_hdhive", label: "115·HDHive", desc: "按关键词查询 HDHive 网盘资源" },
  { key: "115_tg", label: "115·TG", desc: "按关键词查询 Telegram 频道资源" },
  { key: "magnet_seedhub", label: "磁力·SeedHub", desc: "按关键词查询 SeedHub 磁力资源" },
];

interface ResourceLinkRaw {
  title?: string;
  name?: string;
  size?: string | number;
  seeds?: number;
  pick_code?: string;
  pickcode?: string;
  share_link?: string;
  share_url?: string;
  url?: string;
  receive_code?: string;
  access_code?: string;
  source_service?: string;
  resolution?: string;
  slug?: string;
  unlocked?: boolean;
  magnet?: string;
  info_hash?: string;
}

type ExploreSectionPayload = {
  section?: {
    key?: string;
    title?: string;
    items?: ExploreItem[];
  };
  key?: string;
  title?: string;
  items?: ExploreItem[];
  emby_status_map?: Record<string, unknown>;
  feiniu_status_map?: Record<string, unknown>;
};

function normalizeSectionPayload(data: unknown) {
  const payload = data as ExploreSectionPayload;
  const section = payload.section ?? payload;
  const items = Array.isArray(section?.items) ? section.items : [];
  return {
    key: section?.key,
    title: section?.title,
    items,
    embyStatusMap: payload.emby_status_map,
    feiniuStatusMap: payload.feiniu_status_map,
  };
}

function formatSize(bytes: number): string {
  if (bytes >= 1 << 40) return (bytes / (1 << 40)).toFixed(1) + " TB";
  if (bytes >= 1 << 30) return (bytes / (1 << 30)).toFixed(1) + " GB";
  if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(1) + " MB";
  if (bytes >= 1 << 10) return (bytes / (1 << 10)).toFixed(1) + " KB";
  return bytes + " B";
}

function extractResourceLinks(rawData: unknown): ResourceLinkRaw[] {
  if (Array.isArray(rawData)) return rawData as ResourceLinkRaw[];
  if (!rawData || typeof rawData !== "object") return [];
  const payload = rawData as Record<string, unknown>;
  return (payload.list as ResourceLinkRaw[])
    || (payload.items as ResourceLinkRaw[])
    || (payload.resources as ResourceLinkRaw[])
    || (payload.links as ResourceLinkRaw[])
    || (payload.magnets as ResourceLinkRaw[])
    || [];
}

function mapResourceLinks(rawLinks: ResourceLinkRaw[]): MediaResourceLink[] {
  return rawLinks.map((rl) => {
    const shareUrl = rl.share_link || rl.share_url || rl.url || "";
    const magnetUrl = rl.magnet || (rl.info_hash ? `magnet:?xt=urn:btih:${rl.info_hash}` : "");
    const receiveCode =
      rl.receive_code ||
      rl.access_code ||
      (() => {
        const match = shareUrl.match(/[?&](?:password|pwd|receive_code)=([^&#]+)/i);
        return match ? match[1] : "";
      })();

    return {
      name: rl.title || rl.name || "未命名资源",
      size: typeof rl.size === "number" ? formatSize(rl.size) : String(rl.size || "未知"),
      seeds: rl.seeds,
      pickcode: rl.pick_code || rl.pickcode,
      url: shareUrl || magnetUrl || "",
      shareUrl,
      receiveCode,
      sourceService: rl.source_service,
      resolution: rl.resolution,
      slug: rl.slug,
      unlocked: rl.unlocked,
      magnetUrl,
    };
  });
}

function getDirectResourceSourceLabel(source: DirectResourceSourceKey) {
  return DIRECT_RESOURCE_SOURCES.find((item) => item.key === source)?.label || source;
}

function normalizeTitleKeyword(title: string) {
  return title.split(" (")[0].trim();
}

function normalizeExploreMediaType(value?: string): ExploreMediaType {
  const raw = String(value || "movie").toLowerCase();
  if (raw === "tv" || raw === "collection" || raw === "person") return raw;
  return "movie";
}

function getExploreMediaTypeLabel(value?: string) {
  const mediaType = normalizeExploreMediaType(value);
  if (mediaType === "tv") return "剧集";
  if (mediaType === "collection") return "合集";
  if (mediaType === "person") return "人物";
  return "电影";
}

function canOpenMediaDetail(value?: string): value is "movie" | "tv" {
  const mediaType = normalizeExploreMediaType(value);
  return mediaType === "movie" || mediaType === "tv";
}

function mapSearchResultToExploreItem(item: SearchResourceItem, idx: number): ExploreItem {
  const resource = mapSearchItemToResource(item, undefined, { allowIdAsTmdb: true });
  const mediaType = normalizeExploreMediaType(resource.media_type);
  return {
    rank: idx + 1,
    id: resource.tmdb_id || item.id || `search-${idx}`,
    douban_id: item.douban_id,
    tmdb_id: resource.tmdb_id,
    media_type: mediaType,
    title: resource.title,
    year: resource.year > 0 ? String(resource.year) : undefined,
    poster_url: resource.poster,
    intro: resource.description,
    rating: resource.rating || undefined,
    genres: item.genres || item.tags,
  };
}

export default function ExploreTab({ onNavigateToDetail }: ExploreTabProps) {
  const [activeBoard, setActiveBoard] = useState<ExploreBoardKey>(DEFAULT_EXPLORE_BOARD);
  const [items, setItems] = useState<ExploreItem[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, BadgeStatus>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionTitle, setSectionTitle] = useState("");
  const [detailState, setDetailState] = useState<Record<string, { status: "loading" | "error"; message: string }>>({});

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ExploreItem[]>([]);
  const [searchStatusMap, setSearchStatusMap] = useState<Record<string, BadgeStatus>>({});
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  const [directOpen, setDirectOpen] = useState(false);
  const [directKeyword, setDirectKeyword] = useState("");
  const [directSource, setDirectSource] = useState<DirectResourceSourceKey>("115_hdhive");
  const [directMediaType, setDirectMediaType] = useState<"movie" | "tv">("movie");
  const [directResults, setDirectResults] = useState<MediaResourceLink[]>([]);
  const [directLoading, setDirectLoading] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);

  const fetchBoard = useCallback(async (board: ExploreBoardKey) => {
    setLoading(true);
    setError(null);
    setItems([]);
    setStatusMap({});

    try {
      const agg: Record<string, BadgeStatus> = {};
      if (board === "tmdb") {
        const { data } = await searchApi.getExploreSections("tmdb", 24, false);
        const allItems: ExploreItem[] = [];
        const sections = data?.sections ?? [];
        for (const sec of sections) {
          if (sec.items && Array.isArray(sec.items)) {
            for (const it of sec.items) {
              allItems.push(it as ExploreItem);
            }
          }
        }
        setItems(allItems);
        setSectionTitle("TMDB 流行趋势");
        mergeStatusMap(agg, data?.emby_status_map as Record<string, unknown> | undefined, "emby");
        mergeStatusMap(agg, data?.feiniu_status_map as Record<string, unknown> | undefined, "feiniu");
      } else if (board === "douban") {
        const responses = await Promise.all(
          DOUBAN_MOVIE_SECTION_KEYS.map((key) =>
            searchApi.getExploreDoubanSection(key, 24, false, 0),
          ),
        );
        const allItems: ExploreItem[] = [];
        for (const response of responses) {
          const section = normalizeSectionPayload(response.data);
          for (const item of section.items) {
            allItems.push(item);
          }
          mergeStatusMap(agg, section.embyStatusMap, "emby");
          mergeStatusMap(agg, section.feiniuStatusMap, "feiniu");
        }
        setItems(allItems);
        setSectionTitle("豆瓣电影榜单");
      } else {
        const { data } = await searchApi.getExploreDoubanSection(
          DOUBAN_ANIME_SECTION_KEY,
          24,
          false,
          0,
        );
        const section = normalizeSectionPayload(data);
        setItems(section.items);
        setSectionTitle(section?.title || "豆瓣动画");
        mergeStatusMap(agg, section.embyStatusMap, "emby");
        mergeStatusMap(agg, section.feiniuStatusMap, "feiniu");
      }
      setStatusMap(agg);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, "探索数据加载失败，请稍后重试"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoard(activeBoard);
  }, [activeBoard, fetchBoard]);

  const runMediaSearch = async (event?: React.FormEvent, forcedKeyword?: string) => {
    event?.preventDefault();
    const keyword = (forcedKeyword ?? searchQuery).trim();
    if (forcedKeyword !== undefined) {
      setSearchQuery(keyword);
    }
    if (!keyword) {
      setHasSearched(false);
      setSearchResults([]);
      setSearchStatusMap({});
      setSearchError(null);
      return;
    }

    setHasSearched(true);
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults([]);
    setSearchStatusMap({});
    try {
      const response = await searchApi.search(keyword, 1);
      const data = response.data as {
        items?: SearchResourceItem[];
        results?: SearchResourceItem[];
        emby_status_map?: Record<string, unknown>;
        feiniu_status_map?: Record<string, unknown>;
      };
      const rawItems = Array.isArray(data.items) ? data.items : Array.isArray(data.results) ? data.results : [];
      const mapped = rawItems.map((item, idx) => mapSearchResultToExploreItem(item, idx));
      const agg: Record<string, BadgeStatus> = {};
      mergeStatusMap(agg, data.emby_status_map, "emby");
      mergeStatusMap(agg, data.feiniu_status_map, "feiniu");
      setSearchResults(mapped);
      setSearchStatusMap(agg);
      if (mapped.length === 0) {
        setSearchError(`未搜索到「${keyword}」相关影视，可展开高级直搜按标题查资源。`);
      }
    } catch (err) {
      setSearchResults([]);
      setSearchError(getApiErrorMessage(err, "影视搜索失败，请检查 TMDB 搜索配置后重试"));
    } finally {
      setSearchLoading(false);
    }
  };

  const runDirectSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const keyword = (directKeyword.trim() || searchQuery.trim()).trim();
    if (!keyword) {
      setDirectError("请输入要直搜的标题关键词");
      setDirectResults([]);
      return;
    }

    if (!directKeyword.trim()) {
      setDirectKeyword(keyword);
    }

    setDirectLoading(true);
    setDirectError(null);
    setDirectResults([]);
    try {
      const response =
        directSource === "115_hdhive"
          ? await searchApi.getHdhivePan115ByKeyword(keyword, directMediaType)
          : directSource === "115_tg"
            ? await searchApi.getTgPan115ByKeyword(keyword, directMediaType)
            : await searchApi.getSeedhubMagnetByKeyword(keyword, directMediaType, 80);
      const links = mapResourceLinks(extractResourceLinks(response.data));
      setDirectResults(links);
      if (links.length === 0) {
        setDirectError(`${getDirectResourceSourceLabel(directSource)} 未返回「${keyword}」相关资源`);
      }
    } catch (err) {
      setDirectError(getApiErrorMessage(err, "高级直搜失败，请稍后重试"));
    } finally {
      setDirectLoading(false);
    }
  };

  const openDetail = async (item: ExploreItem, idx: number, scope: "board" | "search" = "board") => {
    const title = item.title || "未知标题";
    const key = `${scope}:${item.id ?? idx}`;
    const normalizedMediaType = normalizeExploreMediaType(item.media_type);
    if (!canOpenMediaDetail(normalizedMediaType)) {
      setDetailState((prev) => ({
        ...prev,
        [key]: {
          status: "error",
          message:
            normalizedMediaType === "person"
              ? "人物结果请到关注影人中管理，暂不支持打开为影视详情。"
              : "合集结果暂不支持直接打开影视详情。",
        },
      }));
      return;
    }
    const mediaType: "movie" | "tv" = normalizedMediaType;
    const navigate = (tmdbId: number) => {
      onNavigateToDetail({
        tmdbId,
        mediaType,
        title,
        poster: getExplorePosterSrc(item.poster_url || "") || "",
        returnTo: PageName.EXPLORE,
      });
    };

    if (item.tmdb_id && Number(item.tmdb_id) > 0) {
      navigate(Number(item.tmdb_id));
      return;
    }

    setDetailState((prev) => ({
      ...prev,
      [key]: { status: "loading", message: "正在解析详情..." },
    }));

    try {
      const response = await searchApi.resolveExploreItem({
        source: scope === "search" || activeBoard === "tmdb" ? "tmdb" : "douban",
        media_type: mediaType,
        tmdb_id: item.tmdb_id,
        douban_id: item.douban_id || String(item.id || ""),
        title,
        year: item.year,
      });
      const data = response.data as { resolved?: boolean; tmdb_id?: number | string; media_type?: string };
      const tmdbId = Number(data.tmdb_id);
      if (data.resolved && Number.isInteger(tmdbId) && tmdbId > 0) {
        navigate(tmdbId);
        return;
      }
      throw new Error("未能匹配到 TMDB 详情");
    } catch (err) {
      const fallbackKeyword = normalizeTitleKeyword(title);
      const message = getApiErrorMessage(err, "无法打开详情，已在当前页切换到影视搜索");
      setDetailState((prev) => ({
        ...prev,
        [key]: { status: "error", message },
      }));
      if (fallbackKeyword) {
        void runMediaSearch(undefined, fallbackKeyword);
      }
    }
  };

  const renderMediaCard = (
    item: ExploreItem,
    idx: number,
    options: { scope: "board" | "search"; showRank: boolean; badges: Record<string, BadgeStatus> },
  ) => {
    const stateKey = `${options.scope}:${item.id ?? idx}`;
    const poster = getExplorePosterSrc(item.poster_url || "") || FALLBACK_POSTER;
    const title = item.title || "未知标题";
    const desc = item.intro || item.year || "暂无简介";
    const rating =
      item.rating != null ? (typeof item.rating === "number" ? item.rating.toFixed(1) : String(item.rating)) : null;
    const rankLabel = item.rank ?? idx + 1;
    const bKey = buildBadgeKey(item.media_type, item.tmdb_id);
    const badge = bKey ? <LibraryBadge status={options.badges[bKey]} /> : null;
    const leftPad = options.showRank ? "pl-4" : "";
    const detailSupported = canOpenMediaDetail(item.media_type);

    return (
      <div
        key={`${options.scope}-${item.id ?? idx}-${idx}`}
        className="liquid-card glass glass-hover rounded-2xl p-4 flex gap-4 transition-all relative overflow-visible"
      >
        {options.showRank && (
          <div
            className={`absolute top-0 left-0 w-8 h-8 flex items-center justify-center rounded-br-2xl font-black text-xs text-white ${
              rankLabel === 1
                ? "bg-amber-500"
                : rankLabel === 2
                  ? "bg-slate-400"
                  : rankLabel === 3
                    ? "bg-amber-700"
                    : "bg-slate-500"
            }`}
          >
            #{rankLabel}
          </div>
        )}

        <div className="w-20 h-28 rounded-xl overflow-hidden shrink-0 relative mt-2" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
          <img
            src={poster}
            alt={title}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            loading="lazy"
            onError={(event) => {
              const img = event.target as HTMLImageElement;
              if (img.src !== FALLBACK_POSTER) {
                img.src = FALLBACK_POSTER;
              }
            }}
          />
        </div>

        <div className="flex-1 flex flex-col justify-between pt-1 min-w-0">
          <div>
            <div className={`flex items-start justify-between gap-2 ${leftPad}`}>
              <h4 className="font-headline font-bold text-sm truncate leading-snug" style={{ color: "var(--txt)" }}>
                {title}
              </h4>
            </div>

            <div className={`flex gap-2 items-center text-[10px] font-bold mt-0.5 ${leftPad}`} style={{ color: "var(--txt-muted)" }}>
              {rating && (
                <>
                  <span className="flex items-center text-amber-500 gap-0.5">
                    <Star className="w-3.5 h-3.5 fill-current" />
                    <span>{rating} 分</span>
                  </span>
                  <span>.</span>
                </>
              )}
              <span className="text-brand-primary">
                {getExploreMediaTypeLabel(item.media_type)}
              </span>
              {item.year && (
                <>
                  <span>.</span>
                  <span style={{ color: "var(--txt-muted)" }}>{item.year}</span>
                </>
              )}
            </div>

            {badge && <div className={`${leftPad} mt-1.5`}>{badge}</div>}

            <p className={`text-xs line-clamp-2 mt-2 leading-relaxed ${leftPad}`} style={{ color: "var(--txt-secondary)" }}>
              {desc}
            </p>
          </div>

          <div className="flex justify-end gap-2 mt-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
            <button
              type="button"
              onClick={() => openDetail(item, idx, options.scope)}
              disabled={detailState[stateKey]?.status === "loading" || !detailSupported}
              title={detailSupported ? "打开资源详情" : "该类型暂不支持打开资源详情"}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-black hover:text-brand-primary transition-all flex items-center gap-1 glass-hover disabled:opacity-60 ${
                detailSupported ? "cursor-pointer" : "cursor-not-allowed"
              }`}
              style={{ color: "var(--txt-secondary)", background: "var(--surface-subtle)", border: "1px solid var(--border)" }}
            >
              {detailState[stateKey]?.status === "loading" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5" />
              )}
              <span>{detailState[stateKey]?.status === "loading" ? "打开中" : detailSupported ? "资源详情" : "暂不支持"}</span>
            </button>
          </div>

          {detailState[stateKey]?.status === "error" && (
            <p className="text-[10px] font-bold mt-2 text-right" style={{ color: "var(--accent-danger)" }}>
              {detailState[stateKey]?.message}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div id="explore-tab-container" className="liquid-page space-y-6">
      <div className="liquid-hero glass-heavy glass-iridescent glass-spotlight rounded-3xl p-6 relative overflow-hidden">
        <div className="relative z-10 space-y-5">
          <div>
            <h2 className="text-2xl font-black tracking-tight flex items-center gap-2.5" style={{ color: "var(--txt)" }}>
              <Search className="w-6.5 h-6.5 text-brand-primary" />
              <span>影视发现</span>
            </h2>
            <p className="text-xs mt-1 max-w-2xl leading-relaxed" style={{ color: "var(--txt-secondary)" }}>
              先搜索影视条目进入资源详情；没有明确目标时再浏览 TMDB 与豆瓣榜单，高级直搜只作为找不到详情时的兜底。
            </p>
          </div>

          <form onSubmit={runMediaSearch} className="flex flex-col lg:flex-row gap-3 max-w-4xl">
            <label className="flex-1 min-w-0">
              <span className="text-[10px] font-bold block mb-1.5" style={{ color: "var(--txt-muted)" }}>影视搜索</span>
              <div className="flex items-center gap-2 rounded-2xl px-3 py-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                <Search className="w-4.5 h-4.5 shrink-0" style={{ color: "var(--txt-muted)" }} />
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="输入片名、剧名或英文名"
                  className="w-full bg-transparent text-sm font-semibold focus:outline-none"
                  style={{ color: "var(--txt)" }}
                />
              </div>
            </label>

            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={searchLoading}
                className="h-11 px-5 rounded-2xl text-xs font-black text-white bg-brand-primary hover:bg-brand-primary-light transition-all flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
              >
                {searchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                <span>{searchLoading ? "搜索中" : "搜索影视"}</span>
              </button>
              <button
                type="button"
                onClick={() => setDirectOpen((prev) => !prev)}
                className="h-11 px-4 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 glass-hover cursor-pointer"
                style={{ color: directOpen ? "var(--brand-primary)" : "var(--txt-secondary)", background: "var(--surface-subtle)", border: "1px solid var(--border)" }}
              >
                <SlidersHorizontal className="w-4 h-4" />
                <span>高级直搜</span>
              </button>
            </div>
          </form>
        </div>
        <div className="absolute right-6 top-6 opacity-10 select-none">
          <Sparkles className="w-24 h-24 text-indigo-500" />
        </div>
      </div>

      {(hasSearched || searchLoading || searchError) && (
        <section className="liquid-panel glass-heavy glass-iridescent rounded-3xl p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
                <Search className="w-4 h-4 text-brand-primary" />
                <span>影视搜索结果</span>
              </h3>
              <p className="text-[10px] font-semibold mt-0.5" style={{ color: "var(--txt-muted)" }}>
                点击资源详情后统一在详情页查看 115、夸克、磁力等资源渠道。
              </p>
            </div>
          </div>

          {searchLoading && (
            <div className="flex items-center justify-center py-12 gap-3" style={{ color: "var(--txt-muted)" }}>
              <Loader2 className="w-6 h-6 animate-spin text-brand-primary" />
              <span className="text-xs font-semibold">正在搜索影视条目...</span>
            </div>
          )}

          {!searchLoading && searchError && (
            <div className="rounded-2xl px-4 py-3 text-xs font-semibold flex items-center gap-2" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", color: "var(--accent-warn)" }}>
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{searchError}</span>
            </div>
          )}

          {!searchLoading && searchResults.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {searchResults.map((item, idx) =>
                renderMediaCard(item, idx, {
                  scope: "search",
                  showRank: false,
                  badges: searchStatusMap,
                }),
              )}
            </div>
          )}
        </section>
      )}

      {directOpen && (
        <section className="liquid-panel glass rounded-2xl p-5 space-y-4" style={{ border: "1px solid var(--border)" }}>
          <div className="flex flex-col lg:flex-row lg:items-end gap-3">
            <label className="flex-1 min-w-0">
              <span className="text-[10px] font-bold block mb-1.5" style={{ color: "var(--txt-muted)" }}>高级直搜关键词</span>
              <input
                value={directKeyword}
                onChange={(event) => setDirectKeyword(event.target.value)}
                placeholder={searchQuery || "输入精确标题或资源关键词"}
                className="w-full rounded-2xl px-3 py-3 bg-transparent text-sm font-semibold focus:outline-none"
                style={{ color: "var(--txt)", background: "var(--surface-subtle)", border: "1px solid var(--border)" }}
              />
            </label>

            <label className="w-full lg:w-44">
              <span className="text-[10px] font-bold block mb-1.5" style={{ color: "var(--txt-muted)" }}>类型</span>
              <select
                value={directMediaType}
                onChange={(event) => setDirectMediaType(event.target.value === "tv" ? "tv" : "movie")}
                className="w-full h-11 rounded-2xl px-3 bg-transparent text-xs font-black focus:outline-none"
                style={{ color: "var(--txt)", background: "var(--surface-subtle)", border: "1px solid var(--border)" }}
              >
                <option value="movie">电影</option>
                <option value="tv">剧集</option>
              </select>
            </label>

            <label className="w-full lg:w-56">
              <span className="text-[10px] font-bold block mb-1.5" style={{ color: "var(--txt-muted)" }}>来源</span>
              <select
                value={directSource}
                onChange={(event) => setDirectSource(event.target.value as DirectResourceSourceKey)}
                className="w-full h-11 rounded-2xl px-3 bg-transparent text-xs font-black focus:outline-none"
                style={{ color: "var(--txt)", background: "var(--surface-subtle)", border: "1px solid var(--border)" }}
              >
                {DIRECT_RESOURCE_SOURCES.map((source) => (
                  <option key={source.key} value={source.key}>{source.label}</option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={runDirectSearch}
              disabled={directLoading}
              className="h-11 px-5 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 glass-hover disabled:opacity-60 cursor-pointer"
              style={{ color: "var(--txt-secondary)", background: "var(--surface-subtle)", border: "1px solid var(--border)" }}
            >
              {directLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span>{directLoading ? "直搜中" : "开始直搜"}</span>
            </button>
          </div>

          <p className="text-[10px] font-semibold leading-relaxed" style={{ color: "var(--txt-muted)" }}>
            当前为兜底检索，只展示来源返回的资源链接；能匹配到影视条目时仍建议进入资源详情使用统一渠道。
          </p>

          {directError && (
            <div className="rounded-2xl px-4 py-3 text-xs font-semibold flex items-center gap-2" style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)", color: "var(--accent-warn)" }}>
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{directError}</span>
            </div>
          )}

          {directResults.length > 0 && (
            <div className="space-y-2">
              {directResults.map((link, idx) => (
                <div
                  key={`${link.url || link.name}-${idx}`}
                  className="rounded-2xl px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                  style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-black truncate" style={{ color: "var(--txt)" }}>{link.name}</p>
                    <p className="text-[10px] font-semibold mt-0.5" style={{ color: "var(--txt-muted)" }}>
                      {link.size || "未知大小"} · {link.sourceService || getDirectResourceSourceLabel(directSource)}
                      {link.resolution ? ` · ${link.resolution}` : ""}
                      {link.seeds != null ? ` · ${link.seeds} seeds` : ""}
                    </p>
                  </div>
                  {link.url ? (
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-2 rounded-xl text-[10px] font-black flex items-center justify-center gap-1.5 shrink-0 transition-all glass-hover"
                      style={{ color: "var(--txt-secondary)", background: "var(--surface)", border: "1px solid var(--border)" }}
                    >
                      <span>打开链接</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  ) : (
                    <span className="text-[10px] font-bold shrink-0" style={{ color: "var(--txt-muted)" }}>无可打开链接</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
            <Trophy className="w-4 h-4 text-amber-500" />
            <span>榜单探索</span>
          </h3>
          <p className="text-[10px] font-semibold mt-0.5" style={{ color: "var(--txt-muted)" }}>
            {sectionTitle || "从榜单挑选影视条目"}，点击资源详情后查看聚合资源渠道并选择订阅渠道。
          </p>
        </div>
        <button
          type="button"
          onClick={() => fetchBoard(activeBoard)}
          disabled={loading}
          className="px-3 py-2 rounded-xl text-[10px] font-black flex items-center gap-1.5 transition-all glass-hover disabled:opacity-60 cursor-pointer"
          style={{ color: "var(--txt-secondary)", background: "var(--surface-subtle)", border: "1px solid var(--border)" }}
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          <span>刷新榜单</span>
        </button>
      </div>

      <div className="liquid-toolbar flex flex-wrap gap-1" style={{ borderBottom: "1px solid var(--border)" }}>
        <button
          type="button"
          onClick={() => setActiveBoard("tmdb")}
          className={`px-5 py-3.5 text-xs font-black relative flex items-center gap-2 transition-all cursor-pointer ${
            activeBoard === "tmdb" ? "text-brand-primary" : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <span>TMDB 流行趋势</span>
          {activeBoard === "tmdb" && (
            <motion.div layoutId="exploreUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-primary" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveBoard("douban")}
          className={`px-5 py-3.5 text-xs font-black relative flex items-center gap-2 transition-all cursor-pointer ${
            activeBoard === "douban" ? "text-brand-primary" : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <span>豆瓣电影榜单</span>
          {activeBoard === "douban" && (
            <motion.div layoutId="exploreUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-primary" />
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveBoard("animation")}
          className={`px-5 py-3.5 text-xs font-black relative flex items-center gap-2 transition-all cursor-pointer ${
            activeBoard === "animation" ? "text-brand-primary" : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <span>豆瓣动画</span>
          {activeBoard === "animation" && (
            <motion.div layoutId="exploreUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-primary" />
          )}
        </button>
      </div>

      {loading && (
        <div className="glass-heavy glass-iridescent rounded-3xl flex flex-col items-center justify-center py-20 gap-3" style={{ color: "var(--txt-muted)" }}>
          <Loader2 className="w-8 h-8 animate-spin text-brand-primary" />
          <span className="text-xs font-semibold">正在加载榜单数据...</span>
        </div>
      )}

      {!loading && error && (
        <div className="glass-heavy glass-iridescent rounded-3xl flex flex-col items-center justify-center py-20 gap-3">
          <AlertTriangle className="w-8 h-8 text-amber-500" />
          <p className="text-xs font-semibold max-w-md text-center" style={{ color: "var(--txt-secondary)" }}>{error}</p>
          <button
            type="button"
            onClick={() => fetchBoard(activeBoard)}
            className="px-4 py-2 rounded-xl text-xs font-black text-brand-primary border border-brand-primary/30 hover:bg-brand-primary/5 transition-all cursor-pointer"
          >
            重试
          </button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="glass-heavy glass-iridescent rounded-3xl flex flex-col items-center justify-center py-20" style={{ color: "var(--txt-muted)" }}>
          <EmptyState icon={<Eye className="w-8 h-8" />} text="暂无榜单数据" subtext="该来源暂时没有可展示的内容，请稍后刷新" />
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {items.map((item, idx) =>
            renderMediaCard(item, idx, {
              scope: "board",
              showRank: true,
              badges: statusMap,
            }),
          )}
        </div>
      )}

      <div className="liquid-panel glass glass-hover rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex gap-3 items-center text-left">
          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--surface-subtle)", color: "var(--brand-secondary)" }}>
            <BookmarkCheck className="w-5.5 h-5.5" />
          </div>
          <div>
            <h4 className="text-xs font-black" style={{ color: "var(--txt)" }}>找不到可匹配的影视详情？</h4>
            <p className="text-[10px] font-semibold leading-relaxed mt-0.5" style={{ color: "var(--txt-muted)" }}>
              展开高级直搜按关键词查单一来源；需要追更时仍建议在订阅中心配置订阅。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDirectOpen(true)}
          className="px-4 py-2 rounded-xl text-xs font-black tracking-wider flex items-center gap-1.5 shrink-0 transition-all active:scale-95 glass-hover cursor-pointer"
          style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
        >
          <span>打开高级直搜</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
