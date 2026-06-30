/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * UsageTab — 用量/统计页（已主题化）
 *
 * 数据来源（全部来自真实后端）：
 *   - GET /api/subscriptions?scope=all → 订阅总数/按类型分布/活跃数
 *   - GET /api/archive/tasks           → 归档任务总数/按状态分布
 *   - GET /api/scheduler/tasks         → 自定义调度任务总数/启停分布
 *   - GET /api/logs?limit=1     → 操作日志总条数
 */

import React, { useState, useEffect, useCallback } from "react";
import { SyncDirectory } from "../types";
import { subscriptionApi, archiveApi, schedulerApi, logsApi } from "../api";
import { getApiErrorMessage } from "../api/errors";
import type { ArchiveConfig, ArchiveTask, PaginatedList, SchedulerTask, SubscriptionItem } from "../api/types";
import { LOG_TOTAL_LIST_PARAMS } from "../utils/runtimeDefaults";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Rss, Archive, Clock, FileText, HardDrive, Activity, AlertCircle, FolderOpen, RefreshCw } from "lucide-react";
import ErrorBanner from "./ui/ErrorBanner";
import EmptyState from "./ui/EmptyState";

interface UsageTabProps { directories: SyncDirectory[]; }

interface UsageStats {
  totalSubscriptions: number;
  activeSubscriptions: number;
  subsByType: { name: string; count: number }[];
  archiveTasksByStatus: { name: string; count: number }[];
  totalArchiveTasks: number;
  totalSchedulerTasks: number;
  enabledSchedulerTasks: number;
  totalLogs: number;
}

interface ArchiveDirectorySummary {
  id: string;
  name: string;
  folderId115: string;
  role: string;
  status: SyncDirectory["status"];
  enabled: boolean;
  totalSize: string;
  itemCount: number;
}

const ARCHIVE_STATUS_LABEL: Record<string, string> = {
  processing: "进行中", success: "已完成", failed: "失败", pending: "等待中", skipped: "已跳过",
};

const ARCHIVE_STATUS_KEYS = ["processing", "success", "failed", "pending", "skipped"] as const;

function formatStatusLabel(status: string): string {
  return ARCHIVE_STATUS_LABEL[status] ?? status;
}

function buildArchiveDirectories(config: ArchiveConfig | null, fallback: SyncDirectory[], hasActiveTask: boolean): ArchiveDirectorySummary[] {
  if (!config) {
    return fallback.map((dir) => ({
      id: dir.id,
      name: dir.name,
      folderId115: dir.folderId115,
      role: "归档目录",
      status: dir.status,
      enabled: dir.enabled,
      totalSize: dir.totalSize,
      itemCount: dir.itemCount,
    }));
  }

  const enabled = Boolean(config.archive_enabled);
  const watchCid = String(config.archive_watch_cid || "").trim();
  const watchName = String(config.archive_watch_name || "").trim();
  const outputCid = String(config.archive_output_cid || "").trim();
  const outputName = String(config.archive_output_name || "").trim();
  const seen = new Set<string>();
  const items: ArchiveDirectorySummary[] = [];

  const pushDir = (cid: string, name: string, role: string, status: SyncDirectory["status"]) => {
    if (!cid || seen.has(cid)) return;
    seen.add(cid);
    items.push({
      id: `${role}-${cid}`,
      name: name || `115 目录 ${cid}`,
      folderId115: cid,
      role,
      status,
      enabled,
      totalSize: "-",
      itemCount: 0,
    });
  };

  pushDir(watchCid, watchName, "监听目录", hasActiveTask ? "syncing" : "idle");
  pushDir(outputCid, outputName, "输出目录", "idle");

  return items;
}

