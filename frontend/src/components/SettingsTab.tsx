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
  Cloud
} from "lucide-react";
import { motion } from "motion/react";
import { settingsApi } from "../api/settings";
import { pan115Api } from "../api/pan115";
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
        <h2 className="font-headline text-4xl font-black text-txt-dark mb-2">系统参数设置</h2>
        <p className="text-sm text-slate-500">配置 115 账号凭据、本地 Emby 钩子、线程吞吐及查看实时数据调试日志</p>
      </section>

      <form onSubmit={handleSaveSettings} className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left column forms: Standard Configurations */}
        <div className="lg:col-span-7 space-y-8">
          {/* Card 1: 115 Account cookie setting */}
          <div className="bg-white/70 backdrop-blur-md p-6 rounded-2xl border border-white/60 shadow-sm space-y-5 hover:bg-white/80 transition-all">
            <h3 className="font-headline text-lg font-bold text-txt-dark flex items-center gap-2">
              <Cloud className="w-5 h-5 text-brand-primary" />
              115 云盘授权参数设置 (Cookies)
            </h3>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">115 浏览器 Cookie 原始字符串 (全字段) *</label>
              <textarea
                required
                rows={3}
                placeholder="键入您的 115 浏览器 Cookie 原始串 (包含 UID, CID, SEID, 登录令牌以保证同步后台握手正常...)"
                value={cookie115}
                onChange={(e) => setCookie115(e.target.value)}
                className="w-full text-xs font-mono p-3 rounded-lg border border-slate-100 focus:outline-none focus:border-brand-primary bg-white resize-none"
              />
              <p className="text-[10px] text-slate-400">
                可以使用扫码或开发者工具抓取, 凭证均安全持久化保留在本地设备 or 会话缓存.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">NAS 统筹媒体存储绝对路径 (strm 保存点) *</label>
              <input
                type="text"
                required
                placeholder="e.g. /volume1/Media"
                value={localMountPath}
                onChange={(e) => setLocalMountPath(e.target.value)}
                className="w-full text-sm font-mono px-3.5 py-2.5 rounded-lg border border-slate-100 focus:outline-none focus:border-brand-primary"
              />
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={test115Connection}
                disabled={isTesting115}
                className="w-full py-2.5 bg-slate-50 hover:bg-slate-100/50 text-brand-primary border border-slate-100 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTesting115 ? "animate-spin" : ""}`} />
                <span>{isTesting115 ? "正与网盘安全连接建立中..." : "测试 115 API 会话可用性"}</span>
              </button>
            </div>
          </div>

          {/* Card 2: Emby & Plex webhooks client mapping */}
          <div className="bg-white/70 backdrop-blur-md p-6 rounded-2xl border border-white/60 shadow-sm space-y-5 hover:bg-white/80 transition-all">
            <h3 className="font-headline text-lg font-bold text-txt-dark flex items-center gap-2">
              <Server className="w-5 h-5 text-brand-secondary" />
              本地多媒体应用服务器连接 (Emby)
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-4 pt-1">
                <div className="flex items-center gap-1 text-xs font-bold text-slate-500">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span>Emby Server 极速钩子 (增量库刷新)</span>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400">Emby API 地址</label>
                    <input
                      type="text"
                      placeholder="e.g. http://192.168.1.100:8096"
                      value={embyUrl}
                      onChange={(e) => setEmbyUrl(e.target.value)}
                      className="w-full text-xs font-mono px-3 py-2 rounded border border-slate-100 focus:outline-none focus:border-brand-primary bg-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400">Emby 登录 API 证书秘钥 (Token)</label>
                    <input
                      type="password"
                      placeholder="e.g. emby_key_xxx"
                      value={embyKey}
                      onChange={(e) => setEmbyKey(e.target.value)}
                      className="w-full text-xs font-mono px-3 py-2 rounded border border-slate-100 focus:outline-none focus:border-brand-primary bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* Plex section — backend has no Plex support; configuration is NOT persisted.
                  UI kept for potential future use. */}
              <div className="space-y-4 pt-1 border-t md:border-t-0 md:border-l md:pl-4 border-slate-100">
                <div className="flex items-center gap-1 text-xs font-bold text-slate-500">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>Plex Server 极速钩子</span>
                  <span className="text-[9px] text-red-400 ml-1">（后端暂未支持，配置不会保存）</span>
                </div>

                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400">Plex API 地址</label>
                    <input
                      type="text"
                      placeholder="e.g. http://127.0.0.1:32400"
                      value={plexUrl}
                      onChange={(e) => setPlexUrl(e.target.value)}
                      className="w-full text-xs font-mono px-3 py-2 rounded border border-slate-100 focus:outline-none focus:border-brand-primary bg-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400">Plex-X-Token 认证识别码</label>
                    <input
                      type="password"
                      placeholder="e.g. plex_token_xxx"
                      value={plexToken}
                      onChange={(e) => setPlexToken(e.target.value)}
                      className="w-full text-xs font-mono px-3 py-2 rounded border border-slate-100 focus:outline-none focus:border-brand-primary bg-white"
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
                className="w-full py-2.5 bg-slate-50 hover:bg-slate-100/50 text-brand-secondary border border-slate-100 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTestingEmby ? "animate-spin" : ""}`} />
                <span>{isTestingEmby ? "正在测试 Emby 连通状态..." : "测试 Emby API 通道与 Webscan 权限"}</span>
              </button>
            </div>
          </div>

          {/* Card 3: Advanced — maxThreads has no backend equivalent; subscription_interval_hours is mapped */}
          <div className="bg-white/70 backdrop-blur-md p-6 rounded-2xl border border-white/60 shadow-sm space-y-6 hover:bg-white/80 transition-all">
            <h3 className="font-headline text-lg font-bold text-txt-dark flex items-center gap-2">
              <Cpu className="w-5 h-5 text-brand-primary" />
              后台极速扫库 &amp; 并发性能 parameters 设定
            </h3>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold text-slate-500">
                  <span>最大并行异步同步扫描线程限制</span>
                  <span className="text-brand-primary">{maxThreads} 个并发流</span>
                  <span className="text-[9px] text-red-400 ml-1">（后端暂未支持，此参数不生效）</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={32}
                  value={maxThreads}
                  onChange={(e) => setMaxThreads(Number(e.target.value))}
                  className="w-full accent-brand-primary h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                />
                <p className="text-[10px] text-slate-400">
                  设置线程过高（超过 16 线程）在遭遇冷数据首次索引极易触发 115 端 API 403 频控，推荐设置为 8-12 线程。
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold text-slate-500">
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
                  className="w-full accent-brand-primary h-2 bg-slate-100 rounded-lg appearance-none cursor-pointer"
                />
                <p className="text-[10px] text-slate-400">
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
        </div>

        {/* Right column: Debug Log terminal */}
        <div className="lg:col-span-5 bg-slate-900/80 backdrop-blur-xl text-gray-200 rounded-2xl p-6 shadow-xl flex flex-col justify-between h-[640px] border border-slate-800/60 sticky top-24 font-mono select-none">
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
      </form>
    </div>
  );
}
