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
  FolderOpen, File, Search, Plus, Trash2, RefreshCw, RotateCcw,
  Shield, User, Upload, FolderPlus, Download,
  Layers, ChevronRight, Home, Database, Zap, Info, FileText, Share2, Copy, ArrowRight,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ErrorBanner from "./ui/ErrorBanner";
import { getApiErrorMessage } from "../api/errors";
import { pan115Api } from "../api/pan115";
import Pan115Progress, {
  type Pan115ProgressState,
  deriveDefaultProgressState,
} from "./Pan115Progress";

interface Pan115FilesTabProps {
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => Promise<void>;
}

const FILE_PAGE_SIZE = 100;

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

interface ShareFileItem {
  file_id: string;
  name: string;
  size?: number;
  type: "file" | "folder";
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractRecordList(data: unknown, keys: string[] = ["data", "list", "files", "tasks"]): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter(isPlainRecord);
  }
  if (!isPlainRecord(data)) return [];

  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) {
      return value.filter(isPlainRecord);
    }
    if (isPlainRecord(value)) {
      const nested = extractRecordList(value, keys);
      if (nested.length > 0) return nested;
    }
  }

  return [];
}

function extractTotalCount(data: unknown): number | null {
  if (!isPlainRecord(data)) return null;
  const direct = data.total ?? data.count ?? data.total_count ?? data.file_count;
  const value = Number(direct);
  if (Number.isFinite(value) && value >= 0) return value;
  for (const key of ["data", "meta", "pagination"]) {
    const nested = data[key];
    if (isPlainRecord(nested)) {
      const nestedTotal = extractTotalCount(nested);
      if (nestedTotal !== null) return nestedTotal;
    }
  }
  return null;
}

function unwrapRecord(data: unknown, keys: string[]): Record<string, unknown> {
  if (!isPlainRecord(data)) return {};
  for (const key of keys) {
    const value = data[key];
    if (isPlainRecord(value)) return value;
  }
  return data;
}

function isEnabledFlag(value: unknown): boolean {
  if (value === true) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes";
}

function isFailureFlag(value: unknown): boolean {
  if (value === false || value === 0) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "false" || text === "0" || text === "failed" || text === "fail";
}

function getOperationFailure(data: unknown): string {
  if (!isPlainRecord(data)) return "";

  const errorText = String(
    data.error
    || data.error_msg
    || data.errmsg
    || "",
  ).trim();
  const messageText = String(data.message || data.msg || "").trim();

  const flag = data.success ?? data.state ?? data.ok;
  if (flag !== undefined && isFailureFlag(flag)) {
    return errorText || messageText || "115 返回操作失败";
  }

  if (errorText && flag === undefined) {
    return errorText;
  }

  return "";
}

function assertApiSuccess(data: unknown, fallback: string): void {
  const failure = getOperationFailure(data);
  if (failure) {
    throw new Error(failure || fallback);
  }
}

function normalizeFile(raw: Record<string, unknown>): Pan115File {
  const name = String(raw.n || raw.name || "未命名");
  const size = Number(raw.s ?? raw.size ?? raw.fs ?? 0);
  const icon = String(raw.ico ?? raw.icon ?? "").trim().toLowerCase();
  const fileType = String(raw.t ?? raw.type ?? raw.file_type ?? raw.category ?? "").trim().toLowerCase();
  const isFolder = icon === "folder"
    || fileType === "folder"
    || fileType === "dir"
    || fileType === "directory"
    || fileType === "1"
    || isEnabledFlag(raw.is_dir)
    || isEnabledFlag(raw.is_folder)
    || isEnabledFlag(raw.folder);
  const isVideo = Boolean(raw.iv) || String(raw.iv) === "1" || String(raw.is_video) === "1";
  const fid = String(raw.fid || raw.file_id || raw.id || (isFolder ? raw.cid : "") || "");
  return {
    fid,
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

function sortPan115Files(list: Pan115File[]): Pan115File[] {
  return [...list].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, "zh");
  });
}

