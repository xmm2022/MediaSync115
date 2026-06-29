import React, { useState, useEffect, useCallback, useRef } from "react";
import { MediaResource, MediaResourceLink, PageName, type DetailContext } from "../types";
import { Search, Film, Tv, Play, Download, CheckCircle, Flame, Plus, Shield, ExternalLink, RefreshCw } from "lucide-react";
import ErrorBanner from "./ui/ErrorBanner";
import { motion, AnimatePresence } from "motion/react";
import { searchApi } from "../api/search";
import { pan115Api } from "../api/pan115";
import { mapSearchItemToResource, normalizeSearchPosterSrc, type SearchResourceItem } from "../utils/searchResources";
import LibraryBadge, { buildBadgeKey, mergeStatusMap, type BadgeStatus } from "./LibraryBadge";
import Pan115Progress, { type Pan115ProgressState, deriveDefaultProgressState } from "./Pan115Progress";

interface SearchTabProps {
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => Promise<void>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onNavigateToDetail?: (ctx: DetailContext) => void;
}

// Link shape from GET /api/search/{media_type}/{tmdb_id}/resources
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

interface SeedhubTaskState {
  taskId: string;
  status: string;
  message: string;
}

/** 资源来源选项（多源资源浏览） */
type ResourceSourceKey =
  | "unified"
  | "115_pansou"
  | "115_hdhive"
  | "115_tg"
  | "quark_pansou"
  | "quark_hdhive"
  | "quark_tg"
  | "magnet_seedhub"
  | "magnet_butailing";

const RESOURCE_SOURCES: { key: ResourceSourceKey; label: string; desc: string }[] = [
  { key: "unified", label: "统一", desc: "后端统一聚合管道" },
  { key: "115_pansou", label: "115·盘搜", desc: "pansou 网盘资源" },
  { key: "115_hdhive", label: "115·HDHive", desc: "HDHive 网盘资源（可解锁）" },
  { key: "115_tg", label: "115·TG", desc: "Telegram 频道资源" },
  { key: "quark_pansou", label: "夸克·盘搜", desc: "夸克网盘·pansou" },
  { key: "quark_hdhive", label: "夸克·HDHive", desc: "夸克网盘·HDHive" },
  { key: "quark_tg", label: "夸克·TG", desc: "夸克网盘·Telegram" },
  { key: "magnet_seedhub", label: "磁力·SeedHub", desc: "SeedHub 磁力搜索" },
  { key: "magnet_butailing", label: "磁力·不淘", desc: "不淘磁力搜索" },
];

type DirectResourceSourceKey = "115_hdhive" | "115_tg" | "magnet_seedhub";
type SearchCategory = "All" | "Movie" | "TV" | "Anime";

const DIRECT_RESOURCE_SOURCES: { key: DirectResourceSourceKey; label: string }[] = [
  { key: "115_hdhive", label: "115·HDHive" },
  { key: "115_tg", label: "115·TG" },
  { key: "magnet_seedhub", label: "磁力·SeedHub" },
];

const DOUBAN_DISCOVER_SECTION_KEYS = [
  "movie_hot",
  "movie_showing",
  "movie_latest",
  "movie_top250",
  "tv_hot",
  "tv_american",
  "tv_animation",
] as const;

type DoubanDiscoverSectionKey = typeof DOUBAN_DISCOVER_SECTION_KEYS[number];

const DOUBAN_DISCOVER_SECTION_KEYS_BY_CATEGORY: Record<SearchCategory, readonly DoubanDiscoverSectionKey[]> = {
  All: DOUBAN_DISCOVER_SECTION_KEYS,
  Movie: ["movie_hot", "movie_showing", "movie_latest", "movie_top250"],
  TV: ["tv_american"],
  Anime: ["tv_animation"],
};

const SEARCH_CATEGORY_LABELS: Record<SearchCategory, string> = {
  All: "全部类型",
  Movie: "热门电影",
  TV: "热门美剧",
  Anime: "新番动漫",
};

const DISCOVER_SECTION_LIMIT = 24;
const DISCOVER_VISIBLE_LIMIT = 36;

function getDiscoverSectionKeys(category: SearchCategory) {
  if (category === "All") {
    return DOUBAN_DISCOVER_SECTION_KEYS.map((key) => key);
  }
  return [...(DOUBAN_DISCOVER_SECTION_KEYS_BY_CATEGORY[category] || DOUBAN_DISCOVER_SECTION_KEYS)];
}

type ExploreSectionPayload = {
  section?: {
    key?: string;
    title?: string;
    tag?: string;
    items?: SearchResourceItem[];
  };
  key?: string;
  title?: string;
  tag?: string;
  items?: SearchResourceItem[];
  emby_status_map?: Record<string, unknown>;
  feiniu_status_map?: Record<string, unknown>;
};

