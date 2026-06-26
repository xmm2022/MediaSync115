/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CollapsibleSection — 可折叠卡片分区
 * 用于 SettingsTab 等服务面板的分区折叠交互优化。
 */

import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface CollapsibleSectionProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function CollapsibleSection({
  icon,
  title,
  subtitle,
  badge,
  defaultOpen = true,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="glass rounded-2xl overflow-hidden transition-all">
      {/* Header — clickable toggle */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left transition-all glass-hover"
      >
        <span className="shrink-0" style={{ color: "var(--brand-primary)" }}>{icon}</span>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-black" style={{ color: "var(--txt)" }}>{title}</span>
          {subtitle && (
            <span className="text-[10px] font-semibold ml-2 hidden sm:inline" style={{ color: "var(--txt-muted)" }}>
              {subtitle}
            </span>
          )}
        </div>
        {badge && (
          <span className="px-2 py-0.5 rounded-full text-[9px] font-black shrink-0"
            style={{ background: "var(--surface-subtle)", color: "var(--txt-muted)" }}>
            {badge}
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          style={{ color: "var(--txt-muted)" }}
        />
      </button>

      {/* Collapsible content */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-1" style={{ borderTop: "1px solid var(--border)" }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
