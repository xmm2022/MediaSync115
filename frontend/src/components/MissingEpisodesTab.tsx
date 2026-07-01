import React, { useEffect, useMemo, useState } from "react";
import type {
  MoviePilotCompletionPreview,
  SubscriptionItem,
  SubscriptionSource,
} from "../api/types";
import { moviepilotApi, subscriptionApi } from "../api";
import { getApiErrorMessage } from "../api/errors";
import EmptyState from "./ui/EmptyState";
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Download,
  HardDrive,
  Link2,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  XCircle,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import SubscriptionSourceFileSelector from "./SubscriptionSourceFileSelector";

interface MissingEpisodesTabProps {
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => Promise<void>;
  onNavigateToSubscriptions?: () => void;
}

type ExecutionChannel = "pan115" | "pt" | "quark" | "anime" | "unknown";
type MissingFilter = "attention" | "pan115" | "pt" | "unresolved" | "all";

interface MissingStatusDetail {
  subscription_id?: number;
  tmdb_id?: number | null;
  title?: string;
  year?: string | number;
  poster_path?: string;
  provider?: string;
  external_system?: string;
  participates_in_115_transfer?: boolean;
  status?: string;
  message?: string;
  total_count?: number;
  aired_count?: number;
  existing_count?: number;
  missing_count?: number;
  aired_episodes?: unknown[];
  existing_episodes?: unknown[];
  missing_episodes?: unknown[];
  missing_by_season?: Record<string, unknown>;
  counts?: {
    aired?: number;
    total?: number;
    existing?: number;
    missing?: number;
  };
}

interface MissingRow {
  subscription: SubscriptionItem;
  detail: MissingStatusDetail | null;
  error?: string;
}

interface SourceDraft {
  url: string;
  code: string;
}

const UNRESOLVED_STATUSES = new Set([
  "no_tmdb",
  "invalid_tmdb",
  "emby_error",
  "tmdb_error",
  "cache_unavailable",
  "error",
  "unknown",
]);

const FILTERS: { key: MissingFilter; label: string }[] = [
  { key: "attention", label: "有缺集" },
  { key: "pan115", label: "115 补缺" },
  { key: "pt", label: "PT 补缺" },
  { key: "unresolved", label: "无法判断" },
  { key: "all", label: "全部剧集" },
];

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

function getChannelLabel(channel: ExecutionChannel): string {
  if (channel === "pt") return "PT / MoviePilot";
  if (channel === "pan115") return "115 转存";
  if (channel === "quark") return "夸克转存";
  return "未分类";
}

function posterUrl(sub: SubscriptionItem): string | null {
  if (!sub.poster_path) return null;
  return `https://image.tmdb.org/t/p/w200${sub.poster_path}`;
}

function getMissingCount(detail: MissingStatusDetail | null): number {
  return Number(detail?.counts?.missing ?? detail?.missing_count ?? 0);
}

function getExistingCount(detail: MissingStatusDetail | null): number {
  return Number(detail?.counts?.existing ?? detail?.existing_count ?? 0);
}

function getAiredCount(detail: MissingStatusDetail | null): number {
  return Number(detail?.counts?.aired ?? detail?.aired_count ?? 0);
}

function isUnresolved(row: MissingRow): boolean {
  if (row.error) return true;
  return UNRESOLVED_STATUSES.has(String(row.detail?.status || "unknown"));
}

function getStatusTone(row: MissingRow): React.CSSProperties {
  if (isUnresolved(row)) {
    return {
      background: "rgba(239,68,68,0.12)",
      color: "var(--accent-danger)",
      border: "1px solid rgba(239,68,68,0.28)",
    };
  }
  if (getMissingCount(row.detail) > 0) {
    return {
      background: "rgba(245,158,11,0.14)",
      color: "var(--accent-warn)",
      border: "1px solid rgba(245,158,11,0.30)",
    };
  }
  return {
    background: "rgba(34,197,94,0.12)",
    color: "var(--accent-ok)",
    border: "1px solid rgba(34,197,94,0.26)",
  };
}

