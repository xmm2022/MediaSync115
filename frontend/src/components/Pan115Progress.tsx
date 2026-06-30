/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pan115Progress — 115 转存/HDHive 解锁进度弹窗
 * 参考 Vue 旧版 Pan115ProgressDialog.vue 的 phase 设计：
 *   progress → 转存/解锁中（spinner + 消息）
 *   result   → 完成/失败/警告（大图标 + 消息 +「知道了」按钮）
 */

import React from "react";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, Shield } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export type ProgressPhase = "progress" | "result";
export type ProgressStatus = "loading" | "success" | "warning" | "failed";

export interface Pan115ProgressState {
  visible: boolean;
  phase: ProgressPhase;
  status: ProgressStatus;
  resourceLabel: string;
  message: string;
  /** 用于按资源渠道自定义标题文本 */
  actionType?: "unlock" | "transfer" | "quark_transfer";
}

interface Pan115ProgressProps {
  state: Pan115ProgressState;
  onClose: () => void;
}

export function deriveDefaultProgressState(): Pan115ProgressState {
  return {
    visible: false,
    phase: "progress",
    status: "loading",
    resourceLabel: "",
    message: "",
  };
}

export default function Pan115Progress({ state, onClose }: Pan115ProgressProps) {
  if (!state.visible) return null;

  const title = (() => {
    if (state.phase === "progress") {
      if (state.actionType === "unlock") return "HDHive 解锁中";
      if (state.actionType === "quark_transfer") return "夸克转存中";
      return "115 转存中";
    }
    if (state.status === "success") return "转存成功";
    if (state.status === "warning") return "转存提示";
    return "转存失败";
  })();

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0"
          style={{ background: "rgba(11,8,30,.34)", backdropFilter: "blur(6px)" }}
          onClick={state.phase === "result" ? onClose : undefined}
        />

        {/* Dialog panel */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.92, y: 20 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="relative w-full max-w-[380px] glass-heavy glass-iridescent rounded-3xl p-6 z-10 space-y-5"
        >
          {/* Phase: progress */}
          {state.phase === "progress" && (
            <div className="text-center space-y-4 py-2">
              <div className="flex justify-center">
                {state.actionType === "unlock" ? (
                  <div className="w-12 h-12 rounded-full flex items-center justify-center"
                    style={{ background: "rgba(245,158,11,0.16)", border: "2px solid rgba(245,158,11,0.3)" }}>
                    <Shield className="w-6 h-6 animate-pulse" style={{ color: "var(--accent-warn)" }} />
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-full flex items-center justify-center"
                    style={{ background: "var(--brand-primary-bg-alpha-heavy)", border: "2px solid var(--brand-primary-border-alpha)" }}>
                    <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--brand-primary)" }} />
                  </div>
                )}
              </div>

              {state.resourceLabel && (
                <p className="text-sm font-black break-words leading-snug" style={{ color: "var(--txt)" }}>
                  {state.resourceLabel}
                </p>
              )}
              <p className="text-xs font-semibold leading-relaxed" style={{ color: "var(--txt-secondary)" }}>
                {state.message}
              </p>
            </div>
          )}

          {/* Phase: result */}
          {state.phase === "result" && (
            <div className="text-center space-y-4 py-1">
              <div className="flex justify-center">
                {state.status === "success" ? (
                  <CheckCircle2 className="w-11 h-11" style={{ color: "var(--accent-ok)" }} />
                ) : state.status === "warning" ? (
                  <AlertTriangle className="w-11 h-11" style={{ color: "var(--accent-warn)" }} />
                ) : (
                  <XCircle className="w-11 h-11" style={{ color: "var(--accent-danger)" }} />
                )}
              </div>

              {state.resourceLabel && (
                <p className="text-sm font-black break-words leading-snug" style={{ color: "var(--txt)" }}>
                  {state.resourceLabel}
                </p>
              )}
              <p className="text-xs font-semibold leading-relaxed" style={{ color: "var(--txt-secondary)" }}>
                {state.message}
              </p>

              <button
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl text-xs font-black tracking-wider transition-all active:scale-95"
                style={{
                  background: state.status === "success" ? "var(--accent-ok)" : state.status === "warning" ? "var(--accent-warn)" : "var(--accent-danger)",
                  color: "#fff",
                }}
              >
                知道了
              </button>
            </div>
          )}

          {/* Visual header bar */}
          <div className="absolute top-5 left-1/2 -translate-x-1/2">
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--txt-muted)" }}>
              {title}
            </p>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
