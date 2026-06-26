/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pan115FilesTab — 115 网盘文件管理 & 离线下载
 *
 * 补齐 pan115Api 中 33 个端点的大量未用功能：
 *   1. 网盘状态概览（Cookie / 用户 / 配额 / 风控）
 *   2. 文件浏览器（breadcrumb 导航 / 文件夹进入 / 搜索 / 新建文件夹）
 *   3. 离线下载管理（任务列表 / 添加 / 重试 / 删除 / 清空已完成）
 *   4. 默认文件夹设置
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  FolderOpen, File, Search, Plus, Trash2, RefreshCw, RotateCcw, HardDrive,
  Shield, User, AlertTriangle, CheckCircle2, Upload, FolderPlus, Download,
  Layers, X, ChevronRight, Home, Database, Zap, Info,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { pan115Api } from "../api/pan115";
import Pan115Progress, {
  type Pan115ProgressState,
  deriveDefaultProgressState,
} from "./Pan115Progress";

interface Pan115FilesTabProps {
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => Promise<void>;
}

/** 115 文件对象（前端规范化后） */
interface Pan115File {
  fid: string;
  name: string;
  size: number;
  sizeDisplay: string;
  type: "file" | "folder";
  pickCode: string;
  categoryId: string;
  parentId: string;
  isVideo: boolean;
  time: string;
  icon: string;
  sha: string;
}

/** 离线下载任务 */
interface OfflineTask {
  infoHash: string;
  name: string;
  size: string;
  sizeDisplay: string;
  status: number; // 0=等待, 1=下载中, 2=完成, -1=失败
  statusLabel: string;
  percent: number;
  url: string;
  addTime: string;
}

/** 离线配额 */
interface OfflineQuota {
  total: number;
  used: number;
  remaining: number;
}

/** Cookie 状态 */
interface CookieStatus {
  valid: boolean;
  username?: string;
  avatar?: string;
  message?: string;
}

// ---- 工具函数 ----

function formatBytes(bytes: number | string): string {
  const b = typeof bytes === "string" ? parseInt(bytes, 10) || 0 : bytes;
  if (b >= 1 << 40) return (b / (1 << 40)).toFixed(1) + " TB";
  if (b >= 1 << 30) return (b / (1 << 30)).toFixed(1) + " GB";
  if (b >= 1 << 20) return (b / (1 << 20)).toFixed(1) + " MB";
  if (b >= 1 << 10) return (b / (1 << 10)).toFixed(1) + " KB";
  return b + " B";
}

function normalizeFile(raw: Record<string, unknown>): Pan115File {
  const name = String(raw.n || raw.name || "未命名");
  const size = Number(raw.s || raw.size || 0);
  const fileType = Number(raw.t ?? raw.type ?? raw.file_type ?? 0);
  const isFolder = fileType === 1 || String(raw.t) === "1" || String(raw.type) === "folder";
  const isVideo = Boolean(raw.iv) || String(raw.iv) === "1" || String(raw.is_video) === "1";
  return {
    fid: String(raw.fid || raw.file_id || raw.id || ""),
    name,
    size,
    sizeDisplay: isFolder ? "-" : formatBytes(size),
    type: isFolder ? "folder" : "file",
    pickCode: String(raw.pc || raw.pick_code || raw.pickcode || ""),
    categoryId: String(raw.cid || raw.category_id || ""),
    parentId: String(raw.pid || raw.parent_id || ""),
    isVideo,
    time: String(raw.te || raw.time || raw.created_at || ""),
    icon: String(raw.ico || raw.icon || ""),
    sha: String(raw.sha || raw.sha1 || ""),
  };
}

