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

interface SettingsTabProps {
  logs: SyncLog[];
  setLogs: React.Dispatch<React.SetStateAction<SyncLog[]>>;
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => void;
}

export default function SettingsTab({ logs, setLogs, addLog }: SettingsTabProps) {
  // Input fields loaded from full-stack backend config
  const [cookie115, setCookie115] = useState("115_UID_3948512_CID_85_SEID_ab6f9ea2cd8...");
  const [localMountPath, setLocalMountPath] = useState("./MediaSync115_Mount");
  
  const [embyUrl, setEmbyUrl] = useState("http://192.168.1.100:8096");
  const [embyKey, setEmbyKey] = useState("emby_ak_842aef912cbd3948...");

  const [plexUrl, setPlexUrl] = useState("http://127.0.0.1:32400");
  const [plexToken, setPlexToken] = useState("plex_tk_abc123secret...");

  // Constants sliders
  const [maxThreads, setMaxThreads] = useState(12);
  const [refreshInterval, setRefreshInterval] = useState(15);

  const [isTesting115, setIsTesting115] = useState(false);
  const [isTestingEmby, setIsTestingEmby] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Load config from backend
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch("/api/config");
        if (response.ok) {
          const config = await response.json();
          setCookie115(config.cookie115);
          setLocalMountPath(config.localMountPath);
          setEmbyUrl(config.embyUrl);
          setEmbyKey(config.embyKey);
          setPlexUrl(config.plexUrl);
          setPlexToken(config.plexToken);
          setMaxThreads(config.maxThreads);
          setRefreshInterval(config.refreshInterval);
        }
      } catch (err) {
        console.error("Failed to load backend config:", err);
      }
    };
    loadConfig();
  }, []);

  // Save settings to backend
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const response = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cookie115,
          localMountPath,
          embyUrl,
          embyKey,
          plexUrl,
          plexToken,
          maxThreads,
          refreshInterval
        })
      });
      if (!response.ok) {
        throw new Error("HTTP Error " + response.status);
      }
    } catch (err) {
      console.error("Failed to save config to server:", err);
      addLog("ERROR", "无法向后端保存配置信息：" + err);
    } finally {
      setIsSaving(false);
    }
  };

  // Test 115 connection on server
  const test115Connection = async () => {
    setIsTesting115(true);
    try {
      const response = await fetch("/api/test/115", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cookie: cookie115 })
      });
      if (!response.ok) {
        throw new Error("HTTP Error " + response.status);
      }
    } catch (err) {
      console.error("Failed to test 115:", err);
      addLog("ERROR", "115 会话握手测试失败: " + err);
    } finally {
      setIsTesting115(false);
    }
  };

  // Test Emby/Plex webhooks connection on server
  const testEmbyConnection = async () => {
    setIsTestingEmby(true);
    try {
      const response = await fetch("/api/test/emby", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: embyUrl, key: embyKey })
      });
      if (!response.ok) {
        throw new Error("HTTP Error " + response.status);
      }
    } catch (err) {
      console.error("Failed to test Emby:", err);
      addLog("ERROR", "Emby Webscan Webhook 测试失败: " + err);
    } finally {
      setIsTestingEmby(false);
    }
  };

  // Clear logs terminal on server
  const clearTerminalLogs = async () => {
    try {
      const response = await fetch("/api/logs/clear", { method: "POST" });
      if (response.ok) {
        setLogs([]);
      }
    } catch (err) {
      console.error("Failed to clear logs on server:", err);
    }
  };

  // Simulate a live random synchronization task run by posting to the server's sync endpoint
  const forceMockSyncRun = async () => {
    try {
      await fetch("/api/sync/run", { method: "POST" });
    } catch (err) {
      console.error("Failed to force mock sync run:", err);
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
              本地多媒体应用服务器连接 (Emby & Plex)
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

              <div className="space-y-4 pt-1 border-t md:border-t-0 md:border-l md:pl-4 border-slate-100">
                <div className="flex items-center gap-1 text-xs font-bold text-slate-500">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span>Plex Server 极速钩子</span>
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

          {/* Card 3: Advanced thread limitations */}
          <div className="bg-white/70 backdrop-blur-md p-6 rounded-2xl border border-white/60 shadow-sm space-y-6 hover:bg-white/80 transition-all">
            <h3 className="font-headline text-lg font-bold text-txt-dark flex items-center gap-2">
              <Cpu className="w-5 h-5 text-brand-primary" />
              后台极速扫库 & 并发性能 parameters 设定
            </h3>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold text-slate-500">
                  <span>最大并行异步同步扫描线程限制</span>
                  <span className="text-brand-primary">{maxThreads} 个并发流</span>
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
                  title="模拟生成一条增量同步日志"
                  onClick={forceMockSyncRun}
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
