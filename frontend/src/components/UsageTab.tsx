/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * UsageTab — 用量/统计页（已主题化）
 *
 * 数据来源（全部来自真实后端）：
 *   - GET /api/subscriptions    → 订阅总数/按类型分布/活跃数
 *   - GET /api/archive/tasks    → 归档任务总数/按状态分布
 *   - GET /api/scheduler/tasks  → 调度任务总数/启停分布
 *   - GET /api/logs?limit=1     → 操作日志总条数
 */

import React, { useState, useEffect, useCallback } from "react";
import { SyncDirectory } from "../types";
import { subscriptionApi, archiveApi, schedulerApi, logsApi } from "../api";
import { LOG_TOTAL_LIST_PARAMS } from "../utils/runtimeDefaults";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Rss, Archive, Clock, FileText, HardDrive, Activity, AlertCircle, FolderOpen, RefreshCw } from "lucide-react";

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

const ARCHIVE_STATUS_LABEL: Record<string, string> = {
  processing: "进行中", success: "已完成", failed: "失败", pending: "等待中", skipped: "已跳过",
};

function formatStatusLabel(status: string): string {
  return ARCHIVE_STATUS_LABEL[status] ?? status;
}

export default function UsageTab({ directories }: UsageTabProps) {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [subsRes, archiveTasksRes, schedulerRes, logsRes] = await Promise.all([
        subscriptionApi.list().catch(() => ({ data: [] as unknown[] })),
        archiveApi.listTasks().catch(() => ({ data: [] as unknown[] })),
        schedulerApi.listTasks().catch(() => ({ data: [] as unknown[] })),
        logsApi.list(LOG_TOTAL_LIST_PARAMS).catch(() => ({ data: { total: 0 } })),
      ]);
      const subs = Array.isArray(subsRes.data) ? subsRes.data : [];
      const archTasks = Array.isArray(archiveTasksRes.data) ? archiveTasksRes.data : [];
      const schedTasks = Array.isArray(schedulerRes.data) ? schedulerRes.data : [];
      const totalSubscriptions = subs.length;
      const activeSubscriptions = subs.filter((s: Record<string, unknown>) => s.is_active).length;
      const subsByType = [
        { name: "电影", count: subs.filter((s: Record<string, unknown>) => s.media_type === "movie").length },
        { name: "剧集", count: subs.filter((s: Record<string, unknown>) => s.media_type === "tv").length },
        { name: "合集", count: subs.filter((s: Record<string, unknown>) => s.media_type === "collection").length },
      ].filter(g => g.count > 0);
      const statusMap: Record<string, number> = {};
      for (const t of archTasks) {
        const s = formatStatusLabel((t as Record<string, string>).status || "unknown");
        statusMap[s] = (statusMap[s] || 0) + 1;
      }
      const archiveTasksByStatus = Object.entries(statusMap).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
      const enabledSchedulerTasks = schedTasks.filter((t: Record<string, unknown>) => t.enabled).length;
      setStats({ totalSubscriptions, activeSubscriptions, subsByType, archiveTasksByStatus, totalArchiveTasks: archTasks.length, totalSchedulerTasks: schedTasks.length, enabledSchedulerTasks, totalLogs: (logsRes.data as Record<string, unknown>)?.total as number || 0 });
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  if (loading) return (
    <div className="flex items-center justify-center h-80">
      <div className="flex flex-col items-center gap-3" style={{ color: "var(--txt-muted)" }}>
        <Activity className="w-8 h-8 animate-pulse" />
        <span className="text-sm font-bold">加载用量统计中...</span>
      </div>
    </div>
  );
  if (error) return (
    <div className="flex items-center justify-center h-80">
      <div className="flex flex-col items-center gap-3" style={{ color: "var(--accent-danger)" }}>
        <AlertCircle className="w-8 h-8" />
        <span className="text-sm font-bold">{error}</span>
        <button onClick={() => loadStats()} className="px-4 py-2 text-xs font-bold rounded-lg glass-hover flex items-center gap-1.5" style={{ color: "var(--brand-primary)", background: "var(--surface-subtle)" }}>
          <RefreshCw className="w-3.5 h-3.5" />
          重试
        </button>
      </div>
    </div>
  );
  if (!stats) return (
    <div className="flex items-center justify-center h-80">
      <div className="flex flex-col items-center gap-3" style={{ color: "var(--txt-muted)" }}>
        <FolderOpen className="w-10 h-10" />
        <span className="text-sm font-bold">暂无用量数据</span>
        <span className="text-xs" style={{ color: "var(--txt-muted)" }}>后端尚未返回任何统计信息，请确认服务已启动</span>
      </div>
    </div>
  );

  // Chart colors
  const chartTickColor = "var(--txt-muted)";
  const chartTextStyle = { fill: "var(--txt-muted)", fontSize: 11, fontWeight: 600 } as const;

  return (
    <div className="space-y-8">
      {/* Title */}
      <div className="glass-heavy rounded-3xl p-6">
        <h2 className="text-2xl font-black tracking-tight flex items-center gap-2.5" style={{ color: "var(--txt)" }}>
          <Activity className="w-6 h-6" style={{ color: "var(--brand-primary)" }} />
          数据统计与用量总览
        </h2>
        <p className="text-xs mt-1 max-w-xl leading-relaxed" style={{ color: "var(--txt-secondary)" }}>
          订阅、归档、调度与操作日志的全局统计视图。
        </p>
      </div>

      {/* Stat cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {([
          { key: "subs", icon: <Rss className="w-5 h-5" />, label: "订阅", value: stats.totalSubscriptions, sub: `活跃 ${stats.activeSubscriptions} / 总计 ${stats.totalSubscriptions}` },
          { key: "archive", icon: <Archive className="w-5 h-5" />, label: "归档任务", value: stats.totalArchiveTasks, sub: stats.archiveTasksByStatus.length > 0 ? stats.archiveTasksByStatus.slice(0, 2).map(s => `${s.name} ${s.count}`).join(" · ") : "暂无任务" },
          { key: "sched", icon: <Clock className="w-5 h-5" />, label: "调度任务", value: stats.totalSchedulerTasks, sub: `启用 ${stats.enabledSchedulerTasks} / 总计 ${stats.totalSchedulerTasks}` },
          { key: "logs", icon: <FileText className="w-5 h-5" />, label: "操作日志", value: stats.totalLogs.toLocaleString(), sub: "系统操作日志总条数" },
        ]).map(card => (
          <div key={card.key} className="glass glass-hover rounded-2xl p-5 transition-all">
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
        <div className="glass rounded-2xl p-6">
          <h3 className="font-headline text-lg font-black mb-1" style={{ color: "var(--txt)" }}>订阅类型分布</h3>
          <p className="text-xs mb-4" style={{ color: "var(--txt-muted)" }}>按媒体类型统计</p>
          {stats.subsByType.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.subsByType} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barSize={32}>
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={chartTextStyle} />
                  <YAxis tickLine={false} axisLine={false} tick={chartTextStyle} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "rgba(139,92,246,0.06)" }} contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--txt)", fontSize: 12, fontWeight: 600 }} />
                  <Bar dataKey="count" name="订阅数" fill="var(--brand-primary)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-sm" style={{ color: "var(--txt-muted)" }}>暂无订阅数据</div>
          )}
        </div>

        <div className="glass rounded-2xl p-6">
          <h3 className="font-headline text-lg font-black mb-1" style={{ color: "var(--txt)" }}>归档任务状态分布</h3>
          <p className="text-xs mb-4" style={{ color: "var(--txt-muted)" }}>按任务状态统计</p>
          {stats.archiveTasksByStatus.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.archiveTasksByStatus} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barSize={32}>
                  <XAxis dataKey="name" tickLine={false} axisLine={false} tick={chartTextStyle} />
                  <YAxis tickLine={false} axisLine={false} tick={chartTextStyle} allowDecimals={false} />
                  <Tooltip cursor={{ fill: "rgba(139,92,246,0.06)" }} contentStyle={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--txt)", fontSize: 12, fontWeight: 600 }} />
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
          目录数据来自 115 网盘 archive/folders 接口。容量与文件项数后端未提供，显示"暂无"。
        </p>
        {directories.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {directories.map(dir => {
              const statusStyle = dir.status === "syncing" ? { bg: "rgba(139,92,246,0.14)", color: "var(--brand-primary)" }
                : dir.status === "error" ? { bg: "rgba(239,68,68,0.12)", color: "var(--accent-danger)" }
                : { bg: "var(--surface-subtle)", color: "var(--txt-muted)" };
              return (
                <div key={dir.id} className="glass glass-hover rounded-2xl p-5 transition-all">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "var(--surface-subtle)", color: "var(--txt-muted)" }}>
                      <HardDrive className="w-5 h-5" />
                    </div>
                    <span className="text-xs font-black px-2 py-0.5 rounded-full" style={{ background: statusStyle.bg, color: statusStyle.color }}>
                      {dir.status === "syncing" ? "同步中" : dir.status === "scanning" ? "扫描中" : dir.status === "error" ? "异常" : "空闲"}
                    </span>
                  </div>
                  <h4 className="font-headline text-base font-black truncate" style={{ color: "var(--txt)" }}>{dir.name}</h4>
                  <p className="text-xs mt-0.5 truncate" style={{ color: "var(--txt-muted)" }}>CID: {dir.folderId115}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                    <div><span style={{ color: "var(--txt-muted)" }}>容量</span><p className="font-bold mt-0.5" style={{ color: "var(--txt)" }}>{dir.totalSize !== "-" ? dir.totalSize : "暂无"}</p></div>
                    <div><span style={{ color: "var(--txt-muted)" }}>文件项数</span><p className="font-bold mt-0.5" style={{ color: "var(--txt)" }}>{dir.itemCount > 0 ? dir.itemCount : "暂无"}</p></div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center h-32 rounded-2xl" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
            <span className="text-sm" style={{ color: "var(--txt-muted)" }}>暂无归档目录，请先配置 archive</span>
          </div>
        )}
      </section>
    </div>
  );
}