function normalizeOfflineTask(raw: Record<string, unknown>): OfflineTask {
  const name = String(raw.name || raw.title || raw.file_name || "未知任务");
  const size = Number(raw.size || 0);
  const status = Number(raw.status ?? 0);
  const percentDone = Math.min(100, Math.max(0, Number(raw.percentDone ?? raw.percent ?? 0)));
  let statusLabel = "未知";
  if (status === 0) statusLabel = "等待中";
  else if (status === 1) statusLabel = "下载中";
  else if (status === 2) statusLabel = "已完成";
  else if (status === -1) statusLabel = "失败";
  else statusLabel = String(raw.statusText || raw.status_text || status);
  return {
    infoHash: String(raw.info_hash || raw.infoHash || raw.hash || ""),
    name,
    size: formatBytes(size),
    sizeDisplay: size > 0 ? formatBytes(size) : "-",
    status,
    statusLabel,
    percent: percentDone,
    url: String(raw.url || raw.download_url || raw.downloadUrl || ""),
    addTime: String(raw.add_time || raw.addtime || raw.created_at || ""),
  };
}

// ---- 离线任务状态色 ----
function offlineStatusColor(status: number): string {
  if (status === 2) return "var(--accent-ok)";
  if (status === 1) return "var(--accent-info)";
  if (status === -1) return "var(--accent-danger)";
  return "var(--accent-warn)";
}

// ---- 面包屑导航 ----
interface BreadcrumbItem {
  cid: string;
  name: string;
}

