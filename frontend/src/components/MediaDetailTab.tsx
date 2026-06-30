/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MediaDetailTab — 独立详情页（电影/剧集通用）
 *
 * 对应 Vue 旧版 MovieDetail(2031行)/TvDetail(2259行)，核心功能：
 *   1. 媒体信息头部（海报/标题/年份/评分/类型/概述/订阅/入库标记）
 *   2. 剧集：季选择器 + 分集网格 + 单集资源获取
 *   3. 相似影片推荐
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft, Star, Clock, Film, Tv,
  CheckCircle, RefreshCw, Rss, Users,
} from "lucide-react";
import ErrorBanner from "./ui/ErrorBanner";
import { motion } from "motion/react";
import { searchApi } from "../api/search";
import { subscriptionApi } from "../api/subscription";
import { settingsApi } from "../api/settings";
import { pan115Api } from "../api/pan115";
import { quarkApi } from "../api/quark";
import LibraryBadge, { buildBadgeKey, mergeStatusMap, type BadgeStatus } from "./LibraryBadge";
import SubscriptionDialog from "./SubscriptionDialog";
import type { DetailContext, PageName } from "../types";
import type { RecommendationItem } from "../api/types";

// ---- Types ----

interface MediaDetailTabProps {
  tmdbId: number;
  mediaType: "movie" | "tv";
  defaultTitle: string;
  defaultPoster?: string;
  returnTo: PageName;
  onBack: () => void;
  onNavigateToDetail: (ctx: DetailContext) => void;
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

function posterUrl(path: string | undefined, size = "w300"): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

export default function MediaDetailTab({
  tmdbId, mediaType, defaultTitle, defaultPoster, returnTo, onBack, onNavigateToDetail, addLog,
}: MediaDetailTabProps) {
  // ---- State ----
  const [detail, setDetail] = useState<TmdbDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Status
  const [statusMap, setStatusMap] = useState<Record<string, BadgeStatus>>({});
  // #8 拆分 115 / PT 订阅状态：分别识别本系统 mediasync115 订阅与 MoviePilot PT 订阅
  // 订阅 id 为 null = 未订阅；非空 = 已订阅（取消时按 id 调 DELETE）
  const [pan115SubId, setPan115SubId] = useState<string | null>(null);
  const [ptSubId, setPtSubId] = useState<string | null>(null);
  const [pan115SubTitle, setPan115SubTitle] = useState<string>("");
  const [subscriptionDialogOpen, setSubscriptionDialogOpen] = useState(false);

  // TV
  const [selectedSeason, setSelectedSeason] = useState(1);
  const [seasonEpisodes, setSeasonEpisodes] = useState<TvEpisode[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);

  // Recommendations
  const [recommendations, setRecommendations] = useState<RecommendationItem[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);

  // Cast visibility
  const [showFullCast, setShowFullCast] = useState(false);

  // #4 转存默认目录：从 runtime/settings 读取，用于在转存动作旁展示「目标：<folder_name>」，让用户清楚文件被转存到哪里
  const [pan115DefaultFolderName, setPan115DefaultFolderName] = useState<string>("");
  const [quarkDefaultFolderName, setQuarkDefaultFolderName] = useState<string>("");

  // ---- Derived ----
  const title = detail?.title || detail?.name || defaultTitle;
  const year = detail?.release_date?.split("-")[0] || detail?.first_air_date?.split("-")[0] || "";
  const rating = detail?.vote_average;
  const genres = detail?.genres || [];
  const runtime = detail?.runtime;
  const cast = detail?.credits?.cast || [];
  const seasons = detail?.seasons || [];
  const bKey = buildBadgeKey(mediaType, tmdbId);

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
  // 分别识别本系统 115 自动搜索订阅（provider/external_system 为 mediasync115 或空）
  // 与 MoviePilot PT 订阅（provider/external_system == "moviepilot"）。
  const checkSubscription = useCallback(async () => {
    try {
      const resp = await subscriptionApi.list({ is_active: true, media_type: mediaType });
      const rawList = resp.data as unknown;
      const list: { id?: string; tmdb_id?: number; title?: string; provider?: string; external_system?: string; [key: string]: unknown }[] = Array.isArray(rawList)
        ? (rawList as { id?: string; tmdb_id?: number; title?: string; provider?: string; external_system?: string }[])
        : ((rawList as { items?: { id?: string; tmdb_id?: number; title?: string; provider?: string; external_system?: string }[] })?.items || []);
      let nextPan115Id: string | null = null;
      let nextPan115Title = "";
      let nextPtId: string | null = null;
      for (const s of list) {
        if (s.tmdb_id !== tmdbId) continue;
        const provider = String(s.provider ?? "").toLowerCase();
        const externalSystem = String(s.external_system ?? "").toLowerCase();
        const isPan115 = (!provider || provider === "mediasync115") && (!externalSystem || externalSystem === "mediasync115");
        const isPt = provider === "moviepilot" || externalSystem === "moviepilot";
        if (isPan115 && !nextPan115Id) {
          nextPan115Id = String(s.id || "");
          nextPan115Title = String(s.title || "");
        } else if (isPt && !nextPtId) {
          nextPtId = String(s.id || "");
        }
      }
      setPan115SubId(nextPan115Id);
      setPan115SubTitle(nextPan115Title);
      setPtSubId(nextPtId);
    } catch { /* ignore */ }
  }, [tmdbId, mediaType]);

  const isPan115Subscribed = pan115SubId !== null;
  const isPtSubscribed = ptSubId !== null;

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

  const loadRecommendations = useCallback(async () => {
    setRecommendationsLoading(true);
    try {
      const response = await searchApi.getRecommendations(mediaType, tmdbId, 1);
      setRecommendations((response.data.items || []).slice(0, 12));
    } catch (err) {
      console.warn("Failed to load recommendations:", err);
      setRecommendations([]);
    } finally {
      setRecommendationsLoading(false);
    }
  }, [mediaType, tmdbId]);

  // ---- Subscribe ----
  // 订阅创建/取消统一由 SubscriptionDialog 弹窗承载：渠道选择、115 固定来源绑定、TV 范围、PT 改写 provider 预警等。
  // 这里仅保留弹窗的打开入口 + 弹窗提交后的状态刷新回调。PT 资源卡片上的"添加 PT 订阅"按钮也直接打开弹窗（默认聚焦 PT 渠道即可，弹窗内部自选）。
  const openSubscriptionDialog = () => setSubscriptionDialogOpen(true);

  // 弹窗内订阅状态变更后刷新 checkSubscription
  const handleSubscriptionChanged = async () => {
    await checkSubscription();
  };

  // ---- Season change ----
  const handleSeasonChange = (season: number) => {
    setSelectedSeason(season);
    void loadEpisodes(season);
  };

  // ---- Initial load ----
  useEffect(() => {
    void loadDetail();
    void checkSubscription();
    void loadRecommendations();
    if (mediaType === "tv") void loadEpisodes(selectedSeason);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId]);

  // 读取 115/夸克默认转存目录，供订阅弹窗和底部提示展示。
  useEffect(() => {
    let cancelled = false;
    const loadRuntimeDefaults = async () => {
      const settled = await Promise.allSettled([
        settingsApi.getRuntime(),
        pan115Api.getDefaultFolder(),
        quarkApi.getDefaultFolder(),
      ]);
      const runtimeResult = settled[0];
      if (runtimeResult.status === "fulfilled") {
        const runtime = runtimeResult.value.data as {
          pan115_default_folder_name?: string;
          quark_default_folder_name?: string;
        };
        if (!cancelled) setPan115DefaultFolderName(String(runtime.pan115_default_folder_name || ""));
        if (!cancelled) setQuarkDefaultFolderName(String(runtime.quark_default_folder_name || ""));
      }
      if (settled[1].status === "fulfilled") {
        const data = settled[1].value.data as { folder_name?: string };
        if (!cancelled) setPan115DefaultFolderName(String(data.folder_name || ""));
      }
      if (settled[2].status === "fulfilled") {
        const data = settled[2].value.data as { folder_name?: string };
        if (!cancelled) setQuarkDefaultFolderName(String(data.folder_name || ""));
      }
    };
    void loadRuntimeDefaults();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tmdbId]);

  // ---- Derived (title/seasons 等已上移；此处保留返回 JSX) ----
  return (
    <div className="liquid-page space-y-6">
      <SubscriptionDialog
        open={subscriptionDialogOpen}
        tmdbId={tmdbId}
        mediaType={mediaType}
        title={title}
        defaultPoster={defaultPoster}
        detail={detail}
        seasons={seasons}
        pan115SubId={pan115SubId}
        ptSubId={ptSubId}
        pan115DefaultFolderName={pan115DefaultFolderName}
        quarkDefaultFolderName={quarkDefaultFolderName}
        addLog={addLog}
        onClose={() => setSubscriptionDialogOpen(false)}
        onChanged={handleSubscriptionChanged}
      />

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
        <div className="liquid-hero glass-heavy glass-iridescent glass-spotlight rounded-3xl p-12 text-center">
          <div className="w-8 h-8 border-4 rounded-full animate-spin mx-auto" style={{ borderColor: "var(--brand-primary)", borderTopColor: "transparent" }} />
          <p className="text-xs font-bold mt-3" style={{ color: "var(--txt-muted)" }}>加载详情中…</p>
        </div>
      ) : error ? (
        <div className="liquid-hero glass-heavy glass-iridescent glass-spotlight rounded-3xl p-8 text-center">
          <ErrorBanner variant="block" message={error} onRetry={() => loadDetail()} />
        </div>
      ) : (
        <>
          {/* ====== HEADER ====== */}
          <div className="liquid-hero glass-heavy glass-iridescent glass-spotlight rounded-3xl p-6">
            <div className="flex flex-col md:flex-row gap-6">
              {/* Poster */}
              <div className="w-40 h-60 md:w-48 md:h-72 rounded-2xl overflow-hidden shrink-0 mx-auto md:mx-0 relative"
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

                {/* Actions — 订阅入口：点击弹出 SubscriptionDialog，承载渠道选择 / 115 固定来源 / TV 范围 / PT 预警 */}
                <div className="flex flex-wrap gap-2 pt-1">
                  {(isPan115Subscribed || isPtSubscribed) && (
                    <span
                      className="px-2.5 py-2 rounded-xl text-[10px] font-black flex items-center gap-1.5"
                      style={{ background: "rgba(34,197,94,0.14)", color: "var(--accent-ok)", border: "1px solid rgba(34,197,94,0.3)" }}
                    >
                      <CheckCircle className="w-3.5 h-3.5" />
                      {isPan115Subscribed && "已订阅 115"}
                      {isPan115Subscribed && isPtSubscribed && " · "}
                      {isPtSubscribed && "已订阅 PT"}
                    </span>
                  )}
                  <button
                    onClick={openSubscriptionDialog}
                    className="px-4 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all active:scale-95"
                    style={{ background: "var(--brand-primary)", color: "#fff", border: "1px solid var(--brand-primary)" }}
                  >
                    <Rss className="w-3.5 h-3.5" />
                    {(isPan115Subscribed || isPtSubscribed) ? "管理订阅" : "添加订阅"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ====== 演员表（简略） ====== */}
          {cast.length > 0 && (
            <div className="liquid-panel glass rounded-2xl p-4">
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
            <div className="liquid-panel glass rounded-2xl p-4 space-y-3">
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
              ) : (
                <div className="rounded-xl py-3 text-center text-[10px] font-semibold"
                  style={{ background: "var(--surface-subtle)", color: "var(--txt-muted)", border: "1px dashed var(--border)" }}>
                  该季暂无分集信息
                </div>
              )}
            </div>
          )}

