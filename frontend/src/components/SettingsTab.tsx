/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from "react";
import { SyncLog } from "../types";
import {
  Save,
  Key,
  RefreshCw,
  Server,
  Database,
  HeartPulse,
  Radio,
  Wifi,
  Play,
  BarChart3,
  AlertTriangle,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { settingsApi } from "../api/settings";
import { pan115Api } from "../api/pan115";
import { quarkApi } from "../api/quark";
import { authApi } from "../api/auth";
import { pansouApi } from "../api/pansou";
import { moviepilotApi } from "../api/moviepilot";
import { twilightApi } from "../api/twilight";
import { animeApi } from "../api/anime";
import { archiveApi } from "../api/archive";
import { getApiErrorMessage } from "../api/errors";
import type { AniRssDownloadClientStatus } from "../api/types";
import SettingsSectionNav from "./settings/SettingsSectionNav";
import CloudDrivesSettings from "./settings/CloudDrivesSettings";
import DiagnosticStatusGrid from "./settings/DiagnosticStatusGrid";
import ResourcePriorityOptions from "./settings/ResourcePriorityOptions";
import ResourceMetadataSettings from "./settings/ResourceMetadataSettings";
import TelegramSettings from "./settings/TelegramSettings";
import SettingsLogsPanel from "./settings/SettingsLogsPanel";
import type { SettingsSection, StatusSummary } from "./settings/types";
import {
  buildTgBotRuntimePayload,
  buildTgRuntimePayload,
  formatIdListInput,
  formatTgChannelsInput,
} from "../utils/tgRuntimeSettings";
import {
  DEFAULT_PAN115_QR_LOGIN_APP,
  extractPan115QrLoginAppOptions,
  selectPan115QrLoginApp,
  type Pan115QrLoginAppOption,
} from "../utils/pan115QrLogin";

interface SettingsTabProps {
  logs: SyncLog[];
  setLogs: React.Dispatch<React.SetStateAction<SyncLog[]>>;
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => void;
}

function formatJsonConfig(value: unknown): string {
  if (value == null) return "";
  return JSON.stringify(value, null, 2);
}

function parseJsonConfig(value: string, label: string): Record<string, unknown> | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

function formatListInput(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((item) => String(item ?? "").trim()).filter(Boolean).join("\n");
}

function parseListInput(value: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  String(value || "")
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      if (seen.has(item)) return;
      seen.add(item);
      items.push(item);
    });
  return items;
}

function formatJsonInput(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  return JSON.stringify(value, null, 2);
}

function parseChartSources(value: string): unknown[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("榜单来源必须是 JSON 数组");
  }
  return parsed;
}

function isFailureFlag(value: unknown): boolean {
  if (value === false || value === 0) return true;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "false" || text === "0" || text === "failed" || text === "error";
}

function getActionFailure(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const record = data as Record<string, unknown>;
  const flag = record.ok ?? record.success ?? record.valid ?? record.all_valid;
  const status = String(record.status || "").trim().toLowerCase();
  const message = String(record.message || record.detail || record.error || record.msg || "").trim();
  if (flag !== undefined && isFailureFlag(flag)) return message || "操作返回失败状态";
  if (status === "error" || status === "failed") return message || "操作返回失败状态";
  if ((record.error || record.detail) && flag === undefined) return message || "操作返回错误";
  return "";
}

function formatActionMessage(data: unknown): string {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return String(data ?? "OK");
  const record = data as Record<string, unknown>;
  const message = record.message || record.detail || record.msg;
  if (message) return String(message);
  return JSON.stringify(data).slice(0, 240);
}

function getStatusSummary(data: unknown): StatusSummary {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { state: "未加载", ok: null, message: "尚未获取状态" };
  }
  const record = data as Record<string, unknown>;
  const flag = record.valid ?? record.ok ?? record.success ?? record.all_valid ?? record.configured;
  const status = String(record.status || "").trim();
  const message = String(record.message || record.detail || record.summary || "").trim()
    || JSON.stringify(data).slice(0, 160);
  if (typeof record.running === "boolean") {
    return { state: record.running ? "运行中" : "已停止", ok: record.running ? true : null, message };
  }
  if (flag === true) return { state: "正常", ok: true, message };
  if (flag === false) return { state: "异常", ok: false, message };
  if (status) {
    const bad = ["error", "failed", "unavailable"].includes(status.toLowerCase());
    const good = ["ok", "success", "healthy"].includes(status.toLowerCase());
    return { state: status, ok: good ? true : bad ? false : null, message };
  }
  return { state: "已加载", ok: null, message };
}

