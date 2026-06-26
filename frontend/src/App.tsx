/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { PageName, SyncDirectory, SyncLog, type DetailContext } from "./types";
import { logsApi, archiveApi, workflowApi } from "./api";
import type { WorkflowItem } from "./api/types";
import { waitForBackendReady } from "./utils/health";
import { ACTIVE_ARCHIVE_TASK_STATUS } from "./utils/runtimeDefaults";
import DashboardTab from "./components/DashboardTab";
import SearchTab from "./components/SearchTab";
import ExploreTab from "./components/ExploreTab";
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

  // 主题切换（深色玻璃拟态默认，持久化到 localStorage）
  const { theme, toggle: toggleTheme } = useTheme();

  // Wait for backend and load initial data
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      // 1. Wait for backend health
      try {
        await waitForBackendReady();
        if (!cancelled) setBackendReady(true);
      } catch {
        if (!cancelled) setBackendError(true);
        console.error("Backend not ready after timeout");
        return;
      }

      // 2. Load directories from archive API (folders + config + tasks)
      try {
        const [foldersRes, configRes, tasksRes] = await Promise.all([
          archiveApi.listFolders("0"),
          archiveApi.getConfig(),
          archiveApi.listTasks({ status: ACTIVE_ARCHIVE_TASK_STATUS, limit: 50 }).catch(() => ({ data: [] })),
        ]);
        const folderData = foldersRes.data;
        const configData = configRes.data;
        const tasksData = (tasksRes as { data: unknown }).data;
        const tasksArr: Record<string, unknown>[] = Array.isArray(tasksData) ? tasksData as Record<string, unknown>[] : [];
        const hasActiveTask = tasksArr.length > 0;

        // Build SyncDirectory list from archive config + folders
        // Fields without backend data: speed→"-", totalSize→"-", itemCount→0
        // status derived from ArchiveTask (processing→syncing), targetClient from config
        const dirs: SyncDirectory[] = [];
        if (Array.isArray(folderData)) {
          for (const f of folderData.slice(0, 20)) {
            dirs.push({
              id: f.cid || String((f as Record<string, string>).id || "") || `dir-${dirs.length}`,
              name: f.name || f.cid || "未知目录",
              localPath: String((configData as Record<string, string>).archive_watch_cid || ""),
              folderId115: f.cid || "",
              targetClient: "emby",
              status: hasActiveTask ? "syncing" : "idle",
              speed: "-",
              progress: 0,
              enabled: Boolean((configData as Record<string, unknown>).archive_enabled),
              totalSize: "-",
              itemCount: 0,
            });
          }
        }
        if (!cancelled) setDirectories(dirs);
      } catch (err) {
        console.error("Failed to load directories from archive API:", err);
      }

      // 3. Load logs from logs API
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
          if (!cancelled) setLogs(mapped);
        }
      } catch (err) {
        console.error("Failed to load logs from backend:", err);
      }

      // 4. Load workflows from workflow API
      try {
        const wfRes = await workflowApi.list();
        if (!cancelled && Array.isArray(wfRes.data)) {
          setWorkflows(wfRes.data as WorkflowItem[]);
        }
      } catch (err) {
        console.error("Failed to load workflows from backend:", err);
      }
    };

    init();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  };

  // State for detail page navigation
  const [detailContext, setDetailContext] = useState<DetailContext | null>(null);

  // State for mobile drawer and shared search query
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [searchQueryShared, setSearchQueryShared] = useState("");

  // Notification dropdown state
  const [showNotifications, setShowNotifications] = useState(false);
  const notificationsList = [
    { id: "n-1", type: "success", title: "Emby 视频刷新成功", desc: "经典电影库单文件比对并刷新完毕", time: "5 分钟前" },
    { id: "n-2", type: "warn", title: "网盘API速率节制避让", desc: "在 Movies 同步期间触发了 1.5s 安全限速避让", time: "18 分钟前" },
    { id: "n-3", type: "info", title: "夜间提速参数调配完成", desc: "自动规则已成功在后台初始化", time: "1小时前" },
  ];

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
        { name: PageName.SEARCH, label: "磁力秒传检索", icon: Search },
        { name: PageName.EXPLORE, label: "榜单探索", icon: Trophy },
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

  return (
    <div className="min-h-screen font-body flex flex-col md:flex-row relative overflow-x-hidden" style={{ background: "var(--bg)", color: "var(--txt)" }}>
      {/* Dynamic ambient glassmorphism blur background lights */}
      <div className="absolute top-[-10%] left-[-10%] w-[45vw] h-[45vw] min-w-[300px] min-h-[300px] rounded-full blur-[100px] pointer-events-none z-0" style={{ background: "radial-gradient(circle at 30% 30%, var(--ambient-1), transparent 70%)" }} />
      <div className="absolute bottom-[15%] right-[-10%] w-[40vw] h-[40vw] min-w-[280px] min-h-[280px] rounded-full blur-[100px] pointer-events-none z-0" style={{ background: "radial-gradient(circle at 70% 70%, var(--ambient-2), transparent 70%)" }} />
      <div className="absolute top-[35%] left-[50%] w-[30vw] h-[30vw] min-w-[200px] min-h-[200px] rounded-full blur-[80px] pointer-events-none z-0" style={{ background: "radial-gradient(circle, var(--ambient-3), transparent 70%)" }} />

      {/* Mobile Backdrop Overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 z-45 md:hidden"
          style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
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
            <div className="w-9 h-9 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center font-black shadow-xs">
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
            className="md:hidden p-1.5 hover:bg-gray-50 rounded-lg text-gray-400"
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
                          ? { background: "rgba(var(--brand-primary-rgb,139,92,246), 0.16)" as string, color: "var(--brand-primary)" as string }
                          : { color: "var(--txt-secondary)" as string, background: "transparent" }
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
          <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 flex items-center justify-center" style={{ background: "var(--surface-hover)", border: "1px solid var(--border)" }}>
            <img
              alt="User Portrait"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuBOI4rQlgUONwEE0nNCcLvZ-SCpzZxcZYw-NLGQU8qVNywWy84mHJql_Qwk7nn4f9Rn6xmK7ROa8ezQPvEKJ6ggSlhDkfSKHxpl4y7amsn6IbqoLTflXauOLBGeQot0jO8_ua2PuNouSCZg7as2em6Sk95S-li_ypDxRqXtWDfPi_6jIwbJ3BlMaXl6_-_IJ9UT1eh8xVcWFqLZpHpoFKxLe-FI7yvsits_2DnQLsejkWlNZ5CEyFpChg6XzH67ykt9AZBalRdJNnQC"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold truncate" style={{ color: "var(--txt)" }}>高级云端站长</p>
            <p className="text-[9px] font-semibold truncate" style={{ color: "var(--txt-muted)" }}>nhxdev@gmail.com</p>
          </div>
          <div className={`w-2 h-2 rounded-full ${backendReady ? 'bg-teal-500' : 'bg-slate-300'}`} title="在线联通状态" />
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
        <main className="px-6 py-8 pb-28 md:pb-8 flex-1 w-full max-w-6xl mx-auto">
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
                  onAddSubscription={async (title, category, poster) => {
                    // TODO (stage 3): wire up to subscriptionApi.create
                    try {
                      const { subscriptionApi } = await import("./api");
                      const listRes = await subscriptionApi.list({ is_active: true, media_type: category.toLowerCase() });
                      const data = listRes.data as unknown as { title: string; [key: string]: unknown }[] | { items: { title: string; [key: string]: unknown }[] };
                      const list = Array.isArray(data) ? data : (data.items || []);
                      const exists = list.some((s) => s.title.toLowerCase().includes(title.toLowerCase()));
                      if (exists) {
                        await addLog("WARN", `推荐追更：您已经订阅过 [${title}] 相关的规则。`);
                      } else {
                        await subscriptionApi.create({
                          title,
                          media_type: category === "Movie" ? "movie" : category === "Anime" ? "tv" : "tv",
                          poster_path: poster,
                        });
                        await addLog("SUCCESS", `一键订阅成功！已将 [${title}] 添加到 RSS 监听列表中。`);
                      }
                      setActivePage(PageName.SUBSCRIPTION);
                    } catch (err) {
                      console.error("Failed to quick subscribe:", err);
                    }
                  }}
                />
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
      <div className="fixed bottom-0 left-0 right-0 z-40 md:hidden glass px-3 py-2 flex items-center justify-around shadow-[0_-8px_32px_rgba(0,0,0,0.04)] pb-safe-bottom">
        {[
          { name: PageName.DASHBOARD, label: "主面板", icon: LayoutDashboard },
          { name: PageName.SEARCH, label: "秒传搜索", icon: Search },
          { name: PageName.EXPLORE, label: "热门榜单", icon: Trophy },
          { name: PageName.SUBSCRIPTION, label: "智能追更", icon: Rss },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = activePage === item.name;
          return (
            <button
              key={item.name}
              onClick={() => handlePageChange(item.name)}
              className="flex flex-col items-center gap-1.5 py-1 px-3.5 rounded-xl transition-all relative text-[var(--txt-secondary)] active:scale-95"
            >
              <div className={`p-1.5 rounded-lg transition-all ${
                isActive
                  ? "bg-brand-primary/10 text-brand-primary"
                  : "text-[var(--txt-muted)] hover:text-[var(--txt)]"
              }`}>
                <Icon className="w-5 h-5" />
              </div>
              <span className={`text-[9px] font-black tracking-wider transition-all ${
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
          className={`flex flex-col items-center gap-1.5 py-1 px-3.5 rounded-xl transition-all active:scale-95 ${
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
            <Menu className="w-5 h-5" />
          </div>
          <span className={`text-[9px] font-black tracking-wider ${
            [PageName.USAGE, PageName.AUTOMATIONS, PageName.SCHEDULER, PageName.STRM, PageName.PAN115, PageName.SETTINGS].includes(activePage)
              ? "text-brand-primary font-black"
              : "text-[var(--txt-muted)] font-bold"
          }`}>
            更多系统
          </span>
        </button>
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