          {/* ====== 相似影片推荐 ====== */}
          <div className="liquid-panel glass-heavy glass-iridescent rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Film className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />
                <h3 className="font-headline text-lg font-black" style={{ color: "var(--txt)" }}>相似影片推荐</h3>
              </div>
              {recommendationsLoading && (
                <RefreshCw className="w-4 h-4 animate-spin" style={{ color: "var(--txt-muted)" }} />
              )}
            </div>

            {recommendationsLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="h-52 rounded-2xl animate-pulse" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }} />
                ))}
              </div>
            ) : recommendations.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {recommendations.map((item, index) => {
                  const itemTitle = item.title || item.name || "未知标题";
                  const itemYear = item.year || item.release_date?.slice(0, 4) || item.first_air_date?.slice(0, 4) || "";
                  const itemRating = typeof item.rating === "number"
                    ? item.rating
                    : (typeof item.vote_average === "number" ? item.vote_average : undefined);
                  const itemPoster = posterUrl(item.poster_path || item.poster_url, "w300");
                  const nextTmdbId = Number(item.tmdb_id || item.id || 0);
                  return (
                    <button
                      key={`${item.id || item.tmdb_id || itemTitle}-${index}`}
                      type="button"
                      disabled={!nextTmdbId}
                      onClick={() => {
                        if (!nextTmdbId) return;
                        onNavigateToDetail({
                          tmdbId: nextTmdbId,
                          mediaType,
                          title: itemTitle,
                          poster: item.poster_path || item.poster_url || "",
                          returnTo,
                        });
                      }}
                      className="group text-left rounded-2xl p-2 glass glass-hover transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ border: "1px solid var(--border)" }}
                    >
                      <div className="aspect-[2/3] rounded-xl overflow-hidden relative" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                        {itemPoster ? (
                          <img src={itemPoster} alt={itemTitle} className="w-full h-full object-cover transition-transform group-hover:scale-[1.03]" referrerPolicy="no-referrer" loading="lazy" />
                        ) : (
                          <Film className="w-8 h-8 absolute inset-0 m-auto" style={{ color: "var(--txt-muted)" }} />
                        )}
                      </div>
                      <div className="mt-2 min-w-0">
                        <p className="text-[11px] font-black leading-snug line-clamp-2" style={{ color: "var(--txt)" }}>{itemTitle}</p>
                        <div className="mt-1 flex items-center justify-between gap-1 text-[9px] font-bold" style={{ color: "var(--txt-muted)" }}>
                          <span>{itemYear || (mediaType === "tv" ? "剧集" : "电影")}</span>
                          {itemRating != null && itemRating > 0 && (
                            <span className="flex items-center gap-0.5" style={{ color: "var(--accent-warn)" }}>
                              <Star className="w-3 h-3" />
                              {itemRating.toFixed(1)}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl py-8 text-center text-xs font-semibold" style={{ background: "var(--surface-subtle)", color: "var(--txt-muted)", border: "1px dashed var(--border)" }}>
                暂无相似影片推荐
              </div>
            )}
          </div>

          <div className="rounded-2xl p-3"
            style={{ background: "var(--brand-primary-bg-alpha)", border: "1px solid var(--brand-primary-border-alpha)" }}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-bold">
              <span style={{ color: "var(--txt-muted)" }}>
                115 转存目标：<strong style={{ color: "var(--txt-secondary)" }}>{pan115DefaultFolderName || "根目录（未配置）"}</strong>
              </span>
              <span style={{ color: "var(--txt-muted)" }}>
                夸克转存目标：<strong style={{ color: "var(--txt-secondary)" }}>{quarkDefaultFolderName || "根目录（未配置）"}</strong>
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
