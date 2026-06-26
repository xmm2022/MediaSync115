/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { AutomationRule } from "../types";
import { 
  Moon, 
  Trash2, 
  BellRing, 
  ShieldAlert, 
  Filter, 
  Plus, 
  Workflow, 
  BadgeCheck, 
  ToggleLeft, 
  ToggleRight, 
  HelpCircle,
  X,
  Play
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface AutomationsTabProps {
  rules: AutomationRule[];
  setRules: React.Dispatch<React.SetStateAction<AutomationRule[]>>;
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => void;
}

// Dynamic Lucide selection helper
const RenderRuleIcon = ({ iconName, className }: { iconName: string, className?: string }) => {
  const props = { className: className || "w-6 h-6" };
  switch (iconName) {
    case "Moon": return <Moon {...props} />;
    case "Trash2": return <Trash2 {...props} />;
    case "BellRing": return <BellRing {...props} />;
    case "ShieldAlert": return <ShieldAlert {...props} />;
    default: return <Workflow {...props} />;
  }
};

export default function AutomationsTab({ rules, setRules, addLog }: AutomationsTabProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterActive, setFilterActive] = useState<"all" | "active" | "inactive">("all");
  
  // Form rule state
  const [ruleName, setRuleName] = useState("");
  const [ruleDesc, setRuleDesc] = useState("");
  const [ruleIcon, setRuleIcon] = useState("Workflow");
  const [ruleColorType, setRuleColorType] = useState<"primary" | "secondary" | "neutral">("primary");

  // Toggle single rule
  const handleToggleRule = (id: string, name: string) => {
    setRules(prev => prev.map(r => {
      if (r.id === id) {
        const nextEnabled = !r.enabled;
        addLog(
          nextEnabled ? "SUCCESS" : "WARN",
          `自动化编排系统：规则【${name}】状态已变更为【${nextEnabled ? "启用运行中" : "休眠停用"}】`
        );
        return {
          ...r,
          enabled: nextEnabled,
          status: nextEnabled ? "active" : "idle"
        };
      }
      return r;
    }));
  };

  // Create customized rule
  const handleCreateRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleName || !ruleDesc) return;

    const newRule: AutomationRule = {
      id: `rule-${Date.now()}`,
      name: ruleName,
      icon: ruleIcon,
      description: ruleDesc,
      influence: "影响全部主同步通道",
      savings: "自动化守护",
      status: "active",
      enabled: true,
      colorType: ruleColorType
    };

    setRules(prev => [...prev, newRule]);
    addLog("SUCCESS", `💡 成功注册新的自动流：${ruleName}`);

    // Reset Form
    setRuleName("");
    setRuleDesc("");
    setRuleIcon("Workflow");
    setRuleColorType("primary");
    setShowAddModal(false);
  };

  // Filter rules list
  const filteredRules = rules.filter(r => {
    if (filterActive === "active") return r.enabled;
    if (filterActive === "inactive") return !r.enabled;
    return true;
  });

  return (
    <div className="space-y-12">
      {/* Editorial Header Section */}
      <section className="mb-4">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="max-w-xl space-y-4">
            <span className="inline-block px-3 py-1 rounded-full bg-brand-primary-light/15 text-brand-primary font-label text-xs font-bold">
              LUMINOUS SYNC AUTOMATIONS
            </span>
            <h2 className="font-headline text-5xl md:text-6xl font-black tracking-tight leading-none text-txt-dark mb-4">
              自动化编排
            </h2>
            <p className="text-gray-500 text-lg leading-relaxed font-light">
              MediaSync 后台轮询引擎当前托管着 <span className="font-bold text-brand-primary italic">{rules.filter(r => r.enabled).length} 条活跃流规则</span>，以最高吞吐量维护云盘电影瞬时映射。
            </p>
          </div>

          <div className="flex gap-2">
            {/* Filter Toggle controls */}
            <div className="bg-white p-1 rounded-lg border border-brand-surface-high flex gap-1 text-xs">
              <button 
                onClick={() => setFilterActive("all")}
                className={`px-4 py-2 rounded-md font-bold transition-all ${filterActive === "all" ? "bg-brand-primary text-white" : "text-gray-500 hover:bg-gray-100"}`}
              >
                全部
              </button>
              <button 
                onClick={() => setFilterActive("active")}
                className={`px-4 py-2 rounded-md font-bold transition-all ${filterActive === "active" ? "bg-brand-primary text-white" : "text-gray-500 hover:bg-gray-100"}`}
              >
                活跃 ({rules.filter(r => r.enabled).length})
              </button>
            </div>

            <button 
              onClick={() => setShowAddModal(true)}
              className="px-6 py-3 bg-brand-primary text-white rounded-lg font-bold flex items-center gap-2 transition-all hover:bg-opacity-90 active:scale-95 shadow-md shadow-brand-primary/10"
            >
              <Plus className="w-4.5 h-4.5" />
              <span>新增同步流</span>
            </button>
          </div>
        </div>
      </section>

      {/* Asymmetric Bento Grid for Automations */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 pb-12">
        {filteredRules.map((rule, idx) => {
          // Asymmetrical card span sizes: Make first one wide (8 columns) and second narrow (4 columns) to copy Screenshot 3!
          const isWideCard = idx % 3 === 0;
          const colSpanClass = isWideCard ? "md:col-span-8" : "md:col-span-4";
          
          return (
            <div 
              key={rule.id}
              className={`${colSpanClass} bg-white/70 backdrop-blur-md rounded-xl p-8 border shadow-sm flex flex-col justify-between min-h-[280px] relative overflow-hidden group hover:shadow-md hover:bg-white/85 transition-all ${
                rule.enabled ? "border-white/60" : "border-slate-100/40 bg-slate-50/40 opacity-80"
              }`}
            >
              {/* Top Row with Icon badge and Toggle */}
              <div className="relative z-10 flex justify-between items-start">
                <div className="flex flex-col gap-1">
                  <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 border ${
                    !rule.enabled 
                      ? "bg-slate-100 text-slate-400 border-slate-200"
                      : rule.colorType === "primary" 
                      ? "bg-violet-50 text-brand-primary border-brand-primary/10" 
                      : rule.colorType === "secondary" 
                      ? "bg-blue-50 text-brand-secondary border-brand-secondary/10" 
                      : "bg-slate-100 text-slate-500 border-slate-200"
                  }`}>
                    <RenderRuleIcon iconName={rule.icon} />
                  </div>
                  
                  <h3 className="font-headline text-2xl font-bold tracking-tight text-txt-dark leading-tight">
                    {rule.name}
                  </h3>
                  <p className="text-gray-500 text-sm mt-3 leading-relaxed max-w-md">
                    {rule.description}
                  </p>
                </div>

                {/* Custom active toggle button */}
                <button
                  onClick={() => handleToggleRule(rule.id, rule.name)}
                  className="focus:outline-none transition-transform active:scale-95"
                >
                  {rule.enabled ? (
                    <ToggleRight className="w-14 h-14 text-brand-primary" />
                  ) : (
                    <ToggleLeft className="w-14 h-14 text-slate-300" />
                  )}
                </button>
              </div>

              {/* Bottom Info Row */}
              <div className="relative z-10 mt-6 pt-5 border-t border-slate-200/40 flex items-center justify-between text-xs font-semibold text-gray-500">
                <span className="flex items-center gap-1.5 font-medium">
                  <BadgeCheck className={`w-4 h-4 ${rule.enabled ? "text-brand-primary" : "text-slate-300"}`} />
                  {rule.influence}
                </span>

                <span className={`text-sm font-extrabold font-headline ${
                  !rule.enabled ? "text-slate-400" : "text-brand-primary"
                }`}>
                  {rule.savings}
                </span>
              </div>

              {/* Hover Radial Background light effect */}
              {rule.enabled && (
                <div className="absolute top-0 right-0 w-48 h-48 bg-brand-primary/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none group-hover:scale-125 transition-transform duration-700" />
              )}
            </div>
          );
        })}
      </div>

      {/* Rules Stats Grid (Daily count details from screenshot 3) */}
      <section className="bg-white/50 backdrop-blur-md rounded-2xl p-6 md:p-8 border border-white/40">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">每日守护节省时间</span>
            <p className="font-headline text-3xl font-extrabold text-txt-dark">4.2 小时</p>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">剔除残影视频链接</span>
            <p className="font-headline text-3xl font-extrabold text-txt-dark">12.4 万个</p>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">云多媒体流刷新率</span>
            <p className="font-headline text-3xl font-extrabold text-brand-primary">94 / 100</p>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">网盘连接协议健康</span>
            <p className="font-headline text-3xl font-extrabold text-brand-secondary">持续稳定</p>
          </div>
        </div>
      </section>

      {/* Interactive Modal to Create Sync Automations Flow */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-black"
            />
            
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl p-6 md:p-8 max-w-md w-full relative z-10 shadow-2xl border border-brand-surface-high space-y-6"
            >
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-headline text-xl font-bold text-txt-dark">注册自定义同步自动化工作流</h3>
                  <p className="text-xs text-gray-400 mt-1">编排 115 媒体挂载网关的高级定时，规避及库刷新联动规则</p>
                </div>
                <button 
                  onClick={() => setShowAddModal(false)}
                  className="p-1 rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleCreateRule} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500">规则编排名称 *</label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. 视频变更多媒体即时推送微信"
                    value={ruleName}
                    onChange={(e) => setRuleName(e.target.value)}
                    className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-brand-surface-high focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-500">细则行为描述（如何规避/协作）*</label>
                  <textarea 
                    required
                    rows={3}
                    placeholder="e.g. 当侦测到 115 端在对应电影目录下新建视频，生成 strm 完毕后，自动拼装 metadata 推送到 WeChat 助手..."
                    value={ruleDesc}
                    onChange={(e) => setRuleDesc(e.target.value)}
                    className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-brand-surface-high focus:outline-none focus:border-brand-primary bg-white resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-500">图标样式</label>
                    <select 
                      value={ruleIcon} 
                      onChange={(e) => setRuleIcon(e.target.value)}
                      className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-brand-surface-high focus:outline-none focus:border-brand-primary bg-white"
                    >
                      <option value="Workflow">常规流线 (Workflow)</option>
                      <option value="Moon">极速月亮 (Moon)</option>
                      <option value="Trash2">智能清理 (Trash2)</option>
                      <option value="BellRing">通知预警 (BellRing)</option>
                      <option value="ShieldAlert">安全高盾 (ShieldAlert)</option>
                    </select>
                  </div>

                  <div className="space-y-1 font-semibold">
                    <label className="text-xs font-bold text-gray-500">规则颜色色调</label>
                    <select 
                      value={ruleColorType} 
                      onChange={(e) => setRuleColorType(e.target.value as any)}
                      className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-brand-surface-high focus:outline-none focus:border-brand-primary bg-white"
                    >
                      <option value="primary">Forest 森林绿 (Primary)</option>
                      <option value="secondary">Ocean 深海蓝 (Secondary)</option>
                      <option value="neutral">Slate 原材灰 (Neutral)</option>
                    </select>
                  </div>
                </div>

                <div className="flex gap-3 pt-4 justify-end">
                  <button 
                    type="button" 
                    onClick={() => setShowAddModal(false)}
                    className="px-5 py-2.5 text-xs text-gray-500 font-semibold hover:bg-gray-100 rounded-lg transition-all"
                  >
                    取消
                  </button>
                  <button 
                    type="submit" 
                    className="px-5 py-2.5 text-xs text-white bg-brand-primary font-bold rounded-lg hover:bg-opacity-90 transition-all shadow-md flex items-center gap-1.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>跑起本条自动化规章</span>
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
