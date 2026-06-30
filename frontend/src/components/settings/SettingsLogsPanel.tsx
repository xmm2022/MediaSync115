import { useMemo, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { AlertTriangle, Database, Terminal, Trash2 } from "lucide-react";
import type { SyncLog } from "../../types";
import { logsApi } from "../../api/logs";
import { getApiErrorMessage } from "../../api/errors";

type LogLevelFilter = "ALL" | SyncLog["level"];

interface SettingsLogsPanelProps {
  logs: SyncLog[];
  setLogs: Dispatch<SetStateAction<SyncLog[]>>;
  addLog: (level: SyncLog["level"], message: string) => void;
  terminalEndRef: RefObject<HTMLDivElement | null>;
}

function extractModules(data: unknown): string[] {
  const rawItems = Array.isArray(data)
    ? data
    : Array.isArray((data as { modules?: unknown[] } | null)?.modules)
      ? (data as { modules: unknown[] }).modules
      : [];
  return rawItems
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        return String(record.name || record.module || record.key || "").trim();
      }
      return "";
    })
    .filter(Boolean);
}

function logMatchesModule(log: SyncLog, moduleName: string): boolean {
  if (!moduleName) return true;
  const record = log as SyncLog & { module?: string };
  return String(record.module || "").includes(moduleName) || log.message.includes(moduleName);
}

export default function SettingsLogsPanel({
  logs,
  setLogs,
  addLog,
  terminalEndRef,
}: SettingsLogsPanelProps) {
  const [levelFilter, setLevelFilter] = useState<LogLevelFilter>("ALL");
  const [moduleFilter, setModuleFilter] = useState("");
  const [logModules, setLogModules] = useState<string[]>([]);

  const visibleLogs = useMemo(
    () => logs.filter((log) => (
      (levelFilter === "ALL" || log.level === levelFilter)
      && logMatchesModule(log, moduleFilter)
    )),
    [logs, levelFilter, moduleFilter],
  );

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

  const loadLogModules = async () => {
    try {
      const response = await logsApi.modules();
      const modules = extractModules(response.data);
      setLogModules(modules);
      setLogs(prev => [...prev, { id: `m-${Date.now()}`, timestamp: new Date().toLocaleTimeString(), level: "INFO", message: `日志模块: ${JSON.stringify(response.data)}` }]);
    } catch (e: unknown) {
      addLog("ERROR", getApiErrorMessage(e));
    }
  };

  const pruneOldLogs = async () => {
    try {
      await logsApi.prune(30);
      addLog("SUCCESS", "已清理30天前旧日志");
    } catch (e: unknown) {
      addLog("ERROR", getApiErrorMessage(e));
    }
  };

  return (
    <div className="terminal-premium p-6 shadow-md flex flex-col justify-between h-[640px] border">
      <div className="space-y-4 h-full flex flex-col justify-between">
        <div className="flex flex-col gap-3 pb-3 border-b shrink-0" style={{ borderColor: "var(--border-strong)" }}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-brand-primary" />
              <span className="text-xs font-black tracking-wider" style={{ color: "var(--txt)" }}>操作日志</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                title="清空操作日志"
                onClick={clearTerminalLogs}
                className="p-1.5 hover:bg-[var(--surface-hover)] rounded text-[var(--accent-danger)] transition-colors cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="读取日志模块列表"
                onClick={loadLogModules}
                className="p-1.5 hover:bg-[var(--surface-hover)] rounded text-[var(--accent-info)] transition-colors cursor-pointer"
              >
                <Database className="w-4 h-4" />
              </button>
              <button
                type="button"
                title="清理30天旧日志"
                onClick={pruneOldLogs}
                className="p-1.5 hover:bg-[var(--surface-hover)] rounded text-[var(--accent-warn)] transition-colors cursor-pointer"
              >
                <AlertTriangle className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="space-y-1 block">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>日志级别</span>
              <select
                value={levelFilter}
                onChange={(event) => setLevelFilter(event.target.value as LogLevelFilter)}
                className="w-full text-xs px-3 py-2 input-premium"
              >
                <option value="ALL">全部级别</option>
                <option value="INFO">INFO</option>
                <option value="SUCCESS">SUCCESS</option>
                <option value="WARN">WARN</option>
                <option value="ERROR">ERROR</option>
              </select>
            </label>
            <label className="space-y-1 block">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>日志模块</span>
              <select
                value={moduleFilter}
                onChange={(event) => setModuleFilter(event.target.value)}
                className="w-full text-xs px-3 py-2 input-premium"
              >
                <option value="">全部模块</option>
                {logModules.map((moduleName) => (
                  <option key={moduleName} value={moduleName}>{moduleName}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto max-h-[420px] pr-2 space-y-2.5 text-[10.5px] leading-relaxed select-text no-scrollbar scroll-smooth">
          {visibleLogs.length === 0 ? (
            <div className="text-gray-500 italic text-center h-full flex items-center justify-center">
              暂无匹配的操作日志。
            </div>
          ) : (
            visibleLogs.map((log) => {
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

        <div className="pt-3 border-t flex items-center justify-between text-[10px] text-gray-500 shrink-0" style={{ borderColor: "var(--border-strong)" }}>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block animate-pulse" />
            后端 API 日志已连接
          </span>
          <span>{visibleLogs.length}/{logs.length} 条</span>
        </div>
      </div>
    </div>
  );
}