export default function Pan115FilesTab({ addLog }: Pan115FilesTabProps) {
  // ---- 状态 ----
  const [cookieStatus, setCookieStatus] = useState<CookieStatus | null>(null);
  const [userInfo, setUserInfo] = useState<Record<string, unknown> | null>(null);
  const [offlineQuota, setOfflineQuota] = useState<OfflineQuota | null>(null);
  const [riskStatus, setRiskStatus] = useState<string>("unknown");
  const [statusLoading, setStatusLoading] = useState(true);

  // 文件浏览
  const [files, setFiles] = useState<Pan115File[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [currentCid, setCurrentCid] = useState("0");
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([{ cid: "0", name: "根目录" }]);
  const [fileSearch, setFileSearch] = useState("");
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  // 离线任务
  const [offlineTasks, setOfflineTasks] = useState<OfflineTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [addTaskUrl, setAddTaskUrl] = useState("");
  const [addTaskTitle, setAddTaskTitle] = useState("");
  const [addingTask, setAddingTask] = useState(false);
  const [deletingTaskHash, setDeletingTaskHash] = useState<string | null>(null);

  // 默认文件夹
  const [defaultFolderId, setDefaultFolderId] = useState("");
  const [defaultFolderName, setDefaultFolderName] = useState("");

  // 转存进度弹窗
  const [progress, setProgress] = useState<Pan115ProgressState>(deriveDefaultProgressState());

  // ---- 加载状态概览 ----
  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      // Cookie 检查
      try {
        const cookieResp = await pan115Api.checkCookie();
        const data = cookieResp.data as Record<string, unknown>;
        setCookieStatus({
          valid: Boolean(data.valid || data.success || data.ok),
          username: String(data.username || data.user_name || data.nickname || ""),
          avatar: String(data.avatar || data.face || ""),
          message: String(data.message || data.msg || ""),
        });
      } catch {
        setCookieStatus({ valid: false, message: "Cookie 无效或已过期" });
      }

      // 用户信息
      try {
        const userResp = await pan115Api.getUserInfo();
        setUserInfo(userResp.data as Record<string, unknown>);
      } catch {
        setUserInfo(null);
      }

      // 离线配额
      try {
        const quotaResp = await pan115Api.getOfflineQuota();
        const qData = quotaResp.data as Record<string, unknown>;
        setOfflineQuota({
          total: Number(qData.total_quota ?? qData.total ?? 0),
          used: Number(qData.used_quota ?? qData.used ?? 0),
          remaining: Number(qData.remaining_quota ?? qData.remaining ?? 0),
        });
      } catch {
        setOfflineQuota(null);
      }

      // 风控健康
      try {
        const riskResp = await pan115Api.getRiskHealth();
        const rData = riskResp.data as Record<string, unknown>;
        const level = String(rData.level ?? rData.risk_level ?? rData.status ?? "unknown");
        setRiskStatus(level);
      } catch {
        setRiskStatus("unknown");
      }

      // 默认文件夹
      try {
        const dfResp = await pan115Api.getOfflineDefaultFolder();
        const dfData = dfResp.data as Record<string, unknown>;
        setDefaultFolderId(String(dfData.folder_id ?? dfData.cid ?? dfData.fid ?? ""));
        setDefaultFolderName(String(dfData.folder_name ?? dfData.name ?? ""));
      } catch {
        // 静默
      }
    } finally {
      setStatusLoading(false);
    }
  }, []);

  // ---- 文件列表加载 ----
  const loadFiles = useCallback(async (cid: string) => {
    setFilesLoading(true);
    try {
      const resp = await pan115Api.getFileList(cid, 0, 100);
      const data = resp.data as Record<string, unknown>;
      const rawList = Array.isArray(data.data)
        ? (data.data as Record<string, unknown>[])
        : Array.isArray(data.list)
          ? (data.list as Record<string, unknown>[])
          : Array.isArray(data)
            ? (data as Record<string, unknown>[])
            : [];
      const normalized = rawList.map(normalizeFile);
      // 文件夹排前面，文件排后面
      normalized.sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name, "zh");
      });
      setFiles(normalized);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
        || String(err);
      console.error("Failed to load file list:", msg);
      await addLog("ERROR", `加载 115 文件列表失败: ${msg}`);
      setFiles([]);
    } finally {
      setFilesLoading(false);
    }
  }, [addLog]);

  // ---- 搜索文件 ----
  const handleFileSearch = async () => {
    if (!fileSearch.trim()) {
      await loadFiles(currentCid);
      return;
    }
    setFilesLoading(true);
    try {
      const resp = await pan115Api.searchFile(fileSearch.trim(), currentCid);
      const data = resp.data as Record<string, unknown>;
      const rawList = Array.isArray(data.data)
        ? (data.data as Record<string, unknown>[])
        : Array.isArray(data.list)
          ? (data.list as Record<string, unknown>[])
          : [];
      setFiles(rawList.map(normalizeFile));
    } catch (err: unknown) {
      await addLog("ERROR", `搜索文件失败: ${String(err)}`);
    } finally {
      setFilesLoading(false);
    }
  };

  // ---- 文件夹导航 ----
  const navigateToFolder = async (cid: string, name: string) => {
    setCurrentCid(cid);
    setFileSearch("");

    // 更新 breadcrumb
    const idx = breadcrumb.findIndex(b => b.cid === cid);
    if (idx >= 0) {
      setBreadcrumb(breadcrumb.slice(0, idx + 1));
    } else {
      setBreadcrumb([...breadcrumb, { cid, name }]);
    }

    await loadFiles(cid);
  };

  const navigateToBreadcrumb = async (item: BreadcrumbItem) => {
    setCurrentCid(item.cid);
    setFileSearch("");
    const idx = breadcrumb.findIndex(b => b.cid === item.cid);
    if (idx >= 0) setBreadcrumb(breadcrumb.slice(0, idx + 1));
    await loadFiles(item.cid);
  };

  // ---- 创建文件夹 ----
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setCreatingFolder(true);
    try {
      await pan115Api.createFolder(currentCid, newFolderName.trim());
      setNewFolderName("");
      setShowCreateFolder(false);
      await addLog("SUCCESS", `已创建文件夹: ${newFolderName.trim()}`);
      await loadFiles(currentCid);
    } catch (err: unknown) {
      await addLog("ERROR", `创建文件夹失败: ${String(err)}`);
    } finally {
      setCreatingFolder(false);
    }
  };

  // ---- 离线任务 ----
  const loadOfflineTasks = async () => {
    setTasksLoading(true);
    try {
      const resp = (await pan115Api.getOfflineTasks(1)) as { data: Record<string, unknown> | { tasks: unknown[] } };
      const data = resp.data as Record<string, unknown>;
      const rawTasks: Record<string, unknown>[] = Array.isArray(data.tasks)
        ? (data.tasks as Record<string, unknown>[])
        : [];
      setOfflineTasks(rawTasks.map(normalizeOfflineTask));
    } catch (err: unknown) {
      console.error("Failed to load offline tasks:", err);
    } finally {
      setTasksLoading(false);
    }
  };

  const handleAddTask = async () => {
    if (!addTaskUrl.trim()) return;
    setAddingTask(true);
    try {
      await pan115Api.addOfflineTask(addTaskUrl.trim(), "", addTaskTitle.trim());
      setAddTaskUrl("");
      setAddTaskTitle("");
      setShowAddTask(false);
      await addLog("SUCCESS", "已添加离线下载任务");
      await loadOfflineTasks();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
      await addLog("ERROR", `添加离线任务失败: ${detail}`);
    } finally {
      setAddingTask(false);
    }
  };

  const handleRetryTask = async (task: OfflineTask) => {
    if (!task.infoHash) return;
    try {
      await pan115Api.restartOfflineTask(task.infoHash);
      await addLog("INFO", `已重试离线任务: ${task.name}`);
      await loadOfflineTasks();
    } catch (err: unknown) {
      await addLog("ERROR", `重试失败: ${String(err)}`);
    }
  };

  const handleDeleteTask = async (task: OfflineTask) => {
    if (!task.infoHash) return;
    setDeletingTaskHash(task.infoHash);
    try {
      await pan115Api.deleteOfflineTasks([task.infoHash]);
      setOfflineTasks(prev => prev.filter(t => t.infoHash !== task.infoHash));
      await addLog("WARN", `已删除离线任务: ${task.name}`);
    } catch (err: unknown) {
      await addLog("ERROR", `删除失败: ${String(err)}`);
    } finally {
      setDeletingTaskHash(null);
    }
  };

  const handleClearCompleted = async () => {
    try {
      await pan115Api.clearOfflineTasks("completed");
      await addLog("SUCCESS", "已清空已完成的离线任务");
      await loadOfflineTasks();
    } catch (err: unknown) {
      await addLog("ERROR", `清空失败: ${String(err)}`);
    }
  };

  const handleSetDefaultFolder = async () => {
    if (!defaultFolderId.trim()) return;
    try {
      await pan115Api.setOfflineDefaultFolder(defaultFolderId.trim(), defaultFolderName.trim());
      await addLog("SUCCESS", `已设置默认离线文件夹: ${defaultFolderName || defaultFolderId}`);
    } catch (err: unknown) {
      await addLog("ERROR", `设置默认文件夹失败: ${String(err)}`);
    }
  };

  // ---- 初始化 ----
  useEffect(() => {
    loadStatus();
    loadFiles("0");
    loadOfflineTasks();
  }, []);

  // ---- 风险等级显示 ----
  const riskDisplay = (() => {
    switch (riskStatus) {
      case "normal": case "ok": case "good": case "low":
        return { color: "var(--accent-ok)", bg: "rgba(34,197,94,0.12)", label: "正常" };
      case "warning": case "medium": case "limited":
        return { color: "var(--accent-warn)", bg: "rgba(245,158,11,0.12)", label: "预警" };
      case "high": case "danger": case "blocked":
        return { color: "var(--accent-danger)", bg: "rgba(239,68,68,0.12)", label: "风控" };
      default:
        return { color: "var(--txt-muted)", bg: "var(--surface-subtle)", label: "未知" };
    }
  })();

  const completedCount = offlineTasks.filter(t => t.status === 2).length;

  return (
    <div id="pan115-files-tab" className="space-y-6">
      {/* ====== 转存/解锁进度弹窗 ====== */}
      <Pan115Progress state={progress} onClose={() => setProgress(deriveDefaultProgressState())} />

      {/* ====== 标题横幅 ====== */}
      <div className="glass-heavy rounded-3xl p-6">
        <h2 className="text-2xl font-black tracking-tight flex items-center gap-2.5" style={{ color: "var(--txt)" }}>
          <Layers className="w-6 h-6" style={{ color: "var(--brand-primary)" }} />
          <span>115 网盘管理</span>
        </h2>
        <p className="text-xs mt-1 max-w-xl leading-relaxed" style={{ color: "var(--txt-secondary)" }}>
          管理您的 115 网盘文件、离线下载任务与默认配置。支持文件夹浏览、文件搜索、离线任务增删改与默认文件夹设置。
        </p>
      </div>

      {/* ====== 状态概览卡片 ====== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Cookie 状态 */}
        <div className="glass rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" style={{ color: cookieStatus?.valid ? "var(--accent-ok)" : "var(--accent-danger)" }} />
            <span className="text-xs font-black" style={{ color: "var(--txt)" }}>Cookie 状态</span>
          </div>
          {statusLoading ? (
            <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" }}>加载中…</p>
          ) : cookieStatus?.valid ? (
            <div className="flex items-center gap-2">
              {cookieStatus.avatar && (
                <img src={cookieStatus.avatar} alt="" className="w-7 h-7 rounded-full" referrerPolicy="no-referrer" />
              )}
              <div>
                <p className="text-xs font-bold" style={{ color: "var(--accent-ok)" }}>已登录</p>
                {cookieStatus.username ? (
                  <p className="text-[10px] font-semibold truncate" style={{ color: "var(--txt-muted)" }}>
                    {cookieStatus.username}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-xs font-bold" style={{ color: "var(--accent-danger)" }}>
              {cookieStatus?.message || "未登录或已过期"}
            </p>
          )}
        </div>

        {/* 用户信息 */}
        <div className="glass rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4" style={{ color: "var(--txt-secondary)" }} />
            <span className="text-xs font-black" style={{ color: "var(--txt)" }}>用户信息</span>
          </div>
          {statusLoading ? (
            <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" }}>加载中…</p>
          ) : userInfo ? (
            <div className="space-y-0.5">
              <p className="text-xs font-bold truncate" style={{ color: "var(--txt)" }}>
                {String(userInfo.user_name || userInfo.nickname || userInfo.nick_name || "-")}
              </p>
              <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" }}>
                空间: {String(userInfo.size || userInfo.space || "-")}
                {userInfo.used ? ` / 已用 ${String(userInfo.used)}` : ""}
              </p>
            </div>
          ) : (
            <p className="text-xs font-bold" style={{ color: "var(--txt-muted)" }}>无法获取</p>
          )}
        </div>

        {/* 离线配额 */}
        <div className="glass rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4" style={{ color: "var(--accent-info)" }} />
            <span className="text-xs font-black" style={{ color: "var(--txt)" }}>离线配额</span>
          </div>
          {statusLoading ? (
            <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" }}>加载中…</p>
          ) : offlineQuota ? (
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold" style={{ color: "var(--txt)" }}>
                  {offlineQuota.used} / {offlineQuota.total > 0 ? offlineQuota.total : "∞"}
                </span>
              </div>
              {/* Progress bar */}
              {offlineQuota.total > 0 && (
                <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-subtle)" }}>
                  <div className="h-full rounded-full transition-all" style={{
                    width: `${Math.min(100, (offlineQuota.used / offlineQuota.total) * 100)}%`,
                    background: "var(--accent-info)",
                  }} />
                </div>
              )}
              <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" }}>
                剩余 {offlineQuota.remaining > 0 ? offlineQuota.remaining : "?"} 个任务
              </p>
            </div>
          ) : (
            <p className="text-xs font-bold" style={{ color: "var(--txt-muted)" }}>无法获取</p>
          )}
        </div>

        {/* 风控健康 */}
        <div className="glass rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4" style={{ color: riskDisplay.color }} />
            <span className="text-xs font-black" style={{ color: "var(--txt)" }}>风控状态</span>
          </div>
          {statusLoading ? (
            <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" }}>加载中…</p>
          ) : (
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-full text-[10px] font-black"
                style={{ background: riskDisplay.bg, color: riskDisplay.color }}>
                {riskDisplay.label}
              </span>
              <span className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" }}>{riskStatus}</span>
            </div>
          )}
        </div>
      </div>

      {/* ====== 文件浏览器 + 离线下载（左右分栏） ====== */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ====== 左侧：文件浏览器 ====== */}
        <div className="lg:col-span-3 space-y-4">
          <div className="glass-heavy rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
                <FolderOpen className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
                <span>文件浏览</span>
                <span className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>{files.length} 项</span>
              </h3>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setShowCreateFolder(!showCreateFolder)}
                  className="p-1.5 rounded-lg glass-hover transition-all"
                  style={{ border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
                  title="新建文件夹"
                >
                  <FolderPlus className="w-4 h-4" />
                </button>
                <button
                  onClick={() => loadFiles(currentCid)}
                  className="p-1.5 rounded-lg glass-hover transition-all"
                  style={{ border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
                  title="刷新"
                >
                  <RefreshCw className={`w-4 h-4 ${filesLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* 搜索栏 */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5" style={{ color: "var(--txt-muted)" }} />
                <input
                  type="text"
                  placeholder="搜索文件..."
                  value={fileSearch}
                  onChange={(e) => setFileSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFileSearch()}
                  className="w-full pl-9 pr-3 py-2 rounded-xl text-xs font-semibold outline-none"
                  style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
                />
              </div>
              <button
                onClick={handleFileSearch}
                className="px-3 py-2 rounded-xl text-xs font-bold glass-hover transition-all"
                style={{ background: "var(--brand-primary)", color: "#fff", border: "1px solid var(--brand-primary)" }}
              >
                搜索
              </button>
            </div>

            {/* 新建文件夹表单 */}
            <AnimatePresence>
              {showCreateFolder && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex gap-2 p-3 rounded-xl" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                    <input
                      type="text"
                      placeholder="文件夹名称"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
                      className="flex-1 px-3 py-1.5 rounded-lg text-xs font-bold outline-none"
                      style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
                    />
                    <button
                      onClick={handleCreateFolder}
                      disabled={creatingFolder || !newFolderName.trim()}
                      className="px-3 py-1.5 rounded-lg text-xs font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
                    >
                      {creatingFolder ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      创建
                    </button>
                    <button
                      onClick={() => setShowCreateFolder(false)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold"
                      style={{ color: "var(--txt-muted)", border: "1px solid var(--border)" }}
                    >
                      取消
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Breadcrumb 导航 */}
            <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
              {breadcrumb.map((item, i) => (
                <React.Fragment key={item.cid}>
                  {i > 0 && <ChevronRight className="w-3 h-3" style={{ color: "var(--txt-muted)" }} />}
                  <button
                    onClick={() => navigateToBreadcrumb(item)}
                    className="px-1.5 py-0.5 rounded font-bold transition-all hover:underline"
                    style={{
                      color: i === breadcrumb.length - 1 ? "var(--brand-primary)" : "var(--txt-secondary)",
                    }}
                  >
                    {i === 0 ? <Home className="w-3 h-3 inline mr-0.5 -mt-0.5" /> : null}
                    {item.name}
                  </button>
                </React.Fragment>
              ))}
            </div>

            {/* 文件列表 */}
            {filesLoading ? (
              <div className="text-center py-10">
                <div className="w-7 h-7 border-[3px] rounded-full animate-spin mx-auto" style={{ borderColor: "var(--brand-primary)", borderTopColor: "transparent" }} />
                <p className="text-[10px] font-semibold mt-2" style={{ color: "var(--txt-muted)" }}>加载中…</p>
              </div>
            ) : files.length === 0 ? (
              <div className="text-center py-10 rounded-xl" style={{ background: "var(--surface-subtle)" }}>
                <FolderOpen className="w-8 h-8 mx-auto" style={{ color: "var(--txt-muted)" }} />
                <p className="text-xs font-semibold mt-2" style={{ color: "var(--txt-muted)" }}>
                  {fileSearch ? "没有匹配的文件" : "此目录为空"}
                </p>
              </div>
            ) : (
              <div className="space-y-1 max-h-[480px] overflow-y-auto pr-1 no-scrollbar">
                {files.map((file) => (
                  <div
                    key={file.fid}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all cursor-pointer group glass-hover`}
                    style={{ border: "1px solid transparent" }}
                    onClick={() => {
                      if (file.type === "folder") {
                        navigateToFolder(file.fid, file.name);
                      }
                    }}
                  >
                    {/* 图标 */}
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: file.type === "folder" ? "rgba(139,92,246,0.10)" : "var(--surface-subtle)" }}>
                      {file.type === "folder" ? (
                        <FolderOpen className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
                      ) : file.isVideo ? (
                        <Upload className="w-4 h-4" style={{ color: "var(--accent-info)" }} />
                      ) : (
                        <File className="w-4 h-4" style={{ color: "var(--txt-muted)" }} />
                      )}
                    </div>

                    {/* 文件信息 */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate" style={{ color: "var(--txt)" }}>{file.name}</p>
                      <p className="text-[9px] font-semibold mt-0.5 flex items-center gap-2" style={{ color: "var(--txt-muted)" }}>
                        {file.type === "folder" ? (
                          <span className="px-1 rounded text-[8px]" style={{ background: "rgba(139,92,246,0.12)", color: "var(--brand-primary)" }}>文件夹</span>
                        ) : (
                          <>
                            <span>{file.sizeDisplay}</span>
                            {file.pickCode && <span className="text-[8px] opacity-60">PC: {file.pickCode.slice(0, 8)}…</span>}
                          </>
                        )}
                      </p>
                    </div>

                    {/* 进入箭头（仅文件夹） */}
                    {file.type === "folder" && (
                      <ChevronRight className="w-4 h-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--txt-muted)" }} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ====== 右侧：离线下载 + 默认文件夹 ====== */}
        <div className="lg:col-span-2 space-y-4">
          {/* 离线下载管理 */}
          <div className="glass-heavy rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
                <Download className="w-4 h-4" style={{ color: "var(--accent-info)" }} />
                <span>离线下载</span>
                <span className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>({offlineTasks.length})</span>
              </h3>
              <div className="flex items-center gap-1">
                <button onClick={() => setShowAddTask(!showAddTask)}
                  className="p-1.5 rounded-lg transition-all" style={{ color: "var(--brand-primary)", border: "1px solid var(--border)" }}>
                  <Plus className="w-4 h-4" />
                </button>
                <button onClick={loadOfflineTasks}
                  className="p-1.5 rounded-lg transition-all" style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>
                  <RefreshCw className={`w-4 h-4 ${tasksLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* 添加任务表单 */}
            <AnimatePresence>
              {showAddTask && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                  <div className="space-y-2 p-3 rounded-xl" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                    <input
                      type="text"
                      placeholder="磁力 / HTTP / ED2K 下载链接 *"
                      value={addTaskUrl}
                      onChange={(e) => setAddTaskUrl(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg text-xs font-bold outline-none"
                      style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
                    />
                    <input
                      type="text"
                      placeholder="任务名称（可选）"
                      value={addTaskTitle}
                      onChange={(e) => setAddTaskTitle(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg text-xs font-bold outline-none"
                      style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={handleAddTask}
                        disabled={addingTask || !addTaskUrl.trim()}
                        className="flex-1 px-3 py-1.5 rounded-lg text-xs font-black bg-brand-primary text-white disabled:opacity-50"
                      >
                        {addingTask ? "添加中…" : "添加任务"}
                      </button>
                      <button
                        onClick={() => setShowAddTask(false)}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold"
                        style={{ color: "var(--txt-muted)", border: "1px solid var(--border)" }}
                      >
                        取消
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 任务列表 */}
            {tasksLoading ? (
              <div className="text-center py-6">
                <RefreshCw className="w-5 h-5 animate-spin mx-auto" style={{ color: "var(--txt-muted)" }} />
              </div>
            ) : offlineTasks.length === 0 ? (
              <div className="text-center py-6 rounded-xl" style={{ background: "var(--surface-subtle)" }}>
                <Download className="w-6 h-6 mx-auto" style={{ color: "var(--txt-muted)" }} />
                <p className="text-[10px] font-semibold mt-1.5" style={{ color: "var(--txt-muted)" }}>暂无离线任务</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1 no-scrollbar">
                {offlineTasks.map((task) => (
                  <div key={task.infoHash || task.name} className="rounded-xl p-3 space-y-1.5"
                    style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                    {/* 名称 + 状态 */}
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] font-bold truncate leading-snug" style={{ color: "var(--txt)" }}>
                        {task.name}
                      </p>
                      <span className="shrink-0 px-1.5 py-0.5 rounded text-[8px] font-black"
                        style={{ background: offlineStatusColor(task.status) + "18", color: offlineStatusColor(task.status) }}>
                        {task.statusLabel}
                      </span>
                    </div>

                    {/* 进度条 */}
                    {(task.status === 0 || task.status === 1) && (
                      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-subtle)" }}>
                        <div className="h-full rounded-full transition-all" style={{
                          width: `${task.percent}%`,
                          background: task.status === 1 ? "var(--accent-info)" : "var(--accent-warn)",
                        }} />
                      </div>
                    )}

                    {/* 详情行 */}
                    <div className="flex items-center justify-between text-[9px] font-semibold" style={{ color: "var(--txt-muted)" }}>
                      <div className="flex gap-2">
                        {task.sizeDisplay !== "-" && <span>{task.sizeDisplay}</span>}
                        {task.percent > 0 && task.percent < 100 && <span>{task.percent.toFixed(0)}%</span>}
                      </div>
                      <div className="flex items-center gap-1">
                        {task.status === -1 && (
                          <button
                            onClick={() => handleRetryTask(task)}
                            className="p-1 rounded hover:bg-accent-ok/10"
                            title="重试"
                            style={{ color: "var(--accent-ok)" }}
                          >
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteTask(task)}
                          disabled={deletingTaskHash === task.infoHash}
                          className="p-1 rounded hover:bg-red-500/10 disabled:opacity-50"
                          title="删除"
                          style={{ color: "var(--accent-danger)" }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 清空已完成 */}
            {completedCount > 0 && (
              <button
                onClick={handleClearCompleted}
                className="w-full py-2 rounded-xl text-xs font-bold transition-all glass-hover"
                style={{ color: "var(--accent-danger)", border: "1px solid rgba(239,68,68,0.25)" }}
              >
                清空已完成 ({completedCount} 个)
              </button>
            )}
          </div>

          {/* 默认文件夹设置 */}
          <div className="glass rounded-2xl p-4 space-y-3">
            <h4 className="text-xs font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <Database className="w-3.5 h-3.5" style={{ color: "var(--txt-secondary)" }} />
              <span>默认离线文件夹</span>
            </h4>
            {defaultFolderName ? (
              <p className="text-[11px] font-bold" style={{ color: "var(--txt-secondary)" }}>
                当前: {defaultFolderName}
                <span className="text-[9px] ml-1 font-semibold" style={{ color: "var(--txt-muted)" }}>(ID: {defaultFolderId})</span>
              </p>
            ) : (
              <p className="text-[11px] font-semibold" style={{ color: "var(--txt-muted)" }}>未设置</p>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="文件夹 ID"
                value={defaultFolderId}
                onChange={(e) => setDefaultFolderId(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded-lg text-xs font-bold outline-none"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
              />
              <input
                type="text"
                placeholder="名称"
                value={defaultFolderName}
                onChange={(e) => setDefaultFolderName(e.target.value)}
                className="w-24 px-3 py-1.5 rounded-lg text-xs font-bold outline-none"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
              />
              <button
                onClick={handleSetDefaultFolder}
                disabled={!defaultFolderId.trim()}
                className="px-3 py-1.5 rounded-lg text-xs font-black bg-brand-primary text-white disabled:opacity-50"
              >
                设置
              </button>
            </div>
          </div>

          {/* 使用提示 */}
          <div className="rounded-2xl p-3 flex gap-2 items-start"
            style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.14)" }}>
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "var(--brand-primary)" }} />
            <p className="text-[10px] font-semibold leading-relaxed" style={{ color: "var(--brand-primary)" }}>
              点击文件夹即可进入浏览；离线任务支持磁力 / HTTP / ED2K 链接。设置默认文件夹后，新增离线任务将直接下载到指定目录。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
