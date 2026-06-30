/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from "react";
import type { WorkflowItem } from "../api/types";
import { workflowApi } from "../api";
import type { WorkflowSavePayload } from "../api/workflow";
import { getApiErrorMessage } from "../api/errors";
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

const DEFAULT_ACTIONS_INPUT = JSON.stringify(
  [
    {
      id: "log",
      type: "send_log_message",
      name: "记录触发",
      params: { message: "工作流已触发" },
    },
  ],
  null,
  2,
);

function formatJsonEditorValue(value: unknown, fallback: unknown): string {
  if (value == null || value === "") return JSON.stringify(fallback, null, 2);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return JSON.stringify(fallback, null, 2);
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return trimmed;
    }
  }
  return JSON.stringify(value, null, 2);
}

function parseJsonArrayInput(value: string, label: string): Record<string, unknown>[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${label} 必须是 JSON 数组`);
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${label} 第 ${index + 1} 项必须是对象`);
    }
    return item as Record<string, unknown>;
  });
}

function parseJsonObjectInput(value: string, label: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} 必须是 JSON 对象`);
  }
  return parsed as Record<string, unknown>;
}

function getWorkflowActionCount(raw: unknown): number {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw || "[]") : raw;
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function getLastResultStatus(raw: string | null): { label: string; color: string; bg: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { success?: boolean };
    if (parsed.success === true) {
      return { label: "最近成功", color: "var(--accent-ok)", bg: "rgba(34,197,94,0.12)" };
    }
    if (parsed.success === false) {
      return { label: "最近失败", color: "var(--accent-danger)", bg: "rgba(239,68,68,0.12)" };
    }
  } catch {
    return { label: "有结果", color: "var(--txt-muted)", bg: "var(--surface-subtle)" };
  }
  return null;
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
  const [formActionsInput, setFormActionsInput] = useState(DEFAULT_ACTIONS_INPUT);
  const [formFlowsInput, setFormFlowsInput] = useState("[]");
  const [formContextInput, setFormContextInput] = useState("{}");
  const [formError, setFormError] = useState<string | null>(null);

  // Event types for dropdown
  const [eventTypes, setEventTypes] = useState<EventTypeOption[]>([]);
  const [manualEventType, setManualEventType] = useState("manual.trigger");
  const [manualTriggerLoading, setManualTriggerLoading] = useState(false);

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
          const items = Array.isArray(data.items) ? data.items : [];
          setEventTypes(items);
          setManualEventType(items.find((item) => item.value === "manual.trigger")?.value || items[0]?.value || "manual.trigger");
        }
      } catch {
        // event types are non-critical; leave dropdown empty
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Reload workflows from backend
  const reloadWorkflows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await workflowApi.list();
      if (Array.isArray(res.data)) {
        setWorkflows(res.data);
      }
    } catch (e: unknown) {
      setError(getApiErrorMessage(e, "加载失败"));
    } finally {
      setLoading(false);
    }
  }, [setWorkflows]);

  useEffect(() => {
    void reloadWorkflows();
  }, [reloadWorkflows]);

  // Toggle start / pause
  const handleToggle = async (wf: WorkflowItem) => {
    const id = wf.id;
    const isActive = wf.state === "W";
    if (!isActive && wf.trigger_type === "timer" && !String(wf.timer || "").trim()) {
      addLog("WARN", `工作流【${wf.name}】缺少 cron 定时表达式，请先编辑后再启动`);
      return;
    }
    if (!isActive && wf.trigger_type === "event" && !String(wf.event_type || "").trim()) {
      addLog("WARN", `工作流【${wf.name}】缺少事件类型，请先编辑后再启动`);
      return;
    }
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
      addLog("ERROR", `操作失败: ${getApiErrorMessage(e)}`);
    } finally {
      setActionLoading((prev) => { const next = { ...prev }; delete next[id]; return next; });
    }
  };

  // Manual run
  const handleRun = async (wf: WorkflowItem) => {
    const id = wf.id;
    if (getWorkflowActionCount(wf.actions) === 0) {
      addLog("WARN", `工作流【${wf.name}】没有可执行动作，请先编辑动作列表`);
      return;
    }
    setActionLoading((prev) => ({ ...prev, [id]: "run" }));
    try {
      await workflowApi.run(String(id));
      addLog("SUCCESS", `工作流【${wf.name}】手动执行成功`);
      // Refresh to get updated run_count / last_run_at
      const res = await workflowApi.get(String(id));
      setWorkflows((prev) => prev.map((w) => (w.id === id ? (res.data as WorkflowItem) : w)));
    } catch (e: unknown) {
      addLog("ERROR", `执行失败: ${getApiErrorMessage(e)}`);
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
      addLog("ERROR", `删除失败: ${getApiErrorMessage(e)}`);
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
    setFormActionsInput(DEFAULT_ACTIONS_INPUT);
    setFormFlowsInput("[]");
    setFormContextInput("{}");
    setFormError(null);
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
    setFormActionsInput(formatJsonEditorValue(wf.actions, []));
    setFormFlowsInput(formatJsonEditorValue(wf.flows, []));
    setFormContextInput(formatJsonEditorValue(wf.context, {}));
    setFormError(null);
    setShowModal(true);
  };

  // Submit create or update
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    setSaving(true);
    setFormError(null);
    try {
      if (formTriggerType === "event" && !formEventType.trim()) {
        throw new Error("事件驱动工作流必须选择事件类型");
      }
      if (formTriggerType === "timer" && formState === "W" && !formTimer.trim()) {
        throw new Error("运行中的定时器工作流必须填写 cron 定时表达式");
      }

      const actions = parseJsonArrayInput(formActionsInput, "动作列表");
      if (actions.length === 0) {
        throw new Error("动作列表不能为空，否则工作流运行时没有可执行动作");
      }
      const flows = parseJsonArrayInput(formFlowsInput, "流程连线");
      const context = parseJsonObjectInput(formContextInput, "初始上下文");

      const payload: WorkflowSavePayload = {
        name: formName.trim(),
        description: formDesc.trim() || null,
        trigger_type: formTriggerType,
        state: formState,
        actions,
        flows,
        context,
      };
      if (formTriggerType === "timer") {
        payload.timer = formTimer.trim() || null;
        payload.event_type = null;
      } else {
        payload.timer = null;
        payload.event_type = formEventType || null;
      }

      if (editingWorkflow) {
        // Update
        const res = await workflowApi.update(String(editingWorkflow.id), payload);
        setWorkflows((prev) => prev.map((w) => (w.id === editingWorkflow.id ? res.data : w)));
        addLog("SUCCESS", `工作流【${formName.trim()}】已更新`);
      } else {
        // Create
        const res = await workflowApi.create(payload);
        setWorkflows((prev) => [res.data, ...prev]);
        addLog("SUCCESS", `工作流【${formName.trim()}】已创建`);
      }
      setShowModal(false);
    } catch (e: unknown) {
      const detail = getApiErrorMessage(e);
      setFormError(detail);
      addLog("ERROR", `${editingWorkflow ? "更新" : "创建"}失败: ${detail}`);
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

  const handleManualTrigger = async () => {
    if (!manualEventType.trim()) {
      addLog("WARN", "请先选择要触发的事件类型");
      return;
    }
    setManualTriggerLoading(true);
    try {
      const res = await workflowApi.triggerEvent({ event_type: manualEventType, payload: { source: "ui" } });
      const count = Number((res.data as { count?: number }).count || 0);
      addLog(count > 0 ? "SUCCESS" : "WARN", `已触发事件 ${manualEventType}，匹配 ${count} 个工作流`);
      await reloadWorkflows();
    } catch (e: unknown) {
      addLog("ERROR", `触发事件失败: ${getApiErrorMessage(e)}`);
    } finally {
      setManualTriggerLoading(false);
    }
  };

  return (
    <div className="liquid-page space-y-8">
      {/* Header */}
      <section className="liquid-hero glass-heavy glass-iridescent glass-spotlight rounded-3xl p-6 md:p-8 mb-4">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="max-w-xl space-y-3">
            <span className="liquid-kicker">
              WORKFLOW ENGINE
            </span>
            <h2 className="font-headline text-2xl md:text-3xl font-black tracking-tight leading-tight text-txt-dark">
              工作流与触发器
            </h2>
            <p className="text-[var(--txt-secondary)] text-sm leading-relaxed font-semibold">
              已配置 <span className="font-bold text-brand-primary italic">{workflows.length} 个工作流</span>，
              管理定时任务与事件驱动的自动化操作。
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            {/* Filter */}
            <div className="liquid-segmented flex gap-1 text-xs">
              <button
                onClick={() => setFilterState("all")}
                className={`px-4 py-2 rounded-xl font-bold transition-all ${filterState === "all" ? "bg-brand-primary text-white" : "text-[var(--txt-secondary)] hover:bg-[var(--surface-hover)]"}`}
              >
                全部
              </button>
              <button
                onClick={() => setFilterState("W")}
                className={`px-4 py-2 rounded-xl font-bold transition-all ${filterState === "W" ? "bg-brand-primary text-white" : "text-[var(--txt-secondary)] hover:bg-[var(--surface-hover)]"}`}
              >
                运行中 ({runningCount})
              </button>
              <button
                onClick={() => setFilterState("P")}
                className={`px-4 py-2 rounded-xl font-bold transition-all ${filterState === "P" ? "bg-brand-primary text-white" : "text-[var(--txt-secondary)] hover:bg-[var(--surface-hover)]"}`}
              >
                已暂停 ({pausedCount})
              </button>
            </div>

            <button
              onClick={() => void reloadWorkflows()}
              disabled={loading}
              className="px-4 py-3 glass glass-hover rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
              style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span>刷新</span>
            </button>

            <button
              onClick={openCreate}
              className="px-6 py-3 bg-brand-primary text-white rounded-2xl font-bold flex items-center gap-2 transition-all hover:bg-opacity-90 active:scale-95 shadow-md shadow-brand-primary/10 cursor-pointer"
            >
              <Plus className="w-4.5 h-4.5" />
              <span>创建工作流</span>
            </button>
          </div>
        </div>
      </section>

      {/* Loading / Error / Empty states */}
      {loading && (
        <div className="glass-heavy glass-iridescent rounded-3xl flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-brand-primary" />
          <span className="ml-3 text-[var(--txt-secondary)] font-semibold">加载中...</span>
        </div>
      )}
      {error && !loading && (
        <div className="glass-heavy glass-iridescent rounded-3xl flex flex-col items-center gap-3 py-20">
          <p className="text-red-500 font-semibold">{error}</p>
          <button onClick={reloadWorkflows} className="px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-bold">
            重试
          </button>
        </div>
      )}
      {!loading && !error && workflows.length === 0 && (
        <div className="glass-heavy glass-iridescent rounded-3xl flex flex-col items-center gap-4 py-20 text-[var(--txt-muted)]">
          <Workflow className="w-12 h-12" />
          <p className="font-semibold">暂无工作流</p>
          <p className="text-sm">点击"创建工作流"配置第一个自动化任务</p>
        </div>
      )}

      {/* Cards Grid */}
      {!loading && !error && workflows.length > 0 && filtered.length === 0 && (
        <div className="glass-heavy glass-iridescent rounded-3xl flex flex-col items-center gap-4 py-16 text-[var(--txt-muted)]">
          <Workflow className="w-10 h-10" />
          <p className="font-semibold">当前筛选无工作流</p>
          <button
            type="button"
            onClick={() => setFilterState("all")}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-brand-primary text-white cursor-pointer"
          >
            查看全部
          </button>
        </div>
      )}

      {!loading && !error && workflows.length > 0 && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pb-12">
          {filtered.map((wf, idx) => {
            const isWideCard = idx % 3 === 0;
            const colSpanClass = isWideCard ? "md:col-span-8" : "md:col-span-4";
            const si = stateStyle(wf.state);
            const isActive = wf.state === "W";
            const isLoading = !!actionLoading[wf.id];
            const actionCount = getWorkflowActionCount(wf.actions);
            const canRun = actionCount > 0;
            const lastResult = getLastResultStatus(wf.last_result);

            return (
              <div
                key={wf.id}
                className={`${colSpanClass} liquid-card glass glass-hover rounded-3xl p-6 md:p-8 flex flex-col justify-between min-h-[280px] relative overflow-hidden group transition-all ${
                  isActive ? "border-[var(--border)]" : "opacity-80"
                }`}
              >
                {isActive && (
                  <div
                    className="absolute inset-0 opacity-40 pointer-events-none transition-opacity duration-500 group-hover:opacity-60"
                    style={{ background: "var(--brand-gradient-soft)" }}
                  />
                )}

                <div className="relative z-10">
                  {/* Top row: icon + state badge + toggle */}
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center border"
                        style={isActive
                          ? { background: "var(--brand-primary-bg-alpha)", color: "var(--brand-primary)", borderColor: "var(--brand-primary-border-alpha)" }
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
                        disabled={isLoading || !canRun}
                        title={canRun ? "手动执行一次" : "没有可执行动作，请先编辑"}
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
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                      style={actionCount > 0
                        ? { color: "var(--accent-ok)", background: "rgba(34,197,94,0.12)" }
                        : { color: "var(--accent-warn)", background: "rgba(245,158,11,0.14)" }}
                    >
                      动作 {actionCount}
                    </span>
                    {lastResult && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{ color: lastResult.color, background: lastResult.bg }}
                      >
                        {lastResult.label}
                      </span>
                    )}
                  </div>
                </div>

                {/* Bottom info row */}
                <div className="relative z-10 mt-6 pt-5 border-t flex items-center justify-between text-xs font-semibold" style={{ borderTopColor: "var(--border)", color: "var(--txt-muted)" }}>
                  <div className="flex items-center gap-3">
                    <span title="运行尝试次数">
                      <RefreshCw className="w-3.5 h-3.5 inline mr-1" />
                      {wf.run_count || 0} 次尝试
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
        <section className="liquid-panel glass rounded-3xl p-6 md:p-8">
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
              <span className="text-[10px] font-bold text-[var(--txt-muted)] uppercase tracking-widest">累计运行尝试</span>
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
              className="absolute inset-0"
              style={{ background: "rgba(11,8,30,.34)", backdropFilter: "blur(4px)" }}
            />

            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-heavy glass-iridescent rounded-3xl p-6 md:p-8 max-w-3xl w-full max-h-[90vh] overflow-y-auto relative z-10 shadow-2xl space-y-6"
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
                {formError && (
                  <div
                    role="alert"
                    className="rounded-xl px-3 py-2 text-xs font-semibold"
                    style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "var(--accent-danger)" }}
                  >
                    {formError}
                  </div>
                )}

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
                      placeholder="例如: */30 * * * *（每 30 分钟）"
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

                <div className="space-y-1">
                  <label className="text-xs font-bold text-[var(--txt-secondary)]">动作列表 JSON *</label>
                  <textarea
                    rows={7}
                    value={formActionsInput}
                    onChange={(e) => setFormActionsInput(e.target.value)}
                    className="w-full text-[11px] px-3.5 py-2.5 rounded-lg border border-brand-surface-high focus:outline-none focus:border-brand-primary bg-[var(--surface)] font-mono leading-relaxed resize-y"
                    spellCheck={false}
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--txt-secondary)]">流程连线 JSON</label>
                    <textarea
                      rows={4}
                      value={formFlowsInput}
                      onChange={(e) => setFormFlowsInput(e.target.value)}
                      className="w-full text-[11px] px-3.5 py-2.5 rounded-lg border border-brand-surface-high focus:outline-none focus:border-brand-primary bg-[var(--surface)] font-mono leading-relaxed resize-y"
                      spellCheck={false}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-[var(--txt-secondary)]">初始上下文 JSON</label>
                    <textarea
                      rows={4}
                      value={formContextInput}
                      onChange={(e) => setFormContextInput(e.target.value)}
                      className="w-full text-[11px] px-3.5 py-2.5 rounded-lg border border-brand-surface-high focus:outline-none focus:border-brand-primary bg-[var(--surface)] font-mono leading-relaxed resize-y"
                      spellCheck={false}
                    />
                  </div>
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

      {/* 工作流高级工具 */}
      <div className="glass rounded-2xl p-4 space-y-3">
        <p className="text-[10px] font-black" style={{ color:"var(--txt-muted)" }}>工作流工具</p>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <select
            value={manualEventType}
            onChange={(e) => setManualEventType(e.target.value)}
            className="min-w-0 flex-1 text-xs rounded-lg px-3 py-2"
            style={{ background: "var(--bg-elev)", color: "var(--txt)", border: "1px solid var(--border)" }}
          >
            {eventTypes.length === 0 ? (
              <option value="manual.trigger">manual.trigger</option>
            ) : eventTypes.map((eventType) => (
              <option key={eventType.value} value={eventType.value}>
                {eventType.title} ({eventType.value})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handleManualTrigger()}
            disabled={manualTriggerLoading}
            className="px-3 py-2 rounded-lg text-[10px] font-black glass-hover flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
            style={{ color:"var(--txt-secondary)", border:"1px solid var(--border)" }}
          >
            {manualTriggerLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bell className="w-3.5 h-3.5" />}
            <span>触发事件</span>
          </button>
        </div>
      </div>
    </div>
  );
}
