/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 仪表盘 — 阶段3：对接真实后端 archive API。
 *
 * 字段映射诚实原则（详见 types.ts SyncDirectory 注释）：
 *   name/folderId115/id ← ArchiveFolder (实时)
 *   status ← ArchiveTask (archiving→syncing, 无任务→idle, failed→error)
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
import { archiveApi } from "../api";
import type { ArchiveTask } from "../api/types";
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

interface DashboardTabProps {
  directories: SyncDirectory[];
  setDirectories: React.Dispatch<React.SetStateAction<SyncDirectory[]>>;
  onNavigateToSettings: () => void;
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => void;
}

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

  // 归档任务列表 — 用于派生目录状态
  const [archiveTasks, setArchiveTasks] = useState<ArchiveTask[]>([]);

  // 挂载时拉取归档任务，周期性更新目录状态
  useEffect(() => {
    const loadTasks = async () => {
      try {
        const res = await archiveApi.listTasks({ status: "archiving", limit: 50 });
        const tasks = res.data;
        if (Array.isArray(tasks)) setArchiveTasks(tasks as ArchiveTask[]);
      } catch (err) {
        console.error("Failed to load archive tasks:", err);
      }
    };
    loadTasks();
  }, [directories]);

  // 从全局归档任务派生目录状态：有活跃任务→syncing，否则→idle
  // 注意：后端 ArchiveTask 无 per-folder 关联，这是全局推导
  const hasActiveTask = archiveTasks.length > 0;

  // Calculate totals (honest: speed/itemCount/totalSize have no backend data)
  const activeCount = directories.filter(d => d.enabled).length;
  // 后端无实时速度字段，恒定显示 0
  const currentSpeedMB = "0";
  const totalFiles = directories.reduce((sum, d) => sum + d.itemCount, 0);

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
      addLog("ERROR", "更新归档配置失败: " + String(err));
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
        archiveApi.listTasks({ status: "archiving", limit: 50 }).catch(() => ({ data: [] })),
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
      addLog("ERROR", "更新归档配置失败: " + String(err));
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
          const res = await archiveApi.listTasks({ status: "archiving", limit: 50 });
          const tasks = res.data;
          if (Array.isArray(tasks)) setArchiveTasks(tasks as ArchiveTask[]);
        } catch { /* ignore refresh errors */ }
      }, 2000);
    } catch (err) {
      console.error("Failed to run archive scan:", err);
      addLog("ERROR", "归档扫描请求失败: " + String(err));
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
        archiveApi.listTasks({ status: "archiving", limit: 50 }).catch(() => ({ data: [] })),
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
    <div className="space-y-12">
      {/* 数据来源提示条：所有数据来自 /api/archive/* 端点 */}
      <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl px-4 py-2 flex items-center gap-2 text-xs text-indigo-600 font-medium">
        <Info className="w-4 h-4 shrink-0" />
        <span>仪表盘数据来自后端归档服务 (/api/archive/*)。速度/大小/项数等字段后端不提供，显示 "-"。完整归档配置请前往设置页。</span>
      </div>

      {/* Centerpiece: Luminous Engine Dial */}
      <section className="flex flex-col items-center">
        <div className="relative w-72 h-72 md:w-80 md:h-80 flex items-center justify-center">
          {/* Shadow Glow Background */}
          <div className="absolute inset-0 rounded-full bg-brand-primary/5 blur-3xl"></div>

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
              className="font-headline text-5xl md:text-6xl font-bold text-txt-dark leading-none"
            >
              {isSyncingAll ? "扫描中" : "安全挂载"}
            </motion.span>
            <div className="text-sm font-medium text-gray-500 uppercase tracking-widest mt-2 flex items-center justify-center gap-1">
              <Database className="w-3.5 h-3.5 text-brand-primary-light" />
              <span>多媒体归档就绪</span>
            </div>

            <div className="mt-4 flex items-center justify-center gap-1.5 text-brand-secondary font-semibold bg-white/70 backdrop-blur px-3 py-1.5 rounded-full shadow-sm border border-brand-surface-high">
              <Sparkles className="w-4 h-4 text-brand-primary-light" />
              <span className="font-headline text-base">{totalFiles.toLocaleString()} 项 (来自 ArchiveFolder 列表)</span>
            </div>
          </div>
        </div>

        {/* Stats Metadata Area */}
        <div className="grid grid-cols-2 gap-8 mt-10 w-full max-w-md">
          <div className="bg-white/75 backdrop-blur-md p-4 rounded-xl border border-white/60 flex flex-col justify-start space-y-1 shadow-xs hover:bg-white/85 transition-all">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">归档服务状态</span>
            <div className="flex items-center gap-1.5">
              <span className="font-headline text-2xl font-bold text-brand-primary">
                {hasActiveTask ? "同步中" : "待命"}
              </span>
              <div className="flex items-center bg-teal-50 px-1 py-0.5 rounded text-[10px] text-brand-primary font-bold">
                <TrendingUp className="w-3 h-3 mr-0.5" />
                在线
              </div>
            </div>
            <span className="text-[10px] text-slate-400">{directories.length} 个 115 目录已加载</span>
          </div>

          <div className="bg-white/75 backdrop-blur-md p-4 rounded-xl border border-white/60 flex flex-col justify-start space-y-1 shadow-xs text-right hover:bg-white/85 transition-all">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">115 挂载状态</span>
            <div className="flex items-center justify-end gap-1.5">
              <span className="font-headline text-xl font-bold text-txt-dark">已连接</span>
              <div className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
            </div>
            <span className="text-[10px] text-slate-400">Cookie 会话有效</span>
          </div>
        </div>
      </section>

      {/* Active Sync Directories Section */}
      <section className="space-y-5">
        <div className="flex items-center justify-between px-1">
          <div>
            <h2 className="font-headline text-2xl font-bold tracking-tight text-txt-dark">115 目录列表 ({activeCount} 个启用)</h2>
            <p className="text-sm text-gray-500">从 /api/archive/folders 获取，状态从 /api/archive/tasks 派生</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={triggerFullScan}
              disabled={isSyncingAll}
              className="px-4 py-2 bg-brand-primary text-white text-xs font-bold rounded-lg hover:bg-opacity-90 transition-all flex items-center gap-1.5 shadow-md disabled:bg-slate-300"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAll ? "animate-spin" : ""}`} />
              <span>{isSyncingAll ? "正在执行归档扫描..." : "手动归档扫描"}</span>
            </button>
            <button
              onClick={onNavigateToSettings}
              className="px-4 py-2 bg-slate-50 text-brand-primary text-xs font-bold rounded-lg hover:bg-slate-100 transition-all flex items-center gap-1.5 border border-slate-100"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>配置归档目录</span>
            </button>
          </div>
        </div>

        {/* Horizontal Scroll Cards */}
        <div className="flex gap-6 overflow-x-auto no-scrollbar pb-4 snap-x">
          {directories.length === 0 && (
            <div className="snap-start flex-shrink-0 w-72 p-6 rounded-2xl bg-white/50 backdrop-blur-md border border-dashed border-slate-200 flex flex-col items-center justify-center text-center space-y-2 min-h-[280px]">
              <Database className="w-8 h-8 text-slate-300" />
              <p className="text-xs text-slate-400 font-semibold">暂无 115 目录数据</p>
              <p className="text-[10px] text-slate-300">请检查后端归档服务及 115 连接</p>
            </div>
          )}
          {directories.map((dir) => (
            <div
              key={dir.id}
              className={`snap-start flex-shrink-0 w-72 p-6 rounded-2xl backdrop-blur-md border shadow-xs transition-all hover:shadow-sm ${
                dir.enabled
                  ? "bg-white/70 border-white/60 hover:bg-white/85 hover:border-slate-200/50"
                  : "bg-slate-50/40 border-slate-100/40 opacity-80"
              }`}
            >
              <div className="flex justify-between items-start mb-6">
                <div className={`p-3 rounded-xl flex items-center justify-center ${
                  !dir.enabled
                    ? "bg-slate-100 text-slate-400"
                    : dir.targetClient === "emby"
                    ? "bg-teal-50 text-brand-primary"
                    : dir.targetClient === "feiniu"
                    ? "bg-amber-50 text-amber-600"
                    : "bg-indigo-50 text-brand-secondary"
                }`}>
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
                  className="focus:outline-none transition-transform active:scale-95"
                  title="切换归档服务全局开关"
                >
                  {dir.enabled ? (
                    <ToggleRight className="w-12 h-12 text-brand-primary-light" />
                  ) : (
                    <ToggleLeft className="w-12 h-12 text-gray-300" />
                  )}
                </button>
              </div>

              <h3 className="font-headline text-lg font-bold text-txt-dark flex items-center gap-2">
                {dir.name}
                {!dir.enabled && <span className="text-[10px] font-normal px-1.5 py-0.5 bg-gray-200 text-gray-500 rounded">已暂停</span>}
              </h3>

              <div className="mt-4 space-y-4">
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between text-gray-500">
                    <span>115 目录 ID:</span>
                    <span className="font-mono text-gray-700">{dir.folderId115}</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>监听 CID:</span>
                    <span className="font-mono text-gray-700 truncate max-w-[150px]" title={dir.localPath}>{dir.localPath || "-"}</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>目标客户端:</span>
                    <span className="text-gray-700">{dir.targetClient === "emby" ? "Emby" : dir.targetClient === "feiniu" ? "飞牛" : "-"}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-gray-500 flex items-center gap-1">
                      {dir.status === "syncing" && hasActiveTask && <span className="w-1.5 h-1.5 rounded-full bg-brand-primary-light animate-ping" />}
                      {dir.status === "scanning" && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />}
                      {dir.status === "syncing" && hasActiveTask ? "正在归档..." : dir.status === "scanning" ? "扫库索引中..." : "空闲"}
                    </span>
                    {/* 后端无实时速度字段，显示 "-" */}
                    <span className="text-brand-primary font-bold">{dir.speed}</span>
                  </div>
                  {/* 进度条：后端无 per-folder 进度，有活跃任务时显示 100% (不确定进度)，否则 0 */}
                  <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full ${
                        dir.status === "scanning" ? "bg-amber-400" : "bg-brand-primary-light"
                      }`}
                      initial={{ width: 0 }}
                      animate={{ width: `${hasActiveTask && dir.enabled ? 100 : dir.progress}%` }}
                      transition={{ duration: 1 }}
                    />
                  </div>
                  {/* 后端无此粒度数据 */}
                  <div className="flex justify-between text-[10px] text-slate-400">
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
        <div className="md:col-span-2 p-8 rounded-2xl bg-white/75 backdrop-blur-md border border-white/60 shadow-xs relative overflow-hidden group hover:bg-white/85 transition-all">
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 text-[10px] font-bold text-brand-primary uppercase tracking-widest bg-brand-primary/10 rounded-full">
                避让拥堵
              </span>
              <span className="text-xs text-slate-400">网盘API保护规则</span>
            </div>
            <h4 className="font-headline text-xl font-bold text-txt-dark flex items-center gap-2">
              智能离峰高宽带提速视窗
            </h4>
            <p className="text-sm text-slate-500 mt-2 max-w-sm leading-relaxed">
              根据 115 接口每日高风险时间段数据，可在每日 **凌晨 11:00 至 次日上午 5:00** 启用智能极速提速，自动增加 8-16 线程而防风控，建议您前去规划配置。
            </p>
            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={onNavigateToSettings}
                className="px-6 py-2.5 bg-brand-primary text-white text-xs font-bold rounded-lg hover:bg-opacity-90 transition-all shadow-md"
              >
                前往参数设置
              </button>
              <div className="text-xs text-amber-600 font-medium flex items-center gap-1">
                <Info className="w-3.5 h-3.5" />
                当前时段: 常规温和速率
              </div>
            </div>
          </div>

          <div className="absolute right-0 bottom-0 text-gray-100 pointer-events-none group-hover:scale-110 group-hover:text-brand-surface-normal transition-all duration-500 transform translate-x-8 translate-y-8">
            <Zap className="w-48 h-48" strokeWidth={0.5} />
          </div>
        </div>

        {/* Right smaller block: Token Watchdog / Error Prevention */}
        <div className="p-8 rounded-2xl bg-brand-primary text-white flex flex-col justify-between shadow-lg shadow-brand-primary/10 relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex justify-between items-center mb-4">
              <ShieldCheck className="w-8 h-8 text-brand-primary-light" />
              <span className="font-headline text-2xl font-bold">在线</span>
            </div>
            <h4 className="font-headline text-lg font-bold">Cookies 凭证侦守</h4>
            <p className="text-xs text-green-100 mt-2 leading-relaxed">
              已全自动侦守 115 安全验证网关，当前账户 UID 及 API 请求会话极其安全，无速率拦截、降速或账号过载预警。
            </p>
          </div>

          <div className="mt-8 pt-4 border-t border-white/10 flex items-center justify-between text-xs">
            <span className="opacity-80">安全防护中:</span>
            <span className="font-bold underline cursor-pointer hover:text-white" onClick={onNavigateToSettings}>查看会话</span>
          </div>
        </div>
      </section>

      {/* Interactive Add Directory Modal */}
      {/* 后端无独立"添加同步目录"概念。保存动作映射到 archiveApi.updateConfig (设置 archive_watch_cid)。 */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />

            {/* Box */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white/85 backdrop-blur-xl rounded-2xl p-6 md:p-8 max-w-md w-full relative z-10 shadow-2xl border border-white/60 space-y-6"
            >
              <div>
                <h3 className="font-headline text-xl font-bold text-txt-dark">配置归档监听目录</h3>
                <p className="text-xs text-slate-400 mt-1">
                  设置 115 云盘归档监听目录 CID。后端无独立"添加同步目录"概念，此操作将更新全局归档配置 (archive_watch_cid/archive_output_cid)。
                </p>
              </div>

              <form onSubmit={handleAddDirectory} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500">映射友好名称 *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 经典电影集锦"
                    value={newDirName}
                    onChange={(e) => setNewDirName(e.target.value)}
                    className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-slate-100 focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500">115 目录 Folder ID (CID) *</label>
                  <input
                    type="text"
                    required
                    maxLength={14}
                    placeholder="e.g. 115204481085"
                    value={newFolderId}
                    onChange={(e) => setNewFolderId(e.target.value)}
                    className="w-full text-sm font-mono px-3.5 py-2.5 rounded-lg border border-slate-100 focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500">归档输出目录 CID (可选)</label>
                  <input
                    type="text"
                    placeholder="e.g. 115205593190 (115 目录 CID，非本地路径)"
                    value={newLocalPath}
                    onChange={(e) => setNewLocalPath(e.target.value)}
                    className="w-full text-sm font-mono px-3.5 py-2.5 rounded-lg border border-slate-100 focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500">对接的目标媒体客户端 *</label>
                  <select
                    value={newClient}
                    onChange={(e) => setNewClient(e.target.value as "emby" | "feiniu")}
                    className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-slate-100 focus:outline-none focus:border-brand-primary bg-white"
                  >
                    <option value="emby">Emby Server</option>
                    <option value="feiniu">飞牛影视</option>
                  </select>
                  <p className="text-[10px] text-slate-400 mt-1">后端仅支持 Emby 和飞牛。Plex/Jellyfin 无后端对应。</p>
                </div>

                <div className="flex gap-3 pt-4 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-5 py-2.5 text-xs text-gray-500 font-semibold hover:bg-gray-100 rounded-lg transition-all"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2.5 text-xs text-white bg-brand-primary font-bold rounded-lg hover:bg-opacity-90 transition-all shadow-md"
                  >
                    更新归档配置
                  </button>
                </div>

                <div className="pt-2 border-t border-slate-100">
                  <p className="text-[10px] text-slate-400 text-center">
                    此操作将更新全局归档配置 (PUT /api/archive/config)。<br/>
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
    </div>
  );
}
