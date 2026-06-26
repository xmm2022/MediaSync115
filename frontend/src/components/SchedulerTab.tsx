/**
 * 定时任务管理 — 对接后端 /api/scheduler (jobs/tasks/run/enable/pause/delete)
 *
 * schedulerApi 此前 9 个封装只用了 listTasks。本面板补齐列表/启停/手动运行/创建/编辑/删除，
 * 并展示后端注册的 job_keys 与 jobs 清单（runJob 按 job_key 触发内置任务）。
 */
import React, { useEffect, useState } from "react";
import { schedulerApi } from "../api";
import type { SchedulerTask } from "../api/types";
import { Clock, Play, Pause, Trash2, Plus, RefreshCw, Calendar, Save, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function SchedulerTab({ addLog }: { addLog: (l: "INFO" | "SUCCESS" | "WARN" | "ERROR", m: string) => Promise<void> }) {
  const [tasks, setTasks] = useState<SchedulerTask[]>([]);
  const [jobKeys, setJobKeys] = useState<string[]>([]);
  const [jobs, setJobs] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<SchedulerTask | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, jk, jj] = await Promise.all([
        schedulerApi.listTasks(),
        schedulerApi.listJobKeys().catch(() => ({ data: [] as string[] })),
        schedulerApi.listJobs().catch(() => ({ data: null })),
      ]);
      setTasks((t.data as SchedulerTask[]) ?? []);
      setJobKeys((jk.data as string[]) ?? []);
      setJobs(jj.data ?? null);
    } catch (err: any) {
      setError(err?.message || "加载定时任务失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const runBusy = async (key: string, label: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      await addLog("SUCCESS", `${label} 执行完成`);
      await load();
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || String(err);
      await addLog("ERROR", `${label} 失败: ${detail}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-3 flex items-center gap-2.5">
          <span className="text-xs font-bold text-red-700">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 text-xs font-bold">关闭</button>
        </div>
      )}

      <div className="bg-gradient-to-br from-cyan-500/10 via-brand-primary/5 to-white/30 backdrop-blur-md rounded-3xl p-6 border border-white/60 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-txt-dark tracking-tight flex items-center gap-2.5">
            <Clock className="w-6.5 h-6.5 text-cyan-500" />
            <span>定时任务管理</span>
          </h2>
          <p className="text-xs text-gray-500 mt-1 max-w-xl leading-relaxed">
            管理后台 APScheduler 定时任务：启用/暂停、手动运行、创建自定义定时器与删除。任务在本机时区下按 cron 或间隔运行。
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="bg-white/80 border border-white/60 text-slate-500 px-4 py-2.5 rounded-2xl text-xs font-black flex items-center gap-1.5 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> 刷新
          </button>
          <button
            onClick={() => { setEditingTask(null); setShowForm(true); }}
            className="bg-brand-primary text-white px-4 py-2.5 rounded-2xl text-xs font-black flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> 新建任务
          </button>
        </div>
      </div>

      {/* Job Keys / Jobs 概览 */}
      <div className="bg-white/60 backdrop-blur-md rounded-3xl border border-white/60 p-5 shadow-sm">
        <h3 className="text-sm font-black text-txt-dark flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-brand-primary" />
          <span>内置 Job Keys ({jobKeys.length})</span>
        </h3>
        {jobKeys.length === 0 ? (
          <p className="text-xs text-slate-400 font-semibold">无内置 job 注册</p>
        ) : (
          <div className="space-y-2">
            {jobKeys.map((k) => (
              <div key={k} className="flex items-center justify-between bg-white/70 border border-slate-200/50 rounded-lg px-3 py-2">
                <span className="text-xs font-bold text-txt-dark truncate">{k}</span>
                <button
                  disabled={busy === `run-${k}`}
                  onClick={() => runBusy(`run-${k}`, `手动运行 ${k}`, () => schedulerApi.runJob(k))}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
                >
                  <Play className="w-3 h-3" /> {busy === `run-${k}` ? "运行中" : "手动运行"}
                </button>
              </div>
            ))}
          </div>
        )}
        {jobs != null && (
          <pre className="mt-3 text-[10px] text-slate-600 bg-slate-50 rounded-xl p-3 overflow-auto max-h-48 font-mono">{JSON.stringify(jobs, null, 2)}</pre>
        )}
      </div>

      {/* 任务列表 */}
      <div className="bg-white/60 backdrop-blur-md rounded-3xl border border-white/60 p-5 shadow-sm">
        <h3 className="text-sm font-black text-txt-dark mb-3">自定义定时任务 ({tasks.length})</h3>
        {loading ? (
          <p className="text-xs text-slate-400 font-semibold">加载中…</p>
        ) : tasks.length === 0 ? (
          <p className="text-xs text-slate-400 font-semibold">暂无自定义定时任务</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((t) => (
              <div key={t.id} className="bg-white/70 border border-slate-200/50 rounded-xl px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-txt-dark truncate">{t.name}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${t.enabled ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                        {t.enabled ? "启用" : "暂停"}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-bold mt-0.5 truncate">
                      {t.job_key} · {t.trigger_type || "—"} {t.cron_expr ? `· ${t.cron_expr}` : t.interval_seconds ? `· 每 ${t.interval_seconds}s` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      disabled={busy === `toggle-${t.id}`}
                      onClick={() =>
                        runBusy(`toggle-${t.id}`, t.enabled ? "暂停" : "启用", () =>
                          t.enabled ? schedulerApi.pauseTask(t.id) : schedulerApi.enableTask(t.id),
                        )
                      }
                      className={`p-1.5 rounded-lg border ${t.enabled ? "bg-amber-50 text-amber-600 border-amber-200/50" : "bg-emerald-50 text-emerald-600 border-emerald-200/50"}`}
                      title={t.enabled ? "暂停" : "启用"}
                    >
                      {t.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      disabled={busy === `run-${t.id}`}
                      onClick={() => runBusy(`run-${t.id}`, `手动运行 ${t.name}`, () => schedulerApi.runJob(t.job_key))}
                      className="p-1.5 rounded-lg bg-brand-primary/10 text-brand-primary border border-brand-primary/30"
                      title="手动运行"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${busy === `run-${t.id}` ? "animate-spin" : ""}`} />
                    </button>
                    <button
                      onClick={() => { setEditingTask(t); setShowForm(true); }}
                      className="p-1.5 rounded-lg bg-slate-50 text-slate-500 border border-slate-200/50"
                      title="编辑"
                    >
                      <Save className="w-3.5 h-3.5" />
                    </button>
                    <button
                      disabled={busy === `del-${t.id}`}
                      onClick={() => {
                        if (!confirm(`删除任务 [${t.name}]？`)) return;
                        runBusy(`del-${t.id}`, `删除 ${t.name}`, () => schedulerApi.deleteTask(t.id));
                      }}
                      className="p-1.5 rounded-lg bg-red-50 text-red-500 border border-red-200/50"
                      title="删除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 新建/编辑表单 */}
      <AnimatePresence>
        {showForm && (
          <SchedulerForm
            initial={editingTask}
            jobKeys={jobKeys}
            onClose={() => setShowForm(false)}
            onSubmit={async (payload) => {
              try {
                if (editingTask) {
                  await schedulerApi.updateTask(editingTask.id, payload);
                  await addLog("SUCCESS", `已更新任务 ${payload.name}`);
                } else {
                  await schedulerApi.createTask(payload);
                  await addLog("SUCCESS", `已创建任务 ${payload.name}`);
                }
                setShowForm(false);
                await load();
              } catch (err: any) {
                await addLog("ERROR", `保存任务失败: ${err?.response?.data?.detail || err?.message}`);
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function SchedulerForm({
  initial,
  jobKeys,
  onClose,
  onSubmit,
}: {
  initial: SchedulerTask | null;
  jobKeys: string[];
  onClose: () => void;
  onSubmit: (p: Partial<SchedulerTask>) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [jobKey, setJobKey] = useState(initial?.job_key ?? (jobKeys[0] ?? ""));
  const [triggerType, setTriggerType] = useState(initial?.trigger_type ?? "interval");
  const [cronExpr, setCronExpr] = useState(initial?.cron_expr ?? "");
  const [intervalSeconds, setIntervalSeconds] = useState<number | undefined>(initial?.interval_seconds);
  const [cronKwargs, setCronKwargs] = useState("");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl border border-slate-200 p-6 w-full max-w-lg space-y-4 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-txt-dark">{initial ? "编辑定时任务" : "新建定时任务"}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">任务名 *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">Job Key</label>
            <select value={jobKey} onChange={(e) => setJobKey(e.target.value)} className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white">
              {jobKeys.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">触发类型</label>
            <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-white">
              <option value="interval">间隔(interval)</option>
              <option value="cron">Cron 表达式</option>
            </select>
          </div>
          {triggerType === "interval" ? (
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">间隔秒数</label>
              <input type="number" value={intervalSeconds ?? ""} onChange={(e) => setIntervalSeconds(e.target.value ? Number(e.target.value) : undefined)} className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2" />
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-500">Cron 表达式 (6 字段, 含秒)</label>
              <input value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} placeholder="0 */15 * * * *" className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 font-mono" />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500">额外 kwargs (JSON, 可选)</label>
            <textarea rows={2} value={cronKwargs} onChange={(e) => setCronKwargs(e.target.value)} placeholder='{"key":"value"}' className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 font-mono" />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-100 text-slate-500">取消</button>
          <button
            onClick={() => {
              const payload: Partial<SchedulerTask> & { kwargs?: Record<string, unknown> } = {
                name: name.trim(),
                job_key: jobKey,
                trigger_type: triggerType,
              };
              if (triggerType === "interval") payload.interval_seconds = intervalSeconds;
              if (triggerType === "cron") payload.cron_expr = cronExpr.trim() || undefined;
              if (cronKwargs.trim()) {
                try { payload.kwargs = JSON.parse(cronKwargs); } catch { /* ignore */ }
              }
              onSubmit(payload);
            }}
            className="px-4 py-2 rounded-lg text-xs font-black bg-brand-primary text-white flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" /> 保存
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}