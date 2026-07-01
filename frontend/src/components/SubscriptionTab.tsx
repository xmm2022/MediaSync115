import React, { useState, useEffect } from "react";
import type { SubscriptionItem, SubscriptionSource, DownloadRecord, MoviePilotCompletionPreview, MoviePilotSubscriptionCreatePayload } from "../api/types";
import { moviepilotApi, subscriptionApi } from "../api";
import { getApiErrorMessage } from "../api/errors";
import { Workflow, Plus, Trash2, Play, Pause, Rss, AlertCircle, ChevronDown, Link2, RefreshCw, Database, ClipboardList, CheckCircle2, XCircle, Activity, Search, SlidersHorizontal, HardDrive, Cloud, Download } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import EmptyState from "./ui/EmptyState";
import SubscriptionSourceFileSelector from "./SubscriptionSourceFileSelector";
import type { SyncDirectory } from "../types";

// directories prop: provided by App, built from archive API (folders+config+tasks).
// Currently unused in this component — subscription targets are controlled via archive config.
// Interface imported from types.ts for consistency across tabs.

interface SubscriptionTabProps {
  directories: SyncDirectory[];
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => Promise<void>;
  onNavigateToMissing?: () => void;
}

type SubscriptionFilter = "all" | "missing" | "active" | "paused";
type SubscriptionChannelTab = "overview" | "pan115" | "quark" | "pt";
type ExecutionChannel = "pan115" | "quark" | "pt" | "anime" | "unknown";
type SubscriptionDetailTab = "follow" | "missing";

const SUBSCRIPTION_FILTERS: { key: SubscriptionFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "missing", label: "待处理" },
  { key: "active", label: "监听中" },
  { key: "paused", label: "已暂停" },
];

const SUBSCRIPTION_CHANNEL_TABS: { key: SubscriptionChannelTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "overview", label: "总览", icon: Workflow },
  { key: "pan115", label: "115 转存", icon: HardDrive },
  { key: "quark", label: "夸克转存", icon: Cloud },
  { key: "pt", label: "PT 下载", icon: Download },
];

const MISSING_UNRESOLVED_STATUSES = new Set([
  "no_tmdb",
  "invalid_tmdb",
  "emby_error",
  "tmdb_error",
  "cache_unavailable",
  "unknown",
]);

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

function getExecutionChannel(sub: SubscriptionItem): ExecutionChannel {
  const provider = String(sub.provider || "").toLowerCase();
  const externalSystem = String(sub.external_system || "").toLowerCase();
  const sourceTypes = (sub.sources || []).map((source) => String(source.source_type || "").toLowerCase());
  if (provider === "anirss" || externalSystem === "anirss") return "anime";
  if (provider === "moviepilot" || externalSystem === "moviepilot") return "pt";
  if (provider === "quark" || externalSystem === "quark" || sourceTypes.some((item) => item.includes("quark"))) return "quark";
  if (!provider || provider === "mediasync115" || sourceTypes.some((item) => item.includes("pan115"))) return "pan115";
  return "unknown";
}

function isMoviePilotSubscription(sub: SubscriptionItem): boolean {
  return getExecutionChannel(sub) === "pt";
}

function getExecutionLabel(sub: SubscriptionItem): string {
  switch (getExecutionChannel(sub)) {
    case "pan115": return "115 转存";
    case "quark": return "夸克转存";
    case "pt": return "PT 下载";
    case "anime": return "动漫追番";
    default: return "未知渠道";
  }
}

function getSourceModeLabel(sub: SubscriptionItem): string {
  const channel = getExecutionChannel(sub);
  if (channel === "pt") return "MoviePilot";
  if (channel === "anime") return "ANI-RSS";
  const sourceTypes = (sub.sources || []).map((source) => String(source.source_type || "").toLowerCase());
  if (channel === "pan115") {
    if (sub.media_type === "tv") {
      return sub.tv_follow_mode === "new" ? "只追新" : "补缺订阅";
    }
    return sourceTypes.some((item) => item.includes("manual_pan115_share"))
      ? "已配补缺源"
      : "自动搜索";
  }
  if (channel === "quark") {
    return sourceTypes.some((item) => item.includes("manual_quark_share"))
      ? "固定夸克来源"
      : "夸克资源";
  }
  return "未分类";
}

function matchesChannelTab(sub: SubscriptionItem, tab: SubscriptionChannelTab): boolean {
  if (tab === "overview") return getExecutionChannel(sub) !== "anime";
  if (tab === "pan115") return getExecutionChannel(sub) === "pan115";
  if (tab === "quark") return getExecutionChannel(sub) === "quark";
  return getExecutionChannel(sub) === "pt";
}

function supportsPan115Missing(sub: SubscriptionItem): boolean {
  return getExecutionChannel(sub) === "pan115";
}

function supportsTvMissingStatus(sub: SubscriptionItem): boolean {
  const channel = getExecutionChannel(sub);
  return channel === "pan115" || channel === "pt";
}

function formatDownloadResourceType(value?: string): string {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "pan115" || normalized === "115") return "115";
  if (normalized === "moviepilot" || normalized === "pt") return "PT";
  if (normalized === "quark") return "夸克";
  if (normalized === "magnet") return "磁力";
  if (normalized === "ed2k") return "ED2K";
  return value || "记录";
}

