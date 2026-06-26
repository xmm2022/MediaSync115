/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from "react";
import { SyncLog } from "../types";
import {
  Save,
  Settings,
  Key,
  Terminal,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Server,
  UserCheck,
  Cpu,
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
} from "lucide-react";
import { motion } from "motion/react";
import CollapsibleSection from "./CollapsibleSection";
import { settingsApi } from "../api/settings";
import { pan115Api } from "../api/pan115";
import { quarkApi } from "../api/quark";
import { pansouApi } from "../api/pansou";
import { logsApi } from "../api/logs";
import { archiveApi } from "../api/archive";

interface SettingsTabProps {
  logs: SyncLog[];
  setLogs: React.Dispatch<React.SetStateAction<SyncLog[]>>;
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => void;
}

export default function SettingsTab({ logs, setLogs, addLog }: SettingsTabProps) {
  // Input fields — initialised empty; populated by real backend GET on mount
  const [cookie115, setCookie115] = useState("");
  const [localMountPath, setLocalMountPath] = useState("");

  const [embyUrl, setEmbyUrl] = useState("");
  const [embyKey, setEmbyKey] = useState("");

  // Plex fields — backend has no Plex support; UI kept for future use
  const [plexUrl, setPlexUrl] = useState("");
  const [plexToken, setPlexToken] = useState("");

  // maxThreads — no backend equivalent; UI kept as informational placeholder
  const [maxThreads, setMaxThreads] = useState(8);
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
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || String(err);
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

  // pansou 配置
  const [pansouConfig, setPansouConfig] = useState<Record<string, unknown> | null>(null);

  // 代理
  const [proxyInfo, setProxyInfo] = useState<unknown>(null);

  // 健康总览
  const [healthAll, setHealthAll] = useState<unknown>(null);

  // TG 登录状态
  const [tgLoginStatus, setTgLoginStatus] = useState<unknown>(null);

  // Bot 状态
  const [botStatus, setBotStatus] = useState<unknown>(null);

  // HDHive 登录状态
  const [hdhiveLoginStatus, setHdhiveLoginStatus] = useState<unknown>(null);

  // 可用榜单
  const [availableCharts, setAvailableCharts] = useState<unknown>(null);

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
      setTgQrStatus(`启动失败: ${String(err)}`);
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
        // Note: archive_watch_cid is a 115 cloud CID, separate from strm_output_dir;
        // it is not exposed in this UI tab (needs a different config UI).
      } catch (err) {
        console.error("Failed to load runtime settings:", err);
        addLog("ERROR", "加载运行时设置失败: " + (err instanceof Error ? err.message : String(err)));
      }

      try {
        // Fetch 115 cookie (masked by backend)
        const cookieResp = await pan115Api.getCookieInfo();
        const masked = String(cookieResp.data.masked_cookie || "");
        setCookie115(masked);
        savedCookieRef.current = masked;
      } catch (err) {
        console.error("Failed to load 115 cookie info:", err);
        addLog("ERROR", "加载115 Cookie信息失败: " + (err instanceof Error ? err.message : String(err)));
      }
    };
    loadConfig();

    // Auto-load service integration data (fire-and-forget, non-blocking)
    const loadServices = async () => {
      const safe = <T,>(p: Promise<T>) => p.catch(() => null);
      const [health, quarkInfo, pansouCfg, proxyCfg, botStatus, hdhiveStatus, charts] = await Promise.all([
        safe(settingsApi.checkAllHealth()),
        safe(quarkApi.getCookieInfo()),
        safe(pansouApi.getConfig()),
        safe(settingsApi.getProxy()),
        safe(settingsApi.getTgBotStatus()),
        safe(settingsApi.checkHdhive()),
        safe(settingsApi.getAvailableCharts()),
      ]);
      if (health) setHealthAll(health.data);
      if (quarkInfo) setQuarkCookie(String((quarkInfo.data as Record<string, unknown>)?.cookie || ""));
      if (pansouCfg) setPansouConfig(pansouCfg.data as Record<string, unknown>);
      if (proxyCfg) setProxyInfo(proxyCfg.data);
      if (botStatus) setBotStatus(botStatus.data);
      if (hdhiveStatus) setHdhiveLoginStatus(hdhiveStatus.data);
      if (charts) setAvailableCharts(charts.data);
    };
    void loadServices();
  }, []);

  // Save settings to real backend: runtime settings PUT + 115 cookie update
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      // Build runtime settings payload with backend field names.
      // Fields with no backend support (plexUrl, plexToken, maxThreads) are deliberately omitted.
      const payload: Record<string, unknown> = {
        emby_url: embyUrl || undefined,
        emby_api_key: embyKey || undefined,
        strm_output_dir: localMountPath || undefined,
        subscription_interval_hours: refreshInterval
          ? Math.max(1, Math.round(refreshInterval / 60)) // minutes → hours (backend unit)
          : undefined,
      };
      await settingsApi.updateRuntime(payload);

      // Update 115 cookie if it was edited (and is non-empty)
      if (cookie115 && cookie115 !== savedCookieRef.current) {
        try {
          await pan115Api.updateCookie(cookie115);
          savedCookieRef.current = cookie115;
        } catch (cookieErr) {
          console.error("Failed to update 115 cookie:", cookieErr);
          addLog("ERROR", "115 Cookie 更新失败: " + (cookieErr instanceof Error ? cookieErr.message : String(cookieErr)));
          // Continue — runtime settings may still have saved successfully
        }
      }

      addLog("SUCCESS", "系统配置已保存到后端");
    } catch (err) {
      console.error("Failed to save config to server:", err);
      addLog("ERROR", "无法向后端保存配置信息: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSaving(false);
    }
  };

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
          addLog("ERROR", "115 Cookie 更新失败（测试前保存）: " + (updateErr instanceof Error ? updateErr.message : String(updateErr)));
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
      addLog("ERROR", "115 会话握手测试失败: " + (err instanceof Error ? err.message : String(err)));
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
      addLog("ERROR", "Emby Webscan Webhook 测试失败: " + (err instanceof Error ? err.message : String(err)));
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
      addLog("ERROR", "清空服务端日志失败: " + (err instanceof Error ? err.message : String(err)));
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
      addLog("ERROR", "触发归档扫描失败: " + (err instanceof Error ? err.message : String(err)));
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
            onClick={() => runAction("feiniuCheck", "飞牛连通检测", () => settingsApi.checkFeiniu())}
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
          <div className="pt-3 flex gap-2 items-center" style={{ borderTop: "1px solid var(--border)" }}>
            <Bot className="w-4 h-4" style={{ color: "var(--txt-secondary)" }} />
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
              onClick={() => runAction("tgBotStatus", "查询 TG Bot 状态", () => settingsApi.getTgBotStatus())}
              className="glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              <Server className="w-3 h-3" /> Bot 状态
            </button>
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
      </div>
      </CollapsibleSection>
      {/* ===== 服务集成面板结束 ===== */}

      <form onSubmit={handleSaveSettings} className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left column forms: Standard Configurations */}
        <div className="lg:col-span-7 space-y-8">
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
                required
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
                required
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

              {/* Plex section — backend has no Plex support; configuration is NOT persisted.
                  UI kept for potential future use. */}
              <div className="space-y-4 pt-1 md:pl-4 theme-border border-t md:border-t-0 md:border-l">
                <div className="flex items-center gap-1 text-xs font-bold" style={{ color: "var(--txt-secondary)" }}>
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>Plex Server 极速钩子</span>
                  <span className="text-[9px] ml-1" style={{ color: "var(--accent-danger)" }}>（后端暂未支持，配置不会保存）</span>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>Plex API 地址</label>
                    <input
                      type="text"
                      placeholder="e.g. http://127.0.0.1:32400"
                      value={plexUrl}
                      onChange={(e) => setPlexUrl(e.target.value)}
                      className="w-full text-xs font-mono px-3 py-2 rounded focus:outline-none focus:border-brand-primary"
                      style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>Plex-X-Token 认证识别码</label>
                    <input
                      type="password"
                      placeholder="e.g. plex_token_xxx"
                      value={plexToken}
                      onChange={(e) => setPlexToken(e.target.value)}
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

          {/* Card 3: Advanced — maxThreads has no backend equivalent; subscription_interval_hours is mapped */}
          <CollapsibleSection icon={<Cpu className="w-4 h-4" />} title="系统性能参数" badge="调优" defaultOpen>
          <div className="space-y-6 pt-3">
            <h3 className="font-headline text-lg font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <Cpu className="w-5 h-5 text-brand-primary" />
              后台极速扫库 &amp; 并发性能 parameters 设定
            </h3>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold" style={{ color: "var(--txt-secondary)" }}>
                  <span>最大并行异步同步扫描线程限制</span>
                  <span className="text-brand-primary">{maxThreads} 个并发流</span>
                  <span className="text-[9px] ml-1" style={{ color: "var(--accent-danger)" }}>（后端暂未支持，此参数不生效）</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={32}
                  value={maxThreads}
                  onChange={(e) => setMaxThreads(Number(e.target.value))}
                  className="w-full accent-brand-primary h-2 rounded-lg appearance-none cursor-pointer"
                  style={{ background: "var(--surface-subtle)" }}
                />
                <p className="text-[10px]" style={{ color: "var(--txt-muted)" }}>
                  设置线程过高（超过 16 线程）在遭遇冷数据首次索引极易触发 115 端 API 403 频控，推荐设置为 8-12 线程。
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold" style={{ color: "var(--txt-secondary)" }}>
                  <span>视频目录定时扫描比对刷新间隔</span>
                  <span className="text-brand-primary">{refreshInterval} 分钟 / 周期</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={120}
                  step={5}
                  value={refreshInterval}
                  onChange={(e) => setRefreshInterval(Number(e.target.value))}
                  className="w-full accent-brand-primary h-2 rounded-lg appearance-none cursor-pointer"
                  style={{ background: "var(--surface-subtle)" }}
                />
                <p className="text-[10px]" style={{ color: "var(--txt-muted)" }}>
                  每次循环检索 115 会话日志以抓取新文件，较短时间会令 CPU 与网盘处于轻微载荷中。
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

        {/* Right column: Debug Log terminal */}
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
                离线仿真模拟服务已全开
              </span>
              <span>v1.0.8-Alpha-Stable</span>
            </div>
          </div>
        </div>
        </CollapsibleSection>
      </form>
    </div>
  );
}