function normalizeShareFile(raw: Record<string, unknown>): ShareFileItem {
  const type: "file" | "folder" = isEnabledFlag(raw.is_dir)
    || isEnabledFlag(raw.is_folder)
    || isEnabledFlag(raw.folder)
    || String(raw.type ?? raw.category ?? raw.file_type ?? "").toLowerCase() === "folder"
    ? "folder"
    : "file";
  return {
    file_id: String(raw.file_id || raw.fid || raw.id || ""),
    name: String(raw.name || raw.n || raw.fn || raw.file_name || "未命名"),
    size: Number(raw.size ?? raw.s ?? raw.fs ?? 0),
    type,
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
  const [filesLoadingMore, setFilesLoadingMore] = useState(false);
  const [filesHasMore, setFilesHasMore] = useState(false);
  const [filesTotal, setFilesTotal] = useState<number | null>(null);
  // 文件列表加载/搜索失败信息：与「目录真空」区分，避免错误被空态掩盖
  const [filesError, setFilesError] = useState<string | null>(null);
  const [currentCid, setCurrentCid] = useState("0");
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([{ cid: "0", name: "根目录" }]);
  const [fileSearch, setFileSearch] = useState("");
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  // 离线任务
  const [offlineTasks, setOfflineTasks] = useState<OfflineTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [addTaskUrl, setAddTaskUrl] = useState("");
  const [addTaskTitle, setAddTaskTitle] = useState("");
  const [addingTask, setAddingTask] = useState(false);
  const [deletingTaskHash, setDeletingTaskHash] = useState<string | null>(null);

  // 默认文件夹
  const [defaultFolderId, setDefaultFolderId] = useState("");
  const [defaultFolderName, setDefaultFolderName] = useState("");
  const [transferDefaultFolder, setTransferDefaultFolder] = useState("");
  const [transferDefaultName, setTransferDefaultName] = useState("");
  const [savedTransferDefault, setSavedTransferDefault] = useState({ folderId: "0", folderName: "根目录" });

  // 转存进度弹窗
  const [progress, setProgress] = useState<Pan115ProgressState>(deriveDefaultProgressState());

  // ---- 加载状态概览 ----
  const loadStatus = useCallback(async (): Promise<boolean> => {
    setStatusLoading(true);
    let cookieValid = false;
    try {
      // Cookie 检查
      try {
        const cookieResp = await pan115Api.checkCookie();
        const data = cookieResp.data as Record<string, unknown>;
        const cookieUser = unwrapRecord(data, ["user_info", "data"]);
        cookieValid = Boolean(data.valid || data.success || data.ok);
        const userSnapshot = Object.keys(cookieUser).length > 0 ? cookieUser : null;
        setCookieStatus({
          valid: cookieValid,
          username: String(cookieUser.user_name || cookieUser.username || cookieUser.nickname || cookieUser.nick_name || ""),
          avatar: String(cookieUser.user_face || cookieUser.avatar || cookieUser.face || ""),
          message: String(data.message || data.msg || ""),
        });
        setUserInfo(userSnapshot);
      } catch {
        setCookieStatus({ valid: false, message: "Cookie 无效或已过期" });
      }

      if (!cookieValid) {
        setUserInfo(null);
        setOfflineQuota(null);
        setRiskStatus("auth_invalid");
        return false;
      }

      // 用户信息
      try {
        const userResp = await pan115Api.getUserInfo();
        const userData = unwrapRecord(userResp.data, ["data", "user_info"]);
        setUserInfo(prev => ({ ...(prev || {}), ...userData }));
      } catch {
        setUserInfo(prev => prev);
      }

      // 离线配额
      try {
        const quotaResp = await pan115Api.getOfflineQuota();
        const qData = unwrapRecord(quotaResp.data, ["quota_info", "data"]);
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
        const level = String(rData.status ?? rData.level ?? rData.risk_level ?? "unknown");
        setRiskStatus(level);
      } catch {
        setRiskStatus("unknown");
      }

      // 默认文件夹
      try {
        const dfResp = await pan115Api.getOfflineDefaultFolder();
        const dfData = dfResp.data as Record<string, unknown>;
        setDefaultFolderId(String(dfData.folder_id ?? dfData.cid ?? dfData.fid ?? "0"));
        setDefaultFolderName(String(dfData.folder_name ?? dfData.name ?? "根目录"));
      } catch {
        // 静默
      }
    } finally {
      setStatusLoading(false);
    }
    return cookieValid;
  }, []);

  // ---- 文件列表加载 ----
  const loadFiles = useCallback(async (cid: string, options: { offset?: number; append?: boolean } = {}) => {
    const offset = options.offset ?? 0;
    const append = Boolean(options.append);
    if (append) {
      setFilesLoadingMore(true);
    } else {
      setFilesLoading(true);
      setFilesHasMore(false);
      setFilesTotal(null);
    }
    setFilesError(null);
    try {
      const resp = await pan115Api.getFileList(cid, offset, FILE_PAGE_SIZE);
      const rawList = extractRecordList(resp.data);
      const normalized = sortPan115Files(rawList.map(normalizeFile));
      const total = extractTotalCount(resp.data);
      setFilesTotal(total);
      setFiles(prev => append ? sortPan115Files([...prev, ...normalized]) : normalized);
      setFilesHasMore(total !== null ? offset + rawList.length < total : rawList.length >= FILE_PAGE_SIZE);
    } catch (err: unknown) {
      const msg = getApiErrorMessage(err);
      console.error("Failed to load file list:", msg);
      await addLog("ERROR", `加载 115 文件列表失败: ${msg}`);
      setFilesError(`加载文件列表失败: ${msg}`);
      if (!append) setFiles([]);
    } finally {
      setFilesLoading(false);
      setFilesLoadingMore(false);
    }
  }, [addLog]);

  const loadMoreFiles = async () => {
    if (filesLoadingMore || filesLoading || !filesHasMore || fileSearch.trim()) return;
    await loadFiles(currentCid, { offset: files.length, append: true });
  };

  // ---- 搜索文件 ----
  const handleFileSearch = async () => {
    if (!fileSearch.trim()) {
      await loadFiles(currentCid);
      return;
    }
    setFilesLoading(true);
    setFilesError(null);
    try {
      const resp = await pan115Api.searchFile(fileSearch.trim(), currentCid);
      setFiles(sortPan115Files(extractRecordList(resp.data).map(normalizeFile)));
      setFilesHasMore(false);
      setFilesTotal(null);
    } catch (err: unknown) {
      const detail = getApiErrorMessage(err);
      await addLog("ERROR", `搜索文件失败: ${detail}`);
      setFilesError(`搜索文件失败: ${detail}`);
      setFiles([]);
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
      const resp = await pan115Api.createFolder(currentCid, newFolderName.trim());
      assertApiSuccess(resp.data, "创建文件夹失败");
      const createdName = newFolderName.trim();
      setNewFolderName("");
      setShowCreateFolder(false);
      await addLog("SUCCESS", `已创建文件夹: ${createdName}`);
      await loadFiles(currentCid);
    } catch (err: unknown) {
      await addLog("ERROR", `创建文件夹失败: ${getApiErrorMessage(err)}`);
    } finally {
      setCreatingFolder(false);
    }
  };

  // ---- 离线任务 ----
  const loadOfflineTasks = useCallback(async () => {
    setTasksLoading(true);
    setTasksError(null);
    try {
      const resp = (await pan115Api.getOfflineTasks(1)) as { data: Record<string, unknown> | { tasks: unknown[] } };
      const rawTasks = extractRecordList(resp.data, ["tasks", "data", "list"]);
      setOfflineTasks(rawTasks.map(normalizeOfflineTask));
    } catch (err: unknown) {
      const detail = getApiErrorMessage(err);
      console.error("Failed to load offline tasks:", detail);
      setTasksError(`加载离线任务失败: ${detail}`);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  const handleAddTask = async () => {
    if (!addTaskUrl.trim()) return;
    setAddingTask(true);
    try {
      const targetFolder = defaultFolderId.trim();
      const resp = await pan115Api.addOfflineTask(addTaskUrl.trim(), targetFolder, addTaskTitle.trim());
      assertApiSuccess(resp.data, "添加离线任务失败");
      setAddTaskUrl("");
      setAddTaskTitle("");
      setShowAddTask(false);
      await addLog("SUCCESS", `已添加离线下载任务${defaultFolderName ? `，保存到 ${defaultFolderName}` : ""}`);
      await loadOfflineTasks();
    } catch (err: unknown) {
      const detail = getApiErrorMessage(err);
      await addLog("ERROR", `添加离线任务失败: ${detail}`);
    } finally {
      setAddingTask(false);
    }
  };

  const handleRetryTask = async (task: OfflineTask) => {
    if (!task.infoHash) return;
    try {
      const resp = await pan115Api.restartOfflineTask(task.infoHash);
      assertApiSuccess(resp.data, "重试离线任务失败");
      await addLog("INFO", `已重试离线任务: ${task.name}`);
      await loadOfflineTasks();
    } catch (err: unknown) {
      await addLog("ERROR", `重试失败: ${getApiErrorMessage(err)}`);
    }
  };

  const handleDeleteTask = async (task: OfflineTask) => {
    if (!task.infoHash) return;
    setDeletingTaskHash(task.infoHash);
    try {
      const resp = await pan115Api.deleteOfflineTasks([task.infoHash]);
      assertApiSuccess(resp.data, "删除离线任务失败");
      setOfflineTasks(prev => prev.filter(t => t.infoHash !== task.infoHash));
      await addLog("WARN", `已删除离线任务: ${task.name}`);
    } catch (err: unknown) {
      await addLog("ERROR", `删除失败: ${getApiErrorMessage(err)}`);
    } finally {
      setDeletingTaskHash(null);
    }
  };

  const handleClearCompleted = async () => {
    try {
      const resp = await pan115Api.clearOfflineTasks("completed");
      assertApiSuccess(resp.data, "清空已完成离线任务失败");
      await addLog("SUCCESS", "已清空已完成的离线任务");
      await loadOfflineTasks();
    } catch (err: unknown) {
      await addLog("ERROR", `清空失败: ${getApiErrorMessage(err)}`);
    }
  };

  const handleSetDefaultFolder = async () => {
    if (!defaultFolderId.trim()) return;
    try {
      const resp = await pan115Api.setOfflineDefaultFolder(defaultFolderId.trim(), defaultFolderName.trim());
      assertApiSuccess(resp.data, "设置默认离线文件夹失败");
      const data = resp.data as Record<string, unknown>;
      setDefaultFolderId(String(data.folder_id ?? defaultFolderId.trim()));
      setDefaultFolderName(String(data.folder_name ?? defaultFolderName.trim()));
      await addLog("SUCCESS", `已设置默认离线文件夹: ${defaultFolderName || defaultFolderId}`);
    } catch (err: unknown) {
      await addLog("ERROR", `设置默认文件夹失败: ${getApiErrorMessage(err)}`);
    }
  };

  // ---- 文件操作: 重命名 / 删除 / 复制链接 ----
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const handleRenameFile = async (fid: string, newName: string) => {
    if (!newName.trim()) return;
    try {
      const resp = await pan115Api.renameFile(fid, newName.trim());
      assertApiSuccess(resp.data, "重命名失败");
      setRenamingFile(null);
      await addLog("SUCCESS", `已重命名为: ${newName.trim()}`);
      await loadFiles(currentCid);
    } catch (err: unknown) { await addLog("ERROR", `重命名失败: ${getApiErrorMessage(err)}`); }
  };

  const handleDeleteFile = async (file: Pan115File) => {
    if (!confirm(`确定删除 [${file.name}]？此操作不可撤销。`)) return;
    try {
      const resp = await pan115Api.deleteFile(file.fid);
      assertApiSuccess(resp.data, "删除失败");
      await addLog("WARN", `已删除: ${file.name}`);
      await loadFiles(currentCid);
    } catch (err: unknown) { await addLog("ERROR", `删除失败: ${getApiErrorMessage(err)}`); }
  };

  const handleCopyDownloadUrl = async (pickCode: string, name: string) => {
    try {
      const resp = await pan115Api.getDownloadUrl(pickCode);
      const url = String((resp.data as Record<string, unknown>)?.url || (resp.data as Record<string, unknown>)?.download_url || "");
      if (url) {
        await navigator.clipboard.writeText(url);
        await addLog("SUCCESS", `已复制下载链接: ${name}`);
      } else {
        await addLog("WARN", `无法获取下载链接: ${name}`);
      }
    } catch (err: unknown) { await addLog("ERROR", `获取下载链接失败: ${getApiErrorMessage(err)}`); }
  };

  // ---- 分享管理: 解析 + 浏览 + 保存 ----
  interface ShareState {
    shareUrl: string;
    receiveCode: string;
    files: ShareFileItem[];
    shareCode: string;
    loading: boolean;
    error: string;
  }
  const [share, setShare] = useState<ShareState>({ shareUrl: "", receiveCode: "", files: [], shareCode: "", loading: false, error: "" });
  const [showShare, setShowShare] = useState(false);

  const getTransferTarget = () => {
    const folderId = String(savedTransferDefault.folderId || "0").trim() || "0";
    const folderName = String(savedTransferDefault.folderName || "").trim() || (folderId === "0" ? "根目录" : folderId);
    return { folderId, folderName };
  };

  const handleParseShare = async () => {
    if (!share.shareUrl.trim()) return;
    setShare(s => ({ ...s, loading: true, error: "", files: [] }));
    try {
      const resp = await pan115Api.parseShareLink(share.shareUrl.trim());
      const d = resp.data as Record<string, unknown>;
      const sc = String(d.share_code || d.code || "");
      const rc = share.receiveCode || String(d.receive_code || d.access_code || "");
      if (!sc) {
        throw new Error("未解析到 115 分享码");
      }
      setShare(s => ({ ...s, shareCode: sc, receiveCode: rc, loading: false }));
      // Load share file list
      const flResp = await pan115Api.getShareFileList(sc, rc);
      const rawFiles = extractRecordList(flResp.data, ["list", "files", "data"]);
      setShare(s => ({
        ...s,
        files: rawFiles.map(normalizeShareFile).filter(f => f.file_id),
        loading: false,
      }));
    } catch (err: unknown) {
      setShare(s => ({ ...s, loading: false, error: `解析失败: ${getApiErrorMessage(err)}` }));
    }
  };

  const handleSaveShareFile = async (fileId: string, name: string) => {
    if (!share.shareCode) return;
    const target = getTransferTarget();
    setProgress({
      visible: true,
      phase: "progress",
      status: "loading",
      resourceLabel: name,
      message: `正在转存到 ${target.folderName}`,
      actionType: "transfer",
    });
    try {
      const resp = await pan115Api.saveShareFile(share.shareCode, fileId, target.folderId, share.receiveCode);
      assertApiSuccess(resp.data, "保存分享文件失败");
      setProgress({
        visible: true,
        phase: "result",
        status: "success",
        resourceLabel: name,
        message: `已转存到 ${target.folderName}`,
        actionType: "transfer",
      });
      await addLog("SUCCESS", `已保存分享文件到 ${target.folderName}: ${name}`);
      if (currentCid === target.folderId) await loadFiles(currentCid);
    } catch (err: unknown) {
      const detail = getApiErrorMessage(err);
      setProgress({
        visible: true,
        phase: "result",
        status: "failed",
        resourceLabel: name,
        message: detail,
        actionType: "transfer",
      });
      await addLog("ERROR", `保存失败: ${detail}`);
    }
  };

  const handleSaveAllShare = async () => {
    if (!share.shareCode) return;
    const target = getTransferTarget();
    setProgress({
      visible: true,
      phase: "progress",
      status: "loading",
      resourceLabel: "分享内容",
      message: `正在按后端规则转存到 ${target.folderName}`,
      actionType: "transfer",
    });
    try {
      const resp = await pan115Api.saveShareAll(share.shareCode, target.folderId, share.receiveCode);
      assertApiSuccess(resp.data, "转存分享内容失败");
      setProgress({
        visible: true,
        phase: "result",
        status: "success",
        resourceLabel: "分享内容",
        message: `已提交转存到 ${target.folderName}`,
        actionType: "transfer",
      });
      await addLog("SUCCESS", `已提交分享内容转存到 ${target.folderName}`);
      if (currentCid === target.folderId) await loadFiles(currentCid);
    } catch (err: unknown) {
      const detail = getApiErrorMessage(err);
      setProgress({
        visible: true,
        phase: "result",
        status: "failed",
        resourceLabel: "分享内容",
        message: detail,
        actionType: "transfer",
      });
      await addLog("ERROR", `转存失败: ${detail}`);
    }
  };

  // ---- 文件复制/移动 ----
  const [targetCid, setTargetCid] = useState("");
  const [copyingFile, setCopyingFile] = useState<string | null>(null);

  const handleCopyFile = async (fid: string, name: string) => {
    if (!targetCid.trim()) { await addLog("WARN", "请输入目标目录 CID"); return; }
    setCopyingFile(fid);
    try {
      const resp = await pan115Api.copyFile(fid, targetCid.trim());
      assertApiSuccess(resp.data, "复制失败");
      await addLog("SUCCESS", `已复制到 ${targetCid.trim()}: ${name}`);
    } catch (err: unknown) {
      await addLog("ERROR", `复制失败: ${getApiErrorMessage(err)}`);
    } finally {
      setCopyingFile(null);
    }
  };

  const handleMoveFile = async (fid: string, name: string) => {
    if (!targetCid.trim()) { await addLog("WARN", "请输入目标目录 CID"); return; }
    setCopyingFile(fid);
    try {
      const resp = await pan115Api.moveFile(fid, targetCid.trim());
      assertApiSuccess(resp.data, "移动失败");
      await addLog("SUCCESS", `已移动到 ${targetCid.trim()}: ${name}`);
      await loadFiles(currentCid);
    } catch (err: unknown) {
      await addLog("ERROR", `移动失败: ${getApiErrorMessage(err)}`);
    } finally {
      setCopyingFile(null);
    }
  };

  // ---- 转移默认文件夹 ----
  useEffect(() => {
    pan115Api.getDefaultFolder().then(r => {
      const d = r.data as Record<string, unknown>;
      const folderId = String(d.folder_id || d.cid || "0");
      const folderName = String(d.folder_name || d.name || (folderId === "0" ? "根目录" : ""));
      setTransferDefaultFolder(folderId);
      setTransferDefaultName(folderName);
      setSavedTransferDefault({ folderId, folderName });
    }).catch(() => {});
  }, []);

  const handleSetTransferDefault = async () => {
    if (!transferDefaultFolder.trim()) return;
    try {
      const resp = await pan115Api.setDefaultFolder(transferDefaultFolder.trim(), transferDefaultName.trim());
      assertApiSuccess(resp.data, "设置转存默认文件夹失败");
      const data = resp.data as Record<string, unknown>;
      const folderId = String(data.folder_id ?? transferDefaultFolder.trim());
      const folderName = String(data.folder_name ?? transferDefaultName.trim() ?? "");
      setTransferDefaultFolder(folderId);
      setTransferDefaultName(folderName);
      setSavedTransferDefault({ folderId, folderName });
      await addLog("SUCCESS", `已设置转存默认文件夹: ${folderName || folderId}`);
    } catch (err: unknown) {
      await addLog("ERROR", `设置失败: ${getApiErrorMessage(err)}`);
    }
  };

  const getCurrentFolderName = () => breadcrumb[breadcrumb.length - 1]?.name || (currentCid === "0" ? "根目录" : currentCid);

  const useCurrentFolderAsTarget = () => {
    setTargetCid(currentCid);
  };

  const useCurrentFolderAsTransferDefault = () => {
    setTransferDefaultFolder(currentCid);
    setTransferDefaultName(getCurrentFolderName());
  };

  const useCurrentFolderAsOfflineDefault = () => {
    setDefaultFolderId(currentCid);
    setDefaultFolderName(getCurrentFolderName());
  };

  // ---- 批量分享: saveShareFiles / extractShareFiles / saveShareFilesToFolder ----
  const [batchShareSaving, setBatchShareSaving] = useState(false);
  const handleSaveShareFiles = async () => {
    if (!share.shareCode || share.files.length === 0) return;
    const fileIds = share.files.map(f => f.file_id).filter(Boolean);
    if (fileIds.length === 0) {
      await addLog("WARN", "当前分享列表没有可转存的文件 ID");
      return;
    }
    const target = getTransferTarget();
    setBatchShareSaving(true);
    setProgress({
      visible: true,
      phase: "progress",
      status: "loading",
      resourceLabel: `当前列表 ${fileIds.length} 项`,
      message: `正在转存到 ${target.folderName}`,
      actionType: "transfer",
    });
    try {
      const resp = await pan115Api.saveShareFiles(share.shareCode, fileIds, target.folderId, share.receiveCode);
      assertApiSuccess(resp.data, "批量保存失败");
      setProgress({
        visible: true,
        phase: "result",
        status: "success",
        resourceLabel: `当前列表 ${fileIds.length} 项`,
        message: `已转存到 ${target.folderName}`,
        actionType: "transfer",
      });
      await addLog("SUCCESS", `已批量保存 ${fileIds.length} 个文件到 ${target.folderName}`);
      if (currentCid === target.folderId) await loadFiles(currentCid);
    } catch (err: unknown) {
      const detail = getApiErrorMessage(err);
      setProgress({
        visible: true,
        phase: "result",
        status: "failed",
        resourceLabel: `当前列表 ${fileIds.length} 项`,
        message: detail,
        actionType: "transfer",
      });
      await addLog("ERROR", `批量保存失败: ${detail}`);
    }
    finally { setBatchShareSaving(false); }
  };

  // ---- 初始化 ----
  const loadInitialPan115Data = useCallback(async () => {
    const hasValidCookie = await loadStatus();
    if (!hasValidCookie) {
      setFiles([]);
      setFilesHasMore(false);
      setFilesTotal(null);
      setOfflineTasks([]);
      setTasksError(null);
      return;
    }
    await Promise.all([loadFiles("0"), loadOfflineTasks()]);
  }, [loadFiles, loadOfflineTasks, loadStatus]);

  useEffect(() => {
    void loadInitialPan115Data();
  }, [loadInitialPan115Data]);

  // ---- 风险等级显示 ----
  const riskDisplay = (() => {
    switch (riskStatus) {
      case "healthy": case "normal": case "ok": case "good": case "low":
        return { color: "var(--accent-ok)", bg: "rgba(34,197,94,0.12)", label: "正常" };
      case "warning": case "medium": case "limited": case "rate_limited":
        return { color: "var(--accent-warn)", bg: "rgba(245,158,11,0.12)", label: "受限" };
      case "auth_invalid":
        return { color: "var(--accent-danger)", bg: "rgba(239,68,68,0.12)", label: "需登录" };
      case "high": case "danger": case "blocked":
        return { color: "var(--accent-danger)", bg: "rgba(239,68,68,0.12)", label: "风控" };
      case "unavailable":
        return { color: "var(--accent-danger)", bg: "rgba(239,68,68,0.12)", label: "不可用" };
      default:
        return { color: "var(--txt-muted)", bg: "var(--surface-subtle)", label: "未知" };
    }
  })();

  const completedCount = offlineTasks.filter(t => t.status === 2).length;
  const transferTarget = getTransferTarget();

  return (
    <div id="pan115-files-tab" className="liquid-page space-y-6">
      {/* ====== 转存/解锁进度弹窗 ====== */}
      <Pan115Progress state={progress} onClose={() => setProgress(deriveDefaultProgressState())} />

      {/* ====== 标题横幅 ====== */}
      <div className="liquid-hero glass-heavy glass-iridescent glass-spotlight rounded-3xl p-6">
        <h2 className="text-2xl font-black tracking-tight flex items-center gap-2.5" style={{ color: "var(--txt)" }}>
          <Layers className="w-6 h-6" style={{ color: "var(--brand-primary)" }} />
          <span>网盘工作台</span>
        </h2>
        <p className="text-xs mt-1 max-w-xl leading-relaxed" style={{ color: "var(--txt-secondary)" }}>
          管理 115 网盘文件、离线下载任务与分享转存。账号、Cookie 与默认目录的完整配置在配置中心的网盘集成中维护。
        </p>
      </div>

      {/* ====== 状态概览卡片 ====== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Cookie 状态 */}
        <div className="liquid-stat-card glass rounded-2xl p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4" style={{ color: cookieStatus?.valid ? "var(--accent-ok)" : "var(--accent-danger)" }} />
            <span className="text-xs font-black" style={{ color: "var(--txt)" }}>Cookie 状态</span>
          </div>
          {statusLoading ? (
            <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" }}>加载中…</p>
          ) : cookieStatus?.valid ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                {cookieStatus.avatar && <img src={cookieStatus.avatar} alt="" className="w-7 h-7 rounded-full" referrerPolicy="no-referrer" />}
                <div>
                  <p className="text-xs font-bold" style={{ color: "var(--accent-ok)" }}>已登录</p>
                  {cookieStatus.username ? <p className="text-[10px] font-semibold truncate" style={{ color: "var(--txt-muted)" }}>{cookieStatus.username}</p> : null}
                </div>
              </div>
              <div className="pt-1.5" style={{ borderTop: "1px solid var(--border)" }}>
                <p className="text-[9px] font-semibold leading-snug" style={{ color: "var(--txt-muted)" }}>
                  账号与扫码登录在配置中心的网盘集成中维护。
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs font-bold" style={{ color: "var(--accent-danger)" }}>{cookieStatus?.message || "未登录或已过期"}</p>
              <p className="text-[9px] font-semibold leading-snug" style={{ color: "var(--txt-muted)" }}>
                请前往配置中心的网盘集成重新扫码登录或更新 Cookie。
              </p>
            </div>
          )}
        </div>

        {/* 用户信息 */}
        <div className="liquid-stat-card glass rounded-2xl p-4 space-y-2">
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
                空间: {String(userInfo.space_total_format || userInfo.size || userInfo.space || "-")}
                {userInfo.space_used_format || userInfo.used ? ` / 已用 ${String(userInfo.space_used_format || userInfo.used)}` : ""}
              </p>
            </div>
          ) : (
            <p className="text-xs font-bold" style={{ color: "var(--txt-muted)" }}>无法获取</p>
          )}
        </div>

        {/* 离线配额 */}
        <div className="liquid-stat-card glass rounded-2xl p-4 space-y-2">
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
        <div className="liquid-stat-card glass rounded-2xl p-4 space-y-2">
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
          <div className="liquid-panel glass-heavy glass-iridescent rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
                <FolderOpen className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
                <span>文件浏览</span>
                <span className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>
                  {files.length}{filesTotal !== null ? ` / ${filesTotal}` : ""} 项
                </span>
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

            {/* 复制/移动目标 CID */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[9px] font-bold shrink-0" style={{ color: "var(--txt-muted)" }}>目标CID:</span>
              <input
                type="text" placeholder="用于复制/移动的目标目录 CID"
                value={targetCid} onChange={e => setTargetCid(e.target.value)}
                className="flex-1 min-w-[12rem] px-2.5 py-1.5 rounded-lg text-[10px] font-semibold outline-none"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
              />
              <button
                onClick={useCurrentFolderAsTarget}
                className="px-2.5 py-1.5 rounded-lg text-[10px] font-black glass-hover"
                style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
              >
                使用当前目录
              </button>
            </div>

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
            ) : filesError ? (
              <div className="text-center py-10 rounded-xl" style={{ background: "var(--surface-subtle)" }}>
                <ErrorBanner variant="block" message={filesError} onRetry={() => (fileSearch.trim() ? handleFileSearch() : loadFiles(currentCid))} />
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
                      style={{ background: file.type === "folder" ? "var(--brand-primary-bg-alpha)" : "var(--surface-subtle)" }}>
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
                          <span className="px-1 rounded text-[8px]" style={{ background: "var(--brand-primary-bg-alpha)", color: "var(--brand-primary)" }}>文件夹</span>
                        ) : (
                          <>
                            <span>{file.sizeDisplay}</span>
                            {file.pickCode && <span className="text-[8px] opacity-60">PC: {file.pickCode.slice(0, 8)}…</span>}
                          </>
                        )}
                      </p>
                    </div>

                    {/* 文件操作按钮 */}
                    <div className="flex items-center gap-1 shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      {file.type === "folder" ? (
                        <ChevronRight className="w-4 h-4" style={{ color: "var(--txt-muted)" }} />
                      ) : (
                        <>
                          {renamingFile === file.fid ? (
                            <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={e => setRenameValue(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") handleRenameFile(file.fid, renameValue); if (e.key === "Escape") setRenamingFile(null); }}
                                className="w-24 px-1.5 py-0.5 text-[10px] rounded border outline-none"
                                style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--txt)" }}
                              />
                              <button onClick={() => handleRenameFile(file.fid, renameValue)}
                                className="text-[9px] px-1.5 py-0.5 rounded font-bold" style={{ background: "var(--brand-primary)", color: "#fff" }}>确定</button>
                            </div>
                          ) : (
                            <>
                              {file.pickCode && (
                                <button onClick={(e) => { e.stopPropagation(); handleCopyDownloadUrl(file.pickCode, file.name); }}
                                  className="p-1 rounded hover:bg-[var(--surface-hover)]" title="复制下载链接"
                                  aria-label={`复制下载链接: ${file.name}`}
                                  style={{ color: "var(--txt-muted)" }}>
                                  <Download className="w-3 h-3" />
                                </button>
                              )}
                              <button onClick={(e) => { e.stopPropagation(); setRenamingFile(file.fid); setRenameValue(file.name); }}
                                className="p-1 rounded hover:bg-[var(--surface-hover)]" title="重命名"
                                aria-label={`重命名: ${file.name}`}
                                style={{ color: "var(--txt-muted)" }}>
                                <FileText className="w-3 h-3" />
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); handleDeleteFile(file); }}
                                className="p-1 rounded hover:bg-[rgba(239,68,68,0.12)]" title="删除"
                                aria-label={`删除: ${file.name}`}
                                style={{ color: "var(--accent-danger)" }}>
                                <Trash2 className="w-3 h-3" />
                              </button>
                              {targetCid.trim() && (
                                <>
                                  <button onClick={(e) => { e.stopPropagation(); handleCopyFile(file.fid, file.name); }}
                                    disabled={copyingFile === file.fid}
                                    className="p-1 rounded hover:bg-[var(--surface-hover)]" title="复制到目标"
                                    aria-label={`复制到目标: ${file.name}`}
                                    style={{ color: "var(--txt-muted)" }}>
                                    <Copy className="w-3 h-3" />
                                  </button>
                                  <button onClick={(e) => { e.stopPropagation(); handleMoveFile(file.fid, file.name); }}
                                    disabled={copyingFile === file.fid}
                                    className="p-1 rounded hover:bg-[var(--surface-hover)]" title="移动到目标"
                                    aria-label={`移动到目标: ${file.name}`}
                                    style={{ color: "var(--txt-muted)" }}>
                                    <ArrowRight className="w-3 h-3" />
                                  </button>
                                </>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {filesHasMore && !fileSearch.trim() && (
                  <button
                    onClick={loadMoreFiles}
                    disabled={filesLoadingMore}
                    className="w-full mt-2 py-2 rounded-xl text-xs font-black glass-hover disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${filesLoadingMore ? "animate-spin" : ""}`} />
                    {filesLoadingMore ? "加载中…" : "加载更多"}
                  </button>
                )}
                {filesHasMore && fileSearch.trim() && (
                  <p className="text-[10px] font-semibold text-center pt-2" style={{ color: "var(--txt-muted)" }}>
                    搜索结果不分页，清空搜索后可继续加载目录内容
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ====== 右侧：离线下载 + 默认文件夹 ====== */}
        <div className="lg:col-span-2 space-y-4">
          {/* 离线下载管理 */}
          <div className="liquid-panel glass-heavy glass-iridescent rounded-2xl p-4 space-y-4">
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
                      placeholder="备注（仅用于日志，可选）"
                      value={addTaskTitle}
                      onChange={(e) => setAddTaskTitle(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-lg text-xs font-bold outline-none"
                      style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
                    />
                    <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" }}>
                      保存到默认离线文件夹: {defaultFolderName || defaultFolderId || "后端默认目录"}
                    </p>
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
            ) : tasksError ? (
              <div className="rounded-xl" style={{ background: "var(--surface-subtle)" }}>
                <ErrorBanner variant="block" message={tasksError} onRetry={loadOfflineTasks} />
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
                style={{ color: "var(--accent-danger)", border: "1px solid rgba(239,68,68,0.3)" }}
              >
                清空已完成 ({completedCount} 个)
              </button>
            )}
          </div>

          {/* 分享转存默认文件夹 */}
          <div className="glass rounded-2xl p-4 space-y-3">
            <h4 className="text-xs font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <FolderOpen className="w-3.5 h-3.5" style={{ color: "var(--txt-secondary)" }} />
              <span>分享转存默认文件夹</span>
            </h4>
            <p className="text-[11px] font-bold" style={{ color: "var(--txt-secondary)" }}>
              已保存: {savedTransferDefault.folderName || savedTransferDefault.folderId}
              <span className="text-[9px] ml-1 font-semibold" style={{ color: "var(--txt-muted)" }}>
                (ID: {savedTransferDefault.folderId})
              </span>
            </p>
            <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_3.5rem] gap-2">
              <input type="text" placeholder="文件夹 ID" value={transferDefaultFolder} onChange={e => setTransferDefaultFolder(e.target.value)}
                className="min-w-0 px-3 py-1.5 rounded-lg text-xs font-bold outline-none"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }} />
              <input type="text" placeholder="名称" value={transferDefaultName} onChange={e => setTransferDefaultName(e.target.value)}
                className="min-w-0 px-3 py-1.5 rounded-lg text-xs font-bold outline-none"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }} />
              <button onClick={handleSetTransferDefault} disabled={!transferDefaultFolder.trim()}
                className="shrink-0 min-w-[3.5rem] px-3 py-1.5 rounded-lg text-xs font-black bg-brand-primary text-white disabled:opacity-50">设置</button>
            </div>
            <button
              onClick={useCurrentFolderAsTransferDefault}
              className="w-full py-1.5 rounded-lg text-[10px] font-black glass-hover"
              style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              使用当前目录
            </button>
          </div>

          {/* 默认离线文件夹 */}
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
            <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_3.5rem] gap-2">
              <input
                type="text"
                placeholder="文件夹 ID"
                value={defaultFolderId}
                onChange={(e) => setDefaultFolderId(e.target.value)}
                className="min-w-0 px-3 py-1.5 rounded-lg text-xs font-bold outline-none"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
              />
              <input
                type="text"
                placeholder="名称"
                value={defaultFolderName}
                onChange={(e) => setDefaultFolderName(e.target.value)}
                className="min-w-0 px-3 py-1.5 rounded-lg text-xs font-bold outline-none"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
              />
              <button
                onClick={handleSetDefaultFolder}
                disabled={!defaultFolderId.trim()}
                className="shrink-0 min-w-[3.5rem] px-3 py-1.5 rounded-lg text-xs font-black bg-brand-primary text-white disabled:opacity-50"
              >
                设置
              </button>
            </div>
            <button
              onClick={useCurrentFolderAsOfflineDefault}
              className="w-full py-1.5 rounded-lg text-[10px] font-black glass-hover"
              style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              使用当前目录
            </button>
          </div>

          {/* 分享链接管理 */}
          <div className="glass rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
                <Share2 className="w-3.5 h-3.5" style={{ color: "var(--brand-primary)" }} />
                <span>分享链接转存</span>
              </h4>
              <button onClick={() => setShowShare(!showShare)}
                className="text-[10px] font-bold px-2 py-1 rounded-lg glass-hover"
                style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>
                {showShare ? "收起" : "展开"}
              </button>
            </div>
            {showShare && (
              <div className="space-y-2">
                <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" }}>
                  当前转存目标: {transferTarget.folderName}
                  <span className="ml-1">(ID: {transferTarget.folderId})</span>
                </p>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder="115 分享链接"
                    value={share.shareUrl}
                    onChange={e => setShare(s => ({ ...s, shareUrl: e.target.value }))}
                    className="flex-1 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold outline-none"
                    style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
                  />
                  <input
                    type="text"
                    placeholder="提取码"
                    value={share.receiveCode}
                    onChange={e => setShare(s => ({ ...s, receiveCode: e.target.value }))}
                    className="w-20 px-2.5 py-1.5 rounded-lg text-[10px] font-semibold outline-none"
                    style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
                  />
                  <button
                    onClick={handleParseShare}
                    disabled={share.loading || !share.shareUrl.trim()}
                    className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
                  >
                    {share.loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                    解析
                  </button>
                </div>
                {share.error && <p className="text-[10px] font-semibold" style={{ color: "var(--accent-danger)" }}>{share.error}</p>}
                {share.files.length > 0 && (
                  <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1">
                    {share.files.slice(0, 30).map(f => (
                      <div key={f.file_id} className="flex items-center justify-between rounded-lg px-2 py-1.5"
                        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                        <span className="text-[10px] font-semibold truncate" style={{ color: "var(--txt)" }}>{f.name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {f.type === "folder" && (
                            <span className="text-[8px] font-semibold" style={{ color: "var(--brand-primary)" }}>目录</span>
                          )}
                          {f.size && f.size > 0 && (
                            <span className="text-[8px] font-semibold" style={{ color: "var(--txt-muted)" }}>{formatBytes(f.size)}</span>
                          )}
                          <button onClick={() => handleSaveShareFile(f.file_id, f.name)}
                            disabled={!f.file_id}
                            className="px-1.5 py-0.5 rounded text-[8px] font-black text-white"
                            style={{ background: "var(--brand-primary)" }}>
                            转存
                          </button>
                        </div>
                      </div>
                    ))}
                    {share.files.length > 1 && (
                      <div className="space-y-1">
                        <button onClick={handleSaveAllShare}
                          className="w-full py-1.5 rounded-lg text-[10px] font-black text-white mt-1"
                          style={{ background: "var(--brand-primary)" }}>
                          按规则转存分享内容
                        </button>
                        <button onClick={handleSaveShareFiles} disabled={batchShareSaving}
                          className="w-full py-1.5 rounded-lg text-[10px] font-black text-white disabled:opacity-50"
                          style={{ background: "var(--accent-info)" }}>
                          {batchShareSaving ? "转存当前列表中…" : `转存当前列表 (${share.files.length} 项)`}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 使用提示 */}
          <div className="rounded-2xl p-3 flex gap-2 items-start"
            style={{ background: "var(--brand-primary-bg-alpha)", border: "1px solid var(--brand-primary-border-alpha)" }}>
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "var(--brand-primary)" }} />
            <p className="text-[10px] font-semibold leading-relaxed" style={{ color: "var(--brand-primary)" }}>
              点击文件夹即可进入浏览；离线任务支持磁力 / HTTP / ED2K 链接。分享链接解析后可选择单个或全量转存到网盘。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