function getStatusText(row: MissingRow): string {
  if (row.error) return "查询失败";
  if (isUnresolved(row)) return "无法判断";
  const missing = getMissingCount(row.detail);
  return missing > 0 ? `缺 ${missing} 集` : "无缺集";
}

function formatEpisodeValue(value: unknown): string {
  if (typeof value === "number") return `E${value}`;
  if (typeof value === "string" && value.trim()) return value.trim().startsWith("E") ? value.trim() : `E${value.trim()}`;
  return "E?";
}

function formatSeasonGroups(detail: MissingStatusDetail | null): string[] {
  const bySeason = detail?.missing_by_season || {};
  const groups = Object.entries(bySeason)
    .map(([season, rawEpisodes]) => {
      const episodes = Array.isArray(rawEpisodes) ? rawEpisodes.slice(0, 8).map(formatEpisodeValue) : [];
      const suffix = Array.isArray(rawEpisodes) && rawEpisodes.length > 8 ? ` +${rawEpisodes.length - 8}` : "";
      return episodes.length > 0 ? `S${season} ${episodes.join(" ")}${suffix}` : `S${season}`;
    })
    .filter(Boolean);
  if (groups.length > 0) return groups;

  return (detail?.missing_episodes || [])
    .slice(0, 12)
    .map((item) => {
      if (Array.isArray(item) && item.length >= 2) return `S${item[0]}E${item[1]}`;
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const season = record.season_number ?? record.season ?? "?";
        const episode = record.episode_number ?? record.episode ?? "?";
        return `S${season}E${episode}`;
      }
      return null;
    })
    .filter((item): item is string => Boolean(item));
}

function formatUpdatedAt(value?: string): string {
  if (!value) return "暂无记录";
  return value.replace("T", " ").substring(0, 16);
}

function completionCount(
  preview: MoviePilotCompletionPreview,
  key: "auto_push" | "ambiguous" | "no_match" | "processed",
): number {
  return Number(preview.counts?.[key] ?? preview[key]?.length ?? 0);
}

