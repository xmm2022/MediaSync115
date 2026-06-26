/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from "react";
import type { WorkflowItem } from "../api/types";
import { workflowApi } from "../api";
import {
  Play,
  Trash2,
  Plus,
  Workflow,
  ToggleLeft,
  ToggleRight,
  X,
  Timer,
  Bell,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface AutomationsTabProps {
  workflows: WorkflowItem[];
  setWorkflows: React.Dispatch<React.SetStateAction<WorkflowItem[]>>;
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => void;
}

interface EventTypeOption {
  value: string;
  title: string;
}

/** Map backend state code to human-readable label and style */
function stateStyle(state: string): { label: string; bg: string; color: string; border: string } {
  switch (state) {
    case "W":
      return { label: "运行中", bg: "rgba(34,197,94,0.14)", color: "var(--accent-ok)", border: "rgba(34,197,94,0.3)" };
    case "P":
      return { label: "已暂停", bg: "var(--surface-subtle)", color: "var(--txt-muted)", border: "var(--border)" };
    default:
      return { label: state, bg: "rgba(245,158,11,0.14)", color: "var(--accent-warn)", border: "rgba(245,158,11,0.3)" };
  }
}

function triggerTypeLabel(tt: string): string {
  return tt === "event" ? "事件驱动" : "定时器";
}

function formatTime(iso: string | null): string {
  if (!iso) return "从未";
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "无效时间";
  }
}