export default function UsageTab({ directories }: UsageTabProps) {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [archiveDirectories, setArchiveDirectories] = useState<ArchiveDirectorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true); setError(null);
    const loadWarnings: string[] = [];
    const capture = async <T,>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch (err: unknown) {
        loadWarnings.push(`${label}: ${getApiErrorMessage(err)}`);
        return fallback;
      }
    };

    try {
      const [subs, archiveTaskPage, schedulerTasks, logsTotal, archiveConfig] = await Promise.all([
        capture<SubscriptionItem[]>("订阅列表", async () => {
          const res = await subscriptionApi.list({ scope: "all" });
          return Array.isArray(res.data) ? res.data : [];
        }, []),
        capture<PaginatedList<ArchiveTask>>("归档任务总数", async () => {
          const res = await archiveApi.listTasksPage({ limit: 1, offset: 0 });
          return res.data;
        }, { items: [], total: 0, limit: 1, offset: 0 }),
        capture<SchedulerTask[]>("定时任务", async () => {
          const res = await schedulerApi.listTasks();
          return Array.isArray(res.data) ? res.data : [];
        }, []),
        capture("操作日志总数", async () => {
          const res = await logsApi.list(LOG_TOTAL_LIST_PARAMS);
          return Number(res.data.total || 0);
        }, 0),
        capture<ArchiveConfig | null>("归档目录配置", async () => {
          const res = await archiveApi.getConfig();
          return res.data;
        }, null),
      ]);

      const archiveStatusPages = await Promise.all(
        ARCHIVE_STATUS_KEYS.map(async (status) => ({
          status,
          total: await capture(`归档任务状态 ${formatStatusLabel(status)}`, async () => {
            const res = await archiveApi.listTasksPage({ status, limit: 1, offset: 0 });
            return Number(res.data.total || 0);
          }, 0),
        })),
      );

      const totalSubscriptions = subs.length;
      const activeSubscriptions = subs.filter((s) => s.is_active).length;
      const subsByType = [
        { name: "电影", count: subs.filter((s) => s.media_type === "movie").length },
        { name: "剧集", count: subs.filter((s) => s.media_type === "tv").length },
        { name: "合集", count: subs.filter((s) => s.media_type === "collection").length },
      ].filter(g => g.count > 0);
      const archiveTasksByStatus = archiveStatusPages
        .map(({ status, total }) => ({ name: formatStatusLabel(status), count: total }))
        .filter(g => g.count > 0)
        .sort((a, b) => b.count - a.count);
      const enabledSchedulerTasks = schedulerTasks.filter((t) => t.enabled).length;
      const archiveTotal = Number(archiveTaskPage.total || 0);
      const hasActiveArchiveTask = archiveStatusPages.some(({ status, total }) => status === "processing" && total > 0);
      setStats({ totalSubscriptions, activeSubscriptions, subsByType, archiveTasksByStatus, totalArchiveTasks: archiveTotal, totalSchedulerTasks: schedulerTasks.length, enabledSchedulerTasks, totalLogs: logsTotal });
      setArchiveDirectories(buildArchiveDirectories(archiveConfig, directories, hasActiveArchiveTask));
      setWarnings(loadWarnings);
      setLastLoadedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [directories]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  if (loading) return (
    <div className="liquid-page flex items-center justify-center h-80">
      <div className="glass-heavy glass-iridescent rounded-3xl p-10 flex flex-col items-center gap-3" style={{ color: "var(--txt-muted)" }}>
        <Activity className="w-8 h-8 animate-pulse" />
        <span className="text-sm font-bold">加载用量统计中...</span>
      </div>
    </div>
  );
  if (error) return (
    <div className="liquid-page flex items-center justify-center h-80">
      <div className="glass-heavy glass-iridescent rounded-3xl p-8">
        <ErrorBanner variant="block" icon={<AlertCircle className="w-8 h-8" style={{ color: "var(--accent-danger)" }} />} message={error} onRetry={() => loadStats()} />
      </div>
    </div>
  );
  if (!stats) return (
    <div className="liquid-page flex items-center justify-center h-80">
      <div className="glass-heavy glass-iridescent rounded-3xl p-8">
        <EmptyState icon={<FolderOpen className="w-10 h-10" style={{ color: "var(--txt-muted)" }} />} text="暂无用量数据" subtext="后端尚未返回任何统计信息，请确认服务已启动" />
      </div>
    </div>
  );

  // Chart colors
  const chartTextStyle = { fill: "var(--txt-muted)", fontSize: 11, fontWeight: 600 } as const;

  return (
    <div className="liquid-page space-y-8">
      {/* Title */}
      <div className="liquid-hero glass-heavy glass-iridescent glass-spotlight rounded-3xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black tracking-tight flex items-center gap-2.5" style={{ color: "var(--txt)" }}>
              <Activity className="w-6 h-6" style={{ color: "var(--brand-primary)" }} />
              数据统计与用量总览
            </h2>
            <p className="text-xs mt-1 max-w-xl leading-relaxed" style={{ color: "var(--txt-secondary)" }}>
              订阅、归档、自定义调度与操作日志的全局统计视图。
            </p>
            {lastLoadedAt && (
              <p className="text-[10px] mt-2 font-bold" style={{ color: "var(--txt-muted)" }}>
                最近刷新: {lastLoadedAt}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void loadStats()}
            disabled={loading}
            className="cursor-pointer glass glass-hover px-4 py-2.5 rounded-2xl text-xs font-black flex items-center justify-center gap-1.5 disabled:opacity-50"
            style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            <span>{loading ? "刷新中" : "刷新统计"}</span>
          </button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div
          role="alert"
          className="glass rounded-2xl p-4 text-xs font-semibold flex gap-3"
          style={{ border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.10)", color: "var(--accent-warn)" }}
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-1">
            <p className="font-black">部分统计加载失败，当前数字可能不完整。</p>
            {warnings.slice(0, 4).map((warning) => (
              <p key={warning} className="truncate">{warning}</p>
            ))}
            {warnings.length > 4 && <p>还有 {warnings.length - 4} 项加载失败。</p>}
          </div>
        </div>
      )}

      {/* Stat cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {([
          { key: "subs", icon: <Rss className="w-5 h-5" />, label: "订阅", value: stats.totalSubscriptions, sub: `活跃 ${stats.activeSubscriptions} / 总计 ${stats.totalSubscriptions}` },
          { key: "archive", icon: <Archive className="w-5 h-5" />, label: "归档任务", value: stats.totalArchiveTasks, sub: stats.archiveTasksByStatus.length > 0 ? stats.archiveTasksByStatus.slice(0, 2).map(s => `${s.name} ${s.count}`).join(" · ") : "暂无任务" },
          { key: "sched", icon: <Clock className="w-5 h-5" />, label: "自定义调度", value: stats.totalSchedulerTasks, sub: `启用 ${stats.enabledSchedulerTasks} / 总计 ${stats.totalSchedulerTasks}` },
          { key: "logs", icon: <FileText className="w-5 h-5" />, label: "操作日志", value: stats.totalLogs.toLocaleString(), sub: "系统操作日志总条数" },
        ]).map(card => (
          <div key={card.key} className="liquid-stat-card glass glass-hover rounded-2xl p-5 transition-all">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--surface-subtle)", color: "var(--brand-primary)" }}>
                {card.icon}
              </div>
              <span className="text-xs font-black tracking-wider uppercase" style={{ color: "var(--txt-muted)" }}>{card.label}</span>
            </div>
            <p className="font-headline text-3xl font-black" style={{ color: "var(--txt)" }}>{card.value}</p>
            <p className="text-xs mt-1" style={{ color: "var(--txt-muted)" }}>{card.sub}</p>
          </div>
        ))}
      </section>

      {/* Charts */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="liquid-chart-card glass rounded-2xl p-6">
          <h3 className="font-headline text-lg font-black mb-1" style={{ color: "var(--txt)" }}>订阅类型分布</h3>
          <p className="text-xs mb-4" style={{ color: "var(--txt-muted)" }}>按媒体类型统计</p>
          {stats.subsByType.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.subsByType} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barSize={32}>
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={chartTextStyle} />
                  <YAxis tickLine={false} axisLine={false} tick={chartTextStyle} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "var(--brand-primary-bg-alpha)" }} contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--txt)", fontSize: 12, fontWeight: 600 }} />
                  <Bar dataKey="count" name="订阅数" fill="var(--brand-primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-sm" style={{ color: "var(--txt-muted)" }}>暂无订阅数据</div>
          )}
        </div>

        <div className="liquid-chart-card glass rounded-2xl p-6">
          <h3 className="font-headline text-lg font-black mb-1" style={{ color: "var(--txt)" }}>归档任务状态分布</h3>
          <p className="text-xs mb-4" style={{ color: "var(--txt-muted)" }}>按任务状态统计</p>
          {stats.archiveTasksByStatus.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.archiveTasksByStatus} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barSize={32}>
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={chartTextStyle} />
                  <YAxis tickLine={false} axisLine={false} tick={chartTextStyle} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "var(--brand-primary-bg-alpha)" }} contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--txt)", fontSize: 12, fontWeight: 600 }} />
                  <Bar dataKey="count" name="任务数" fill="var(--brand-secondary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-sm" style={{ color: "var(--txt-muted)" }}>暂无归档任务</div>
          )}
        </div>
      </section>

      {/* Directory overview */}
      <section className="space-y-4">
        <h3 className="font-headline text-xl font-black" style={{ color: "var(--txt)" }}>归档目录一览</h3>
        <p className="text-xs" style={{ color: "var(--txt-muted)" }}>
          目录数据来自当前归档配置。容量与文件项数后端未提供，显示“未提供”。
        </p>
        {archiveDirectories.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {archiveDirectories.map(dir => {
              const statusStyle = dir.status === "syncing" ? { bg: "var(--brand-primary-bg-alpha-heavy)", color: "var(--brand-primary)" }
                : dir.status === "error" ? { bg: "rgba(239,68,68,0.12)", color: "var(--accent-danger)" }
                : { bg: "var(--surface-subtle)", color: "var(--txt-muted)" };
              return (
                <div key={dir.id} className="liquid-card glass glass-hover rounded-2xl p-5 transition-all">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--surface-subtle)", color: "var(--txt-muted)" }}>
                      <HardDrive className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-black px-2 py-0.5 rounded-full" style={{ background: statusStyle.bg, color: statusStyle.color }}>
                      {dir.status === "syncing" ? "同步中" : dir.status === "scanning" ? "扫描中" : dir.status === "error" ? "异常" : "空闲"}
                    </span>
                  </div>
                  <div className="text-[10px] font-black mb-1" style={{ color: dir.enabled ? "var(--brand-primary)" : "var(--txt-muted)" }}>
                    {dir.role} · {dir.enabled ? "已启用" : "未启用"}
                  </div>
                  <h4 className="font-headline text-base font-black truncate" style={{ color: "var(--txt)" }}>{dir.name}</h4>
                  <p className="text-xs mt-0.5 truncate" style={{ color: "var(--txt-muted)" }}>CID: {dir.folderId115}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div><span style={{ color: "var(--txt-muted)" }}>容量</span><p className="font-bold mt-0.5" style={{ color: "var(--txt)" }}>{dir.totalSize !== "-" ? dir.totalSize : "未提供"}</p></div>
                    <div><span style={{ color: "var(--txt-muted)" }}>文件项数</span><p className="font-bold mt-0.5" style={{ color: "var(--txt)" }}>{dir.itemCount > 0 ? dir.itemCount : "未提供"}</p></div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="liquid-panel glass flex items-center justify-center h-32 rounded-2xl" style={{ border: "1px solid var(--border)" }}>
            <span className="text-sm" style={{ color: "var(--txt-muted)" }}>暂无归档目录，请先配置归档监听目录</span>
          </div>
        )}
      </section>
    </div>
  );
}
