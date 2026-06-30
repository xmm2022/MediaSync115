/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 仪表盘 — 阶段3：对接真实后端 archive API。
 *
 * 字段映射诚实原则（详见 types.ts SyncDirectory 注释）：
 *   name/folderId115/id ← ArchiveFolder (实时)
 *   status ← ArchiveTask (processing→syncing, 无任务→idle, failed→error)
 *   enabled ← ArchiveConfig.archive_enabled (全局开关)
 *   localPath ← ArchiveConfig.archive_watch_cid
 *   speed/totalSize/itemCount ← 后端无对应字段，显示 "-"/0
 *   targetClient ← 后端仅支持 emby/feiniu，下拉只展示这两种
 *
 * 操作映射：
 *   "全量扫库"    → archiveApi.runScan (最接近全量同步；也可扩展 sub run / strm generate / emby sync)
 *   "toggle enabled" → archiveApi.updateConfig({ archive_enabled }) (全局开关)
 *   "添加目录" modal → archiveApi.updateConfig({ archive_watch_cid }) (后端无独立"添加同步目录"概念)
 */

import React, { useState, useEffect } from "react";
import { SyncDirectory } from "../types";
import { archiveApi, pan115Api } from "../api";
import { getApiErrorMessage } from "../api/errors";
import type { ArchiveTask } from "../api/types";
import { ACTIVE_ARCHIVE_TASK_STATUS } from "../utils/runtimeDefaults";
import {
  Zap,
  ArrowUpRight,
  HardDrive,
  CloudRain,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  PlusCircle,
  TrendingUp,
  ShieldCheck,
  HelpCircle,
  Database,
  Film,
  Tv,
  Sparkles,
  Info
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import EmptyState from "./ui/EmptyState";

interface DashboardTabProps {
  directories: SyncDirectory[];
  setDirectories: React.Dispatch<React.SetStateAction<SyncDirectory[]>>;
  onNavigateToSettings: () => void;
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => void;
}

type Pan115CookieStatus = {
  state: "checking" | "valid" | "invalid" | "error";
  message: string;
};

export default function DashboardTab({
  directories,
  setDirectories,
  onNavigateToSettings,
  addLog
}: DashboardTabProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newDirName, setNewDirName] = useState("");
  const [newLocalPath, setNewLocalPath] = useState("");
  const [newFolderId, setNewFolderId] = useState("");
  // 后端仅支持 emby/feiniu，无 plex/jellyfin
  const [newClient, setNewClient] = useState<"emby" | "feiniu">("emby");
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  // 初始加载标记：区分「还在首次加载」与「加载完成但确实无目录」，避免闪现误导性空态
  const [initialLoaded, setInitialLoaded] = useState(false);

  // 归档任务列表 — 用于派生目录状态
  const [archiveTasks, setArchiveTasks] = useState<ArchiveTask[]>([]);
  const [pan115CookieStatus, setPan115CookieStatus] = useState<Pan115CookieStatus>({
    state: "checking",
    message: "正在检查 115 Cookie",
  });

  // 挂载时拉取归档任务，周期性更新目录状态
  useEffect(() => {
    const loadTasks = async () => {
      try {
        const res = await archiveApi.listTasks({ status: ACTIVE_ARCHIVE_TASK_STATUS, limit: 50 });
        const tasks = res.data;
        if (Array.isArray(tasks)) setArchiveTasks(tasks as ArchiveTask[]);
      } catch (err) {
        console.error("Failed to load archive tasks:", err);
      } finally {
        setInitialLoaded(true);
      }
    };
    loadTasks();
  }, [directories]);

  // 添加目录模态框：Esc 关闭 + 锁定背景滚动
  useEffect(() => {
    if (!showAddModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowAddModal(false);
    };
    window.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [showAddModal]);

  useEffect(() => {
    let cancelled = false;

    const loadPan115CookieStatus = async () => {
      setPan115CookieStatus({ state: "checking", message: "正在检查 115 Cookie" });
      try {
        const res = await pan115Api.checkCookie();
        const data = res.data as Record<string, unknown>;
        if (cancelled) return;
        const valid = Boolean(data.valid || data.success || data.ok);
        setPan115CookieStatus({
          state: valid ? "valid" : "invalid",
          message: valid
            ? String(data.message || "Cookie 会话有效")
            : String(data.message || "115 Cookie 未配置或已失效"),
        });
      } catch (err) {
        if (cancelled) return;
        setPan115CookieStatus({
          state: "error",
          message: getApiErrorMessage(err, "无法检查 115 Cookie 状态"),
        });
      }
    };

    void loadPan115CookieStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  // 从全局归档任务派生目录状态：有活跃任务→syncing，否则→idle
  // 注意：后端 ArchiveTask 无 per-folder 关联，这是全局推导
  const hasActiveTask = archiveTasks.length > 0;

  // Calculate totals (honest: speed/itemCount/totalSize have no backend data)
  const activeCount = directories.filter(d => d.enabled).length;
  // 后端无实时速度字段，恒定显示 0
  const currentSpeedMB = "0";
  const totalFiles = directories.reduce((sum, d) => sum + d.itemCount, 0);
  const pan115Ready = pan115CookieStatus.state === "valid";
  const pan115Checking = pan115CookieStatus.state === "checking";
  const pan115StatusLabel = pan115Checking ? "检查中" : pan115Ready ? "已连接" : "未配置";
  const pan115StatusColor = pan115Checking
    ? "var(--accent-info)"
    : pan115Ready
      ? "var(--accent-ok)"
      : "var(--accent-danger)";
  const pan115StatusDot = pan115Checking
    ? "bg-sky-400 animate-pulse"
    : pan115Ready
      ? "bg-teal-500 animate-pulse"
      : "bg-red-500";

  // Toggle directory sync
  // 后端 archive_enabled 是全局开关，非按目录。此处切换全局归档开关。
  const toggleDir = async (id: string) => {
    const dir = directories.find(d => d.id === id);
    if (!dir) return;
    const nextEnabled = !dir.enabled;

    try {
      await archiveApi.updateConfig({ archive_enabled: nextEnabled });
      addLog(
        nextEnabled ? "INFO" : "WARN",
        `归档服务已${nextEnabled ? "启用" : "暂停"} (全局开关)。`
      );
      // 乐观更新所有目录的 enabled 状态
      setDirectories(prev => prev.map(d => ({ ...d, enabled: nextEnabled })));
    } catch (err) {
      console.error("Failed to toggle archive config:", err);
      addLog("ERROR", "更新归档配置失败: " + getApiErrorMessage(err));
    }
  };

  // Add new directory mapping
  // 后端无独立"添加同步目录"概念。此操作将更新全局归档监听目录 (archive_watch_cid)。
  // 如需完整归档配置（输出目录、调度间隔等），请前往设置页。
  const handleAddDirectory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDirName || !newFolderId) {
      alert("请填写目录名称和 115 目录 ID!");
      return;
    }

    try {
      // archive_watch_cid: 归档监听目录（115 目录 CID）
      // newLocalPath 语义应为 archive_output_cid（输出目录 CID），非本地文件系统路径
      const payload: Record<string, unknown> = {
        archive_watch_cid: newFolderId,
      };
      if (newLocalPath) {
        payload.archive_output_cid = newLocalPath;
      }
      await archiveApi.updateConfig(payload);
      addLog("SUCCESS", `归档监听目录已更新: ${newDirName} (watch_cid=${newFolderId})。前往设置页可配置完整归档参数。`);

      // 刷新目录列表
      const [foldersRes, configRes, tasksRes] = await Promise.all([
        archiveApi.listFolders("0"),
        archiveApi.getConfig(),
        archiveApi.listTasks({ status: ACTIVE_ARCHIVE_TASK_STATUS, limit: 50 }).catch(() => ({ data: [] })),
      ]);
      const folderData = foldersRes.data;
      const configData = configRes.data;
      const tasksData = (tasksRes as { data: unknown }).data;
      const tasksArr: Record<string, unknown>[] = Array.isArray(tasksData) ? tasksData as Record<string, unknown>[] : [];
      const hasTask = tasksArr.length > 0;

      const dirs: SyncDirectory[] = [];
      if (Array.isArray(folderData)) {
        for (const f of folderData.slice(0, 20)) {
          dirs.push({
            id: f.cid || String((f as Record<string, string>).id || "") || `dir-${dirs.length}`,
            name: f.name || f.cid || "未知目录",
            localPath: String((configData as Record<string, string>).archive_watch_cid || ""),
            folderId115: f.cid || "",
            targetClient: "emby",
            status: hasTask ? "syncing" : "idle",
            speed: "-",
            progress: 0,
            enabled: Boolean((configData as Record<string, unknown>).archive_enabled),
            totalSize: "-",
            itemCount: 0,
          });
        }
      }
      setDirectories(dirs);
    } catch (err) {
      console.error("Failed to update archive config:", err);
      addLog("ERROR", "更新归档配置失败: " + getApiErrorMessage(err));
    }

    // Reset form
    setNewDirName("");
    setNewLocalPath("");
    setNewFolderId("");
    setNewClient("emby");
    setShowAddModal(false);
  };

  // Run full scan trigger
  // 映射到 archiveApi.runScan（最接近"全量同步"）。
  // 可选扩展：POST /api/subscriptions/system/run（订阅检查）
  //          POST /api/strm/generate（STRM 生成）
  //          POST /api/settings/emby/sync/run（Emby 同步）
  const triggerFullScan = async () => {
    setIsSyncingAll(true);
    try {
      await archiveApi.runScan();
      addLog("SUCCESS", "归档扫描已触发，后端正在执行全量扫描...");
      // 延迟刷新任务列表以更新状态
      setTimeout(async () => {
        try {
          const res = await archiveApi.listTasks({ status: ACTIVE_ARCHIVE_TASK_STATUS, limit: 50 });
          const tasks = res.data;
          if (Array.isArray(tasks)) setArchiveTasks(tasks as ArchiveTask[]);
        } catch { /* ignore refresh errors */ }
      }, 2000);
    } catch (err) {
      console.error("Failed to run archive scan:", err);
      addLog("ERROR", "归档扫描请求失败: " + getApiErrorMessage(err));
    } finally {
      setTimeout(() => {
        setIsSyncingAll(false);
      }, 3500);
    }
  };

  // 刷新目录列表（从 archive API 重新拉取）
  const refreshDirectories = async () => {
    try {
      const [foldersRes, configRes, tasksRes] = await Promise.all([
        archiveApi.listFolders("0"),
        archiveApi.getConfig(),
        archiveApi.listTasks({ status: ACTIVE_ARCHIVE_TASK_STATUS, limit: 50 }).catch(() => ({ data: [] })),
      ]);
      const folderData = foldersRes.data;
      const configData = configRes.data;
      const tasksData = (tasksRes as { data: unknown }).data;
      const tasksArr: Record<string, unknown>[] = Array.isArray(tasksData) ? tasksData as Record<string, unknown>[] : [];
      const hasTask = tasksArr.length > 0;

      const dirs: SyncDirectory[] = [];
      if (Array.isArray(folderData)) {
        for (const f of folderData.slice(0, 20)) {
          dirs.push({
            id: f.cid || String((f as Record<string, string>).id || "") || `dir-${dirs.length}`,
            name: f.name || f.cid || "未知目录",
            localPath: String((configData as Record<string, string>).archive_watch_cid || ""),
            folderId115: f.cid || "",
            targetClient: "emby",
            status: hasTask ? "syncing" : "idle",
            speed: "-",
            progress: 0,
            enabled: Boolean((configData as Record<string, unknown>).archive_enabled),
            totalSize: "-",
            itemCount: 0,
          });
        }
      }
      setDirectories(dirs);
      setArchiveTasks(tasksArr as ArchiveTask[]);
    } catch (err) {
      console.error("Failed to refresh directories:", err);
    }
  };

  return (
    <div className="liquid-page space-y-6 md:space-y-8">

      {/* Centerpiece: Luminous Engine Dial */}
      <section className="liquid-hero glass-heavy glass-iridescent glass-spotlight rounded-3xl p-5 sm:p-7 md:p-8 overflow-hidden">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)_minmax(0,1fr)] gap-6 xl:gap-8 items-center">
          <div className="hidden xl:block space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[10px] font-black" style={{ background: "var(--brand-primary-soft)", color: "var(--brand-primary)", border: "1px solid var(--brand-primary-border)" } as React.CSSProperties}>
              <Sparkles className="w-3.5 h-3.5" />
              实时归档中枢
            </div>
            <div>
              <h2 className="font-headline text-3xl font-black leading-tight" style={{ color: "var(--txt)" } as React.CSSProperties}>媒体库挂载引擎</h2>
              <p className="text-sm mt-2 leading-relaxed max-w-sm" style={{ color: "var(--txt-secondary)" } as React.CSSProperties}>
                聚合 115 归档目录、Cookie 会话和后端任务状态，保持主控制台高密度但可扫读。
              </p>
            </div>
          </div>

        <div className="relative mx-auto w-60 h-60 sm:w-72 sm:h-72 md:w-80 md:h-80 flex items-center justify-center">
          <div
            className="absolute inset-6 rounded-3xl opacity-45 pointer-events-none"
            style={{ background: "var(--brand-gradient-soft)" } as React.CSSProperties}
          />

          {/* Outer Ring: 115 Synced Space (Green) */}
          <svg className="absolute w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
            <circle
              className="text-brand-surface-normal"
              cx="50"
              cy="50"
              fill="transparent"
              r="44"
              stroke="currentColor"
              strokeWidth="5"
            ></circle>
            <motion.circle
              className="text-brand-primary-light"
              cx="50"
              cy="50"
              fill="transparent"
              r="44"
              stroke="currentColor"
              strokeDasharray="276.4"
              strokeDashoffset={isSyncingAll ? "30" : "65"}
              strokeLinecap="round"
              strokeWidth="5"
              animate={{ strokeDashoffset: isSyncingAll ? 10 : 65 }}
              transition={{ duration: 2, ease: "easeInOut" }}
            ></motion.circle>
          </svg>

          {/* Inner Ring: Local Metadata Success Rate (Blue) */}
          <svg className="absolute w-[78%] h-[78%] -rotate-90 transform" viewBox="0 0 100 100">
            <circle
              className="text-brand-surface-high"
              cx="50"
              cy="50"
              fill="transparent"
              r="44"
              stroke="currentColor"
              strokeWidth="6"
            ></circle>
            <motion.circle
              className="text-brand-secondary"
              cx="50"
              cy="50"
              fill="transparent"
              r="44"
              stroke="currentColor"
              strokeDasharray="276.4"
              strokeDashoffset="35"
              strokeLinecap="round"
              strokeWidth="6"
              animate={{ rotate: isSyncingAll ? 360 : 0 }}
              transition={{ repeat: isSyncingAll ? Infinity : 0, duration: 10, ease: "linear" }}
            ></motion.circle>
          </svg>

          {/* Central Content */}
          <div className="z-10 text-center select-none">
            <motion.span
              key={currentSpeedMB}
              initial={{ scale: 0.9, opacity: 0.5 }}
              animate={{ scale: 1, opacity: 1 }}
              className="font-headline text-4xl sm:text-5xl md:text-6xl font-bold leading-none"
              style={{ color: "var(--txt)" } as React.CSSProperties}
            >
              {isSyncingAll ? "扫描中" : "安全挂载"}
            </motion.span>
            <div className="text-xs sm:text-sm font-medium uppercase tracking-widest mt-2 flex items-center justify-center gap-1" style={{ color: "var(--txt-secondary)" } as React.CSSProperties}>
              <Database className="w-3.5 h-3.5 text-brand-primary-light" />
              <span>多媒体归档就绪</span>
            </div>

            <div className="mt-3 sm:mt-4 flex items-center justify-center gap-1.5 text-brand-secondary font-semibold glass px-3 py-1.5 rounded-full" style={{ color: "var(--brand-secondary)" } as React.CSSProperties}>
              <Sparkles className="w-4 h-4 text-brand-primary-light" />
              <span className="font-headline text-sm sm:text-base">{totalFiles.toLocaleString()} 项 (来自 ArchiveFolder 列表)</span>
            </div>
          </div>
        </div>

        {/* Stats Metadata Area */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-4 w-full max-w-md xl:max-w-none mx-auto xl:mx-0">
          <div className="glass glass-hover p-5 rounded-3xl flex flex-col justify-start space-y-2 transition-all">
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>归档服务状态</span>
            <div className="flex items-center gap-1.5">
              <span className="font-headline text-2xl font-bold text-brand-primary">
                {hasActiveTask ? "同步中" : "待命"}
              </span>
              <div className="inline-flex items-center px-2 py-1 rounded-full text-[10px] text-brand-primary font-bold" style={{ background: "rgba(16,185,129,0.12)", color: "var(--accent-ok)", border: "1px solid rgba(16,185,129,0.28)" } as React.CSSProperties}>
                <TrendingUp className="w-3 h-3 mr-0.5" />
                在线
              </div>
            </div>
            <span className="text-[10px]" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>{directories.length} 个 115 目录已加载</span>
          </div>

          <div className="glass glass-hover p-5 rounded-3xl flex flex-col justify-start space-y-2 sm:text-right transition-all">
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>115 挂载状态</span>
            <div className="flex items-center sm:justify-end gap-1.5">
              <span className="font-headline text-xl font-bold" style={{ color: pan115Ready ? "var(--txt)" : pan115StatusColor } as React.CSSProperties}>{pan115StatusLabel}</span>
              <div className={`w-2 h-2 rounded-full ${pan115StatusDot}`} />
            </div>
            <span className="text-[10px]" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>{pan115CookieStatus.message}</span>
          </div>
        </div>
        </div>
      </section>

      {/* Active Sync Directories Section */}
      <section className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-1">
          <div className="min-w-0">
            <h2 className="font-headline text-xl sm:text-2xl font-bold tracking-tight" style={{ color: "var(--txt)" } as React.CSSProperties}>115 目录列表 ({activeCount} 个启用)</h2>
            <p className="text-sm" style={{ color: "var(--txt-secondary)" } as React.CSSProperties}>从 /api/archive/folders 获取，状态从 /api/archive/tasks 派生</p>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:shrink-0">
            <button
              onClick={triggerFullScan}
              disabled={isSyncingAll}
              aria-label="手动归档扫描"
              className="btn-brand min-w-0 px-3 sm:px-4 py-2.5 text-xs font-bold rounded-2xl transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAll ? "animate-spin" : ""}`} />
              <span className="truncate">{isSyncingAll ? "扫描中..." : "归档扫描"}</span>
            </button>
            <button
              onClick={refreshDirectories}
              aria-label="刷新目录列表"
              className="glass-light glass-hover min-w-0 px-3 sm:px-4 py-2.5 text-xs font-bold rounded-2xl transition-all flex items-center justify-center gap-1.5"
              style={{ color: "var(--txt-secondary)" } as React.CSSProperties}
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span className="truncate hidden sm:inline">刷新</span>
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              aria-label="添加归档目录"
              className="glass-light glass-hover min-w-0 px-3 sm:px-4 py-2.5 text-xs font-bold rounded-2xl transition-all flex items-center justify-center gap-1.5"
              style={{ color: "var(--brand-primary)" } as React.CSSProperties}
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span className="truncate">添加目录</span>
            </button>
          </div>
        </div>

        {/* Directory Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {!initialLoaded && directories.length === 0 ? (
            /* 首次加载骨架屏：仅当尚无目录数据时显示，避免漏盖已加载的卡片 */
            [0, 1, 2].map((i) => (
              <div key={`sk-${i}`} className="p-6 rounded-3xl glass space-y-4 animate-pulse min-h-[280px]" aria-hidden="true">
                <div className="flex justify-between">
                  <div className="w-11 h-11 rounded-xl" style={{ background: "var(--surface-subtle)" }} />
                  <div className="w-12 h-12 rounded-full" style={{ background: "var(--surface-subtle)" }} />
                </div>
                <div className="h-4 rounded w-2/3" style={{ background: "var(--surface-subtle)" }} />
                <div className="space-y-2 pt-2">
                  <div className="h-3 rounded" style={{ background: "var(--surface-subtle)" }} />
                  <div className="h-3 rounded w-5/6" style={{ background: "var(--surface-subtle)" }} />
                  <div className="h-3 rounded w-4/6" style={{ background: "var(--surface-subtle)" }} />
                </div>
                <div className="h-2 rounded-full" style={{ background: "var(--surface-subtle)" }} />
              </div>
            ))
          ) : directories.length === 0 ? (
            /* 加载完成但仍无目录：引导添加，而非暗示后端故障 */
            <div className="md:col-span-2 xl:col-span-3 p-8 rounded-3xl glass flex flex-col items-center justify-center text-center min-h-[280px]" style={{ border: "1px dashed var(--border-strong)" } as React.CSSProperties}>
              <EmptyState
                icon={<Database className="w-8 h-8" style={{ color: "var(--txt-muted)" } as React.CSSProperties} />}
                text="尚未配置归档监听目录"
                subtext="点击「添加目录」设置 115 网盘监听文件夹，启动归档同步。"
                cta={
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="btn-brand px-4 py-2 text-xs font-bold rounded-2xl transition-all flex items-center gap-1.5"
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    添加目录
                  </button>
                }
              />
            </div>
          ) : null}
          {directories.map((dir) => (
            <div
              key={dir.id}
              className={`p-6 rounded-3xl glass glass-hover transition-all min-h-[280px] ${dir.enabled ? "" : "opacity-80"
                }`}
            >
              <div className="flex justify-between items-start mb-6">
                <div className="p-3 rounded-xl flex items-center justify-center" style={(!dir.enabled
                  ? { background: "var(--surface-subtle)", color: "var(--txt-muted)" }
                  : dir.targetClient === "emby"
                    ? { background: "rgba(16,185,129,0.16)", color: "var(--accent-ok)" }
                    : dir.targetClient === "feiniu"
                      ? { background: "rgba(245,158,11,0.16)", color: "var(--accent-warn)" }
                      : { background: "rgba(99,102,241,0.16)", color: "var(--accent-info)" }) as React.CSSProperties}>
                  {dir.targetClient === "emby" ? (
                    <Film className="w-5 h-5" />
                  ) : dir.targetClient === "feiniu" ? (
                    <Tv className="w-5 h-5" />
                  ) : (
                    <Database className="w-5 h-5" />
                  )}
                </div>

                {/* Custom Toggle Switch — 全局归档开关 */}
                <button
                  onClick={() => toggleDir(dir.id)}
                  aria-label={dir.enabled ? "暂停归档服务" : "启用归档服务"}
                  aria-pressed={dir.enabled}
                  role="switch"
                  className="focus:outline-none transition-transform active:scale-95"
                  title="切换归档服务全局开关"
                >
                  {dir.enabled ? (
                    <ToggleRight className="w-12 h-12 text-brand-primary-light" />
                  ) : (
                    <ToggleLeft className="w-12 h-12" style={{ color: "var(--txt-muted)" } as React.CSSProperties} />
                  )}
                </button>
              </div>

              <h3 className="font-headline text-lg font-bold flex items-center gap-2" style={{ color: "var(--txt)" } as React.CSSProperties}>
                {dir.name}
                {!dir.enabled && <span className="text-[10px] font-normal px-1.5 py-0.5 rounded" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" } as React.CSSProperties}>已暂停</span>}
              </h3>

              <div className="mt-4 space-y-4">
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
                    <span>115 目录 ID:</span>
                    <span className="font-mono" style={{ color: "var(--txt)" } as React.CSSProperties}>{dir.folderId115}</span>
                  </div>
                  <div className="flex justify-between" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
                    <span>监听 CID:</span>
                    <span className="font-mono truncate max-w-[150px]" style={{ color: "var(--txt)" } as React.CSSProperties} title={dir.localPath}>{dir.localPath || "-"}</span>
                  </div>
                  <div className="flex justify-between" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
                    <span>目标客户端:</span>
                    <span style={{ color: "var(--txt)" } as React.CSSProperties}>{dir.targetClient === "emby" ? "Emby" : dir.targetClient === "feiniu" ? "飞牛" : "-"}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="flex items-center gap-1" style={{ color: "var(--txt-secondary)" } as React.CSSProperties}>
                      {dir.status === "syncing" && hasActiveTask && <span className="w-1.5 h-1.5 rounded-full bg-brand-primary-light animate-ping" />}
                      {dir.status === "scanning" && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />}
                      {dir.status === "syncing" && hasActiveTask ? "正在归档..." : dir.status === "scanning" ? "扫库索引中..." : "空闲"}
                    </span>
                    {/* 后端无实时速度字段，显示 "-" */}
                    <span className="text-brand-primary font-bold">{dir.speed}</span>
                  </div>
                  {/* 进度条：后端无 per-folder 进度，有活跃任务时显示 100% (不确定进度)，否则 0 */}
                  <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--surface-subtle)" } as React.CSSProperties}>
                    <motion.div
                      className="h-full"
                      style={{ background: dir.status === "scanning" ? "linear-gradient(135deg, var(--accent-amber), var(--warn))" : "var(--brand-gradient)" } as React.CSSProperties}
                      initial={{ width: 0 }}
                      animate={{ width: `${hasActiveTask && dir.enabled ? 100 : dir.progress}%` }}
                      transition={{ duration: 1 }}
                    />
                  </div>
                  {/* 后端无此粒度数据 */}
                  <div className="flex justify-between text-[10px]" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
                    <span>大小: {dir.totalSize}</span>
                    <span>项数: {dir.itemCount}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bento Grid Insights Layout */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left wider block: Peak Traffic Throttling */}
        <div className="md:col-span-2 p-6 md:p-8 rounded-3xl glass glass-spotlight glass-hover relative overflow-hidden group transition-all">
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-1 text-[10px] font-bold text-brand-primary uppercase tracking-widest rounded-full" style={{ background: "var(--brand-primary-soft)", border: "1px solid var(--brand-primary-border)" } as React.CSSProperties}>
                避让拥堵
              </span>
              <span className="text-xs" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>网盘API保护规则</span>
            </div>
            <h4 className="font-headline text-xl font-bold flex items-center gap-2" style={{ color: "var(--txt)" } as React.CSSProperties}>
              智能离峰高宽带提速视窗
            </h4>
            <p className="text-sm mt-2 max-w-sm leading-relaxed" style={{ color: "var(--txt-secondary)" } as React.CSSProperties}>
              根据 115 接口每日高风险时间段数据，可在每日 **凌晨 11:00 至 次日上午 5:00** 启用智能极速提速，自动增加 8-16 线程而防风控，建议您前去规划配置。
            </p>
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={onNavigateToSettings}
                className="btn-brand px-6 py-2.5 text-xs font-bold rounded-2xl transition-all"
              >
                前往参数设置
              </button>
              <div className="text-xs font-medium flex items-center gap-1" style={{ color: "var(--accent-warn)" } as React.CSSProperties}>
                <Info className="w-3.5 h-3.5" />
                当前时段: 常规温和速率
              </div>
            </div>
          </div>

          <div className="absolute right-0 bottom-0 pointer-events-none group-hover:scale-110 transition-all duration-500 transform translate-x-8 translate-y-8" style={{ color: "var(--surface-subtle)" } as React.CSSProperties}>
            <Zap className="w-48 h-48" strokeWidth={0.5} />
          </div>
        </div>

        {/* Right smaller block: Token Watchdog / Error Prevention */}
        <div
          className="p-6 md:p-8 rounded-3xl text-white flex flex-col justify-between shadow-lg shadow-brand-primary/10 relative overflow-hidden glass-spotlight"
          style={{ background: pan115Ready ? "var(--brand-gradient)" : "linear-gradient(135deg, rgba(239,68,68,.90), rgba(236,72,153,.72))" } as React.CSSProperties}
        >
          <div className="relative z-10">
            <div className="flex justify-between items-center mb-4">
              <ShieldCheck className="w-8 h-8 text-white" />
              <span className="font-headline text-2xl font-bold">{pan115Checking ? "检查中" : pan115Ready ? "在线" : "需配置"}</span>
            </div>
            <h4 className="font-headline text-lg font-bold">Cookies 凭证侦守</h4>
            <p className="text-xs text-white/85 mt-2 leading-relaxed">
              {pan115Ready
                ? "已确认 115 Cookie 会话有效，转存、离线下载与目录访问可继续使用。"
                : `${pan115CookieStatus.message}。请前往配置中心更新 115 Cookie 或使用扫码登录。`}
            </p>
          </div>

          <div className="mt-8 pt-4 border-t border-white/10 flex items-center justify-between text-xs">
            <span className="opacity-80">安全防护中:</span>
            <button type="button" className="font-bold underline cursor-pointer hover:text-white" onClick={onNavigateToSettings}>查看会话</button>
          </div>
        </div>
      </section>

      {/* Interactive Add Directory Modal */}
      {/* 后端无独立"添加同步目录"概念。保存动作映射到 archiveApi.updateConfig (设置 archive_watch_cid)。 */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="配置归档监听目录">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 backdrop-blur-sm"
              style={{ background: "rgba(11,8,30,.34)" } as React.CSSProperties}
            />

            {/* Box */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-heavy glass-iridescent rounded-3xl p-6 md:p-8 max-w-md w-full relative z-10 space-y-6"
            >
              <div>
                <h3 className="font-headline text-xl font-bold" style={{ color: "var(--txt)" } as React.CSSProperties}>配置归档监听目录</h3>
                <p className="text-xs mt-1" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
                  设置 115 云盘归档监听目录 CID。后端无独立"添加同步目录"概念，此操作将更新全局归档配置 (archive_watch_cid/archive_output_cid)。
                </p>
              </div>

              <form onSubmit={handleAddDirectory} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold" style={{ color: "var(--txt-secondary)" } as React.CSSProperties}>映射友好名称 *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 经典电影集锦"
                    value={newDirName}
                    onChange={(e) => setNewDirName(e.target.value)}
                    className="w-full text-sm px-3.5 py-2.5 input-premium"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold" style={{ color: "var(--txt-secondary)" } as React.CSSProperties}>115 目录 Folder ID (CID) *</label>
                  <input
                    type="text"
                    required
                    maxLength={14}
                    placeholder="e.g. 115204481085"
                    value={newFolderId}
                    onChange={(e) => setNewFolderId(e.target.value)}
                    className="w-full text-sm font-mono px-3.5 py-2.5 input-premium"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold" style={{ color: "var(--txt-secondary)" } as React.CSSProperties}>归档输出目录 CID (可选)</label>
                  <input
                    type="text"
                    placeholder="e.g. 115205593190 (115 目录 CID，非本地路径)"
                    value={newLocalPath}
                    onChange={(e) => setNewLocalPath(e.target.value)}
                    className="w-full text-sm font-mono px-3.5 py-2.5 input-premium"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold" style={{ color: "var(--txt-secondary)" } as React.CSSProperties}>对接的目标媒体客户端 *</label>
                  <select
                    value={newClient}
                    onChange={(e) => setNewClient(e.target.value as "emby" | "feiniu")}
                    className="w-full text-sm px-3.5 py-2.5 input-premium"
                  >
                    <option value="emby">Emby Server</option>
                    <option value="feiniu">飞牛影视</option>
                  </select>
                  <p className="text-[10px] mt-1" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>后端仅支持 Emby 和飞牛。Plex/Jellyfin 无后端对应。</p>
                </div>

                <div className="flex gap-3 pt-4 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="btn-ghost px-5 py-2.5 text-xs font-semibold rounded-2xl transition-all"
                    style={{ color: "var(--txt-secondary)" } as React.CSSProperties}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="btn-brand px-5 py-2.5 text-xs font-bold rounded-2xl transition-all"
                  >
                    更新归档配置
                  </button>
                </div>

                <div className="pt-2" style={{ borderTop: "1px solid var(--border)" } as React.CSSProperties}>
                  <p className="text-[10px] text-center" style={{ color: "var(--txt-muted)" } as React.CSSProperties}>
                    此操作将更新全局归档配置 (PUT /api/archive/config)。<br />
                    如需完整配置归档间隔、命名格式等，请
                    <button
                      type="button"
                      onClick={() => { setShowAddModal(false); onNavigateToSettings(); }}
                      className="text-brand-primary font-bold underline ml-1"
                    >
                      前往设置页
                    </button>
                  </p>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 归档高级工具 */}
      <div className="glass rounded-3xl p-4 space-y-2">
        <p className="text-[10px] font-black" style={{ color: "var(--txt-muted)" }}>归档工具</p>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={async () => { try { const r = await archiveApi.getSubdirOptions(); await addLog("SUCCESS", `子目录选项: ${JSON.stringify(r.data)}`); } catch (e: unknown) { await addLog("ERROR", getApiErrorMessage(e)); } }}
            className="px-2 py-1 rounded-lg text-[9px] font-bold glass-hover" style={{ color: "var(--txt-muted)", border: "1px solid var(--border)" }}>子目录选项</button>
          <button onClick={async () => { try { const r = await archiveApi.getNamingOptions(); await addLog("SUCCESS", `命名选项: ${JSON.stringify(r.data)}`); } catch (e: unknown) { await addLog("ERROR", getApiErrorMessage(e)); } }}
            className="px-2 py-1 rounded-lg text-[9px] font-bold glass-hover" style={{ color: "var(--txt-muted)", border: "1px solid var(--border)" }}>命名选项</button>
          <button onClick={async () => { try { await archiveApi.clearTasks(true); await addLog("WARN", "已清理归档任务(含失败)"); } catch (e: unknown) { await addLog("ERROR", getApiErrorMessage(e)); } }}
            className="btn-danger px-2 py-1 rounded-lg text-[9px] font-bold">清理任务</button>
        </div>
      </div>
    </div>
  );
}
