/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from "react";
import { toast, Toaster } from "sonner";
import { PageName, SyncDirectory, SyncLog, type DetailContext } from "./types";
import { logsApi, archiveApi, workflowApi, authApi, subscriptionApi } from "./api";
import type { WorkflowItem } from "./api/types";
import { AUTH_REQUIRED_EVENT, getApiErrorMessage } from "./api/errors";
import { waitForBackendReady } from "./utils/health";
import { ACTIVE_ARCHIVE_TASK_STATUS } from "./utils/runtimeDefaults";
import { buildExploreSubscriptionPayload } from "./utils/exploreSubscription";
import DashboardTab from "./components/DashboardTab";
import SearchTab from "./components/SearchTab";
import ExploreTab from "./components/ExploreTab";
import AnimeTab from "./components/AnimeTab";
import SubscriptionTab from "./components/SubscriptionTab";
import UsageTab from "./components/UsageTab";
import AutomationsTab from "./components/AutomationsTab";
import SettingsTab from "./components/SettingsTab";
import StrmTab from "./components/StrmTab";
import SchedulerTab from "./components/SchedulerTab";
import LibraryPlusTab from "./components/LibraryPlusTab";
import Pan115FilesTab from "./components/Pan115FilesTab";
import MediaDetailTab from "./components/MediaDetailTab";
import {
  LayoutDashboard,
  Search,
  Trophy,
  Clapperboard,
  Rss,
  BarChart3,
  Workflow,
  Settings,
  Bell,
  CheckCircle2,
  AlertTriangle,
  Info,
  X,
  Menu,
  Activity,
  FileVideo,
  Clock,
  Bookmark,
  Sun,
  Moon,
  Layers,
  LogIn,
  LogOut,
  Lock,
  User,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useTheme } from "./utils/useTheme";

