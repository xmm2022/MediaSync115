/**
 * 定时任务管理 — 对接后端 /api/scheduler (jobs/tasks/run/enable/pause/delete)
 *
 * schedulerApi 此前 9 个封装只用了 listTasks。本面板补齐列表/启停/手动运行/创建/编辑/删除，
 * 并展示后端注册的 job_keys 与 jobs 清单（runJob 按 job_key 触发内置任务）。
 */
import React, { useEffect, useState, type CSSProperties } from "react";
import { schedulerApi } from "../api";
import type { SchedulerJob, SchedulerTask } from "../api/types";
import { Clock, Play, Pause, Trash2, Plus, RefreshCw, Calendar, Save, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

const sBtnSubtle: CSSProperties = { background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" };
const sOkSoft: CSSProperties = { background: "rgba(34,197,94,0.14)", color: "var(--accent-ok)", border: "1px solid rgba(34,197,94,0.3)" };
const sWarnSoft: CSSProperties = { background: "rgba(245,158,11,0.14)", color: "var(--accent-warn)", border: "1px solid rgba(245,158,11,0.3)" };
const sDangerSoft: CSSProperties = { background: "rgba(239,68,68,0.14)", color: "var(--accent-danger)", border: "1px solid rgba(239,68,68,0.3)" };
const sOkBadge: CSSProperties = { background: "rgba(34,197,94,0.16)", color: "var(--accent-ok)" };
const sWarnBadge: CSSProperties = { background: "rgba(245,158,11,0.16)", color: "var(--accent-warn)" };
const sInput: CSSProperties = { background: "var(--bg-elev)", color: "var(--txt)", border: "1px solid var(--border)" };
const sModal: CSSProperties = { background: "var(--bg-elev)", border: "1px solid var(--border-strong)" };

function formatSchedulerJobTime(value?: string | null) {
  if (!value) return "未排期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getSchedulerJobKindLabel(kind?: string | null) {
  if (kind === "dynamic") return "自定义任务";
  if (kind === "workflow") return "工作流";
  if (kind === "builtin") return "内置任务";
  return kind || "内置任务";
}

export default function SchedulerTab({ addLog }: { addLog: (l: "INFO" | "SUCCESS" | "WARN" | "ERROR", m: string) => Promise<void> }) {
  const [tasks, setTasks] = useState<SchedulerTask[]>([]);
  const [jobKeys, setJobKeys] = useState<string[]>([]);
  const [jobs, setJobs] = useState<SchedulerJob[]>([]);
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
        schedulerApi.listJobs().catch(() => ({ data: [] as SchedulerJob[] })),
      ]);
      setTasks((t.data as SchedulerTask[]) ?? []);
      setJobKeys((jk.data as string[]) ?? []);
      setJobs(Array.isArray(jj.data) ? jj.data : []);
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
        <div className="rounded-2xl px-5 py-3 flex items-center gap-2.5" style={{ background:"rgba(239,68,68,0.14)", border:"1px solid rgba(239,68,68,0.3)" }}>
          <span className="text-xs font-bold" style={{ color:"var(--accent-danger)" }}>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-xs font-bold" style={{ color:"var(--accent-danger)" }}>关闭</button>
        </div>
      )}

      <div className="glass-heavy rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight flex items-center gap-2.5" style={{ color:"var(--txt)" }}>
            <Clock className="w-6.5 h-6.5" style={{ color:"var(--accent-info)" }} />
            <span>定时任务管理</span>
          </h2>
          <p className="text-xs mt-1 max-w-xl leading-relaxed" style={{ color:"var(--txt-secondary)" }}>
            管理后台 APScheduler 定时任务：启用/暂停、手动运行、创建自定义定时器与删除。任务在本机时区下按 cron 或间隔运行。
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} disabled={loading} className="glass-hover px-4 py-2.5 rounded-2xl text-xs font-black flex items-center gap-1.5 disabled:opacity-50" style={sBtnSubtle}>
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
      <div className="glass rounded-3xl p-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,0.9fr)]">
          <section className="min-w-0">
            <h3 className="text-sm font-black flex items-center gap-2 mb-3" style={{ color:"var(--txt)" }}>
              <Calendar className="w-4 h-4" style={{ color:"var(--brand-primary)" }} />
              <span>内置 Job Keys ({jobKeys.length})</span>
            </h3>
            {jobKeys.length === 0 ? (
              <p className="text-xs font-semibold" style={{ color:"var(--txt-muted)" }}>无内置 job 注册</p>
            ) : (
              <div className="space-y-2">
                {jobKeys.map((k) => (
                  <div key={k} className="glass grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-2 rounded-lg px-3 py-2">
                    <span className="text-xs font-bold truncate" style={{ color:"var(--txt)" }}>{k}</span>
                    <button
                      disabled={busy === `run-${k}`}
                      onClick={() => runBusy(`run-${k}`, `手动运行 ${k}`, () => schedulerApi.runJob(k))}
                      className="h-7 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 inline-flex items-center justify-center gap-1"
                    >
                      <Play className="w-3 h-3" /> {busy === `run-${k}` ? "运行中" : "运行"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="min-w-0">
            <h3 className="text-sm font-black flex items-center gap-2 mb-3" style={{ color:"var(--txt)" }}>
              <Clock className="w-4 h-4" style={{ color:"var(--accent-info)" }} />
              <span>内置调度状态 ({jobs.length})</span>
            </h3>
            {jobs.length === 0 ? (
              <p className="text-xs font-semibold" style={{ color:"var(--txt-muted)" }}>暂无运行中的调度任务</p>
            ) : (
              <div className="space-y-2">
                {jobs.map((job) => (
                  <div key={job.id} className="glass rounded-lg px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-black truncate" style={{ color:"var(--txt)" }}>
                          {job.name || job.id}
                        </div>
                        <div className="text-[10px] font-bold mt-0.5 truncate" style={{ color:"var(--txt-muted)" }}>
                          {job.id}
                        </div>
                      </div>
                      <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded" style={job.running ? sOkBadge : sWarnBadge}>
                        {job.running ? "运行中" : "等待"}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[10px] font-bold" style={{ color:"var(--txt-muted)" }}>
                      <div className="truncate">类型: {getSchedulerJobKindLabel(job.kind)}</div>
                      <div className="truncate">下次: {formatSchedulerJobTime(job.next_run_time)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* 任务列表 */}
      <div className="glass rounded-3xl p-5">
        <h3 className="text-sm font-black mb-3" style={{ color:"var(--txt)" }}>自定义定时任务 ({tasks.length})</h3>
        {loading ? (
          <p className="text-xs font-semibold" style={{ color:"var(--txt-muted)" }}>加载中…</p>
        ) : tasks.length === 0 ? (
          <p className="text-xs font-semibold" style={{ color:"var(--txt-muted)" }}>暂无自定义定时任务</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((t) => (
              <div key={t.id} className="glass rounded-xl px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black truncate" style={{ color:"var(--txt)" }}>{t.name}</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={t.enabled ? sOkBadge : sWarnBadge}>
                        {t.enabled ? "启用" : "暂停"}
                      </span>
                    </div>
                    <div className="text-[10px] font-bold mt-0.5 truncate" style={{ color:"var(--txt-muted)" }}>
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
                      className="p-1.5 rounded-lg"
                      style={t.enabled ? sWarnSoft : sOkSoft}
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
                      className="p-1.5 rounded-lg"
                      style={sBtnSubtle} title="编辑"
                    >
                      <Save className="w-3.5 h-3.5" />
                    </button>
                    <button
                      disabled={busy === `del-${t.id}`}
                      onClick={() => {
                        if (!confirm(`删除任务 [${t.name}]？`)) return;
                        runBusy(`del-${t.id}`, `删除 ${t.name}`, () => schedulerApi.deleteTask(t.id));
                      }}
                      className="p-1.5 rounded-lg"
                      style={sDangerSoft} title="删除"
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
        className="rounded-2xl p-6 w-full max-w-lg space-y-4" style={sModal}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black" style={{ color:"var(--txt)" }}>{initial ? "编辑定时任务" : "新建定时任务"}</h3>
          <button onClick={onClose} style={{ color:"var(--txt-muted)" }}><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-bold" style={{ color:"var(--txt-muted)" }}>任务名 *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={sInput} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold" style={{ color:"var(--txt-muted)" }}>Job Key</label>
            <select value={jobKey} onChange={(e) => setJobKey(e.target.value)} className="w-full text-xs rounded-lg px-3 py-2" style={sInput}>
              {jobKeys.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold" style={{ color:"var(--txt-muted)" }}>触发类型</label>
            <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} className="w-full text-xs rounded-lg px-3 py-2" style={sInput}>
              <option value="interval">间隔(interval)</option>
              <option value="cron">Cron 表达式</option>
            </select>
          </div>
          {triggerType === "interval" ? (
            <div className="space-y-1">
              <label className="text-xs font-bold" style={{ color:"var(--txt-muted)" }}>间隔秒数</label>
              <input type="number" value={intervalSeconds ?? ""} onChange={(e) => setIntervalSeconds(e.target.value ? Number(e.target.value) : undefined)} className="w-full text-xs rounded-lg px-3 py-2" style={sInput} />
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-xs font-bold" style={{ color:"var(--txt-muted)" }}>Cron 表达式 (6 字段, 含秒)</label>
              <input value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} placeholder="0 */15 * * * *" className="w-full text-xs rounded-lg px-3 py-2 font-mono" style={sInput} />
            </div>
          )}
          <div className="space-y-1">
            <label className="text-xs font-bold" style={{ color:"var(--txt-muted)" }}>额外 kwargs (JSON, 可选)</label>
            <textarea rows={2} value={cronKwargs} onChange={(e) => setCronKwargs(e.target.value)} placeholder='{"key":"value"}' className="w-full text-xs rounded-lg px-3 py-2 font-mono" style={sInput} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold" style={sBtnSubtle}>取消</button>
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