export default function AutomationsTab({ workflows, setWorkflows, addLog }: AutomationsTabProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter
  const [filterState, setFilterState] = useState<"all" | "W" | "P">("all");

  // Create / Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowItem | null>(null);
  const [saving, setSaving] = useState(false);

  // Form fields
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formTriggerType, setFormTriggerType] = useState<"timer" | "event">("timer");
  const [formEventType, setFormEventType] = useState("");
  const [formTimer, setFormTimer] = useState("");
  const [formState, setFormState] = useState("P");

  // Event types for dropdown
  const [eventTypes, setEventTypes] = useState<EventTypeOption[]>([]);

  // Per-item action loading
  const [actionLoading, setActionLoading] = useState<Record<number, string>>({});

  // Load event types on mount
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await workflowApi.listEventTypes();
        if (!cancelled) {
          const data = (res.data as { items?: EventTypeOption[] }) || {};
          setEventTypes(Array.isArray(data.items) ? data.items : []);
        }
      } catch {
        // event types are non-critical; leave dropdown empty
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Reload workflows from backend
  const reloadWorkflows = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await workflowApi.list();
      if (Array.isArray(res.data)) {
        setWorkflows(res.data as WorkflowItem[]);
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || "加载失败");
    } finally {
      setLoading(false);
    }
  };

  // Toggle start / pause
  const handleToggle = async (wf: WorkflowItem) => {
    const id = wf.id;
    const isActive = wf.state === "W";
    setActionLoading((prev) => ({ ...prev, [id]: "toggle" }));
    try {
      if (isActive) {
        await workflowApi.pause(String(id));
        setWorkflows((prev) => prev.map((w) => (w.id === id ? { ...w, state: "P" } : w)));
        addLog("WARN", `工作流【${wf.name}】已暂停`);
      } else {
        await workflowApi.start(String(id));
        setWorkflows((prev) => prev.map((w) => (w.id === id ? { ...w, state: "W" } : w)));
        addLog("SUCCESS", `工作流【${wf.name}】已启动`);
      }
    } catch (e: unknown) {
      addLog("ERROR", `操作失败: ${(e as Error)?.message || "未知错误"}`);
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }
  };

  // Manual run
  const handleRun = async (wf: WorkflowItem) => {
    const id = wf.id;
    setActionLoading((prev) => ({ ...prev, [id]: "run" }));
    try {
      await workflowApi.run(String(id));
      addLog("SUCCESS", `工作流【${wf.name}】手动执行成功`);
      // Refresh to get updated run_count / last_run_at
      const res = await workflowApi.get(String(id));
      setWorkflows((prev) => prev.map((w) => (w.id === id ? (res.data as WorkflowItem) : w)));
    } catch (e: unknown) {
      addLog("ERROR", `执行失败: ${(e as Error)?.message || "未知错误"}`);
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }
  };

  // Delete
  const handleDelete = async (wf: WorkflowItem) => {
    if (!window.confirm(`确定删除工作流【${wf.name}】？此操作不可撤销。`)) return;
    const id = wf.id;
    setActionLoading((prev) => ({ ...prev, [id]: "delete" }));
    try {
      await workflowApi.delete(String(id));
      setWorkflows((prev) => prev.filter((w) => w.id !== id));
      addLog("WARN", `工作流【${wf.name}】已删除`);
    } catch (e: unknown) {
      addLog("ERROR", `删除失败: ${(e as Error)?.message || "未知错误"}`);
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }
  };

  // Open create modal
  const openCreate = () => {
    setEditingWorkflow(null);
    setFormName("");
    setFormDesc("");
    setFormTriggerType("timer");
    setFormEventType("");
    setFormTimer("");
    setFormState("P");
    setShowModal(true);
  };

  // Open edit modal
  const openEdit = (wf: WorkflowItem) => {
    setEditingWorkflow(wf);
    setFormName(wf.name);
    setFormDesc(wf.description || "");
    setFormTriggerType((wf.trigger_type === "event" ? "event" : "timer") as "timer" | "event");
    setFormEventType(wf.event_type || "");
    setFormTimer(wf.timer || "");
    setFormState(wf.state);
    setShowModal(true);
  };

  // Submit create or update
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: formName.trim(),
        description: formDesc.trim() || null,
        trigger_type: formTriggerType,
        state: formState,
      };
      if (formTriggerType === "timer") {
        payload.timer = formTimer.trim() || null;
      } else {
        payload.event_type = formEventType || null;
      }

      if (editingWorkflow) {
        // Update
        const res = await workflowApi.update(String(editingWorkflow.id), payload as Partial<WorkflowItem>);
        setWorkflows((prev) => prev.map((w) => (w.id === editingWorkflow.id ? (res.data as WorkflowItem) : w)));
        addLog("SUCCESS", `工作流【${formName.trim()}】已更新`);
      } else {
        // Create
        const res = await workflowApi.create(payload as Partial<WorkflowItem>);
        setWorkflows((prev) => [...prev, res.data as WorkflowItem]);
        addLog("SUCCESS", `工作流【${formName.trim()}】已创建`);
      }
      setShowModal(false);
    } catch (e: unknown) {
      addLog("ERROR", `${editingWorkflow ? "更新" : "创建"}失败: ${(e as Error)?.message || "未知错误"}`);
    } finally {
      setSaving(false);
    }
  };

  // Filtered list
  const filtered = workflows.filter((w) => {
    if (filterState === "W") return w.state === "W";
    if (filterState === "P") return w.state === "P";
    return true;
  });

  // Stats
  const runningCount = workflows.filter((w) => w.state === "W").length;
  const pausedCount = workflows.filter((w) => w.state === "P").length;
  const totalRuns = workflows.reduce((sum, w) => sum + (w.run_count || 0), 0);

  return (
    <div className="space-y-12">
      {/* Header */}
      <section className="mb-4">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="max-w-xl space-y-4">
            <span className="inline-block px-3 py-1 rounded-full bg-brand-primary-light/15 text-brand-primary font-label text-xs font-bold">
              WORKFLOW ENGINE
            </span>
            <h2 className="font-headline text-5xl md:text-6xl font-black tracking-tight leading-none text-txt-dark mb-4">
              工作流与触发器
            </h2>
            <p className="text-[var(--txt-secondary)] text-lg leading-relaxed font-light">
              已配置 <span className="font-bold text-brand-primary italic">{workflows.length} 个工作流</span>，
              管理定时任务与事件驱动的自动化操作。
            </p>
          </div>

          <div className="flex gap-2">
            {/* Filter */}
            <div className="bg-[var(--surface-solid)] p-1 rounded-lg border flex gap-1 text-xs" style={{ borderColor: "var(--border)" }}>
              <button
                onClick={() => setFilterState("all")}
                className={`px-4 py-2 rounded-md font-bold transition-all ${filterState === "all" ? "bg-brand-primary text-white" : "text-[var(--txt-secondary)] hover:bg-[var(--surface-hover)]"}`}
              >
                全部
              </button>
              <button
                onClick={() => setFilterState("W")}
                className={`px-4 py-2 rounded-md font-bold transition-all ${filterState === "W" ? "bg-brand-primary text-white" : "text-[var(--txt-secondary)] hover:bg-[var(--surface-hover)]"}`}
              >
                运行中 ({runningCount})
              </button>
              <button
                onClick={() => setFilterState("P")}
                className={`px-4 py-2 rounded-md font-bold transition-all ${filterState === "P" ? "bg-brand-primary text-white" : "text-[var(--txt-secondary)] hover:bg-[var(--surface-hover)]"}`}
              >
                已暂停 ({pausedCount})
              </button>
            </div>

            <button
              onClick={openCreate}
              className="px-6 py-3 bg-brand-primary text-white rounded-lg font-bold flex items-center gap-2 transition-all hover:bg-opacity-90 active:scale-95 shadow-md shadow-brand-primary/10"
            >
              <Plus className="w-4.5 h-4.5" />
              <span>创建工作流</span>
            </button>
          </div>
        </div>
      </section>

      {/* Loading / Error / Empty states */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-brand-primary" />
          <span className="ml-3 text-[var(--txt-secondary)] font-semibold">加载中...</span>
        </div>
      )}
      {error && !loading && (
        <div className="flex flex-col items-center gap-3 py-20">
          <p className="text-red-500 font-semibold">{error}</p>
          <button onClick={reloadWorkflows} className="px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-bold">
            重试
          </button>
        </div>
      )}
      {!loading && !error && workflows.length === 0 && (
        <div className="flex flex-col items-center gap-4 py-20 text-[var(--txt-muted)]">
          <Workflow className="w-12 h-12" />
          <p className="font-semibold">暂无工作流</p>
          <p className="text-sm">点击"创建工作流"配置第一个自动化任务</p>
        </div>
      )}

      {/* Cards Grid */}
      {!loading && !error && workflows.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pb-12">
          {filtered.map((wf, idx) => {
            const isWideCard = idx % 3 === 0;
            const colSpanClass = isWideCard ? "md:col-span-8" : "md:col-span-4";
            const si = stateStyle(wf.state);
            const isActive = wf.state === "W";
            const isLoading = !!actionLoading[wf.id];

            return (
              <div
                key={wf.id}
                className={`${colSpanClass} glass glass-hover rounded-xl p-8 flex flex-col justify-between min-h-[280px] relative overflow-hidden group transition-all ${
                  isActive ? "border-[var(--border)]" : "opacity-80"
                }`}
              >
                {/* Background glow */}
                {isActive && (
                  <div className="absolute top-0 right-0 w-48 h-48 bg-brand-primary/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none group-hover:scale-125 transition-transform duration-700" />
                )}

                <div className="relative z-10">
                  {/* Top row: icon + state badge + toggle */}
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center border"
                        style={isActive
                          ? { background: "rgba(139,92,246,0.12)", color: "var(--brand-primary)", borderColor: "rgba(139,92,246,0.25)" }
                          : { background: "var(--surface-subtle)", color: "var(--txt-muted)", borderColor: "var(--border)" }
                        }>
                        {wf.trigger_type === "event" ? (
                          <Bell className="w-5 h-5" />
                        ) : (
                          <Timer className="w-5 h-5" />
                        )}
                      </div>
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full border"
                        style={{ background: si.bg, color: si.color, borderColor: si.border }}>
                        {si.label}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      {/* Manual run */}
                      <button
                        onClick={() => handleRun(wf)}
                        disabled={isLoading}
                        title="手动执行一次"
                        className="p-1.5 rounded-lg hover:bg-[var(--surface-hover)] text-[var(--txt-muted)] hover:text-brand-primary transition-colors disabled:opacity-50"
                      >
                        {isLoading && actionLoading[wf.id] === "run" ? (
                          <Loader2 className="w-4.5 h-4.5 animate-spin" />
                        ) : (
                          <Play className="w-4.5 h-4.5" />
                        )}
                      </button>

                      {/* Toggle */}
                      <button
                        onClick={() => handleToggle(wf)}
                        disabled={isLoading}
                        className="focus:outline-none transition-transform active:scale-95 disabled:opacity-50"
                        title={isActive ? "暂停" : "启动"}
                      >
                        {isActive ? (
                          <ToggleRight className="w-12 h-12 text-brand-primary" />
                        ) : (
                          <ToggleLeft className="w-12 h-12 text-[var(--txt-muted)]" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Name + description */}
                  <h3
                    className="font-headline text-xl font-bold tracking-tight text-txt-dark leading-tight cursor-pointer hover:text-brand-primary transition-colors"
                    onClick={() => openEdit(wf)}
                    title="点击编辑"
                  >
                    {wf.name}
                  </h3>
                  {wf.description && (
                    <p className="text-[var(--txt-secondary)] text-sm mt-2 leading-relaxed max-w-md">
                      {wf.description}
                    </p>
                  )}

                  {/* Meta badges */}
                  <div className="flex flex-wrap gap-2 mt-3">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--txt-muted)] bg-[var(--surface-subtle)] px-2 py-0.5 rounded-full">
                      {wf.trigger_type === "event" ? <Bell className="w-3 h-3" /> : <Timer className="w-3 h-3" />}
                      {triggerTypeLabel(wf.trigger_type)}
                    </span>
                    {wf.event_type && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-full">
                        {wf.event_type}
                      </span>
                    )}
                    {wf.timer && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                        {wf.timer}
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom info row */}
                <div className="relative z-10 mt-6 pt-5 border-t flex items-center justify-between text-xs font-semibold" style={{ borderTopColor: "var(--border)", color: "var(--txt-muted)" }}>
                  <div className="flex items-center gap-3">
                    <span title="执行次数">
                      <RefreshCw className="w-3.5 h-3.5 inline mr-1" />
                      {wf.run_count || 0} 次
                    </span>
                    <span title="最后运行" className="hidden sm:inline">
                      {formatTime(wf.last_run_at)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--txt-muted)] hidden sm:inline">
                      创建 {formatTime(wf.created_at)}
                    </span>
                    <button
                      onClick={() => handleDelete(wf)}
                      disabled={isLoading}
                      title="删除"
                      className="p-1 rounded hover:bg-[rgba(239,68,68,0.08)] text-[var(--txt-muted)] hover:text-[var(--accent-danger)] transition-colors disabled:opacity-50"
                    >
                      {isLoading && actionLoading[wf.id] === "delete" ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Stats section */}
      {!loading && !error && workflows.length > 0 && (
        <section className="glass rounded-2xl p-6 md:p-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[var(--txt-muted)] uppercase tracking-widest">工作流总数</span>
              <p className="font-headline text-3xl font-extrabold text-txt-dark">{workflows.length}</p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[var(--txt-muted)] uppercase tracking-widest">运行中</span>
              <p className="font-headline text-3xl font-extrabold text-emerald-600">{runningCount}</p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[var(--txt-muted)] uppercase tracking-widest">累计执行次数</span>
              <p className="font-headline text-3xl font-extrabold text-brand-primary">{totalRuns}</p>
            </div>
            <div className="space-y-1">
              <span className="text-[10px] font-bold text-[var(--txt-muted)] uppercase tracking-widest">定时器 / 事件</span>
              <p className="font-headline text-3xl font-extrabold text-brand-secondary">
                {workflows.filter((w) => w.trigger_type === "timer").length} / {workflows.filter((w) => w.trigger_type === "event").length}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Create / Edit Modal */}
      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowModal(false)}
              className="absolute inset-0 bg-black"
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-heavy rounded-2xl p-6 md:p-8 max-w-md w-full relative z-10 shadow-2xl space-y-6"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-headline text-xl font-bold text-txt-dark">
                    {editingWorkflow ? "编辑工作流" : "创建工作流"}
                  </h3>
                  <p className="text-xs text-[var(--txt-muted)] mt-1">
                    配置定时器或事件驱动的自动化任务
                  </p>
                </div>
                <button
                  onClick={() => setShowModal(false)}
                  className="p-1 rounded-full hover:bg-[var(--surface-hover)] text-[var(--txt-muted)] hover:text-[var(--txt)] transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Name */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[var(--txt-secondary)]">工作流名称 *</label>
                  <input
                    type="text"
                    required
                    placeholder="例如: 每日归档扫描"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-brand-surface-high focus:outline-none focus:border-brand-primary"
                  />
                </div>

                {/* Description */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[var(--txt-secondary)]">描述（可选）</label>
                  <textarea
                    rows={2}
                    placeholder="简要说明此工作流的用途"
                    value={formDesc}
                    onChange={(e) => setFormDesc(e.target.value)}
                    className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-brand-surface-high focus:outline-none focus:border-brand-primary bg-[var(--surface)] resize-none"
                  />
                </div>

                {/* Trigger type */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[var(--txt-secondary)]">触发器类型</label>
                  <select
                    value={formTriggerType}
                    onChange={(e) => {
                      setFormTriggerType(e.target.value as "timer" | "event");
                      if (e.target.value === "timer") setFormEventType("");
                      else setFormTimer("");
                    }}
                    className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-brand-surface-high focus:outline-none focus:border-brand-primary bg-[var(--surface)]"
                  >
                    <option value="timer">定时器 (Timer)</option>
                    <option value="event">事件驱动 (Event)</option>
                  </select>
                </div>

                {/* Timer field (when timer selected) */}
                {formTriggerType === "timer" && (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--txt-secondary)]">定时表达式（可选）</label>
                    <input
                      type="text"
                      placeholder="例如: */30 * * * * (cron) 或 3600 (秒)"
                      value={formTimer}
                      onChange={(e) => setFormTimer(e.target.value)}
                      className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-brand-surface-high focus:outline-none focus:border-brand-primary"
                    />
                  </div>
                )}

                {/* Event type field (when event selected) */}
                {formTriggerType === "event" && (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--txt-secondary)]">事件类型</label>
                    <select
                      value={formEventType}
                      onChange={(e) => setFormEventType(e.target.value)}
                      className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-brand-surface-high focus:outline-none focus:border-brand-primary bg-[var(--surface)]"
                    >
                      <option value="">-- 选择事件类型 --</option>
                      {eventTypes.map((et) => (
                        <option key={et.value} value={et.value}>
                          {et.title} ({et.value})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Initial state */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-[var(--txt-secondary)]">初始状态</label>
                  <select
                    value={formState}
                    onChange={(e) => setFormState(e.target.value)}
                    className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-brand-surface-high focus:outline-none focus:border-brand-primary bg-[var(--surface)]"
                  >
                    <option value="P">已暂停 (P)</option>
                    <option value="W">运行中 (W)</option>
                  </select>
                </div>

                <div className="flex gap-3 pt-4 justify-end">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="px-5 py-2.5 text-xs text-[var(--txt-secondary)] font-semibold hover:bg-[var(--surface-hover)] rounded-lg transition-all"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2.5 text-xs text-white bg-brand-primary font-bold rounded-lg hover:bg-opacity-90 transition-all shadow-md flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {saving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current" />
                    )}
                    <span>{editingWorkflow ? "保存修改" : "创建工作流"}</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
