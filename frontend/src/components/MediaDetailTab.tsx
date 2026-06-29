/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MediaDetailTab — 独立详情页（电影/剧集通用）
 *
 * 对应 Vue 旧版 MovieDetail(2031行)/TvDetail(2259行)，核心功能：
 *   1. 媒体信息头部（海报/标题/年份/评分/类型/概述/订阅/入库标记）
 *   2. 剧集：季选择器 + 分集网格 + 单集资源获取
 *   3. 多源资源浏览（115·pansou/hdhive/tg | 夸克 | 磁力）+ 筛选转存
 *   4. 转存/解锁进度弹窗
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft, Star, Clock, Film, Tv, Download, Plus, Shield, ExternalLink,
  CheckCircle, RefreshCw, Rss, FolderOpen, Users, Search,
} from "lucide-react";
import ErrorBanner from "./ui/ErrorBanner";
import { motion } from "motion/react";
import { searchApi } from "../api/search";
import { pan115Api } from "../api/pan115";
import { subscriptionApi } from "../api/subscription";
import { settingsApi } from "../api/settings";
import { moviepilotApi } from "../api/moviepilot";
import LibraryBadge, { buildBadgeKey, mergeStatusMap, type BadgeStatus } from "./LibraryBadge";
import Pan115Progress, { type Pan115ProgressState, deriveDefaultProgressState } from "./Pan115Progress";
import type { MediaResourceLink } from "../types";

// ---- Types ----

interface MediaDetailTabProps {
  tmdbId: number;
  mediaType: "movie" | "tv";
  defaultTitle: string;
  defaultPoster?: string;
  onBack: () => void;
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => Promise<void>;
}

interface TmdbDetail {
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path?: string;
  backdrop_path?: string;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  runtime?: number;
  number_of_seasons?: number;
  number_of_episodes?: number;
  overview?: string;
  genres?: { id: number; name: string }[];
  seasons?: { season_number: number; name: string; episode_count: number; poster_path?: string }[];
  credits?: { cast?: { id: number; name: string; character: string; profile_path?: string }[] };
  [key: string]: unknown;
}

interface TvEpisode {
  episode_number: number;
  name: string;
  overview?: string;
  still_path?: string;
  runtime?: number;
  air_date?: string;
  vote_average?: number;
}

interface TvSeasonDetail {
  episodes?: TvEpisode[];
  name?: string;
  [key: string]: unknown;
}

interface ResourceLinkRaw {
  title?: string;
  name?: string;
  torrent_name?: string;
  subtitle?: string;
  size?: string | number;
  size_text?: string;
  seeds?: number;
  seeders?: number;
  pick_code?: string;
  pickcode?: string;
  share_link?: string;
  share_url?: string;
  url?: string;
  link?: string;
  download_url?: string;
  torrent_url?: string;
  receive_code?: string;
  access_code?: string;
  source_service?: string;
  site?: string;
  site_name?: string;
  resolution?: string;
  slug?: string;
  unlocked?: boolean;
  magnet?: string;
  magnet_url?: string;
  info_hash?: string;
}

interface SeedhubTaskState {
  taskId: string;
  status: string;
  message: string;
}

// Resource source keys (same as SearchTab)
type ResourceSourceKey =
  | "unified" | "115_pansou" | "115_hdhive" | "115_tg"
  | "quark_pansou" | "quark_hdhive" | "quark_tg"
  | "magnet_seedhub" | "magnet_butailing" | "moviepilot_pt";

const RESOURCE_SOURCES: { key: ResourceSourceKey; label: string }[] = [
  { key: "unified", label: "统一" },
  { key: "115_pansou", label: "115·Pansou" },
  { key: "115_hdhive", label: "115·HDHive" },
  { key: "115_tg", label: "115·TG" },
  { key: "quark_pansou", label: "夸克·Pansou" },
  { key: "quark_hdhive", label: "夸克·HDHive" },
  { key: "quark_tg", label: "夸克·TG" },
  { key: "magnet_seedhub", label: "磁力·SeedHub" },
  { key: "magnet_butailing", label: "磁力·不淘" },
  { key: "moviepilot_pt", label: "PT·MoviePilot" },
];

