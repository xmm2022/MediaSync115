import React, { useState, useEffect } from "react";
import { MediaResource } from "../types";
import { Search, Film, Tv, Play, Download, CheckCircle, Flame, Plus, Shield, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

interface SearchTabProps {
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => Promise<void>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

export default function SearchTab({ addLog, searchQuery, setSearchQuery }: SearchTabProps) {
  const [resources, setResources] = useState<MediaResource[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<"All" | "Movie" | "TV" | "Anime">("All");
  const [selectedResource, setSelectedResource] = useState<MediaResource | null>(null);
  const [transferringLinkId, setTransferringLinkId] = useState<string | null>(null);
  const [transferSuccessId, setTransferSuccessId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load resources from backend
  const loadResources = async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/resources");
      if (response.ok) {
        setResources(await response.json());
      }
    } catch (err) {
      console.error("Failed to fetch resources:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadResources();
  }, []);

  // Filtered list
  const filteredResources = resources.filter(res => {
    const matchesSearch = res.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          res.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          res.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = selectedCategory === "All" || res.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Handle 115 transfer action
  const handleTransfer = async (resource: MediaResource, linkName: string, linkIndex: number) => {
    const actionId = `${resource.id}-${linkIndex}`;
    setTransferringLinkId(actionId);
    
    try {
      const res = await fetch("/api/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: resource.title,
          linkName: linkName,
          category: resource.category
        })
      });

      if (res.ok) {
        setTransferSuccessId(actionId);
        setTimeout(() => {
          setTransferSuccessId(null);
        }, 4000);
      } else {
        addLog("ERROR", `无法完成转存：服务器返回 ${res.status}`);
      }
    } catch (err) {
      console.error("Transfer error:", err);
      addLog("ERROR", `转存通信故障：${err}`);
    } finally {
      setTransferringLinkId(null);
    }
  };

  return (
    <div id="search-tab-container" className="space-y-6">
      
      {/* Search Header Banner */}
      <div className="bg-gradient-to-br from-brand-primary/10 via-brand-secondary/5 to-transparent rounded-3xl p-6 border border-brand-primary/10 shadow-sm">
        <h2 className="text-2xl font-black text-txt-dark tracking-tight flex items-center gap-2.5">
          <Search className="w-6 h-6 text-brand-primary" />
          <span>全网磁力 & 云端资源秒传检索</span>
        </h2>
        <p className="text-xs text-gray-500 mt-1 max-w-xl leading-relaxed">
          聚合海量磁力、BT、RSS发布站以及 115 官方云端转存通道。在这里搜索您的心仪影视，点击一键即可瞬间挂载至您的 Emby / Plex 服务器中，无需本地耗时下载。
        </p>
      </div>

      {/* Control row */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        
        {/* Search Bar Input */}
        <div className="w-full md:max-w-md relative">
          <input
            id="search-input-field"
            type="text"
            placeholder="搜索电影、电视剧、动漫、或资源标签..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white/70 backdrop-blur-md border border-white/60 focus:border-brand-primary rounded-2xl py-3 pl-11 pr-4 text-sm font-semibold outline-none transition-all shadow-xs placeholder:text-slate-400 focus:bg-white"
          />
          <Search className="w-5 h-5 text-slate-400 absolute left-4 top-3.5" />
        </div>

        {/* Category Filters */}
        <div className="flex flex-wrap gap-2 self-start md:self-auto">
          {(["All", "Movie", "TV", "Anime"] as const).map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
                selectedCategory === cat
                  ? "bg-brand-primary text-white border-brand-primary shadow-md shadow-brand-primary/15"
                  : "bg-white/70 backdrop-blur-md text-slate-500 border-white/60 hover:bg-white/80"
              }`}
            >
              {cat === "All" ? "全部类型" : cat === "Movie" ? "4K电影" : cat === "TV" ? "热门美剧" : "新番动漫"}
            </button>
          ))}
        </div>
      </div>

      {/* Resources grid & Detail section split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Resource List Left Side */}
        <div className="lg:col-span-7 space-y-4">
          <h3 className="text-sm font-black text-txt-dark flex items-center gap-2">
            <Flame className="w-4 h-4 text-brand-primary-light" />
            <span>热搜影视精品推荐</span>
            <span className="text-xs font-semibold text-gray-400">({filteredResources.length} 个结果)</span>
          </h3>

          {isLoading ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-100 space-y-3">
              <div className="w-8 h-8 border-4 border-brand-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-xs text-slate-400 font-bold">正在云端搜索索引库...</p>
            </div>
          ) : filteredResources.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-100">
              <p className="text-sm text-slate-400 font-bold">未找到匹配的媒体资源，换个词试试吧</p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {filteredResources.map(res => (
                <div
                  key={res.id}
                  id={`res-card-${res.id}`}
                  onClick={() => setSelectedResource(res)}
                  className={`bg-white/70 backdrop-blur-md rounded-2xl border p-4 flex gap-4 cursor-pointer transition-all hover:shadow-xs hover:bg-white/85 ${
                    selectedResource?.id === res.id
                      ? "border-brand-primary ring-2 ring-brand-primary/10 bg-brand-primary/5"
                      : "border-white/60"
                  }`}
                >
                  {/* Poster Placeholder */}
                  <div className="w-16 h-24 rounded-xl overflow-hidden bg-slate-50 shrink-0 border border-slate-100 relative">
                    <img
                      src={res.poster}
                      alt={res.title}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/70 text-white text-[8px] font-black uppercase tracking-widest">
                      {res.category === "Movie" ? "电影" : res.category === "TV" ? "剧集" : "动漫"}
                    </span>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-headline font-bold text-sm text-txt-dark truncate">{res.title}</h4>
                        <span className="shrink-0 bg-amber-50 text-amber-600 border border-amber-200/50 rounded px-1.5 py-0.5 text-[10px] font-black">
                          ★ {res.rating.toFixed(1)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 font-semibold mt-0.5">{res.year} 年公映</p>
                      <p className="text-xs text-slate-500 mt-2 line-clamp-2 leading-relaxed">{res.description}</p>
                    </div>

                    <div className="flex flex-wrap gap-1 mt-2">
                      {res.tags.map((tag, i) => (
                        <span key={i} className="text-[9px] bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded-full">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Resource Details & Links Panel Right Side */}
        <div className="lg:col-span-5">
          <AnimatePresence mode="wait">
            {selectedResource ? (
              <motion.div
                key={selectedResource.id}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                className="bg-white/75 backdrop-blur-xl rounded-3xl border border-white/60 p-5 space-y-5 sticky top-28 shadow-xs"
              >
                {/* Header info */}
                <div className="flex gap-4">
                  <div className="w-24 h-36 rounded-2xl overflow-hidden shrink-0 border border-slate-100 shadow-xs">
                    <img
                      src={selectedResource.poster}
                      alt={selectedResource.title}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                  <div className="space-y-2">
                    <span className="bg-brand-primary/10 text-brand-primary text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider">
                      {selectedResource.category === "Movie" ? "超级大片" : selectedResource.category === "TV" ? "多集连载" : "当季热门"}
                    </span>
                    <h3 className="font-headline font-black text-base text-txt-dark leading-tight">
                      {selectedResource.title}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-slate-400 font-semibold">
                      <span>{selectedResource.year}</span>
                      <span>•</span>
                      <span className="text-amber-500 font-bold">★ {selectedResource.rating} TMDB</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-black text-txt-dark block">资源简介</span>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {selectedResource.description}
                  </p>
                </div>

                {/* Torrent/Link Tables */}
                <div className="space-y-3 pt-3 border-t border-slate-200/40">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-black text-txt-dark flex items-center gap-1.5">
                      <Download className="w-4 h-4 text-brand-primary" />
                      <span>115 网盘磁力链转存通道</span>
                    </span>
                    <span className="text-[10px] text-brand-primary font-bold">秒级秒传</span>
                  </div>

                  <div className="space-y-2.5">
                    {selectedResource.links.map((link, idx) => {
                      const actionId = `${selectedResource.id}-${idx}`;
                      const isTransferring = transferringLinkId === actionId;
                      const isSuccess = transferSuccessId === actionId;

                      return (
                        <div key={idx} className="bg-white/50 backdrop-blur-xs rounded-xl p-3 border border-white/60 flex flex-col gap-2 hover:bg-white/75 transition-all">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-semibold text-txt-dark break-all leading-snug line-clamp-2">
                              {link.name}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold mt-1">
                            <div className="flex gap-3">
                              <span>大小: <strong className="text-slate-600">{link.size}</strong></span>
                              {link.seeds && <span>健康度: <strong className="text-green-600">{link.seeds}</strong></span>}
                            </div>

                            <button
                              disabled={isTransferring}
                              onClick={() => handleTransfer(selectedResource, link.name, idx)}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wider transition-all flex items-center gap-1.5 shadow-sm ${
                                isSuccess
                                  ? "bg-green-100 text-green-700 border border-green-200"
                                  : isTransferring
                                  ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                                  : "bg-brand-primary text-white border border-brand-primary hover:bg-brand-primary-light hover:border-brand-primary-light active:scale-95"
                              }`}
                            >
                              {isSuccess ? (
                                <>
                                  <CheckCircle className="w-3.5 h-3.5" />
                                  <span>转存成功!</span>
                                </>
                              ) : isTransferring ? (
                                <>
                                  <span className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                                  <span>正在转存...</span>
                                </>
                              ) : (
                                <>
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>115 一键秒传</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Cloud security badge */}
                <div className="bg-brand-primary-light/5 border border-brand-primary-light/10 rounded-2xl p-3 flex gap-2 items-center">
                  <Shield className="w-4.5 h-4.5 text-brand-primary shrink-0" />
                  <p className="text-[10px] text-brand-primary font-bold leading-tight">
                    本秒传通道完全加密！所有磁力经由您的 115 会话密钥直接发送至 115 官方云接口，挂载不耗费您的本地网络。
                  </p>
                </div>
              </motion.div>
            ) : (
              <div className="bg-slate-50/50 border border-dashed border-slate-200 rounded-3xl p-12 text-center space-y-3 sticky top-28">
                <Film className="w-10 h-10 text-slate-300 mx-auto" />
                <div>
                  <p className="text-sm text-slate-400 font-bold">请点击左侧影视资源</p>
                  <p className="text-[11px] text-slate-400 font-medium mt-1">即可查看影片完整详情、磁力解析度，并进行一键转存挂载</p>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>

      </div>
    </div>
  );
}
