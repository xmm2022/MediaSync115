import React, { useState, useEffect, useCallback } from "react";
import { MediaResource, MediaResourceLink } from "../types";
import { Search, Film, Tv, Play, Download, CheckCircle, Flame, Plus, Shield, ExternalLink, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { searchApi } from "../api/search";
import { pan115Api } from "../api/pan115";

interface SearchTabProps {
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => Promise<void>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
}

// Item shape from GET /api/search/explore/sections → sections[].items[]
interface ExploreItem {
  id?: string | number;
  title?: string;
  name?: string;
  poster_path?: string;
  poster_url?: string;
  rating?: number;
  vote_average?: number;
  year?: number;
  release_date?: string;
  media_type?: "movie" | "tv" | "collection";
  tmdb_id?: number;
  douban_id?: string;
  overview?: string;
  genres?: string[];
  genre_ids?: number[];
  tags?: string[];
}

// Link shape from GET /api/search/{media_type}/{tmdb_id}/resources
interface ResourceLinkRaw {
  title?: string;
  name?: string;
  size?: string | number;
  seeds?: number;
  pick_code?: string;
  pickcode?: string;
  share_link?: string;
  share_url?: string;
  url?: string;
  receive_code?: string;
  access_code?: string;
  source_service?: string;
  resolution?: string;
}

export default function SearchTab({ addLog, searchQuery, setSearchQuery }: SearchTabProps) {
  const [resources, setResources] = useState<MediaResource[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<"All" | "Movie" | "TV" | "Anime">("All");
  const [selectedResource, setSelectedResource] = useState<MediaResource | null>(null);
  const [transferringLinkId, setTransferringLinkId] = useState<string | null>(null);
  const [transferSuccessId, setTransferSuccessId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ---- Helper: map explore item → MediaResource ----
  const mapExploreItem = (item: ExploreItem, sectionTag?: string): MediaResource => {
    const mediaType = item.media_type || "movie";
    // category: backend media_type "movie"/"tv"/"collection" → UI "Movie"/"TV"
    const category: "Movie" | "TV" | "Anime" =
      mediaType === "movie" ? "Movie" : "TV"; // collection also maps to TV for now

    const year =
      item.year ||
      (item.release_date ? new Date(item.release_date).getFullYear() : undefined) ||
      0;

    const tags: string[] = [
      ...(item.genres || []),
      ...(sectionTag ? [sectionTag] : []),
    ].slice(0, 5);

    return {
      id: String(item.tmdb_id || item.douban_id || item.id || Math.random()),
      title: item.title || item.name || "未命名",
      poster: item.poster_path || item.poster_url || "",
      rating: item.rating || item.vote_average || 0,
      year,
      category,
      description: item.overview || "",
      tags,
      links: [],
      tmdb_id: item.tmdb_id,
      media_type: mediaType,
    };
  };

  // ---- Load explore sections (browse / discovery) ----
  // Rationale: SearchTab UI shows "热搜影视精品推荐" — a browse/discovery view
  // without mandatory keyword input. The most natural backend endpoint is
  // GET /api/search/explore/sections (douban rankings), which returns curated
  // sections of media items. This matches the existing card-grid UX.
  const loadResources = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await searchApi.getExploreSections("douban", 24, false);
      const data = response.data as {
        source: string;
        sections?: { key: string; title: string; tag?: string; items?: ExploreItem[] }[];
      };

      const sections = data.sections || [];
      const allItems: MediaResource[] = [];

      for (const section of sections) {
        const items = section.items || [];
        for (const item of items) {
          allItems.push(mapExploreItem(item, section.tag || section.title));
        }
      }

      // Deduplicate by id
      const seen = new Set<string>();
      const unique = allItems.filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return true;
      });

      setResources(unique);
      if (unique.length === 0) {
        setLoadError("探索列表为空，请检查后端搜索配置（TMDB API Key / 豆瓣可达性）");
      }
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || String(err);
      console.error("Failed to load explore sections:", msg);
      setLoadError(`加载探索列表失败: ${msg}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ---- Fetch resource links for detail panel ----
  const fetchResourceLinks = async (resource: MediaResource): Promise<MediaResourceLink[]> => {
    if (!resource.tmdb_id || !resource.media_type) {
      console.warn("Resource missing tmdb_id/media_type, cannot fetch links");
      return [];
    }
    try {
      const response = await searchApi.getMediaResources(
        resource.tmdb_id,
        resource.media_type,
        null,
        false,
      );
      const rawLinks: ResourceLinkRaw[] = Array.isArray(response.data)
        ? response.data
        : (response.data as any)?.items || (response.data as any)?.resources || [];

      return rawLinks.map((rl) => {
        const shareUrl = rl.share_link || rl.share_url || rl.url || "";
        // Extract receive_code from share URL or dedicated field
        const receiveCode =
          rl.receive_code ||
          rl.access_code ||
          (() => {
            const m = shareUrl.match(/[?&](?:password|pwd|receive_code)=([^&#]+)/i);
            return m ? m[1] : "";
          })();

        return {
          name: rl.title || rl.name || "未命名资源",
          size: typeof rl.size === "number" ? formatSize(rl.size) : String(rl.size || "未知"),
          seeds: rl.seeds,
          pickcode: rl.pick_code || rl.pickcode,
          url: shareUrl,
          shareUrl,
          receiveCode,
        };
      });
    } catch (err: any) {
      console.error("Failed to fetch resource links:", err);
      return [];
    }
  };

  // ---- Format file size ----
  const formatSize = (bytes: number): string => {
    if (bytes >= 1 << 40) return (bytes / (1 << 40)).toFixed(1) + " TB";
    if (bytes >= 1 << 30) return (bytes / (1 << 30)).toFixed(1) + " GB";
    if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(1) + " MB";
    if (bytes >= 1 << 10) return (bytes / (1 << 10)).toFixed(1) + " KB";
    return bytes + " B";
  };

  // ---- Handle resource selection (lazy-load links) ----
  const handleSelectResource = async (resource: MediaResource) => {
    setSelectedResource({ ...resource, links: [] });
    if (resource.links.length > 0) return; // already loaded

    setLoadingLinks(true);
    const links = await fetchResourceLinks(resource);
    setSelectedResource((prev) => (prev ? { ...prev, links } : null));
    setLoadingLinks(false);
  };

  // ---- Transfer handler ----
  const handleTransfer = async (resource: MediaResource, link: MediaResourceLink, linkIndex: number) => {
    const actionId = `${resource.id}-${linkIndex}`;
    setTransferringLinkId(actionId);

    try {
      // Guard: share URL is required for save-to-folder
      if (!link.shareUrl) {
        addLog("WARN", `该资源无分享链接，无法转存`);
        return;
      }

      const folderName = resource.title || link.name || "MediaSync115";
      const receiveCode = link.receiveCode || "";

      await pan115Api.saveShareToFolder(
        link.shareUrl,
        folderName,
        "0",
        receiveCode,
        String(resource.tmdb_id || ""),
      );

      setTransferSuccessId(actionId);
      setTimeout(() => {
        setTransferSuccessId(null);
      }, 4000);
      addLog("SUCCESS", `已提交转存: ${link.name}`);
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || String(err);
      console.error("Transfer error:", detail);
      addLog("ERROR", `转存失败: ${detail}`);
    } finally {
      setTransferringLinkId(null);
    }
  };

  // ---- Initial load ----
  useEffect(() => {
    loadResources();
  }, [loadResources]);

  // ---- Filtered list ----
  const filteredResources = resources.filter((res) => {
    const matchesSearch =
      res.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      res.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      res.tags.some((tag) => tag.toLowerCase().includes(searchQuery.toLowerCase()));

    // Category filter aligned to backend media_type:
    //   All → no filter
    //   Movie → media_type === "movie"
    //   TV → media_type === "tv"
    //   Anime → merged into TV (backend has no "anime" media_type; uses "tv" for anime series)
    const matchesCategory =
      selectedCategory === "All" ||
      (selectedCategory === "Movie" && res.media_type === "movie") ||
      ((selectedCategory === "TV" || selectedCategory === "Anime") && res.media_type === "tv");

    return matchesSearch && matchesCategory;
  });

  // ---- Determine if a link's transfer button should be disabled ----
  const isTransferDisabled = (link: MediaResourceLink): boolean => {
    return !link.shareUrl;
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
          {(["All", "Movie", "TV", "Anime"] as const).map((cat) => (
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
          ) : loadError ? (
            <div className="bg-white rounded-3xl p-8 text-center border border-red-100 space-y-3">
              <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
              <p className="text-sm text-red-500 font-semibold">{loadError}</p>
              <button
                onClick={loadResources}
                className="px-4 py-2 text-xs font-bold text-brand-primary bg-brand-primary/5 rounded-xl hover:bg-brand-primary/10 transition-all"
              >
                重试
              </button>
            </div>
          ) : filteredResources.length === 0 ? (
            <div className="bg-white rounded-3xl p-12 text-center border border-slate-100">
              <p className="text-sm text-slate-400 font-bold">未找到匹配的媒体资源，换个词试试吧</p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {filteredResources.map((res) => (
                <div
                  key={res.id}
                  id={`res-card-${res.id}`}
                  onClick={() => handleSelectResource(res)}
                  className={`bg-white/70 backdrop-blur-md rounded-2xl border p-4 flex gap-4 cursor-pointer transition-all hover:shadow-xs hover:bg-white/85 ${
                    selectedResource?.id === res.id
                      ? "border-brand-primary ring-2 ring-brand-primary/10 bg-brand-primary/5"
                      : "border-white/60"
                  }`}
                >
                  {/* Poster Placeholder */}
                  <div className="w-16 h-24 rounded-xl overflow-hidden bg-slate-50 shrink-0 border border-slate-100 relative">
                    {res.poster ? (
                      <img
                        src={res.poster}
                        alt={res.title}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                      />
                    ) : (
                      <Film className="w-6 h-6 text-slate-300 absolute inset-0 m-auto" />
                    )}
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
                          {res.rating > 0 ? `★ ${res.rating.toFixed(1)}` : "暂无评分"}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 font-semibold mt-0.5">
                        {res.year > 0 ? `${res.year} 年` : ""}
                      </p>
                      <p className="text-xs text-slate-500 mt-2 line-clamp-2 leading-relaxed">
                        {res.description || "暂无简介"}
                      </p>
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
                    {selectedResource.poster ? (
                      <img
                        src={selectedResource.poster}
                        alt={selectedResource.title}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <Film className="w-8 h-8 text-slate-300 absolute inset-0 m-auto" />
                    )}
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
                      <span className="text-amber-500 font-bold">
                        {selectedResource.rating > 0 ? `★ ${selectedResource.rating} TMDB` : "暂无评分"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-xs font-black text-txt-dark block">资源简介</span>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    {selectedResource.description || "暂无简介"}
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

                  {loadingLinks ? (
                    <div className="text-center py-6">
                      <div className="w-6 h-6 border-3 border-brand-primary border-t-transparent rounded-full animate-spin mx-auto" />
                      <p className="text-[10px] text-slate-400 mt-2 font-semibold">正在拉取资源链接...</p>
                    </div>
                  ) : selectedResource.links.length === 0 ? (
                    <div className="text-center py-6 bg-slate-50/50 rounded-xl border border-slate-100">
                      <p className="text-xs text-slate-400 font-semibold">
                        {selectedResource.tmdb_id
                          ? "该资源暂无可用下载链接"
                          : "该资源缺少 TMDB ID，无法获取下载链接"}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {selectedResource.links.map((link, idx) => {
                        const actionId = `${selectedResource.id}-${idx}`;
                        const isTransferring = transferringLinkId === actionId;
                        const isSuccess = transferSuccessId === actionId;
                        const disabled = isTransferDisabled(link);

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
                                {link.seeds != null && <span>健康度: <strong className="text-green-600">{link.seeds}</strong></span>}
                              </div>

                              <button
                                disabled={isTransferring || disabled}
                                onClick={() => handleTransfer(selectedResource, link, idx)}
                                className={`px-3 py-1.5 rounded-lg text-[10px] font-black tracking-wider transition-all flex items-center gap-1.5 shadow-sm ${
                                  isSuccess
                                    ? "bg-green-100 text-green-700 border border-green-200"
                                    : disabled
                                    ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                                    : isTransferring
                                    ? "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                                    : "bg-brand-primary text-white border border-brand-primary hover:bg-brand-primary-light hover:border-brand-primary-light active:scale-95"
                                }`}
                                title={disabled ? "该资源无分享链接，无法转存" : "一键转存到115网盘"}
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
                                ) : disabled ? (
                                  <>
                                    <ExternalLink className="w-3.5 h-3.5" />
                                    <span>无链接</span>
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
                  )}
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
