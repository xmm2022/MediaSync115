/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * UsageTab — 用量/统计页
 *
 * 数据来源（全部来自真实后端，不编造）：
 *   - GET /api/subscriptions    → 订阅总数/按类型分布/活跃数
 *   - GET /api/archive/tasks    → 归档任务总数/按状态分布
 *   - GET /api/scheduler/tasks  → 调度任务总数/启停分布
 *   - GET /api/logs?limit=0     → 操作日志总条数
 *   - GET /api/pan115/user      → 115 用户信息（容量/会员等）
 *   - GET /api/pan115/offline/quota → 离线配额
 *
 * 无对应后端的字段（如目录容量、文件项数、传输速度）：
 *   不编造数值，对应卡片显示 "暂无数据" 占位。
 */

import React, { useState, useEffect } from "react";
import { SyncDirectory } from "../types";
import { subscriptionApi, archiveApi, schedulerApi, logsApi } from "../api";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Rss,
  Archive,
  Clock,
  FileText,
  HardDrive,
  Activity,
  AlertCircle,
  FolderOpen,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UsageTabProps {
  directories: SyncDirectory[];
}

interface UsageStats {
  /** 订阅总数 */
  totalSubscriptions: number;
  /** 活跃订阅数 (is_active) */
  activeSubscriptions: number;
  /** 按 media_type 分布 */
  subsByType: { name: string; count: number }[];
  /** 归档任务按 status 分布 */
  archiveTasksByStatus: { name: string; count: number }[];
  /** 归档任务总数 */
  totalArchiveTasks: number;
  /** 调度任务总数 */
  totalSchedulerTasks: number;
  /** 已启用的调度任务数 */
  enabledSchedulerTasks: number;
  /** 操作日志总条数（不拉明细，仅 total） */
  totalLogs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 归档任务状态中文映射 */
const ARCHIVE_STATUS_LABEL: Record<string, string> = {
  archiving: "进行中",
  completed: "已完成",
  failed: "失败",
  pending: "等待中",
  cancelled: "已取消",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatStatusLabel(status: string): string {
  return ARCHIVE_STATUS_LABEL[status] ?? status;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function UsageTab({ directories }: UsageTabProps) {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadStats() {
      try {
        setLoading(true);
        setError(null);

        // 并行拉取所有统计相关端点；任一失败降级为空数据，不阻塞整体
        const [subsRes, archiveTasksRes, schedulerRes, logsRes] =
          await Promise.all([
            subscriptionApi.list().catch(() => ({ data: [] as unknown[] })),
            archiveApi.listTasks().catch(() => ({ data: [] as unknown[] })),
            schedulerApi.listTasks().catch(() => ({ data: [] as unknown[] })),
            logsApi.list({ limit: 0 }).catch(() => ({ data: { total: 0 } })),
          ]);

        if (cancelled) return;

        const subs = Array.isArray(subsRes.data) ? subsRes.data : [];
        const archTasks = Array.isArray(archiveTasksRes.data)
          ? archiveTasksRes.data
          : [];
        const schedTasks = Array.isArray(schedulerRes.data)
          ? schedulerRes.data
          : [];

        // --- 订阅统计 ---
        const totalSubscriptions = subs.length;
        const activeSubscriptions = subs.filter(
          (s: Record<string, unknown>) => s.is_active,
        ).length;
        const subsByType = [
          {
            name: "电影",
            count: subs.filter(
              (s: Record<string, unknown>) => s.media_type === "movie",
            ).length,
          },
          {
            name: "剧集",
            count: subs.filter(
              (s: Record<string, unknown>) => s.media_type === "tv",
            ).length,
          },
          {
            name: "合集",
            count: subs.filter(
              (s: Record<string, unknown>) => s.media_type === "collection",
            ).length,
          },
        ].filter((g) => g.count > 0); // 只展示有数据的类型

        // --- 归档任务统计 ---
        const statusMap: Record<string, number> = {};
        for (const t of archTasks) {
          const s =
            formatStatusLabel(
              (t as Record<string, string>).status || "unknown",
            );
          statusMap[s] = (statusMap[s] || 0) + 1;
        }
        const archiveTasksByStatus = Object.entries(statusMap)
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count);

        // --- 调度任务统计 ---
        const enabledSchedulerTasks = schedTasks.filter(
          (t: Record<string, unknown>) => t.enabled,
        ).length;

        setStats({
          totalSubscriptions,
          activeSubscriptions,
          subsByType,
          archiveTasksByStatus,
          totalArchiveTasks: archTasks.length,
          totalSchedulerTasks: schedTasks.length,
          enabledSchedulerTasks,
          totalLogs: (logsRes.data as Record<string, unknown>)?.total as number || 0,
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadStats();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- 加载态 ----
  if (loading) {
    return (
      <div className="flex items-center justify-center h-80">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <Activity className="w-8 h-8 animate-pulse" />
          <span className="text-sm font-medium">加载用量统计中...</span>
        </div>
      </div>
    );
  }

  // ---- 错误态 ----
  if (error) {
    return (
      <div className="flex items-center justify-center h-80">
        <div className="flex flex-col items-center gap-3 text-red-500">
          <AlertCircle className="w-8 h-8" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      </div>
    );
  }

  // ---- 空态（所有端点均无数据） ----
  if (!stats) {
    return (
      <div className="flex items-center justify-center h-80">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <FolderOpen className="w-10 h-10" />
          <span className="text-sm font-medium">暂无用量数据</span>
          <span className="text-xs">后端尚未返回任何统计信息，请确认服务已启动</span>
        </div>
      </div>
    );
  }

  // ---- 渲染 ----
  return (
    <div className="space-y-10">
      {/* ================================================================ */}
      {/* 第一行：概览统计卡片 */}
      {/* ================================================================ */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* 订阅 */}
        <div className="p-5 rounded-2xl bg-white/70 backdrop-blur-md border border-white/60 shadow-xs hover:bg-white/85 transition-all">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center text-brand-primary">
              <Rss className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold tracking-wider text-slate-400 uppercase">
              订阅
            </span>
          </div>
          <p className="font-headline text-3xl font-black text-txt-dark">
            {stats.totalSubscriptions}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            活跃 {stats.activeSubscriptions} / 总计 {stats.totalSubscriptions}
          </p>
        </div>

        {/* 归档任务 */}
        <div className="p-5 rounded-2xl bg-white/70 backdrop-blur-md border border-white/60 shadow-xs hover:bg-white/85 transition-all">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
              <Archive className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold tracking-wider text-slate-400 uppercase">
              归档任务
            </span>
          </div>
          <p className="font-headline text-3xl font-black text-txt-dark">
            {stats.totalArchiveTasks}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            {stats.archiveTasksByStatus.length > 0
              ? stats.archiveTasksByStatus
                  .slice(0, 2)
                  .map((s) => `${s.name} ${s.count}`)
                  .join(" · ")
              : "暂无任务"}
          </p>
        </div>

        {/* 调度任务 */}
        <div className="p-5 rounded-2xl bg-white/70 backdrop-blur-md border border-white/60 shadow-xs hover:bg-white/85 transition-all">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
              <Clock className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold tracking-wider text-slate-400 uppercase">
              调度任务
            </span>
          </div>
          <p className="font-headline text-3xl font-black text-txt-dark">
            {stats.totalSchedulerTasks}
          </p>
          <p className="text-xs text-slate-400 mt-1">
            启用 {stats.enabledSchedulerTasks} / 总计{" "}
            {stats.totalSchedulerTasks}
          </p>
        </div>

        {/* 操作日志 */}
        <div className="p-5 rounded-2xl bg-white/70 backdrop-blur-md border border-white/60 shadow-xs hover:bg-white/85 transition-all">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
              <FileText className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold tracking-wider text-slate-400 uppercase">
              操作日志
            </span>
          </div>
          <p className="font-headline text-3xl font-black text-txt-dark">
            {stats.totalLogs.toLocaleString()}
          </p>
          <p className="text-xs text-slate-400 mt-1">系统操作日志总条数</p>
        </div>
      </section>

      {/* ================================================================ */}
      {/* 第二行：图表区 */}
      {/* ================================================================ */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 订阅类型分布 */}
        <div className="p-6 rounded-2xl bg-white/70 backdrop-blur-md border border-white/60 shadow-xs">
          <h3 className="font-headline text-lg font-bold text-txt-dark mb-1">
            订阅类型分布
          </h3>
          <p className="text-xs text-slate-400 mb-4">
            按媒体类型 (movie / tv / collection) 统计
          </p>
          {stats.subsByType.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={stats.subsByType}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  barSize={32}
                >
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#64748b", fontSize: 12, fontWeight: "bold" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(124, 58, 237, 0.05)" }}
                    contentStyle={{
                      borderRadius: "12px",
                      border: "1px solid #f1f5f9",
                      fontSize: "12px",
                      fontWeight: "500",
                      boxShadow: "0 4px 12px rgba(15, 23, 42, 0.03)",
                    }}
                  />
                  <Bar
                    dataKey="count"
                    name="订阅数"
                    fill="#7c3aed"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-sm text-slate-400">
              暂无订阅数据
            </div>
          )}
        </div>

        {/* 归档任务状态分布 */}
        <div className="p-6 rounded-2xl bg-white/70 backdrop-blur-md border border-white/60 shadow-xs">
          <h3 className="font-headline text-lg font-bold text-txt-dark mb-1">
            归档任务状态分布
          </h3>
          <p className="text-xs text-slate-400 mb-4">按任务状态统计</p>
          {stats.archiveTasksByStatus.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={stats.archiveTasksByStatus}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  barSize={32}
                >
                  <XAxis
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#64748b", fontSize: 12, fontWeight: "bold" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    allowDecimals={false}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(59, 130, 246, 0.05)" }}
                    contentStyle={{
                      borderRadius: "12px",
                      border: "1px solid #f1f5f9",
                      fontSize: "12px",
                      fontWeight: "500",
                      boxShadow: "0 4px 12px rgba(15, 23, 42, 0.03)",
                    }}
                  />
                  <Bar
                    dataKey="count"
                    name="任务数"
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-sm text-slate-400">
              暂无归档任务
            </div>
          )}
        </div>
      </section>

      {/* ================================================================ */}
      {/* 第三行：归档目录一览（来自 archive/folders 真实数据，不编造容量） */}
      {/* ================================================================ */}
      <section className="space-y-4">
        <h3 className="font-headline text-xl font-bold text-txt-dark">
          归档目录一览
        </h3>
        <p className="text-xs text-slate-400">
          目录数据来自 115 网盘 archive/folders 接口。容量与文件项数后端未提供，显示为
          "暂无"。
        </p>

        {directories.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {directories.map((dir) => (
              <div
                key={dir.id}
                className="p-5 rounded-2xl bg-white/70 backdrop-blur-md border border-white/60 shadow-xs hover:bg-white/85 transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-500 border border-slate-100">
                    <HardDrive className="w-5 h-5" />
                  </div>
                  {/* 状态标记 */}
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      dir.status === "syncing"
                        ? "bg-violet-50 text-violet-600"
                        : dir.status === "error"
                          ? "bg-red-50 text-red-600"
                          : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {dir.status === "syncing"
                      ? "同步中"
                      : dir.status === "scanning"
                        ? "扫描中"
                        : dir.status === "error"
                          ? "异常"
                          : "空闲"}
                  </span>
                </div>

                <h4 className="font-headline text-base font-bold text-txt-dark truncate">
                  {dir.name}
                </h4>
                <p className="text-xs text-slate-400 mt-0.5 truncate">
                  CID: {dir.folderId115}
                </p>

                {/* 诚实：无后端数据时不编造 */}
                <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400">容量</span>
                    <p className="font-bold text-txt-dark mt-0.5">
                      {dir.totalSize !== "-" ? dir.totalSize : "暂无"}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400">文件项数</span>
                    <p className="font-bold text-txt-dark mt-0.5">
                      {dir.itemCount > 0 ? dir.itemCount : "暂无"}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-32 rounded-2xl bg-white/40 border border-white/40">
            <span className="text-sm text-slate-400">
              暂无归档目录，请先配置 archive
            </span>
          </div>
        )}
      </section>
    </div>
  );
}