/** Derive a human-readable supplemental missing-source summary from the sources array. */
function deriveSourceSummary(sub: SubscriptionItem): string {
  const srcs = sub.sources;
  const channel = getExecutionChannel(sub);
  if (channel === "pt") return "MoviePilot 外部订阅";
  if (channel === "anime") return "ANI-RSS 追番";
  if (channel === "pan115") {
    const count = srcs?.length ?? 0;
    return count > 0 ? `补缺源 ${count} 个` : "未配置补缺源";
  }
  if (!srcs || srcs.length === 0) {
    return "无补缺源";
  }
  const first = srcs[0];
  return first.display_name || first.source_type || "补缺源";
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

export default function SubscriptionTab({ directories, addLog, onNavigateToMissing }: SubscriptionTabProps) {
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [showOperations, setShowOperations] = useState(false);
  const [subscriptionFilter, setSubscriptionFilter] = useState<SubscriptionFilter>("all");
  const [activeChannelTab, setActiveChannelTab] = useState<SubscriptionChannelTab>("overview");
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
  const [subscriptionProvider, setSubscriptionProvider] = useState<"mediasync115" | "moviepilot">("mediasync115");
  const [moviepilotQuality, setMoviepilotQuality] = useState("");
  const [moviepilotResolution, setMoviepilotResolution] = useState("");
  const [moviepilotInclude, setMoviepilotInclude] = useState("");
  const [moviepilotExclude, setMoviepilotExclude] = useState("");
  const [moviepilotSavePath, setMoviepilotSavePath] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMoviepilotSyncing, setIsMoviepilotSyncing] = useState(false);
  const [moviepilotSearchingId, setMoviepilotSearchingId] = useState<string | null>(null);
  const [runningChannel, setRunningChannel] = useState<string | null>(null);

  // ---- 缺集总览 (GET /subscriptions/missing-status/tv) ----
  type MissingOverviewItem = {
    subscription_id: number;
    tmdb_id: number | null;
    title: string;
    status: string;
    message?: string;
    aired_count: number;
    existing_count: number;
    missing_count: number;
    missing_by_season: Record<string, unknown>;
  };
  const [missingOverview, setMissingOverview] = useState<MissingOverviewItem[] | null>(null);
  const [missingOverviewLoading, setMissingOverviewLoading] = useState(false);

  // ---- 展开详情（缺集明细 / 来源 / 下载） ----
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailPanelTab, setDetailPanelTab] = useState<SubscriptionDetailTab>("follow");
  const [detailMissing, setDetailMissing] = useState<Record<string, unknown> | null>(null);
  const [detailSources, setDetailSources] = useState<SubscriptionSource[]>([]);
  const [detailDownloads, setDetailDownloads] = useState<DownloadRecord[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [moviepilotCompletionPreview, setMoviepilotCompletionPreview] = useState<MoviePilotCompletionPreview | null>(null);
  const [moviepilotCompletionBusyId, setMoviepilotCompletionBusyId] = useState<string | null>(null);
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [newSourceCode, setNewSourceCode] = useState("");
  const [addingSource, setAddingSource] = useState(false);

  // 执行日志（步骤日志流）
  interface StepLogItem {
    id: number;
    run_id: string;
    subscription_id: number;
    subscription_title: string;
    channel: string;
    step: string;
    status: string;
    message: string;
    payload: unknown;
    created_at: string;
  }
  const [detailStepLogs, setDetailStepLogs] = useState<StepLogItem[]>([]);
  const [detailStepLogsLoading, setDetailStepLogsLoading] = useState(false);
  const stepLabelMap: Record<string, string> = {
    run_start: "任务启动", run_finish: "任务完成",
    subscription_start: "开始处理", subscription_done: "处理完成", subscription_failed: "处理失败",
    fetch_resources: "资源抓取", fetch_skip: "跳过抓取",
    fetch_hdhive_tmdb_start: "HDHive抓取", fetch_hdhive_tmdb_done: "HDHive完成", fetch_hdhive_tmdb_failed: "HDHive失败",
    fetch_hdhive_keyword_start: "HDHive关键词", fetch_hdhive_keyword_done: "HDHive关键词完成",
    fetch_tg_keyword_start: "TG抓取", fetch_tg_keyword_done: "TG完成",
    fetch_pansou_tmdb_start: "Pansou抓取", fetch_pansou_tmdb_done: "Pansou完成", fetch_pansou_tmdb_empty: "Pansou无结果",
    fetch_pansou_keyword_start: "Pansou关键词", fetch_pansou_keyword_done: "Pansou关键词完成",
    store_new_resources: "资源入库",
    auto_transfer_skip: "跳过转存", auto_transfer_new_start: "新资源转存", auto_transfer_new_done: "转存完成",
    auto_transfer_retry_start: "重试开始", auto_transfer_retry_done: "重试完成",
    auto_transfer_item_start: "转存项目开始", auto_transfer_item_done: "转存成功", auto_transfer_item_failed: "转存失败",
    auto_transfer_summary: "转存汇总",
    tv_missing_fetch_start: "缺集查询", tv_missing_fetch_done: "缺集完成", tv_missing_fetch_failed: "缺集失败",
    tv_record_files_parsed: "文件解析", tv_record_unparsed_fallback: "未解析保守转存",
    tv_record_skip_no_missing: "无缺集跳过", tv_transfer_selected_done: "精准转存完成",
  };

  // 缺集总览加载
  const loadMissingOverview = async () => {
    setMissingOverviewLoading(true);
    try {
      const resp = await subscriptionApi.getTvMissingStatus({ only_missing: false, limit: 200 });
      const data = (resp as { data?: { items?: MissingOverviewItem[] } }).data;
      setMissingOverview(data?.items ?? []);
    } catch (err) {
      // 未配置 Emby/TMDB 或无 TV 订阅时静默：列表可能为空属正常
      console.warn("missing overview failed", err);
      setMissingOverview([]);
    } finally {
      setMissingOverviewLoading(false);
    }
  };

  // 展开某订阅详情
  const loadDetail = async (sub: SubscriptionItem) => {
    setDetailLoading(true);
    setDetailMissing(null);
    setDetailSources([]);
    setDetailDownloads([]);
    setMoviepilotCompletionPreview(null);
    try {
      const tasks: Promise<unknown>[] = [];
      if (sub.media_type === "tv" && supportsTvMissingStatus(sub)) {
        tasks.push(
          subscriptionApi.getSubscriptionTvMissingStatus(sub.id).then((r) => setDetailMissing((r as { data?: Record<string, unknown> }).data ?? null)).catch(() => setDetailMissing(null)),
        );
      }
      if (getExecutionChannel(sub) === "pan115") {
        tasks.push(
          subscriptionApi.listSources(sub.id).then((r) => setDetailSources((r as { data?: SubscriptionSource[] }).data ?? [])).catch(() => setDetailSources([])),
        );
      }
      tasks.push(
        subscriptionApi.getDownloads(sub.id).then((r) => setDetailDownloads((r as { data?: DownloadRecord[] }).data ?? [])).catch(() => setDetailDownloads([])),
      );
      await Promise.all(tasks);
    } finally {
      setDetailLoading(false);
    }
  };

  // 加载订阅执行日志（步骤日志流）
  const loadStepLogs = async (sub: SubscriptionItem) => {
    setDetailStepLogsLoading(true);
    setDetailStepLogs([]);
    try {
      const [stepResp, logResp] = await Promise.all([
        subscriptionApi.listStepLogs({ subscription_id: Number(sub.id), limit: 200 }),
        subscriptionApi.listLogs({ limit: 10 }).catch(() => ({ data: [] })),
      ]);
      const stepData = (stepResp as { data?: StepLogItem[] }).data;
      setDetailStepLogs(Array.isArray(stepData) ? stepData : []);
      // listLogs loaded for reference; displayed in the same panel
      const logData = logResp.data;
      if (Array.isArray(logData)) setDetailRunLogs(logData as Record<string, unknown>[]);
    } catch (err) {
      console.warn("step logs failed", err);
      setDetailStepLogs([]);
    } finally {
      setDetailStepLogsLoading(false);
    }
  };

  const [detailRunLogs, setDetailRunLogs] = useState<Record<string, unknown>[]>([]);

  const refreshSourceDerivedState = async (sub: SubscriptionItem) => {
    await Promise.all([
      loadDetail(sub),
      loadSubscriptions(),
      loadMissingOverview(),
    ]);
  };

  const expandSubscription = (sub: SubscriptionItem, initialTab: SubscriptionDetailTab = "follow") => {
    setExpandedId(sub.id);
    setDetailPanelTab(initialTab);
    void loadDetail(sub);
    void loadStepLogs(sub);
  };

  const toggleExpand = (sub: SubscriptionItem) => {
    if (expandedId === sub.id) {
      setExpandedId(null);
    } else {
      expandSubscription(sub, "follow");
    }
  };

  const focusSubscriptionFromMissing = (subscriptionId: number) => {
    const sub = subscriptions.find((item) => Number(item.id) === Number(subscriptionId));
    if (!sub) return;
    setActiveChannelTab("pan115");
    setSubscriptionFilter("missing");
    expandSubscription(sub, "missing");
    window.setTimeout(() => {
      document.getElementById(`subscription-item-${sub.id}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 50);
  };

  const handleRunChannelCheck = async (channel: "hdhive" | "pansou" | "tg" | "all") => {
    setRunningChannel(channel);
    try {
      if (channel === "all") {
        await subscriptionApi.runAllChannelsCheckBackground(true);
        await addLog("INFO", "已触发全频道后台扫描");
      } else {
        await subscriptionApi.runChannelCheckBackground(channel);
        await addLog("INFO", `已触发 ${channel} 频道后台扫描`);
      }
    } catch (err: unknown) {
      await addLog("ERROR", `${channel === "all" ? "全频道" : channel} 扫描失败: ${getApiErrorMessage(err)}`);
    } finally {
      setRunningChannel(null);
    }
  };

  // 来源增删启停扫描
  const handleAddSource = async (sub: SubscriptionItem) => {
    if (!newSourceUrl.trim()) return;
    setAddingSource(true);
    setDetailPanelTab("missing");
    try {
      await subscriptionApi.createSource(sub.id, {
        share_url: newSourceUrl.trim(),
        receive_code: newSourceCode.trim() || undefined,
      });
      setNewSourceUrl("");
      setNewSourceCode("");
      await refreshSourceDerivedState(sub);
      await addLog("SUCCESS", `订阅 [${sub.title}] 新增 115 分享补缺源`);
    } catch (err) {
      console.error("add source failed", err);
      setErrorMessage("新增来源失败");
    } finally {
      setAddingSource(false);
    }
  };

  const handleToggleSource = async (sub: SubscriptionItem, src: SubscriptionSource) => {
    try {
      await subscriptionApi.updateSource(sub.id, String(src.id), { enabled: !src.enabled });
      setDetailSources(prev => prev.map(s => s.id === src.id ? { ...s, enabled: !src.enabled } : s));
      await refreshSourceDerivedState(sub);
    } catch (err) {
      console.error("toggle source failed", err);
    }
  };

  const handleDeleteSource = async (sub: SubscriptionItem, src: SubscriptionSource) => {
    if (!confirm(`删除来源 [${src.display_name || src.source_type}]？`)) return;
    try {
      await subscriptionApi.deleteSource(sub.id, String(src.id));
      setDetailSources(prev => prev.filter(s => s.id !== src.id));
      await refreshSourceDerivedState(sub);
    } catch (err) {
      console.error("delete source failed", err);
    }
  };

  const handleScanSource = async (sub: SubscriptionItem, src: SubscriptionSource) => {
    setDetailPanelTab("missing");
    try {
      await subscriptionApi.scanSource(sub.id, String(src.id));
      await addLog("INFO", `已触发 115 分享补缺源 [${src.display_name || src.source_type}] 扫描`);
      await refreshSourceDerivedState(sub);
    } catch (err) {
      console.error("scan source failed", err);
      setErrorMessage("补缺源扫描失败（超时或后端错误）");
    }
  };

  const handleSourceUpdated = (updatedSource: SubscriptionSource) => {
    setDetailSources(prev => prev.map(src => src.id === updatedSource.id ? updatedSource : src));
  };

  const handleDeleteDownload = async (sub: SubscriptionItem, dl: DownloadRecord) => {
    try {
      await subscriptionApi.deleteDownload(sub.id, String(dl.id));
      setDetailDownloads(prev => prev.filter(d => d.id !== dl.id));
    } catch (err) {
      console.error("delete download failed", err);
    }
  };

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
    loadMissingOverview();
  }, []);

  // ---- Create subscription ----
  const handleAddSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    const payload: Parameters<typeof subscriptionApi.create>[0] | MoviePilotSubscriptionCreatePayload = {
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
      if (subscriptionProvider === "moviepilot") {
        const moviepilotPayload: MoviePilotSubscriptionCreatePayload = {
          ...payload,
          moviepilot_quality: moviepilotQuality.trim() || undefined,
          moviepilot_resolution: moviepilotResolution.trim() || undefined,
          moviepilot_include: moviepilotInclude.trim() || undefined,
          moviepilot_exclude: moviepilotExclude.trim() || undefined,
          moviepilot_save_path: moviepilotSavePath.trim() || undefined,
        };
        await moviepilotApi.createSubscription(moviepilotPayload);
        await addLog("SUCCESS", `成功创建 MoviePilot PT 订阅 [${title.trim()}]`);
      } else {
        await subscriptionApi.create(payload);
        await addLog("SUCCESS", `成功创建 115 转存订阅 [${title.trim()}]`);
      }
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
      setMoviepilotQuality("");
      setMoviepilotResolution("");
      setMoviepilotInclude("");
      setMoviepilotExclude("");
      setMoviepilotSavePath("");
      setShowAddForm(false);
      // Reload list
      await loadSubscriptions();
    } catch (err) {
      console.error("Failed to create subscription:", err);
      setErrorMessage(`创建订阅失败: ${getApiErrorMessage(err)}`);
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
    const moviepilotMirror = isMoviePilotSubscription(sub);
    const prompt = moviepilotMirror
      ? `确定只删除 [${sub.title}] 的 MoviePilot 本地镜像吗？外部 PT 订阅仍需在 MoviePilot 中管理。`
      : `确定要取消对 [${sub.title}] 的订阅吗？`;
    if (!confirm(prompt)) return;

    try {
      await subscriptionApi.delete(sub.id);
      setSubscriptions(prev => prev.filter(s => s.id !== sub.id));
      await addLog(
        "WARN",
        moviepilotMirror
          ? `已删除 [${sub.title}] 的 MoviePilot 本地镜像；外部 PT 订阅未在 MediaSync115 中取消。`
          : `已注销对 [${sub.title}] 的订阅。`,
      );
    } catch (err) {
      console.error("Failed to delete subscription:", err);
      setErrorMessage(moviepilotMirror ? "删除 MoviePilot 本地镜像失败" : "删除订阅失败");
    }
  };

  const handleMoviePilotSync = async () => {
    setIsMoviepilotSyncing(true);
    setErrorMessage(null);
    try {
      const response = await moviepilotApi.syncSubscriptions();
      const data = response.data;
      await addLog(
        "SUCCESS",
        `MoviePilot 状态同步完成：订阅更新 ${data.updated_count ?? 0}，下载新增 ${data.download_created_count ?? 0}，下载更新 ${data.download_updated_count ?? 0}，转移新增 ${data.transfer_created_count ?? 0}，转移更新 ${data.transfer_updated_count ?? 0}`,
      );
      await loadSubscriptions();
    } catch (err) {
      console.error("MoviePilot sync failed", err);
      setErrorMessage(`MoviePilot 状态同步失败: ${getApiErrorMessage(err)}`);
    } finally {
      setIsMoviepilotSyncing(false);
    }
  };

  const handleMoviePilotSearch = async (sub: SubscriptionItem) => {
    if (!sub.external_subscription_id) return;
    setMoviepilotSearchingId(sub.id);
    setErrorMessage(null);
    try {
      const response = await moviepilotApi.searchSubscription(sub.external_subscription_id);
      const resultText = JSON.stringify(response.data.result ?? response.data).slice(0, 180);
      await addLog("INFO", `MoviePilot 已触发 [${sub.title}] 手动搜索: ${resultText}`);
    } catch (err) {
      console.error("MoviePilot manual search failed", err);
      setErrorMessage(`MoviePilot 手动搜索失败: ${getApiErrorMessage(err)}`);
    } finally {
      setMoviepilotSearchingId(null);
    }
  };

  const handleMoviePilotCompletionPreview = async (sub: SubscriptionItem) => {
    setMoviepilotCompletionBusyId(sub.id);
    setErrorMessage(null);
    try {
      const response = await moviepilotApi.previewMissingCompletion(sub.id);
      setMoviepilotCompletionPreview(response.data);
      const counts = response.data.counts || {};
      await addLog("INFO", `MoviePilot 补缺预览完成 [${sub.title}]：可推送 ${counts.auto_push ?? 0}，需确认 ${counts.ambiguous ?? 0}，无匹配 ${counts.no_match ?? 0}`);
    } catch (err) {
      console.error("MoviePilot completion preview failed", err);
      setErrorMessage(`MoviePilot 补缺预览失败: ${getApiErrorMessage(err)}`);
    } finally {
      setMoviepilotCompletionBusyId(null);
    }
  };

  const handleMoviePilotCompletionRun = async (sub: SubscriptionItem) => {
    setMoviepilotCompletionBusyId(sub.id);
    setErrorMessage(null);
    try {
      const response = await moviepilotApi.runMissingCompletion(sub.id, { dry_run: false });
      const completionData = response.data;
      await addLog("SUCCESS", `MoviePilot 补缺完成 [${sub.title}]：已推送 ${response.data.pushed_count ?? 0}，失败 ${response.data.failed_count ?? 0}`);
      await loadDetail(sub);
      setMoviepilotCompletionPreview(completionData);
    } catch (err) {
      console.error("MoviePilot completion run failed", err);
      setErrorMessage(`MoviePilot 补缺失败: ${getApiErrorMessage(err)}`);
    } finally {
      setMoviepilotCompletionBusyId(null);
    }
  };

  const missingById = new Map(
    (missingOverview || []).map((item) => [Number(item.subscription_id), item]),
  );
  const mediaSubscriptions = subscriptions.filter((sub) => getExecutionChannel(sub) !== "anime");
  const channelScopedSubscriptions = mediaSubscriptions.filter((sub) => matchesChannelTab(sub, activeChannelTab));
  const activeCount = mediaSubscriptions.filter((sub) => sub.is_active).length;
  const pausedCount = mediaSubscriptions.length - activeCount;
  const pan115Count = mediaSubscriptions.filter((sub) => getExecutionChannel(sub) === "pan115").length;
  const quarkCount = mediaSubscriptions.filter((sub) => getExecutionChannel(sub) === "quark").length;
  const ptCount = mediaSubscriptions.filter((sub) => getExecutionChannel(sub) === "pt").length;
  const missingCount = missingOverview?.filter((item) => Number(item.missing_count || 0) > 0).length ?? 0;
  const unresolvedMissingCount = missingOverview?.filter((item) => MISSING_UNRESOLVED_STATUSES.has(String(item.status || ""))).length ?? 0;
  const missingAttentionRows = (missingOverview || []).filter((item) => {
    const sub = mediaSubscriptions.find((row) => Number(row.id) === Number(item.subscription_id));
    if (!sub || !supportsPan115Missing(sub)) return false;
    if (activeChannelTab !== "overview" && activeChannelTab !== "pan115") return false;
    return Number(item.missing_count || 0) > 0 || MISSING_UNRESOLVED_STATUSES.has(String(item.status || ""));
  });
  const channelCounts = {
    overview: mediaSubscriptions.length,
    pan115: pan115Count,
    quark: quarkCount,
    pt: ptCount,
  };
  const channelLabel = SUBSCRIPTION_CHANNEL_TABS.find((item) => item.key === activeChannelTab)?.label || "总览";
  const currentTabSupportsMissing = activeChannelTab === "overview" || activeChannelTab === "pan115";
  const lastUpdatedAt = mediaSubscriptions
    .map((sub) => String(sub.updated_at || sub.created_at || ""))
    .filter(Boolean)
    .sort()
    .at(-1);
  const lastUpdatedLabel = lastUpdatedAt ? lastUpdatedAt.replace("T", " ").substring(0, 16) : "暂无";
  const filteredSubscriptions = channelScopedSubscriptions.filter((sub) => {
    if (subscriptionFilter === "missing") {
      if (!supportsPan115Missing(sub)) return false;
      const missingInfo = missingById.get(Number(sub.id));
      return Number(missingInfo?.missing_count || 0) > 0 || MISSING_UNRESOLVED_STATUSES.has(String(missingInfo?.status || ""));
    }
    if (subscriptionFilter === "active") return sub.is_active;
    if (subscriptionFilter === "paused") return !sub.is_active;
    return true;
  });
  const summaryCards = [
    {
      label: "活跃订阅",
      value: activeCount,
      sub: `影视订阅 ${mediaSubscriptions.length} 项`,
      icon: <Rss className="w-4.5 h-4.5" />,
      color: "var(--brand-primary)",
    },
    {
      label: "115 缺集",
      value: missingOverviewLoading ? "..." : missingCount,
      sub: unresolvedMissingCount > 0 ? `无法判断 ${unresolvedMissingCount} 项` : "联动 TMDB + Emby",
      icon: <AlertCircle className="w-4.5 h-4.5" />,
      color: "var(--accent-warn)",
    },
    {
      label: "渠道分布",
      value: `${pan115Count}/${quarkCount}/${ptCount}`,
      sub: "115 / 夸克 / PT",
      icon: <HardDrive className="w-4.5 h-4.5" />,
      color: "var(--accent-info)",
    },
    {
      label: "最近更新",
      value: lastUpdatedLabel,
      sub: pausedCount > 0 ? `暂停 ${pausedCount} 项` : "全部在监听",
      icon: <Activity className="w-4.5 h-4.5" />,
      color: "var(--accent-info)",
    },
  ];

  return (
    <div id="subscription-tab-container" className="liquid-page space-y-6">

      {/* Error banner */}
      {errorMessage && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-heavy glass-iridescent rounded-2xl px-5 py-3 flex items-center gap-2.5"
          style={{ border: "1px solid rgba(239,68,68,0.3)", color: "var(--accent-danger)" } as React.CSSProperties}
        >
          <AlertCircle className="w-4 h-4 shrink-0" style={{ color: "var(--accent-danger)" } as React.CSSProperties} />
          <span className="text-xs font-bold" style={{ color: "var(--accent-danger)" } as React.CSSProperties}>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="ml-auto text-xs font-bold hover:opacity-80"
            style={{ color: "var(--accent-danger)" } as React.CSSProperties}
          >
            关闭
          </button>
        </motion.div>
      )}

      {/* Subscription Banner Title */}
      <div className="liquid-hero glass-heavy glass-iridescent glass-spotlight rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight flex items-center gap-2.5" style={{ color: "var(--txt)" } as React.CSSProperties}>
            <Rss className="w-6.5 h-6.5" style={{ color: "var(--brand-primary)" } as React.CSSProperties} />
            <span>订阅中心</span>
          </h2>
          <p className="text-xs mt-1 max-w-xl leading-relaxed" style={{ color: "var(--txt-secondary)" } as React.CSSProperties}>
            管理普通影视追更任务；115 转存、夸克转存和 PT 下载在订阅中心内分渠道处理，动漫追番继续由 Bangumi + ANI-RSS 独立负责。
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowOperations((prev) => !prev)}
            className="glass-hover px-4 py-2.5 rounded-2xl text-xs font-black tracking-wider flex items-center gap-1.5 shrink-0 transition-all active:scale-95 self-start sm:self-auto cursor-pointer"
            style={{ background: "var(--surface-subtle)", color: showOperations ? "var(--brand-primary)" : "var(--txt-secondary)", border: "1px solid var(--border)" }}
          >
            <SlidersHorizontal className="w-4.5 h-4.5" />
            <span>手动运行</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-brand-primary text-white px-4 py-2.5 rounded-2xl text-xs font-black tracking-wider flex items-center gap-1.5 shrink-0 transition-all active:scale-95 self-start sm:self-auto cursor-pointer"
          >
            <Plus className="w-4.5 h-4.5" />
            <span>高级手动新增</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {summaryCards.map((card) => (
          <div key={card.label} className="glass rounded-2xl p-4 flex items-center gap-3" style={{ border: "1px solid var(--border)" } as React.CSSProperties}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--surface-subtle)", color: card.color } as React.CSSProperties}>
              {card.icon}
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>{card.label}</div>
              <div className="text-lg font-black truncate mt-0.5" style={{ color: "var(--txt)" } as React.CSSProperties}>{card.value}</div>
              <div className="text-[10px] font-semibold truncate" style={{ color: "var(--txt-secondary)" } as React.CSSProperties}>{card.sub}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="liquid-segmented grid grid-cols-2 lg:grid-cols-4 gap-2 rounded-3xl p-2" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" } as React.CSSProperties}>
        {SUBSCRIPTION_CHANNEL_TABS.map((item) => {
          const Icon = item.icon;
          const active = activeChannelTab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setActiveChannelTab(item.key);
                if (item.key === "pt" || item.key === "quark") {
                  setSubscriptionFilter("all");
                }
              }}
              className="px-3 py-2.5 rounded-2xl text-xs font-black transition-all flex items-center justify-center gap-2 cursor-pointer"
              style={active
                ? { background: "var(--brand-primary)", color: "#fff" } as React.CSSProperties
                : { background: "var(--surface)", color: "var(--txt-secondary)", border: "1px solid var(--border)" } as React.CSSProperties}
            >
              <Icon className="w-4 h-4" />
              <span>{item.label}</span>
              <span className="text-[10px] font-black opacity-80">{channelCounts[item.key]}</span>
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {showOperations && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="liquid-panel glass rounded-3xl p-5 space-y-4" style={{ border: "1px solid var(--border)" } as React.CSSProperties}>
              <div>
                <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" } as React.CSSProperties}>
                  <SlidersHorizontal className="w-4 h-4 text-brand-primary" />
                  <span>手动运行 / 诊断</span>
                </h3>
                <p className="text-[10px] font-semibold mt-0.5" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
                  HDHive / Pansou / TG 用于 115 追新搜索；缺集补齐已拆到独立的缺集管理页面。
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {(["hdhive", "pansou", "tg"] as const).map(ch => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => void handleRunChannelCheck(ch)}
                    disabled={runningChannel !== null}
                    className="px-3 py-2 rounded-xl text-[10px] font-black glass-hover transition-all disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                    style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
                    title={`后台运行 115 ${ch} 来源扫描`}
                  >
                    {runningChannel === ch ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                    <span>{ch === "hdhive" ? "115·HDHive" : ch === "pansou" ? "115·Pansou" : "115·TG"}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void handleRunChannelCheck("all")}
                  disabled={runningChannel !== null}
                  className="px-3 py-2 rounded-xl text-[10px] font-black text-white disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                  style={{ background: "var(--brand-primary)" }}
                  title="后台运行全部 115 来源扫描"
                >
                  {runningChannel === "all" ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  <span>扫描全部 115 来源</span>
                </button>
                <button
                  type="button"
                  onClick={handleMoviePilotSync}
                  disabled={isMoviepilotSyncing}
                  className="px-3 py-2 rounded-xl text-[10px] font-black glass-hover transition-all disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                  style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
                  title="同步 MoviePilot 订阅状态"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isMoviepilotSyncing ? "animate-spin" : ""}`} />
                  <span>同步 MoviePilot</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {currentTabSupportsMissing && onNavigateToMissing && (
      <div className="liquid-panel glass rounded-3xl p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" } as React.CSSProperties}>
              <AlertCircle className="w-4 h-4 text-amber-500" />
              <span>缺集管理已独立</span>
              <span className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
                {missingOverviewLoading ? "加载中..." : `待处理 ${missingAttentionRows.length} 项`}
              </span>
            </h3>
            <p className="text-[10px] font-semibold mt-0.5" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
              这里继续管理订阅和追新规则；115 固定来源补缺与 MoviePilot/PT 精准补缺请到缺集管理统一处理。
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                void loadMissingOverview();
                void loadSubscriptions();
              }}
              disabled={missingOverviewLoading}
              className="text-[10px] font-bold text-brand-primary hover:bg-brand-primary/5 px-2 py-1 rounded-lg flex items-center gap-1 disabled:opacity-50 self-start sm:self-auto cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${missingOverviewLoading ? "animate-spin" : ""}`} />
              刷新数字
            </button>
            <button
              type="button"
              onClick={onNavigateToMissing}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-brand-primary text-white cursor-pointer"
            >
              打开缺集管理
            </button>
          </div>
        </div>
      </div>
      )}

      {/* Add Subscription Form Drawer */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <form onSubmit={handleAddSubscription} className="liquid-panel glass glass-hover rounded-3xl p-5 space-y-4 transition-all">
              <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" } as React.CSSProperties}>
                <Workflow className="w-4 h-4 text-brand-primary" />
                <span>高级手动新增订阅</span>
              </h3>
              <p className="text-[10px] font-semibold leading-relaxed" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
                常规入口建议从影视发现或资源详情加入追更；这里用于补录缺少来源映射、手工指定 TMDB/Douban ID 或创建 MoviePilot 订阅。
              </p>

              <div className="space-y-2">
                <label className="text-xs font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>执行渠道</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 rounded-2xl p-1" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" } as React.CSSProperties}>
                  <button
                    type="button"
                    onClick={() => setSubscriptionProvider("mediasync115")}
                    className="px-3 py-2 rounded-xl text-xs font-black transition-all"
                    style={subscriptionProvider === "mediasync115"
                      ? { background: "var(--brand-primary)", color: "#fff" } as React.CSSProperties
                      : { color: "var(--txt-secondary)" } as React.CSSProperties}
                  >
                    115 转存
                  </button>
                  <button
                    type="button"
                    disabled
                    className="px-3 py-2 rounded-xl text-xs font-black transition-all opacity-50 cursor-not-allowed"
                    style={{ color: "var(--txt-muted)" } as React.CSSProperties}
                    title="夸克持续订阅后端尚未接入"
                  >
                    夸克转存
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubscriptionProvider("moviepilot")}
                    className="px-3 py-2 rounded-xl text-xs font-black transition-all"
                    style={subscriptionProvider === "moviepilot"
                      ? { background: "var(--brand-primary)", color: "#fff" } as React.CSSProperties
                      : { color: "var(--txt-secondary)" } as React.CSSProperties}
                  >
                    PT 下载
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Title (required) */}
                <div className="space-y-1">
                  <label className="text-xs font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>影视名称 *</label>
                  <input
                    type="text"
                    required
                    placeholder="如：鬼灭之刃 无限城篇"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" } as React.CSSProperties}
                  />
                </div>

                {/* Media type */}
                <div className="space-y-1">
                  <label className="text-xs font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>媒体类型 *</label>
                  <select
                    value={mediaType}
                    onChange={(e) => setMediaType(e.target.value)}
                    className="w-full rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all" style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", color: "var(--txt-secondary)" } as React.CSSProperties}
                  >
                    <option value="tv">电视剧 (TV)</option>
                    <option value="movie">电影 (Movie)</option>
                    <option value="collection">合集 (Collection)</option>
                  </select>
                </div>

                {/* TMDB ID */}
                <div className="space-y-1">
                  <label className="text-xs font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>TMDB ID (可选)</label>
                  <input
                    type="number"
                    placeholder="如：1399"
                    value={tmdbId ?? ""}
                    onChange={(e) => setTmdbId(e.target.value ? Number(e.target.value) : undefined)}
                    className="w-full rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" } as React.CSSProperties}
                  />
                </div>

                {/* Douban ID */}
                <div className="space-y-1">
                  <label className="text-xs font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>豆瓣 ID (可选)</label>
                  <input
                    type="text"
                    placeholder="如：35649888"
                    value={doubanId}
                    onChange={(e) => setDoubanId(e.target.value)}
                    className="w-full rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" } as React.CSSProperties}
                  />
                </div>
              </div>

              {/* TV-specific fields (only when mediaType is tv) */}
              {mediaType === "tv" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
                  {/* TV Scope */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>跟踪范围</label>
                    <select
                      value={tvScope}
                      onChange={(e) => setTvScope(e.target.value)}
                      className="w-full rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all" style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", color: "var(--txt-secondary)" } as React.CSSProperties}
                    >
                      <option value="all">全季</option>
                      <option value="season">指定季</option>
                      <option value="episode_range">指定集范围</option>
                    </select>
                  </div>

                  {/* Season number */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>季号</label>
                    <input
                      type="number"
                      placeholder="1"
                      value={tvSeasonNumber ?? ""}
                      onChange={(e) => setTvSeasonNumber(e.target.value ? Number(e.target.value) : undefined)}
                      className="w-full rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" } as React.CSSProperties}
                    />
                  </div>

                  {/* Follow mode */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>跟踪模式</label>
                    <select
                      value={tvFollowMode}
                      onChange={(e) => setTvFollowMode(e.target.value)}
                      className="w-full rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all" style={{ background: "var(--bg-elev)", border: "1px solid var(--border)", color: "var(--txt-secondary)" } as React.CSSProperties}
                    >
                      <option value="missing">仅缺失</option>
                      <option value="new">新集提醒</option>
                    </select>
                  </div>

                  {/* Episode range — only when scope is episode_range */}
                  {tvScope === "episode_range" && (
                    <>
                      <div className="space-y-1">
                        <label className="text-xs font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>起始集</label>
                        <input
                          type="number"
                          placeholder="1"
                          value={tvEpisodeStart ?? ""}
                          onChange={(e) => setTvEpisodeStart(e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" } as React.CSSProperties}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>结束集</label>
                        <input
                          type="number"
                          placeholder="12"
                          value={tvEpisodeEnd ?? ""}
                          onChange={(e) => setTvEpisodeEnd(e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" } as React.CSSProperties}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}

              {subscriptionProvider === "moviepilot" && (
                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>质量规则</label>
                      <input
                        type="text"
                        placeholder="WEB-DL / BluRay"
                        value={moviepilotQuality}
                        onChange={(e) => setMoviepilotQuality(e.target.value)}
                        className="w-full rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all"
                        style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" } as React.CSSProperties}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>分辨率</label>
                      <input
                        type="text"
                        placeholder="1080p / 2160p"
                        value={moviepilotResolution}
                        onChange={(e) => setMoviepilotResolution(e.target.value)}
                        className="w-full rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all"
                        style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" } as React.CSSProperties}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>包含关键词</label>
                      <input
                        type="text"
                        placeholder="中字 组名"
                        value={moviepilotInclude}
                        onChange={(e) => setMoviepilotInclude(e.target.value)}
                        className="w-full rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all"
                        style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" } as React.CSSProperties}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>排除关键词</label>
                      <input
                        type="text"
                        placeholder="CAM TC"
                        value={moviepilotExclude}
                        onChange={(e) => setMoviepilotExclude(e.target.value)}
                        className="w-full rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all"
                        style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" } as React.CSSProperties}
                      />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>下载入库路径</label>
                      <input
                        type="text"
                        placeholder="留空使用系统 MoviePilot 默认路径"
                        value={moviepilotSavePath}
                        onChange={(e) => setMoviepilotSavePath(e.target.value)}
                        className="w-full rounded-xl px-4 py-2.5 text-xs font-mono font-bold outline-none transition-all"
                        style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" } as React.CSSProperties}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Checkbox: auto download */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="autoDownload"
                  checked={autoDownload}
                  onChange={(e) => setAutoDownload(e.target.checked)}
                  className="w-4 h-4 rounded text-brand-primary focus:ring-brand-primary"
                  style={{ accentColor: "var(--brand-primary)" } as React.CSSProperties}
                />
                <label htmlFor="autoDownload" className="text-xs font-bold select-none cursor-pointer" style={{ color: "var(--txt-secondary)" } as React.CSSProperties}>
                  {subscriptionProvider === "moviepilot"
                    ? "启用 PT 下载：由 MoviePilot 匹配资源后提交下载。"
                    : "启用 115 自动转存：发现新资源后自动转存至 115 网盘。（推荐开启）"}
                </label>
              </div>

              {/* Note: per-subscription "target directory" is not a backend field.
                   All transfer destinations are controlled via archive config (/api/archive/config). */}

              {/* Buttons */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="glass-hover px-4 py-2 rounded-xl text-xs font-black transition-all"
                  style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" } as React.CSSProperties}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-brand-primary text-white px-5 py-2 hover:bg-brand-primary-light rounded-xl text-xs font-black transition-all flex items-center gap-1.5"
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
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" } as React.CSSProperties}>
            <Workflow className="w-4 h-4" style={{ color: "var(--brand-primary)" } as React.CSSProperties} />
            <span>{channelLabel}</span>
            <span className="text-xs font-semibold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
              ({filteredSubscriptions.length}/{mediaSubscriptions.length} 项)
            </span>
          </h3>
          <div className="liquid-segmented flex flex-wrap gap-1">
            {SUBSCRIPTION_FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setSubscriptionFilter(item.key)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black transition-all cursor-pointer"
                style={subscriptionFilter === item.key
                  ? { background: "var(--brand-primary)", color: "#fff" } as React.CSSProperties
                  : { background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" } as React.CSSProperties}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="glass rounded-3xl p-12 text-center">
            <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs font-bold mt-3" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>正在加载订阅列表...</p>
          </div>
        ) : mediaSubscriptions.length === 0 ? (
          <div className="glass rounded-3xl p-12 text-center">
            <EmptyState
              icon={<Rss className="w-10 h-10" style={{ color: "var(--txt-muted)" } as React.CSSProperties} />}
              text="暂无订阅项目"
              subtext="创建第一个普通影视订阅；动漫追番请到 Bangumi + ANI-RSS 页面管理。"
              cta={
                <button
                  onClick={() => setShowAddForm(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-brand-primary text-white transition-all hover:opacity-90 shadow-md"
                >
                  <Plus className="w-3.5 h-3.5" />
                  高级手动新增
                </button>
              }
            />
          </div>
        ) : filteredSubscriptions.length === 0 ? (
          <div className="glass rounded-3xl p-12 text-center">
            <EmptyState
              icon={<Workflow className="w-10 h-10" style={{ color: "var(--txt-muted)" } as React.CSSProperties} />}
              text="没有符合筛选条件的订阅"
              subtext="切换筛选条件，或从资源详情页加入追更订阅。"
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredSubscriptions.map(sub => {
              const status = deriveStatus(sub);
              const categoryLabel = deriveCategoryLabel(sub.media_type);
              const progress = deriveProgress(sub);
              const sourceSummary = deriveSourceSummary(sub);
              const executionLabel = getExecutionLabel(sub);
              const sourceModeLabel = getSourceModeLabel(sub);
              const showMissingLabel = supportsPan115Missing(sub);
              const lastUpdated = (sub.updated_at || sub.created_at || "").toString().replace("T", " ").substring(0, 19);
              const isExpanded = expandedId === sub.id;
              const missingInfo = missingById.get(Number(sub.id));
              const missingUnresolved = MISSING_UNRESOLVED_STATUSES.has(String(missingInfo?.status || ""));
              const missingLabel = sub.media_type === "tv" && showMissingLabel
                ? missingOverviewLoading
                  ? "缺集计算中"
                  : !sub.tmdb_id
                    ? "缺 TMDB"
                    : missingUnresolved
                      ? "无法判断"
                    : Number(missingInfo?.missing_count || 0) > 0
                      ? `缺 ${missingInfo?.missing_count} 集`
                      : missingInfo
                        ? "无缺集"
                        : sub.is_active
                          ? "待计算"
                          : "暂停未计算"
                : null;
              const missingStyle = Number(missingInfo?.missing_count || 0) > 0
                ? { background: "rgba(245,158,11,0.16)", color: "var(--accent-warn)", border: "1px solid rgba(245,158,11,0.25)" } as React.CSSProperties
                : (!sub.tmdb_id && sub.media_type === "tv") || missingUnresolved
                  ? { background: "rgba(239,68,68,0.12)", color: "var(--accent-danger)", border: "1px solid rgba(239,68,68,0.25)" } as React.CSSProperties
                  : missingInfo
                    ? { background: "rgba(34,197,94,0.12)", color: "var(--accent-ok)", border: "1px solid rgba(34,197,94,0.25)" } as React.CSSProperties
                    : { background: "var(--surface-subtle)", color: "var(--txt-muted)", border: "1px solid var(--border)" } as React.CSSProperties;

              return (
                <div key={sub.id} id={`subscription-item-${sub.id}`} className="space-y-2 scroll-mt-28">
                <div
                  key={sub.id + "-card"}
                  className="glass glass-hover rounded-2xl p-4 flex gap-4 transition-all relative overflow-hidden"
                >
                  {/* Poster */}
                  <div className="w-14 h-20 rounded-xl overflow-hidden shrink-0 relative" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" } as React.CSSProperties}>
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
                        <h4 className="font-headline font-bold text-xs truncate leading-tight" style={{ color: "var(--txt)" } as React.CSSProperties}>
                          {sub.title}
                        </h4>
                        <span
                          className="shrink-0 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider"
                          style={status === "subscribing"
                            ? { background: "var(--brand-primary-bg-alpha)", color: "var(--brand-primary)" } as React.CSSProperties
                            : { background: "rgba(245,158,11,0.16)", color: "var(--accent-warn)" } as React.CSSProperties}
                        >
                          {status === "subscribing" ? <span className="animate-pulse">监听中</span> : "已暂停"}
                        </span>
                      </div>

                      {/* Progress: derived from tv_scope / season / episode range */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
                          范围: <span className="text-brand-primary">{progress}</span>
                        </span>
                        {sub.auto_download !== undefined && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded"
                            style={{ background: sub.auto_download ? "rgba(34,197,94,0.12)" : "var(--surface-subtle)", color: sub.auto_download ? "var(--accent-ok)" : "var(--txt-muted)", border: "1px solid var(--border)" } as React.CSSProperties}>
                            {sub.auto_download ? "自动转存" : "手动"}
                          </span>
                        )}
                        {missingLabel && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded" style={missingStyle}>
                            {missingLabel}
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1 mt-2">
                        <span className="text-[8px] font-black px-1.5 py-0.5 rounded"
                          style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.25)" } as React.CSSProperties}>
                          {executionLabel}
                        </span>
                        <span className="text-[8px] font-black px-1.5 py-0.5 rounded"
                          style={{ background: "rgba(34,197,94,0.12)", color: "var(--accent-ok)", border: "1px solid rgba(34,197,94,0.25)" } as React.CSSProperties}>
                          {sourceModeLabel}
                        </span>
                        {sub.external_subscription_id && (
                          <span className="text-[8px] font-black px-1.5 py-0.5 rounded"
                            style={{ background: "var(--surface-subtle)", color: "var(--txt-muted)", border: "1px solid var(--border)" } as React.CSSProperties}>
                            #{sub.external_subscription_id}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 text-[9px] font-semibold mt-2 truncate" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
                        <Link2 className="w-3.5 h-3.5" style={{ color: "var(--txt-muted)" } as React.CSSProperties} />
                        <span className="truncate">{sourceSummary}</span>
                      </div>
                        </div>

                    {/* Action buttons footer */}
                    <div className="flex items-center justify-between pt-2.5 mt-2" style={{ borderTop: "1px solid var(--border)" } as React.CSSProperties}>
                      <span className="text-[9px] font-bold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
                        {lastUpdated ? `更新于 ${lastUpdated.substring(11, 16)}` : ""}
                      </span>

                      <div className="flex items-center gap-1.5">
                        {sub.external_system === "moviepilot" && sub.external_subscription_id && (
                          <button
                            onClick={() => handleMoviePilotSearch(sub)}
                            disabled={moviepilotSearchingId === sub.id}
                            className="p-1.5 rounded-lg transition-all active:scale-95 disabled:opacity-50"
                            style={{ background: "rgba(59,130,246,0.14)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.3)" } as React.CSSProperties}
                            title="触发 MoviePilot 手动搜索"
                          >
                            <Search className={`w-3.5 h-3.5 ${moviepilotSearchingId === sub.id ? "animate-pulse" : ""}`} />
                          </button>
                        )}
                        {/* Expand detail */}
                        <button
                          onClick={() => toggleExpand(sub)}
                          className="p-1.5 rounded-lg transition-all flex items-center gap-1"
                          style={isExpanded
                            ? { background: "var(--brand-primary-bg-alpha)", color: "var(--brand-primary)", border: "1px solid var(--brand-primary-border-alpha)" } as React.CSSProperties
                            : { background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" } as React.CSSProperties}
                          title="展开订阅详情"
                        >
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                        </button>

                        {/* Play/Pause toggle */}
                        <button
                          onClick={() => handleToggleStatus(sub)}
                          className="p-1.5 rounded-lg transition-all active:scale-95"
                          style={status === "subscribing"
                            ? { background: "rgba(245,158,11,0.14)", color: "var(--accent-warn)", border: "1px solid rgba(245,158,11,0.3)" } as React.CSSProperties
                            : { background: "var(--brand-primary-bg-alpha-heavy)", color: "var(--brand-primary)", border: "1px solid var(--brand-primary-border-alpha)" } as React.CSSProperties}
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
                          className="p-1.5 rounded-lg transition-all active:scale-95"
                          style={{ background: "rgba(239,68,68,0.12)", color: "var(--accent-danger)", border: "1px solid rgba(239,68,68,0.3)" } as React.CSSProperties}
                          title={isMoviePilotSubscription(sub) ? "删除 MoviePilot 本地镜像" : "删除订阅"}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 展开详情面板 */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="glass rounded-2xl p-3 space-y-3">
                        {detailLoading && (
                          <div className="text-[10px] font-bold py-2" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>加载详情中…</div>
                        )}

                        <div className="flex flex-wrap gap-1 rounded-xl p-1"
                          style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" } as React.CSSProperties}>
                          {[
                            { key: "follow" as const, label: "追新 / 转存", icon: Activity },
                            { key: "missing" as const, label: "缺集 / 来源", icon: AlertCircle },
                          ].map((item) => {
                            const Icon = item.icon;
                            const active = detailPanelTab === item.key;
                            return (
                              <button
                                key={item.key}
                                type="button"
                                onClick={() => setDetailPanelTab(item.key)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-black transition-all"
                                style={active
                                  ? { background: "var(--brand-primary)", color: "#fff" } as React.CSSProperties
                                  : { color: "var(--txt-secondary)" } as React.CSSProperties}
                              >
                                <Icon className="w-3.5 h-3.5" />
                                <span>{item.label}</span>
                              </button>
                            );
                          })}
                        </div>

                        {detailPanelTab === "missing" && (
                        <>
                        {/* 缺集明细（仅 TV） */}
                        {sub.media_type === "tv" && detailMissing && (
                          <div>
                            <div className="flex items-center gap-1.5 text-[10px] font-black mb-1.5" style={{ color: "var(--txt)" } as React.CSSProperties}>
                              <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                              <span>缺集明细</span>
                            </div>
                            {(() => {
                              const dm = detailMissing as {
                                status?: string; message?: string;
                                counts?: { aired?: number; existing?: number; missing?: number };
                                missing_by_season?: Record<string, unknown>;
                                missing_episodes?: unknown[];
                              };
                              if (dm.status === "no_tmdb") {
                                return <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>缺少 TMDB ID，无法比对</p>;
                              }
                              const counts = dm.counts || {};
                              const seasons = dm.missing_by_season || {};
                              const seasonKeys = Object.keys(seasons);
                              return (
                                <div className="space-y-1">
                                  <p className="text-[10px] font-bold" style={{ color: "var(--txt-secondary)" } as React.CSSProperties}>
                                    已入库 {counts.existing ?? 0} / 已播 {counts.aired ?? 0} / 缺 {counts.missing ?? 0}
                                  </p>
                                  {seasonKeys.length > 0 ? (
                                    <div className="flex flex-wrap gap-1">
                                      {seasonKeys.map(sk => (
                                        <span key={sk} className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                                          style={{ background: "rgba(245,158,11,0.10)", color: "var(--accent-warn)", border: "1px solid rgba(245,158,11,0.25)" } as React.CSSProperties}>
                                          S{sk}
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-[10px] font-bold" style={{ color: "var(--accent-ok)" } as React.CSSProperties}>无缺集，已全部入库</p>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}

                        {/* 115 分享补缺源管理 */}
                        {getExecutionChannel(sub) === "pan115" ? (
                        <div>
                          <div className="flex items-center gap-1.5 text-[10px] font-black mb-1.5" style={{ color: "var(--txt)" } as React.CSSProperties}>
                            <Link2 className="w-3.5 h-3.5 text-brand-primary" />
                            <span>115 分享补缺源 ({detailSources.length})</span>
                          </div>
                          {detailSources.length === 0 ? (
                            <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>未配置 115 分享补缺源；补缺集时可添加一个确定的 115 分享链接。</p>
                          ) : (
                            <div className="space-y-1.5">
                              {detailSources.map(src => (
                                <div key={src.id} className="flex flex-col gap-2 rounded-lg px-2 py-1.5"
                                  style={{ background: "var(--surface)", border: "1px solid var(--border)" } as React.CSSProperties}>
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="text-[10px] font-bold truncate" style={{ color: "var(--txt)" } as React.CSSProperties}>
                                        {src.display_name || src.source_type}
                                      </div>
                                      <div className="text-[9px] font-semibold truncate" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
                                        {src.enabled ? "启用" : "已禁用"}
                                        {src.last_scan_status ? ` · ${src.last_scan_status}` : ""}
                                        {src.last_error ? ` · ${src.last_error}` : ""}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <button
                                        onClick={() => handleToggleSource(sub, src)}
                                        className="px-1.5 py-1 rounded text-[9px] font-bold transition-colors cursor-pointer"
                                        style={src.enabled
                                          ? { background: "rgba(245,158,11,0.14)", color: "var(--accent-warn)", border: "1px solid rgba(245,158,11,0.3)" } as React.CSSProperties
                                          : { background: "rgba(34,197,94,0.14)", color: "var(--accent-ok)", border: "1px solid rgba(34,197,94,0.3)" } as React.CSSProperties}
                                        title={src.enabled ? "禁用" : "启用"}
                                      >
                                        {src.enabled ? "停" : "启"}
                                      </button>
                                      <button
                                        onClick={() => handleScanSource(sub, src)}
                                        className="p-1 rounded text-brand-primary hover:bg-brand-primary/10 transition-colors cursor-pointer"
                                        style={{ border: "1px solid var(--border)" } as React.CSSProperties}
                                        title="扫描补缺源"
                                      >
                                        <RefreshCw className="w-3 h-3" />
                                      </button>
                                      <button
                                        onClick={() => handleDeleteSource(sub, src)}
                                        className="p-1 rounded transition-colors cursor-pointer"
                                        style={{ color: "var(--accent-danger)", border: "1px solid rgba(239,68,68,0.3)" } as React.CSSProperties}
                                        title="删除来源"
                                      >
                                        <Trash2 className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </div>
                                  <SubscriptionSourceFileSelector
                                    subscriptionId={sub.id}
                                    subscriptionTitle={sub.title}
                                    source={src}
                                    addLog={addLog}
                                    onSourceUpdated={handleSourceUpdated}
                                    onRefresh={() => refreshSourceDerivedState(sub)}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                          {/* 新增来源 */}
                          <div className="flex gap-1.5 mt-2">
                            <input
                              type="text"
                              placeholder="115 分享补缺链接"
                              value={newSourceUrl}
                              onChange={(e) => setNewSourceUrl(e.target.value)}
                              className="flex-1 min-w-0 text-[10px] rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-primary"
                              style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" } as React.CSSProperties}
                            />
                            <input
                              type="text"
                              placeholder="提取码"
                              value={newSourceCode}
                              onChange={(e) => setNewSourceCode(e.target.value)}
                              className="w-20 text-[10px] rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-primary"
                              style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" } as React.CSSProperties}
                            />
                            <button
                              onClick={() => handleAddSource(sub)}
                              disabled={addingSource || !newSourceUrl.trim()}
                              className="px-2 py-1.5 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3" />
                              添加
                            </button>
                          </div>
                        </div>
                        ) : (
                          <div className="rounded-xl px-3 py-2"
                            style={{ background: "var(--surface)", border: "1px solid var(--border)" } as React.CSSProperties}>
                            <div className="flex items-center gap-1.5 text-[10px] font-black" style={{ color: "var(--txt)" } as React.CSSProperties}>
                              <Link2 className="w-3.5 h-3.5 text-brand-primary" />
                              <span>{getExecutionChannel(sub) === "pt" ? "PT 来源" : "网盘来源"}</span>
                            </div>
                            <p className="text-[10px] font-semibold mt-1" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
                              {getExecutionChannel(sub) === "pt"
                                ? "该订阅由 MoviePilot 管理，不使用 115 分享补缺源。"
                                : "夸克补缺源尚未接入，不能复用 115 分享补缺逻辑。"}
                            </p>
                          </div>
                        )}

                        {getExecutionChannel(sub) === "pt" && sub.media_type === "tv" && (
                          <div className="rounded-xl px-3 py-2"
                            style={{ background: "var(--surface)", border: "1px solid var(--border)" } as React.CSSProperties}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5 text-[10px] font-black" style={{ color: "var(--txt)" } as React.CSSProperties}>
                                <Search className="w-3.5 h-3.5 text-brand-primary" />
                                <span>MoviePilot 缺集补齐</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleMoviePilotCompletionPreview(sub)}
                                  disabled={moviepilotCompletionBusyId === sub.id}
                                  className="px-2 py-1 rounded text-[9px] font-bold glass-hover disabled:opacity-50"
                                  style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" } as React.CSSProperties}
                                >
                                  预览
                                </button>
                                <button
                                  onClick={() => handleMoviePilotCompletionRun(sub)}
                                  disabled={moviepilotCompletionBusyId === sub.id}
                                  className="px-2 py-1 rounded text-[9px] font-bold bg-brand-primary text-white disabled:opacity-50"
                                >
                                  {moviepilotCompletionBusyId === sub.id ? "处理中" : "补缺"}
                                </button>
                              </div>
                            </div>
                            {moviepilotCompletionPreview && Number(moviepilotCompletionPreview.subscription_id) === Number(sub.id) ? (
                              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-1.5">
                                {[
                                  ["可推送", moviepilotCompletionPreview.counts?.auto_push ?? moviepilotCompletionPreview.auto_push?.length ?? 0, "var(--accent-ok)"],
                                  ["需确认", moviepilotCompletionPreview.counts?.ambiguous ?? moviepilotCompletionPreview.ambiguous?.length ?? 0, "var(--accent-warn)"],
                                  ["无匹配", moviepilotCompletionPreview.counts?.no_match ?? moviepilotCompletionPreview.no_match?.length ?? 0, "var(--txt-muted)"],
                                  ["已处理", moviepilotCompletionPreview.counts?.processed ?? moviepilotCompletionPreview.processed?.length ?? 0, "var(--brand-primary)"],
                                ].map(([label, value, color]) => (
                                  <div key={String(label)} className="rounded-lg px-2 py-1"
                                    style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" } as React.CSSProperties}>
                                    <div className="text-[8px] font-black" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>{label}</div>
                                    <div className="text-[12px] font-black" style={{ color: String(color) } as React.CSSProperties}>{String(value)}</div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[10px] font-semibold mt-1" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
                                只会自动推送明确匹配的单集资源；季包、全集包和模糊资源会跳过。
                              </p>
                            )}
                          </div>
                        )}
                        </>
                        )}

                        {detailPanelTab === "follow" && (
                        <>

                        {/* 下载记录 */}
                        <div>
                          <div className="flex items-center gap-1.5 text-[10px] font-black mb-1.5" style={{ color: "var(--txt)" } as React.CSSProperties}>
                            <Database className="w-3.5 h-3.5" style={{ color: "var(--txt-secondary)" } as React.CSSProperties} />
                            <span>{getExecutionChannel(sub) === "pt" ? "PT 下载记录" : "转存 / 下载记录"} ({detailDownloads.length})</span>
                          </div>
                          {detailDownloads.length === 0 ? (
                            <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>暂无下载记录</p>
                          ) : (
                            <div className="space-y-1">
                              {detailDownloads.map(dl => (
                                <div key={dl.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5"
                                  style={{ background: "var(--surface)", border: "1px solid var(--border)" } as React.CSSProperties}>
                                  <div className="flex items-start gap-1.5 min-w-0">
                                    <div className="pt-0.5">
                                      {dl.status === "completed" || dl.status === "offline_completed"
                                        ? <CheckCircle2 className="w-3 h-3 shrink-0" style={{ color: "var(--accent-ok)" } as React.CSSProperties} />
                                        : dl.status === "failed"
                                          ? <XCircle className="w-3 h-3 shrink-0" style={{ color: "var(--accent-danger)" } as React.CSSProperties} />
                                          : <ClipboardList className="w-3 h-3 shrink-0" style={{ color: "var(--txt-muted)" } as React.CSSProperties} />}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="text-[10px] font-bold truncate" style={{ color: "var(--txt)" } as React.CSSProperties}>{dl.resource_name}</div>
                                      {(dl.offline_status || dl.offline_info_hash || dl.error_message) && (
                                        <div className="text-[9px] font-semibold truncate mt-0.5" style={{ color: dl.error_message ? "var(--accent-danger)" : "var(--txt-muted)" } as React.CSSProperties}>
                                          {dl.offline_status ? `MP: ${dl.offline_status}` : ""}
                                          {dl.offline_info_hash ? ` · ${dl.offline_info_hash.slice(0, 12)}` : ""}
                                          {dl.error_message ? ` · ${dl.error_message}` : ""}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="text-[9px] font-black px-1.5 py-0.5 rounded"
                                      style={{ background: "var(--surface-subtle)", color: "var(--txt-muted)", border: "1px solid var(--border)" } as React.CSSProperties}>
                                      {formatDownloadResourceType(dl.resource_type)}
                                    </span>
                                    <span className="text-[9px] font-bold uppercase" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>{dl.status}</span>
                                    <button
                                      onClick={() => handleDeleteDownload(sub, dl)}
                                      className="p-1 rounded transition-colors"
                                      style={{ color: "var(--accent-danger)" } as React.CSSProperties}
                                      title="删除记录"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* 执行日志（订阅步骤日志流） */}
                        <div>
                          <div className="flex items-center gap-1.5 text-[10px] font-black mb-1.5" style={{ color: "var(--txt)" } as React.CSSProperties}>
                            <ClipboardList className="w-3.5 h-3.5" style={{ color: "var(--accent-info)" } as React.CSSProperties} />
                            <span>执行日志 ({detailStepLogs.length})</span>
                          </div>
                          {detailStepLogsLoading ? (
                            <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>加载中…</p>
                          ) : detailStepLogs.length === 0 ? (
                            <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>暂无执行日志（该订阅尚无扫描记录）</p>
                          ) : (
                            <div className="max-h-[240px] overflow-y-auto pr-1 no-scrollbar space-y-1">
                              {detailStepLogs.slice(0, 50).map((log, i) => {
                                const statusColor =
                                  log.status === "success" ? "var(--accent-ok)" :
                                  log.status === "failed" ? "var(--accent-danger)" :
                                  log.status === "warning" ? "var(--accent-warn)" : "var(--txt-muted)";
                                const stepLabel = stepLabelMap[log.step] || log.step || "-";
                                const timeStr = (log.created_at || "").replace("T", " ").substring(0, 19);
                                return (
                                  <div key={log.id || i} className="flex items-start gap-2 rounded-lg px-2 py-1.5"
                                    style={{ background: "var(--surface)", border: "1px solid var(--border)" } as React.CSSProperties}>
                                    <div className="shrink-0 mt-0.5">
                                      {log.status === "success" ? <CheckCircle2 className="w-3 h-3" style={{ color: "var(--accent-ok)" }} /> :
                                       log.status === "failed" ? <XCircle className="w-3 h-3" style={{ color: "var(--accent-danger)" }} /> :
                                       <Activity className="w-3 h-3" style={{ color: "var(--txt-muted)" }} />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[9px] font-bold truncate" style={{ color: "var(--txt)" }}>{stepLabel}</span>
                                        <span className="text-[8px] font-bold shrink-0 px-1 py-0.5 rounded"
                                          style={{ background: statusColor.replace(")", ",0.12)"), color: statusColor }}>
                                          {log.status}
                                        </span>
                                        {log.channel && log.channel !== "unknown" && (
                                          <span className="text-[8px] font-semibold shrink-0" style={{ color: "var(--txt-muted)" }}>{log.channel}</span>
                                        )}
                                      </div>
                                      {log.message && (
                                        <p className="text-[9px] font-medium mt-0.5 line-clamp-2 leading-snug" style={{ color: "var(--txt-secondary)" }}>
                                          {log.message}
                                        </p>
                                      )}
                                      <p className="text-[8px] font-semibold mt-0.5" style={{ color: "var(--txt-muted)" }}>{timeStr}</p>
                                    </div>
                                  </div>
                                );
                              })}
                              {detailStepLogs.length > 50 && (
                                <p className="text-[9px] font-semibold text-center py-1" style={{ color: "var(--txt-muted)" }}>
                                  仅显示最近 50 条，共 {detailStepLogs.length} 条
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                        </>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}