export default function MissingEpisodesTab({
  addLog,
  onNavigateToSubscriptions,
}: MissingEpisodesTabProps) {
  const [rows, setRows] = useState<MissingRow[]>([]);
  const [filter, setFilter] = useState<MissingFilter>("attention");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sourcesBySubId, setSourcesBySubId] = useState<Record<string, SubscriptionSource[]>>({});
  const [sourceDrafts, setSourceDrafts] = useState<Record<string, SourceDraft>>({});
  const [sourceBusyId, setSourceBusyId] = useState<string | null>(null);
  const [completionBySubId, setCompletionBySubId] = useState<Record<string, MoviePilotCompletionPreview>>({});
  const [completionBusyId, setCompletionBusyId] = useState<string | null>(null);

  const loadRows = async (forceRefresh = false) => {
    setErrorMessage(null);
    if (forceRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await subscriptionApi.list({ scope: "media" });
      const subscriptions = (response.data as SubscriptionItem[]).filter((sub) => {
        const channel = getExecutionChannel(sub);
        return sub.media_type === "tv" && (channel === "pan115" || channel === "pt");
      });

      const loaded = await Promise.all(
        subscriptions.map(async (subscription): Promise<MissingRow> => {
          try {
            const detailResponse = await subscriptionApi.getSubscriptionTvMissingStatus(subscription.id, {
              refresh: forceRefresh,
            });
            return {
              subscription,
              detail: detailResponse.data as MissingStatusDetail,
            };
          } catch (err) {
            return {
              subscription,
              detail: null,
              error: getApiErrorMessage(err, "缺集状态不可用"),
            };
          }
        }),
      );

      setRows(loaded);
    } catch (err) {
      setErrorMessage(`加载缺集清单失败: ${getApiErrorMessage(err)}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadRows(false);
  }, []);

  const stats = useMemo(() => {
    const attention = rows.filter((row) => getMissingCount(row.detail) > 0 || isUnresolved(row)).length;
    const pan115 = rows.filter((row) => getExecutionChannel(row.subscription) === "pan115").length;
    const pt = rows.filter((row) => getExecutionChannel(row.subscription) === "pt").length;
    const unresolved = rows.filter(isUnresolved).length;
    const totalMissing = rows.reduce((sum, row) => sum + getMissingCount(row.detail), 0);
    return { attention, pan115, pt, unresolved, totalMissing };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const result = rows.filter((row) => {
      const channel = getExecutionChannel(row.subscription);
      if (filter === "attention") return getMissingCount(row.detail) > 0 || isUnresolved(row);
      if (filter === "pan115") return channel === "pan115";
      if (filter === "pt") return channel === "pt";
      if (filter === "unresolved") return isUnresolved(row);
      return true;
    });

    return result.sort((a, b) => {
      const unresolvedDelta = Number(isUnresolved(b)) - Number(isUnresolved(a));
      if (unresolvedDelta !== 0) return unresolvedDelta;
      const missingDelta = getMissingCount(b.detail) - getMissingCount(a.detail);
      if (missingDelta !== 0) return missingDelta;
      return String(a.subscription.title).localeCompare(String(b.subscription.title), "zh-Hans-CN");
    });
  }, [filter, rows]);

  const loadSources = async (subscriptionId: string) => {
    try {
      const response = await subscriptionApi.listSources(subscriptionId);
      setSourcesBySubId((prev) => ({
        ...prev,
        [subscriptionId]: response.data as SubscriptionSource[],
      }));
    } catch (err) {
      setErrorMessage(`加载 115 补缺源失败: ${getApiErrorMessage(err)}`);
    }
  };

  const reloadOneStatus = async (sub: SubscriptionItem, forceRefresh = true) => {
    try {
      const response = await subscriptionApi.getSubscriptionTvMissingStatus(sub.id, {
        refresh: forceRefresh,
      });
      setRows((prev) => prev.map((row) => (
        row.subscription.id === sub.id
          ? { ...row, detail: response.data as MissingStatusDetail, error: undefined }
          : row
      )));
    } catch (err) {
      setRows((prev) => prev.map((row) => (
        row.subscription.id === sub.id
          ? { ...row, error: getApiErrorMessage(err, "缺集状态不可用") }
          : row
      )));
    }
  };

  const toggleRow = (row: MissingRow) => {
    const nextId = expandedId === row.subscription.id ? null : row.subscription.id;
    setExpandedId(nextId);
    if (nextId && getExecutionChannel(row.subscription) === "pan115" && !sourcesBySubId[row.subscription.id]) {
      void loadSources(row.subscription.id);
    }
  };

  const updateDraft = (subscriptionId: string, patch: Partial<SourceDraft>) => {
    setSourceDrafts((prev) => ({
      ...prev,
      [subscriptionId]: {
        url: prev[subscriptionId]?.url || "",
        code: prev[subscriptionId]?.code || "",
        ...patch,
      },
    }));
  };

  const handleAddSource = async (row: MissingRow) => {
    const draft = sourceDrafts[row.subscription.id] || { url: "", code: "" };
    if (!draft.url.trim()) return;
    setSourceBusyId(row.subscription.id);
    setErrorMessage(null);
    try {
      await subscriptionApi.createSource(row.subscription.id, {
        share_url: draft.url.trim(),
        receive_code: draft.code.trim() || undefined,
      });
      updateDraft(row.subscription.id, { url: "", code: "" });
      await loadSources(row.subscription.id);
      await addLog("SUCCESS", `已为 [${row.subscription.title}] 添加 115 分享补缺源`);
    } catch (err) {
      setErrorMessage(`添加 115 补缺源失败: ${getApiErrorMessage(err)}`);
    } finally {
      setSourceBusyId(null);
    }
  };

  const handleScanSource = async (row: MissingRow, source: SubscriptionSource) => {
    setSourceBusyId(`${row.subscription.id}:${source.id}`);
    setErrorMessage(null);
    try {
      await subscriptionApi.scanSource(row.subscription.id, String(source.id));
      await Promise.all([
        loadSources(row.subscription.id),
        reloadOneStatus(row.subscription, true),
      ]);
      await addLog("INFO", `已触发 [${row.subscription.title}] 的 115 补缺源扫描`);
    } catch (err) {
      setErrorMessage(`扫描 115 补缺源失败: ${getApiErrorMessage(err)}`);
    } finally {
      setSourceBusyId(null);
    }
  };

  const handleToggleSource = async (row: MissingRow, source: SubscriptionSource) => {
    setSourceBusyId(`${row.subscription.id}:${source.id}:toggle`);
    setErrorMessage(null);
    try {
      await subscriptionApi.updateSource(row.subscription.id, String(source.id), {
        enabled: !source.enabled,
      });
      await loadSources(row.subscription.id);
      await addLog("INFO", `已${source.enabled ? "停用" : "启用"} [${row.subscription.title}] 的 115 补缺源`);
    } catch (err) {
      setErrorMessage(`更新 115 补缺源失败: ${getApiErrorMessage(err)}`);
    } finally {
      setSourceBusyId(null);
    }
  };

  const handleDeleteSource = async (row: MissingRow, source: SubscriptionSource) => {
    if (!confirm(`删除 [${source.display_name || source.source_type || "115 补缺源"}]？`)) return;
    setSourceBusyId(`${row.subscription.id}:${source.id}:delete`);
    setErrorMessage(null);
    try {
      await subscriptionApi.deleteSource(row.subscription.id, String(source.id));
      await loadSources(row.subscription.id);
      await addLog("WARN", `已删除 [${row.subscription.title}] 的 115 补缺源`);
    } catch (err) {
      setErrorMessage(`删除 115 补缺源失败: ${getApiErrorMessage(err)}`);
    } finally {
      setSourceBusyId(null);
    }
  };

  const handleSourceUpdated = (subscriptionId: string, updatedSource: SubscriptionSource) => {
    setSourcesBySubId((prev) => ({
      ...prev,
      [subscriptionId]: (prev[subscriptionId] || []).map((source) => (
        source.id === updatedSource.id ? updatedSource : source
      )),
    }));
  };

  const handleMoviePilotPreview = async (row: MissingRow) => {
    setCompletionBusyId(row.subscription.id);
    setErrorMessage(null);
    try {
      const response = await moviepilotApi.previewMissingCompletion(row.subscription.id);
      setCompletionBySubId((prev) => ({ ...prev, [row.subscription.id]: response.data }));
      const counts = response.data.counts || {};
      await addLog(
        "INFO",
        `MoviePilot 补缺预览 [${row.subscription.title}]：可推送 ${counts.auto_push ?? 0}，需确认 ${counts.ambiguous ?? 0}，无匹配 ${counts.no_match ?? 0}`,
      );
    } catch (err) {
      setErrorMessage(`MoviePilot 补缺预览失败: ${getApiErrorMessage(err)}`);
    } finally {
      setCompletionBusyId(null);
    }
  };

  const handleMoviePilotRun = async (row: MissingRow) => {
    setCompletionBusyId(row.subscription.id);
    setErrorMessage(null);
    try {
      const response = await moviepilotApi.runMissingCompletion(row.subscription.id, {
        dry_run: false,
      });
      setCompletionBySubId((prev) => ({ ...prev, [row.subscription.id]: response.data }));
      await reloadOneStatus(row.subscription, true);
      await addLog(
        "SUCCESS",
        `MoviePilot 补缺完成 [${row.subscription.title}]：已推送 ${response.data.pushed_count ?? 0}，失败 ${response.data.failed_count ?? 0}`,
      );
    } catch (err) {
      setErrorMessage(`MoviePilot 补缺失败: ${getApiErrorMessage(err)}`);
    } finally {
      setCompletionBusyId(null);
    }
  };

  return (
    <div className="liquid-page space-y-6">
      {errorMessage && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-heavy glass-iridescent rounded-2xl px-5 py-3 flex items-center gap-2.5"
          style={{ border: "1px solid rgba(239,68,68,0.3)", color: "var(--accent-danger)" }}
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="text-xs font-bold">{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="ml-auto text-xs font-bold hover:opacity-80 cursor-pointer"
          >
            关闭
          </button>
        </motion.div>
      )}

      <div className="liquid-hero glass-heavy glass-iridescent glass-spotlight rounded-3xl p-6 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight flex items-center gap-2.5" style={{ color: "var(--txt)" }}>
            <AlertCircle className="w-6.5 h-6.5" style={{ color: "var(--accent-warn)" }} />
            <span>缺集管理</span>
          </h2>
          <p className="text-xs mt-1 max-w-2xl leading-relaxed" style={{ color: "var(--txt-secondary)" }}>
            按剧集缺口集中处理 115 固定来源补缺和 MoviePilot/PT 精准补缺；订阅中心继续负责追新规则、渠道启停和长期监听。
          </p>
        </div>

        <div className="flex flex-wrap gap-2 shrink-0">
          {onNavigateToSubscriptions && (
            <button
              type="button"
              onClick={onNavigateToSubscriptions}
              className="glass-hover px-4 py-2.5 rounded-2xl text-xs font-black tracking-wider flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              <SlidersHorizontal className="w-4.5 h-4.5" />
              <span>订阅规则</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadRows(true)}
            disabled={refreshing || loading}
            className="bg-brand-primary text-white px-4 py-2.5 rounded-2xl text-xs font-black tracking-wider flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-4.5 h-4.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>刷新缺集</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: "待处理剧集", value: stats.attention, sub: `共缺 ${stats.totalMissing} 集`, icon: AlertCircle, color: "var(--accent-warn)" },
          { label: "115 补缺", value: stats.pan115, sub: "固定分享源 / 扫描", icon: HardDrive, color: "var(--brand-primary)" },
          { label: "PT 补缺", value: stats.pt, sub: "MoviePilot 精准推送", icon: Download, color: "var(--accent-info)" },
          { label: "无法判断", value: stats.unresolved, sub: "需检查 TMDB 或媒体库索引", icon: XCircle, color: "var(--accent-danger)" },
        ].map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className="glass rounded-2xl p-4 flex items-center gap-3" style={{ border: "1px solid var(--border)" }}>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--surface-subtle)", color: card.color }}>
                <Icon className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-wider" style={{ color: "var(--txt-muted)" }}>{card.label}</div>
                <div className="text-lg font-black truncate mt-0.5" style={{ color: "var(--txt)" }}>{card.value}</div>
                <div className="text-[10px] font-semibold truncate" style={{ color: "var(--txt-secondary)" }}>{card.sub}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="liquid-segmented flex flex-wrap gap-2 rounded-3xl p-2" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilter(item.key)}
            className="px-3 py-2 rounded-2xl text-xs font-black transition-all cursor-pointer"
            style={filter === item.key
              ? { background: "var(--brand-primary)", color: "#fff" }
              : { background: "var(--surface)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="glass rounded-3xl p-12 text-center">
          <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-bold mt-3" style={{ color: "var(--txt-muted)" }}>正在计算缺集状态...</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="glass rounded-3xl p-12 text-center">
          <EmptyState
            icon={<CheckCircle2 className="w-10 h-10" style={{ color: "var(--txt-muted)" }} />}
            text="暂无可管理的剧集订阅"
            subtext="缺集管理只聚合 115 与 MoviePilot 的 TV 订阅；动漫追番仍在独立页面处理。"
          />
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="glass rounded-3xl p-12 text-center">
          <EmptyState
            icon={<CheckCircle2 className="w-10 h-10" style={{ color: "var(--accent-ok)" }} />}
            text="当前筛选下没有待处理项"
            subtext="切换筛选或刷新缺集状态。"
          />
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRows.map((row) => {
            const channel = getExecutionChannel(row.subscription);
            const expanded = expandedId === row.subscription.id;
            const missingGroups = formatSeasonGroups(row.detail);
            const sources = sourcesBySubId[row.subscription.id] || [];
            const draft = sourceDrafts[row.subscription.id] || { url: "", code: "" };
            const preview = completionBySubId[row.subscription.id];
            const statusStyle = getStatusTone(row);
            const missing = getMissingCount(row.detail);
            const poster = posterUrl(row.subscription);

            return (
              <div key={row.subscription.id} className="glass rounded-2xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                <button
                  type="button"
                  onClick={() => toggleRow(row)}
                  className="w-full p-4 flex items-start gap-4 text-left transition-all glass-hover cursor-pointer"
                >
                  <div className="w-14 h-20 rounded-xl overflow-hidden shrink-0 flex items-center justify-center" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                    {poster ? (
                      <img
                        src={poster}
                        alt={row.subscription.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <Activity className="w-5 h-5" style={{ color: "var(--txt-muted)" }} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-headline font-black text-sm truncate" style={{ color: "var(--txt)" }}>
                            {row.subscription.title}
                          </h3>
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded" style={statusStyle}>
                            {getStatusText(row)}
                          </span>
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded"
                            style={{ background: channel === "pt" ? "rgba(59,130,246,0.12)" : "var(--brand-primary-bg-alpha)", color: channel === "pt" ? "var(--accent-info)" : "var(--brand-primary)", border: "1px solid var(--border)" }}
                          >
                            {getChannelLabel(channel)}
                          </span>
                        </div>
                        <p className="text-[10px] font-semibold mt-1" style={{ color: "var(--txt-secondary)" }}>
                          已入库 {getExistingCount(row.detail)} / 已播 {getAiredCount(row.detail)}
                          {row.detail?.message ? ` · ${row.detail.message}` : row.error ? ` · ${row.error}` : ""}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[9px] font-bold" style={{ color: "var(--txt-muted)" }}>
                          {formatUpdatedAt(row.subscription.updated_at || row.subscription.created_at)}
                        </span>
                        <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} style={{ color: "var(--txt-muted)" }} />
                      </div>
                    </div>

                    {missingGroups.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {missingGroups.slice(0, 8).map((label) => (
                          <span key={label} className="text-[9px] font-black px-2 py-1 rounded-lg"
                            style={{ background: "rgba(245,158,11,0.10)", color: "var(--accent-warn)", border: "1px solid rgba(245,158,11,0.24)" }}>
                            {label}
                          </span>
                        ))}
                        {missingGroups.length > 8 && (
                          <span className="text-[9px] font-black px-2 py-1 rounded-lg" style={{ background: "var(--surface-subtle)", color: "var(--txt-muted)", border: "1px solid var(--border)" }}>
                            +{missingGroups.length - 8}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </button>

                <AnimatePresence>
                  {expanded && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="p-4 pt-0 space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {[
                            ["已播", getAiredCount(row.detail), "var(--txt-secondary)"],
                            ["已入库", getExistingCount(row.detail), "var(--accent-ok)"],
                            ["缺集", missing, missing > 0 ? "var(--accent-warn)" : "var(--accent-ok)"],
                          ].map(([label, value, color]) => (
                            <div key={String(label)} className="rounded-xl px-3 py-2" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                              <div className="text-[9px] font-black" style={{ color: "var(--txt-muted)" }}>{label}</div>
                              <div className="text-base font-black" style={{ color: String(color) }}>{String(value)}</div>
                            </div>
                          ))}
                        </div>

                        {channel === "pan115" && (
                          <div className="rounded-2xl p-4 space-y-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                              <div>
                                <h3 className="text-xs font-black flex items-center gap-1.5" style={{ color: "var(--txt)" }}>
                                  <Link2 className="w-3.5 h-3.5 text-brand-primary" />
                                  <span>115 分享补缺源</span>
                                </h3>
                                <p className="text-[10px] font-semibold mt-0.5" style={{ color: "var(--txt-muted)" }}>
                                  固定分享源用于补缺，不影响 HDHive/Pansou/TG 的追新扫描。
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => void loadSources(row.subscription.id)}
                                className="px-2 py-1 rounded-lg text-[9px] font-black glass-hover cursor-pointer"
                                style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
                              >
                                刷新来源
                              </button>
                            </div>

                            {sources.length === 0 ? (
                              <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" }}>
                                暂无固定补缺源。添加确定的 115 分享链接后，可直接扫描补缺。
                              </p>
                            ) : (
                              <div className="space-y-2">
                                {sources.map((source) => {
                                  const busy = sourceBusyId === `${row.subscription.id}:${source.id}`;
                                  const sourceActionBusy = Boolean(sourceBusyId?.startsWith(`${row.subscription.id}:${source.id}`));
                                  return (
                                    <div key={source.id} className="flex flex-col gap-2 rounded-xl px-3 py-2" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="min-w-0">
                                          <p className="text-[10px] font-black truncate" style={{ color: "var(--txt)" }}>
                                            {source.display_name || source.source_type || "115 分享源"}
                                          </p>
                                          <p className="text-[9px] font-semibold truncate" style={{ color: source.last_error ? "var(--accent-danger)" : "var(--txt-muted)" }}>
                                            {source.enabled ? "启用" : "已停用"}
                                            {source.last_scan_status ? ` · ${source.last_scan_status}` : ""}
                                            {source.last_error ? ` · ${source.last_error}` : ""}
                                          </p>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                          <button
                                            type="button"
                                            onClick={() => void handleToggleSource(row, source)}
                                            disabled={Boolean(sourceBusyId)}
                                            className="px-2 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50 cursor-pointer"
                                            style={source.enabled
                                              ? { background: "rgba(245,158,11,0.14)", color: "var(--accent-warn)", border: "1px solid rgba(245,158,11,0.3)" }
                                              : { background: "rgba(34,197,94,0.14)", color: "var(--accent-ok)", border: "1px solid rgba(34,197,94,0.3)" }}
                                          >
                                            {source.enabled ? "停用" : "启用"}
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => void handleScanSource(row, source)}
                                            disabled={Boolean(sourceBusyId)}
                                            className="px-3 py-1.5 rounded-lg text-[9px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center justify-center gap-1 cursor-pointer"
                                          >
                                            <RefreshCw className={`w-3 h-3 ${busy ? "animate-spin" : ""}`} />
                                            扫描
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => void handleDeleteSource(row, source)}
                                            disabled={Boolean(sourceBusyId)}
                                            className="p-1.5 rounded-lg disabled:opacity-50 cursor-pointer"
                                            style={{ color: "var(--accent-danger)", border: "1px solid rgba(239,68,68,0.3)" }}
                                            title="删除补缺源"
                                          >
                                            <Trash2 className={`w-3.5 h-3.5 ${sourceActionBusy && !busy ? "animate-pulse" : ""}`} />
                                          </button>
                                        </div>
                                      </div>
                                      <SubscriptionSourceFileSelector
                                        subscriptionId={row.subscription.id}
                                        subscriptionTitle={row.subscription.title}
                                        source={source}
                                        disabled={Boolean(sourceBusyId)}
                                        addLog={addLog}
                                        onSourceUpdated={(updated) => handleSourceUpdated(row.subscription.id, updated)}
                                        onRefresh={() => loadSources(row.subscription.id)}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            <div className="grid grid-cols-1 md:grid-cols-[1fr_110px_auto] gap-2">
                              <input
                                type="text"
                                placeholder="115 分享补缺链接"
                                value={draft.url}
                                onChange={(event) => updateDraft(row.subscription.id, { url: event.target.value })}
                                className="w-full rounded-xl px-3 py-2 text-xs font-bold outline-none"
                                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
                              />
                              <input
                                type="text"
                                placeholder="提取码"
                                value={draft.code}
                                onChange={(event) => updateDraft(row.subscription.id, { code: event.target.value })}
                                className="w-full rounded-xl px-3 py-2 text-xs font-bold outline-none"
                                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
                              />
                              <button
                                type="button"
                                onClick={() => void handleAddSource(row)}
                                disabled={sourceBusyId === row.subscription.id || !draft.url.trim()}
                                className="px-4 py-2 rounded-xl text-xs font-black bg-brand-primary text-white disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                添加
                              </button>
                            </div>
                          </div>
                        )}

                        {channel === "pt" && (
                          <div className="rounded-2xl p-4 space-y-3" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                              <div>
                                <h3 className="text-xs font-black flex items-center gap-1.5" style={{ color: "var(--txt)" }}>
                                  <Search className="w-3.5 h-3.5 text-brand-primary" />
                                  <span>MoviePilot 缺集补齐</span>
                                </h3>
                                <p className="text-[10px] font-semibold mt-0.5" style={{ color: "var(--txt-muted)" }}>
                                  只自动推送明确匹配的单集资源；季包、全集包、多集包和模糊结果保留为人工确认。
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void handleMoviePilotPreview(row)}
                                  disabled={completionBusyId === row.subscription.id}
                                  className="px-3 py-1.5 rounded-lg text-[9px] font-black glass-hover disabled:opacity-50 cursor-pointer"
                                  style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
                                >
                                  预览
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleMoviePilotRun(row)}
                                  disabled={completionBusyId === row.subscription.id || missing === 0}
                                  className="px-3 py-1.5 rounded-lg text-[9px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1 cursor-pointer"
                                >
                                  <Download className="w-3 h-3" />
                                  {completionBusyId === row.subscription.id ? "处理中" : "补缺"}
                                </button>
                              </div>
                            </div>

                            {preview ? (
                              <div className="space-y-3">
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                  {[
                                    ["可推送", completionCount(preview, "auto_push"), "var(--accent-ok)"],
                                    ["需确认", completionCount(preview, "ambiguous"), "var(--accent-warn)"],
                                    ["无匹配", completionCount(preview, "no_match"), "var(--txt-muted)"],
                                    ["已处理", completionCount(preview, "processed"), "var(--brand-primary)"],
                                  ].map(([label, value, color]) => (
                                    <div key={String(label)} className="rounded-xl px-3 py-2" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                                      <div className="text-[9px] font-black" style={{ color: "var(--txt-muted)" }}>{label}</div>
                                      <div className="text-base font-black" style={{ color: String(color) }}>{String(value)}</div>
                                    </div>
                                  ))}
                                </div>
                                {(preview.auto_push || []).slice(0, 5).length > 0 && (
                                  <div className="space-y-1.5">
                                    {(preview.auto_push || []).slice(0, 5).map((candidate, index) => (
                                      <div key={`${candidate.season_number}-${candidate.episode_number}-${index}`} className="rounded-lg px-3 py-2" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                                        <p className="text-[10px] font-black truncate" style={{ color: "var(--txt)" }}>
                                          S{candidate.season_number}E{candidate.episode_number} · {candidate.resource_title || candidate.title || "可推送资源"}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" }}>
                                先预览可确认 MoviePilot 搜索结果和自动推送范围。
                              </p>
                            )}
                          </div>
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
  );
}
