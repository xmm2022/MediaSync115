import React, { useState, useEffect, useCallback } from "react";
import { Sparkles, Trophy, Star, Search, Plus, Calendar, BookmarkCheck, ArrowRight, Eye, Loader2, AlertTriangle } from "lucide-react";
import { motion } from "motion/react";
import { searchApi } from "../api/search";
import type { ExploreItem } from "../api/types";
import LibraryBadge, { buildBadgeKey, mergeStatusMap, type BadgeStatus } from "./LibraryBadge";

interface ExploreTabProps {
  onSearchQuery: (query: string) => void;
  onAddSubscription: (title: string, category: "Movie" | "TV" | "Anime", poster: string) => void;
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

// 电影类豆瓣 section key 列表
const DOUBAN_MOVIE_SECTION_KEYS = new Set([
  "movie_hot",
  "movie_showing",
  "movie_latest",
  "movie_top250",
]);

// 动画 section key
const DOUBAN_ANIME_SECTION_KEY = "tv_animation";

type BoardKey = "tmdb" | "douban" | "animation";

// 后端 media_type 到 UI category 的映射
function mapCategory(mediaType: string, board: BoardKey): "Movie" | "TV" | "Anime" {
  if (board === "animation") return "Anime";
  return mediaType === "tv" ? "TV" : "Movie";
}

// poster_url 占位图：后端可能返回空 poster_url
const FALLBACK_POSTER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='176' viewBox='0 0 120 176'%3E%3Crect fill='%23e2e8f0' width='120' height='176'/%3E%3Ctext x='60' y='92' text-anchor='middle' fill='%2394a3b8' font-size='12'%3ENo Poster%3C/text%3E%3C/svg%3E";

export default function ExploreTab({ onSearchQuery, onAddSubscription }: ExploreTabProps) {
  const [activeBoard, setActiveBoard] = useState<BoardKey>("tmdb");
  const [items, setItems] = useState<ExploreItem[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, BadgeStatus>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sectionTitle, setSectionTitle] = useState("");

  const fetchBoard = useCallback(async (board: BoardKey) => {
    setLoading(true);
    setError(null);
    setItems([]);
    setStatusMap({});

    try {
      const agg: Record<string, BadgeStatus> = {};
      if (board === "tmdb") {
        // TMDB 流行趋势：展平全部 TMDB section
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
        // 豆瓣电影榜单：仅电影类 section
        const { data } = await searchApi.getExploreSections("douban", 24, false);
        const allItems: ExploreItem[] = [];
        const sections = data?.sections ?? [];
        for (const sec of sections) {
          if (!DOUBAN_MOVIE_SECTION_KEYS.has(sec.key)) continue;
          if (sec.items && Array.isArray(sec.items)) {
            for (const it of sec.items) {
              allItems.push(it as ExploreItem);
            }
          }
        }
        setItems(allItems);
        setSectionTitle("豆瓣电影榜单");
        mergeStatusMap(agg, data?.emby_status_map as Record<string, unknown> | undefined, "emby");
        mergeStatusMap(agg, data?.feiniu_status_map as Record<string, unknown> | undefined, "feiniu");
      } else {
        // 豆瓣动画：仅 tv_animation section
        const { data } = await searchApi.getExploreDoubanSection(
          DOUBAN_ANIME_SECTION_KEY,
          24,
          false,
          0,
        );
        const section = data as unknown as {
          key?: string;
          title?: string;
          items?: ExploreItem[];
          emby_status_map?: Record<string, unknown>;
          feiniu_status_map?: Record<string, unknown>;
        };
        const secItems = section?.items ?? [];
        setItems(Array.isArray(secItems) ? secItems : []);
        setSectionTitle(section?.title || "豆瓣动画");
        mergeStatusMap(agg, section?.emby_status_map, "emby");
        mergeStatusMap(agg, section?.feiniu_status_map, "feiniu");
      }
      setStatusMap(agg);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "探索数据加载失败，请稍后重试";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoard(activeBoard);
  }, [activeBoard, fetchBoard]);

  return (
    <div id="explore-tab-container" className="space-y-6">
      {/* Billboard Hero Banner */}
      <div className="bg-gradient-to-br from-violet-500/10 via-brand-primary/5 to-white/30 backdrop-blur-md rounded-3xl p-6 border border-white/60 shadow-sm relative overflow-hidden">
        <div className="relative z-10">
          <h2 className="text-2xl font-black text-txt-dark tracking-tight flex items-center gap-2.5">
            <Trophy className="w-6.5 h-6.5 text-amber-500" />
            <span>影视榜单 & 流行风向探索</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-xl leading-relaxed">
            数据来源于 TMDB 全球流行趋势与豆瓣实时榜单，每日自动更新，追热门、挑高分、发现好片。
          </p>
        </div>
        <div className="absolute right-6 top-6 opacity-10 select-none">
          <Sparkles className="w-24 h-24 text-indigo-500" />
        </div>
      </div>

      {/* Toggle Tab Navigation for boards */}
      <div className="flex border-b border-slate-200/40">
        <button
          onClick={() => setActiveBoard("tmdb")}
          className={`px-5 py-3.5 text-xs font-black relative flex items-center gap-2 transition-all ${
            activeBoard === "tmdb" ? "text-brand-primary" : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <span>TMDB 流行趋势</span>
          {activeBoard === "tmdb" && (
            <motion.div layoutId="exploreUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-primary" />
          )}
        </button>

        <button
          onClick={() => setActiveBoard("douban")}
          className={`px-5 py-3.5 text-xs font-black relative flex items-center gap-2 transition-all ${
            activeBoard === "douban" ? "text-brand-primary" : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <span>豆瓣电影榜单</span>
          {activeBoard === "douban" && (
            <motion.div layoutId="exploreUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-primary" />
          )}
        </button>

        <button
          onClick={() => setActiveBoard("animation")}
          className={`px-5 py-3.5 text-xs font-black relative flex items-center gap-2 transition-all ${
            activeBoard === "animation" ? "text-brand-primary" : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <span>豆瓣动画</span>
          {activeBoard === "animation" && (
            <motion.div layoutId="exploreUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-primary" />
          )}
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-brand-primary" />
          <span className="text-xs font-semibold">正在加载榜单数据...</span>
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <AlertTriangle className="w-8 h-8 text-amber-500" />
          <p className="text-xs text-slate-500 font-semibold max-w-md text-center">{error}</p>
          <button
            onClick={() => fetchBoard(activeBoard)}
            className="px-4 py-2 rounded-xl text-xs font-black text-brand-primary border border-brand-primary/30 hover:bg-brand-primary/5 transition-all"
          >
            重试
          </button>
        </div>
      )}

      {/* Empty state (loaded but 0 items) */}
      {!loading && !error && items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
          <Eye className="w-8 h-8" />
          <p className="text-xs font-semibold">暂无榜单数据</p>
          <p className="text-[10px] text-slate-400">该来源暂时没有可展示的内容，请稍后刷新</p>
        </div>
      )}

      {/* Grid displays */}
      {!loading && !error && items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {items.map((item, idx) => {
            const poster = item.poster_url || FALLBACK_POSTER;
            const title = item.title || "未知标题";
            const category = mapCategory(item.media_type, activeBoard);
            const desc = item.intro || item.year || "暂无简介";
            const rating =
              item.rating != null ? (typeof item.rating === "number" ? item.rating.toFixed(1) : String(item.rating)) : null;
            const rankLabel = item.rank ?? idx + 1;
            const bKey = buildBadgeKey(item.media_type, item.tmdb_id);
            const badge = bKey ? <LibraryBadge status={statusMap[bKey]} /> : null;

            return (
              <div
                key={`${item.id ?? idx}-${idx}`}
                className="bg-white/70 backdrop-blur-md rounded-2xl border border-white/60 p-4 flex gap-4 hover:shadow-xs hover:bg-white/85 transition-all relative overflow-hidden"
              >
                {/* Rank badge ribbon */}
                <div
                  className={`absolute top-0 left-0 w-8 h-8 flex items-center justify-center rounded-br-2xl font-black text-xs text-white ${
                    rankLabel === 1
                      ? "bg-amber-500 shadow-xs"
                      : rankLabel === 2
                        ? "bg-slate-400"
                        : rankLabel === 3
                          ? "bg-amber-700"
                          : "bg-slate-300"
                  }`}
                >
                  #{rankLabel}
                </div>

                {/* Poster cover thumbnail */}
                <div className="w-20 h-28 rounded-xl overflow-hidden bg-slate-50 border border-slate-100 shrink-0 relative mt-2">
                  <img
                    src={poster}
                    alt={title}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = FALLBACK_POSTER;
                    }}
                  />
                </div>

                {/* Content info */}
                <div className="flex-1 flex flex-col justify-between pt-1">
                  <div>
                    <div className="flex items-start justify-between gap-2 pl-4">
                      <h4 className="font-headline font-bold text-sm text-txt-dark truncate leading-snug">
                        {title}
                      </h4>
                    </div>

                    <div className="flex gap-2 items-center text-[10px] text-slate-400 font-bold pl-4 mt-0.5">
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
                        {item.media_type === "tv" ? "剧集" : "电影"}
                      </span>
                      {item.year && (
                        <>
                          <span>.</span>
                          <span className="text-slate-400">{item.year}</span>
                        </>
                      )}
                    </div>

                    {badge && <div className="pl-4 mt-1.5">{badge}</div>}

                    <p className="text-xs text-slate-500 line-clamp-2 mt-2 leading-relaxed pl-4">
                      {desc}
                    </p>
                  </div>

                  {/* Action buttons */}
                  <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-slate-200/40">
                    <button
                      onClick={() => onSearchQuery(title.split(" (")[0])}
                      className="px-2.5 py-1.5 rounded-lg text-[10px] font-black text-slate-500 hover:text-brand-primary hover:bg-brand-primary/5 transition-all flex items-center gap-1 border border-slate-100"
                    >
                      <Search className="w-3.5 h-3.5" />
                      <span>影视检索</span>
                    </button>

                    <button
                      onClick={() => onAddSubscription(title.split(" (")[0], category, poster)}
                      className="px-2.5 py-1.5 rounded-lg text-[10px] font-black bg-brand-primary text-white hover:bg-brand-primary-light hover:shadow-sm transition-all flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>一键订阅</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom widget */}
      <div className="bg-white/50 backdrop-blur-md border border-white/40 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 hover:bg-white/60 transition-all">
        <div className="flex gap-3 items-center text-left">
          <div className="w-10 h-10 rounded-full bg-brand-secondary-light/10 text-brand-secondary flex items-center justify-center shrink-0">
            <BookmarkCheck className="w-5.5 h-5.5" />
          </div>
          <div>
            <h4 className="text-xs font-black text-txt-dark">想看的新影视榜单中没有？</h4>
            <p className="text-[10px] text-slate-400 font-semibold leading-relaxed mt-0.5">
              您可以直接利用顶部的 磁力云端检索 或在 自动订阅 中配置私有 RSS 地址进行全自动轮询追踪。
            </p>
          </div>
        </div>
        <button
          onClick={() => onSearchQuery("")}
          className="bg-white/80 backdrop-blur-xs border border-white/60 hover:border-slate-300 text-slate-500 px-4 py-2 rounded-xl text-xs font-black tracking-wider flex items-center gap-1.5 shrink-0 transition-all active:scale-95 shadow-xs"
        >
          <span>立即前往磁力搜索</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