export default function SettingsTab({ logs, setLogs, addLog }: SettingsTabProps) {
  const [activeTab, setActiveTab] = useState<SettingsSection>("cloud");

  // ---- 1. Core Section States ----
  const [cookie115, setCookie115] = useState("");
  const [pan115TransferDefaultFolderId, setPan115TransferDefaultFolderId] = useState("0");
  const [pan115TransferDefaultFolderName, setPan115TransferDefaultFolderName] = useState("根目录");
  const [pan115OfflineDefaultFolderId, setPan115OfflineDefaultFolderId] = useState("0");
  const [pan115OfflineDefaultFolderName, setPan115OfflineDefaultFolderName] = useState("根目录");
  const [localMountPath, setLocalMountPath] = useState("");
  const [embyUrl, setEmbyUrl] = useState("");
  const [embyKey, setEmbyKey] = useState("");
  const [refreshInterval, setRefreshInterval] = useState(15);
  const [embySyncEnabled, setEmbySyncEnabled] = useState(false);
  const [embySyncIntervalMinutes, setEmbySyncIntervalMinutes] = useState(1440);

  // ---- 2. Third-party Integrations Section States ----
  // Quark
  const [quarkCookie, setQuarkCookie] = useState("");
  const [quarkDefaultFolderId, setQuarkDefaultFolderId] = useState("0");
  const [quarkDefaultFolderName, setQuarkDefaultFolderName] = useState("根目录");
  // Feiniu
  const [feiniuUrl, setFeiniuUrl] = useState("");
  const [feiniuSecret, setFeiniuSecret] = useState("");
  const [feiniuApiKey, setFeiniuApiKey] = useState("");
  const [feiniuSessionToken, setFeiniuSessionToken] = useState("");
  const [feiniuSyncEnabled, setFeiniuSyncEnabled] = useState(false);
  const [feiniuSyncIntervalMinutes, setFeiniuSyncIntervalMinutes] = useState(1440);
  // MoviePilot
  const [moviepilotEnabled, setMoviepilotEnabled] = useState(false);
  const [moviepilotBaseUrl, setMoviepilotBaseUrl] = useState("");
  const [moviepilotUsername, setMoviepilotUsername] = useState("");
  const [moviepilotPassword, setMoviepilotPassword] = useState("");
  const [moviepilotPasswordConfigured, setMoviepilotPasswordConfigured] = useState(false);
  const [moviepilotSavePath, setMoviepilotSavePath] = useState("");
  const [moviepilotSyncEnabled, setMoviepilotSyncEnabled] = useState(false);
  const [moviepilotSyncIntervalMinutes, setMoviepilotSyncIntervalMinutes] = useState(60);
  // ANI-RSS
  const [anirssEnabled, setAnirssEnabled] = useState(false);
  const [anirssBaseUrl, setAnirssBaseUrl] = useState("");
  const [mikanBaseUrl, setMikanBaseUrl] = useState("https://mikanani.me");
  const [anirssApiKey, setAnirssApiKey] = useState("");
  const [anirssApiKeyConfigured, setAnirssApiKeyConfigured] = useState(false);
  const [anirssDefaultDownloadPath, setAnirssDefaultDownloadPath] = useState("");
  const [anirssDownloadPathPresetsInput, setAnirssDownloadPathPresetsInput] = useState("");
  const [anirssDownloadClientStatus, setAnirssDownloadClientStatus] = useState<AniRssDownloadClientStatus | null>(null);
  // Twilight
  const [twilightEnabled, setTwilightEnabled] = useState(false);
  const [twilightBaseUrl, setTwilightBaseUrl] = useState("");
  const [twilightWebUrl, setTwilightWebUrl] = useState("");
  const [twilightApiKey, setTwilightApiKey] = useState("");
  const [twilightApiKeyConfigured, setTwilightApiKeyConfigured] = useState(false);
  // HDHive
  const [hdhiveCookie, setHdhiveCookie] = useState("");
  const [hdhiveBaseUrl, setHdhiveBaseUrl] = useState("https://hdhive.com/");
  const [hdhiveLoginUsername, setHdhiveLoginUsername] = useState("");
  const [hdhiveAutoCheckinEnabled, setHdhiveAutoCheckinEnabled] = useState(false);
  const [hdhiveAutoCheckinMode, setHdhiveAutoCheckinMode] = useState("normal");
  const [hdhiveAutoCheckinMethod, setHdhiveAutoCheckinMethod] = useState("cookie");
  const [hdhiveAutoCheckinRunTime, setHdhiveAutoCheckinRunTime] = useState("09:00");
  // TMDB / Pansou
  const [tmdbApiKey, setTmdbApiKey] = useState("");
  const [tmdbBaseUrl, setTmdbBaseUrl] = useState("https://api.themoviedb.org/3");
  const [tmdbImageBaseUrl, setTmdbImageBaseUrl] = useState("https://image.tmdb.org/t/p/w500");
  const [tmdbLanguage, setTmdbLanguage] = useState("zh-CN");
  const [tmdbRegion, setTmdbRegion] = useState("CN");
  const [tmdbLocalDbPath, setTmdbLocalDbPath] = useState("data/tmdb_base.db");
  const [pansouBaseUrl, setPansouBaseUrl] = useState("");

  // ---- 3. Telegram Section States ----
  const [tgApiId, setTgApiId] = useState("");
  const [tgApiHash, setTgApiHash] = useState("");
  const [tgPhone, setTgPhone] = useState("");
  const [tgChannelsInput, setTgChannelsInput] = useState("");
  const [tgSearchDays, setTgSearchDays] = useState(30);
  const [tgMaxMessagesPerChannel, setTgMaxMessagesPerChannel] = useState(200);
  // TG Bot
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgBotEnabled, setTgBotEnabled] = useState(false);
  const [tgBotAllowedUsersInput, setTgBotAllowedUsersInput] = useState("");
  const [tgBotNotifyChatIdsInput, setTgBotNotifyChatIdsInput] = useState("");
  const [tgBotHdhiveAutoUnlock, setTgBotHdhiveAutoUnlock] = useState(false);
  // TG Index
  const [tgIndexEnabled, setTgIndexEnabled] = useState(true);
  const [tgSession, setTgSession] = useState("");
  const [tgIndexRealtimeFallbackEnabled, setTgIndexRealtimeFallbackEnabled] = useState(true);
  const [tgIndexQueryLimitPerChannel, setTgIndexQueryLimitPerChannel] = useState(120);
  const [tgBackfillBatchSize, setTgBackfillBatchSize] = useState(200);
  const [tgIncrementalIntervalMinutes, setTgIncrementalIntervalMinutes] = useState(30);

  // ---- 4. Diagnostics & Proxy Section States ----
  const [httpProxy, setHttpProxy] = useState("");
  const [httpsProxy, setHttpsProxy] = useState("");
  const [allProxy, setAllProxy] = useState("");
  const [socksProxy, setSocksProxy] = useState("");
  const [updateSourceType, setUpdateSourceType] = useState("official");
  const [updateRepository, setUpdateRepository] = useState("wangsy1007/mediasync115");

  // ---- 5. Archive & Subscriptions Section States ----
  const [archiveEnabled, setArchiveEnabled] = useState(false);
  const [archiveWatchCid, setArchiveWatchCid] = useState("");
  const [archiveWatchName, setArchiveWatchName] = useState("");
  const [archiveOutputCid, setArchiveOutputCid] = useState("");
  const [archiveOutputName, setArchiveOutputName] = useState("");
  const [archiveIntervalMinutes, setArchiveIntervalMinutes] = useState(10);
  const [archiveAutoOnTransfer, setArchiveAutoOnTransfer] = useState(true);
  const [archiveAutoOnOffline, setArchiveAutoOnOffline] = useState(true);
  const [offlineMonitorIntervalMinutes, setOfflineMonitorIntervalMinutes] = useState(3);
  const [archiveSubdirsInput, setArchiveSubdirsInput] = useState("");
  const [archiveNamingInput, setArchiveNamingInput] = useState("");
  // Advanced subscriptions
  const [subscriptionEnabled, setSubscriptionEnabled] = useState(false);
  const [subscriptionOfflineTransferEnabled, setSubscriptionOfflineTransferEnabled] = useState(false);
  const [subscriptionHdhiveAutoUnlockEnabled, setSubscriptionHdhiveAutoUnlockEnabled] = useState(false);
  const [subscriptionHdhiveUnlockMaxPointsPerItem, setSubscriptionHdhiveUnlockMaxPointsPerItem] = useState(10);
  const [subscriptionHdhiveUnlockBudgetPointsPerRun, setSubscriptionHdhiveUnlockBudgetPointsPerRun] = useState(30);
  const [subscriptionHdhiveUnlockThresholdInclusive, setSubscriptionHdhiveUnlockThresholdInclusive] = useState(true);
  const [subscriptionHdhivePreferFree, setSubscriptionHdhivePreferFree] = useState(true);
  const [subscriptionResourcePriority, setSubscriptionResourcePriority] = useState<string[]>(["hdhive", "pansou", "tg"]);
  // Chart subscriptions
  const [chartSubscriptionEnabled, setChartSubscriptionEnabled] = useState(false);
  const [chartSubscriptionLimit, setChartSubscriptionLimit] = useState(20);
  const [chartSubscriptionIntervalHours, setChartSubscriptionIntervalHours] = useState(24);
  const [chartSubscriptionSourcesInput, setChartSubscriptionSourcesInput] = useState("");
  // Person Follow
  const [personFollowEnabled, setPersonFollowEnabled] = useState(false);
  const [personFollowIntervalHours, setPersonFollowIntervalHours] = useState(24);
  const [personFollowAutoSubscribe, setPersonFollowAutoSubscribe] = useState(true);

  // ---- 6. Security & Display Preferences Section States ----
  const [accountUsername, setAccountUsername] = useState("admin");
  const [accountCurrentPassword, setAccountCurrentPassword] = useState("");
  const [accountNewPassword, setAccountNewPassword] = useState("");
  const [accountNewPasswordConfirm, setAccountNewPasswordConfirm] = useState("");
  // Resource quality preferences
  const [resourcePreferredResolutions, setResourcePreferredResolutions] = useState("");
  const [resourcePreferredHdr, setResourcePreferredHdr] = useState("");
  const [resourcePreferredCodec, setResourcePreferredCodec] = useState("");
  const [resourcePreferredAudio, setResourcePreferredAudio] = useState("");
  const [resourcePreferredSubtitles, setResourcePreferredSubtitles] = useState("");
  const [resourceExcludeTags, setResourceExcludeTags] = useState("");
  const [resourceMinSizeGb, setResourceMinSizeGb] = useState("");
  const [resourceMaxSizeGb, setResourceMaxSizeGb] = useState("");
  // Display detail tabs
  const [detailVisibleTabs, setDetailVisibleTabs] = useState<string[]>([]);

  // ---- UX & Loading Indicators ----
  const [configLoaded, setConfigLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting115, setIsTesting115] = useState(false);
  const [isTestingEmby, setIsTestingEmby] = useState(false);
  const [isTestingFeiniu, setIsTestingFeiniu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

  const savedCookieRef = useRef("");
  const savedPan115TransferDefaultRef = useRef({ folderId: "0", folderName: "根目录" });
  const savedPan115OfflineDefaultRef = useRef({ folderId: "0", folderName: "根目录" });
  const savedQuarkCookieRef = useRef("");
  const savedQuarkDefaultRef = useRef({ folderId: "0", folderName: "根目录" });
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const pan115QrSessionRef = useRef(0);

  // Service health and status hooks
  const [healthAll, setHealthAll] = useState<unknown>(null);
  const [botStatus, setBotStatus] = useState<unknown>(null);
  const [hdhiveLoginStatus, setHdhiveLoginStatus] = useState<unknown>(null);
  const [availableCharts, setAvailableCharts] = useState<unknown>(null);
  const [tgLoginStatus, setTgLoginStatus] = useState<unknown>(null);
  const [proxyInfo, setProxyInfo] = useState<unknown>(null);

  // 115 QR Login state
  const [pan115QrToken, setPan115QrToken] = useState<string | null>(null);
  const [pan115QrImage, setPan115QrImage] = useState<string | null>(null);
  const [pan115QrPolling, setPan115QrPolling] = useState(false);
  const [pan115QrStatus, setPan115QrStatus] = useState<string | null>(null);
  const [pan115QrApps, setPan115QrApps] = useState<Pan115QrLoginAppOption[]>([]);
  const [pan115QrApp, setPan115QrApp] = useState(DEFAULT_PAN115_QR_LOGIN_APP);
  const [pan115QrAppsLoading, setPan115QrAppsLoading] = useState(false);

  // Telegram QR Login state
  const [tgQrToken, setTgQrToken] = useState<string | null>(null);
  const [tgQrImage, setTgQrImage] = useState<string | null>(null);
  const [tgQrPolling, setTgQrPolling] = useState(false);
  const [tgQrStatus, setTgQrStatus] = useState<string | null>(null);
  const [tgQrNeedPassword, setTgQrNeedPassword] = useState(false);
  const [tgQrPassword, setTgQrPassword] = useState("");
  const [tgQrPasswordSession, setTgQrPasswordSession] = useState("");
  const tgQrSessionRef = useRef(0);

  const startTgQrLogin = async () => {
    const sessionId = tgQrSessionRef.current + 1;
    tgQrSessionRef.current = sessionId;
    setTgQrPolling(true);
    setTgQrStatus("启动中…");
    setTgQrNeedPassword(false);
    setTgQrPassword("");
    setTgQrPasswordSession("");
    try {
      const startResp = await settingsApi.tgStartQrLogin();
      const data = startResp.data as { token?: string; qr_image?: string; qr_image_data_url?: string; qr_image_url?: string };
      if (data.token) {
        setTgQrToken(data.token);
        setTgQrImage(data.qr_image || data.qr_image_data_url || data.qr_image_url || null);
        setTgQrStatus("请用 Telegram 扫描二维码");
        for (let i = 0; i < 30; i++) {
          if (tgQrSessionRef.current !== sessionId) break;
          await new Promise(r => setTimeout(r, 2000));
          if (tgQrSessionRef.current !== sessionId) break;
          try {
            const statusResp = await settingsApi.tgCheckQrLogin(data.token);
            const sData = statusResp.data as { status?: string; authorized?: boolean; need_password?: boolean; session?: string; message?: string; user?: unknown };
            if (sData.need_password) {
              setTgQrNeedPassword(true);
              setTgQrPasswordSession(String(sData.session || ""));
              setTgQrStatus(sData.message || "需要输入 Telegram 二步验证密码");
              break;
            }
            if (Boolean(sData.authorized) || sData.status === "authorized" || sData.status === "success") {
              setTgQrStatus("登录成功");
              setTgQrImage(null);
              setTgQrToken(null);
              if (sData.session) setTgSession(String(sData.session));
              setTgLoginStatus({
                valid: true,
                message: sData.message || "Telegram 已登录",
                user: sData.user,
              });
              break;
            }
            if (sData.status === "cancelled" || sData.status === "expired") {
              setTgQrStatus(`二维码已${sData.status === "expired" ? "过期" : "取消"}`);
              break;
            }
            setTgQrStatus("等待扫码…");
          } catch { /* ignore */ }
        }
      } else {
        setTgQrStatus("启动二维码失败: 无 token");
      }
    } catch (err: unknown) {
      setTgQrStatus(`启动失败: ${getApiErrorMessage(err)}`);
    } finally {
      if (tgQrSessionRef.current === sessionId) setTgQrPolling(false);
    }
  };

  const verifyTgQrPassword = async () => {
    if (!tgQrPassword.trim() || !tgQrPasswordSession.trim()) {
      setTgQrStatus("请输入二步验证密码");
      return;
    }
    setTgQrPolling(true);
    try {
      const response = await settingsApi.tgVerifyPassword({
        password: tgQrPassword.trim(),
        session: tgQrPasswordSession.trim(),
      });
      const data = response.data as { session?: string; message?: string; user?: unknown };
      if (data.session) setTgSession(String(data.session));
      setTgQrNeedPassword(false);
      setTgQrPassword("");
      setTgQrPasswordSession("");
      setTgQrImage(null);
      setTgQrToken(null);
      setTgQrStatus(data.message || "Telegram 登录成功");
      setTgLoginStatus({
        valid: true,
        message: data.message || "Telegram 已登录",
        user: data.user,
      });
      await addLog("SUCCESS", "Telegram 二步验证通过，会话已保存");
    } catch (err: unknown) {
      setTgQrStatus(`验证失败: ${getApiErrorMessage(err)}`);
      await addLog("ERROR", "TG 二步验证失败: " + getApiErrorMessage(err));
    } finally {
      setTgQrPolling(false);
    }
  };

  const logoutTgSession = async () => {
    try {
      tgQrSessionRef.current += 1;
      await settingsApi.tgLogout();
      setTgSession("");
      setTgQrToken(null);
      setTgQrImage(null);
      setTgQrPolling(false);
      setTgQrNeedPassword(false);
      setTgQrPassword("");
      setTgQrPasswordSession("");
      setTgLoginStatus({ valid: false, message: "Telegram 会话已登出" });
      await addLog("SUCCESS", "Telegram 会话已登出注销");
    } catch (e: unknown) {
      await addLog("ERROR", "TG 退出登录失败: " + getApiErrorMessage(e));
    }
  };

  const resultOf = (key: string) => lastResult[key];
  const isBusy = (key: string) => busy === key;

  const runAction = async (
    key: string,
    label: string,
    fn: () => Promise<unknown>,
    onSuccess?: (data: unknown) => void,
  ) => {
    setBusy(key);
    try {
      const resp = await fn();
      const data = (resp as { data?: unknown })?.data;
      const failure = getActionFailure(data);
      const msg = failure || formatActionMessage(data ?? "OK");
      if (failure) {
        setLastResult((p) => ({ ...p, [key]: { ok: false, msg } }));
        await addLog("WARN", `${label} 未通过: ${msg}`);
        return;
      }
      onSuccess?.(data);
      setLastResult((p) => ({ ...p, [key]: { ok: true, msg } }));
      await addLog("SUCCESS", `${label} 成功: ${msg}`);
    } catch (err: unknown) {
      const detail = getApiErrorMessage(err);
      setLastResult((p) => ({ ...p, [key]: { ok: false, msg: String(detail) } }));
      await addLog("ERROR", `${label} 失败: ${detail}`);
    } finally {
      setBusy(null);
    }
  };

  const clearPan115QrImage = () => {
    setPan115QrImage((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const refreshPan115CookiePreview = async () => {
    const cookieResp = await pan115Api.getCookieInfo();
    const masked = String((cookieResp.data as Record<string, unknown>).masked_cookie || "");
    setCookie115(masked);
    savedCookieRef.current = masked;
  };

  const startPan115QrLogin = async () => {
    const sessionId = pan115QrSessionRef.current + 1;
    pan115QrSessionRef.current = sessionId;
    setPan115QrPolling(true);
    setPan115QrStatus("启动中…");
    clearPan115QrImage();
    try {
      const selectedApp = pan115QrApp || DEFAULT_PAN115_QR_LOGIN_APP;
      const selectedAppLabel = pan115QrApps.find((item) => item.value === selectedApp)?.label || selectedApp;
      const startResp = await pan115Api.startQrLogin(selectedApp);
      const data = startResp.data as { token?: string; app?: string };
      if (!data.token) {
        setPan115QrStatus("启动失败：未获取到二维码 token");
        return;
      }

      const confirmedApp = String(data.app || selectedApp);
      const confirmedAppLabel = pan115QrApps.find((item) => item.value === confirmedApp)?.label || selectedAppLabel;
      setPan115QrApp(confirmedApp);
      setPan115QrToken(data.token);
      try {
        const imgResp = await pan115Api.getQrImage(data.token);
        const objectUrl = URL.createObjectURL(imgResp.data as Blob);
        if (pan115QrSessionRef.current === sessionId) {
          setPan115QrImage(objectUrl);
        } else {
          URL.revokeObjectURL(objectUrl);
        }
      } catch {
        setPan115QrImage(null);
      }

      setPan115QrStatus(`请用 ${confirmedAppLabel} 扫码确认；手机确认页如显示 Web 登录，属于 115 通用文案`);
      for (let i = 0; i < 30; i++) {
        if (pan115QrSessionRef.current !== sessionId) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (pan115QrSessionRef.current !== sessionId) break;
        try {
          const statusResp = await pan115Api.checkQrLogin(data.token);
          const statusData = statusResp.data as { status?: string; authorized?: boolean; message?: string; app?: string };
          const statusApp = String(statusData.app || confirmedApp);
          const statusAppLabel = pan115QrApps.find((item) => item.value === statusApp)?.label || confirmedAppLabel;
          const authorized = Boolean(statusData.authorized) || statusData.status === "success" || statusData.status === "authorized";
          if (authorized) {
            setPan115QrStatus(`登录成功（${statusAppLabel}），正在刷新账号状态…`);
            setPan115QrToken(null);
            clearPan115QrImage();
            await refreshPan115CookiePreview();
            await addLog("SUCCESS", "115 扫码登录成功，Cookie 已刷新");
            setPan115QrStatus(`登录成功（${statusAppLabel}）`);
            break;
          }
          if (statusData.status === "expired" || statusData.status === "cancelled") {
            setPan115QrStatus(statusData.status === "expired" ? "二维码已过期" : "二维码已取消");
            break;
          }
          if (statusData.message) setPan115QrStatus(statusData.message);
        } catch {
          // polling endpoint may transiently fail; keep waiting until timeout.
        }
      }
    } catch (err: unknown) {
      setPan115QrStatus(`启动失败：${getApiErrorMessage(err)}`);
    } finally {
      if (pan115QrSessionRef.current === sessionId) setPan115QrPolling(false);
    }
  };

  const cancelPan115QrLogin = async () => {
    pan115QrSessionRef.current += 1;
    if (pan115QrToken) {
      try {
        await pan115Api.cancelQrLogin(pan115QrToken);
      } catch {
        // Best effort cancel only.
      }
    }
    setPan115QrToken(null);
    clearPan115QrImage();
    setPan115QrPolling(false);
    setPan115QrStatus(null);
  };

  useEffect(() => {
    let active = true;

    setPan115QrAppsLoading(true);
    pan115Api.listQrLoginApps()
      .then((response) => {
        if (!active) return;
        const options = extractPan115QrLoginAppOptions(response.data);
        setPan115QrApps(options);
        setPan115QrApp((current) => selectPan115QrLoginApp(current, options));
      })
      .catch((err: unknown) => {
        if (!active) return;
        addLog("WARN", `加载 115 扫码客户端列表失败: ${getApiErrorMessage(err)}`);
      })
      .finally(() => {
        if (active) setPan115QrAppsLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Auto-scroll logs terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Load config from real backend
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const runtimeResp = await settingsApi.getRuntime();
        const rt = runtimeResp.data;

        // Core / Connection
        setEmbyUrl(String(rt.emby_url || ""));
        setEmbyKey(String(rt.emby_api_key || ""));
        setLocalMountPath(String(rt.strm_output_dir || ""));
        const intervalHours = Number(rt.subscription_interval_hours);
        if (!Number.isNaN(intervalHours) && intervalHours > 0) {
          setRefreshInterval(Math.round(intervalHours * 60));
        }
        setEmbySyncEnabled(Boolean(rt.emby_sync_enabled));
        setEmbySyncIntervalMinutes(Number(rt.emby_sync_interval_minutes || 1440));

        // Feiniu
        setFeiniuUrl(String(rt.feiniu_url || ""));
        setFeiniuSecret(String(rt.feiniu_secret || ""));
        setFeiniuApiKey(String(rt.feiniu_api_key || ""));
        setFeiniuSessionToken(String(rt.feiniu_session_token || ""));
        setFeiniuSyncEnabled(Boolean(rt.feiniu_sync_enabled));
        setFeiniuSyncIntervalMinutes(Number(rt.feiniu_sync_interval_minutes || 1440));

        // MoviePilot
        setMoviepilotEnabled(Boolean(rt.moviepilot_enabled));
        setMoviepilotBaseUrl(String(rt.moviepilot_base_url || ""));
        setMoviepilotUsername(String(rt.moviepilot_username || ""));
        setMoviepilotPasswordConfigured(Boolean(rt.moviepilot_password_configured));
        setMoviepilotSavePath(String(rt.moviepilot_save_path || ""));
        setMoviepilotSyncEnabled(Boolean(rt.moviepilot_sync_enabled));
        setMoviepilotSyncIntervalMinutes(Number(rt.moviepilot_sync_interval_minutes || 60));

        // ANI-RSS
        setAnirssEnabled(Boolean(rt.anirss_enabled));
        setAnirssBaseUrl(String(rt.anirss_base_url || ""));
        setMikanBaseUrl(String(rt.mikan_base_url || "https://mikanani.me"));
        setAnirssApiKeyConfigured(Boolean(rt.anirss_api_key_configured));
        setAnirssDefaultDownloadPath(String(rt.anirss_default_download_path || ""));
        setAnirssDownloadPathPresetsInput(formatListInput(rt.anirss_download_path_presets));

        // Twilight
        setTwilightEnabled(Boolean(rt.twilight_enabled));
        setTwilightBaseUrl(String(rt.twilight_base_url || ""));
        setTwilightWebUrl(String(rt.twilight_web_url || ""));
        setTwilightApiKeyConfigured(Boolean(rt.twilight_api_key_configured));

        // Telegram Client
        setTgApiId(String(rt.tg_api_id || ""));
        setTgApiHash(String(rt.tg_api_hash || ""));
        setTgPhone(String(rt.tg_phone || ""));
        setTgChannelsInput(formatTgChannelsInput(rt.tg_channel_usernames));
        const tgDays = Number(rt.tg_search_days);
        if (!Number.isNaN(tgDays) && tgDays > 0) setTgSearchDays(Math.round(tgDays));
        const tgMaxMessages = Number(rt.tg_max_messages_per_channel);
        if (!Number.isNaN(tgMaxMessages) && tgMaxMessages > 0) {
          setTgMaxMessagesPerChannel(Math.round(tgMaxMessages));
        }

        // Telegram Bot
        setTgBotToken(String(rt.tg_bot_token || ""));
        setTgBotEnabled(Boolean(rt.tg_bot_enabled));
        setTgBotAllowedUsersInput(formatIdListInput(rt.tg_bot_allowed_users));
        setTgBotNotifyChatIdsInput(formatIdListInput(rt.tg_bot_notify_chat_ids));
        setTgBotHdhiveAutoUnlock(Boolean(rt.tg_bot_hdhive_auto_unlock));

        // Telegram Index
        setTgIndexEnabled(Boolean(rt.tg_index_enabled ?? true));
        setTgSession(String(rt.tg_session || ""));
        setTgIndexRealtimeFallbackEnabled(Boolean(rt.tg_index_realtime_fallback_enabled ?? true));
        setTgIndexQueryLimitPerChannel(Number(rt.tg_index_query_limit_per_channel || 120));
        setTgBackfillBatchSize(Number(rt.tg_backfill_batch_size || 200));
        setTgIncrementalIntervalMinutes(Number(rt.tg_incremental_interval_minutes || 30));

        // HDHive Config
        setHdhiveCookie(String(rt.hdhive_cookie || ""));
        setHdhiveBaseUrl(String(rt.hdhive_base_url || "https://hdhive.com/"));
        setHdhiveLoginUsername(String(rt.hdhive_login_username || ""));
        setHdhiveAutoCheckinEnabled(Boolean(rt.hdhive_auto_checkin_enabled));
        setHdhiveAutoCheckinMode(String(rt.hdhive_auto_checkin_mode || "normal"));
        setHdhiveAutoCheckinMethod(String(rt.hdhive_auto_checkin_method || "cookie"));
        setHdhiveAutoCheckinRunTime(String(rt.hdhive_auto_checkin_run_time || "09:00"));

        // TMDB
        setTmdbApiKey(String(rt.tmdb_api_key || ""));
        setTmdbBaseUrl(String(rt.tmdb_base_url || "https://api.themoviedb.org/3"));
        setTmdbImageBaseUrl(String(rt.tmdb_image_base_url || "https://image.tmdb.org/t/p/w500"));
        setTmdbLanguage(String(rt.tmdb_language || "zh-CN"));
        setTmdbRegion(String(rt.tmdb_region || "CN"));
        setTmdbLocalDbPath(String(rt.tmdb_local_db_path || "data/tmdb_base.db"));

        // Pansou
        setPansouBaseUrl(String(rt.pansou_base_url || ""));

        // Proxies
        setHttpProxy(String(rt.http_proxy || ""));
        setHttpsProxy(String(rt.https_proxy || ""));
        setAllProxy(String(rt.all_proxy || ""));
        setSocksProxy(String(rt.socks_proxy || ""));

        // Update settings
        setUpdateSourceType(String(rt.update_source_type || "official"));
        setUpdateRepository(String(rt.update_repository || "wangsy1007/mediasync115"));

        // Advanced Subscriptions
        setSubscriptionEnabled(Boolean(rt.subscription_enabled));
        setSubscriptionOfflineTransferEnabled(Boolean(rt.subscription_offline_transfer_enabled));
        setSubscriptionHdhiveAutoUnlockEnabled(Boolean(rt.subscription_hdhive_auto_unlock_enabled));
        setSubscriptionHdhiveUnlockMaxPointsPerItem(Number(rt.subscription_hdhive_unlock_max_points_per_item || 10));
        setSubscriptionHdhiveUnlockBudgetPointsPerRun(Number(rt.subscription_hdhive_unlock_budget_points_per_run || 30));
        setSubscriptionHdhiveUnlockThresholdInclusive(Boolean(rt.subscription_hdhive_unlock_threshold_inclusive ?? true));
        setSubscriptionHdhivePreferFree(Boolean(rt.subscription_hdhive_prefer_free ?? true));
        setSubscriptionResourcePriority(Array.isArray(rt.subscription_resource_priority) ? rt.subscription_resource_priority : ["hdhive", "pansou", "tg"]);

        // Chart subscriptions
        setChartSubscriptionEnabled(Boolean(rt.chart_subscription_enabled));
        setChartSubscriptionLimit(Number(rt.chart_subscription_limit || 20));
        setChartSubscriptionIntervalHours(Number(rt.chart_subscription_interval_hours || 24));
        setChartSubscriptionSourcesInput(formatJsonInput(rt.chart_subscription_sources));

        // Person follow
        setPersonFollowEnabled(Boolean(rt.person_follow_enabled));
        setPersonFollowIntervalHours(Number(rt.person_follow_interval_hours || 24));
        setPersonFollowAutoSubscribe(Boolean(rt.person_follow_auto_subscribe ?? true));

        // Preferences & Filters
        setResourcePreferredResolutions(formatListInput(rt.resource_preferred_resolutions));
        setResourcePreferredHdr(formatListInput(rt.resource_preferred_hdr));
        setResourcePreferredCodec(formatListInput(rt.resource_preferred_codec));
        setResourcePreferredAudio(formatListInput(rt.resource_preferred_audio));
        setResourcePreferredSubtitles(formatListInput(rt.resource_preferred_subtitles));
        setResourceExcludeTags(formatListInput(rt.resource_exclude_tags));
        setResourceMinSizeGb(rt.resource_min_size_gb == null ? "" : String(rt.resource_min_size_gb));
        setResourceMaxSizeGb(rt.resource_max_size_gb == null ? "" : String(rt.resource_max_size_gb));
        setDetailVisibleTabs(Array.isArray(rt.detail_visible_tabs) ? rt.detail_visible_tabs : []);
        setAccountUsername(String(rt.auth_username || "admin"));

        try {
          const downloadClientResp = await animeApi.getAniRssDownloadClientStatus();
          setAnirssDownloadClientStatus(downloadClientResp.data);
        } catch (statusErr) {
          setAnirssDownloadClientStatus(null);
          addLog("WARN", "加载 ANI-RSS 下载器状态失败: " + getApiErrorMessage(statusErr));
        }

      } catch (err) {
        console.error("Failed to load runtime settings:", err);
        addLog("ERROR", "加载运行时设置失败: " + getApiErrorMessage(err));
      }

      try {
        await refreshPan115CookiePreview();
      } catch (err) {
        console.error("Failed to load 115 cookie info:", err);
        addLog("ERROR", "加载115 Cookie信息失败: " + getApiErrorMessage(err));
      }

      try {
        const [transferDefaultResp, offlineDefaultResp] = await Promise.all([
          pan115Api.getDefaultFolder(),
          pan115Api.getOfflineDefaultFolder(),
        ]);
        const transferDefault = transferDefaultResp.data as Record<string, unknown>;
        const offlineDefault = offlineDefaultResp.data as Record<string, unknown>;
        const transferFolderId = String(transferDefault.folder_id ?? transferDefault.cid ?? transferDefault.fid ?? "0");
        const transferFolderName = String(transferDefault.folder_name ?? transferDefault.name ?? "根目录");
        const offlineFolderId = String(offlineDefault.folder_id ?? offlineDefault.cid ?? offlineDefault.fid ?? "0");
        const offlineFolderName = String(offlineDefault.folder_name ?? offlineDefault.name ?? "根目录");
        setPan115TransferDefaultFolderId(transferFolderId);
        setPan115TransferDefaultFolderName(transferFolderName);
        setPan115OfflineDefaultFolderId(offlineFolderId);
        setPan115OfflineDefaultFolderName(offlineFolderName);
        savedPan115TransferDefaultRef.current = { folderId: transferFolderId, folderName: transferFolderName };
        savedPan115OfflineDefaultRef.current = { folderId: offlineFolderId, folderName: offlineFolderName };
      } catch (err) {
        console.error("Failed to load 115 default folders:", err);
        addLog("ERROR", "加载 115 默认目录失败: " + getApiErrorMessage(err));
      }

      try {
        const archiveResp = await archiveApi.getConfig();
        const archive = archiveResp.data as Record<string, unknown>;
        setArchiveEnabled(Boolean(archive.archive_enabled));
        setArchiveWatchCid(String(archive.archive_watch_cid || ""));
        setArchiveWatchName(String(archive.archive_watch_name || ""));
        setArchiveOutputCid(String(archive.archive_output_cid || ""));
        setArchiveOutputName(String(archive.archive_output_name || ""));
        setArchiveIntervalMinutes(Math.max(1, Math.round(Number(archive.archive_interval_minutes || 10))));
        setArchiveAutoOnTransfer(Boolean(archive.archive_auto_on_transfer ?? true));
        setArchiveAutoOnOffline(Boolean(archive.archive_auto_on_offline ?? true));
        setOfflineMonitorIntervalMinutes(Math.max(1, Math.round(Number(archive.offline_monitor_interval_minutes || 3))));
        setArchiveSubdirsInput(formatJsonConfig(archive.archive_subdirs));
        setArchiveNamingInput(formatJsonConfig(archive.archive_naming));
      } catch (err) {
        console.error("Failed to load archive config:", err);
        addLog("ERROR", "加载归档高级配置失败: " + getApiErrorMessage(err));
      }
      setConfigLoaded(true);
    };

    loadConfig();

    // Auto-load secondary service status checks
    const loadServices = async () => {
      const safe = <T,>(p: Promise<T>) => p.catch(() => null);
      const [health, quarkInfo, quarkDefault, proxyCfg, botStatusRes, hdhiveStatusRes, chartsRes, tgStatusRes] = await Promise.all([
        safe(settingsApi.checkAllHealth()),
        safe(quarkApi.getCookieInfo()),
        safe(quarkApi.getDefaultFolder()),
        safe(settingsApi.getProxy()),
        safe(settingsApi.getTgBotStatus()),
        safe(settingsApi.checkHdhive()),
        safe(settingsApi.getAvailableCharts()),
        safe(settingsApi.checkTg()),
      ]);
      if (health) setHealthAll(health.data);
      if (quarkInfo) {
        const info = quarkInfo.data as Record<string, unknown>;
        const preview = String(info.preview || info.masked_cookie || info.cookie || "");
        setQuarkCookie(preview);
        savedQuarkCookieRef.current = preview;
      }
      if (quarkDefault) {
        const folder = quarkDefault.data as Record<string, unknown>;
        const folderId = String(folder.folder_id || "0");
        const folderName = String(folder.folder_name || "根目录");
        setQuarkDefaultFolderId(folderId);
        setQuarkDefaultFolderName(folderName);
        savedQuarkDefaultRef.current = { folderId, folderName };
      }
      if (proxyCfg) setProxyInfo(proxyCfg.data);
      if (botStatusRes) setBotStatus(botStatusRes.data);
      if (hdhiveStatusRes) setHdhiveLoginStatus(hdhiveStatusRes.data);
      if (chartsRes) setAvailableCharts(chartsRes.data);
      if (tgStatusRes) setTgLoginStatus(tgStatusRes.data);
    };
    void loadServices();
  }, []);

  // Unified batch save settings function
  const handleSaveSettings = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    try {
      // 1. Build runtime configurations payload
      const payload: Record<string, unknown> = {
        // Core Connection
        emby_url: embyUrl.trim() || null,
        emby_api_key: embyKey.trim() || null,
        strm_output_dir: localMountPath.trim(),
        subscription_interval_hours: Math.max(0.1, refreshInterval / 60),
        emby_sync_enabled: embySyncEnabled,
        emby_sync_interval_minutes: Math.max(15, Math.round(embySyncIntervalMinutes || 1440)),
        emby_sync_interval_hours: Math.max(1, Math.round((embySyncIntervalMinutes || 1440) / 60)),

        // Feiniu
        feiniu_url: feiniuUrl.trim() || null,
        feiniu_secret: feiniuSecret.trim() || null,
        feiniu_api_key: feiniuApiKey.trim() || null,
        feiniu_session_token: feiniuSessionToken.trim() || null,
        feiniu_sync_enabled: feiniuSyncEnabled,
        feiniu_sync_interval_minutes: Math.max(15, Math.round(feiniuSyncIntervalMinutes || 1440)),
        feiniu_sync_interval_hours: Math.max(1, Math.round((feiniuSyncIntervalMinutes || 1440) / 60)),

        // MoviePilot
        moviepilot_enabled: moviepilotEnabled,
        moviepilot_base_url: moviepilotBaseUrl.trim(),
        moviepilot_username: moviepilotUsername.trim(),
        moviepilot_save_path: moviepilotSavePath.trim(),
        moviepilot_sync_enabled: moviepilotSyncEnabled,
        moviepilot_sync_interval_minutes: Math.max(15, Math.round(moviepilotSyncIntervalMinutes || 60)),

        // ANI-RSS
        anirss_enabled: anirssEnabled,
        anirss_base_url: anirssBaseUrl.trim(),
        mikan_base_url: mikanBaseUrl.trim() || "https://mikanani.me",
        anirss_default_download_path: anirssDefaultDownloadPath.trim(),
        anirss_download_path_presets: parseListInput(anirssDownloadPathPresetsInput),

        // Twilight
        twilight_enabled: twilightEnabled,
        twilight_base_url: twilightBaseUrl.trim(),
        twilight_web_url: twilightWebUrl.trim(),

        // TG Client Payload merge
        ...buildTgRuntimePayload({
          apiId: tgApiId,
          apiHash: tgApiHash,
          phone: tgPhone,
          channelsInput: tgChannelsInput,
          searchDays: tgSearchDays,
          maxMessagesPerChannel: tgMaxMessagesPerChannel,
        }),

        // TG Bot Payload merge
        ...buildTgBotRuntimePayload({
          token: tgBotToken,
          enabled: tgBotEnabled,
          allowedUsersInput: tgBotAllowedUsersInput,
          notifyChatIdsInput: tgBotNotifyChatIdsInput,
          hdhiveAutoUnlock: tgBotHdhiveAutoUnlock,
        }),

        // TG Index settings
        tg_index_enabled: tgIndexEnabled,
        tg_session: tgSession.trim() || null,
        tg_index_realtime_fallback_enabled: tgIndexRealtimeFallbackEnabled,
        tg_index_query_limit_per_channel: Math.max(20, Math.round(tgIndexQueryLimitPerChannel || 120)),
        tg_backfill_batch_size: Math.max(50, Math.round(tgBackfillBatchSize || 200)),
        tg_incremental_interval_minutes: Math.max(15, Math.round(tgIncrementalIntervalMinutes || 30)),

        // HDHive
        hdhive_cookie: hdhiveCookie.trim() || null,
        hdhive_base_url: hdhiveBaseUrl.trim(),
        hdhive_login_username: hdhiveLoginUsername.trim(),
        hdhive_auto_checkin_enabled: hdhiveAutoCheckinEnabled,
        hdhive_auto_checkin_mode: hdhiveAutoCheckinMode,
        hdhive_auto_checkin_method: hdhiveAutoCheckinMethod,
        hdhive_auto_checkin_run_time: hdhiveAutoCheckinRunTime.trim(),

        // TMDB & Pansou
        tmdb_api_key: tmdbApiKey.trim() || null,
        tmdb_base_url: tmdbBaseUrl.trim(),
        tmdb_image_base_url: tmdbImageBaseUrl.trim(),
        tmdb_language: tmdbLanguage.trim() || "zh-CN",
        tmdb_region: tmdbRegion.trim() || "CN",
        tmdb_local_db_path: tmdbLocalDbPath.trim() || "data/tmdb_base.db",
        pansou_base_url: pansouBaseUrl.trim(),

        // Proxies
        http_proxy: httpProxy.trim() || null,
        https_proxy: httpsProxy.trim() || null,
        all_proxy: allProxy.trim() || null,
        socks_proxy: socksProxy.trim() || null,

        // Update settings
        update_source_type: updateSourceType,
        update_repository: updateRepository.trim() || "wangsy1007/mediasync115",

        // Advanced Subscriptions
        subscription_enabled: subscriptionEnabled,
        subscription_offline_transfer_enabled: subscriptionOfflineTransferEnabled,
        subscription_hdhive_auto_unlock_enabled: subscriptionHdhiveAutoUnlockEnabled,
        subscription_hdhive_unlock_max_points_per_item: Math.max(1, Math.round(subscriptionHdhiveUnlockMaxPointsPerItem || 10)),
        subscription_hdhive_unlock_budget_points_per_run: Math.max(1, Math.round(subscriptionHdhiveUnlockBudgetPointsPerRun || 30)),
        subscription_hdhive_unlock_threshold_inclusive: subscriptionHdhiveUnlockThresholdInclusive,
        subscription_hdhive_prefer_free: subscriptionHdhivePreferFree,
        subscription_resource_priority: subscriptionResourcePriority,

        // Chart subscriptions
        chart_subscription_enabled: chartSubscriptionEnabled,
        chart_subscription_sources: parseChartSources(chartSubscriptionSourcesInput),
        chart_subscription_limit: Math.max(1, Math.round(chartSubscriptionLimit || 20)),
        chart_subscription_interval_hours: Math.max(1, Math.round(chartSubscriptionIntervalHours || 24)),

        // Person follow
        person_follow_enabled: personFollowEnabled,
        person_follow_interval_hours: Math.max(1, Math.round(personFollowIntervalHours || 24)),
        person_follow_auto_subscribe: personFollowAutoSubscribe,

        // Filters
        resource_preferred_resolutions: parseListInput(resourcePreferredResolutions),
        resource_preferred_hdr: parseListInput(resourcePreferredHdr),
        resource_preferred_codec: parseListInput(resourcePreferredCodec),
        resource_preferred_audio: parseListInput(resourcePreferredAudio),
        resource_preferred_subtitles: parseListInput(resourcePreferredSubtitles),
        resource_exclude_tags: parseListInput(resourceExcludeTags),
        resource_min_size_gb: resourceMinSizeGb.trim() ? Number(resourceMinSizeGb) : null,
        resource_max_size_gb: resourceMaxSizeGb.trim() ? Number(resourceMaxSizeGb) : null,

        // Details tabs
        detail_visible_tabs: detailVisibleTabs,
      };

      if (moviepilotPassword.trim()) {
        payload.moviepilot_password = moviepilotPassword;
      }
      if (anirssApiKey.trim()) {
        payload.anirss_api_key = anirssApiKey;
      }
      if (twilightApiKey.trim()) {
        payload.twilight_api_key = twilightApiKey;
      }

      await settingsApi.updateRuntime(payload);

      if (moviepilotPassword.trim()) {
        setMoviepilotPassword("");
        setMoviepilotPasswordConfigured(true);
      }
      if (anirssApiKey.trim()) {
        setAnirssApiKey("");
        setAnirssApiKeyConfigured(true);
      }
      if (twilightApiKey.trim()) {
        setTwilightApiKey("");
        setTwilightApiKeyConfigured(true);
      }

      // 2. Save 115 Cookie if modified
      if (cookie115 && cookie115 !== savedCookieRef.current) {
        try {
          await pan115Api.updateCookie(cookie115);
          savedCookieRef.current = cookie115;
        } catch (cookieErr) {
          console.error("Failed to update 115 cookie:", cookieErr);
          addLog("ERROR", "115 Cookie 更新失败: " + getApiErrorMessage(cookieErr));
          throw cookieErr;
        }
      }

      const normalizedPan115TransferDefault = {
        folderId: pan115TransferDefaultFolderId.trim() || "0",
        folderName: pan115TransferDefaultFolderName.trim() || "根目录",
      };
      if (
        normalizedPan115TransferDefault.folderId !== savedPan115TransferDefaultRef.current.folderId
        || normalizedPan115TransferDefault.folderName !== savedPan115TransferDefaultRef.current.folderName
      ) {
        const response = await pan115Api.setDefaultFolder(
          normalizedPan115TransferDefault.folderId,
          normalizedPan115TransferDefault.folderName,
        );
        const data = response.data as Record<string, unknown>;
        const folderId = String(data.folder_id || normalizedPan115TransferDefault.folderId);
        const folderName = String(data.folder_name || normalizedPan115TransferDefault.folderName);
        setPan115TransferDefaultFolderId(folderId);
        setPan115TransferDefaultFolderName(folderName);
        savedPan115TransferDefaultRef.current = { folderId, folderName };
      }

      const normalizedPan115OfflineDefault = {
        folderId: pan115OfflineDefaultFolderId.trim() || "0",
        folderName: pan115OfflineDefaultFolderName.trim() || "根目录",
      };
      if (
        normalizedPan115OfflineDefault.folderId !== savedPan115OfflineDefaultRef.current.folderId
        || normalizedPan115OfflineDefault.folderName !== savedPan115OfflineDefaultRef.current.folderName
      ) {
        const response = await pan115Api.setOfflineDefaultFolder(
          normalizedPan115OfflineDefault.folderId,
          normalizedPan115OfflineDefault.folderName,
        );
        const data = response.data as Record<string, unknown>;
        const folderId = String(data.folder_id || normalizedPan115OfflineDefault.folderId);
        const folderName = String(data.folder_name || normalizedPan115OfflineDefault.folderName);
        setPan115OfflineDefaultFolderId(folderId);
        setPan115OfflineDefaultFolderName(folderName);
        savedPan115OfflineDefaultRef.current = { folderId, folderName };
      }

      // 3. Save Quark Cookie/default folder if modified
      if (quarkCookie && quarkCookie !== savedQuarkCookieRef.current) {
        await quarkApi.updateCookie(quarkCookie);
        savedQuarkCookieRef.current = quarkCookie;
      }
      const normalizedQuarkDefault = {
        folderId: quarkDefaultFolderId.trim() || "0",
        folderName: quarkDefaultFolderName.trim() || "根目录",
      };
      if (
        normalizedQuarkDefault.folderId !== savedQuarkDefaultRef.current.folderId
        || normalizedQuarkDefault.folderName !== savedQuarkDefaultRef.current.folderName
      ) {
        const response = await quarkApi.setDefaultFolder(normalizedQuarkDefault.folderId, normalizedQuarkDefault.folderName);
        const data = response.data as Record<string, unknown>;
        const folderId = String(data.folder_id || normalizedQuarkDefault.folderId);
        const folderName = String(data.folder_name || normalizedQuarkDefault.folderName);
        setQuarkDefaultFolderId(folderId);
        setQuarkDefaultFolderName(folderName);
        savedQuarkDefaultRef.current = { folderId, folderName };
      }

      addLog("SUCCESS", "系统核心与高级参数已全部更新并保存");
    } catch (err) {
      console.error("Failed to save config to server:", err);
      addLog("ERROR", "无法向后端保存配置信息: " + getApiErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const saveMoviePilotSettings = () =>
    runAction("moviepilotConfigSave", "保存 MoviePilot 配置", async () => {
      const payload: Record<string, unknown> = {
        moviepilot_enabled: moviepilotEnabled,
        moviepilot_base_url: moviepilotBaseUrl.trim(),
        moviepilot_username: moviepilotUsername.trim(),
        moviepilot_save_path: moviepilotSavePath.trim(),
        moviepilot_sync_enabled: moviepilotSyncEnabled,
        moviepilot_sync_interval_minutes: Math.max(15, Math.round(moviepilotSyncIntervalMinutes || 60)),
      };
      if (moviepilotPassword.trim()) {
        payload.moviepilot_password = moviepilotPassword;
      }
      const response = await settingsApi.updateRuntime(payload);
      if (moviepilotPassword.trim()) {
        setMoviepilotPassword("");
        setMoviepilotPasswordConfigured(true);
      }
      return response;
    });

  const savePan115DefaultFolders = () =>
    runAction("pan115DefaultFoldersSave", "保存 115 默认目录", async () => {
      const transferResp = await pan115Api.setDefaultFolder(
        pan115TransferDefaultFolderId.trim() || "0",
        pan115TransferDefaultFolderName.trim() || "根目录",
      );
      const transferData = transferResp.data as Record<string, unknown>;
      const transferFolderId = String(transferData.folder_id || pan115TransferDefaultFolderId.trim() || "0");
      const transferFolderName = String(transferData.folder_name || pan115TransferDefaultFolderName.trim() || "根目录");
      setPan115TransferDefaultFolderId(transferFolderId);
      setPan115TransferDefaultFolderName(transferFolderName);
      savedPan115TransferDefaultRef.current = { folderId: transferFolderId, folderName: transferFolderName };

      const offlineResp = await pan115Api.setOfflineDefaultFolder(
        pan115OfflineDefaultFolderId.trim() || "0",
        pan115OfflineDefaultFolderName.trim() || "根目录",
      );
      const offlineData = offlineResp.data as Record<string, unknown>;
      const offlineFolderId = String(offlineData.folder_id || pan115OfflineDefaultFolderId.trim() || "0");
      const offlineFolderName = String(offlineData.folder_name || pan115OfflineDefaultFolderName.trim() || "根目录");
      setPan115OfflineDefaultFolderId(offlineFolderId);
      setPan115OfflineDefaultFolderName(offlineFolderName);
      savedPan115OfflineDefaultRef.current = { folderId: offlineFolderId, folderName: offlineFolderName };

      return { data: `分享转存目录 ${transferFolderName}；离线下载目录 ${offlineFolderName}` };
    });

  const saveQuarkSettings = () =>
    runAction("quarkConfigSave", "保存夸克配置", async () => {
      if (quarkCookie && quarkCookie !== savedQuarkCookieRef.current) {
        await quarkApi.updateCookie(quarkCookie);
        savedQuarkCookieRef.current = quarkCookie;
      }
      const response = await quarkApi.setDefaultFolder(
        quarkDefaultFolderId.trim() || "0",
        quarkDefaultFolderName.trim() || "根目录",
      );
      const folder = response.data as Record<string, unknown>;
      const folderId = String(folder.folder_id || quarkDefaultFolderId.trim() || "0");
      const folderName = String(folder.folder_name || quarkDefaultFolderName.trim() || "根目录");
      setQuarkDefaultFolderId(folderId);
      setQuarkDefaultFolderName(folderName);
      savedQuarkDefaultRef.current = { folderId, folderName };
      return { data: `夸克默认目录已保存: ${folderName} (${folderId})` };
    });

  const checkQuarkCookie = () =>
    runAction("quarkCheck", "检测夸克 Cookie", () => quarkApi.checkConnectivity());

  const saveAniRssSettings = () =>
    runAction("anirssConfigSave", "保存 ANI-RSS 配置", async () => {
      const payload: Record<string, unknown> = {
        anirss_enabled: anirssEnabled,
        anirss_base_url: anirssBaseUrl.trim(),
        mikan_base_url: mikanBaseUrl.trim() || "https://mikanani.me",
        anirss_default_download_path: anirssDefaultDownloadPath.trim(),
        anirss_download_path_presets: parseListInput(anirssDownloadPathPresetsInput),
      };
      if (anirssApiKey.trim()) {
        payload.anirss_api_key = anirssApiKey;
      }
      const response = await settingsApi.updateRuntime(payload);
      if (anirssApiKey.trim()) {
        setAnirssApiKey("");
        setAnirssApiKeyConfigured(true);
      }
      return response;
    });

  const checkAniRssDownloadClient = () =>
    runAction("anirssDownloadClientCheck", "检测 ANI-RSS 下载器配置", async () => {
      const response = await animeApi.getAniRssDownloadClientStatus();
      setAnirssDownloadClientStatus(response.data);
      return response;
    });

  const applyAniRssDownloadClientDefaults = () =>
    runAction("anirssDownloadClientApply", "同步 ANI-RSS 下载器安全配置", async () => {
      const response = await animeApi.applyAniRssDownloadClientDefaults();
      setAnirssDownloadClientStatus(response.data.status || null);
      return response;
    });

  const checkAniRssHealth = () =>
    runAction("anirssHealth", "检测 ANI-RSS 连通状态", () => animeApi.checkAniRssHealth());

  const checkHdhiveLogin = () =>
    runAction("hdhiveCheck", "检测 HDHive 登录", () => settingsApi.checkHdhive(), setHdhiveLoginStatus);

  const runHdhiveCheckin = () =>
    runAction("hdhiveCheckinRun", "触发 HDHive 手动签到", () => settingsApi.runHdhiveCheckin({}));

  const checkTmdbConnectivity = () =>
    runAction("tmdbCheck", "检测 TMDB 连接", () => settingsApi.checkTmdb());

  const checkPansouSource = () =>
    runAction("pansouCheck", "检测 Pansou 搜索源", () => settingsApi.checkPansou());

  const saveTwilightSettings = () =>
    runAction("twilightConfigSave", "保存 Twilight 配置", async () => {
      const payload: Record<string, unknown> = {
        twilight_enabled: twilightEnabled,
        twilight_base_url: twilightBaseUrl.trim(),
        twilight_web_url: twilightWebUrl.trim(),
      };
      if (twilightApiKey.trim()) {
        payload.twilight_api_key = twilightApiKey;
      }
      const response = await settingsApi.updateRuntime(payload);
      if (twilightApiKey.trim()) {
        setTwilightApiKey("");
        setTwilightApiKeyConfigured(true);
      }
      return response;
    });

  const saveTgRuntimeSettings = () =>
    runAction("tgConfigSave", "保存 TG 配置", () =>
      settingsApi.updateRuntime(
        buildTgRuntimePayload({
          apiId: tgApiId,
          apiHash: tgApiHash,
          phone: tgPhone,
          channelsInput: tgChannelsInput,
          searchDays: tgSearchDays,
          maxMessagesPerChannel: tgMaxMessagesPerChannel,
        }),
      ).then(() => ({ data: "已保存" })),
    );

  const saveTgBotRuntimeSettings = () =>
    runAction("tgBotConfigSave", "保存 TG Bot 配置", () =>
      settingsApi.updateRuntime(
        buildTgBotRuntimePayload({
          token: tgBotToken,
          enabled: tgBotEnabled,
          allowedUsersInput: tgBotAllowedUsersInput,
          notifyChatIdsInput: tgBotNotifyChatIdsInput,
          hdhiveAutoUnlock: tgBotHdhiveAutoUnlock,
        }),
      ).then(() => settingsApi.getTgBotStatus())
        .then((r) => { setBotStatus(r.data); return { data: "已保存" }; }),
    );

  const checkTgConnection = () =>
    runAction("tgCheck", "检测 TG 连接", () => settingsApi.checkTg(), setTgLoginStatus);

  const restartTgBot = () =>
    runAction("tgBotRestart", "重启 TG Bot 服务", () => settingsApi.restartTgBot(), setBotStatus);

  const stopTgBot = () =>
    runAction("tgBotStop", "停止 TG Bot 服务", () => settingsApi.stopTgBot(), setBotStatus);

  const refreshTgIndex = () =>
    runAction("tgIndexRefresh", "刷新 TG 索引状态", () => settingsApi.refreshTgIndexStatus());

  const rebuildTgIndex = () =>
    runAction("tgIndexRebuild", "清空并全量重塑索引", () => settingsApi.rebuildTgIndex());

  const backfillTgIndex = () =>
    runAction("tgIndexBackfill", "执行 TG 索引回灌", () => settingsApi.startTgIndexBackfill());

  const runTgIndexIncremental = () =>
    runAction("tgIndexIncremental", "触发增量同步扫描", () => settingsApi.runTgIndexIncremental());

  const saveArchiveConfig = () =>
    runAction("archiveConfigSave", "保存归档高级配置", async () => {
      const payload = {
        archive_enabled: archiveEnabled,
        archive_watch_cid: archiveWatchCid.trim(),
        archive_watch_name: archiveWatchName.trim(),
        archive_output_cid: archiveOutputCid.trim(),
        archive_output_name: archiveOutputName.trim(),
        archive_interval_minutes: Math.max(1, Math.round(archiveIntervalMinutes || 10)),
        archive_auto_on_transfer: archiveAutoOnTransfer,
        archive_auto_on_offline: archiveAutoOnOffline,
        offline_monitor_interval_minutes: Math.max(1, Math.round(offlineMonitorIntervalMinutes || 3)),
        archive_subdirs: parseJsonConfig(archiveSubdirsInput, "归档二级目录规则"),
        archive_naming: parseJsonConfig(archiveNamingInput, "归档命名规则"),
      };
      const response = await archiveApi.updateConfig(payload);
      const updated = response.data as Record<string, unknown>;
      setArchiveSubdirsInput(formatJsonConfig(updated.archive_subdirs));
      setArchiveNamingInput(formatJsonConfig(updated.archive_naming));
      return response;
    });

  const saveAccountCredentials = () =>
    runAction("authCredentialsSave", "保存登录账号", async () => {
      if (accountNewPassword || accountNewPasswordConfirm) {
        if (accountNewPassword !== accountNewPasswordConfirm) {
          throw new Error("两次输入的新密码不一致");
        }
      }
      const response = await authApi.changeCredentials({
        current_password: accountCurrentPassword,
        username: accountUsername.trim() || undefined,
        new_password: accountNewPassword ? accountNewPassword : undefined,
      });
      setAccountCurrentPassword("");
      setAccountNewPassword("");
      setAccountNewPasswordConfirm("");
      return response;
    });

  // Test connection utilities
  const test115Connection = async () => {
    setIsTesting115(true);
    try {
      if (cookie115 && cookie115 !== savedCookieRef.current) {
        try {
          await pan115Api.updateCookie(cookie115);
          savedCookieRef.current = cookie115;
        } catch (updateErr) {
          console.error("Failed to update cookie before test:", updateErr);
          addLog("ERROR", "115 Cookie 更新失败: " + getApiErrorMessage(updateErr));
          setIsTesting115(false);
          return;
        }
      }
      const checkResp = await pan115Api.checkCookie();
      const data = checkResp.data as Record<string, unknown>;
      if (data.valid) {
        const userName = (data.user_info as Record<string, unknown> | undefined)?.user_name || "未知用户";
        addLog("SUCCESS", `115 网盘连接成功 — 用户: ${userName}`);
      } else {
        addLog("WARN", `115 网盘连接失败: ${data.message || "Cookie 无效"}`);
      }
    } catch (err) {
      console.error("Failed to test 115:", err);
      addLog("ERROR", "115 会话握手测试失败: " + getApiErrorMessage(err));
    } finally {
      setIsTesting115(false);
    }
  };

  const testEmbyConnection = async () => {
    setIsTestingEmby(true);
    try {
      const resp = await settingsApi.checkEmby({
        emby_url: embyUrl || undefined,
        emby_api_key: embyKey || undefined,
      });
      const data = resp.data as Record<string, unknown>;
      if (data.valid === true || data.ok || data.connected || data.success) {
        addLog("SUCCESS", `Emby 服务器连接成功 — ${embyUrl}`);
      } else {
        addLog("WARN", `Emby 连接失败: ${String(data.message || "未知原因")}`);
      }
    } catch (err) {
      console.error("Failed to test Emby:", err);
      addLog("ERROR", "Emby 连接测试失败: " + getApiErrorMessage(err));
    } finally {
      setIsTestingEmby(false);
    }
  };

  const testFeiniuConnection = async () => {
    setIsTestingFeiniu(true);
    try {
      const resp = await settingsApi.checkFeiniu({
        feiniu_url: feiniuUrl || undefined,
        feiniu_secret: feiniuSecret || undefined,
        feiniu_api_key: feiniuApiKey || undefined,
      });
      const data = resp.data as Record<string, unknown>;
      if (data.valid === true || data.ok || data.connected || data.success) {
        addLog("SUCCESS", `飞牛影视服务器连接成功 — ${feiniuUrl}`);
      } else {
        addLog("WARN", `飞牛连接失败: ${String(data.message || "未知原因")}`);
      }
    } catch (err) {
      console.error("Failed to test Feiniu:", err);
      addLog("ERROR", "飞牛连接测试失败: " + getApiErrorMessage(err));
    } finally {
      setIsTestingFeiniu(false);
    }
  };

  const forceSyncRun = async () => {
    try {
      await archiveApi.runScan();
      addLog("SUCCESS", "归档扫描已触发 — 检查 archive/tasks 查看进度");
    } catch (err) {
      console.error("Failed to trigger archive scan:", err);
      addLog("ERROR", "触发归档扫描失败: " + getApiErrorMessage(err));
    }
  };

  const togglePrioritySource = (source: string, checked: boolean) => {
    const next = checked
      ? [...subscriptionResourcePriority, source]
      : subscriptionResourcePriority.filter((item) => item !== source);
    // filter to only hdhive/pansou/tg
    const allowed = ["hdhive", "pansou", "tg"];
    const filtered = next.filter((item) => allowed.includes(item));
    setSubscriptionResourcePriority(filtered.length > 0 ? filtered : ["hdhive", "pansou", "tg"]);
  };

  const toggleDetailTab = (tab: string, checked: boolean) => {
    const next = checked
      ? [...detailVisibleTabs, tab]
      : detailVisibleTabs.filter((item) => item !== tab);
    setDetailVisibleTabs(next);
  };

  if (!configLoaded) {
    return (
      <div className="liquid-page flex flex-col items-center justify-center gap-3 py-32">
        <div className="glass-heavy glass-iridescent rounded-3xl p-10 flex flex-col items-center gap-3 animate-pulse" style={{ color: "var(--txt-muted)" }}>
          <div className="w-9 h-9 border-[3px] rounded-full animate-spin" style={{ borderColor: "var(--brand-primary)", borderTopColor: "transparent" }} />
          <span className="text-sm font-bold">载入全局配置中…</span>
        </div>
      </div>
    );
  }

  const diagnosticStatusCards = [
    { label: "系统体检", value: healthAll },
    { label: "Telegram", value: tgLoginStatus },
    { label: "TG Bot", value: botStatus },
    { label: "HDHive", value: hdhiveLoginStatus },
    { label: "代理配置", value: proxyInfo },
    { label: "热榜来源", value: availableCharts },
  ].map((item) => ({ ...item, summary: getStatusSummary(item.value) }));

  return (
    <div className="liquid-page space-y-6">
      {/* Settings Header */}
      <div className="liquid-hero glass-heavy glass-iridescent glass-spotlight rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="font-headline text-3xl font-black" style={{ color: "var(--txt)" }}>配置中心</h2>
          <p className="text-xs mt-1" style={{ color: "var(--txt-secondary)" }}>
            管理账号连接、资源来源、自动化策略、网络诊断与安全偏好
          </p>
        </div>
        <button
          type="button"
          onClick={handleSaveSettings}
          disabled={isSaving}
          className="px-6 py-2.5 bg-brand-primary text-white text-xs font-bold rounded-2xl hover:bg-opacity-95 transition-all shadow-md flex items-center gap-2 active:scale-95 disabled:bg-slate-400 shrink-0 cursor-pointer"
        >
          <Save className="w-4 h-4" />
          <span>{isSaving ? "正在同步配置..." : "保存当前全部配置"}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Sub-Tab List */}
        <SettingsSectionNav activeTab={activeTab} onChange={setActiveTab} />

        {/* Right Tab Content Panel */}
        <div className="lg:col-span-9 space-y-6">

          {/* 1. Cloud / Media / Automation shared source blocks */}
          {["cloud", "media", "automation"].includes(activeTab) && (
            <div className="space-y-6">
              {activeTab === "cloud" && (
                <CloudDrivesSettings
                  busy={{ isBusy }}
                  pan115={{
                    cookie: cookie115,
                    setCookie: setCookie115,
                    transferDefaultFolderId: pan115TransferDefaultFolderId,
                    setTransferDefaultFolderId: setPan115TransferDefaultFolderId,
                    transferDefaultFolderName: pan115TransferDefaultFolderName,
                    setTransferDefaultFolderName: setPan115TransferDefaultFolderName,
                    offlineDefaultFolderId: pan115OfflineDefaultFolderId,
                    setOfflineDefaultFolderId: setPan115OfflineDefaultFolderId,
                    offlineDefaultFolderName: pan115OfflineDefaultFolderName,
                    setOfflineDefaultFolderName: setPan115OfflineDefaultFolderName,
                    qrToken: pan115QrToken,
                    qrImage: pan115QrImage,
                    qrStatus: pan115QrStatus,
                    qrPolling: pan115QrPolling,
                    qrApps: pan115QrApps,
                    qrApp: pan115QrApp,
                    setQrApp: setPan115QrApp,
                    qrAppsLoading: pan115QrAppsLoading,
                    isTesting: isTesting115,
                  }}
                  storage={{
                    localMountPath,
                    setLocalMountPath,
                  }}
                  quark={{
                    cookie: quarkCookie,
                    setCookie: setQuarkCookie,
                    defaultFolderId: quarkDefaultFolderId,
                    setDefaultFolderId: setQuarkDefaultFolderId,
                    defaultFolderName: quarkDefaultFolderName,
                    setDefaultFolderName: setQuarkDefaultFolderName,
                  }}
                  actions={{
                    test115Connection,
                    startPan115QrLogin,
                    cancelPan115QrLogin,
                    savePan115DefaultFolders,
                    saveQuarkSettings,
                    checkQuarkCookie,
                  }}
                />
              )}

              {/* Emby Server Section */}
              <div className={`liquid-panel glass p-6 rounded-2xl space-y-4 ${activeTab === "media" ? "" : "hidden"}`}>
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <Server className="w-4 h-4 text-brand-secondary" />
                  本地多媒体应用服务器连接 (Emby)
                </h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>Emby API 地址</span>
                      <input
                        type="text"
                        placeholder="e.g. http://192.168.1.100:8096"
                        value={embyUrl}
                        onChange={(e) => setEmbyUrl(e.target.value)}
                        className="w-full text-xs font-mono px-3 py-2.5 input-premium"
                      />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>Emby API 证书密钥 (Token)</span>
                      <input
                        type="password"
                        placeholder="e.g. emby_key_xxx"
                        value={embyKey}
                        onChange={(e) => setEmbyKey(e.target.value)}
                        className="w-full text-xs font-mono px-3 py-2.5 input-premium"
                      />
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={testEmbyConnection}
                      disabled={isTestingEmby}
                      className="glass-hover flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      style={{ background: "var(--surface-subtle)", color: "var(--brand-secondary)", border: "1px solid var(--border)" }}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isTestingEmby ? "animate-spin" : ""}`} />
                      <span>{isTestingEmby ? "测试中..." : "测试 Emby 连接"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction("embySyncRun", "手动触发 Emby 同步", () => settingsApi.runEmbySync())}
                      disabled={isBusy("embySyncRun")}
                      className="glass-hover flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
                    >
                      <Play className="w-3 h-3" />
                      <span>{isBusy("embySyncRun") ? "同步中..." : "立即同步 Emby 库"}</span>
                    </button>
                  </div>

                  <div className="pt-2 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>Emby 定时同步参数</span>
                      <label className="inline-flex items-center gap-2 text-xs font-black cursor-pointer">
                        <input
                          type="checkbox"
                          checked={embySyncEnabled}
                          onChange={(e) => setEmbySyncEnabled(e.target.checked)}
                          className="accent-brand-primary"
                        />
                        启用定时同步
                      </label>
                    </div>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>Emby 同步检查周期间隔 (分钟)</span>
                      <input
                        type="number"
                        min={15}
                        value={embySyncIntervalMinutes}
                        onChange={(e) => setEmbySyncIntervalMinutes(Number(e.target.value))}
                        className="w-full text-xs px-3.5 py-2.5 input-premium"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Checkin Range Section */}
              <div className={`liquid-panel glass p-6 rounded-2xl space-y-4 ${activeTab === "automation" ? "" : "hidden"}`}>
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <RefreshCw className="w-4 h-4 text-brand-primary" />
                  全局订阅扫描周期
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between text-xs font-bold" style={{ color: "var(--txt-secondary)" }}>
                    <span>订阅任务自动检查扫源周期</span>
                    <span className="text-brand-primary font-black">{refreshInterval} 分钟 / 周期</span>
                  </div>
                  <input
                    type="range"
                    min={60}
                    max={4320}
                    step={60}
                    value={refreshInterval}
                    onChange={(e) => setRefreshInterval(Number(e.target.value))}
                    className="w-full accent-brand-primary h-2 rounded-lg appearance-none cursor-pointer"
                    style={{ background: "var(--surface-subtle)" }}
                  />
                  <p className="text-[10px]" style={{ color: "var(--txt-muted)" }}>
                    保存后会写入后端并刷新定时任务（以小时为基础单位）。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 2. Media services / Resource source blocks */}
          {["media", "resources"].includes(activeTab) && (
            <div className="space-y-6">
              {/* Feiniu Card */}
              <div className={`liquid-panel glass p-6 rounded-2xl space-y-4 ${activeTab === "media" ? "" : "hidden"}`}>
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <Server className="w-4 h-4 text-emerald-500" />
                  飞牛影视 (Feiniu Server) 定时同步
                </h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1 block md:col-span-2">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>飞牛系统 URL</span>
                      <input
                        type="text"
                        placeholder="e.g. http://192.168.1.5:5666"
                        value={feiniuUrl}
                        onChange={(e) => setFeiniuUrl(e.target.value)}
                        className="w-full text-xs font-mono px-3.5 py-2.5 input-premium"
                      />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>飞牛 Secret</span>
                      <input
                        type="password"
                        placeholder="飞牛 Secret"
                        value={feiniuSecret}
                        onChange={(e) => setFeiniuSecret(e.target.value)}
                        className="w-full text-xs font-mono px-3.5 py-2.5 input-premium"
                      />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>飞牛 API Key</span>
                      <input
                        type="password"
                        placeholder="飞牛开发者 API Key"
                        value={feiniuApiKey}
                        onChange={(e) => setFeiniuApiKey(e.target.value)}
                        className="w-full text-xs font-mono px-3.5 py-2.5 input-premium"
                      />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>飞牛 Session Token</span>
                      <input
                        type="password"
                        placeholder="会话令牌 Token"
                        value={feiniuSessionToken}
                        onChange={(e) => setFeiniuSessionToken(e.target.value)}
                        className="w-full text-xs font-mono px-3.5 py-2.5 input-premium"
                      />
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={testFeiniuConnection}
                      disabled={isTestingFeiniu}
                      className="glass-hover flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      style={{ background: "var(--surface-subtle)", color: "var(--brand-primary)", border: "1px solid var(--border)" }}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isTestingFeiniu ? "animate-spin" : ""}`} />
                      <span>{isTestingFeiniu ? "测试中..." : "测试飞牛连接"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction("feiniuSyncRun", "手动触发飞牛同步", () => settingsApi.runFeiniuSync())}
                      disabled={isBusy("feiniuSyncRun")}
                      className="glass-hover flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
                    >
                      <Play className="w-3 h-3" />
                      <span>{isBusy("feiniuSyncRun") ? "同步中..." : "立即同步飞牛库"}</span>
                    </button>
                  </div>
                  <div className="pt-2 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>定时计划参数</span>
                      <label className="inline-flex items-center gap-2 text-xs font-black cursor-pointer">
                        <input
                          type="checkbox"
                          checked={feiniuSyncEnabled}
                          onChange={(e) => setFeiniuSyncEnabled(e.target.checked)}
                          className="accent-brand-primary"
                        />
                        启用定时同步
                      </label>
                    </div>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>同步扫描检查周期 (分钟)</span>
                      <input
                        type="number"
                        min={15}
                        value={feiniuSyncIntervalMinutes}
                        onChange={(e) => setFeiniuSyncIntervalMinutes(Number(e.target.value))}
                        className="w-full text-xs px-3.5 py-2.5 input-premium"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* MoviePilot & Twilight */}
              <div className={`liquid-panel glass p-6 rounded-2xl space-y-4 ${activeTab === "media" ? "" : "hidden"}`}>
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <Radio className="w-4 h-4 text-violet-500" />
                  MoviePilot & Twilight 服务接入
                </h3>
                <div className="space-y-4">
                  {/* MoviePilot config */}
                  <div className={`space-y-3 ${activeTab === "media" ? "" : "hidden"}`}>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold" style={{ color: "var(--txt)" }}>MoviePilot 自动化工具接入</span>
                      <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                        <input type="checkbox" checked={moviepilotEnabled} onChange={(e) => setMoviepilotEnabled(e.target.checked)} className="accent-brand-primary" />
                        启用
                      </label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="space-y-1 block md:col-span-2">
                        <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>URL 路径</span>
                        <input value={moviepilotBaseUrl} onChange={(e) => setMoviepilotBaseUrl(e.target.value)} placeholder="e.g. http://moviepilot:3000" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                      </label>
                      <label className="space-y-1 block">
                        <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>用户名</span>
                        <input value={moviepilotUsername} onChange={(e) => setMoviepilotUsername(e.target.value)} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                      </label>
                      <label className="space-y-1 block">
                        <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>密码</span>
                        <input type="password" value={moviepilotPassword} onChange={(e) => setMoviepilotPassword(e.target.value)} placeholder={moviepilotPasswordConfigured ? "已配置，留空不修改" : "配置密码"} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                      </label>
                      <label className="space-y-1 block md:col-span-2">
                        <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>PT 归档路径</span>
                        <input value={moviepilotSavePath} onChange={(e) => setMoviepilotSavePath(e.target.value)} placeholder="e.g. /incoming/pt" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                      </label>
                      <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                        <input type="checkbox" checked={moviepilotSyncEnabled} onChange={(e) => setMoviepilotSyncEnabled(e.target.checked)} className="accent-brand-primary" />
                        定时同步状态
                      </label>
                      <label className="space-y-1 block">
                        <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>同步间隔（分钟）</span>
                        <input type="number" min={15} value={moviepilotSyncIntervalMinutes} onChange={(e) => setMoviepilotSyncIntervalMinutes(Math.max(15, Number(e.target.value || 60)))} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                      </label>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={saveMoviePilotSettings} disabled={isBusy("moviepilotConfigSave")} className="px-3 py-1.5 rounded-lg text-[9px] font-black bg-brand-primary text-white disabled:opacity-50 cursor-pointer">保存 MP 接入</button>
                      <button type="button" onClick={() => runAction("moviepilotHealth", "检测 MoviePilot 连通状态", () => moviepilotApi.health())} disabled={isBusy("moviepilotHealth")} className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50 cursor-pointer" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>检测连通性</button>
                    </div>
                  </div>

                  {/* Twilight config */}
                  <div className={`${activeTab === "media" ? "" : "hidden"} pt-4 border-t space-y-3`} style={{ borderColor: "var(--border)" }}>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold" style={{ color: "var(--txt)" }}>Twilight (Emby/Jellyfin 账号维护系统) 映射</span>
                      <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                        <input type="checkbox" checked={twilightEnabled} onChange={(e) => setTwilightEnabled(e.target.checked)} className="accent-brand-primary" />
                        启用
                      </label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="space-y-1 block">
                        <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>API 后端地址</span>
                        <input value={twilightBaseUrl} onChange={(e) => setTwilightBaseUrl(e.target.value)} placeholder="http://twilight-backend:5000" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                      </label>
                      <label className="space-y-1 block">
                        <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>Web 前端地址</span>
                        <input value={twilightWebUrl} onChange={(e) => setTwilightWebUrl(e.target.value)} placeholder="http://localhost:3000" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                      </label>
                      <label className="space-y-1 block md:col-span-2">
                        <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>API Key 密钥</span>
                        <input type="password" value={twilightApiKey} onChange={(e) => setTwilightApiKey(e.target.value)} placeholder={twilightApiKeyConfigured ? "已配置，留空不修改" : "填入 API 凭证"} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                      </label>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={saveTwilightSettings} disabled={isBusy("twilightConfigSave")} className="px-3 py-1.5 rounded-lg text-[9px] font-black bg-brand-primary text-white disabled:opacity-50 cursor-pointer font-bold">保存 Twilight</button>
                      <button type="button" onClick={() => runAction("twilightHealth", "检测 Twilight 连通性", () => twilightApi.health())} disabled={isBusy("twilightHealth")} className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50 cursor-pointer" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>检测连通性</button>
                    </div>
                  </div>
                </div>
              </div>

              {activeTab === "resources" && (
                <ResourceMetadataSettings
                  busy={{ isBusy, resultOf }}
                  aniRss={{
                    enabled: anirssEnabled,
                    setEnabled: setAnirssEnabled,
                    baseUrl: anirssBaseUrl,
                    setBaseUrl: setAnirssBaseUrl,
                    mikanBaseUrl,
                    setMikanBaseUrl,
                    apiKey: anirssApiKey,
                    setApiKey: setAnirssApiKey,
                    apiKeyConfigured: anirssApiKeyConfigured,
                    defaultDownloadPath: anirssDefaultDownloadPath,
                    setDefaultDownloadPath: setAnirssDefaultDownloadPath,
                    downloadPathPresetsInput: anirssDownloadPathPresetsInput,
                    setDownloadPathPresetsInput: setAnirssDownloadPathPresetsInput,
                    downloadClientStatus: anirssDownloadClientStatus,
                    onSave: saveAniRssSettings,
                    onCheckHealth: checkAniRssHealth,
                    onCheckDownloadClient: checkAniRssDownloadClient,
                    onApplyDownloadClientDefaults: applyAniRssDownloadClientDefaults,
                  }}
                  hdHive={{
                    baseUrl: hdhiveBaseUrl,
                    setBaseUrl: setHdhiveBaseUrl,
                    loginUsername: hdhiveLoginUsername,
                    setLoginUsername: setHdhiveLoginUsername,
                    cookie: hdhiveCookie,
                    setCookie: setHdhiveCookie,
                    autoCheckinMode: hdhiveAutoCheckinMode,
                    setAutoCheckinMode: setHdhiveAutoCheckinMode,
                    autoCheckinMethod: hdhiveAutoCheckinMethod,
                    setAutoCheckinMethod: setHdhiveAutoCheckinMethod,
                    autoCheckinRunTime: hdhiveAutoCheckinRunTime,
                    setAutoCheckinRunTime: setHdhiveAutoCheckinRunTime,
                    autoCheckinEnabled: hdhiveAutoCheckinEnabled,
                    setAutoCheckinEnabled: setHdhiveAutoCheckinEnabled,
                    onCheckLogin: checkHdhiveLogin,
                    onRunCheckin: runHdhiveCheckin,
                  }}
                  metadata={{
                    tmdbApiKey,
                    setTmdbApiKey,
                    pansouBaseUrl,
                    setPansouBaseUrl,
                    tmdbBaseUrl,
                    setTmdbBaseUrl,
                    tmdbImageBaseUrl,
                    setTmdbImageBaseUrl,
                    tmdbLanguage,
                    setTmdbLanguage,
                    tmdbRegion,
                    setTmdbRegion,
                    tmdbLocalDbPath,
                    setTmdbLocalDbPath,
                    onCheckTmdb: checkTmdbConnectivity,
                    onCheckPansou: checkPansouSource,
                  }}
                  display={{
                    visibleTabs: detailVisibleTabs,
                    onToggle: toggleDetailTab,
                  }}
                />
              )}
            </div>
          )}

          {/* 3. Telegram Integration Tab */}
          {activeTab === "telegram" && (
            <TelegramSettings
              busy={{ isBusy }}
              client={{
                apiId: tgApiId,
                setApiId: setTgApiId,
                apiHash: tgApiHash,
                setApiHash: setTgApiHash,
                phone: tgPhone,
                setPhone: setTgPhone,
                channelsInput: tgChannelsInput,
                setChannelsInput: setTgChannelsInput,
                searchDays: tgSearchDays,
                setSearchDays: setTgSearchDays,
                maxMessagesPerChannel: tgMaxMessagesPerChannel,
                setMaxMessagesPerChannel: setTgMaxMessagesPerChannel,
              }}
              bot={{
                token: tgBotToken,
                setToken: setTgBotToken,
                enabled: tgBotEnabled,
                setEnabled: setTgBotEnabled,
                allowedUsersInput: tgBotAllowedUsersInput,
                setAllowedUsersInput: setTgBotAllowedUsersInput,
                notifyChatIdsInput: tgBotNotifyChatIdsInput,
                setNotifyChatIdsInput: setTgBotNotifyChatIdsInput,
                hdhiveAutoUnlock: tgBotHdhiveAutoUnlock,
                setHdhiveAutoUnlock: setTgBotHdhiveAutoUnlock,
              }}
              index={{
                enabled: tgIndexEnabled,
                setEnabled: setTgIndexEnabled,
                session: tgSession,
                setSession: setTgSession,
                realtimeFallbackEnabled: tgIndexRealtimeFallbackEnabled,
                setRealtimeFallbackEnabled: setTgIndexRealtimeFallbackEnabled,
                queryLimitPerChannel: tgIndexQueryLimitPerChannel,
                setQueryLimitPerChannel: setTgIndexQueryLimitPerChannel,
                backfillBatchSize: tgBackfillBatchSize,
                setBackfillBatchSize: setTgBackfillBatchSize,
                incrementalIntervalMinutes: tgIncrementalIntervalMinutes,
                setIncrementalIntervalMinutes: setTgIncrementalIntervalMinutes,
              }}
              qr={{
                image: tgQrImage,
                status: tgQrStatus,
                needPassword: tgQrNeedPassword,
                password: tgQrPassword,
                setPassword: setTgQrPassword,
                polling: tgQrPolling,
              }}
              actions={{
                startQrLogin: startTgQrLogin,
                verifyQrPassword: verifyTgQrPassword,
                logoutSession: logoutTgSession,
                saveClient: saveTgRuntimeSettings,
                checkClient: checkTgConnection,
                saveBot: saveTgBotRuntimeSettings,
                restartBot: restartTgBot,
                stopBot: stopTgBot,
                refreshIndex: refreshTgIndex,
                rebuildIndex: rebuildTgIndex,
                backfillIndex: backfillTgIndex,
                runIncremental: runTgIndexIncremental,
              }}
            />
          )}

          {/* 4. Network & System Tab */}
          {activeTab === "system" && (
            <div className="space-y-6">
              {/* Health checks */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <HeartPulse className="w-4 h-4 text-red-500" />
                  系统集成诊断与连通检查
                </h3>
                <div className="space-y-3">
                  <p className="text-[10px]" style={{ color: "var(--txt-muted)" }}>
                    诊断模块会检查 HDHive、TMDB、Telegram 及当前代理路由；115、Quark、Emby、飞牛请使用对应卡片里的专项检测。
                  </p>
                  <DiagnosticStatusGrid cards={diagnosticStatusCards} />
                  <button
                    type="button"
                    onClick={() => runAction("diagnosticsRun", "执行全系统健康会话体检", () => settingsApi.checkAllHealth(), setHealthAll)}
                    disabled={isBusy("diagnosticsRun")}
                    className="w-full py-2.5 text-xs font-bold rounded-lg bg-brand-primary text-white disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <HeartPulse className="w-4 h-4" />
                    <span>{isBusy("diagnosticsRun") ? "正在深度体检中..." : "启动全面系统诊断体检"}</span>
                  </button>
                  {resultOf("diagnosticsRun") && (
                    <pre className="text-[9px] font-mono p-4 rounded-xl overflow-x-auto max-h-48 border mt-2" style={{ background: "var(--surface-subtle)", borderColor: "var(--border)", color: "var(--txt)" }}>
                      {resultOf("diagnosticsRun")!.msg}
                    </pre>
                  )}
                </div>
              </div>

              {/* Proxies */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <Wifi className="w-4 h-4 text-blue-500" />
                  网络代理设置 (Proxies)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="space-y-1 block">
                    <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>HTTP 代理 (http_proxy)</span>
                    <input type="text" placeholder="e.g. http://127.0.0.1:7890" value={httpProxy} onChange={(e) => setHttpProxy(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>HTTPS 代理 (https_proxy)</span>
                    <input type="text" placeholder="e.g. http://127.0.0.1:7890" value={httpsProxy} onChange={(e) => setHttpsProxy(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>SOCKS 代理 (socks_proxy)</span>
                    <input type="text" placeholder="e.g. socks5://127.0.0.1:7890" value={socksProxy} onChange={(e) => setSocksProxy(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>全局通用代理 (all_proxy)</span>
                    <input type="text" placeholder="e.g. http://127.0.0.1:7890" value={allProxy} onChange={(e) => setAllProxy(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                  </label>
                </div>
              </div>

              {/* Updates source */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <RefreshCw className="w-4 h-4 text-emerald-500" />
                  系统升级与代码更新源
                </h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>升级仓库来源</span>
                      <select value={updateSourceType} onChange={(e) => setUpdateSourceType(e.target.value)} className="w-full text-xs px-3 py-2.5 input-premium">
                        <option value="official">官方仓库发布 (GitHub Release)</option>
                        <option value="custom_dockerhub">自定义 Docker 镜像拉取</option>
                      </select>
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>软件发布仓库 (GitHub Namespace)</span>
                      <input type="text" value={updateRepository} onChange={(e) => setUpdateRepository(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                    </label>
                  </div>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => runAction("updateCheck", "检测版本升级信息", () => settingsApi.checkUpdates())}
                      disabled={isBusy("updateCheck")}
                      className="glass-hover w-full py-2.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer font-bold"
                      style={{ background: "var(--surface-subtle)", color: "var(--brand-primary)", border: "1px solid var(--border)" }}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isBusy("updateCheck") ? "animate-spin" : ""}`} />
                      <span>{isBusy("updateCheck") ? "检查升级中..." : "在线检测新版本与校验补丁"}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 5. Subscription & Archive Tab */}
          {activeTab === "automation" && (
            <div className="space-y-6">
              {/* Archive Watch Settings */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <Database className="w-4 h-4 text-brand-primary" />
                  115 网盘智能归档扫描
                </h3>
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-4">
                    <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                      <input type="checkbox" checked={archiveEnabled} onChange={(e) => setArchiveEnabled(e.target.checked)} className="accent-brand-primary" />
                      开启归档扫描
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                      <input type="checkbox" checked={archiveAutoOnTransfer} onChange={(e) => setArchiveAutoOnTransfer(e.target.checked)} className="accent-brand-primary" />
                      转存后触发归档
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                      <input type="checkbox" checked={archiveAutoOnOffline} onChange={(e) => setArchiveAutoOnOffline(e.target.checked)} className="accent-brand-primary" />
                      离线下载完成后触发归档
                    </label>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>监听根目录 CID *</span>
                      <input value={archiveWatchCid} onChange={(e) => setArchiveWatchCid(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>监听目录别名</span>
                      <input value={archiveWatchName} onChange={(e) => setArchiveWatchName(e.target.value)} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>输出根目录 CID *</span>
                      <input value={archiveOutputCid} onChange={(e) => setArchiveOutputCid(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>输出目录别名</span>
                      <input value={archiveOutputName} onChange={(e) => setArchiveOutputName(e.target.value)} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>归档扫描间隔 (分钟)</span>
                      <input type="number" min={1} value={archiveIntervalMinutes} onChange={(e) => setArchiveIntervalMinutes(Number(e.target.value))} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>离线检查轮询周期 (分钟)</span>
                      <input type="number" min={1} value={offlineMonitorIntervalMinutes} onChange={(e) => setOfflineMonitorIntervalMinutes(Number(e.target.value))} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button type="button" onClick={saveArchiveConfig} disabled={isBusy("archiveConfigSave")} className="px-4 py-2 bg-brand-primary text-white text-[10px] font-bold rounded-lg hover:bg-opacity-95 disabled:opacity-50 cursor-pointer">保存归档参数</button>
                    <button type="button" onClick={forceSyncRun} className="glass-hover px-4 py-2 text-[10px] font-bold rounded-lg flex items-center gap-1.5 border cursor-pointer" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", borderColor: "var(--border)" }}>
                      <Play className="w-3.5 h-3.5" />
                      <span>立即触发归档扫描</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* JSON Naming and folder mapping */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <SlidersHorizontal className="w-4 h-4 text-violet-500" />
                  归档子目录规则与命名映射规则
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="space-y-1 block">
                    <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>二级子分类映射规范 (archive_subdirs JSON)</span>
                    <textarea rows={5} value={archiveSubdirsInput} onChange={(e) => setArchiveSubdirsInput(e.target.value)} className="w-full text-xs font-mono p-3 resize-none input-premium" />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>影视命名排除及格式化 (archive_naming JSON)</span>
                    <textarea rows={5} value={archiveNamingInput} onChange={(e) => setArchiveNamingInput(e.target.value)} className="w-full text-xs font-mono p-3 resize-none input-premium" />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const r = await archiveApi.getSubdirOptions();
                        addLog("SUCCESS", "支持的归档子分类规则选项: " + JSON.stringify(r.data));
                      } catch (e: unknown) {
                        addLog("ERROR", getApiErrorMessage(e));
                      }
                    }}
                    className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-bold border cursor-pointer"
                    style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", borderColor: "var(--border)" }}
                  >
                    读取子分类模板
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const r = await archiveApi.getNamingOptions();
                        addLog("SUCCESS", "支持的影视命名过滤映射选项: " + JSON.stringify(r.data));
                      } catch (e: unknown) {
                        addLog("ERROR", getApiErrorMessage(e));
                      }
                    }}
                    className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-bold border cursor-pointer"
                    style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", borderColor: "var(--border)" }}
                  >
                    读取命名规则配置
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await archiveApi.clearTasks(true);
                        addLog("WARN", "已清理并重置系统归档队列历史记录");
                      } catch (e: unknown) {
                        addLog("ERROR", getApiErrorMessage(e));
                      }
                    }}
                    className="px-3 py-1.5 border rounded-lg text-[9px] font-bold text-[var(--accent-danger)] cursor-pointer"
                    style={{ borderColor: "rgba(239,68,68,0.3)" }}
                  >
                    清理归档队列
                  </button>
                </div>
              </div>

              {/* Chart scan */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <BarChart3 className="w-4 h-4 text-rose-500" />
                  影视热榜订阅追更 (榜单自动订阅)
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold" style={{ color: "var(--txt)" }}>排行榜追更设置</span>
                    <label className="inline-flex items-center gap-2 text-xs font-black cursor-pointer">
                      <input type="checkbox" checked={chartSubscriptionEnabled} onChange={(e) => setChartSubscriptionEnabled(e.target.checked)} className="accent-brand-primary" />
                      开启榜单跟踪订阅
                    </label>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>每个排行榜检查拉取前 N 项</span>
                      <input type="number" min={1} value={chartSubscriptionLimit} onChange={(e) => setChartSubscriptionLimit(Number(e.target.value))} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>更新扫源频次时间 (小时)</span>
                      <input type="number" min={1} value={chartSubscriptionIntervalHours} onChange={(e) => setChartSubscriptionIntervalHours(Number(e.target.value))} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block md:col-span-2">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>榜单订阅来源配置 (Douban/other JSON)</span>
                      <textarea rows={4} value={chartSubscriptionSourcesInput} onChange={(e) => setChartSubscriptionSourcesInput(e.target.value)} placeholder='e.g. [{"source":"douban","key":"movie_hot"}]' className="w-full text-xs font-mono p-3 resize-none input-premium" />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => runAction("chartSubscriptionRun", "手动拉取影视热榜订阅", () => settingsApi.runChartSubscription())}
                      disabled={isBusy("chartSubscriptionRun")}
                      className="glass-hover w-full py-2.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      style={{ background: "var(--surface-subtle)", color: "var(--brand-primary)", border: "1px solid var(--border)" }}
                    >
                      <Play className={`w-3.5 h-3.5 ${isBusy("chartSubscriptionRun") ? "animate-spin" : ""}`} />
                      <span>{isBusy("chartSubscriptionRun") ? "扫描拉取中..." : "立即触发热榜自动追更扫描"}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Creators scan */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <UserRound className="w-4 h-4 text-emerald-500" />
                  演职员 / 影人关注新片追踪
                </h3>
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-4">
                    <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                      <input type="checkbox" checked={personFollowEnabled} onChange={(e) => setPersonFollowEnabled(e.target.checked)} className="accent-brand-primary" />
                      启用影人作品同步追踪
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                      <input type="checkbox" checked={personFollowAutoSubscribe} onChange={(e) => setPersonFollowAutoSubscribe(e.target.checked)} className="accent-brand-primary" />
                      发现新影视自动建立订阅追更
                    </label>
                  </div>
                  <label className="space-y-1 block">
                    <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>同步扫描时间周期间隔 (小时)</span>
                    <input type="number" min={1} value={personFollowIntervalHours} onChange={(e) => setPersonFollowIntervalHours(Number(e.target.value))} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                  </label>
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => runAction("personFollowRun", "运行关注影人作品扫描", () => settingsApi.runPersonFollow())}
                      disabled={isBusy("personFollowRun")}
                      className="glass-hover w-full py-2.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      style={{ background: "var(--surface-subtle)", color: "var(--brand-primary)", border: "1px solid var(--border)" }}
                    >
                      <Play className={`w-3.5 h-3.5 ${isBusy("personFollowRun") ? "animate-spin" : ""}`} />
                      <span>{isBusy("personFollowRun") ? "影人新片扫描中..." : "立即检查所关注影人的最新作品"}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 6. Security / Preferences Tab */}
          {["security", "automation"].includes(activeTab) && (
            <div className="space-y-6">
              {/* Account modify */}
              <div className={`liquid-panel glass p-6 rounded-2xl space-y-4 ${activeTab === "security" ? "" : "hidden"}`}>
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <Key className="w-4 h-4 text-brand-primary" />
                  修改管理账号与登录密码
                </h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1 block md:col-span-2">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>登录账户名</span>
                      <input value={accountUsername} onChange={(e) => setAccountUsername(e.target.value)} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block md:col-span-2">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>旧验证密码验证 *</span>
                      <input type="password" value={accountCurrentPassword} onChange={(e) => setAccountCurrentPassword(e.target.value)} placeholder="键入旧密码确认" className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>设置新登录密码</span>
                      <input type="password" value={accountNewPassword} onChange={(e) => setAccountNewPassword(e.target.value)} placeholder="设置新密码" className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>再次确认新登录密码</span>
                      <input type="password" value={accountNewPasswordConfirm} onChange={(e) => setAccountNewPasswordConfirm(e.target.value)} placeholder="确认新密码" className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                  </div>
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={saveAccountCredentials}
                      disabled={isBusy("authCredentialsSave")}
                      className="w-full py-2.5 text-xs font-bold rounded-lg bg-brand-primary text-white disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      <span>{isBusy("authCredentialsSave") ? "保存中..." : "保存账号与密码"}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Resource Filters */}
              <div className={`liquid-panel glass p-6 rounded-2xl space-y-4 ${activeTab === "automation" ? "" : "hidden"}`}>
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <SlidersHorizontal className="w-4 h-4 text-emerald-500" />
                  拉取资源质量偏好与过滤器设置
                </h3>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>首选分辨率优先级 (以换行或逗号分隔)</span>
                      <textarea rows={3} value={resourcePreferredResolutions} onChange={(e) => setResourcePreferredResolutions(e.target.value)} placeholder="e.g. 2160p, 1080p" className="w-full text-xs font-mono p-3 resize-none input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>首选 HDR 标准特征</span>
                      <textarea rows={3} value={resourcePreferredHdr} onChange={(e) => setResourcePreferredHdr(e.target.value)} placeholder="e.g. Dolby Vision, HDR10" className="w-full text-xs font-mono p-3 resize-none input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>首选视频编码标准</span>
                      <textarea rows={3} value={resourcePreferredCodec} onChange={(e) => setResourcePreferredCodec(e.target.value)} placeholder="e.g. H.265, HEVC, AV1" className="w-full text-xs font-mono p-3 resize-none input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>首选音频标准规格</span>
                      <textarea rows={3} value={resourcePreferredAudio} onChange={(e) => setResourcePreferredAudio(e.target.value)} placeholder="e.g. Atmos, TrueHD, 国语" className="w-full text-xs font-mono p-3 resize-none input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>首选字幕特征标签</span>
                      <textarea rows={3} value={resourcePreferredSubtitles} onChange={(e) => setResourcePreferredSubtitles(e.target.value)} placeholder="e.g. 简中, 双语, 内嵌中字" className="w-full text-xs font-mono p-3 resize-none input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>排除的关键字与排除词标签</span>
                      <textarea rows={3} value={resourceExcludeTags} onChange={(e) => setResourceExcludeTags(e.target.value)} placeholder="e.g. TS版, 抢先版, 熟肉" className="w-full text-xs font-mono p-3 resize-none input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>资源限制最小大小限制 (GB)</span>
                      <input value={resourceMinSizeGb} onChange={(e) => setResourceMinSizeGb(e.target.value)} placeholder="0" className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>资源限制最大大小限制 (GB)</span>
                      <input value={resourceMaxSizeGb} onChange={(e) => setResourceMaxSizeGb(e.target.value)} placeholder="80" className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                  </div>
                  <ResourcePriorityOptions
                    selectedSources={subscriptionResourcePriority}
                    onToggle={togglePrioritySource}
                  />
                </div>
              </div>

            </div>
          )}

          {/* 7. Operations logs tab */}
          {activeTab === "logs" && (
            <SettingsLogsPanel
              logs={logs}
              setLogs={setLogs}
              addLog={addLog}
              terminalEndRef={terminalEndRef}
            />
          )}
        </div>
      </div>
    </div>
  );
}