export default function App() {
  const [activePage, setActivePage] = useState<PageName>(PageName.DASHBOARD);

  // State: directories from archive API, workflows from workflow API, logs from logs API
  const [directories, setDirectories] = useState<SyncDirectory[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);

  // Backend ready state
  const [backendReady, setBackendReady] = useState(false);
  const [backendError, setBackendError] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [authUsername, setAuthUsername] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);

  // 主题切换（深色玻璃拟态默认，持久化到 localStorage）
  const { theme, toggle: toggleTheme } = useTheme();

  const loadInitialData = useCallback(async (isCancelled: () => boolean = () => false) => {
    // 1. Load archive config + active tasks. Avoid listing 115 folders during app
    // initialization because that requires a valid 115 session and is only needed
    // when the user enters a 115 browsing workflow.
    try {
      const [configRes, tasksRes] = await Promise.all([
        archiveApi.getConfig(),
        archiveApi.listTasks({ status: ACTIVE_ARCHIVE_TASK_STATUS, limit: 50 }).catch(() => ({ data: [] })),
      ]);
      const configData = configRes.data as Record<string, unknown>;
      const tasksData = (tasksRes as { data: unknown }).data;
      const tasksArr: Record<string, unknown>[] = Array.isArray(tasksData) ? tasksData as Record<string, unknown>[] : [];
      const hasActiveTask = tasksArr.length > 0;
      const watchCid = String(configData.archive_watch_cid || "").trim();
      const watchName = String(configData.archive_watch_name || "").trim();

      const dirs: SyncDirectory[] = [];
      if (watchCid) {
        dirs.push({
          id: watchCid,
          name: watchName || `115 目录 ${watchCid}`,
          localPath: watchCid,
          folderId115: watchCid,
          targetClient: "emby",
          status: hasActiveTask ? "syncing" : "idle",
          speed: "-",
          progress: 0,
          enabled: Boolean(configData.archive_enabled),
          totalSize: "-",
          itemCount: 0,
        });
      }
      if (!isCancelled()) setDirectories(dirs);
    } catch (err) {
      console.error("Failed to load directories from archive API:", err);
    }

    // 2. Load logs from logs API
    try {
      const logsRes = await logsApi.list({ limit: 50, offset: 0 });
      const logData = logsRes.data;
      if (logData && Array.isArray(logData.items)) {
        const mapped: SyncLog[] = logData.items.map((item) => ({
          id: String(item.id),
          timestamp: item.created_at || "",
          level: mapLogLevel(item.status),
          message: item.message || "",
        }));
        if (!isCancelled()) setLogs(mapped);
      }
    } catch (err) {
      console.error("Failed to load logs from backend:", err);
    }

    // 3. Load workflows from workflow API
    try {
      const wfRes = await workflowApi.list();
      if (!isCancelled() && Array.isArray(wfRes.data)) {
        setWorkflows(wfRes.data as WorkflowItem[]);
      }
    } catch (err) {
      console.error("Failed to load workflows from backend:", err);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setAuthChecking(true);
      try {
        await waitForBackendReady();
        if (cancelled) return;
        setBackendReady(true);
        setBackendError(false);
      } catch {
        if (!cancelled) {
          setBackendError(true);
          setAuthChecking(false);
        }
        console.error("Backend not ready after timeout");
        return;
      }

      try {
        const session = await authApi.getSession();
        if (cancelled) return;
        if (!session.data.authenticated) {
          setAuthenticated(false);
          setAuthUsername("");
          setAuthChecking(false);
          return;
        }
        setAuthenticated(true);
        setAuthUsername(session.data.username || "");
        await loadInitialData(() => cancelled);
      } catch (err) {
        if (!cancelled) {
          setAuthenticated(false);
          setAuthNotice(getApiErrorMessage(err, "无法确认登录状态，请重新登录"));
        }
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [loadInitialData]);

  useEffect(() => {
    const handleAuthRequired = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setAuthenticated(false);
      setAuthNotice(detail?.message || "登录会话已过期，请重新登录");
      setLoginPassword("");
      setActivePage(PageName.DASHBOARD);
    };

    window.addEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handleAuthRequired);
  }, []);

  // Workflow save: handled inside AutomationsTab via workflowApi (start/pause/run/delete/create/update).

  // Logging utility: local-only (backend has no client-write log endpoint per API mapping)
  const addLog = async (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    setLogs((prev) => [
      ...prev,
      {
        id: `log-${Date.now()}-${Math.random()}`,
        timestamp,
        level,
        message,
      },
    ]);
    // 同步弹出 transient toast，作为终端日志的轻量提示层。持久
    // 日志仍保留在 setLogs 终端，toast 不取代它。INFO 太嘈杂不上 toast；
    // SUCCESS/ERROR/WARN 给出瞬时反馈。
    if (level === "SUCCESS") toast.success(message);
    else if (level === "ERROR") toast.error(message);
    else if (level === "WARN") toast.warning(message);
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    try {
      const response = await authApi.login({
        username: loginUsername.trim(),
        password: loginPassword,
      });
      const session = await authApi.getSession();
      const username = session.data.username || response.data.username || loginUsername.trim();
      await loadInitialData();
      setAuthenticated(true);
      setAuthUsername(username);
      setAuthNotice("");
      setLoginPassword("");
    } catch (err) {
      setLoginError(getApiErrorMessage(err, "登录失败，请检查账号密码"));
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } finally {
      setAuthenticated(false);
      setAuthUsername("");
      setAuthNotice("已退出登录");
      setDirectories([]);
      setWorkflows([]);
      setLogs([]);
      setActivePage(PageName.DASHBOARD);
    }
  };

  // State for detail page navigation
  const [detailContext, setDetailContext] = useState<DetailContext | null>(null);

  // State for mobile drawer and shared search query
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchQueryShared, setSearchQueryShared] = useState("");

  // Notification dropdown state
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationsList = logs.slice(-5).reverse().map((log) => ({
    id: log.id,
    type: log.level === "SUCCESS" ? "success" : log.level === "WARN" || log.level === "ERROR" ? "warn" : "info",
    title: log.level === "ERROR" ? "操作失败" : log.level === "WARN" ? "操作警告" : "系统日志",
    desc: log.message || "暂无日志内容",
    time: log.timestamp || "刚刚",
  }));

  // Navigation groups
  const navigationGroups = [
    {
      title: "核心面板",
      items: [
        { name: PageName.DASHBOARD, label: "主控制台", icon: LayoutDashboard },
      ],
    },
    {
      title: "影视雷达",
      items: [
        { name: PageName.SEARCH, label: "资源检索", icon: Search },
        { name: PageName.EXPLORE, label: "榜单探索", icon: Trophy },
        { name: PageName.ANIME, label: "动漫追番", icon: Clapperboard },
        { name: PageName.SUBSCRIPTION, label: "RSS智能追更", icon: Rss },
        { name: PageName.LIBRARY, label: "片单 / 影人", icon: Bookmark },
      ],
    },
    {
      title: "维护诊断",
      items: [
        { name: PageName.USAGE, label: "传输统计", icon: BarChart3 },
        { name: PageName.AUTOMATIONS, label: "工作流", icon: Workflow },
        { name: PageName.SCHEDULER, label: "定时任务", icon: Clock },
        { name: PageName.STRM, label: "STRM 管理", icon: FileVideo },
        { name: PageName.PAN115, label: "115 网盘管理", icon: Layers },
        { name: PageName.SETTINGS, label: "配置与终端", icon: Settings },
      ],
    },
  ];

  const handlePageChange = (page: PageName) => {
    setActivePage(page);
    setMobileSidebarOpen(false);
  };

  const handleNavigateToDetail = (ctx: DetailContext) => {
    setDetailContext(ctx);
    setActivePage(PageName.DETAIL);
  };

  const currentActiveLabel = () => {
    for (const group of navigationGroups) {
      const match = group.items.find((i) => i.name === activePage);
      if (match) return match.label;
    }
    return "控制台";
  };

  if (authChecking || backendError || authenticated === false) {
    return (
      <LoginScreen
        backendReady={backendReady}
        backendError={backendError}
        checking={authChecking}
        notice={authNotice}
        username={loginUsername}
        password={loginPassword}
        error={loginError}
        busy={loginBusy}
        theme={theme}
        onToggleTheme={toggleTheme}
        onUsernameChange={setLoginUsername}
        onPasswordChange={setLoginPassword}
        onSubmit={handleLogin}
      />
    );
  }

  return (
    <div className="liquid-app-shell min-h-screen font-body flex flex-col md:flex-row relative overflow-x-hidden" style={{ color: "var(--txt)" }}>
      {/* Mobile Backdrop Overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-45 md:hidden"
          style={{ background: "rgba(11,8,30,.34)", backdropFilter: "blur(4px)" }}
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* 1. Left Sidebar */}
      <aside className={`glass-heavy fixed inset-y-0 left-0 z-50 w-64 lg:w-72 flex flex-col transform md:transform-none transition-transform duration-300 ease-in-out ${
        mobileSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      }`}>
        {/* Brand header */}
        <div className="px-6 py-6 border-b flex items-center justify-between" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <div className="glass-iridescent w-9 h-9 rounded-xl text-brand-primary flex items-center justify-center font-black shadow-xs">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-headline font-black text-base tracking-tight leading-none" style={{ color: "var(--txt)" }}>
                MediaSync115
              </h2>
              <span className="text-[10px] font-bold mt-1 inline-flex items-center gap-1" style={{ color: "var(--brand-primary)" }}>
                <span className={`w-1.5 h-1.5 rounded-full ${backendReady ? 'bg-teal-500' : backendError ? 'bg-red-500 animate-pulse' : 'bg-amber-500 animate-pulse'}`} />
                {backendReady ? "系统挂载就绪" : backendError ? "后端连接失败" : "正在连接后端..."}
              </span>
            </div>
          </div>

          <button
            onClick={() => setMobileSidebarOpen(false)}
            className="md:hidden p-1.5 rounded-lg glass-hover"
            style={{ color: "var(--txt-muted)" }}
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-4 py-6 space-y-7 no-scrollbar">
          {navigationGroups.map((group, groupIdx) => (
            <div key={groupIdx} className="space-y-2">
              <span className="px-3 text-[10px] font-bold uppercase tracking-wider block" style={{ color: "var(--txt-muted)" }}>
                {group.title}
              </span>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activePage === item.name;
                  return (
                    <button
                      key={item.name}
                      onClick={() => handlePageChange(item.name)}
                      className="w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-xs font-semibold transition-all relative glass-hover"
                      style={
                        isActive
                          ? { background: "var(--brand-primary-bg-alpha)", color: "var(--brand-primary)" }
                          : { color: "var(--txt-secondary)", background: "transparent" }
                      }
                    >
                      <Icon className={`w-4.5 h-4.5 ${isActive ? "text-brand-primary" : ""}`} style={isActive ? { color: "var(--brand-primary)" } : { color: "var(--txt-muted)" }} />
                      <span className={isActive ? "font-bold" : ""}>{item.label}</span>
                      {isActive && (
                        <motion.div
                          layoutId="sidebarActiveMarker"
                          className="absolute right-3 w-1.5 h-1.5 rounded-full"
                          style={{ background: "var(--brand-primary)" }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Sidebar Footer */}
        <div className="p-4 border-t flex items-center gap-3" style={{ borderColor: "var(--border)", background: "var(--surface-subtle)" }}>
          <div className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center" style={{ background: "var(--surface-hover)", border: "1px solid var(--border)", color: "var(--brand-primary)" }}>
            <User className="w-4.5 h-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold truncate" style={{ color: "var(--txt)" }}>{authUsername || "已登录用户"}</p>
            <p className="text-[9px] font-semibold truncate" style={{ color: "var(--txt-muted)" }}>本机会话认证</p>
          </div>
          <div className={`w-2 h-2 rounded-full ${backendReady ? 'bg-teal-500' : 'bg-slate-300'}`} title="在线联通状态" />
          <button
            type="button"
            title="退出登录"
            onClick={handleLogout}
            className="p-1.5 rounded-lg transition-all glass-hover"
            style={{ color: "var(--txt-muted)" }}
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* 3. Main Content */}
      <div className="flex-1 min-w-0 md:ml-64 lg:ml-72 flex flex-col min-h-screen">
        {/* Header */}
        <header className="glass sticky top-0 z-30 px-6 py-4.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="p-1.5 rounded-xl md:hidden transition-all glass-hover"
              style={{ border: "1px solid var(--border)", color: "var(--txt-secondary)" }}
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="font-headline font-black text-lg tracking-tight flex items-center gap-2" style={{ color: "var(--txt)" }}>
                <span>{currentActiveLabel()}</span>
              </h1>
              <p className="text-[9px] font-bold uppercase tracking-wider hidden sm:block" style={{ color: "var(--txt-muted)" }}>
                MediaSync115 . STRM . RSS
              </p>
            </div>
          </div>

          <div className="relative flex items-center gap-2">
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              title={theme === "dark" ? "切换到浅色" : "切换到深色"}
              className="w-9.5 h-9.5 flex items-center justify-center rounded-full transition-all glass-hover"
              style={{ border: "1px solid var(--border)", color: "var(--txt-secondary)", background: "var(--surface)" }}
            >
              {theme === "dark" ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
            </button>

            {/* Notifications */}
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className="w-9.5 h-9.5 flex items-center justify-center rounded-full transition-all relative glass-hover"
              style={{
                border: "1px solid var(--border)",
                background: showNotifications ? "var(--surface-hover)" : "var(--surface)",
              }}
            >
              <Bell className="w-4.5 h-4.5" style={{ color: "var(--txt-secondary)" }} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full animate-pulse" style={{ background: "var(--brand-primary)" }} />
            </button>

            <AnimatePresence>
              {showNotifications && (
                <>
                  <div onClick={() => setShowNotifications(false)} className="fixed inset-0 z-40" />
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute right-0 mt-2.5 w-80 rounded-2xl p-4 z-50 space-y-3 glass-heavy"
                  >
                    <div className="flex justify-between items-center pb-2" style={{ borderBottom: "1px solid var(--border)" }}>
                      <span className="text-xs font-black" style={{ color: "var(--txt)" }}>系统警报 ({notificationsList.length})</span>
                      <button onClick={() => setShowNotifications(false)} className="p-0.5 rounded glass-hover" style={{ color: "var(--txt-muted)" }}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-3 max-h-64 overflow-y-auto pr-1 no-scrollbar">
                      {notificationsList.map((n) => (
                        <div key={n.id} className="pt-3 flex gap-3 text-left">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "var(--surface-subtle)", color: n.type === "success" ? "var(--accent-ok)" : n.type === "warn" ? "var(--accent-warn)" : "var(--accent-info)" }}>
                            {n.type === "success" ? (
                              <CheckCircle2 className="w-4 h-4" />
                            ) : n.type === "warn" ? (
                              <AlertTriangle className="w-4 h-4" />
                            ) : (
                              <Info className="w-4 h-4" />
                            )}
                          </div>
                          <div className="space-y-0.5">
                            <p className="text-xs font-bold" style={{ color: "var(--txt)" }}>{n.title}</p>
                            <p className="text-[10px] font-medium leading-tight" style={{ color: "var(--txt-muted)" }}>{n.desc}</p>
                            <p className="text-[9px] font-bold" style={{ color: "var(--txt-muted)" }}>{n.time}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </header>

        {/* Dynamic Inner Router Views */}
        <main className="px-4 sm:px-6 lg:px-8 py-8 pb-36 md:pb-8 flex-1 w-full max-w-none">
          {/* Backend not ready banner */}
          {backendError && (
            <div className="mb-6 p-4 rounded-xl text-sm font-semibold" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--accent-danger)" }}>
              后端服务未就绪，请检查服务是否已启动。部分功能可能不可用。
            </div>
          )}

          <AnimatePresence mode="wait">
            {activePage === PageName.DASHBOARD && (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
              >
                <DashboardTab
                  directories={directories}
                  setDirectories={setDirectories}
                  onNavigateToSettings={() => setActivePage(PageName.SETTINGS)}
                  addLog={addLog}
                />
              </motion.div>
            )}

            {activePage === PageName.SEARCH && (
              <motion.div
                key="search"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
              >
                <SearchTab
                  addLog={addLog}
                  searchQuery={searchQueryShared}
                  setSearchQuery={setSearchQueryShared}
                  onNavigateToDetail={handleNavigateToDetail}
                />
              </motion.div>
            )}

            {activePage === PageName.EXPLORE && (
              <motion.div
                key="explore"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
              >
                <ExploreTab
                  onSearchQuery={(query) => {
                    setSearchQueryShared(query);
                    setActivePage(PageName.SEARCH);
                  }}
                  onNavigateToDetail={handleNavigateToDetail}
                  onAddSubscription={async (item, board) => {
                    const built = buildExploreSubscriptionPayload(item, board);
                    if (built.ok === false) {
                      await addLog("WARN", `榜单订阅失败：${built.message}`);
                      return { ok: false, message: built.message };
                    }

                    try {
                      await subscriptionApi.create(built.payload);
                      await addLog("SUCCESS", `已订阅 [${built.payload.title}]，可在 RSS智能追更 查看。`);
                      setActivePage(PageName.SUBSCRIPTION);
                      return { ok: true, message: "已添加到 RSS智能追更" };
                    } catch (err) {
                      const message = getApiErrorMessage(err, "创建订阅失败");
                      if (message.includes("already exists") || message.includes("已存在")) {
                        await addLog("WARN", `[${built.payload.title}] 已在 RSS智能追更 中。`);
                        setActivePage(PageName.SUBSCRIPTION);
                        return { ok: true, message: "已在 RSS智能追更 中" };
                      }

                      console.error("Failed to quick subscribe:", err);
                      await addLog("ERROR", `榜单订阅 [${built.payload.title}] 失败：${message}`);
                      return { ok: false, message };
                    }
                  }}
                />
              </motion.div>
            )}

            {activePage === PageName.ANIME && (
              <motion.div
                key="anime"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
              >
                <AnimeTab addLog={addLog} />
              </motion.div>
            )}

            {activePage === PageName.SUBSCRIPTION && (
              <motion.div
                key="subscription"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
              >
                <SubscriptionTab
                  directories={directories}
                  addLog={addLog}
                />
              </motion.div>
            )}

            {activePage === PageName.LIBRARY && (
              <motion.div
                key="library"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
              >
                <LibraryPlusTab addLog={addLog} />
              </motion.div>
            )}

            {activePage === PageName.USAGE && (
              <motion.div
                key="usage"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
              >
                <UsageTab directories={directories} />
              </motion.div>
            )}

            {activePage === PageName.AUTOMATIONS && (
              <motion.div
                key="automations"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
              >
                <AutomationsTab
                  workflows={workflows}
                  setWorkflows={setWorkflows}
                  addLog={addLog}
                />
              </motion.div>
            )}

            {activePage === PageName.SCHEDULER && (
              <motion.div
                key="scheduler"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
              >
                <SchedulerTab addLog={addLog} />
              </motion.div>
            )}

            {activePage === PageName.STRM && (
              <motion.div
                key="strm"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
              >
                <StrmTab addLog={addLog} />
              </motion.div>
            )}

            {activePage === PageName.PAN115 && (
              <motion.div
                key="pan115"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
              >
                <Pan115FilesTab addLog={addLog} />
              </motion.div>
            )}

            {activePage === PageName.DETAIL && detailContext && (
              <motion.div
                key={`detail-${detailContext.tmdbId}`}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
              >
                <MediaDetailTab
                  tmdbId={detailContext.tmdbId}
                  mediaType={detailContext.mediaType}
                  defaultTitle={detailContext.title}
                  defaultPoster={detailContext.poster}
                  onBack={() => {
                    setActivePage(detailContext.returnTo);
                    setDetailContext(null);
                  }}
                  addLog={addLog}
                />
              </motion.div>
            )}

            {activePage === PageName.SETTINGS && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.2 }}
              >
                <SettingsTab
                  logs={logs}
                  setLogs={setLogs}
                  addLog={addLog}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* 4. Mobile Bottom Navigation */}
      <div className="fixed bottom-0 left-0 right-0 z-40 md:hidden glass px-2 py-2 grid grid-cols-5 gap-1 shadow-[0_-8px_32px_rgba(17,12,46,0.06)] pb-safe-bottom">
        {[
          { name: PageName.DASHBOARD, label: "主面板", icon: LayoutDashboard },
          { name: PageName.SEARCH, label: "资源检索", icon: Search },
          { name: PageName.EXPLORE, label: "热门榜单", icon: Trophy },
          { name: PageName.ANIME, label: "追番", icon: Clapperboard },
          { name: PageName.SUBSCRIPTION, label: "智能追更", icon: Rss },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.name;
          return (
            <button
              key={item.name}
              onClick={() => handlePageChange(item.name)}
              className="min-w-0 flex flex-col items-center gap-1 py-1 px-1 rounded-xl transition-all relative text-[var(--txt-secondary)] active:scale-95"
            >
              <div className={`p-1.5 rounded-lg transition-all ${
                isActive
                  ? "bg-brand-primary/10 text-brand-primary"
                  : "text-[var(--txt-muted)] hover:text-[var(--txt)]"
              }`}>
                <Icon className="w-4.5 h-4.5" />
              </div>
              <span className={`text-[8px] font-black tracking-normal whitespace-nowrap transition-all ${
                isActive ? "text-brand-primary font-black" : "text-[var(--txt-muted)] font-bold"
              }`}>
                {item.label}
              </span>
              {isActive && (
                <motion.div
                  layoutId="bottomTabMarker"
                  className="absolute -top-1 left-1/2 -translate-x-1/2 w-6 h-[2px] bg-brand-primary rounded-full"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
            </button>
          );
        })}
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className={`min-w-0 flex flex-col items-center gap-1 py-1 px-1 rounded-xl transition-all active:scale-95 ${
            [PageName.USAGE, PageName.AUTOMATIONS, PageName.SCHEDULER, PageName.STRM, PageName.PAN115, PageName.SETTINGS].includes(activePage)
              ? "text-brand-primary"
              : "text-[var(--txt-secondary)]"
          }`}
        >
          <div className={`p-1.5 rounded-lg transition-all ${
            [PageName.USAGE, PageName.AUTOMATIONS, PageName.SCHEDULER, PageName.STRM, PageName.PAN115, PageName.SETTINGS].includes(activePage)
              ? "bg-brand-primary/10 text-brand-primary"
              : "text-[var(--txt-muted)]"
          }`}>
            <Menu className="w-4.5 h-4.5" />
          </div>
          <span className={`text-[8px] font-black tracking-normal whitespace-nowrap ${
            [PageName.USAGE, PageName.AUTOMATIONS, PageName.SCHEDULER, PageName.STRM, PageName.PAN115, PageName.SETTINGS].includes(activePage)
              ? "text-brand-primary font-black"
              : "text-[var(--txt-muted)] font-bold"
          }`}>
            更多系统
          </span>
        </button>
      </div>
      <Toaster position="top-right" richColors closeButton toastOptions={{ duration: 4000 }} />
    </div>
  );
}

interface LoginScreenProps {
  backendReady: boolean;
  backendError: boolean;
  checking: boolean;
  notice: string;
  username: string;
  password: string;
  error: string;
  busy: boolean;
  theme: string;
  onToggleTheme: () => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
}

function LoginScreen({
  backendReady,
  backendError,
  checking,
  notice,
  username,
  password,
  error,
  busy,
  theme,
  onToggleTheme,
  onUsernameChange,
  onPasswordChange,
  onSubmit,
}: LoginScreenProps) {
  return (
    <div className="liquid-app-shell min-h-screen flex items-center justify-center px-6 py-10 relative overflow-hidden" style={{ color: "var(--txt)" }}>
      <button
        type="button"
        onClick={onToggleTheme}
        title={theme === "dark" ? "切换到浅色" : "切换到深色"}
        className="absolute right-6 top-6 w-9.5 h-9.5 flex items-center justify-center rounded-full transition-all glass-hover"
        style={{ border: "1px solid var(--border)", color: "var(--txt-secondary)", background: "var(--surface)" }}
      >
        {theme === "dark" ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
      </button>

      <div className="glass-heavy glass-iridescent w-full max-w-sm rounded-3xl p-6 relative z-10">
        <div className="space-y-2 mb-6">
          <div className="glass-iridescent w-11 h-11 rounded-xl text-brand-primary flex items-center justify-center">
            <Activity className="w-5.5 h-5.5" />
          </div>
          <h1 className="font-headline text-2xl font-black tracking-tight" style={{ color: "var(--txt)" }}>MediaSync115</h1>
          <div className="text-[10px] font-bold inline-flex items-center gap-1.5" style={{ color: backendError ? "var(--accent-danger)" : backendReady ? "var(--accent-ok)" : "var(--txt-muted)" }}>
            <span className={`w-1.5 h-1.5 rounded-full ${backendError ? "bg-red-500" : backendReady ? "bg-teal-500" : "bg-amber-500 animate-pulse"}`} />
            {backendError ? "后端连接失败" : backendReady ? "后端已就绪" : "正在连接后端"}
          </div>
        </div>

        {checking ? (
          <div className="py-10 flex flex-col items-center gap-3" style={{ color: "var(--txt-muted)" }}>
            <Loader2 className="w-7 h-7 animate-spin text-brand-primary" />
            <span className="text-xs font-semibold">正在检查登录状态</span>
          </div>
        ) : backendError ? (
          <div className="rounded-xl p-4 text-xs font-semibold flex gap-2" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--accent-danger)" }}>
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>后端服务未就绪，请检查 API 服务后刷新页面。</span>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            {notice && (
              <div className="rounded-xl px-3 py-2 text-[11px] font-semibold" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>
                {notice}
              </div>
            )}
            {error && (
              <div className="rounded-xl px-3 py-2 text-[11px] font-semibold" style={{ background: "rgba(239,68,68,0.12)", color: "var(--accent-danger)", border: "1px solid rgba(239,68,68,0.3)" }}>
                {error}
              </div>
            )}

            <label className="block space-y-1.5">
              <span className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>账号</span>
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                <User className="w-4 h-4" style={{ color: "var(--txt-muted)" }} />
                <input
                  value={username}
                  onChange={(event) => onUsernameChange(event.target.value)}
                  autoComplete="username"
                  className="w-full bg-transparent text-sm font-semibold focus:outline-none"
                  style={{ color: "var(--txt)" }}
                />
              </div>
            </label>

            <label className="block space-y-1.5">
              <span className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>密码</span>
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                <Lock className="w-4 h-4" style={{ color: "var(--txt-muted)" }} />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  autoComplete="current-password"
                  className="w-full bg-transparent text-sm font-semibold focus:outline-none"
                  style={{ color: "var(--txt)" }}
                />
              </div>
            </label>

            <button
              type="submit"
              disabled={busy || !username.trim() || !password}
              className="btn-brand w-full py-3 rounded-2xl text-sm font-black text-white disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              <span>{busy ? "登录中" : "登录"}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/** Map backend log status to frontend log level */
function mapLogLevel(status: string): SyncLog["level"] {
  switch (status) {
    case "success":
      return "SUCCESS";
    case "warning":
      return "WARN";
    case "failed":
      return "ERROR";
    case "info":
    default:
      return "INFO";
  }
}
