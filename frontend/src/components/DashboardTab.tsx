/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from "react";
import { SyncDirectory } from "../types";
import { 
  Zap, 
  ArrowUpRight, 
  HardDrive, 
  CloudRain, 
  RefreshCw, 
  ToggleLeft, 
  ToggleRight, 
  PlusCircle, 
  TrendingUp, 
  ShieldCheck, 
  HelpCircle,
  Database,
  Film,
  Tv,
  Sparkles,
  Info
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface DashboardTabProps {
  directories: SyncDirectory[];
  setDirectories: React.Dispatch<React.SetStateAction<SyncDirectory[]>>;
  onNavigateToSettings: () => void;
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => void;
}

export default function DashboardTab({ 
  directories, 
  setDirectories, 
  onNavigateToSettings,
  addLog 
}: DashboardTabProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newDirName, setNewDirName] = useState("");
  const [newLocalPath, setNewLocalPath] = useState("");
  const [newFolderId, setNewFolderId] = useState("");
  const [newClient, setNewClient] = useState<"emby" | "plex" | "jellyfin">("emby");
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  // Calculate totals
  const activeCount = directories.filter(d => d.enabled).length;
  const currentSpeedMB = directories
    .filter(d => d.enabled && d.status === "syncing")
    .reduce((sum, d) => sum + parseFloat(d.speed || "0"), 0)
    .toFixed(1);

  const totalFiles = directories.reduce((sum, d) => sum + d.itemCount, 0);

  // Toggle directory sync
  const toggleDir = (id: string) => {
    setDirectories(prev => prev.map(d => {
      if (d.id === id) {
        const nextState = !d.enabled;
        addLog(
          nextState ? "INFO" : "WARN", 
          `${nextState ? "已启动" : "已暂停"} 文件夹：${d.name} 的定时异步监听服务.`
        );
        return { 
          ...d, 
          enabled: nextState,
          status: nextState ? "syncing" : "idle",
          speed: nextState ? "3.2 MB/s" : "0 KB/s"
        };
      }
      return d;
    }));
  };

  // Add new directory mapping
  const handleAddDirectory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDirName || !newLocalPath || !newFolderId) {
      alert("请填写全部必要配置信息!");
      return;
    }

    const newDir: SyncDirectory = {
      id: `dir-${Date.now()}`,
      name: newDirName,
      localPath: newLocalPath,
      folderId115: newFolderId,
      targetClient: newClient,
      status: "idle",
      speed: "0 KB/s",
      progress: 0,
      enabled: true,
      totalSize: "0.0 TB",
      itemCount: 0
    };

    setDirectories(prev => [...prev, newDir]);
    addLog("SUCCESS", `新增 115 目录异步挂载规则: ${newDirName} -> ${newLocalPath}`);
    
    // Reset form
    setNewDirName("");
    setNewLocalPath("");
    setNewFolderId("");
    setNewClient("emby");
    setShowAddModal(false);
  };

  // Run full scan trigger
  const triggerFullScan = async () => {
    setIsSyncingAll(true);
    try {
      const response = await fetch("/api/sync/run", { method: "POST" });
      if (!response.ok) {
        throw new Error("HTTP Error " + response.status);
      }
    } catch (err) {
      console.error("Failed to run sync on server:", err);
      addLog("ERROR", "无法向后端同步引擎派发全量扫库请求，请检查服务端连通性。" + err);
    } finally {
      // Keep scan state active for 3.5s to align with the server process duration
      setTimeout(() => {
        setIsSyncingAll(false);
      }, 3500);
    }
  };

  return (
    <div className="space-y-12">
      {/* Centerpiece: Luminous Engine Dial */}
      <section className="flex flex-col items-center">
        <div className="relative w-72 h-72 md:w-80 md:h-80 flex items-center justify-center">
          {/* Shadow Glow Background */}
          <div className="absolute inset-0 rounded-full bg-brand-primary/5 blur-3xl"></div>
          
          {/* Outer Ring: 115 Synced Space (Green) */}
          <svg className="absolute w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
            <circle 
              className="text-brand-surface-normal" 
              cx="50" 
              cy="50" 
              fill="transparent" 
              r="44" 
              stroke="currentColor" 
              strokeWidth="5"
            ></circle>
            <motion.circle 
              className="text-brand-primary-light" 
              cx="50" 
              cy="50" 
              fill="transparent" 
              r="44" 
              stroke="currentColor" 
              strokeDasharray="276.4" 
              strokeDashoffset={isSyncingAll ? "30" : "65"} 
              strokeLinecap="round" 
              strokeWidth="5"
              animate={{ strokeDashoffset: isSyncingAll ? 10 : 65 }}
              transition={{ duration: 2, ease: "easeInOut" }}
            ></motion.circle>
          </svg>

          {/* Inner Ring: Local Metadata Success Rate (Blue) */}
          <svg className="absolute w-[78%] h-[78%] -rotate-90 transform" viewBox="0 0 100 100">
            <circle 
              className="text-brand-surface-high" 
              cx="50" 
              cy="50" 
              fill="transparent" 
              r="44" 
              stroke="currentColor" 
              strokeWidth="6"
            ></circle>
            <motion.circle 
              className="text-brand-secondary" 
              cx="50" 
              cy="50" 
              fill="transparent" 
              r="44" 
              stroke="currentColor" 
              strokeDasharray="276.4" 
              strokeDashoffset="35" 
              strokeLinecap="round" 
              strokeWidth="6"
              animate={{ rotate: isSyncingAll ? 360 : 0 }}
              transition={{ repeat: isSyncingAll ? Infinity : 0, duration: 10, ease: "linear" }}
            ></motion.circle>
          </svg>

          {/* Central Content */}
          <div className="z-10 text-center select-none">
            <motion.span 
              key={currentSpeedMB}
              initial={{ scale: 0.9, opacity: 0.5 }}
              animate={{ scale: 1, opacity: 1 }}
              className="font-headline text-5xl md:text-6xl font-bold text-txt-dark leading-none"
            >
              {isSyncingAll ? "扫描中" : parseFloat(currentSpeedMB) > 0 ? currentSpeedMB : "安全挂载"}
            </motion.span>
            <div className="text-sm font-medium text-gray-500 uppercase tracking-widest mt-2 flex items-center justify-center gap-1">
              <Database className="w-3.5 h-3.5 text-brand-primary-light" />
              <span>{parseFloat(currentSpeedMB) > 0 ? "MB/s 实时吞吐" : "多媒体软链接就绪"}</span>
            </div>
            
            <div className="mt-4 flex items-center justify-center gap-1.5 text-brand-secondary font-semibold bg-white/70 backdrop-blur px-3 py-1.5 rounded-full shadow-sm border border-brand-surface-high">
              <Sparkles className="w-4 h-4 text-brand-primary-light" />
              <span className="font-headline text-base">{totalFiles.toLocaleString()} + STRM 串流文件</span>
            </div>
          </div>
        </div>

        {/* Stats Metadata Area */}
        <div className="grid grid-cols-2 gap-8 mt-10 w-full max-w-md">
          <div className="bg-white/75 backdrop-blur-md p-4 rounded-xl border border-white/60 flex flex-col justify-start space-y-1 shadow-xs hover:bg-white/85 transition-all">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">同步健康度</span>
            <div className="flex items-center gap-1.5">
              <span className="font-headline text-2xl font-bold text-brand-primary">99.2%</span>
              <div className="flex items-center bg-teal-50 px-1 py-0.5 rounded text-[10px] text-brand-primary font-bold">
                <TrendingUp className="w-3 h-3 mr-0.5" />
                极佳
              </div>
            </div>
            <span className="text-[10px] text-slate-400">2,410 个节点正常守护</span>
          </div>

          <div className="bg-white/75 backdrop-blur-md p-4 rounded-xl border border-white/60 flex flex-col justify-start space-y-1 shadow-xs text-right hover:bg-white/85 transition-all">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-400">115 VIP 状态</span>
            <div className="flex items-center justify-end gap-1.5">
              <span className="font-headline text-xl font-bold text-txt-dark">超级白金</span>
              <div className="w-2 h-2 rounded-full bg-teal-500 animate-pulse" />
            </div>
            <span className="text-[10px] text-slate-400">挂载已全线程激活</span>
          </div>
        </div>
      </section>

      {/* Active Sync Directories Section */}
      <section className="space-y-5">
        <div className="flex items-center justify-between px-1">
          <div>
            <h2 className="font-headline text-2xl font-bold tracking-tight text-txt-dark">活动挂载目录 ({activeCount})</h2>
            <p className="text-sm text-gray-500">将 115 云盘视频实时索引秒级转换为本地 strm 播放文件</p>
          </div>
          <div className="flex gap-2">
            <button 
              onClick={triggerFullScan}
              disabled={isSyncingAll}
              className="px-4 py-2 bg-brand-primary text-white text-xs font-bold rounded-lg hover:bg-opacity-90 transition-all flex items-center gap-1.5 shadow-md disabled:bg-slate-300"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingAll ? "animate-spin" : ""}`} />
              <span>{isSyncingAll ? "正在全量增量同步中..." : "全量手动扫库"}</span>
            </button>
            <button 
              onClick={() => setShowAddModal(true)}
              className="px-4 py-2 bg-slate-50 text-brand-primary text-xs font-bold rounded-lg hover:bg-slate-100 transition-all flex items-center gap-1.5 border border-slate-100"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>新建映射</span>
            </button>
          </div>
        </div>

        {/* Horizontal Scroll Cards */}
        <div className="flex gap-6 overflow-x-auto no-scrollbar pb-4 snap-x">
          {directories.map((dir) => (
            <div 
              key={dir.id}
              className={`snap-start flex-shrink-0 w-72 p-6 rounded-2xl backdrop-blur-md border shadow-xs transition-all hover:shadow-sm ${
                dir.enabled 
                  ? "bg-white/70 border-white/60 hover:bg-white/85 hover:border-slate-200/50" 
                  : "bg-slate-50/40 border-slate-100/40 opacity-80"
              }`}
            >
              <div className="flex justify-between items-start mb-6">
                <div className={`p-3 rounded-xl flex items-center justify-center ${
                  !dir.enabled 
                    ? "bg-slate-100 text-slate-400" 
                    : dir.targetClient === "emby" 
                    ? "bg-teal-50 text-brand-primary" 
                    : dir.targetClient === "plex" 
                    ? "bg-amber-50 text-amber-600" 
                    : "bg-indigo-50 text-brand-secondary"
                }`}>
                  {dir.targetClient === "emby" ? (
                    <Film className="w-5 h-5" />
                  ) : dir.targetClient === "plex" ? (
                    <Tv className="w-5 h-5" />
                  ) : (
                    <Database className="w-5 h-5" />
                  )}
                </div>
                
                {/* Custom Toggle Switch */}
                <button
                  onClick={() => toggleDir(dir.id)}
                  className="focus:outline-none transition-transform active:scale-95"
                >
                  {dir.enabled ? (
                    <ToggleRight className="w-12 h-12 text-brand-primary-light" />
                  ) : (
                    <ToggleLeft className="w-12 h-12 text-gray-300" />
                  )}
                </button>
              </div>

              <h3 className="font-headline text-lg font-bold text-txt-dark flex items-center gap-2">
                {dir.name}
                {!dir.enabled && <span className="text-[10px] font-normal px-1.5 py-0.5 bg-gray-200 text-gray-500 rounded">已暂停</span>}
              </h3>

              <div className="mt-4 space-y-4">
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between text-gray-500">
                    <span>115 目录 ID:</span>
                    <span className="font-mono text-gray-700">{dir.folderId115}</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span>本地存储目标:</span>
                    <span className="font-mono text-gray-700 truncate max-w-[150px]" title={dir.localPath}>{dir.localPath}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-gray-500 flex items-center gap-1">
                      {dir.status === "syncing" && <span className="w-1.5 h-1.5 rounded-full bg-brand-primary-light animate-ping" />}
                      {dir.status === "scanning" && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />}
                      {dir.status === "syncing" ? "正在同步..." : dir.status === "scanning" ? "扫库索引中..." : "侦听正常"}
                    </span>
                    <span className="text-brand-primary font-bold">{dir.speed}</span>
                  </div>
                  <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                    <motion.div 
                      className={`h-full ${
                        dir.status === "scanning" ? "bg-amber-400" : "bg-brand-primary-light"
                      }`}
                      initial={{ width: 0 }}
                      animate={{ width: `${dir.progress}%` }}
                      transition={{ duration: 1 }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bento Grid Insights Layout */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left wider block: Peak Traffic Throttling */}
        <div className="md:col-span-2 p-8 rounded-2xl bg-white/75 backdrop-blur-md border border-white/60 shadow-xs relative overflow-hidden group hover:bg-white/85 transition-all">
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2.5 py-0.5 text-[10px] font-bold text-brand-primary uppercase tracking-widest bg-brand-primary/10 rounded-full">
                避让拥堵
              </span>
              <span className="text-xs text-slate-400">网盘API保护规则</span>
            </div>
            <h4 className="font-headline text-xl font-bold text-txt-dark flex items-center gap-2">
              智能离峰高宽带提速视窗
            </h4>
            <p className="text-sm text-slate-500 mt-2 max-w-sm leading-relaxed">
              根据 115 接口每日高风险时间段数据，可在每日 **凌晨 11:00 至 次日上午 5:00** 启用智能极速提速，自动增加 8-16 线程而防风控，建议您前去规划配置。
            </p>
            <div className="mt-6 flex items-center gap-3">
              <button 
                onClick={onNavigateToSettings}
                className="px-6 py-2.5 bg-brand-primary text-white text-xs font-bold rounded-lg hover:bg-opacity-90 transition-all shadow-md"
              >
                前往参数设置
              </button>
              <div className="text-xs text-amber-600 font-medium flex items-center gap-1">
                <Info className="w-3.5 h-3.5" />
                当前时段: 常规温和速率
              </div>
            </div>
          </div>
          
          <div className="absolute right-0 bottom-0 text-gray-100 pointer-events-none group-hover:scale-110 group-hover:text-brand-surface-normal transition-all duration-500 transform translate-x-8 translate-y-8">
            <Zap className="w-48 h-48" strokeWidth={0.5} />
          </div>
        </div>

        {/* Right smaller block: Token Watchdog / Error Prevention */}
        <div className="p-8 rounded-2xl bg-brand-primary text-white flex flex-col justify-between shadow-lg shadow-brand-primary/10 relative overflow-hidden">
          <div className="relative z-10">
            <div className="flex justify-between items-center mb-4">
              <ShieldCheck className="w-8 h-8 text-brand-primary-light" />
              <span className="font-headline text-2xl font-bold">100% 极佳</span>
            </div>
            <h4 className="font-headline text-lg font-bold">Cookies 凭证侦守</h4>
            <p className="text-xs text-green-100 mt-2 leading-relaxed">
              已全自动侦守 115 安全验证网关，当前账户 UID 及 API 请求会话极其安全，无速率拦截、降速或账号过载预警。
            </p>
          </div>
          
          <div className="mt-8 pt-4 border-t border-white/10 flex items-center justify-between text-xs">
            <span className="opacity-80">安全防护中:</span>
            <span className="font-bold underline cursor-pointer hover:text-white" onClick={onNavigateToSettings}>查看会话</span>
          </div>
        </div>
      </section>

      {/* Interactive Add Directory Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAddModal(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            
            {/* Box */}
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white/85 backdrop-blur-xl rounded-2xl p-6 md:p-8 max-w-md w-full relative z-10 shadow-2xl border border-white/60 space-y-6"
            >
              <div>
                <h3 className="font-headline text-xl font-bold text-txt-dark">新建媒体资源挂载映射</h3>
                <p className="text-xs text-slate-400 mt-1">建立 115 磁盘特定目录至本地 Plex/Emby/Jellyfin 目录映射关联</p>
              </div>

              <form onSubmit={handleAddDirectory} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500">映射友好名称 *</label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. 经典电影集锦"
                    value={newDirName}
                    onChange={(e) => setNewDirName(e.target.value)}
                    className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-slate-100 focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500">115 目录 Folder ID (11位数字) *</label>
                  <input 
                    type="text" 
                    required
                    maxLength={14}
                    placeholder="e.g. 115204481085"
                    value={newFolderId}
                    onChange={(e) => setNewFolderId(e.target.value)}
                    className="w-full text-sm font-mono px-3.5 py-2.5 rounded-lg border border-slate-100 focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500">本地挂载同步绝对路径 (保存 strm) *</label>
                  <input 
                    type="text" 
                    required
                    placeholder="e.g. /volume1/Media/ClassicMovies"
                    value={newLocalPath}
                    onChange={(e) => setNewLocalPath(e.target.value)}
                    className="w-full text-sm font-mono px-3.5 py-2.5 rounded-lg border border-slate-100 focus:outline-none focus:border-brand-primary"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500">对接并同步的目标媒体客户端 *</label>
                  <select 
                    value={newClient} 
                    onChange={(e) => setNewClient(e.target.value as any)}
                    className="w-full text-sm px-3.5 py-2.5 rounded-lg border border-slate-100 focus:outline-none focus:border-brand-primary bg-white"
                  >
                    <option value="emby">Emby Server 专属挂载库</option>
                    <option value="plex">Plex Media Server 专属挂载库</option>
                    <option value="jellyfin">Jellyfin 多媒体库</option>
                  </select>
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
                    className="px-5 py-2.5 text-xs text-white bg-brand-primary font-bold rounded-lg hover:bg-opacity-90 transition-all shadow-md"
                  >
                    创建映射关联
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