const DETAIL_TAB_SOURCE_MAP: Record<string, ResourceSourceKey> = {
  pan115: "unified",
  pan115_pansou: "115_pansou",
  pan115_hdhive: "115_hdhive",
  pan115_tg: "115_tg",
  quark_pansou: "quark_pansou",
  quark_hdhive: "quark_hdhive",
  quark_tg: "quark_tg",
  magnet_seedhub: "magnet_seedhub",
  magnet_butailing: "magnet_butailing",
  moviepilot_pt: "moviepilot_pt",
};

function normalizeVisibleResourceSources(detailVisibleTabs: unknown): ResourceSourceKey[] {
  const rawTabs = Array.isArray(detailVisibleTabs) ? detailVisibleTabs : [];
  const mapped = rawTabs
    .map((item) => DETAIL_TAB_SOURCE_MAP[String(item)])
    .filter((item): item is ResourceSourceKey => Boolean(item));
  const unique = Array.from(new Set(mapped));
  return unique.length > 0 ? unique : RESOURCE_SOURCES.map((item) => item.key);
}

function formatSize(bytes: number): string {
  if (bytes >= 1 << 40) return (bytes / (1 << 40)).toFixed(1) + " TB";
  if (bytes >= 1 << 30) return (bytes / (1 << 30)).toFixed(1) + " GB";
  if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(1) + " MB";
  if (bytes >= 1 << 10) return (bytes / (1 << 10)).toFixed(1) + " KB";
  return bytes + " B";
}

