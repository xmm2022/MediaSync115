/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from "react";
import { SyncLog } from "../types";
import {
  Save,
  Key,
  Terminal,
  Trash2,
  RefreshCw,
  Server,
  Database,
  Cloud,
  HeartPulse,
  Radio,
  Send,
  Wifi,
  Play,
  Search,
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
import { logsApi } from "../api/logs";
import { archiveApi } from "../api/archive";
import { getApiErrorMessage } from "../api/errors";
import type { AniRssDownloadClientStatus } from "../api/types";
import {
  buildTgBotRuntimePayload,
  buildTgRuntimePayload,
  formatIdListInput,
  formatTgChannelsInput,
} from "../utils/tgRuntimeSettings";

interface SettingsTabProps {
  logs: SyncLog[];
  setLogs: React.Dispatch<React.SetStateAction<SyncLog[]>>;
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => void;
}

const SOURCE_OPTIONS = [
  { key: "hdhive", label: "HDHive" },
  { key: "pansou", label: "Pansou" },
  { key: "tg", label: "TG" },
];

const DETAIL_TAB_OPTIONS = [
  { key: "pan115", label: "115 聚合" },
  { key: "pan115_pansou", label: "115 Pansou" },
  { key: "pan115_hdhive", label: "115 HDHive" },
  { key: "pan115_tg", label: "115 TG" },
  { key: "quark", label: "夸克聚合" },
  { key: "quark_pansou", label: "夸克 Pansou" },
  { key: "quark_hdhive", label: "夸克 HDHive" },
  { key: "quark_tg", label: "夸克 TG" },
  { key: "magnet", label: "磁力聚合" },
  { key: "magnet_seedhub", label: "SeedHub" },
  { key: "magnet_butailing", label: "不太灵" },
  { key: "moviepilot_pt", label: "PT·MoviePilot" },
];

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

export default function SettingsTab({ logs, setLogs, addLog }: SettingsTabProps) {
  const [activeTab, setActiveTab] = useState<"core" | "integrations" | "telegram" | "diagnostics" | "archive" | "security" | "logs">("core");

  // ---- 1. Core Section States ----
  const [cookie115, setCookie115] = useState("");
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
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Service health and status hooks
  const [healthAll, setHealthAll] = useState<unknown>(null);
  const [botStatus, setBotStatus] = useState<unknown>(null);
  const [hdhiveLoginStatus, setHdhiveLoginStatus] = useState<unknown>(null);
  const [availableCharts, setAvailableCharts] = useState<unknown>(null);
  const [tgLoginStatus, setTgLoginStatus] = useState<unknown>(null);
  const [proxyInfo, setProxyInfo] = useState<unknown>(null);

  // Telegram QR Login state
  const [tgQrToken, setTgQrToken] = useState<string | null>(null);
  const [tgQrImage, setTgQrImage] = useState<string | null>(null);
  const [tgQrPolling, setTgQrPolling] = useState(false);
  const [tgQrStatus, setTgQrStatus] = useState<string | null>(null);

  const startTgQrLogin = async () => {
    setTgQrPolling(true);
    setTgQrStatus("启动中…");
    try {
      const startResp = await settingsApi.tgStartQrLogin();
      const data = startResp.data as { token?: string; qr_image?: string };
      if (data.token) {
        setTgQrToken(data.token);
        setTgQrImage(data.qr_image || null);
        setTgQrStatus("请用 Telegram 扫描二维码");
        for (let i = 0; i < 30; i++) {
          await new Promise(r => setTimeout(r, 2000));
          try {
            const statusResp = await settingsApi.tgCheckQrLogin(data.token);
            const sData = statusResp.data as { status?: string; message?: string };
            if (sData.status === "authorized" || sData.status === "success") {
              setTgQrStatus("登录成功!");
              setTgQrImage(null);
              setTgQrToken(null);
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
      setTgQrPolling(false);
    }
  };

  const resultOf = (key: string) => lastResult[key];
  const isBusy = (key: string) => busy === key;

  const runAction = async (key: string, label: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      const resp = await fn();
      const data = (resp as { data?: unknown })?.data;
      const msg = typeof data === "string" ? data : JSON.stringify(data ?? "OK").slice(0, 200);
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
        const cookieResp = await pan115Api.getCookieInfo();
        const masked = String(cookieResp.data.masked_cookie || "");
        setCookie115(masked);
        savedCookieRef.current = masked;
      } catch (err) {
        console.error("Failed to load 115 cookie info:", err);
        addLog("ERROR", "加载115 Cookie信息失败: " + getApiErrorMessage(err));
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
      if (quarkInfo) setQuarkCookie(String((quarkInfo.data as Record<string, unknown>)?.cookie || ""));
      if (quarkDefault) {
        const folder = quarkDefault.data as Record<string, unknown>;
        setQuarkDefaultFolderId(String(folder.folder_id || "0"));
        setQuarkDefaultFolderName(String(folder.folder_name || "根目录"));
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
        emby_url: embyUrl.trim() || undefined,
        emby_api_key: embyKey.trim() || undefined,
        strm_output_dir: localMountPath.trim() || undefined,
        subscription_interval_hours: Math.max(0.1, refreshInterval / 60),
        emby_sync_enabled: embySyncEnabled,
        emby_sync_interval_minutes: Math.max(15, Math.round(embySyncIntervalMinutes || 1440)),
        emby_sync_interval_hours: Math.max(1, Math.round((embySyncIntervalMinutes || 1440) / 60)),

        // Feiniu
        feiniu_url: feiniuUrl.trim() || null,
        feiniu_api_key: feiniuApiKey.trim() || null,
        feiniu_session_token: feiniuSessionToken.trim() || null,
        feiniu_sync_enabled: feiniuSyncEnabled,
        feiniu_sync_interval_minutes: Math.max(15, Math.round(feiniuSyncIntervalMinutes || 1440)),
        feiniu_sync_interval_hours: Math.max(1, Math.round((feiniuSyncIntervalMinutes || 1440) / 60)),

        // MoviePilot
        moviepilot_enabled: moviepilotEnabled,
        moviepilot_base_url: moviepilotBaseUrl.trim() || undefined,
        moviepilot_username: moviepilotUsername.trim() || undefined,
        moviepilot_save_path: moviepilotSavePath.trim() || undefined,
        moviepilot_sync_enabled: moviepilotSyncEnabled,
        moviepilot_sync_interval_minutes: Math.max(15, Math.round(moviepilotSyncIntervalMinutes || 60)),

        // ANI-RSS
        anirss_enabled: anirssEnabled,
        anirss_base_url: anirssBaseUrl.trim() || undefined,
        mikan_base_url: mikanBaseUrl.trim() || "https://mikanani.me",
        anirss_default_download_path: anirssDefaultDownloadPath.trim(),
        anirss_download_path_presets: parseListInput(anirssDownloadPathPresetsInput),

        // Twilight
        twilight_enabled: twilightEnabled,
        twilight_base_url: twilightBaseUrl.trim() || undefined,
        twilight_web_url: twilightWebUrl.trim() || undefined,

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
        hdhive_login_username: hdhiveLoginUsername.trim() || null,
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
        }
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
        moviepilot_base_url: moviepilotBaseUrl.trim() || undefined,
        moviepilot_username: moviepilotUsername.trim() || undefined,
        moviepilot_save_path: moviepilotSavePath.trim() || undefined,
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

  const saveAniRssSettings = () =>
    runAction("anirssConfigSave", "保存 ANI-RSS 配置", async () => {
      const payload: Record<string, unknown> = {
        anirss_enabled: anirssEnabled,
        anirss_base_url: anirssBaseUrl.trim() || undefined,
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

  const saveTwilightSettings = () =>
    runAction("twilightConfigSave", "保存 Twilight 配置", async () => {
      const payload: Record<string, unknown> = {
        twilight_enabled: twilightEnabled,
        twilight_base_url: twilightBaseUrl.trim() || undefined,
        twilight_web_url: twilightWebUrl.trim() || undefined,
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
      if (data.ok || data.connected || data.success) {
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
        feiniu_secret: feiniuApiKey || undefined,
      });
      const data = resp.data as Record<string, unknown>;
      if (data.ok || data.connected || data.success) {
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

  const clearTerminalLogs = async () => {
    try {
      await logsApi.clear();
      setLogs([]);
      addLog("INFO", "服务端日志已清空");
    } catch (err) {
      console.error("Failed to clear logs on server:", err);
      addLog("ERROR", "清空服务端日志失败: " + getApiErrorMessage(err));
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

  return (
    <div className="liquid-page space-y-6">
      {/* Settings Header */}
      <div className="liquid-hero glass-heavy glass-iridescent glass-spotlight rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="font-headline text-3xl font-black" style={{ color: "var(--txt)" }}>系统参数配置</h2>
          <p className="text-xs mt-1" style={{ color: "var(--txt-secondary)" }}>
            配置 115 账号凭据、第三方集成服务、Telegram 抓取机器人、资源偏好过滤器及体检日志
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
        <div className="lg:col-span-3 flex flex-row lg:flex-col gap-1.5 overflow-x-auto no-scrollbar lg:sticky lg:top-20 pb-2 lg:pb-0 shrink-0">
          {[
            { id: "core", label: "基础连接", icon: Cloud, desc: "115 与 Emby 服务" },
            { id: "integrations", label: "第三方集成", icon: Radio, desc: "飞牛/MoviePilot/Quark" },
            { id: "telegram", label: "Telegram 集成", icon: Send, desc: "API / Bot 与索引" },
            { id: "diagnostics", label: "诊断与代理", icon: HeartPulse, desc: "服务体检、网络与升级" },
            { id: "archive", label: "归档与追更", icon: Database, desc: "自动扫描与热榜追更" },
            { id: "security", label: "安全与过滤器", icon: Key, desc: "账号密码及质量偏好" },
            { id: "logs", label: "实时操作日志", icon: Terminal, desc: "查看调试日志终端" },
          ].map((item) => {
            const Icon = item.icon;
            const isTabActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id as any)}
                className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl transition-all glass-hover shrink-0 lg:shrink cursor-pointer"
                style={
                  isTabActive
                    ? { background: "var(--brand-primary-bg-alpha)", color: "var(--brand-primary)" }
                    : { color: "var(--txt-secondary)", background: "transparent" }
                }
              >
                <Icon className="w-5 h-5 shrink-0" />
                <div className="hidden lg:block text-left">
                  <p className="text-xs font-black leading-none">{item.label}</p>
                  <p className="text-[9px] font-semibold mt-1 opacity-70 leading-none">{item.desc}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Right Tab Content Panel */}
        <div className="lg:col-span-9 space-y-6">

          {/* 1. Core Connection Tab */}
          {activeTab === "core" && (
            <div className="space-y-6">
              {/* 115 Section */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <Cloud className="w-4 h-4 text-brand-primary" />
                  115 云盘授权设置
                </h3>
                <div className="space-y-3">
                  <label className="space-y-1 block">
                    <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>115 浏览器 Cookie 原始字符串 (全字段) *</span>
                    <textarea
                      rows={3}
                      placeholder="键入您的 115 浏览器 Cookie 原始串 (包含 UID, CID, SEID...)"
                      value={cookie115}
                      onChange={(e) => setCookie115(e.target.value)}
                      className="w-full text-xs font-mono p-3 resize-none input-premium"
                    />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>NAS 统筹媒体存储绝对路径 (strm 保存点) *</span>
                    <input
                      type="text"
                      placeholder="e.g. /volume1/Media"
                      value={localMountPath}
                      onChange={(e) => setLocalMountPath(e.target.value)}
                      className="w-full text-xs font-mono px-3.5 py-2.5 input-premium"
                    />
                  </label>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={test115Connection}
                      disabled={isTesting115}
                      className="glass-hover w-full py-2.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      style={{ background: "var(--surface-subtle)", color: "var(--brand-primary)", border: "1px solid var(--border)" }}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isTesting115 ? "animate-spin" : ""}`} />
                      <span>{isTesting115 ? "正与网盘连接建立中..." : "测试 115 API 会话可用性"}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Emby Server Section */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
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
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
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

          {/* 2. Third-party Integrations Tab */}
          {activeTab === "integrations" && (
            <div className="space-y-6">
              {/* Quark Card */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <Cloud className="w-4 h-4 text-blue-500" />
                  夸克网盘授权集成
                </h3>
                <div className="space-y-3">
                  <label className="space-y-1 block">
                    <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>夸克网盘 Cookie</span>
                    <textarea
                      rows={3}
                      placeholder="填入您的 Quark Cookie 以供夸克资源转存任务识别使用..."
                      value={quarkCookie}
                      onChange={(e) => setQuarkCookie(e.target.value)}
                      className="w-full text-xs font-mono p-3 resize-none input-premium"
                    />
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>夸克默认存储目录 Folder ID</span>
                      <input
                        type="text"
                        value={quarkDefaultFolderId}
                        onChange={(e) => setQuarkDefaultFolderId(e.target.value)}
                        className="w-full text-xs font-mono px-3.5 py-2.5 input-premium"
                      />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>默认目录友好名称</span>
                      <input
                        type="text"
                        value={quarkDefaultFolderName}
                        disabled
                        className="w-full text-xs px-3.5 py-2.5 input-premium opacity-60"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Feiniu Card */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
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
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <Radio className="w-4 h-4 text-violet-500" />
                  MoviePilot & Twilight 集成设置
                </h3>
                <div className="space-y-4">
                  {/* MoviePilot config */}
                  <div className="space-y-3">
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

                  {/* ANI-RSS config */}
                  <div className="pt-4 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-bold" style={{ color: "var(--txt)" }}>ANI-RSS 日番追新接入</span>
                      <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                        <input type="checkbox" checked={anirssEnabled} onChange={(e) => setAnirssEnabled(e.target.checked)} className="accent-brand-primary" />
                        启用
                      </label>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="space-y-1 block md:col-span-2">
                        <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>ANI-RSS 地址</span>
                        <input value={anirssBaseUrl} onChange={(e) => setAnirssBaseUrl(e.target.value)} placeholder="e.g. http://ani-rss:7789" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                      </label>
                      <label className="space-y-1 block md:col-span-2">
                        <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>Mikan 域名（兼容）</span>
                        <input value={mikanBaseUrl} onChange={(e) => setMikanBaseUrl(e.target.value)} placeholder="https://mikanani.me" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                      </label>
                      <label className="space-y-1 block md:col-span-2">
                        <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>API Key</span>
                        <input type="password" value={anirssApiKey} onChange={(e) => setAnirssApiKey(e.target.value)} placeholder={anirssApiKeyConfigured ? "已配置，留空不修改" : "配置 ANI-RSS API Key"} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                      </label>
                      <label className="space-y-1 block md:col-span-2">
                        <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>默认保存位置（可选）</span>
                        <input value={anirssDefaultDownloadPath} onChange={(e) => setAnirssDefaultDownloadPath(e.target.value)} placeholder="/Media/番剧/${title}" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                      </label>
                      <label className="space-y-1 block md:col-span-2">
                        <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>保存位置预设</span>
                        <textarea value={anirssDownloadPathPresetsInput} onChange={(e) => setAnirssDownloadPathPresetsInput(e.target.value)} rows={4} placeholder={"/Media/番剧\n/Media/番剧/${title}\n/Media/国产动漫/${title}"} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium resize-y" />
                      </label>
                    </div>
                    <div className="rounded-2xl p-3 space-y-2" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[10px] font-black flex items-center gap-1.5" style={{ color: "var(--txt)" }}>
                            <Server className="w-3.5 h-3.5" />
                            下载器配置闭环
                          </p>
                          <p className="text-[10px] font-bold mt-1" style={{ color: "var(--txt-muted)" }}>
                            {anirssDownloadClientStatus?.message || "尚未检测 ANI-RSS 到 qBittorrent 的连接状态"}
                          </p>
                        </div>
                        <span
                          className="inline-flex items-center justify-center rounded-lg px-2 py-1 text-[9px] font-black shrink-0"
                          style={anirssDownloadClientStatus?.ready
                            ? { color: "var(--accent-ok)", background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.24)" }
                            : { color: "var(--accent-warn)", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.28)" }}
                        >
                          {anirssDownloadClientStatus?.ready ? "配置正常" : "需要检测"}
                        </span>
                      </div>
                      {anirssDownloadClientStatus && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px] font-bold">
                          <div className="rounded-xl px-2.5 py-2" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}>
                            <span className="block text-[9px] font-black uppercase" style={{ color: "var(--txt-muted)" }}>qBittorrent</span>
                            <span className="block truncate">{anirssDownloadClientStatus.qbittorrent?.version || "-"}</span>
                            <span className="block truncate">{anirssDownloadClientStatus.qbittorrent?.base_url || "-"}</span>
                          </div>
                          <div className="rounded-xl px-2.5 py-2" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}>
                            <span className="block text-[9px] font-black uppercase" style={{ color: "var(--txt-muted)" }}>任务数</span>
                            <span className="block">{anirssDownloadClientStatus.qbittorrent?.torrent_count ?? "-"}</span>
                            <span className="block">downloadNew: {anirssDownloadClientStatus.actual?.download_new ? "开" : "关"}</span>
                          </div>
                          <div className="rounded-xl px-2.5 py-2" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}>
                            <span className="block text-[9px] font-black uppercase" style={{ color: "var(--txt-muted)" }}>下载路径</span>
                            <span className="block truncate">{anirssDownloadClientStatus.actual?.download_path_template || "-"}</span>
                            <span className="block">qbUseDownloadPath: {anirssDownloadClientStatus.actual?.qb_use_download_path ? "开" : "关"}</span>
                          </div>
                        </div>
                      )}
                      {!!anirssDownloadClientStatus?.issues?.length && (
                        <p className="text-[10px] font-bold leading-relaxed" style={{ color: "var(--accent-warn)" }}>
                          {anirssDownloadClientStatus.issues.join("；")}
                        </p>
                      )}
                      {!!anirssDownloadClientStatus?.unsafe_flags?.length && (
                        <p className="text-[10px] font-bold leading-relaxed" style={{ color: "var(--accent-danger)" }}>
                          安全开关异常：{anirssDownloadClientStatus.unsafe_flags.join("；")}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={saveAniRssSettings} disabled={isBusy("anirssConfigSave")} className="px-3 py-1.5 rounded-lg text-[9px] font-black bg-brand-primary text-white disabled:opacity-50 cursor-pointer">保存 ANI-RSS</button>
                      <button type="button" onClick={() => runAction("anirssHealth", "检测 ANI-RSS 连通状态", () => animeApi.checkAniRssHealth())} disabled={isBusy("anirssHealth")} className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50 cursor-pointer" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>检测连通性</button>
                      <button type="button" onClick={checkAniRssDownloadClient} disabled={isBusy("anirssDownloadClientCheck")} className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50 cursor-pointer" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>检测下载器</button>
                      <button type="button" onClick={applyAniRssDownloadClientDefaults} disabled={isBusy("anirssDownloadClientApply")} className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50 cursor-pointer" style={{ background: "rgba(245,158,11,0.10)", color: "var(--accent-warn)", border: "1px solid rgba(245,158,11,0.28)" }}>同步安全配置</button>
                    </div>
                  </div>

                  {/* Twilight config */}
                  <div className="pt-4 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
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

              {/* HDHive Checkin & Config */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <SlidersHorizontal className="w-4 h-4 text-emerald-500" />
                  HDHive 论坛签到与配置
                </h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>HDHive Base URL</span>
                      <input value={hdhiveBaseUrl} onChange={(e) => setHdhiveBaseUrl(e.target.value)} placeholder="https://hdhive.com/" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>登录用户名</span>
                      <input value={hdhiveLoginUsername} onChange={(e) => setHdhiveLoginUsername(e.target.value)} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block md:col-span-2">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>Cookie 字符串</span>
                      <textarea rows={3} value={hdhiveCookie} onChange={(e) => setHdhiveCookie(e.target.value)} className="w-full text-xs font-mono p-3 resize-none input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>签到模式</span>
                      <select value={hdhiveAutoCheckinMode} onChange={(e) => setHdhiveAutoCheckinMode(e.target.value)} className="w-full text-xs px-3 py-2.5 input-premium">
                        <option value="normal">普通签到</option>
                        <option value="gamble">魔法签到</option>
                      </select>
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>签到方式</span>
                      <select value={hdhiveAutoCheckinMethod} onChange={(e) => setHdhiveAutoCheckinMethod(e.target.value)} className="w-full text-xs px-3 py-2.5 input-premium">
                        <option value="cookie">Cookie</option>
                        <option value="web">网页模拟登录</option>
                      </select>
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>自动检查运行时间 (HH:mm)</span>
                      <input value={hdhiveAutoCheckinRunTime} onChange={(e) => setHdhiveAutoCheckinRunTime(e.target.value)} placeholder="09:00" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                    </label>
                    <div className="flex items-end pb-1.5">
                      <label className="inline-flex items-center gap-2 text-xs font-black cursor-pointer">
                        <input type="checkbox" checked={hdhiveAutoCheckinEnabled} onChange={(e) => setHdhiveAutoCheckinEnabled(e.target.checked)} className="accent-brand-primary" />
                        启用自动签到
                      </label>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => runAction("hdhiveCheck", "检测 HDHive 登录", () => settingsApi.checkHdhive())}
                      disabled={isBusy("hdhiveCheck")}
                      className="glass-hover flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      style={{ background: "var(--surface-subtle)", color: "var(--brand-primary)", border: "1px solid var(--border)" }}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isBusy("hdhiveCheck") ? "animate-spin" : ""}`} />
                      <span>{isBusy("hdhiveCheck") ? "检查中..." : "测试连接状态"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction("hdhiveCheckinRun", "触发 HDHive 手动签到", () => settingsApi.runHdhiveCheckin({}))}
                      disabled={isBusy("hdhiveCheckinRun")}
                      className="glass-hover flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
                    >
                      <Play className="w-3 h-3" />
                      <span>{isBusy("hdhiveCheckinRun") ? "签到中..." : "手动签到测试"}</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* TMDB & Pansou */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <Search className="w-4 h-4 text-sky-500" />
                  TMDB 搜刮器与第三方搜索 (Pansou)
                </h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="space-y-1 block md:col-span-2">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>TMDB API 密钥 (Key)</span>
                      <input type="password" value={tmdbApiKey} onChange={(e) => setTmdbApiKey(e.target.value)} placeholder="API 密钥" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block md:col-span-2">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>Pansou 搜索源 API 地址</span>
                      <input value={pansouBaseUrl} onChange={(e) => setPansouBaseUrl(e.target.value)} placeholder="http://pansou-api.local" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block md:col-span-2">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>TMDB 后端基础地址</span>
                      <input value={tmdbBaseUrl} onChange={(e) => setTmdbBaseUrl(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block md:col-span-2">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>TMDB 海报图片基础地址</span>
                      <input value={tmdbImageBaseUrl} onChange={(e) => setTmdbImageBaseUrl(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>拉取首选语言</span>
                      <input value={tmdbLanguage} onChange={(e) => setTmdbLanguage(e.target.value)} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>首选区域限制 (Region)</span>
                      <input value={tmdbRegion} onChange={(e) => setTmdbRegion(e.target.value)} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block md:col-span-2">
                      <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>本地 TMDB SQLite 路径</span>
                      <input value={tmdbLocalDbPath} onChange={(e) => setTmdbLocalDbPath(e.target.value)} placeholder="data/tmdb_base.db" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                    </label>
                  </div>
                  {resultOf("tmdbCheck") && (
                    <p
                      className="text-[10px] font-semibold rounded-lg px-3 py-2 break-words"
                      style={{
                        color: resultOf("tmdbCheck")?.ok ? "var(--accent-ok)" : "var(--accent-danger)",
                        background: "var(--surface-subtle)",
                        border: "1px solid var(--border)",
                      }}
                    >
                      {resultOf("tmdbCheck")?.msg}
                    </p>
                  )}
                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => runAction("tmdbCheck", "检测 TMDB 连接", () => settingsApi.checkTmdb())}
                      disabled={isBusy("tmdbCheck")}
                      className="glass-hover flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      style={{ background: "var(--surface-subtle)", color: "var(--brand-primary)", border: "1px solid var(--border)" }}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isBusy("tmdbCheck") ? "animate-spin" : ""}`} />
                      <span>{isBusy("tmdbCheck") ? "测试中..." : "测试 TMDB 连通性"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction("pansouCheck", "检测 Pansou 搜索源", () => settingsApi.checkPansou())}
                      disabled={isBusy("pansouCheck")}
                      className="glass-hover flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                      style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isBusy("pansouCheck") ? "animate-spin" : ""}`} />
                      <span>{isBusy("pansouCheck") ? "测试中..." : "测试 Pansou 搜索源"}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. Telegram Integration Tab */}
          {activeTab === "telegram" && (
            <div className="space-y-6">
              {/* Telegram Client Sign-in */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <Send className="w-4 h-4 text-sky-500" />
                  Telegram 客户端扫码与凭据
                </h3>
                <div className="space-y-4">
                  {/* QR code login block */}
                  <div className="p-4 rounded-xl flex flex-col items-center gap-3 border text-center" style={{ background: "var(--surface-subtle)", borderColor: "var(--border)" }}>
                    <div className="space-y-1">
                      <p className="text-xs font-bold" style={{ color: "var(--txt)" }}>官方 TG 快速登录通道 (免验证码扫码)</p>
                      <p className="text-[10px]" style={{ color: "var(--txt-muted)" }}>启动后可用官方 App 扫码登录。若设置了二步验证，请在下方填入二步密码。</p>
                    </div>

                    {tgQrImage && (
                      <div className="p-2 bg-white rounded-lg inline-block border">
                        <img src={tgQrImage} alt="Telegram QR Login" className="w-36 h-36" />
                      </div>
                    )}

                    {tgQrStatus && (
                      <p className="text-[10px] font-black" style={{ color: "var(--brand-primary)" }}>{tgQrStatus}</p>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={startTgQrLogin}
                        disabled={tgQrPolling}
                        className="px-4 py-2 bg-brand-primary text-white text-[10px] font-bold rounded-lg hover:bg-opacity-90 disabled:opacity-50 cursor-pointer"
                      >
                        {tgQrPolling ? "正在轮询..." : "启动 TG 扫码登录"}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await settingsApi.tgLogout();
                            addLog("SUCCESS", "Telegram 会话已登出注销");
                          } catch (e: unknown) {
                            addLog("ERROR", "TG 退出登录失败: " + getApiErrorMessage(e));
                          }
                        }}
                        className="px-4 py-2 border rounded-lg text-[10px] font-bold text-[var(--accent-danger)] cursor-pointer"
                        style={{ borderColor: "rgba(239,68,68,0.3)" }}
                      >
                        登出会话
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                    <label className="space-y-1 block">
                      <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>TG API ID</span>
                      <input value={tgApiId} onChange={(e) => setTgApiId(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block md:col-span-2">
                      <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>TG API Hash</span>
                      <input type="password" value={tgApiHash} onChange={(e) => setTgApiHash(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block md:col-span-3">
                      <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>手机号码 (带国别码, e.g. +86138...)</span>
                      <input value={tgPhone} onChange={(e) => setTgPhone(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                    <label className="space-y-1 block">
                      <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>追更频道列表 (以逗号或换行分隔)</span>
                      <textarea rows={3} value={tgChannelsInput} onChange={(e) => setTgChannelsInput(e.target.value)} placeholder="e.g. share_channel, mediasync_share..." className="w-full text-xs font-mono p-3 resize-none input-premium" />
                    </label>
                    <div className="space-y-2">
                      <label className="space-y-1 block">
                        <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>检索历史消息天数</span>
                        <input type="number" min={1} value={tgSearchDays} onChange={(e) => setTgSearchDays(Number(e.target.value))} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                      </label>
                      <label className="space-y-1 block">
                        <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>单频道检索上限数</span>
                        <input type="number" min={50} value={tgMaxMessagesPerChannel} onChange={(e) => setTgMaxMessagesPerChannel(Number(e.target.value))} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                      </label>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={saveTgRuntimeSettings} disabled={isBusy("tgConfigSave")} className="px-3 py-2 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 cursor-pointer">保存 TG 连接配置</button>
                    <button type="button" onClick={() => runAction("tgCheck", "检测 TG 连接", () => settingsApi.checkTg())} disabled={isBusy("tgCheck")} className="glass-hover px-3 py-2 rounded-lg text-[10px] font-black disabled:opacity-50 cursor-pointer" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>检测连接状态</button>
                  </div>
                </div>
              </div>

              {/* TG Bot Settings */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <SlidersHorizontal className="w-4 h-4 text-emerald-500" />
                  Telegram Bot 接收服务
                </h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold" style={{ color: "var(--txt)" }}>定时扫描与接收</span>
                    <label className="inline-flex items-center gap-2 text-xs font-black cursor-pointer">
                      <input type="checkbox" checked={tgBotEnabled} onChange={(e) => setTgBotEnabled(e.target.checked)} className="accent-brand-primary" />
                      启用 Telegram Bot
                    </label>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    <label className="space-y-1 block">
                      <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>Bot Token *</span>
                      <input type="password" value={tgBotToken} onChange={(e) => setTgBotToken(e.target.value)} placeholder="填入 @BotFather 申请的 API Token" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>授权交互用户 ID 列表 (以逗号分隔)</span>
                      <input value={tgBotAllowedUsersInput} onChange={(e) => setTgBotAllowedUsersInput(e.target.value)} placeholder="e.g. 12345678, 87654321" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>消息推送目的通知 Chat ID 列表</span>
                      <input value={tgBotNotifyChatIdsInput} onChange={(e) => setTgBotNotifyChatIdsInput(e.target.value)} placeholder="e.g. -10012345678" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                    </label>
                    <div className="pt-1">
                      <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer" style={{ color: "var(--txt-secondary)" }}>
                        <input type="checkbox" checked={tgBotHdhiveAutoUnlock} onChange={(e) => setTgBotHdhiveAutoUnlock(e.target.checked)} className="accent-brand-primary" />
                        允许机器人与 HDHive 自动交互并解锁资源
                      </label>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={saveTgBotRuntimeSettings} disabled={isBusy("tgBotConfigSave")} className="px-3 py-2 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 cursor-pointer">保存 Bot 参数</button>
                    <button type="button" onClick={() => runAction("tgBotRestart", "重启 TG Bot 服务", () => settingsApi.restartTgBot())} disabled={isBusy("tgBotRestart")} className="glass-hover px-3 py-2 rounded-lg text-[10px] font-black disabled:opacity-50 cursor-pointer" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>重启机器人</button>
                    <button type="button" onClick={() => runAction("tgBotStop", "停止 TG Bot 服务", () => settingsApi.stopTgBot())} disabled={isBusy("tgBotStop")} className="px-3 py-2 border rounded-lg text-[10px] font-black disabled:opacity-50 cursor-pointer" style={{ borderColor: "rgba(239,68,68,0.3)", color: "var(--accent-danger)" }}>停用机器人</button>
                  </div>
                </div>
              </div>

              {/* TG Indexer Config */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <Database className="w-4 h-4 text-indigo-500" />
                  Telegram 索引调度器参数 (Advanced)
                </h3>
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-4">
                    <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                      <input type="checkbox" checked={tgIndexEnabled} onChange={(e) => setTgIndexEnabled(e.target.checked)} className="accent-brand-primary" />
                      启用消息索引服务
                    </label>
                    <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                      <input type="checkbox" checked={tgIndexRealtimeFallbackEnabled} onChange={(e) => setTgIndexRealtimeFallbackEnabled(e.target.checked)} className="accent-brand-primary" />
                      实时兜底检索备份
                    </label>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="space-y-1 block">
                      <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>单频道查询上限</span>
                      <input type="number" min={20} value={tgIndexQueryLimitPerChannel} onChange={(e) => setTgIndexQueryLimitPerChannel(Number(e.target.value))} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>回灌批量大小</span>
                      <input type="number" min={50} value={tgBackfillBatchSize} onChange={(e) => setTgBackfillBatchSize(Number(e.target.value))} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                    <label className="space-y-1 block">
                      <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>增量间隔(分钟)</span>
                      <input type="number" min={15} value={tgIncrementalIntervalMinutes} onChange={(e) => setTgIncrementalIntervalMinutes(Number(e.target.value))} className="w-full text-xs px-3.5 py-2.5 input-premium" />
                    </label>
                  </div>
                  <label className="space-y-1 block">
                    <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>TG Session 秘钥</span>
                    <input type="password" value={tgSession} onChange={(e) => setTgSession(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
                  </label>

                  {/* Actions buttons */}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => runAction("tgIndexRefresh", "刷新 TG 索引状态", () => settingsApi.refreshTgIndexStatus())}
                      disabled={isBusy("tgIndexRefresh")}
                      className="px-3 py-1.5 rounded-lg text-[9px] font-black bg-brand-primary text-white disabled:opacity-50 cursor-pointer"
                    >
                      刷新索引状态
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction("tgIndexRebuild", "清空并全量重塑索引", () => settingsApi.rebuildTgIndex())}
                      disabled={isBusy("tgIndexRebuild")}
                      className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50 cursor-pointer"
                      style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
                    >
                      全量重构索引
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction("tgIndexBackfill", "执行 TG 索引回灌", () => settingsApi.startTgIndexBackfill())}
                      disabled={isBusy("tgIndexBackfill")}
                      className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50 cursor-pointer"
                      style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
                    >
                      启动增量回灌
                    </button>
                    <button
                      type="button"
                      onClick={() => runAction("tgIndexIncremental", "触发增量同步扫描", () => settingsApi.runTgIndexIncremental())}
                      disabled={isBusy("tgIndexIncremental")}
                      className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50 cursor-pointer"
                      style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
                    >
                      执行增量拉取
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. Diagnostics & Proxy Tab */}
          {activeTab === "diagnostics" && (
            <div className="space-y-6">
              {/* Health checks */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <HeartPulse className="w-4 h-4 text-red-500" />
                  系统集成诊断与连通检查
                </h3>
                <div className="space-y-3">
                  <p className="text-[10px]" style={{ color: "var(--txt-muted)" }}>
                    诊断模块将发送测试会话检查：115、Quark、TMDB、Emby、飞牛等核心服务的响应是否健康通畅。
                  </p>
                  <button
                    type="button"
                    onClick={() => runAction("diagnosticsRun", "执行全系统健康会话体检", () => settingsApi.checkAllHealth())}
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

          {/* 5. Archive & Subscriptions Tab */}
          {activeTab === "archive" && (
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

          {/* 6. Security & Filters Tab */}
          {activeTab === "security" && (
            <div className="space-y-6">
              {/* Account modify */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
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
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
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
                  <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                    <p className="text-[10px]" style={{ color: "var(--txt-muted)" }}>
                      资源优先级选项: 勾选当前追更时的第一备选数据源抓取优先级顺位。
                    </p>
                    <div className="flex flex-wrap gap-4 pt-2">
                      {SOURCE_OPTIONS.map((source) => (
                        <label key={source.key} className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                          <input
                            type="checkbox"
                            checked={subscriptionResourcePriority.includes(source.key)}
                            onChange={(e) => togglePrioritySource(source.key, e.target.checked)}
                            className="accent-brand-primary"
                          />
                          {source.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Display preferences visible tabs */}
              <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
                <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <SlidersHorizontal className="w-4 h-4 text-blue-500" />
                  影视资源搜索详情页面展示配置
                </h3>
                <div className="space-y-3">
                  <p className="text-[10px]" style={{ color: "var(--txt-muted)" }}>
                    控制影视详情页显示哪些检索源（例如 115 搜索、Quark 搜索、磁力来源等），关闭不用的检索源可以缩短页面加载并保持清爽。
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
                    {DETAIL_TAB_OPTIONS.map((tab) => (
                      <label key={tab.key} className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer" style={{ color: "var(--txt-secondary)" }}>
                        <input
                          type="checkbox"
                          checked={detailVisibleTabs.includes(tab.key)}
                          onChange={(e) => toggleDetailTab(tab.key, e.target.checked)}
                          className="accent-brand-primary"
                        />
                        {tab.label}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 7. Operations logs tab */}
          {activeTab === "logs" && (
            <div className="terminal-premium p-6 shadow-md flex flex-col justify-between h-[640px] border">
              <div className="space-y-4 h-full flex flex-col justify-between">
                {/* Terminal Header */}
                <div className="flex items-center justify-between pb-3 border-b shrink-0" style={{ borderColor: "var(--border-strong)" }}>
                  <div className="flex items-center gap-2">
                    <Terminal className="w-5 h-5 text-brand-primary" />
                    <span className="text-xs font-black tracking-wider" style={{ color: "var(--txt)" }}>SYSTEM CONNECT LOGGER (API)</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      title="触发归档扫描"
                      onClick={forceSyncRun}
                      className="p-1.5 hover:bg-[var(--surface-hover)] rounded text-brand-primary transition-colors cursor-pointer"
                    >
                      <RefreshCw className="w-4 h-4 animate-spin-hover" />
                    </button>
                    <button
                      type="button"
                      title="清空终端日志"
                      onClick={clearTerminalLogs}
                      className="p-1.5 hover:bg-[var(--surface-hover)] rounded text-[var(--accent-danger)] transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      title="读取日志模块列表"
                      onClick={async () => {
                        try {
                          const r = await logsApi.modules();
                          setLogs(prev => [...prev, { id: `m-${Date.now()}`, timestamp: new Date().toLocaleTimeString(), level: "INFO", message: `日志模块: ${JSON.stringify(r.data)}` }]);
                        } catch (e: unknown) {
                          await addLog("ERROR", getApiErrorMessage(e));
                        }
                      }}
                      className="p-1.5 hover:bg-[var(--surface-hover)] rounded text-[var(--accent-info)] transition-colors cursor-pointer"
                    >
                      <Database className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      title="清理30天旧日志"
                      onClick={async () => {
                        try {
                          await logsApi.prune(30);
                          await addLog("SUCCESS", "已清理30天前旧日志");
                        } catch (e: unknown) {
                          await addLog("ERROR", getApiErrorMessage(e));
                        }
                      }}
                      className="p-1.5 hover:bg-[var(--surface-hover)] rounded text-[var(--accent-warn)] transition-colors cursor-pointer"
                    >
                      <AlertTriangle className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Terminal Body Screen */}
                <div className="flex-1 overflow-y-auto max-h-[480px] pr-2 space-y-2.5 text-[10.5px] leading-relaxed select-text no-scrollbar scroll-smooth">
                  {logs.length === 0 ? (
                    <div className="text-gray-500 italic text-center h-full flex items-center justify-center">
                      暂无捕获到的异步 API 日志，您可以点击上方按钮产生一些事件。
                    </div>
                  ) : (
                    logs.map((log) => {
                      let badgeColor = "text-blue-500";
                      if (log.level === "SUCCESS") badgeColor = "text-green-500";
                      if (log.level === "WARN") badgeColor = "text-amber-500";
                      if (log.level === "ERROR") badgeColor = "text-red-500";

                      return (
                        <div key={log.id} className="space-y-0.5">
                          <div className="flex items-center gap-1.5 text-gray-400 font-bold">
                            <span>[{log.timestamp}]</span>
                            <span className={`font-black ${badgeColor}`}>[{log.level}]</span>
                          </div>
                          <div className="pl-4 break-all leading-tight" style={{ color: "var(--txt)" }}>
                            {log.message}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={terminalEndRef} />
                </div>

                {/* Terminal Footer Indicator */}
                <div className="pt-3 border-t flex items-center justify-between text-[10px] text-gray-500 shrink-0" style={{ borderColor: "var(--border-strong)" }}>
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
                    后端 API 日志已连接
                  </span>
                  <span>v1.0.8-Alpha-Stable</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
