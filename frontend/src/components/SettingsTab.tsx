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
  CheckCircle2,
  Server,
  Database,
  Cloud,
  HeartPulse,
  Radio,
  Bot,
  Send,
  Wifi,
  QrCode,
  StopCircle,
  Play,
  Search,
  BarChart3,
  Info,
  AlertTriangle,
} from "lucide-react";
import { motion } from "motion/react";
import CollapsibleSection from "./CollapsibleSection";
import RuntimeAdvancedSettingsPanel from "./RuntimeAdvancedSettingsPanel";
import { settingsApi } from "../api/settings";
import { pan115Api } from "../api/pan115";
import { quarkApi } from "../api/quark";
import { authApi } from "../api/auth";
import { pansouApi } from "../api/pansou";
import { moviepilotApi } from "../api/moviepilot";
import { logsApi } from "../api/logs";
import { archiveApi } from "../api/archive";
import { getApiErrorMessage } from "../api/errors";
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

export default function SettingsTab({ logs, setLogs, addLog }: SettingsTabProps) {
  // Input fields — initialised empty; populated by real backend GET on mount
  const [cookie115, setCookie115] = useState("");
  const [localMountPath, setLocalMountPath] = useState("");

  const [embyUrl, setEmbyUrl] = useState("");
  const [embyKey, setEmbyKey] = useState("");

  // refreshInterval maps to backend subscription_interval_hours
  const [refreshInterval, setRefreshInterval] = useState(15);

  const [isTesting115, setIsTesting115] = useState(false);
  const [isTestingEmby, setIsTestingEmby] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Track the originally-loaded (desensitised) cookie to decide whether
  // a "test 115" click needs to update the cookie server-side first.
  const savedCookieRef = useRef("");

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // ---- 服务集成状态 ----
  const [busy, setBusy] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

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

  // Emby/飞牛同步状态
  const [embySyncStatus, setEmbySyncStatus] = useState<unknown>(null);
  const [feiniuSyncStatus, setFeiniuSyncStatus] = useState<unknown>(null);
  const loadSyncStatus = async () => {
    try {
      const [e, f] = await Promise.all([
        settingsApi.getEmbySyncStatus().catch(() => null),
        settingsApi.getFeiniuSyncStatus().catch(() => null),
      ]);
      setEmbySyncStatus(e?.data ?? null);
      setFeiniuSyncStatus(f?.data ?? null);
    } catch { /* ignore */ }
  };
  useEffect(() => { void loadSyncStatus(); }, []);

  // TG 索引状态
  const [tgIndexStatus, setTgIndexStatus] = useState<unknown>(null);
  const loadTgIndexStatus = async () => {
    try {
      const { data } = await settingsApi.getTgIndexStatus();
      setTgIndexStatus(data);
    } catch { /* ignore */ }
  };

  // 夸克 cookie
  const [quarkCookie, setQuarkCookie] = useState("");
  const [quarkDefaultFolderId, setQuarkDefaultFolderId] = useState("0");
  const [quarkDefaultFolderName, setQuarkDefaultFolderName] = useState("根目录");

  // pansou 配置
  const [pansouConfig, setPansouConfig] = useState<Record<string, unknown> | null>(null);

  // MoviePilot PT 后端
  const [moviepilotEnabled, setMoviepilotEnabled] = useState(false);
  const [moviepilotBaseUrl, setMoviepilotBaseUrl] = useState("");
  const [moviepilotUsername, setMoviepilotUsername] = useState("");
  const [moviepilotPassword, setMoviepilotPassword] = useState("");
  const [moviepilotPasswordConfigured, setMoviepilotPasswordConfigured] = useState(false);
  const [moviepilotSavePath, setMoviepilotSavePath] = useState("");

  // 代理
  const [proxyInfo, setProxyInfo] = useState<unknown>(null);

  // 健康总览
  const [healthAll, setHealthAll] = useState<unknown>(null);

  // TG 登录状态
  const [tgLoginStatus, setTgLoginStatus] = useState<unknown>(null);
  const [tgApiId, setTgApiId] = useState("");
  const [tgApiHash, setTgApiHash] = useState("");
  const [tgPhone, setTgPhone] = useState("");
  const [tgChannelsInput, setTgChannelsInput] = useState("");
  const [tgSearchDays, setTgSearchDays] = useState(30);
  const [tgMaxMessagesPerChannel, setTgMaxMessagesPerChannel] = useState(200);

  // Bot 状态
  const [botStatus, setBotStatus] = useState<unknown>(null);
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgBotEnabled, setTgBotEnabled] = useState(false);
  const [tgBotAllowedUsersInput, setTgBotAllowedUsersInput] = useState("");
  const [tgBotNotifyChatIdsInput, setTgBotNotifyChatIdsInput] = useState("");
  const [tgBotHdhiveAutoUnlock, setTgBotHdhiveAutoUnlock] = useState(false);

  // HDHive 登录状态
  const [hdhiveLoginStatus, setHdhiveLoginStatus] = useState<unknown>(null);

  // 可用榜单
  const [availableCharts, setAvailableCharts] = useState<unknown>(null);

  // 归档高级配置
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

  // 当前登录账号
  const [accountUsername, setAccountUsername] = useState("admin");
  const [accountCurrentPassword, setAccountCurrentPassword] = useState("");
  const [accountNewPassword, setAccountNewPassword] = useState("");
  const [accountNewPasswordConfirm, setAccountNewPasswordConfirm] = useState("");

  // HDHive 登录凭据
  const [hdhiveUser, setHdhiveUser] = useState("");
  const [hdhivePass, setHdhivePass] = useState("");

  // 飞牛登录凭据
  const [feiniuUser, setFeiniuUser] = useState("");
  const [feiniuPass, setFeiniuPass] = useState("");
  const [feiniuUrlField, setFeiniuUrlField] = useState("");
  const [feiniuKey, setFeiniuKey] = useState("");

  // TG QR 登录状态
  const [tgQrToken, setTgQrToken] = useState<string | null>(null);
  const [tgQrImage, setTgQrImage] = useState<string | null>(null);
  const [tgQrPolling, setTgQrPolling] = useState(false);
  const [tgQrStatus, setTgQrStatus] = useState<string | null>(null);

  // TG 密码登录
  const [tgPassword, setTgPassword] = useState("");
  const [tgSession, setTgSession] = useState("");

  // TG QR 登录 + 轮询
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
        // Poll for login status every 2s, up to 30 times (60s)
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
          } catch { /* poll error — keep trying */ }
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

  // Auto-scroll logs terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Load config from real backend: runtime settings + 115 cookie
  useEffect(() => {
    const loadConfig = async () => {
      try {
        // Fetch runtime settings (emby, strm, subscription interval, etc.)
        const runtimeResp = await settingsApi.getRuntime();
        const rt = runtimeResp.data;

        setEmbyUrl(String(rt.emby_url || ""));
        setEmbyKey(String(rt.emby_api_key || ""));
        // localMountPath maps to strm_output_dir (the "strm 保存点" in the UI label)
        setLocalMountPath(String(rt.strm_output_dir || ""));
        // refreshInterval maps to subscription_interval_hours
        const intervalHours = Number(rt.subscription_interval_hours);
        if (!Number.isNaN(intervalHours) && intervalHours > 0) {
          setRefreshInterval(Math.round(intervalHours * 60)); // hours → minutes for the minute slider
        }
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
        setTgBotToken(String(rt.tg_bot_token || ""));
        setTgBotEnabled(Boolean(rt.tg_bot_enabled));
        setTgBotAllowedUsersInput(formatIdListInput(rt.tg_bot_allowed_users));
        setTgBotNotifyChatIdsInput(formatIdListInput(rt.tg_bot_notify_chat_ids));
        setTgBotHdhiveAutoUnlock(Boolean(rt.tg_bot_hdhive_auto_unlock));
        setAccountUsername(String(rt.auth_username || "admin"));
        setMoviepilotEnabled(Boolean(rt.moviepilot_enabled));
        setMoviepilotBaseUrl(String(rt.moviepilot_base_url || ""));
        setMoviepilotUsername(String(rt.moviepilot_username || ""));
        setMoviepilotPasswordConfigured(Boolean(rt.moviepilot_password_configured));
        setMoviepilotSavePath(String(rt.moviepilot_save_path || ""));
        // archive_watch_cid is a 115 cloud CID, separate from strm_output_dir.
      } catch (err) {
        console.error("Failed to load runtime settings:", err);
        addLog("ERROR", "加载运行时设置失败: " + getApiErrorMessage(err));
      }

      try {
        // Fetch 115 cookie (masked by backend)
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
    };
    loadConfig();

    // Auto-load service integration data (fire-and-forget, non-blocking)
    const loadServices = async () => {
      const safe = <T,>(p: Promise<T>) => p.catch(() => null);
      const [health, quarkInfo, quarkDefault, pansouCfg, proxyCfg, botStatus, hdhiveStatus, charts, moviepilotCfg] = await Promise.all([
        safe(settingsApi.checkAllHealth()),
        safe(quarkApi.getCookieInfo()),
        safe(quarkApi.getDefaultFolder()),
        safe(pansouApi.getConfig()),
        safe(settingsApi.getProxy()),
        safe(settingsApi.getTgBotStatus()),
        safe(settingsApi.checkHdhive()),
        safe(settingsApi.getAvailableCharts()),
        safe(moviepilotApi.getConfig()),
      ]);
      if (health) setHealthAll(health.data);
      if (quarkInfo) setQuarkCookie(String((quarkInfo.data as Record<string, unknown>)?.cookie || ""));
      if (quarkDefault) {
        const folder = quarkDefault.data as Record<string, unknown>;
        setQuarkDefaultFolderId(String(folder.folder_id || "0"));
        setQuarkDefaultFolderName(String(folder.folder_name || "根目录"));
      }
      if (pansouCfg) setPansouConfig(pansouCfg.data as Record<string, unknown>);
      if (proxyCfg) setProxyInfo(proxyCfg.data);
      if (botStatus) setBotStatus(botStatus.data);
      if (hdhiveStatus) setHdhiveLoginStatus(hdhiveStatus.data);
      if (charts) setAvailableCharts(charts.data);
      if (moviepilotCfg) {
        setMoviepilotEnabled(Boolean(moviepilotCfg.data.enabled));
        setMoviepilotBaseUrl(String(moviepilotCfg.data.base_url || ""));
        setMoviepilotUsername(String(moviepilotCfg.data.username || ""));
        setMoviepilotPasswordConfigured(Boolean(moviepilotCfg.data.password_configured));
        setMoviepilotSavePath(String(moviepilotCfg.data.save_path || ""));
      }
    };
    void loadServices();
  }, []);

  // Save settings to real backend: runtime settings PUT + 115 cookie update
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      // Build runtime settings payload with backend field names.
      const payload: Record<string, unknown> = {
        emby_url: embyUrl || undefined,
        emby_api_key: embyKey || undefined,
        strm_output_dir: localMountPath || undefined,
        subscription_interval_hours: refreshInterval
          ? Math.max(1, Math.round(refreshInterval / 60)) // minutes → hours (backend unit)
          : undefined,
        ...buildTgRuntimePayload({
          apiId: tgApiId,
          apiHash: tgApiHash,
          phone: tgPhone,
          channelsInput: tgChannelsInput,
          searchDays: tgSearchDays,
          maxMessagesPerChannel: tgMaxMessagesPerChannel,
        }),
        ...buildTgBotRuntimePayload({
          token: tgBotToken,
          enabled: tgBotEnabled,
          allowedUsersInput: tgBotAllowedUsersInput,
          notifyChatIdsInput: tgBotNotifyChatIdsInput,
          hdhiveAutoUnlock: tgBotHdhiveAutoUnlock,
        }),
        moviepilot_enabled: moviepilotEnabled,
        moviepilot_base_url: moviepilotBaseUrl.trim() || undefined,
        moviepilot_username: moviepilotUsername.trim() || undefined,
        moviepilot_save_path: moviepilotSavePath.trim() || undefined,
      };
      if (moviepilotPassword.trim()) {
        payload.moviepilot_password = moviepilotPassword;
      }
      await settingsApi.updateRuntime(payload);
      if (moviepilotPassword.trim()) {
        setMoviepilotPassword("");
        setMoviepilotPasswordConfigured(true);
      }

      // Update 115 cookie if it was edited (and is non-empty)
      if (cookie115 && cookie115 !== savedCookieRef.current) {
        try {
          await pan115Api.updateCookie(cookie115);
          savedCookieRef.current = cookie115;
        } catch (cookieErr) {
          console.error("Failed to update 115 cookie:", cookieErr);
          addLog("ERROR", "115 Cookie 更新失败: " + getApiErrorMessage(cookieErr));
          // Continue — runtime settings may still have saved successfully
        }
      }

      addLog("SUCCESS", "系统配置已保存到后端");
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

  // Test 115 connection: if cookie changed since load, update it first, then check
  const test115Connection = async () => {
    setIsTesting115(true);
    try {
      if (cookie115 && cookie115 !== savedCookieRef.current) {
        // Cookie was edited — persist it before checking
        try {
          await pan115Api.updateCookie(cookie115);
          savedCookieRef.current = cookie115;
        } catch (updateErr) {
          console.error("Failed to update cookie before test:", updateErr);
          addLog("ERROR", "115 Cookie 更新失败（测试前保存）: " + getApiErrorMessage(updateErr));
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

  // Test Emby connection via GET /api/settings/emby/check with query params
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
      } else if (data.message) {
        addLog("WARN", `Emby 连接检查: ${data.message}`);
      } else {
        addLog("INFO", `Emby 连接检查完成 — ${embyUrl}`);
      }
    } catch (err) {
      console.error("Failed to test Emby:", err);
      addLog("ERROR", "Emby Webscan Webhook 测试失败: " + getApiErrorMessage(err));
    } finally {
      setIsTestingEmby(false);
    }
  };

  // Clear logs on server (DELETE /api/logs/clear)
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

  // Trigger archive scan (closest real-backend analogue to "full sync").
  // Other sync operations available but not exposed in this single-button UI:
  //   - POST /api/subscriptions/system/run  (subscription channel run)
  //   - POST /api/strm/generate             (STRM generation)
  //   - POST /api/settings/emby/sync/run    (Emby library sync)
  const forceSyncRun = async () => {
    try {
      await archiveApi.runScan();
      addLog("SUCCESS", "归档扫描已触发 — 检查 archive/tasks 查看进度");
    } catch (err) {
      console.error("Failed to trigger archive scan:", err);
      addLog("ERROR", "触发归档扫描失败: " + getApiErrorMessage(err));
    }
  };

  return (
    <div className="space-y-12">
      <section className="mb-4">
        <h2 className="font-headline text-4xl font-black mb-2" style={{ color: "var(--txt)" }}>系统参数设置</h2>
        <p className="text-sm" style={{ color: "var(--txt-secondary)" }}>配置 115 账号凭据、本地 Emby 钩子、线程吞吐及查看实时数据调试日志</p>
      </section>

      {/* ===== 服务集成面板 (批次5) ===== */}
      <CollapsibleSection icon={<HeartPulse className="w-4 h-4" />} title="服务集成与诊断" subtitle="健康检查、同步触发、TG/Bot 登录与索引管理" badge="服务" defaultOpen={false}>
      <div className="space-y-6 pt-3">
        {/* 全服务健康总览 */}
        <div className="glass glass-hover p-6 rounded-2xl space-y-4 transition-all">
          <div className="flex items-center justify-between">
            <h3 className="font-headline text-lg font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <HeartPulse className="w-5 h-5 text-rose-500" />
              全服务健康总览
            </h3>
            <button
              disabled={isBusy("health")}
              onClick={() =>
                runAction("health", "健康总览检查", () =>
                  settingsApi.checkAllHealth().then((r) => { setHealthAll(r.data); return r; }),
                )
              }
              className="px-4 py-2 rounded-xl text-xs font-black bg-brand-primary text-white hover:bg-brand-primary-light disabled:opacity-50 flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isBusy("health") ? "animate-spin" : ""}`} />
              {isBusy("health") ? "检测中…" : "一键体检"}
            </button>
          </div>
          {healthAll != null ? (
            <pre className="text-[10px] rounded-xl p-3 overflow-auto max-h-64 font-mono" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" }}>{JSON.stringify(healthAll, null, 2)}</pre>
          ) : (
            <p className="text-xs font-semibold" style={{ color: "var(--txt-muted)" }}>点击体检会批量探测 TMDB/Emby/飞牛/115/夸克/pansou/TG 等服务的连通性。</p>
          )}
        </div>

        {/* Emby / 飞牛 同步 */}
        <div className="glass glass-hover p-6 rounded-2xl space-y-4 transition-all">
          <h3 className="font-headline text-lg font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
            <RefreshCw className="w-5 h-5 text-brand-primary" />
            Emby / 飞牛 库同步
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black" style={{ color: "var(--txt)" }}>Emby 同步</span>
                <button
                  disabled={isBusy("embySync")}
                  onClick={() => runAction("embySync", "Emby 同步", () => settingsApi.runEmbySync().then((r) => { void loadSyncStatus(); return r; }))}
                  className="px-3 py-1 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
                >
                  <Play className="w-3 h-3" /> {isBusy("embySync") ? "同步中…" : "立即同步"}
                </button>
              </div>
              <pre className="text-[10px] rounded-xl p-2 overflow-auto max-h-40 font-mono" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" }}>{JSON.stringify(embySyncStatus ?? "—", null, 2)}</pre>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-black" style={{ color: "var(--txt)" }}>飞牛同步</span>
                <button
                  disabled={isBusy("feiniuSync")}
                  onClick={() => runAction("feiniuSync", "飞牛同步", () => settingsApi.runFeiniuSync().then((r) => { void loadSyncStatus(); return r; }))}
                  className="px-3 py-1 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
                >
                  <Play className="w-3 h-3" /> {isBusy("feiniuSync") ? "同步中…" : "立即同步"}
                </button>
              </div>
              <pre className="text-[10px] rounded-xl p-2 overflow-auto max-h-40 font-mono" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" }}>{JSON.stringify(feiniuSyncStatus ?? "—", null, 2)}</pre>
            </div>
          </div>
          {/* 飞牛登录 */}
          <div className="pt-3 space-y-2" style={{ borderTop: "1px solid var(--border)" }}>
            <span className="text-xs font-bold" style={{ color: "var(--txt-secondary)" }}>飞牛影视登录 (feiniuLogin)</span>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input value={feiniuUrlField} onChange={(e) => setFeiniuUrlField(e.target.value)} placeholder="飞牛地址" className="text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }} />
              <input value={feiniuKey} onChange={(e) => setFeiniuKey(e.target.value)} placeholder="API Key (可选)" className="text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }} />
              <input value={feiniuUser} onChange={(e) => setFeiniuUser(e.target.value)} placeholder="用户名" className="text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }} />
              <div className="flex gap-2">
                <input type="password" value={feiniuPass} onChange={(e) => setFeiniuPass(e.target.value)} placeholder="密码" className="flex-1 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }} />
                <button
                  disabled={isBusy("feiniuLogin")}
                  onClick={() => runAction("feiniuLogin", "飞牛登录", () => settingsApi.feiniuLogin(feiniuUser, feiniuPass, feiniuUrlField || undefined))}
                  className="px-3 py-2 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50"
                >
                  {isBusy("feiniuLogin") ? "登录中" : "登录"}
                </button>
              </div>
            </div>
          </div>
          <button
            disabled={isBusy("feiniuCheck")}
            onClick={() => runAction("feiniuCheck", "飞牛连通检测", () => settingsApi.checkFeiniu({
              feiniu_url: feiniuUrlField || undefined,
              feiniu_api_key: feiniuKey || undefined,
            }))}
            className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
            style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
          >
            <RefreshCw className="w-3 h-3" /> 飞牛连通检测
          </button>
          {resultOf("feiniuLogin") && (
            <p className="text-[10px] font-bold" style={{ color: resultOf("feiniuLogin")!.ok ? "var(--accent-ok)" : "var(--accent-danger)" }}>{resultOf("feiniuLogin")!.msg}</p>
          )}
        </div>

        {/* 飞牛/Emby 连通测试 */}
        {resultOf("embyCheck") && (
          <p className="text-[10px] font-bold" style={{ color: resultOf("embyCheck")!.ok ? "var(--accent-ok)" : "var(--accent-danger)" }}>Emby 检测: {resultOf("embyCheck")!.msg}</p>
        )}

        {/* Telegram 登录 / 索引 / Bot */}
        <div className="glass glass-hover p-6 rounded-2xl space-y-4 transition-all">
          <h3 className="font-headline text-lg font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
            <Send className="w-5 h-5 text-sky-500" />
            Telegram 集成
          </h3>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
            <div className="xl:col-span-3 space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>API ID</label>
              <input
                value={tgApiId}
                onChange={(e) => setTgApiId(e.target.value)}
                placeholder="Telegram API ID"
                className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
              />
            </div>
            <div className="xl:col-span-4 space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>API HASH</label>
              <input
                type="password"
                value={tgApiHash}
                onChange={(e) => setTgApiHash(e.target.value)}
                placeholder="Telegram API HASH"
                className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
              />
            </div>
            <div className="xl:col-span-3 space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>手机号</label>
              <input
                value={tgPhone}
                onChange={(e) => setTgPhone(e.target.value)}
                placeholder="+8613800000000"
                className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
              />
            </div>
            <div className="xl:col-span-2 space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>检索天数</label>
              <input
                type="number"
                min={1}
                value={tgSearchDays}
                onChange={(e) => setTgSearchDays(Number(e.target.value))}
                className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
              />
            </div>
            <div className="xl:col-span-8 space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>资源频道</label>
              <textarea
                rows={3}
                value={tgChannelsInput}
                onChange={(e) => setTgChannelsInput(e.target.value)}
                placeholder={"@channel_one\n@channel_two"}
                className="w-full text-xs font-mono rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-brand-primary"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
              />
            </div>
            <div className="xl:col-span-2 space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>单频道消息</label>
              <input
                type="number"
                min={1}
                value={tgMaxMessagesPerChannel}
                onChange={(e) => setTgMaxMessagesPerChannel(Number(e.target.value))}
                className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
              />
            </div>
            <div className="xl:col-span-2 flex items-end">
              <button
                disabled={isBusy("tgConfigSave")}
                onClick={saveTgRuntimeSettings}
                className="w-full px-3 py-2 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1 justify-center"
              >
                <Save className="w-3 h-3" /> {isBusy("tgConfigSave") ? "保存中" : "保存 TG 配置"}
              </button>
            </div>
          </div>
          {resultOf("tgConfigSave") && (
            <p className="text-[10px] font-bold" style={{ color: resultOf("tgConfigSave")!.ok ? "var(--accent-ok)" : "var(--accent-danger)" }}>{resultOf("tgConfigSave")!.msg}</p>
          )}

          {/* TG 连通检测 */}
          <div className="flex flex-wrap gap-2 items-center">
            <button
              disabled={isBusy("tgCheck")}
              onClick={() => runAction("tgCheck", "TG 连通检测", () => settingsApi.checkTg())}
              className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              <Radio className="w-3 h-3" /> 连通检测
            </button>
            {resultOf("tgCheck") && <span className="text-[10px] font-bold" style={{ color: resultOf("tgCheck")!.ok ? "var(--accent-ok)" : "var(--accent-danger)" }}>{resultOf("tgCheck")!.msg}</span>}
          </div>

          {/* TG 密码登录 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input value={tgSession} onChange={(e) => setTgSession(e.target.value)} placeholder="session (会话名)" className="text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }} />
            <input type="password" value={tgPassword} onChange={(e) => setTgPassword(e.target.value)} placeholder="两步验证密码" className="text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }} />
            <button
              disabled={isBusy("tgPwd")}
              onClick={() => runAction("tgPwd", "TG 密码登录", () => settingsApi.tgVerifyPassword({ password: tgPassword, session: tgSession }))}
              className="px-3 py-2 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1 justify-center"
            >
              <Key className="w-3 h-3" /> 密码登录
            </button>
          </div>
          {resultOf("tgPwd") && <p className="text-[10px] font-bold" style={{ color: resultOf("tgPwd")!.ok ? "var(--accent-ok)" : "var(--accent-danger)" }}>{resultOf("tgPwd")!.msg}</p>}

          {/* QR 登录 */}
          <div className="space-y-2">
            <div className="flex gap-2 items-center flex-wrap">
              <button
                disabled={tgQrPolling}
                onClick={startTgQrLogin}
                className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
                style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
              >
                <QrCode className="w-3 h-3" /> {tgQrPolling ? "轮询中…" : "启动二维码登录"}
              </button>
              <button
                disabled={isBusy("tgLogout")}
                onClick={() => runAction("tgLogout", "TG 退出登录", () => settingsApi.tgLogout())}
                className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
                style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
              >
                <Trash2 className="w-3 h-3" /> 退出登录
              </button>
            </div>
            {/* QR code image + status */}
            {tgQrImage && (
              <div className="flex items-start gap-4 p-3 rounded-xl" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                <img src={tgQrImage} alt="TG QR Code" className="w-32 h-32 rounded-lg border" />
                <div>
                  <p className="text-xs font-black" style={{ color: "var(--txt)" }}>Telegram 扫码登录</p>
                  <p className="text-[10px] font-semibold mt-1" style={{ color: "var(--txt-secondary)" }}>{tgQrStatus || "准备中…"}</p>
                  <p className="text-[9px] mt-2" style={{ color: "var(--txt-muted)" }}>用 Telegram 客户端扫描二维码即可登录</p>
                </div>
              </div>
            )}
            {tgQrStatus && !tgQrImage && (
              <p className="text-[10px] font-bold" style={{ color: tgQrStatus.includes("成功") ? "var(--accent-ok)" : "var(--txt-muted)" }}>{tgQrStatus}</p>
            )}
          </div>

          {/* 索引管理 */}
          <div className="pt-3 space-y-2" style={{ borderTop: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={loadTgIndexStatus}
                className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black flex items-center gap-1"
                style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
              >
                <RefreshCw className="w-3 h-3" /> 刷新索引状态
              </button>
              <button
                disabled={isBusy("tgBackfill")}
                onClick={() => runAction("tgBackfill", "TG 索引回灌", () => settingsApi.startTgIndexBackfill(false).then((r) => { void loadTgIndexStatus(); return r; }))}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
              >
                <Play className="w-3 h-3" /> {isBusy("tgBackfill") ? "回灌中" : "启动回灌"}
              </button>
              <button
                disabled={isBusy("tgIncremental")}
                onClick={() => runAction("tgIncremental", "TG 增量索引", () => settingsApi.runTgIndexIncremental().then((r) => { void loadTgIndexStatus(); return r; }))}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
              >
                <Database className="w-3 h-3" /> {isBusy("tgIncremental") ? "索引中" : "增量索引"}
              </button>
              <button
                disabled={isBusy("tgRebuild")}
                onClick={() => runAction("tgRebuild", "TG 重建索引", () => settingsApi.rebuildTgIndex().then((r) => { void loadTgIndexStatus(); return r; }))}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
                style={{ background: "rgba(245,158,11,0.12)", color: "var(--accent-warn)", border: "1px solid rgba(245,158,11,0.3)" }}
              >
                <RefreshCw className="w-3 h-3" /> {isBusy("tgRebuild") ? "重建中" : "全量重建"}
              </button>
              <button
                disabled={isBusy("tgStopJob")}
                onClick={() => runAction("tgStopJob", "停止 TG 索引任务", () => settingsApi.stopTgIndexJob("backfill"))}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
                style={{ background: "rgba(239,68,68,0.12)", color: "var(--accent-danger)", border: "1px solid rgba(239,68,68,0.3)" }}
              >
                <StopCircle className="w-3 h-3" /> 停止任务
              </button>
            </div>
            <pre className="text-[10px] rounded-xl p-2 overflow-auto max-h-40 font-mono" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" }}>{JSON.stringify(tgIndexStatus ?? "—", null, 2)}</pre>
          </div>

          {/* TG Bot */}
          <div className="pt-3 space-y-3" style={{ borderTop: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4" style={{ color: "var(--txt-secondary)" }} />
              <span className="text-xs font-black" style={{ color: "var(--txt)" }}>TG Bot</span>
              <label className="inline-flex items-center gap-1.5 text-[10px] font-bold cursor-pointer" style={{ color: "var(--txt-secondary)" }}>
                <input
                  type="checkbox"
                  checked={tgBotEnabled}
                  onChange={(e) => setTgBotEnabled(e.target.checked)}
                  className="accent-brand-primary"
                />
                启用
              </label>
              <label className="inline-flex items-center gap-1.5 text-[10px] font-bold cursor-pointer" style={{ color: "var(--txt-secondary)" }}>
                <input
                  type="checkbox"
                  checked={tgBotHdhiveAutoUnlock}
                  onChange={(e) => setTgBotHdhiveAutoUnlock(e.target.checked)}
                  className="accent-brand-primary"
                />
                HDHive 自动解锁
              </label>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
              <div className="xl:col-span-5 space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>Bot Token</label>
                <input
                  type="password"
                  value={tgBotToken}
                  onChange={(e) => setTgBotToken(e.target.value)}
                  placeholder="123456:ABC-DEF..."
                  className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary"
                  style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
                />
              </div>
              <div className="xl:col-span-3 space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>允许用户 ID</label>
                <textarea
                  rows={2}
                  value={tgBotAllowedUsersInput}
                  onChange={(e) => setTgBotAllowedUsersInput(e.target.value)}
                  placeholder={"123456789\n987654321"}
                  className="w-full text-xs font-mono rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-brand-primary"
                  style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
                />
              </div>
              <div className="xl:col-span-3 space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>通知 Chat ID</label>
                <textarea
                  rows={2}
                  value={tgBotNotifyChatIdsInput}
                  onChange={(e) => setTgBotNotifyChatIdsInput(e.target.value)}
                  placeholder={"-1001234567890\n123456789"}
                  className="w-full text-xs font-mono rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-brand-primary"
                  style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
                />
              </div>
              <div className="xl:col-span-1 flex items-end">
                <button
                  disabled={isBusy("tgBotConfigSave")}
                  onClick={saveTgBotRuntimeSettings}
                  className="w-full px-3 py-2 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1 justify-center"
                >
                  <Save className="w-3 h-3" /> {isBusy("tgBotConfigSave") ? "保存中" : "保存"}
                </button>
              </div>
            </div>
            {resultOf("tgBotConfigSave") && (
              <p className="text-[10px] font-bold" style={{ color: resultOf("tgBotConfigSave")!.ok ? "var(--accent-ok)" : "var(--accent-danger)" }}>{resultOf("tgBotConfigSave")!.msg}</p>
            )}
            <div className="flex flex-wrap gap-2 items-center">
              <button
                disabled={isBusy("tgBotRestart")}
                onClick={() => runAction("tgBotRestart", "重启 TG Bot", () => settingsApi.restartTgBot())}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" /> {isBusy("tgBotRestart") ? "重启中" : "重启 Bot"}
              </button>
              <button
                disabled={isBusy("tgBotStop")}
                onClick={() => runAction("tgBotStop", "停止 TG Bot", () => settingsApi.stopTgBot())}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
                style={{ background: "rgba(239,68,68,0.12)", color: "var(--accent-danger)", border: "1px solid rgba(239,68,68,0.3)" }}
              >
                <StopCircle className="w-3 h-3" /> 停止 Bot
              </button>
              <button
                disabled={isBusy("tgBotStatus")}
                onClick={() => runAction("tgBotStatus", "查询 TG Bot 状态", () => settingsApi.getTgBotStatus().then((r) => { setBotStatus(r.data); return r; }))}
                className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
                style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
              >
                <Server className="w-3 h-3" /> Bot 状态
              </button>
            </div>
            {botStatus != null && (
              <pre className="text-[10px] rounded-xl p-2 overflow-auto max-h-32 font-mono" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" }}>{JSON.stringify(botStatus, null, 2)}</pre>
            )}
          </div>
        </div>

        {/* HDHive */}
        <div className="glass glass-hover p-6 rounded-2xl space-y-4 transition-all">
          <h3 className="font-headline text-lg font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
            <Server className="w-5 h-5 text-indigo-500" />
            HDHive 集成
          </h3>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              disabled={isBusy("hdhiveCheck")}
              onClick={() => runAction("hdhiveCheck", "HDHive 连通检测", () => settingsApi.checkHdhive())}
              className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              <Radio className="w-3 h-3" /> 连通检测
            </button>
            <button
              disabled={isBusy("hdhiveCheckin")}
              onClick={() => runAction("hdhiveCheckin", "HDHive 签到", () => settingsApi.runHdhiveCheckin({}))}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
            >
              <CheckCircle2 className="w-3 h-3" /> 签到
            </button>
            {resultOf("hdhiveCheck") && <span className="text-[10px] font-bold" style={{ color: resultOf("hdhiveCheck")!.ok ? "var(--accent-ok)" : "var(--accent-danger)" }}>{resultOf("hdhiveCheck")!.msg}</span>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input value={hdhiveUser} onChange={(e) => setHdhiveUser(e.target.value)} placeholder="HDHive 用户名" className="text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }} />
            <input type="password" value={hdhivePass} onChange={(e) => setHdhivePass(e.target.value)} placeholder="密码" className="text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }} />
            <button
              disabled={isBusy("hdhiveLogin")}
              onClick={() => runAction("hdhiveLogin", "HDHive 登录", () => settingsApi.hdhiveLogin(hdhiveUser, hdhivePass))}
              className="px-3 py-2 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50"
            >
              {isBusy("hdhiveLogin") ? "登录中" : "登录"}
            </button>
          </div>
          {resultOf("hdhiveLogin") && <p className="text-[10px] font-bold" style={{ color: resultOf("hdhiveLogin")!.ok ? "var(--accent-ok)" : "var(--accent-danger)" }}>{resultOf("hdhiveLogin")!.msg}</p>}
        </div>

        {/* 夸克网盘 */}
        <div className="glass glass-hover p-6 rounded-2xl space-y-4 transition-all">
          <h3 className="font-headline text-lg font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
            <Cloud className="w-5 h-5 text-emerald-500" />
            夸克网盘集成
          </h3>
          <textarea
            rows={2}
            placeholder="夸克网盘 Cookie"
            value={quarkCookie}
            onChange={(e) => setQuarkCookie(e.target.value)}
            className="w-full text-xs font-mono p-3 rounded-lg resize-none"
            style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input
              value={quarkDefaultFolderId}
              onChange={(e) => setQuarkDefaultFolderId(e.target.value)}
              placeholder="默认转存目录 ID"
              className="text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary"
              style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
            />
            <input
              value={quarkDefaultFolderName}
              onChange={(e) => setQuarkDefaultFolderName(e.target.value)}
              placeholder="默认目录名称"
              className="text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary"
              style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
            />
            <button
              disabled={isBusy("quarkDefaultFolder")}
              onClick={() => runAction("quarkDefaultFolder", "设置夸克默认目录", () => quarkApi.setDefaultFolder(quarkDefaultFolderId.trim(), quarkDefaultFolderName.trim()))}
              className="px-3 py-2 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1 justify-center"
            >
              <Save className="w-3 h-3" /> {isBusy("quarkDefaultFolder") ? "保存中" : "保存默认目录"}
            </button>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              disabled={isBusy("quarkUpdate")}
              onClick={() => runAction("quarkUpdate", "更新夸克 Cookie", () => quarkApi.updateCookie(quarkCookie))}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
            >
              <Save className="w-3 h-3" /> 保存
            </button>
            <button
              disabled={isBusy("quarkCheck")}
              onClick={() => runAction("quarkCheck", "夸克 Cookie 校验", () => quarkApi.checkCookie())}
              className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              <RefreshCw className="w-3 h-3" /> 校验
            </button>
            <button
              disabled={isBusy("quarkConn")}
              onClick={() => runAction("quarkConn", "夸克连通检测", () => quarkApi.checkConnectivity())}
              className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              <Wifi className="w-3 h-3" /> 连通性
            </button>
            {(resultOf("quarkCheck") || resultOf("quarkUpdate") || resultOf("quarkConn")) && (
              <span className="text-[10px] font-bold" style={{ color: (resultOf("quarkCheck") || resultOf("quarkUpdate") || resultOf("quarkConn"))!.ok ? "var(--accent-ok)" : "var(--accent-danger)" }}>
                {(resultOf("quarkCheck") || resultOf("quarkUpdate") || resultOf("quarkConn"))!.msg}
              </span>
            )}
            {resultOf("quarkDefaultFolder") && (
              <span className="text-[10px] font-bold" style={{ color: resultOf("quarkDefaultFolder")!.ok ? "var(--accent-ok)" : "var(--accent-danger)" }}>
                {resultOf("quarkDefaultFolder")!.msg}
              </span>
            )}
          </div>
        </div>

        {/* pansou */}
        <div className="glass glass-hover p-6 rounded-2xl space-y-4 transition-all">
          <h3 className="font-headline text-lg font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
            <Search className="w-5 h-5 text-purple-500" />
            pansou 网盘搜索服务
          </h3>
          <div className="flex flex-wrap gap-2 items-center">
            <button
              disabled={isBusy("pansouHealth")}
              onClick={() => runAction("pansouHealth", "pansou 健康检查", () => pansouApi.health())}
              className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              <HeartPulse className="w-3 h-3" /> 健康
            </button>
            <button
              disabled={isBusy("pansouGet")}
              onClick={() => runAction("pansouGet", "加载 pansou 配置", () => pansouApi.getConfig().then((r) => { setPansouConfig(r.data as Record<string, unknown>); return r; }))}
              className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              <RefreshCw className="w-3 h-3" /> 读取配置
            </button>
            <button
              disabled={isBusy("pansouCheck")}
              onClick={() => runAction("pansouCheck", "pansou 连通检测", () => settingsApi.checkPansou())}
              className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              <Radio className="w-3 h-3" /> 连通检测
            </button>
          </div>
          {pansouConfig && <pre className="text-[10px] rounded-xl p-2 overflow-auto max-h-32 font-mono" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" }}>{JSON.stringify(pansouConfig, null, 2)}</pre>}
        </div>

        {/* 代理 */}
        <div className="glass glass-hover p-6 rounded-2xl space-y-4 transition-all">
          <h3 className="font-headline text-lg font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
            <Wifi className="w-5 h-5" style={{ color: "var(--txt-secondary)" }} />
            代理配置
          </h3>
          <div className="flex gap-2 items-center">
            <button
              disabled={isBusy("proxy")}
              onClick={() => runAction("proxy", "读取代理配置", () => settingsApi.getProxy().then((r) => { setProxyInfo(r.data); return r; }))}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> 读取当前代理
            </button>
          </div>
          {proxyInfo != null && <pre className="text-[10px] rounded-xl p-2 overflow-auto max-h-32 font-mono" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" }}>{JSON.stringify(proxyInfo, null, 2)}</pre>}
        </div>

        {/* 榜单订阅 / 影人同步 */}
        <div className="glass glass-hover p-6 rounded-2xl space-y-4 transition-all">
          <h3 className="font-headline text-lg font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
            <BarChart3 className="w-5 h-5 text-amber-500" />
            榜单订阅 / 影人关注任务
          </h3>
          <div className="flex flex-wrap gap-2">
            <button
              disabled={isBusy("chartsRun")}
              onClick={() => runAction("chartsRun", "榜单订阅运行", () => settingsApi.runChartSubscription())}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
            >
              <Play className="w-3 h-3" /> {isBusy("chartsRun") ? "运行中" : "运行榜单订阅"}
            </button>
            <button
              disabled={isBusy("pfRun")}
              onClick={() => runAction("pfRun", "影人关注同步", () => settingsApi.runPersonFollow())}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
            >
              <Play className="w-3 h-3" /> {isBusy("pfRun") ? "运行中" : "影人关注同步"}
            </button>
            <button
              disabled={isBusy("chartsList")}
              onClick={() => runAction("chartsList", "加载可用榜单", () => settingsApi.getAvailableCharts())}
              className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              <RefreshCw className="w-3 h-3" /> 查看可用榜单
            </button>
          </div>
          {(resultOf("chartsRun") || resultOf("pfRun") || resultOf("chartsList")) && (
            <pre className="text-[10px] rounded-xl p-2 overflow-auto max-h-32 font-mono" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" }}>
              {JSON.stringify((resultOf("chartsRun") || resultOf("pfRun") || resultOf("chartsList"))!.msg, null, 2)}
            </pre>
          )}
        </div>

        {/* 系统信息 / TMDB / 更新检查 */}
        <div className="glass glass-hover p-6 rounded-2xl space-y-4 transition-all">
          <h3 className="font-headline text-lg font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
            <Info className="w-5 h-5" style={{ color: "var(--txt-secondary)" }} />
            系统信息 & 诊断
          </h3>
          <div className="flex flex-wrap gap-2">
            <button disabled={isBusy("appInfo")} onClick={() => runAction("appInfo", "应用信息", () => settingsApi.getAppInfo())}
              className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>
              <Server className="w-3 h-3" /> 应用版本
            </button>
            <button disabled={isBusy("updates")} onClick={() => runAction("updates", "检查更新", () => settingsApi.checkUpdates())}
              className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>
              <RefreshCw className="w-3 h-3" /> 检查更新
            </button>
            <button disabled={isBusy("tmdb")} onClick={() => runAction("tmdb", "TMDB 检测", () => settingsApi.checkTmdb())}
              className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>
              <Search className="w-3 h-3" /> TMDB 连通
            </button>
          </div>
        </div>
      </div>
      </CollapsibleSection>
      {/* ===== 服务集成面板结束 ===== */}

      <RuntimeAdvancedSettingsPanel addLog={addLog} />

      <CollapsibleSection icon={<Database className="w-4 h-4" />} title="归档高级配置" subtitle="监听目录、自动触发、二级目录与命名规则" badge="archive" defaultOpen={false}>
        <div className="space-y-5 pt-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer" style={{ color: "var(--txt-secondary)" }}>
                  <input type="checkbox" checked={archiveEnabled} onChange={(e) => setArchiveEnabled(e.target.checked)} className="accent-brand-primary" />
                  启用归档扫描
                </label>
                <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer" style={{ color: "var(--txt-secondary)" }}>
                  <input type="checkbox" checked={archiveAutoOnTransfer} onChange={(e) => setArchiveAutoOnTransfer(e.target.checked)} className="accent-brand-primary" />
                  转存后自动归档
                </label>
                <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer" style={{ color: "var(--txt-secondary)" }}>
                  <input type="checkbox" checked={archiveAutoOnOffline} onChange={(e) => setArchiveAutoOnOffline(e.target.checked)} className="accent-brand-primary" />
                  离线完成自动归档
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-1.5 block">
                  <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>监听目录 CID</span>
                  <input value={archiveWatchCid} onChange={(e) => setArchiveWatchCid(e.target.value)} className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }} />
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>监听目录名称</span>
                  <input value={archiveWatchName} onChange={(e) => setArchiveWatchName(e.target.value)} className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }} />
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>输出目录 CID</span>
                  <input value={archiveOutputCid} onChange={(e) => setArchiveOutputCid(e.target.value)} className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }} />
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>输出目录名称</span>
                  <input value={archiveOutputName} onChange={(e) => setArchiveOutputName(e.target.value)} className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }} />
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>扫描间隔(分钟)</span>
                  <input type="number" min={1} value={archiveIntervalMinutes} onChange={(e) => setArchiveIntervalMinutes(Number(e.target.value))} className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }} />
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>离线监控间隔(分钟)</span>
                  <input type="number" min={1} value={offlineMonitorIntervalMinutes} onChange={(e) => setOfflineMonitorIntervalMinutes(Number(e.target.value))} className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }} />
                </label>
              </div>
            </div>
            <div className="space-y-3">
              <label className="space-y-1.5 block">
                <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>archive_subdirs JSON</span>
                <textarea rows={7} value={archiveSubdirsInput} onChange={(e) => setArchiveSubdirsInput(e.target.value)} className="w-full text-xs font-mono rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }} />
              </label>
              <label className="space-y-1.5 block">
                <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>archive_naming JSON</span>
                <textarea rows={5} value={archiveNamingInput} onChange={(e) => setArchiveNamingInput(e.target.value)} className="w-full text-xs font-mono rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }} />
              </label>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isBusy("archiveConfigSave")}
              onClick={saveArchiveConfig}
              className="px-4 py-2 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
            >
              <Save className="w-3 h-3" /> {isBusy("archiveConfigSave") ? "保存中" : "保存归档配置"}
            </button>
            <button
              type="button"
              disabled={isBusy("archiveScan")}
              onClick={() => runAction("archiveScan", "触发归档扫描", () => archiveApi.runScan())}
              className="glass-hover px-4 py-2 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              <Play className="w-3 h-3" /> 立即扫描
            </button>
            {resultOf("archiveConfigSave") && (
              <span className="text-[10px] font-bold self-center" style={{ color: resultOf("archiveConfigSave")!.ok ? "var(--accent-ok)" : "var(--accent-danger)" }}>
                {resultOf("archiveConfigSave")!.msg}
              </span>
            )}
          </div>
        </div>
      </CollapsibleSection>

      <form onSubmit={handleSaveSettings} className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left column forms: Standard Configurations */}
        <div className="lg:col-span-7 space-y-8">
          <CollapsibleSection icon={<Radio className="w-4 h-4" />} title="MoviePilot PT 后端" subtitle="PT 搜索、订阅与下载执行后端" badge="PT" defaultOpen>
          <div className="space-y-5 pt-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-headline text-lg font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
                <Radio className="w-5 h-5 text-brand-primary" />
                MoviePilot 接入配置
              </h3>
              <label className="inline-flex items-center gap-2 text-xs font-black cursor-pointer" style={{ color: "var(--txt-secondary)" }}>
                <input
                  type="checkbox"
                  checked={moviepilotEnabled}
                  onChange={(e) => setMoviepilotEnabled(e.target.checked)}
                  className="accent-brand-primary"
                />
                启用
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-1 block md:col-span-2">
                <span className="text-xs font-bold" style={{ color: "var(--txt-secondary)" }}>MoviePilot 地址</span>
                <input
                  type="text"
                  placeholder="http://moviepilot:3000"
                  value={moviepilotBaseUrl}
                  onChange={(e) => setMoviepilotBaseUrl(e.target.value)}
                  className="w-full text-sm font-mono px-3.5 py-2.5 rounded-lg focus:outline-none focus:border-brand-primary"
                  style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold" style={{ color: "var(--txt-secondary)" }}>用户名</span>
                <input
                  type="text"
                  value={moviepilotUsername}
                  onChange={(e) => setMoviepilotUsername(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-lg focus:outline-none focus:border-brand-primary"
                  style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
                />
              </label>
              <label className="space-y-1 block">
                <span className="text-xs font-bold" style={{ color: "var(--txt-secondary)" }}>密码</span>
                <input
                  type="password"
                  value={moviepilotPassword}
                  onChange={(e) => setMoviepilotPassword(e.target.value)}
                  placeholder={moviepilotPasswordConfigured ? "已保存，留空不更新" : "MoviePilot 登录密码"}
                  className="w-full text-xs px-3 py-2 rounded-lg focus:outline-none focus:border-brand-primary"
                  style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
                />
              </label>
              <label className="space-y-1 block md:col-span-2">
                <span className="text-xs font-bold" style={{ color: "var(--txt-secondary)" }}>PT 下载入库路径</span>
                <input
                  type="text"
                  placeholder="/incoming/pt"
                  value={moviepilotSavePath}
                  onChange={(e) => setMoviepilotSavePath(e.target.value)}
                  className="w-full text-sm font-mono px-3.5 py-2.5 rounded-lg focus:outline-none focus:border-brand-primary"
                  style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isBusy("moviepilotConfigSave")}
                onClick={saveMoviePilotSettings}
                className="px-4 py-2 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
              >
                <Save className="w-3 h-3" /> {isBusy("moviepilotConfigSave") ? "保存中" : "保存配置"}
              </button>
              <button
                type="button"
                disabled={isBusy("moviepilotHealth")}
                onClick={() => runAction("moviepilotHealth", "MoviePilot 连通检测", () => moviepilotApi.health())}
                className="glass-hover px-4 py-2 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
                style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
              >
                <RefreshCw className={`w-3 h-3 ${isBusy("moviepilotHealth") ? "animate-spin" : ""}`} /> 连通检测
              </button>
              {resultOf("moviepilotConfigSave") && (
                <span className="text-[10px] font-bold self-center" style={{ color: resultOf("moviepilotConfigSave")!.ok ? "var(--accent-ok)" : "var(--accent-danger)" }}>
                  {resultOf("moviepilotConfigSave")!.msg}
                </span>
              )}
              {resultOf("moviepilotHealth") && (
                <span className="text-[10px] font-bold self-center" style={{ color: resultOf("moviepilotHealth")!.ok ? "var(--accent-ok)" : "var(--accent-danger)" }}>
                  {resultOf("moviepilotHealth")!.msg}
                </span>
              )}
            </div>
          </div>
          </CollapsibleSection>

          {/* Card 1: 115 Account cookie setting */}
          <CollapsibleSection icon={<Cloud className="w-4 h-4" />} title="115 云盘授权设置" badge="凭据" defaultOpen>
          <div className="space-y-5 pt-3">
            <h3 className="font-headline text-lg font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <Cloud className="w-5 h-5 text-brand-primary" />
              115 云盘授权参数设置 (Cookies)
            </h3>

            <div className="space-y-1">
              <label className="text-xs font-bold" style={{ color: "var(--txt-secondary)" }}>115 浏览器 Cookie 原始字符串 (全字段) *</label>
              <textarea
                rows={3}
                placeholder="键入您的 115 浏览器 Cookie 原始串 (包含 UID, CID, SEID, 登录令牌以保证同步后台握手正常...)"
                value={cookie115}
                onChange={(e) => setCookie115(e.target.value)}
                className="w-full text-xs font-mono p-3 rounded-lg resize-none focus:outline-none focus:border-brand-primary"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
              />
              <p className="text-[10px]" style={{ color: "var(--txt-muted)" }}>
                可以使用扫码或开发者工具抓取, 凭证均安全持久化保留在本地设备 or 会话缓存.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold" style={{ color: "var(--txt-secondary)" }}>NAS 统筹媒体存储绝对路径 (strm 保存点) *</label>
              <input
                type="text"
                placeholder="e.g. /volume1/Media"
                value={localMountPath}
                onChange={(e) => setLocalMountPath(e.target.value)}
                className="w-full text-sm font-mono px-3.5 py-2.5 rounded-lg focus:outline-none focus:border-brand-primary"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
              />
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={test115Connection}
                disabled={isTesting115}
                className="glass-hover w-full py-2.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                style={{ background: "var(--surface-subtle)", color: "var(--brand-primary)", border: "1px solid var(--border)" }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTesting115 ? "animate-spin" : ""}`} />
                <span>{isTesting115 ? "正与网盘安全连接建立中..." : "测试 115 API 会话可用性"}</span>
              </button>
            </div>
          </div>
          </CollapsibleSection>

          {/* Card 2: Emby & Plex webhooks client mapping */}
          <CollapsibleSection icon={<Server className="w-4 h-4" />} title="媒体服务器连接" badge="Emby" defaultOpen>
          <div className="space-y-5 pt-3">
            <h3 className="font-headline text-lg font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <Server className="w-5 h-5 text-brand-secondary" />
              本地多媒体应用服务器连接 (Emby)
            </h3>

            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-4 pt-1">
                <div className="flex items-center gap-1 text-xs font-bold" style={{ color: "var(--txt-secondary)" }}>
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span>Emby Server 极速钩子 (增量库刷新)</span>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>Emby API 地址</label>
                    <input
                      type="text"
                      placeholder="e.g. http://192.168.1.100:8096"
                      value={embyUrl}
                      onChange={(e) => setEmbyUrl(e.target.value)}
                      className="w-full text-xs font-mono px-3 py-2 rounded focus:outline-none focus:border-brand-primary"
                      style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>Emby 登录 API 证书秘钥 (Token)</label>
                    <input
                      type="password"
                      placeholder="e.g. emby_key_xxx"
                      value={embyKey}
                      onChange={(e) => setEmbyKey(e.target.value)}
                      className="w-full text-xs font-mono px-3 py-2 rounded focus:outline-none focus:border-brand-primary"
                      style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={testEmbyConnection}
                disabled={isTestingEmby}
                className="glass-hover w-full py-2.5 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                style={{ background: "var(--surface-subtle)", color: "var(--brand-secondary)", border: "1px solid var(--border)" }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTestingEmby ? "animate-spin" : ""}`} />
                <span>{isTestingEmby ? "正在测试 Emby 连通状态..." : "测试 Emby API 通道与 Webscan 权限"}</span>
              </button>
            </div>
          </div>
          </CollapsibleSection>

          <CollapsibleSection icon={<RefreshCw className="w-4 h-4" />} title="订阅扫描参数" badge="调度" defaultOpen>
          <div className="space-y-6 pt-3">
            <h3 className="font-headline text-lg font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <RefreshCw className="w-5 h-5 text-brand-primary" />
              订阅扫描间隔
            </h3>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold" style={{ color: "var(--txt-secondary)" }}>
                  <span>订阅任务定时检查间隔</span>
                  <span className="text-brand-primary">{refreshInterval} 分钟 / 周期</span>
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
                  保存后会写入后端 subscription_interval_hours，并由调度服务接管。
                </p>
              </div>
            </div>
          </div>

          {/* Submit Action Block */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="submit"
              disabled={isSaving}
              className="px-8 py-3.5 bg-brand-primary text-white text-sm font-bold rounded-xl hover:bg-opacity-95 transition-all shadow-lg shadow-brand-primary/10 flex items-center gap-2 active:scale-95 disabled:bg-slate-400"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? "正在进行安全保存..." : "保存当前全部系统配置"}</span>
            </button>
          </div>
          </CollapsibleSection>
        </div>

        {/* Right column: account controls and debug log terminal */}
        <div className="lg:col-span-5 space-y-8">
        <CollapsibleSection icon={<Key className="w-4 h-4" />} title="登录账号安全" badge="auth" defaultOpen={false}>
          <div className="space-y-4 pt-3">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>登录账号</label>
              <input
                value={accountUsername}
                onChange={(e) => setAccountUsername(e.target.value)}
                className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>当前密码</label>
              <input
                type="password"
                value={accountCurrentPassword}
                onChange={(e) => setAccountCurrentPassword(e.target.value)}
                className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary"
                style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>新密码</label>
                <input
                  type="password"
                  value={accountNewPassword}
                  onChange={(e) => setAccountNewPassword(e.target.value)}
                  className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary"
                  style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>确认新密码</label>
                <input
                  type="password"
                  value={accountNewPasswordConfirm}
                  onChange={(e) => setAccountNewPasswordConfirm(e.target.value)}
                  className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary"
                  style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
                />
              </div>
            </div>
            <button
              type="button"
              disabled={isBusy("authCredentialsSave")}
              onClick={saveAccountCredentials}
              className="w-full px-4 py-2 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1 justify-center"
            >
              <Save className="w-3 h-3" /> {isBusy("authCredentialsSave") ? "保存中" : "保存账号凭证"}
            </button>
            {resultOf("authCredentialsSave") && (
              <p className="text-[10px] font-bold" style={{ color: resultOf("authCredentialsSave")!.ok ? "var(--accent-ok)" : "var(--accent-danger)" }}>
                {resultOf("authCredentialsSave")!.msg}
              </p>
            )}
          </div>
        </CollapsibleSection>

        <CollapsibleSection icon={<Terminal className="w-4 h-4" />} title="实时操作日志" badge={`${logs.length}`} defaultOpen={false}>
        <div className="bg-slate-900/80 backdrop-blur-xl text-gray-200 rounded-2xl p-6 shadow-xl flex flex-col justify-between h-[640px] border border-slate-800/60 font-mono select-none">
          <div className="space-y-4 h-full flex flex-col justify-between">
            {/* Terminal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-700/60 shrink-0">
              <div className="flex items-center gap-2">
                <Terminal className="w-5 h-5 text-brand-primary-light" />
                <span className="text-xs font-bold tracking-wider">SYSTEM CONNECT LOGGER (API)</span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  title="触发归档扫描（全量同步）"
                  onClick={forceSyncRun}
                  className="p-1.5 hover:bg-gray-700 rounded text-brand-primary-light hover:text-white transition-colors"
                >
                  <RefreshCw className="w-4 h-4 animate-spin-hover" />
                </button>
                <button
                  type="button"
                  title="清空终端日志"
                  onClick={clearTerminalLogs}
                  className="p-1.5 hover:bg-gray-700 rounded text-red-400 hover:text-red-300 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <button type="button" title="日志模块列表"
                  onClick={async () => { try { const r = await logsApi.modules(); setLogs(prev => [...prev, {id:"m1", timestamp:new Date().toISOString(), level:"INFO", message:`日志模块: ${JSON.stringify(r.data)}`}]); } catch(e: unknown) { await addLog("ERROR", getApiErrorMessage(e)); } }}
                  className="p-1.5 hover:bg-gray-700 rounded text-blue-400 transition-colors"><Database className="w-4 h-4" /></button>
                <button type="button" title="清理旧日志(30天)"
                  onClick={async () => { try { await logsApi.prune(30); await addLog("SUCCESS", "已清理30天前旧日志"); } catch(e: unknown) { await addLog("ERROR", getApiErrorMessage(e)); } }}
                  className="p-1.5 hover:bg-gray-700 rounded text-amber-400 transition-colors"><AlertTriangle className="w-4 h-4" /></button>
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
                  let badgeColor = "text-blue-400";
                  if (log.level === "SUCCESS") badgeColor = "text-green-400";
                  if (log.level === "WARN") badgeColor = "text-amber-400";
                  if (log.level === "ERROR") badgeColor = "text-red-400";

                  return (
                    <div key={log.id} className="space-y-0.5">
                      <div className="flex items-center gap-1.5 text-gray-500 font-bold">
                        <span>[{log.timestamp}]</span>
                        <span className={`font-black ${badgeColor}`}>[{log.level}]</span>
                      </div>
                      <div className="pl-4 text-gray-300 break-all leading-tight">
                        {log.message}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={terminalEndRef} />
            </div>

            {/* Terminal Footer Indicator */}
            <div className="pt-3 border-t border-gray-700/60 flex items-center justify-between text-[10px] text-gray-500 shrink-0">
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
                后端 API 日志已连接
              </span>
              <span>v1.0.8-Alpha-Stable</span>
            </div>
          </div>
        </div>
        </CollapsibleSection>
        </div>
      </form>
    </div>
  );
}