function normalizeExploreSectionPayload(data: unknown) {
  const payload = data as ExploreSectionPayload;
  const section = payload.section ?? payload;
  return {
    key: section?.key || payload.key || "",
    title: section?.title || "",
    tag: section?.tag,
    items: Array.isArray(section?.items) ? section.items : [],
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
        const m = shareUrl.match(/[?&](?:password|pwd|receive_code)=([^&#]+)/i);
        return m ? m[1] : "";
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

function isDirectResourceResult(resource: MediaResource) {
  return resource.id.startsWith("direct-resource:");
}

function dedupeDiscoverResources(items: MediaResource[]) {
  const seen = new Set<string>();
  return items.filter((resource) => {
    const key = resource.tmdb_id
      ? `${resource.media_type || "movie"}:${resource.tmdb_id}`
      : resource.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shuffleDiscoverResources(items: MediaResource[]) {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function isAnimeDiscoverSection(section: ReturnType<typeof normalizeExploreSectionPayload>) {
  const key = section.key.toLowerCase();
  const text = `${section.title} ${section.tag || ""}`;
  return key.includes("animation") || /动画|动漫|新番/.test(text);
}

function mapDiscoverItemToResource(
  item: SearchResourceItem,
  section: ReturnType<typeof normalizeExploreSectionPayload>,
) {
  const resource = mapSearchItemToResource(item, section.tag || section.title);
  if (isAnimeDiscoverSection(section)) {
    return { ...resource, category: "Anime" as const };
  }
  return resource;
}

function selectDiscoverResources(items: MediaResource[], category: SearchCategory) {
  const unique = shuffleDiscoverResources(dedupeDiscoverResources(items));
  if (category !== "All") {
    return unique.slice(0, DISCOVER_VISIBLE_LIMIT);
  }

  const buckets: Record<Exclude<SearchCategory, "All">, MediaResource[]> = {
    Movie: unique.filter((resource) => resource.category === "Movie"),
    TV: unique.filter((resource) => resource.category === "TV"),
    Anime: unique.filter((resource) => resource.category === "Anime"),
  };
  const result: MediaResource[] = [];
  const order: Exclude<SearchCategory, "All">[] = ["Movie", "TV", "Anime"];

  while (result.length < DISCOVER_VISIBLE_LIMIT) {
    let pushed = false;
    for (const key of order) {
      const item = buckets[key].shift();
      if (item) {
        result.push(item);
        pushed = true;
        if (result.length >= DISCOVER_VISIBLE_LIMIT) break;
      }
    }
    if (!pushed) break;
  }

  return result;
}

function buildResourceKeyword(resource: MediaResource) {
  const title = String(resource.title || "").trim();
  if (!title) return "";
  return resource.year > 0 ? `${title} ${resource.year}` : title;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function SearchTab({ addLog, searchQuery, setSearchQuery, onNavigateToDetail }: SearchTabProps) {
  const [resources, setResources] = useState<MediaResource[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<SearchCategory>("All");
  const [selectedResource, setSelectedResource] = useState<MediaResource | null>(null);
  const [transferringLinkId, setTransferringLinkId] = useState<string | null>(null);
  const [transferSuccessId, setTransferSuccessId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchMode, setSearchMode] = useState<"discover" | "keyword" | "direct">("discover");
  const [searchScope, setSearchScope] = useState<"media" | "direct">("media");
  const [directSource, setDirectSource] = useState<DirectResourceSourceKey>("115_hdhive");
  const [directMediaType, setDirectMediaType] = useState<"movie" | "tv">("movie");
  const [statusMap, setStatusMap] = useState<Record<string, BadgeStatus>>({});
  const [activeSource, setActiveSource] = useState<ResourceSourceKey>("unified");
  const [seedhubTask, setSeedhubTask] = useState<SeedhubTaskState | null>(null);
  const [unlockingSlug, setUnlockingSlug] = useState<string | null>(null);
  const [progress, setProgress] = useState<Pan115ProgressState>(deriveDefaultProgressState());
  const [tmdbSearchConfigured, setTmdbSearchConfigured] = useState<boolean | null>(null);
  const requestSeqRef = useRef(0);

  // IMDB 桥接
  const [showImdbBridge, setShowImdbBridge] = useState(false);
  const [imdbId, setImdbId] = useState("");
  const [imdbMediaType, setImdbMediaType] = useState<"movie" | "tv">("movie");
  const [imdbSearching, setImdbSearching] = useState(false);

  // ---- Load explore sections (browse / discovery) ----
  const loadResources = useCallback(async (forceRefresh = false, category: SearchCategory = "All") => {
    const requestId = requestSeqRef.current += 1;
    const setIsLoadingReset = () => {
      setStatusMap({});
    };
    setIsLoading(true);
    setLoadError(null);
    setSearchMode("discover");
    setIsLoadingReset();
    setSelectedResource(null);
    try {
      const allItems: MediaResource[] = [];
      const agg: Record<string, BadgeStatus> = {};
      const sectionKeys = getDiscoverSectionKeys(category);
      const responses = await Promise.allSettled(
        sectionKeys.map((key) =>
          searchApi.getExploreDoubanSection(key, DISCOVER_SECTION_LIMIT, forceRefresh, 0),
        ),
      );
      const errors: string[] = [];

      for (const result of responses) {
        if (result.status === "fulfilled") {
          const response = result.value;
          const section = normalizeExploreSectionPayload(response.data);
          for (const item of section.items) {
            allItems.push(mapDiscoverItemToResource(item, section));
          }
          mergeStatusMap(agg, section.embyStatusMap, "emby");
          mergeStatusMap(agg, section.feiniuStatusMap, "feiniu");
        } else {
          errors.push(result.reason?.response?.data?.detail || result.reason?.message || String(result.reason));
        }
      }

      if (requestId !== requestSeqRef.current) return;

      setStatusMap(agg);

      const unique = selectDiscoverResources(allItems, category);

      setResources(unique);
      if (unique.length === 0) {
        const categoryLabel = SEARCH_CATEGORY_LABELS[category] || "推荐";
        const suffix = errors.length > 0 ? ` (${errors[0]})` : "";
        setLoadError(`${categoryLabel}推荐列表为空，请检查豆瓣分区可达性，或切换资源直搜按标题搜索。${suffix}`);
      }
    } catch (err: any) {
      if (requestId !== requestSeqRef.current) return;
      const msg = err?.response?.data?.detail || err?.message || String(err);
      console.error("Failed to load explore sections:", msg);
      setLoadError(`加载探索列表失败: ${msg}`);
    } finally {
      if (requestId === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  const runKeywordSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const keyword = searchQuery.trim();
    if (!keyword) {
      await loadResources(false, selectedCategory);
      return;
    }
    if (tmdbSearchConfigured === null) {
      setLoadError("正在检查 TMDB 搜索配置，请稍后重试。");
      return;
    }
    if (!tmdbSearchConfigured) {
      setLoadError("TMDB API Key 未配置，关键词搜索暂不可用；请前往配置与终端补充后重试。");
      return;
    }

    const requestId = requestSeqRef.current += 1;
    setIsLoading(true);
    setLoadError(null);
    setSearchMode("keyword");
    setStatusMap({});
    setSelectedResource(null);
    try {
      const response = await searchApi.search(keyword, 1);
      const data = response.data as {
        items?: SearchResourceItem[];
        results?: SearchResourceItem[];
        emby_status_map?: Record<string, unknown>;
        feiniu_status_map?: Record<string, unknown>;
      };
      const items = Array.isArray(data.items) ? data.items : Array.isArray(data.results) ? data.results : [];
      if (requestId !== requestSeqRef.current) return;
      setResources(items.map((item) => mapSearchItemToResource(item, undefined, { allowIdAsTmdb: true })));

      const agg: Record<string, BadgeStatus> = {};
      mergeStatusMap(agg, data.emby_status_map, "emby");
      mergeStatusMap(agg, data.feiniu_status_map, "feiniu");
      setStatusMap(agg);

      if (items.length === 0) {
        setLoadError(`未搜索到「${keyword}」相关影视`);
      }
    } catch (err: any) {
      if (requestId !== requestSeqRef.current) return;
      const msg = err?.response?.data?.detail || err?.message || String(err);
      setResources([]);
      setLoadError(`搜索失败: ${msg}`);
    } finally {
      if (requestId === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  };

  const runDirectResourceSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const keyword = searchQuery.trim();
    if (!keyword) {
      await loadResources(false, selectedCategory);
      return;
    }

    const requestId = requestSeqRef.current += 1;
    setIsLoading(true);
    setLoadingLinks(false);
    setLoadError(null);
    setSearchMode("direct");
    setStatusMap({});
    setSelectedResource(null);
    try {
      let response: { data: unknown };
      if (directSource === "115_hdhive") {
        response = await searchApi.getHdhivePan115ByKeyword(keyword, directMediaType);
      } else if (directSource === "115_tg") {
        response = await searchApi.getTgPan115ByKeyword(keyword, directMediaType);
      } else {
        response = await searchApi.getSeedhubMagnetByKeyword(keyword, directMediaType, 80);
      }

      const links = mapResourceLinks(extractResourceLinks(response.data));
      if (requestId !== requestSeqRef.current) return;
      if (links.length === 0) {
        setResources([]);
        setLoadError(`${getDirectResourceSourceLabel(directSource)} 未返回「${keyword}」相关资源`);
        return;
      }

      const sourceLabel = getDirectResourceSourceLabel(directSource);
      const resource: MediaResource = {
        id: `direct-resource:${directSource}:${directMediaType}:${keyword}`,
        title: `资源直搜：${keyword}`,
        poster: "",
        rating: 0,
        year: 0,
        category: directMediaType === "tv" ? "TV" : "Movie",
        description: `${sourceLabel} 返回 ${links.length} 条${directMediaType === "tv" ? "剧集" : "电影"}资源`,
        tags: ["资源直搜", sourceLabel, directMediaType === "tv" ? "剧集" : "电影"],
        links,
        media_type: directMediaType,
      };
      setResources([resource]);
      setSelectedResource(resource);
      await addLog("SUCCESS", `资源直搜完成: ${keyword} (${sourceLabel}, ${links.length} 条)`);
    } catch (err: any) {
      if (requestId !== requestSeqRef.current) return;
      const msg = err?.response?.data?.detail || err?.message || String(err);
      setResources([]);
      setLoadError(`资源直搜失败: ${msg}`);
    } finally {
      if (requestId === requestSeqRef.current) {
        setIsLoading(false);
      }
    }
  };

  const fetchSeedhubTaskLinks = async (resource: MediaResource): Promise<MediaResourceLink[]> => {
    if (!resource.tmdb_id || !resource.media_type) return [];
    const isMovie = (resource.media_type || "movie") === "movie";
    const startResponse = isMovie
      ? await searchApi.createMovieSeedhubMagnetTask(resource.tmdb_id, 40, false)
      : await searchApi.createTvSeedhubMagnetTask(resource.tmdb_id, null, 40, false);
    const startTask = startResponse.data as Record<string, unknown>;
    const taskId = String(startTask.task_id || "");
    if (!taskId) throw new Error("SeedHub 后台任务未返回 task_id");

    setSeedhubTask({
      taskId,
      status: String(startTask.status || "queued"),
      message: String(startTask.message || "SeedHub 任务已排队"),
    });

    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await searchApi.getSeedhubMagnetTask(taskId);
      const task = response.data as Record<string, unknown>;
      const status = String(task.status || "");
      setSeedhubTask({
        taskId,
        status,
        message: String(task.message || "SeedHub 后台检索中"),
      });

      if (["success", "partial_success"].includes(status)) {
        return mapResourceLinks(extractResourceLinks(task.items || []));
      }
      if (status === "cancelled") return [];
      if (status === "failed") {
        throw new Error(String(task.error || task.message || "SeedHub 检索失败"));
      }
      await sleep(1500);
    }

    throw new Error("SeedHub 后台检索超时");
  };

  const fetchKeywordResourceLinks = async (resource: MediaResource): Promise<MediaResourceLink[]> => {
    const mediaType = resource.media_type === "tv" ? "tv" : "movie";
    const firstKeyword = buildResourceKeyword(resource);
    const fallbackKeyword = String(resource.title || "").trim();
    const keywords = firstKeyword && firstKeyword !== fallbackKeyword
      ? [firstKeyword, fallbackKeyword]
      : [fallbackKeyword].filter(Boolean);

    for (const keyword of keywords) {
      const settled = await Promise.allSettled(
        DIRECT_RESOURCE_SOURCES.map(async (source) => {
          let response: { data: unknown };
          if (source.key === "115_hdhive") {
            response = await searchApi.getHdhivePan115ByKeyword(keyword, mediaType);
          } else if (source.key === "115_tg") {
            response = await searchApi.getTgPan115ByKeyword(keyword, mediaType);
          } else {
            response = await searchApi.getSeedhubMagnetByKeyword(keyword, mediaType, 40);
          }
          const rawLinks = extractResourceLinks(response.data).map((link) => ({
            ...link,
            source_service: link.source_service || source.label,
          }));
          return mapResourceLinks(rawLinks);
        }),
      );

      const links = settled.flatMap((result) => (
        result.status === "fulfilled" ? result.value : []
      ));
      if (links.length > 0) {
        return links;
      }
    }

    return [];
  };

  const cancelSeedhubTask = async () => {
    if (!seedhubTask?.taskId) return;
    const taskId = seedhubTask.taskId;
    try {
      await searchApi.cancelSeedhubMagnetTask(taskId);
      setSeedhubTask({ taskId, status: "cancelled", message: "SeedHub 后台任务已取消" });
      setLoadingLinks(false);
    } catch (err) {
      await addLog("ERROR", `取消 SeedHub 任务失败: ${String(err)}`);
    }
  };

  // ---- Fetch resource links for detail panel ----
  // ---- Fetch resource links (multi-source) ----
  const fetchResourceLinks = async (
    resource: MediaResource,
    source: ResourceSourceKey = "unified",
  ): Promise<MediaResourceLink[]> => {
    if (!resource.tmdb_id || !resource.media_type) {
      console.warn("Resource missing tmdb_id/media_type, cannot fetch links");
      return [];
    }
    const isMovie = (resource.media_type || "movie") === "movie";
    try {
      let response: { data: unknown };
      switch (source) {
        case "unified":
          response = await searchApi.getMediaResources(resource.tmdb_id, resource.media_type, null, false);
          break;
        case "115_pansou":
          response = isMovie
            ? await searchApi.getMoviePan115Pansou(resource.tmdb_id)
            : await searchApi.getTvPan115Pansou(resource.tmdb_id);
          break;
        case "115_hdhive":
          response = isMovie
            ? await searchApi.getMoviePan115Hdhive(resource.tmdb_id)
            : await searchApi.getTvPan115Hdhive(resource.tmdb_id);
          break;
        case "115_tg":
          response = isMovie
            ? await searchApi.getMoviePan115Tg(resource.tmdb_id)
            : await searchApi.getTvPan115Tg(resource.tmdb_id);
          break;
        case "quark_pansou":
          response = isMovie
            ? await searchApi.getMovieQuarkPansou(resource.tmdb_id)
            : await searchApi.getTvQuarkPansou(resource.tmdb_id);
          break;
        case "quark_hdhive":
          response = isMovie
            ? await searchApi.getMovieQuarkHdhive(resource.tmdb_id)
            : await searchApi.getTvQuarkHdhive(resource.tmdb_id);
          break;
        case "quark_tg":
          response = isMovie
            ? await searchApi.getMovieQuarkTg(resource.tmdb_id)
            : await searchApi.getTvQuarkTg(resource.tmdb_id);
          break;
        case "magnet_seedhub":
          return await fetchSeedhubTaskLinks(resource);
        case "magnet_butailing":
          response = isMovie
            ? await searchApi.getMovieMagnetButailing(resource.tmdb_id)
            : await searchApi.getTvMagnetButailing(resource.tmdb_id);
          break;
        default:
          response = await searchApi.getMediaResources(resource.tmdb_id, resource.media_type, null, false);
      }

      return mapResourceLinks(extractResourceLinks(response.data));
    } catch (err: any) {
      console.error("Failed to fetch resource links:", err);
      return [];
    }
  };

  // ---- Handle resource selection (lazy-load links) ----
  const handleSelectResource = async (resource: MediaResource) => {
    setSeedhubTask(null);
    if (isDirectResourceResult(resource)) {
      setSelectedResource(resource);
      setLoadingLinks(false);
      return;
    }
    setSelectedResource({ ...resource, links: [] });
    setActiveSource("unified"); // 重置为统一来源
    setLoadingLinks(true);
    const shouldUseKeywordFallback = !resource.tmdb_id || tmdbSearchConfigured === false;
    const links = shouldUseKeywordFallback
      ? await fetchKeywordResourceLinks(resource)
      : await fetchResourceLinks(resource, "unified");
    setSelectedResource((prev) => (prev ? { ...prev, links } : null));
    setLoadingLinks(false);
  };

  // ---- Switch resource source (multi-source browsing) ----
  const handleSwitchSource = async (source: ResourceSourceKey) => {
    if (!selectedResource) return;
    setActiveSource(source);
    setLoadingLinks(true);
    if (source !== "magnet_seedhub") setSeedhubTask(null);
    setSelectedResource((prev) => (prev ? { ...prev, links: [] } : null));
    const links = await fetchResourceLinks(selectedResource, source);
    setSelectedResource((prev) => (prev ? { ...prev, links } : null));
    setLoadingLinks(false);
  };

  // ---- HDHive unlock ----
  const handleUnlockHdhive = async (slug: string, linkIndex: number) => {
    const actionId = `unlock-${slug}-${linkIndex}`;
    setUnlockingSlug(actionId);
    const linkName = selectedResource?.links[linkIndex]?.name || slug;
    setProgress({
      visible: true,
      phase: "progress",
      status: "loading",
      resourceLabel: linkName,
      message: "正在通过 HDHive 解锁资源…",
      actionType: "unlock",
    });
    try {
      await searchApi.unlockHdhiveResource(slug);
      setSelectedResource((prev) =>
        prev
          ? {
              ...prev,
              links: prev.links.map((l, i) => (i === linkIndex ? { ...l, unlocked: true } : l)),
            }
          : prev,
      );
      setProgress({
        visible: true,
        phase: "result",
        status: "success",
        resourceLabel: linkName,
        message: "HDHive 资源已解锁，现在可以一键转存到网盘。",
        actionType: "unlock",
      });
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || String(err);
      console.error("HDHive unlock error:", detail);
      setProgress({
        visible: true,
        phase: "result",
        status: "failed",
        resourceLabel: linkName,
        message: `解锁失败: ${detail}`,
        actionType: "unlock",
      });
    } finally {
      setUnlockingSlug(null);
    }
  };

  // ---- Transfer handler ----
  const handleTransfer = async (resource: MediaResource, link: MediaResourceLink, linkIndex: number) => {
    const actionId = `${resource.id}-${linkIndex}`;
    setTransferringLinkId(actionId);

    // Guard: share URL is required for save-to-folder
    if (!link.shareUrl) {
      setProgress({
        visible: true,
        phase: "result",
        status: "warning",
        resourceLabel: link.name,
        message: "该资源无分享链接，无法转存到 115 网盘。",
      });
      setTransferringLinkId(null);
      return;
    }

    const folderName = resource.title || link.name || "MediaSync115";
    const receiveCode = link.receiveCode || "";

    setProgress({
      visible: true,
      phase: "progress",
      status: "loading",
      resourceLabel: link.name,
      message: "正在转存至 115 网盘，请稍候…",
    });

    try {
      await pan115Api.saveShareToFolder(
        link.shareUrl,
        folderName,
        "0",
        receiveCode,
        String(resource.tmdb_id || ""),
      );

      setProgress({
        visible: true,
        phase: "result",
        status: "success",
        resourceLabel: link.name,
        message: `已成功转存至「${folderName}」文件夹。`,
      });
      addLog("SUCCESS", `已提交转存: ${link.name}`);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || String(err);
      console.error("Transfer error:", detail);
      setProgress({
        visible: true,
        phase: "result",
        status: "failed",
        resourceLabel: link.name,
        message: `转存失败: ${detail}`,
      });
      addLog("ERROR", `转存失败: ${detail}`);
    } finally {
      setTransferringLinkId(null);
    }
  };

  // ---- IMDB 桥接：IMDB ID → TMDB 查找 ----
  const handleImdbBridge = async () => {
    if (!imdbId.trim()) return;
    setImdbSearching(true);
    try {
      const resp = await searchApi.getBridgeByImdbId(imdbId.trim(), imdbMediaType);
      const data = resp.data as { tmdb_id?: number; title?: string; name?: string; media_type?: string; poster_path?: string; overview?: string; year?: number; vote_average?: number };
      if (data.tmdb_id) {
        const resource: MediaResource = {
          id: String(data.tmdb_id),
          title: data.title || data.name || "IMDB 匹配",
          poster: normalizeSearchPosterSrc(data.poster_path),
          rating: data.vote_average || 0,
          year: data.year || 0,
          category: data.media_type === "tv" ? "TV" : "Movie",
          description: data.overview || "",
          tags: [],
          links: [],
          tmdb_id: data.tmdb_id,
          media_type: (data.media_type as "movie" | "tv") || "movie",
        };
        setSelectedResource(resource);
        setActiveSource("unified");
        setLoadingLinks(true);
        const links = await fetchResourceLinks(resource, "unified");
        setSelectedResource((prev) => (prev ? { ...prev, links } : null));
        setLoadingLinks(false);
        setImdbId("");
        setShowImdbBridge(false);
        await addLog("SUCCESS", `IMDB 桥接成功: ${imdbId.trim()} → TMDB ${data.tmdb_id} (${resource.title})`);
      } else {
        await addLog("WARN", `IMDB 桥接未找到匹配: ${imdbId.trim()}`);
      }
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
      await addLog("ERROR", `IMDB 桥接失败: ${detail}`);
    } finally {
      setImdbSearching(false);
    }
  };

  // ---- Initial load ----
  useEffect(() => {
    loadResources(false, "All");
  }, [loadResources]);

  useEffect(() => {
    let cancelled = false;

    const loadTmdbSearchStatus = async () => {
      try {
        const response = await searchApi.getExploreMeta("tmdb");
        if (!cancelled) {
          setTmdbSearchConfigured(Boolean(response.data.tmdb_configured));
        }
      } catch {
        if (!cancelled) {
          setTmdbSearchConfigured(true);
        }
      }
    };

    void loadTmdbSearchStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  // ---- Filtered list ----
  const filteredResources = resources.filter((res) => {
    const matchesSearch =
      res.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      res.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      res.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory =
      selectedCategory === "All" ||
      res.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  // ---- Determine if a link's transfer button should be disabled ----
  const isTransferDisabled = (link: MediaResourceLink): boolean => {
    return !link.shareUrl;
  };

  return (
    <div id="search-tab-container" className="space-y-6">
      {/* 转存/解锁进度弹窗 */}
      <Pan115Progress state={progress} onClose={() => setProgress(deriveDefaultProgressState())} />

      {/* Search Header Banner */}
      <div className="glass-heavy rounded-3xl p-6">
        <h2 className="text-2xl font-black tracking-tight flex items-center gap-2.5" style={{ color: "var(--txt)" }}>
          <Search className="w-6 h-6" style={{ color: "var(--brand-primary)" }} />
          <span>全网磁力 & 云端资源秒传检索</span>
        </h2>
        <p className="text-xs mt-1 max-w-xl leading-relaxed" style={{ color: "var(--txt-secondary)" }}>
          聚合海量磁力、BT、RSS发布站以及 115 官方云端转存通道。在这里搜索您的心仪影视，点击一键即可瞬间挂载至您的 Emby / 飞牛服务器中，无需本地耗时下载。
        </p>
      </div>

      {/* Control row */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        {/* Search Bar Input */}
        <div className="w-full md:max-w-md relative">
          <div className="mb-2 inline-flex rounded-xl p-1" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
            {([
              { key: "media", label: "影视搜索" },
              { key: "direct", label: "资源直搜" },
            ] as { key: "media" | "direct"; label: string }[]).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setSearchScope(item.key)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black transition-all"
                style={searchScope === item.key ? { background: "var(--brand-primary)", color: "#fff" } : { color: "var(--txt-secondary)" }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <form onSubmit={searchScope === "direct" ? runDirectResourceSearch : runKeywordSearch} className="relative flex gap-2">
            <div className="relative flex-1">
              <input
                id="search-input-field"
                type="text"
                placeholder="搜索电影、电视剧、动漫、或资源标签..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full glass rounded-2xl py-3 pl-11 pr-4 text-sm font-semibold outline-none transition-all placeholder:text-[var(--txt-muted)]"
                style={{ color: "var(--txt)" }}
              />
              <Search className="w-5 h-5 absolute left-4 top-3.5" style={{ color: "var(--txt-muted)" }} />
            </div>
            <button
              type="submit"
              disabled={isLoading || (searchScope === "media" && !tmdbSearchConfigured)}
              className="px-4 py-3 rounded-2xl text-xs font-black text-white transition-all disabled:opacity-60"
              style={{ background: "var(--brand-primary)" }}
              title={searchScope === "direct" ? "资源直搜" : tmdbSearchConfigured === null ? "正在检查 TMDB 搜索配置" : tmdbSearchConfigured ? "搜索" : "TMDB API Key 未配置"}
            >
              搜索
            </button>
          </form>
          {searchScope === "direct" && (
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={directSource}
                onChange={(e) => setDirectSource(e.target.value as DirectResourceSourceKey)}
                className="w-full px-3 py-2 rounded-xl text-xs font-bold outline-none"
                style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
              >
                {DIRECT_RESOURCE_SOURCES.map((source) => (
                  <option key={source.key} value={source.key}>{source.label}</option>
                ))}
              </select>
              <select
                value={directMediaType}
                onChange={(e) => setDirectMediaType(e.target.value as "movie" | "tv")}
                className="w-full px-3 py-2 rounded-xl text-xs font-bold outline-none"
                style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
              >
                <option value="movie">电影</option>
                <option value="tv">剧集</option>
              </select>
            </div>
          )}
          {tmdbSearchConfigured === false && searchScope === "media" && (
            <p className="mt-2 text-[10px] font-bold" style={{ color: "var(--accent-warn)" }}>
              TMDB API Key 未配置，关键词搜索暂不可用；可切换资源直搜。
            </p>
          )}
        </div>

        {/* Category Filters */}
        <div className="flex flex-wrap gap-2 self-start md:self-auto">
          {(["All", "Movie", "TV", "Anime"] as const).map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setSelectedCategory(cat);
                if (searchMode === "discover") {
                  void loadResources(false, cat);
                }
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold transition-all glass-hover"
              style={
                selectedCategory === cat
                  ? { background: "var(--brand-primary)", color: "#fff", border: "1px solid var(--brand-primary)" }
                  : { background: "var(--surface)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }
              }
            >
              {SEARCH_CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      </div>

      {/* IMDB 桥接 */}
      <div>
        <button
          onClick={() => setShowImdbBridge(!showImdbBridge)}
          className="flex items-center gap-1.5 text-[10px] font-bold px-3 py-1.5 rounded-lg transition-all glass-hover"
          style={{ color: "var(--txt-muted)", border: "1px dashed var(--border)" }}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          {showImdbBridge ? "收起 IMDB 桥接" : "IMDB ID 桥接查找"}
        </button>
        {showImdbBridge && (
          <div className="mt-2 flex gap-2 items-center">
            <select
              value={imdbMediaType}
              onChange={(e) => setImdbMediaType(e.target.value as "movie" | "tv")}
              className="px-3 py-2 rounded-xl text-xs font-bold outline-none"
              style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
            >
              <option value="movie">电影</option>
              <option value="tv">剧集</option>
            </select>
            <input
              type="text"
              placeholder="输入 IMDB ID，如 tt1375666"
              value={imdbId}
              onChange={(e) => setImdbId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleImdbBridge()}
              className="flex-1 max-w-xs px-4 py-2 rounded-xl text-xs font-semibold outline-none"
              style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
            />
            <button
              onClick={handleImdbBridge}
              disabled={imdbSearching || !imdbId.trim()}
              className="px-4 py-2 rounded-xl text-xs font-black text-white disabled:opacity-50 flex items-center gap-1"
              style={{ background: "var(--brand-primary)" }}
            >
              {imdbSearching ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5" />
              )}
              查找
            </button>
          </div>
        )}
      </div>

      {/* Resources grid & Detail section split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Resource List Left Side */}
        <div className="lg:col-span-7 space-y-4">
          <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
            <Flame className="w-4 h-4" style={{ color: "var(--brand-primary-light)" }} />
            <span>{searchMode === "direct" ? "资源直搜结果" : searchMode === "keyword" ? "关键词搜索结果" : "热搜影视精品推荐"}</span>
            <span className="text-xs font-semibold" style={{ color: "var(--txt-muted)" }}>({filteredResources.length} 个结果)</span>
            {searchMode === "discover" && (
              <button
                type="button"
                onClick={() => loadResources(true, selectedCategory)}
                disabled={isLoading}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-black transition-all glass-hover disabled:opacity-60"
                style={{ color: "var(--brand-primary)", border: "1px solid var(--brand-primary-border-alpha)", background: "var(--brand-primary-bg-alpha)" }}
              >
                <RefreshCw className={`w-3 h-3 ${isLoading ? "animate-spin" : ""}`} />
                换一批
              </button>
            )}
          </h3>

          {isLoading ? (
            <div className="glass rounded-3xl p-12 text-center space-y-3">
              <div className="w-8 h-8 border-4 rounded-full animate-spin mx-auto" style={{ borderColor: "var(--brand-primary)", borderTopColor: "transparent" }} />
              <p className="text-xs font-bold" style={{ color: "var(--txt-muted)" }}>正在云端搜索索引库...</p>
            </div>
          ) : loadError ? (
            <div className="glass rounded-3xl p-8 text-center">
              <ErrorBanner
                variant="block"
                message={loadError}
                onRetry={
                  searchMode === "direct"
                    ? () => runDirectResourceSearch()
                    : () => loadResources(false, selectedCategory)
                }
              />
            </div>
          ) : filteredResources.length === 0 ? (
            <div className="glass rounded-3xl p-12 text-center">
              <p className="text-sm font-bold" style={{ color: "var(--txt-muted)" }}>未找到匹配的媒体资源，换个词试试吧</p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {filteredResources.map((res) => (
                <div
                  key={res.id}
                  id={`res-card-${res.id}`}
                  onClick={() => handleSelectResource(res)}
                  className={`glass glass-hover rounded-2xl p-4 flex gap-4 cursor-pointer transition-all ${
                    selectedResource?.id === res.id ? "card-selected" : ""
                  }`}
                >
                  {/* Poster Placeholder */}
                  <div className="w-16 h-24 rounded-xl overflow-hidden shrink-0 relative" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                    {res.poster ? (
                      <img
                        src={res.poster}
                        alt={res.title}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                      />
                    ) : (
                      <Film className="w-6 h-6 absolute inset-0 m-auto" style={{ color: "var(--txt-muted)" }} />
                    )}
                    <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-white text-[8px] font-black uppercase tracking-widest" style={{ background: "rgba(0,0,0,0.65)" }}>
                      {res.category === "Movie" ? "电影" : res.category === "TV" ? "剧集" : "动漫"}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-headline font-bold text-sm truncate" style={{ color: "var(--txt)" }}>{res.title}</h4>
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-black" style={{ color: "var(--accent-warn)", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.25)" }}>
                          {res.rating > 0 ? `★ ${res.rating.toFixed(1)}` : "暂无评分"}
                        </span>
                      </div>
                      <p className="text-[11px] font-semibold mt-0.5" style={{ color: "var(--txt-muted)" }}>
                        {res.year > 0 ? `${res.year} 年` : ""}
                      </p>
                      <p className="text-xs mt-2 line-clamp-2 leading-relaxed" style={{ color: "var(--txt-secondary)" }}>
                        {res.description || "暂无简介"}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-1 mt-2 items-center">
                      {res.tags.map((tag, i) => (
                        <span key={i} className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" }}>
                          {tag}
                        </span>
                      ))}
                      {(() => {
                        const bKey = buildBadgeKey(res.media_type, res.tmdb_id);
                        return bKey ? <LibraryBadge status={statusMap[bKey]} /> : null;
                      })()}
                      <span className="ml-auto text-[9px] font-black px-2 py-1 rounded-lg" style={{ background: "var(--brand-primary-bg-alpha)", color: "var(--brand-primary)" }}>
                        查看资源
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Resource Details & Links Panel Right Side */}
        <div className="lg:col-span-5">
          <AnimatePresence mode="wait">
            {selectedResource ? (
              <motion.div
                key={selectedResource.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="glass-heavy rounded-3xl p-5 space-y-5 sticky top-28"
              >
                {/* Header info */}
                <div className="flex gap-4">
                  <div className="w-24 h-36 rounded-2xl overflow-hidden shrink-0 relative" style={{ border: "1px solid var(--border)" }}>
                    {selectedResource.poster ? (
                      <img
                        src={selectedResource.poster}
                        alt={selectedResource.title}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <Film className="w-8 h-8 absolute inset-0 m-auto" style={{ color: "var(--txt-muted)" }} />
                    )}
                  </div>
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider" style={{ color: "var(--brand-primary)", background: "var(--brand-primary-bg-alpha-heavy)" }}>
                      {selectedResource.category === "Movie" ? "超级大片" : selectedResource.category === "TV" ? "多集连载" : "当季热门"}
                    </span>
                    <h3 className="font-headline font-black text-base leading-tight" style={{ color: "var(--txt)" }}>
                      {selectedResource.title}
                    </h3>
                    <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: "var(--txt-muted)" }}>
                      <span>{selectedResource.year > 0 ? selectedResource.year : isDirectResourceResult(selectedResource) ? "资源直搜" : "年份未知"}</span>
                      <span>•</span>
                      <span className="font-bold" style={{ color: "var(--accent-warn)" }}>
                        {selectedResource.rating > 0 ? `★ ${selectedResource.rating} TMDB` : isDirectResourceResult(selectedResource) ? `${selectedResource.links.length} 条资源` : "暂无评分"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-black block" style={{ color: "var(--txt)" }}>资源简介</span>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--txt-secondary)" }}>
                    {selectedResource.description || "暂无简介"}
                  </p>
                </div>

                {/* Navigate to full detail page */}
                {selectedResource.tmdb_id && onNavigateToDetail && (
                  <button
                    onClick={() => onNavigateToDetail({
                      tmdbId: selectedResource.tmdb_id!,
                      mediaType: (selectedResource.media_type === "tv" ? "tv" : "movie") as "movie" | "tv",
                      title: selectedResource.title,
                      poster: selectedResource.poster,
                      returnTo: PageName.SEARCH,
                    })}
                    className="text-[10px] font-black px-3 py-1.5 rounded-lg transition-all flex items-center gap-1 self-start"
                    style={{ color: "var(--brand-primary)", border: "1px solid var(--brand-primary-border-alpha)", background: "var(--brand-primary-bg-alpha)" }}
                  >
                    查看完整详情 <ExternalLink className="w-3 h-3" />
                  </button>
                )}

                {/* Torrent/Link Tables */}
                <div className="space-y-3 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black flex items-center gap-1.5" style={{ color: "var(--txt)" }}>
                      <Download className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
                      <span>资源通道</span>
                    </span>
                    {selectedResource.tmdb_id && tmdbSearchConfigured !== false ? (
                      <span className="text-[10px] font-bold" style={{ color: "var(--brand-primary)" }}>多源可切换</span>
                    ) : isDirectResourceResult(selectedResource) ? (
                      <span className="text-[10px] font-bold" style={{ color: "var(--brand-primary)" }}>资源直搜</span>
                    ) : (
                      <span className="text-[10px] font-bold" style={{ color: "var(--brand-primary)" }}>标题直搜</span>
                    )}
                  </div>

                  {/* 多源资源选择器 */}
                  {selectedResource.tmdb_id && tmdbSearchConfigured !== false && (
                    <div className="flex flex-wrap gap-1">
                      {RESOURCE_SOURCES.map((s) => (
                        <button
                          key={s.key}
                          onClick={() => handleSwitchSource(s.key)}
                          disabled={loadingLinks}
                          title={s.desc}
                          className="px-2.5 py-1.5 rounded-lg text-[9px] font-bold transition-all glass-hover"
                          style={
                            activeSource === s.key
                              ? { background: "var(--brand-primary)", color: "#fff", border: "1px solid var(--brand-primary)" }
                              : { background: "var(--surface)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }
                          }
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {loadingLinks ? (
                    <div className="text-center py-6">
                      <div className="w-6 h-6 rounded-full animate-spin mx-auto" style={{ borderWidth: 3, borderColor: "var(--brand-primary)", borderTopColor: "transparent" }} />
                      <p className="text-[10px] mt-2 font-semibold" style={{ color: "var(--txt-muted)" }}>
                        {activeSource === "magnet_seedhub" && seedhubTask
                          ? `${seedhubTask.message} (${seedhubTask.status})`
                          : "正在拉取资源链接..."}
                      </p>
                      {activeSource === "magnet_seedhub" && seedhubTask?.taskId && (
                        <button
                          type="button"
                          onClick={cancelSeedhubTask}
                          className="mt-3 px-3 py-1.5 rounded-lg text-[10px] font-black glass-hover"
                          style={{ color: "var(--accent-danger)", border: "1px solid var(--border)", background: "var(--surface)" }}
                        >
                          取消 SeedHub 任务
                        </button>
                      )}
                    </div>
                  ) : selectedResource.links.length === 0 ? (
                    <div className="text-center py-6 rounded-xl" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                      <p className="text-xs font-semibold" style={{ color: "var(--txt-muted)" }}>
                        {selectedResource.tmdb_id && tmdbSearchConfigured !== false
                          ? "该来源暂无可用下载链接"
                          : isDirectResourceResult(selectedResource)
                          ? "该直搜来源暂无可用资源"
                          : "标题直搜暂无可用资源，可切换到资源直搜手动换关键词"}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {selectedResource.links.map((link, idx) => {
                        const actionId = `${selectedResource.id}-${idx}`;
                        const isTransferring = transferringLinkId === actionId;
                        const isSuccess = transferSuccessId === actionId;
                        const disabled = isTransferDisabled(link);
                        const unlockAction = `unlock-${link.slug}-${idx}`;
                        const isUnlocking = unlockingSlug === unlockAction;

                        return (
                          <div key={idx} className="glass rounded-xl p-3 flex flex-col gap-2 glass-hover">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-xs font-semibold break-all leading-snug line-clamp-2" style={{ color: "var(--txt)" }}>
                                {link.name}
                              </span>
                            </div>

                            {/* 来源/分辨率/HDHive 状态标记 */}
                            {(link.sourceService || link.resolution || link.slug || (link.magnetUrl && !link.shareUrl)) && (
                              <div className="flex flex-wrap gap-1">
                                {link.sourceService && (
                                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" }}>{link.sourceService}</span>
                                )}
                                {link.resolution && (
                                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(99,102,241,0.14)", color: "var(--accent-info)" }}>{link.resolution}</span>
                                )}
                                {link.slug && (
                                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={link.unlocked ? { background: "rgba(34,197,94,0.16)", color: "var(--accent-ok)" } : { background: "rgba(245,158,11,0.16)", color: "var(--accent-warn)" }}>
                                    {link.unlocked ? "HDHive已解锁" : "HDHive待解锁"}
                                  </span>
                                )}
                                {link.magnetUrl && !link.shareUrl && (
                                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(168,85,247,0.16)", color: "#c084fc" }}>磁力链</span>
                                )}
                              </div>
                            )}

                            {/* HDHive 解锁按钮 */}
                            {link.slug && !link.unlocked && (
                              <button
                                disabled={isUnlocking}
                                onClick={() => handleUnlockHdhive(link.slug!, idx)}
                                className="self-start px-2.5 py-1.5 rounded-lg text-[10px] font-black text-white disabled:opacity-50 flex items-center gap-1"
                                style={{ background: "var(--accent-warn)" }}
                              >
                                {isUnlocking ? (
                                  <>
                                    <span className="w-3 h-3 border-2 border-white rounded-full animate-spin" style={{ borderTopColor: "transparent" }} />
                                    <span>解锁中</span>
                                  </>
                                ) : (
                                  <>
                                    <Shield className="w-3 h-3" />
                                    <span>HDHive 解锁</span>
                                  </>
                                )}
                              </button>
                            )}

                            <div className="flex items-center justify-between text-[10px] font-bold mt-1" style={{ color: "var(--txt-muted)" }}>
                              <div className="flex gap-3">
                                <span>大小: <strong style={{ color: "var(--txt-secondary)" }}>{link.size}</strong></span>
                                {link.seeds != null && <span>健康度: <strong style={{ color: "var(--accent-ok)" }}>{link.seeds}</strong></span>}
                              </div>

                              {link.shareUrl && (
                              <button
                                disabled={isTransferring || disabled}
                                onClick={() => handleTransfer(selectedResource, link, idx)}
                                className="px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wider transition-all flex items-center gap-1.5"
                                style={
                                  isSuccess
                                    ? { background: "rgba(34,197,94,0.16)", color: "var(--accent-ok)", border: "1px solid rgba(34,197,94,0.35)" }
                                    : disabled || isTransferring
                                    ? { background: "var(--surface-subtle)", color: "var(--txt-muted)", border: "1px solid var(--border)", cursor: "not-allowed" }
                                    : { background: "var(--brand-primary)", color: "#fff", border: "1px solid var(--brand-primary)" }
                                }
                                title={disabled ? "该资源无分享链接，无法转存" : "一键转存到115网盘"}
                              >
                                {isSuccess ? (
                                  <>
                                    <CheckCircle className="w-3.5 h-3.5" />
                                    <span>转存成功!</span>
                                  </>
                                ) : isTransferring ? (
                                  <>
                                    <span className="w-3 h-3 border-2 rounded-full animate-spin" style={{ borderColor: "var(--txt-muted)", borderTopColor: "transparent" }} />
                                    <span>正在转存...</span>
                                  </>
                                ) : disabled ? (
                                  <>
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    <span>无链接</span>
                                  </>
                                ) : (
                                  <>
                                    <Plus className="w-3.5 h-3.5" />
                                    <span>115 一键秒传</span>
                                  </>
                                )}
                              </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Cloud security badge */}
                <div className="rounded-2xl p-3 flex gap-2 items-center" style={{ background: "var(--brand-primary-bg-alpha)", border: "1px solid var(--brand-primary-border-alpha)" }}>
                  <Shield className="w-4.5 h-4.5 shrink-0" style={{ color: "var(--brand-primary)" }} />
                  <p className="text-[10px] font-bold leading-tight" style={{ color: "var(--brand-primary)" }}>
                    本秒传通道完全加密！所有磁力经由您的 115 会话密钥直接发送至 115 官方云接口，挂载不耗费您的本地网络。
                  </p>
                </div>
              </motion.div>
            ) : (
              <div className="rounded-3xl p-12 text-center space-y-3 sticky top-28" style={{ background: "var(--surface-subtle)", border: "1px dashed var(--border)" }}>
                <Film className="w-10 h-10 mx-auto" style={{ color: "var(--txt-muted)" }} />
                <div>
                  <p className="text-sm font-bold" style={{ color: "var(--txt-muted)" }}>请点击左侧影视资源</p>
                  <p className="text-[11px] font-medium mt-1" style={{ color: "var(--txt-muted)" }}>即可查看影片完整详情、磁力解析度，并进行一键转存挂载</p>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
