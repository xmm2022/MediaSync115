import React, { useState, useEffect } from "react";
import type { SubscriptionItem } from "../api/types";
import { subscriptionApi } from "../api";
import { Workflow, Plus, Trash2, Play, Pause, Rss, AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Mock SyncDirectory still used as prop from parent; real backend has no
// per-subscription "target directory" concept (handled via archive config).
interface SyncDirectory {
  id: string;
  name: string;
  localPath: string;
  folderId115: string;
  targetClient: "emby" | "plex" | "jellyfin";
  status: "syncing" | "idle" | "scanning" | "error";
  speed: string;
  progress: number;
  enabled: boolean;
  totalSize: string;
  itemCount: number;
}

interface SubscriptionTabProps {
  directories: SyncDirectory[];
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => Promise<void>;
}

// ---- Display-field derivations from real backend SubscriptionItem ----

/** Derive a human-readable category label from media_type. */
function deriveCategoryLabel(mediaType: string): string {
  switch (mediaType) {
    case "movie": return "电影";
    case "tv": return "剧集";
    case "collection": return "合集";
    default: return mediaType;
  }
}

/** Derive a progress/scope string for display. */
function deriveProgress(sub: SubscriptionItem): string {
  if (sub.media_type === "movie" || sub.media_type === "collection") {
    return "单部作品";
  }
  // TV
  const sn = sub.tv_season_number;
  const scope = sub.tv_scope;
  if (scope === "all") return sn ? `S${sn} 全季` : "全季";
  if (scope === "season") return sn ? `S${sn}` : "按季";
  if (scope === "episode_range") {
    const es = sub.tv_episode_start;
    const ee = sub.tv_episode_end;
    const sLabel = sn ? `S${sn}` : "";
    if (es != null && ee != null) return `${sLabel}E${es}-E${ee}`.replace(/^ /, "");
    if (es != null) return `${sLabel}E${es}+`.replace(/^ /, "");
    return sn ? `S${sn}` : "选集范围";
  }
  // No tv_scope — backend may not return detailed scope in list endpoint;
  // fallback to showing season number if present.
  if (sn) return `S${sn}`;
  return sn ? `S${sn}` : "连载中";
}

/** Derive a human-readable source summary from the sources array. */
function deriveRssSource(sub: SubscriptionItem): string {
  const srcs = sub.sources;
  if (!srcs || srcs.length === 0) return "无来源";
  const first = srcs[0];
  return first.display_name || first.source_type || "订阅来源";
}

/** Derive a display status string from is_active. */
function deriveStatus(sub: SubscriptionItem): "subscribing" | "paused" {
  return sub.is_active ? "subscribing" : "paused";
}

/** Construct a TMDB poster URL from poster_path, falling back to a placeholder. */
function posterUrl(sub: SubscriptionItem): string {
  if (sub.poster_path) {
    return `https://image.tmdb.org/t/p/w200${sub.poster_path}`;
  }
  // Generic placeholder
  return "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&q=80";
}

export default function SubscriptionTab({ directories, addLog }: SubscriptionTabProps) {
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ---- Form fields (aligned with real SubscriptionCreate) ----
  const [title, setTitle] = useState("");
  const [mediaType, setMediaType] = useState("tv");
  const [tmdbId, setTmdbId] = useState<number | undefined>(undefined);
  const [doubanId, setDoubanId] = useState("");
  // TV-specific fields
  const [tvScope, setTvScope] = useState<string>("all");
  const [tvSeasonNumber, setTvSeasonNumber] = useState<number | undefined>(undefined);
  const [tvEpisodeStart, setTvEpisodeStart] = useState<number | undefined>(undefined);
  const [tvEpisodeEnd, setTvEpisodeEnd] = useState<number | undefined>(undefined);
  const [tvFollowMode, setTvFollowMode] = useState<string>("missing");
  const [autoDownload, setAutoDownload] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ---- Load subscriptions from real backend ----
  const loadSubscriptions = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const response = await subscriptionApi.list();
      setSubscriptions(response.data as SubscriptionItem[]);
    } catch (err) {
      console.error("Failed to load subscriptions:", err);
      setErrorMessage("加载订阅列表失败，请检查后端连接");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSubscriptions();
  }, []);

  // ---- Create subscription ----
  const handleAddSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    const payload: Parameters<typeof subscriptionApi.create>[0] = {
      title: title.trim(),
      media_type: mediaType,
    };

    // Optional IDs
    if (tmdbId) payload.tmdb_id = tmdbId;
    if (doubanId.trim()) payload.douban_id = doubanId.trim();

    // TV-specific fields
    if (mediaType === "tv") {
      payload.tv_scope = tvScope;
      if (tvSeasonNumber != null) payload.tv_season_number = tvSeasonNumber;
      if (tvEpisodeStart != null) payload.tv_episode_start = tvEpisodeStart;
      if (tvEpisodeEnd != null) payload.tv_episode_end = tvEpisodeEnd;
      if (tvFollowMode) payload.tv_follow_mode = tvFollowMode;
    }

    // auto_download is sent regardless
    payload.auto_download = autoDownload;

    try {
      await subscriptionApi.create(payload);
      await addLog("SUCCESS", `成功创建订阅 [${title.trim()}]`);
      // Reset form
      setTitle("");
      setTmdbId(undefined);
      setDoubanId("");
      setTvScope("all");
      setTvSeasonNumber(undefined);
      setTvEpisodeStart(undefined);
      setTvEpisodeEnd(undefined);
      setTvFollowMode("missing");
      setAutoDownload(true);
      setShowAddForm(false);
      // Reload list
      await loadSubscriptions();
    } catch (err) {
      console.error("Failed to create subscription:", err);
      setErrorMessage("创建订阅失败，请检查输入字段");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ---- Toggle subscription active status ----
  const handleToggleStatus = async (sub: SubscriptionItem) => {
    try {
      const newActive = !sub.is_active;
      await subscriptionApi.update(sub.id, { is_active: newActive });
      await addLog("INFO", `已将订阅 [${sub.title}] 状态置为 ${newActive ? "重新监听中" : "暂停挂起"}`);
      // Optimistic update
      setSubscriptions(prev =>
        prev.map(s => (s.id === sub.id ? { ...s, is_active: newActive } : s)),
      );
    } catch (err) {
      console.error("Failed to toggle subscription:", err);
      setErrorMessage("更新订阅状态失败");
    }
  };

  // ---- Delete subscription ----
  const handleDelete = async (sub: SubscriptionItem) => {
    if (!confirm(`确定要取消对 [${sub.title}] 的订阅吗？`)) return;

    try {
      await subscriptionApi.delete(sub.id);
      setSubscriptions(prev => prev.filter(s => s.id !== sub.id));
      await addLog("WARN", `已注销对 [${sub.title}] 的订阅。`);
    } catch (err) {
      console.error("Failed to delete subscription:", err);
      setErrorMessage("删除订阅失败");
    }
  };

  return (
    <div id="subscription-tab-container" className="space-y-6">

      {/* Error banner */}
      {errorMessage && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-50 border border-red-200 rounded-2xl px-5 py-3 flex items-center gap-2.5"
        >
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <span className="text-xs font-bold text-red-700">{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="ml-auto text-red-400 hover:text-red-600 text-xs font-bold"
          >
            关闭
          </button>
        </motion.div>
      )}

      {/* Subscription Banner Title */}
      <div className="bg-gradient-to-br from-purple-500/10 via-brand-primary/5 to-white/30 backdrop-blur-md rounded-3xl p-6 border border-white/60 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-txt-dark tracking-tight flex items-center gap-2.5">
            <Rss className="w-6.5 h-6.5 text-purple-500" />
            <span>影视订阅管理</span>
          </h2>
          <p className="text-xs text-gray-500 mt-1 max-w-xl leading-relaxed">
            添加 TMDB/Douban 影视订阅，系统将在后台定期扫描新资源。支持按季、按集粒度跟踪，发现新资源后自动转存到 115 网盘。
          </p>
        </div>

        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-brand-primary text-white px-4 py-2.5 rounded-2xl text-xs font-black tracking-wider flex items-center gap-1.5 shrink-0 transition-all active:scale-95 shadow-md shadow-brand-primary/10 self-start sm:self-auto"
        >
          <Plus className="w-4.5 h-4.5" />
          <span>新增订阅</span>
        </button>
      </div>

      {/* Add Subscription Form Drawer */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <form onSubmit={handleAddSubscription} className="bg-white/70 backdrop-blur-md rounded-3xl border border-white/60 p-5 space-y-4 shadow-sm hover:bg-white/80 transition-all">
              <h3 className="text-sm font-black text-txt-dark flex items-center gap-2">
                <Workflow className="w-4 h-4 text-brand-primary" />
                <span>创建新订阅</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Title (required) */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400">影视名称 *</label>
                  <input
                    type="text"
                    required
                    placeholder="如：鬼灭之刃 无限城篇"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-white/50 border border-slate-150 focus:border-brand-primary rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all"
                  />
                </div>

                {/* Media type */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400">媒体类型 *</label>
                  <select
                    value={mediaType}
                    onChange={(e) => setMediaType(e.target.value)}
                    className="w-full bg-white/50 border border-slate-150 focus:border-brand-primary rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all text-slate-600"
                  >
                    <option value="tv">电视剧 (TV)</option>
                    <option value="movie">电影 (Movie)</option>
                    <option value="collection">合集 (Collection)</option>
                  </select>
                </div>

                {/* TMDB ID */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400">TMDB ID (可选)</label>
                  <input
                    type="number"
                    placeholder="如：1399"
                    value={tmdbId ?? ""}
                    onChange={(e) => setTmdbId(e.target.value ? Number(e.target.value) : undefined)}
                    className="w-full bg-white/50 border border-slate-150 focus:border-brand-primary rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all"
                  />
                </div>

                {/* Douban ID */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400">豆瓣 ID (可选)</label>
                  <input
                    type="text"
                    placeholder="如：35649888"
                    value={doubanId}
                    onChange={(e) => setDoubanId(e.target.value)}
                    className="w-full bg-white/50 border border-slate-150 focus:border-brand-primary rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all"
                  />
                </div>
              </div>

              {/* TV-specific fields (only when mediaType is tv) */}
              {mediaType === "tv" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
                  {/* TV Scope */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400">跟踪范围</label>
                    <select
                      value={tvScope}
                      onChange={(e) => setTvScope(e.target.value)}
                      className="w-full bg-white/50 border border-slate-150 focus:border-brand-primary rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all text-slate-600"
                    >
                      <option value="all">全季</option>
                      <option value="season">指定季</option>
                      <option value="episode_range">指定集范围</option>
                    </select>
                  </div>

                  {/* Season number */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400">季号</label>
                    <input
                      type="number"
                      placeholder="1"
                      value={tvSeasonNumber ?? ""}
                      onChange={(e) => setTvSeasonNumber(e.target.value ? Number(e.target.value) : undefined)}
                      className="w-full bg-white/50 border border-slate-150 focus:border-brand-primary rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all"
                    />
                  </div>

                  {/* Follow mode */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400">跟踪模式</label>
                    <select
                      value={tvFollowMode}
                      onChange={(e) => setTvFollowMode(e.target.value)}
                      className="w-full bg-white/50 border border-slate-150 focus:border-brand-primary rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all text-slate-600"
                    >
                      <option value="missing">仅缺失</option>
                      <option value="new">新集提醒</option>
                    </select>
                  </div>

                  {/* Episode range — only when scope is episode_range */}
                  {tvScope === "episode_range" && (
                    <>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-400">起始集</label>
                        <input
                          type="number"
                          placeholder="1"
                          value={tvEpisodeStart ?? ""}
                          onChange={(e) => setTvEpisodeStart(e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full bg-white/50 border border-slate-150 focus:border-brand-primary rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-400">结束集</label>
                        <input
                          type="number"
                          placeholder="12"
                          value={tvEpisodeEnd ?? ""}
                          onChange={(e) => setTvEpisodeEnd(e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full bg-white/50 border border-slate-150 focus:border-brand-primary rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all"
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Checkbox: auto download */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="autoDownload"
                  checked={autoDownload}
                  onChange={(e) => setAutoDownload(e.target.checked)}
                  className="w-4 h-4 rounded text-brand-primary focus:ring-brand-primary border-slate-200"
                />
                <label htmlFor="autoDownload" className="text-xs font-bold text-slate-500 select-none cursor-pointer">
                  启用自动下载：发现新资源后自动转存至 115 网盘。（推荐开启）
                </label>
              </div>

              {/* Note: per-subscription "target directory" is not a backend field.
                   All transfer destinations are controlled via archive config (/api/archive/config). */}

              {/* Buttons */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-xl text-xs font-black transition-all"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-brand-primary text-white px-5 py-2 hover:bg-brand-primary-light rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-sm"
                >
                  {isSubmitting ? "正在创建..." : "创建订阅"}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Subscription List */}
      <div className="space-y-4">
        <h3 className="text-sm font-black text-txt-dark flex items-center gap-2">
          <Workflow className="w-4 h-4 text-purple-500" />
          <span>订阅列表</span>
          <span className="text-xs font-semibold text-gray-400">({subscriptions.length} 项)</span>
        </h3>

        {isLoading ? (
          <div className="bg-white/70 backdrop-blur-md rounded-3xl p-12 text-center border border-white/60 shadow-sm">
            <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-400 font-bold mt-3">正在加载订阅列表...</p>
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="bg-white/70 backdrop-blur-md rounded-3xl p-12 text-center border border-white/60 shadow-sm">
            <AlertCircle className="w-10 h-10 text-slate-200 mx-auto mb-2" />
            <p className="text-sm text-slate-400 font-bold">暂无订阅项目</p>
            <p className="text-xs text-slate-400 font-semibold mt-1">点击右上角"新增订阅"开始追更吧！</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {subscriptions.map(sub => {
              const status = deriveStatus(sub);
              const categoryLabel = deriveCategoryLabel(sub.media_type);
              const progress = deriveProgress(sub);
              const rssSource = deriveRssSource(sub);
              const lastUpdated = (sub.updated_at || sub.created_at || "").toString().replace("T", " ").substring(0, 19);

              return (
                <div
                  key={sub.id}
                  className="bg-white/70 backdrop-blur-md rounded-2xl border border-white/60 p-4 flex gap-4 hover:shadow-xs hover:bg-white/85 transition-all relative overflow-hidden"
                >
                  {/* Poster */}
                  <div className="w-14 h-20 rounded-xl overflow-hidden bg-slate-50 shrink-0 border border-slate-100 relative">
                    <img
                      src={posterUrl(sub)}
                      alt={sub.title}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                      loading="lazy"
                    />
                    <span className="absolute bottom-1 right-1 bg-black/60 text-white text-[8px] font-black px-1 rounded uppercase">
                      {categoryLabel}
                    </span>
                  </div>

                  {/* Content details */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="font-headline font-bold text-xs text-txt-dark truncate leading-tight">
                          {sub.title}
                        </h4>
                        <span className={`shrink-0 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                          status === "subscribing"
                            ? "bg-purple-100 text-purple-700 animate-pulse"
                            : "bg-amber-100 text-amber-700"
                        }`}>
                          {status === "subscribing" ? "监听中" : "已暂停"}
                        </span>
                      </div>

                      {/* Progress: derived from tv_scope / season / episode range */}
                      <p className="text-[10px] text-slate-400 font-bold mt-1">
                        范围: <span className="text-brand-primary">{progress}</span>
                        {sub.auto_download !== undefined && (
                          <span className="ml-2 text-green-600">{sub.auto_download ? "自动下载" : "手动下载"}</span>
                        )}
                      </p>

                      {/* Source summary */}
                      <div className="flex items-center gap-1.5 text-[9px] text-slate-400 font-semibold mt-2.5 truncate">
                        <Rss className="w-3.5 h-3.5 text-slate-400" />
                        <span className="truncate">{rssSource}</span>
                      </div>
                    </div>

                    {/* Action buttons footer */}
                    <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-slate-200/40">
                      <span className="text-[9px] text-slate-300 font-bold">
                        {lastUpdated ? `更新于 ${lastUpdated.substring(11, 16)}` : ""}
                      </span>

                      <div className="flex items-center gap-1.5">
                        {/* Play/Pause toggle */}
                        <button
                          onClick={() => handleToggleStatus(sub)}
                          className={`p-1.5 rounded-lg border transition-all ${
                            status === "subscribing"
                              ? "bg-amber-50 text-amber-600 border-amber-200/50 hover:bg-amber-100"
                              : "bg-purple-50 text-purple-600 border-purple-200/50 hover:bg-purple-100"
                          }`}
                          title={status === "subscribing" ? "暂停订阅" : "继续监听"}
                        >
                          {status === "subscribing" ? (
                            <Pause className="w-3.5 h-3.5" />
                          ) : (
                            <Play className="w-3.5 h-3.5" />
                          )}
                        </button>

                        {/* Delete */}
                        <button
                          onClick={() => handleDelete(sub)}
                          className="p-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200/50 hover:bg-red-100 transition-all"
                          title="删除订阅"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
