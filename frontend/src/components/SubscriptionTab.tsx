import React, { useState, useEffect } from "react";
import { SubscriptionItem, SyncDirectory } from "../types";
import { Workflow, Plus, Trash2, Play, Pause, RefreshCw, Rss, Calendar, Check, AlertCircle, FileVideo, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface SubscriptionTabProps {
  directories: SyncDirectory[];
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => Promise<void>;
}

export default function SubscriptionTab({ directories, addLog }: SubscriptionTabProps) {
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Form Fields
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<"Movie" | "TV" | "Anime">("TV");
  const [rssSource, setRssSource] = useState("DMHY 动漫花园 1080p RSS");
  const [targetDirId, setTargetDirId] = useState("");
  const [autoTransfer, setAutoTransfer] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Set default target directory when directories load
  useEffect(() => {
    if (directories.length > 0 && !targetDirId) {
      setTargetDirId(directories[0].id);
    }
  }, [directories, targetDirId]);

  // Load subscriptions
  const loadSubscriptions = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/subscriptions");
      if (response.ok) {
        setSubscriptions(await response.json());
      }
    } catch (err) {
      console.error("Failed to load subscriptions:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSubscriptions();
  }, []);

  // Save subscriptions helper
  const saveSubscriptions = async (updatedList: SubscriptionItem[]) => {
    try {
      const response = await fetch("/api/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedList)
      });
      if (response.ok) {
        setSubscriptions(updatedList);
      }
    } catch (err) {
      console.error("Failed to save subscriptions:", err);
    }
  };

  // Add new subscription
  const handleAddSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);
    
    const newSub: SubscriptionItem = {
      id: `sub-${Date.now()}`,
      title,
      poster: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=400&q=80", // generic nice placeholder
      category,
      status: "subscribing",
      progress: category === "Movie" ? "全 1 集" : "第 1 集 / 连载中",
      lastUpdated: new Date().toISOString().replace("T", " ").substring(0, 19),
      rssSource,
      autoTransfer,
      targetDirId
    };

    const updated = [newSub, ...subscriptions];
    await saveSubscriptions(updated);

    // Write server logs
    await addLog("SUCCESS", `🔔 成功创建 [${title}] 自动订阅。RSS过滤源已接入，检测到新释出版本时将自动离线至115并同步Emby！`);

    // Reset Form
    setTitle("");
    setShowAddForm(false);
    setIsSubmitting(false);
  };

  // Toggle subscription active status
  const handleToggleStatus = async (id: string) => {
    const updated = subscriptions.map(sub => {
      if (sub.id === id) {
        const newStatus = sub.status === "subscribing" ? "paused" : "subscribing";
        addLog("INFO", `已将订阅 [${sub.title}] 状态置为 ${newStatus === "subscribing" ? "重新监听中" : "暂停挂起"}`);
        return { ...sub, status: newStatus as any };
      }
      return sub;
    });
    await saveSubscriptions(updated);
  };

  // Delete subscription
  const handleDelete = async (id: string, name: string) => {
    if (confirm(`确定要取消对 [${name}] 的 RSS 自动同步订阅吗？`)) {
      const updated = subscriptions.filter(sub => sub.id !== id);
      await saveSubscriptions(updated);
      await addLog("WARN", `已注销对 [${name}] 的自动轮询监听链条。`);
    }
  };

  return (
    <div id="subscription-tab-container" className="space-y-6">

      {/* Subscription Banner Title */}
      <div className="bg-gradient-to-br from-purple-500/10 via-brand-primary/5 to-white/30 backdrop-blur-md rounded-3xl p-6 border border-white/60 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-txt-dark tracking-tight flex items-center gap-2.5">
            <Rss className="w-6.5 h-6.5 text-purple-500" />
            <span>智能 RSS 增量自动订阅</span>
          </h2>
          <p className="text-xs text-gray-500 mt-1 max-w-xl leading-relaxed">
            配置剧集、动漫的 RSS 订阅规则。系统将在后台每 15 分钟轮询比对。一旦发布站点释出新片，后台将立即启动 115 极速转存，写入 strm 链并瞬间通知您的 Emby / Plex！
          </p>
        </div>

        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-brand-primary text-white px-4 py-2.5 rounded-2xl text-xs font-black tracking-wider flex items-center gap-1.5 shrink-0 transition-all active:scale-95 shadow-md shadow-brand-primary/10 self-start sm:self-auto"
        >
          <Plus className="w-4.5 h-4.5" />
          <span>新增智能订阅</span>
        </button>
      </div>

      {/* Add Subscription Form Drawer */}
      <AnimatePresence>
        {showAddForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <form onSubmit={handleAddSubscription} className="bg-white/70 backdrop-blur-md rounded-3xl border border-white/60 p-5 space-y-4 shadow-sm hover:bg-white/80 transition-all">
              <h3 className="text-sm font-black text-txt-dark flex items-center gap-2">
                <Workflow className="w-4 h-4 text-brand-primary" />
                <span>配置全新 RSS 剧集跟踪过滤规则</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Title */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400">影视/动漫名称</label>
                  <input
                    type="text"
                    required
                    placeholder="如：鬼灭之刃 无限城篇、怪兽8号..."
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-white/50 border border-slate-150 focus:border-brand-primary rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all"
                  />
                </div>

                {/* Category */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400">资源分类</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full bg-white/50 border border-slate-150 focus:border-brand-primary rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all text-slate-600"
                  >
                    <option value="TV">美剧 / 国剧连载 (TV Shows)</option>
                    <option value="Anime">新番动漫追更 (Animes)</option>
                    <option value="Movie">院线电影跟踪 (Movies)</option>
                  </select>
                </div>

                {/* RSS URL source */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400">RSS 规则发布源 (支持正则 / 模糊匹配)</label>
                  <input
                    type="text"
                    required
                    placeholder="请输入发布站点 RSS URL 或是内置解析别名..."
                    value={rssSource}
                    onChange={(e) => setRssSource(e.target.value)}
                    className="w-full bg-white/50 border border-slate-150 focus:border-brand-primary rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all"
                  />
                </div>

                {/* Target local synced folder mapping */}
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400">挂载同步目标库 (Emby路径映射)</label>
                  <select
                    value={targetDirId}
                    onChange={(e) => setTargetDirId(e.target.value)}
                    className="w-full bg-white/50 border border-slate-150 focus:border-brand-primary rounded-xl px-4 py-2.5 text-xs font-bold outline-none transition-all text-slate-600"
                  >
                    {directories.map(dir => (
                      <option key={dir.id} value={dir.id}>{dir.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Checkboxes */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="autoTransfer"
                  checked={autoTransfer}
                  onChange={(e) => setAutoTransfer(e.target.checked)}
                  className="w-4 h-4 rounded text-brand-primary focus:ring-brand-primary border-slate-200"
                />
                <label htmlFor="autoTransfer" className="text-xs font-bold text-slate-500 select-none cursor-pointer">
                  启动 115 极速离线秒传：一旦匹配最新剧集，自动秒传并通知 Emby。（推荐开启）
                </label>
              </div>

              {/* Buttons */}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-xl text-xs font-black transition-all"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-brand-primary text-white px-5 py-2 hover:bg-brand-primary-light rounded-xl text-xs font-black transition-all flex items-center gap-1.5 shadow-sm"
                >
                  {isSubmitting ? "正在持久化..." : "保存订阅规则"}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Subscription List */}
      <div className="space-y-4">
        <h3 className="text-sm font-black text-txt-dark flex items-center gap-2">
          <Workflow className="w-4 h-4 text-purple-500" />
          <span>正在轮询监听的订阅任务列表</span>
          <span className="text-xs font-semibold text-gray-400">({subscriptions.length} 线程监听中)</span>
        </h3>

        {isLoading ? (
          <div className="bg-white/70 backdrop-blur-md rounded-3xl p-12 text-center border border-white/60 shadow-sm">
            <div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-xs text-slate-400 font-bold mt-3">正在拉取服务器 RSS 监听树...</p>
          </div>
        ) : subscriptions.length === 0 ? (
          <div className="bg-white/70 backdrop-blur-md rounded-3xl p-12 text-center border border-white/60 shadow-sm">
            <AlertCircle className="w-10 h-10 text-slate-200 mx-auto mb-2" />
            <p className="text-sm text-slate-400 font-bold">暂无订阅项目</p>
            <p className="text-xs text-slate-400 font-semibold mt-1">点击右上角“新增智能订阅”开启全自动追更吧！</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {subscriptions.map(sub => (
              <div
                key={sub.id}
                className="bg-white/70 backdrop-blur-md rounded-2xl border border-white/60 p-4 flex gap-4 hover:shadow-xs hover:bg-white/85 transition-all relative overflow-hidden"
              >
                {/* Poster Placeholder background */}
                <div className="w-14 h-20 rounded-xl overflow-hidden bg-slate-50 shrink-0 border border-slate-100 relative">
                  <img
                    src={sub.poster}
                    alt={sub.title}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <span className="absolute bottom-1 right-1 bg-black/60 text-white text-[8px] font-black px-1 rounded uppercase">
                    {sub.category === "Anime" ? "动漫" : sub.category === "TV" ? "剧集" : "电影"}
                  </span>
                </div>

                {/* Content details */}
                <div className="flex-1 min-w-0 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-headline font-bold text-xs text-txt-dark truncate leading-tight">
                        {sub.title}
                      </h4>
                      <span className={`shrink-0 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                        sub.status === "subscribing"
                          ? "bg-purple-100 text-purple-700 animate-pulse"
                          : sub.status === "paused"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-green-100 text-green-700"
                      }`}>
                        {sub.status === "subscribing" ? "轮询监听中" : sub.status === "paused" ? "暂停中" : "已完结"}
                      </span>
                    </div>

                    <p className="text-[10px] text-slate-400 font-bold mt-1">进度: <span className="text-brand-primary">{sub.progress}</span></p>
                    
                    <div className="flex items-center gap-1.5 text-[9px] text-slate-400 font-semibold mt-2.5 truncate">
                      <Rss className="w-3.5 h-3.5 text-slate-400" />
                      <span className="truncate">{sub.rssSource}</span>
                    </div>
                  </div>

                  {/* Action buttons footer */}
                  <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-slate-200/40">
                    <span className="text-[9px] text-slate-300 font-bold">更新于 {sub.lastUpdated.substring(11, 16)}</span>
                    
                    <div className="flex items-center gap-1.5">
                      {/* Play/Pause */}
                      <button
                        onClick={() => handleToggleStatus(sub.id)}
                        className={`p-1.5 rounded-lg border transition-all ${
                          sub.status === "subscribing"
                            ? "bg-amber-50 text-amber-600 border-amber-200/50 hover:bg-amber-100"
                            : "bg-purple-50 text-purple-600 border-purple-200/50 hover:bg-purple-100"
                        }`}
                        title={sub.status === "subscribing" ? "暂停订阅" : "继续监听"}
                      >
                        {sub.status === "subscribing" ? (
                          <Pause className="w-3.5 h-3.5" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(sub.id, sub.title)}
                        className="p-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200/50 hover:bg-red-100 transition-all"
                        title="注销订阅"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
