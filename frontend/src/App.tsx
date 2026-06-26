/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import { PageName, SyncDirectory, SyncLog } from "./types";
import { logsApi, archiveApi, workflowApi } from "./api";
import type { WorkflowItem } from "./api/types";
import { waitForBackendReady } from "./utils/health";
import DashboardTab from "./components/DashboardTab";
import SearchTab from "./components/SearchTab";
import ExploreTab from "./components/ExploreTab";
import SubscriptionTab from "./components/SubscriptionTab";
import UsageTab from "./components/UsageTab";
import AutomationsTab from "./components/AutomationsTab";
import SettingsTab from "./components/SettingsTab";
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
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function App() {
  const [activePage, setActivePage] = useState<PageName>(PageName.DASHBOARD);

  // State: directories from archive API, workflows from workflow API, logs from logs API
  const [directories, setDirectories] = useState<SyncDirectory[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);

  // Backend ready state
  const [backendReady, setBackendReady] = useState(false);
  const [backendError, setBackendError] = useState(false);

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
          archiveApi.listTasks({ status: "archiving", limit: 50 }).catch(() => ({ data: [] })),
        ]);
        const folderData = foldersRes.data;
        const configData = configRes.data;
        const tasksData = (tasksRes as { data: unknown }).data;
        const tasksArr: Record<string, unknown>[] = Array.isArray(tasksData) ? tasksData as Record<string, unknown>[] : [];
        const hasActiveTask = tasksArr.length > 0;

        // Build SyncDirectory list from archive config + folders
        // Fields without backend data: speed→"-", totalSize→"-", itemCount→0
        // status derived from ArchiveTask (archiving→syncing), targetClient from config
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
      ],
    },
    {
      title: "维护诊断",
      items: [
        { name: PageName.USAGE, label: "传输统计", icon: BarChart3 },
        { name: PageName.AUTOMATIONS, label: "工作流", icon: Workflow },
        { name: PageName.SETTINGS, label: "配置与终端", icon: Settings },
      ],
    },
  ];

  const handlePageChange = (page: PageName) => {
    setActivePage(page);
    setMobileSidebarOpen(false);
  };

  const currentActiveLabel = () => {
    for (const group of navigationGroups) {
      const match = group.items.find((i) => i.name === activePage);
      if (match) return match.label;
    }
    return "控制台";
  };

  return (
    <div className="bg-brand-background text-txt-dark min-h-screen font-body flex flex-col md:flex-row relative overflow-x-hidden">
      {/* Dynamic ambient glassmorphism blur background lights */}
      <div className="absolute top-[-10%] left-[-10%] w-[45vw] h-[45vw] min-w-[300px] min-h-[300px] rounded-full bg-gradient-to-tr from-violet-400/10 to-indigo-500/10 blur-[100px] pointer-events-none z-0" />
      <div className="absolute bottom-[15%] right-[-10%] w-[40vw] h-[40vw] min-w-[280px] min-h-[280px] rounded-full bg-gradient-to-br from-indigo-400/10 to-purple-500/5 blur-[100px] pointer-events-none z-0" />
      <div className="absolute top-[35%] left-[50%] w-[30vw] h-[30vw] min-w-[200px] min-h-[200px] rounded-full bg-gradient-to-r from-fuchsia-400/5 to-violet-500/10 blur-[80px] pointer-events-none z-0" />

      {/* Mobile Backdrop Overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-slate-950/20 backdrop-blur-xs z-45 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* 1. Left Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 lg:w-72 bg-white/75 backdrop-blur-xl border-r border-slate-200/40 flex flex-col transform md:transform-none transition-transform duration-300 ease-in-out ${
        mobileSidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      }`}>
        {/* Brand header */}
        <div className="px-6 py-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center font-black shadow-xs">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-headline font-black text-base tracking-tight text-txt-dark leading-none">
                MediaSync115
              </h2>
              <span className="text-[10px] text-brand-primary font-bold mt-1 inline-flex items-center gap-1">
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
              <span className="px-3 text-[10px] font-bold uppercase text-slate-400 tracking-wider block">
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
                      className={`w-full flex items-center gap-3.5 px-3.5 py-3 rounded-xl text-xs font-semibold transition-all relative ${
                        isActive
                          ? "bg-brand-primary/10 text-brand-primary shadow-xs"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                      }`}
                    >
                      <Icon className={`w-4.5 h-4.5 ${isActive ? "text-brand-primary" : "text-slate-400"}`} />
                      <span className={isActive ? "font-bold" : ""}>{item.label}</span>
                      {isActive && (
                        <motion.div
                          layoutId="sidebarActiveMarker"
                          className="absolute right-3 w-1.5 h-1.5 rounded-full bg-brand-primary"
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
        <div className="p-4 border-t border-slate-100 bg-slate-50/50 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full border border-slate-100 overflow-hidden shrink-0 shadow-xs flex items-center justify-center bg-slate-100">
            <img
              alt="User Portrait"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuBOI4rQlgUONwEE0nNCcLvZ-SCpzZxcZYw-NLGQU8qVNywWy84mHJql_Qwk7nn4f9Rn6xmK7ROa8ezQPvEKJ6ggSlhDkfSKHxpl4y7amsn6IbqoLTflXauOLBGeQot0jO8_ua2PuNouSCZg7as2em6Sk95S-li_ypDxRqXtWDfPi_6jIwbJ3BlMaXl6_-_IJ9UT1eh8xVcWFqLZpHpoFKxLe-FI7yvsits_2DnQLsejkWlNZ5CEyFpChg6XzH67ykt9AZBalRdJNnQC"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-txt-dark truncate">高级云端站长</p>
            <p className="text-[9px] text-slate-400 font-semibold truncate">nhxdev@gmail.com</p>
          </div>
          <div className={`w-2 h-2 rounded-full ${backendReady ? 'bg-teal-500' : 'bg-slate-300'}`} title="在线联通状态" />
        </div>
      </aside>

      {/* 3. Main Content */}
      <div className="flex-1 min-w-0 md:ml-64 lg:ml-72 flex flex-col min-h-screen">
        {/* Header */}
        <header className="sticky top-0 z-30 bg-brand-background/70 backdrop-blur-md border-b border-slate-200/40 px-6 py-4.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="p-1.5 hover:bg-slate-50 rounded-xl border border-slate-100 text-slate-500 md:hidden transition-all"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="font-headline font-black text-lg tracking-tight text-txt-dark flex items-center gap-2">
                <span>{currentActiveLabel()}</span>
              </h1>
              <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider hidden sm:block">
                MediaSync115 . STRM . RSS
              </p>
            </div>
          </div>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setShowNotifications(!showNotifications)}
              className={`w-9.5 h-9.5 flex items-center justify-center rounded-full hover:bg-slate-50 transition-all relative border border-slate-100 shadow-xs ${
                showNotifications ? "bg-slate-100" : "bg-white"
              }`}
            >
              <Bell className="w-4.5 h-4.5 text-slate-500" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand-primary animate-pulse" />
            </button>

            <AnimatePresence>
              {showNotifications && (
                <>
                  <div onClick={() => setShowNotifications(false)} className="fixed inset-0 z-40" />
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute right-0 mt-2.5 w-80 bg-white rounded-2xl border border-slate-100 p-4 shadow-xl z-50 space-y-3"
                  >
                    <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                      <span className="text-xs font-black text-txt-dark">系统警报 ({notificationsList.length})</span>
                      <button onClick={() => setShowNotifications(false)} className="p-0.5 hover:bg-slate-50 rounded text-slate-400">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="space-y-3 divide-y divide-slate-100 max-h-64 overflow-y-auto pr-1 no-scrollbar">
                      {notificationsList.map((n) => (
                        <div key={n.id} className="pt-3 flex gap-3 text-left">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            n.type === "success"
                              ? "bg-teal-50 text-brand-primary"
                              : n.type === "warn"
                              ? "bg-amber-50 text-amber-600"
                              : "bg-indigo-50 text-brand-secondary"
                          }`}>
                            {n.type === "success" ? (
                              <CheckCircle2 className="w-4 h-4" />
                            ) : n.type === "warn" ? (
                              <AlertTriangle className="w-4 h-4" />
                            ) : (
                              <Info className="w-4 h-4" />
                            )}
                          </div>
                          <div className="space-y-0.5">
                            <p className="text-xs font-bold text-txt-dark">{n.title}</p>
                            <p className="text-[10px] text-slate-400 font-medium leading-tight">{n.desc}</p>
                            <p className="text-[9px] text-slate-300 font-bold">{n.time}</p>
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
        <main className="px-6 py-8 pb-28 md:pb-8 flex-1 w-full max-w-5xl mx-auto">
          {/* Backend not ready banner */}
          {backendError && (
            <div className="mb-6 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold">
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
      <div className="fixed bottom-0 left-0 right-0 z-40 md:hidden bg-white/75 backdrop-blur-xl border-t border-slate-200/40 px-3 py-2 flex items-center justify-around shadow-[0_-8px_32px_rgba(0,0,0,0.04)] pb-safe-bottom">
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
              className="flex flex-col items-center gap-1.5 py-1 px-3.5 rounded-xl transition-all relative text-slate-500 active:scale-95"
            >
              <div className={`p-1.5 rounded-lg transition-all ${
                isActive
                  ? "bg-brand-primary/10 text-brand-primary"
                  : "text-slate-400 hover:text-slate-600"
              }`}>
                <Icon className="w-5 h-5" />
              </div>
              <span className={`text-[9px] font-black tracking-wider transition-all ${
                isActive ? "text-brand-primary font-black" : "text-slate-400 font-bold"
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
            [PageName.USAGE, PageName.AUTOMATIONS, PageName.SETTINGS].includes(activePage)
              ? "text-brand-primary"
              : "text-slate-500"
          }`}
        >
          <div className={`p-1.5 rounded-lg transition-all ${
            [PageName.USAGE, PageName.AUTOMATIONS, PageName.SETTINGS].includes(activePage)
              ? "bg-brand-primary/10 text-brand-primary"
              : "text-slate-400"
          }`}>
            <Menu className="w-5 h-5" />
          </div>
          <span className={`text-[9px] font-black tracking-wider ${
            [PageName.USAGE, PageName.AUTOMATIONS, PageName.SETTINGS].includes(activePage)
              ? "text-brand-primary font-black"
              : "text-slate-400 font-bold"
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