function posterUrl(path: string | undefined, size = "w300"): string {
  if (!path) return "";
  return `https://image.tmdb.org/t/p/${size}${path}`;
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

function mapResourceLinks(rawData: unknown): MediaResourceLink[] {
  return extractResourceLinks(rawData).map((rl) => {
    const shareUrl = rl.share_link || rl.share_url || rl.url || rl.link || "";
    const magnetUrl = rl.magnet || rl.magnet_url || (rl.info_hash ? `magnet:?xt=urn:btih:${rl.info_hash}` : "");
    const m = shareUrl.match(/[?&](?:password|pwd|receive_code)=([^&#]+)/i);
    return {
      name: rl.title || rl.name || rl.torrent_name || rl.subtitle || "未命名资源",
      size: typeof rl.size === "number" ? formatSize(rl.size) : String(rl.size_text || rl.size || "未知"),
      seeds: rl.seeds ?? rl.seeders,
      pickcode: rl.pick_code || rl.pickcode,
      url: shareUrl || magnetUrl || rl.download_url || rl.torrent_url || "",
      shareUrl,
      receiveCode: rl.receive_code || rl.access_code || (m ? m[1] : ""),
      sourceService: rl.source_service || rl.site_name || rl.site,
      resolution: rl.resolution,
      slug: rl.slug,
      unlocked: rl.unlocked,
      magnetUrl,
    };
  });
}

function mapMoviePilotResourceLinks(rawData: unknown): MediaResourceLink[] {
  return mapResourceLinks(rawData).map((link) => ({
    ...link,
    sourceService: link.sourceService || "PT·MoviePilot",
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function MediaDetailTab({
  tmdbId, mediaType, defaultTitle, defaultPoster, onBack, addLog,
}: MediaDetailTabProps) {
  // ---- State ----
  const [detail, setDetail] = useState<TmdbDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Status
  const [statusMap, setStatusMap] = useState<Record<string, BadgeStatus>>({});
  const [visibleResourceSources, setVisibleResourceSources] = useState<ResourceSourceKey[]>(
    RESOURCE_SOURCES.map((item) => item.key),
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscribing, setSubscribing] = useState(false);

  // TV
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [seasonEpisodes, setSeasonEpisodes] = useState<TvEpisode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);

  // Resource links
  const [resources, setResources] = useState<MediaResourceLink[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [activeSource, setActiveSource] = useState<ResourceSourceKey>("unified");
  const [seedhubTask, setSeedhubTask] = useState<SeedhubTaskState | null>(null);

  // Transfer
  const [transferringId, setTransferringId] = useState<string | null>(null);
  const [unlockingSlug, setUnlockingSlug] = useState<string | null>(null);
  const [progress, setProgress] = useState<Pan115ProgressState>(deriveDefaultProgressState());

  // Cast visibility
  const [showFullCast, setShowFullCast] = useState(false);

  // ---- Load detail ----
  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = mediaType === "movie"
        ? await searchApi.getMovie(tmdbId)
        : await searchApi.getTv(tmdbId);
      setDetail(resp.data as TmdbDetail);

      // Emby/Feiniu status
      const statusResp = await searchApi.getEmbyStatusMap([{ media_type: mediaType, tmdb_id: tmdbId }]);
      const sm = (statusResp.data as { status_map?: Record<string, unknown> })?.status_map;
      if (sm) {
        const agg: Record<string, BadgeStatus> = {};
        mergeStatusMap(agg, sm, "emby");
        setStatusMap(agg);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
      setError(`加载详情失败: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [tmdbId, mediaType]);

  // ---- Check subscription ----
  const checkSubscription = useCallback(async () => {
    try {
      const resp = await subscriptionApi.list({ is_active: true, media_type: mediaType });
      const rawList = resp.data as unknown;
      const list: { tmdb_id?: number; [key: string]: unknown }[] = Array.isArray(rawList)
        ? (rawList as { tmdb_id?: number }[])
        : ((rawList as { items?: { tmdb_id?: number }[] })?.items || []);
      setIsSubscribed(list.some((s) => s.tmdb_id === tmdbId));
    } catch { /* ignore */ }
  }, [tmdbId, mediaType]);

  // ---- Load TV episodes ----
  const loadEpisodes = async (season: number) => {
    setEpisodesLoading(true);
    try {
      const resp = await searchApi.getTvSeason(tmdbId, season);
      const data = resp.data as TvSeasonDetail;
      setSeasonEpisodes(data.episodes || []);
    } catch (err: unknown) {
      console.error("Failed to load episodes:", err);
      setSeasonEpisodes([]);
    } finally {
      setEpisodesLoading(false);
    }
  };

  const fetchSeedhubTaskLinks = async (): Promise<MediaResourceLink[]> => {
    const startResponse = mediaType === "movie"
      ? await searchApi.createMovieSeedhubMagnetTask(tmdbId, 40, false)
      : await searchApi.createTvSeedhubMagnetTask(tmdbId, selectedSeason, 40, false);
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
        return mapResourceLinks(task.items || []);
      }
      if (status === "cancelled") return [];
      if (status === "failed") {
        throw new Error(String(task.error || task.message || "SeedHub 检索失败"));
      }
      await sleep(1500);
    }

    throw new Error("SeedHub 后台检索超时");
  };

  const cancelSeedhubTask = async () => {
    if (!seedhubTask?.taskId) return;
    const taskId = seedhubTask.taskId;
    try {
      await searchApi.cancelSeedhubMagnetTask(taskId);
      setSeedhubTask({ taskId, status: "cancelled", message: "SeedHub 后台任务已取消" });
      setResourcesLoading(false);
    } catch (err) {
      await addLog("ERROR", `取消 SeedHub 任务失败: ${String(err)}`);
    }
  };

  // ---- Fetch resource links (multi-source) ----
  const fetchResourceLinks = async (source: ResourceSourceKey): Promise<MediaResourceLink[]> => {
    const isMovie = mediaType === "movie";
    try {
      let response: { data: unknown };
      switch (source) {
        case "unified":
          response = await searchApi.getMediaResources(tmdbId, mediaType, selectedSeason, false);
          break;
        case "115_pansou":
          response = isMovie
            ? await searchApi.getMoviePan115Pansou(tmdbId)
            : await searchApi.getTvPan115Pansou(tmdbId, selectedSeason);
          break;
        case "115_hdhive":
          response = isMovie
            ? await searchApi.getMoviePan115Hdhive(tmdbId)
            : await searchApi.getTvPan115Hdhive(tmdbId, selectedSeason);
          break;
        case "115_tg":
          response = isMovie
            ? await searchApi.getMoviePan115Tg(tmdbId)
            : await searchApi.getTvPan115Tg(tmdbId, selectedSeason);
          break;
        case "quark_pansou":
          response = isMovie
            ? await searchApi.getMovieQuarkPansou(tmdbId)
            : await searchApi.getTvQuarkPansou(tmdbId, selectedSeason);
          break;
        case "quark_hdhive":
          response = isMovie
            ? await searchApi.getMovieQuarkHdhive(tmdbId)
            : await searchApi.getTvQuarkHdhive(tmdbId, selectedSeason);
          break;
        case "quark_tg":
          response = isMovie
            ? await searchApi.getMovieQuarkTg(tmdbId)
            : await searchApi.getTvQuarkTg(tmdbId, selectedSeason);
          break;
        case "magnet_seedhub":
          return await fetchSeedhubTaskLinks();
        case "magnet_butailing":
          response = isMovie
            ? await searchApi.getMovieMagnetButailing(tmdbId)
            : await searchApi.getTvMagnetButailing(tmdbId, selectedSeason);
          break;
        case "moviepilot_pt":
          response = await moviepilotApi.search(title || defaultTitle);
          return mapMoviePilotResourceLinks(response.data);
        default:
          response = await searchApi.getMediaResources(tmdbId, mediaType, selectedSeason, false);
      }

      return mapResourceLinks(response.data);
    } catch (err: unknown) {
      console.error("Failed to fetch resource links:", err);
      return [];
    }
  };

  const handleSwitchSource = async (source: ResourceSourceKey) => {
    setActiveSource(source);
    setResourcesLoading(true);
    if (source !== "magnet_seedhub") setSeedhubTask(null);
    setResources([]);
    const links = await fetchResourceLinks(source);
    setResources(links);
    setResourcesLoading(false);
  };

  // ---- Transfer ----
  const handleTransfer = async (link: MediaResourceLink, idx: number) => {
    const actionId = `transfer-${idx}`;
    if (!link.shareUrl) {
      setProgress({ visible: true, phase: "result", status: "warning", resourceLabel: link.name, message: "该资源无分享链接" });
      return;
    }
    setTransferringId(actionId);
    setProgress({ visible: true, phase: "progress", status: "loading", resourceLabel: link.name, message: "正在转存至 115 网盘…" });
    try {
      await pan115Api.saveShareToFolder(link.shareUrl, detail?.title || detail?.name || defaultTitle, "0", link.receiveCode || "", String(tmdbId));
      setProgress({ visible: true, phase: "result", status: "success", resourceLabel: link.name, message: "转存成功！" });
      await addLog("SUCCESS", `已转存: ${link.name}`);
    } catch (err: unknown) {
      const detailMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
      setProgress({ visible: true, phase: "result", status: "failed", resourceLabel: link.name, message: `转存失败: ${detailMsg}` });
      await addLog("ERROR", `转存失败: ${detailMsg}`);
    } finally {
      setTransferringId(null);
    }
  };

  // ---- HDHive unlock ----
  const handleUnlock = async (slug: string, idx: number) => {
    const actionId = `unlock-${idx}`;
    setUnlockingSlug(actionId);
    setProgress({ visible: true, phase: "progress", status: "loading", resourceLabel: slug, message: "HDHive 解锁中…", actionType: "unlock" });
    try {
      await searchApi.unlockHdhiveResource(slug);
      setResources(prev => prev.map((l, i) => i === idx ? { ...l, unlocked: true } : l));
      setProgress({ visible: true, phase: "result", status: "success", resourceLabel: slug, message: "HDHive 已解锁" });
    } catch (err: unknown) {
      const detailMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
      setProgress({ visible: true, phase: "result", status: "failed", resourceLabel: slug, message: `解锁失败: ${detailMsg}`, actionType: "unlock" });
    } finally {
      setUnlockingSlug(null);
    }
  };

  // ---- Subscribe ----
  const handleToggleSubscribe = async () => {
    setSubscribing(true);
    try {
      const title = detail?.title || detail?.name || defaultTitle;
      await subscriptionApi.toggle({ tmdb_id: tmdbId, title, media_type: mediaType });
      setIsSubscribed(!isSubscribed);
      await addLog(isSubscribed ? "INFO" : "SUCCESS", isSubscribed ? `已取消订阅: ${title}` : `已添加订阅: ${title}`);
    } catch (err: unknown) {
      await addLog("ERROR", `订阅操作失败: ${String(err)}`);
    } finally {
      setSubscribing(false);
    }
  };

  // ---- Season change ----
  const handleSeasonChange = (season: number) => {
    setSelectedSeason(season);
    setResources([]);
    void loadEpisodes(season);
    void handleSwitchSource(activeSource);
  };

  // ---- Initial load ----
  useEffect(() => {
    void loadDetail();
    void checkSubscription();
    if (mediaType === "tv") void loadEpisodes(selectedSeason);
    void handleSwitchSource("unified");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId]);

  useEffect(() => {
    let cancelled = false;
    const loadRuntimeResourceTabs = async () => {
      try {
        const response = await settingsApi.getRuntime();
        const runtime = response.data as { detail_visible_tabs?: unknown };
        const nextSources = normalizeVisibleResourceSources(runtime.detail_visible_tabs);
        if (cancelled) return;
        setVisibleResourceSources(nextSources);
        if (!nextSources.includes(activeSource)) {
          void handleSwitchSource(nextSources[0] || "unified");
        }
      } catch {
        if (!cancelled) {
          setVisibleResourceSources(RESOURCE_SOURCES.map((item) => item.key));
        }
      }
    };
    void loadRuntimeResourceTabs();
    return () => {
      cancelled = true;
    };
  }, [tmdbId]);

  // ---- Derived ----
  const title = detail?.title || detail?.name || defaultTitle;
  const year = detail?.release_date?.split("-")[0] || detail?.first_air_date?.split("-")[0] || "";
  const rating = detail?.vote_average;
  const genres = detail?.genres || [];
  const runtime = detail?.runtime;
  const cast = detail?.credits?.cast || [];
  const seasons = detail?.seasons || [];
  const bKey = buildBadgeKey(mediaType, tmdbId);

  return (
    <div className="space-y-6">
      <Pan115Progress state={progress} onClose={() => setProgress(deriveDefaultProgressState())} />

      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-xs font-black px-4 py-2 rounded-xl glass-hover transition-all"
        style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
      >
        <ArrowLeft className="w-4 h-4" />
        返回
      </button>

      {loading ? (
        <div className="glass-heavy rounded-3xl p-12 text-center">
          <div className="w-8 h-8 border-4 rounded-full animate-spin mx-auto" style={{ borderColor: "var(--brand-primary)", borderTopColor: "transparent" }} />
          <p className="text-xs font-bold mt-3" style={{ color: "var(--txt-muted)" }}>加载详情中…</p>
        </div>
      ) : error ? (
        <div className="glass-heavy rounded-3xl p-8 text-center">
          <ErrorBanner variant="block" message={error} onRetry={() => loadDetail()} />
        </div>
      ) : (
        <>
          {/* ====== HEADER ====== */}
          <div className="glass-heavy rounded-3xl p-6">
            <div className="flex flex-col md:flex-row gap-6">
              {/* Poster */}
              <div className="w-40 h-60 md:w-48 md:h-72 rounded-2xl overflow-hidden shrink-0 mx-auto md:mx-0"
                style={{ border: "1px solid var(--border)", background: "var(--surface-subtle)" }}>
                {(detail?.poster_path || defaultPoster) ? (
                  <img src={posterUrl(detail?.poster_path) || defaultPoster || ""} alt={title}
                    className="w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
                ) : (
                  <Film className="w-10 h-10 absolute inset-0 m-auto" style={{ color: "var(--txt-muted)" }} />
                )}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0 space-y-3">
                <div className="flex items-start gap-3 flex-wrap">
                  <h1 className="font-headline text-2xl font-black tracking-tight" style={{ color: "var(--txt)" }}>
                    {title}
                  </h1>
                  {bKey && <LibraryBadge status={statusMap[bKey]} />}
                </div>

                {(detail?.original_title || detail?.original_name) && (detail?.original_title || detail?.original_name) !== title && (
                  <p className="text-xs font-semibold" style={{ color: "var(--txt-muted)" }}>
                    {detail?.original_title || detail?.original_name}
                  </p>
                )}

                {/* Meta row */}
                <div className="flex flex-wrap items-center gap-3 text-xs font-bold">
                  {year && <span style={{ color: "var(--txt-secondary)" }}>{year}</span>}
                  {rating != null && rating > 0 && (
                    <span className="flex items-center gap-1" style={{ color: "var(--accent-warn)" }}>
                      <Star className="w-3.5 h-3.5" />
                      {rating.toFixed(1)}
                    </span>
                  )}
                  {runtime && (
                    <span className="flex items-center gap-1" style={{ color: "var(--txt-muted)" }}>
                      <Clock className="w-3.5 h-3.5" />{runtime} 分钟
                    </span>
                  )}
                  {mediaType === "tv" && detail?.number_of_seasons && (
                    <span className="flex items-center gap-1" style={{ color: "var(--txt-muted)" }}>
                      <Tv className="w-3.5 h-3.5" />{detail.number_of_seasons} 季
                    </span>
                  )}
                </div>

                {/* Genres */}
                {genres.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {genres.map((g) => (
                      <span key={g.id} className="px-2.5 py-1 rounded-full text-[10px] font-bold"
                        style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>
                        {g.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Overview */}
                {detail?.overview && (
                  <p className="text-sm leading-relaxed" style={{ color: "var(--txt-secondary)" }}>
                    {detail.overview}
                  </p>
                )}

                {/* Actions */}
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    onClick={handleToggleSubscribe}
                    disabled={subscribing}
                    className="px-4 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
                    style={isSubscribed
                      ? { background: "rgba(34,197,94,0.14)", color: "var(--accent-ok)", border: "1px solid rgba(34,197,94,0.3)" }
                      : { background: "var(--brand-primary)", color: "#fff", border: "1px solid var(--brand-primary)" }}
                  >
                    {isSubscribed ? <CheckCircle className="w-3.5 h-3.5" /> : <Rss className="w-3.5 h-3.5" />}
                    {isSubscribed ? "已订阅" : "添加订阅"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ====== 演员表（简略） ====== */}
          {cast.length > 0 && (
            <div className="glass rounded-2xl p-4">
              <button
                onClick={() => setShowFullCast(!showFullCast)}
                className="flex items-center gap-2 w-full text-left text-xs font-black"
                style={{ color: "var(--txt)" }}
              >
                <Users className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
                演员表 ({cast.length} 人)
              </button>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {cast.slice(0, showFullCast ? 50 : 8).map((c) => (
                  <span key={c.id} className="text-[10px] font-semibold px-2 py-1 rounded-lg"
                    style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>
                    {c.name}
                    {c.character && <span style={{ color: "var(--txt-muted)" }}> · {c.character}</span>}
                  </span>
                ))}
                {cast.length > 8 && !showFullCast && (
                  <button onClick={() => setShowFullCast(true)}
                    className="text-[10px] font-bold px-2 py-1" style={{ color: "var(--brand-primary)" }}>
                    +{cast.length - 8} 更多
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ====== TV Season Selector ====== */}
          {mediaType === "tv" && seasons.length > 0 && (
            <div className="glass rounded-2xl p-4 space-y-3">
              <h3 className="text-xs font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
                <Tv className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
                季选择
              </h3>
              <div className="flex flex-wrap gap-2">
                {seasons.filter(s => s.season_number > 0).map((s) => (
                  <button
                    key={s.season_number}
                    onClick={() => handleSeasonChange(s.season_number)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                    style={selectedSeason === s.season_number
                      ? { background: "var(--brand-primary)", color: "#fff", border: "1px solid var(--brand-primary)" }
                      : { background: "var(--surface)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
                  >
                    S{s.season_number}
                    <span className="ml-1 opacity-60">({s.episode_count || "?"}集)</span>
                  </button>
                ))}
              </div>

              {/* Episode grid */}
              {episodesLoading ? (
                <div className="text-center py-4">
                  <RefreshCw className="w-5 h-5 animate-spin mx-auto" style={{ color: "var(--txt-muted)" }} />
                </div>
              ) : seasonEpisodes.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[300px] overflow-y-auto pr-1 no-scrollbar">
                  {seasonEpisodes.map((ep) => (
                    <div key={ep.episode_number} className="flex gap-3 rounded-xl p-2.5"
                      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                      <div className="w-12 h-8 rounded-lg shrink-0 flex items-center justify-center text-[10px] font-black"
                        style={{ background: "var(--surface-subtle)", color: "var(--txt-muted)" }}>
                        E{ep.episode_number}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold truncate" style={{ color: "var(--txt)" }}>{ep.name || `第 ${ep.episode_number} 集`}</p>
                        {ep.runtime && (
                          <p className="text-[9px] font-semibold" style={{ color: "var(--txt-muted)" }}>{ep.runtime} 分钟</p>
                        )}
                        {ep.air_date && (
                          <p className="text-[9px] font-semibold" style={{ color: "var(--txt-muted)" }}>{ep.air_date}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {/* ====== 资源通道 ====== */}
          <div className="glass-heavy rounded-3xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <Download className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />
              <h3 className="font-headline text-lg font-black" style={{ color: "var(--txt)" }}>资源通道</h3>
              {mediaType === "tv" && <span className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>S{selectedSeason}</span>}
            </div>

            {/* Source tabs */}
            <div className="flex flex-wrap gap-1.5">
              {RESOURCE_SOURCES.filter((source) => visibleResourceSources.includes(source.key)).map((s) => (
                <button
                  key={s.key}
                  onClick={() => handleSwitchSource(s.key)}
                  disabled={resourcesLoading}
                  className="px-3 py-1.5 rounded-lg text-[9px] font-bold transition-all glass-hover"
                  style={activeSource === s.key
                    ? { background: "var(--brand-primary)", color: "#fff", border: "1px solid var(--brand-primary)" }
                    : { background: "var(--surface)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Resource list */}
            {resourcesLoading ? (
              <div className="text-center py-8">
                <div className="w-6 h-6 border-[3px] rounded-full animate-spin mx-auto" style={{ borderColor: "var(--brand-primary)", borderTopColor: "transparent" }} />
                <p className="text-[10px] mt-2 font-semibold" style={{ color: "var(--txt-muted)" }}>
                  {activeSource === "magnet_seedhub" && seedhubTask
                    ? `${seedhubTask.message} (${seedhubTask.status})`
                    : "拉取资源链接…"}
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
            ) : resources.length === 0 ? (
              <div className="text-center py-8 rounded-xl" style={{ background: "var(--surface-subtle)", border: "1px dashed var(--border)" }}>
                <FolderOpen className="w-8 h-8 mx-auto" style={{ color: "var(--txt-muted)" }} />
                <p className="text-xs font-semibold mt-2" style={{ color: "var(--txt-muted)" }}>该来源暂无资源</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1 no-scrollbar">
                {resources.map((link, idx) => {
                  const isTransferring = transferringId === `transfer-${idx}`;
                  const isUnlocking = unlockingSlug === `unlock-${idx}`;
                  const disabled = !link.shareUrl;

                  return (
                    <div key={idx} className="glass rounded-xl p-3 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold break-all leading-snug line-clamp-2" style={{ color: "var(--txt)" }}>
                          {link.name}
                        </span>
                      </div>

                      {/* Tags */}
                      <div className="flex flex-wrap gap-1">
                        {link.sourceService && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" }}>
                            {link.sourceService}
                          </span>
                        )}
                        {link.resolution && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(99,102,241,0.14)", color: "var(--accent-info)" }}>
                            {link.resolution}
                          </span>
                        )}
                        {link.slug && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={link.unlocked
                            ? { background: "rgba(34,197,94,0.16)", color: "var(--accent-ok)" }
                            : { background: "rgba(245,158,11,0.16)", color: "var(--accent-warn)" }}>
                            {link.unlocked ? "已解锁" : "待解锁"}
                          </span>
                        )}
                        {link.magnetUrl && !link.shareUrl && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(168,85,247,0.16)", color: "#c084fc" }}>磁力</span>
                        )}
                      </div>

                      {/* Actions row */}
                      <div className="flex items-center justify-between text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>
                        <div className="flex gap-3">
                          <span>大小: <strong style={{ color: "var(--txt-secondary)" }}>{link.size}</strong></span>
                          {link.seeds != null && <span>健康度: <strong style={{ color: "var(--accent-ok)" }}>{link.seeds}</strong></span>}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {link.slug && !link.unlocked && (
                            <button
                              disabled={isUnlocking}
                              onClick={() => handleUnlock(link.slug!, idx)}
                              className="px-2 py-1 rounded text-[8px] font-black text-white disabled:opacity-50 flex items-center gap-1"
                              style={{ background: "var(--accent-warn)" }}
                            >
                              {isUnlocking ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                              解锁
                            </button>
                          )}
                          {link.shareUrl && (
                            <button
                              disabled={isTransferring || disabled}
                              onClick={() => handleTransfer(link, idx)}
                              className="px-2.5 py-1 rounded text-[9px] font-black tracking-wider flex items-center gap-1 disabled:opacity-50"
                              style={{ background: "var(--brand-primary)", color: "#fff", border: "1px solid var(--brand-primary)" }}
                            >
                              {isTransferring ? (
                                <RefreshCw className="w-3 h-3 animate-spin" />
                              ) : (
                                <Plus className="w-3 h-3" />
                              )}
                              秒传
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Security badge */}
            <div className="rounded-2xl p-3 flex gap-2 items-center"
              style={{ background: "var(--brand-primary-bg-alpha)", border: "1px solid var(--brand-primary-border-alpha)" }}>
              <Shield className="w-4 h-4 shrink-0" style={{ color: "var(--brand-primary)" }} />
              <p className="text-[10px] font-semibold leading-relaxed" style={{ color: "var(--brand-primary)" }}>
                本秒传通道完全加密！所有磁力经由您的 115 会话密钥直接发送至 115 官方云接口。
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
