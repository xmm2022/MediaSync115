import React, { useState } from "react";
import { Sparkles, Trophy, Star, Search, Plus, Calendar, BookmarkCheck, ArrowRight, Eye } from "lucide-react";
import { motion } from "motion/react";

interface ExploreTabProps {
  onSearchQuery: (query: string) => void;
  onAddSubscription: (title: string, category: "Movie" | "TV" | "Anime", poster: string) => void;
}

export default function ExploreTab({ onSearchQuery, onAddSubscription }: ExploreTabProps) {
  const [activeBoard, setActiveBoard] = useState<"netflix" | "douban" | "anime">("netflix");

  const netflixTrends = [
    { rank: 1, title: "沙丘2 (Dune: Part Two)", rating: 8.3, hot: "9.8 万热度", poster: "https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=300&q=80", category: "Movie" as const, desc: "科幻巨制沙丘续篇，IMAX巨幕视效极致天花板。" },
    { rank: 2, title: "死侍与金刚狼 (Deadpool & Wolverine)", rating: 7.4, hot: "9.2 万热度", poster: "https://images.unsplash.com/photo-1534447677768-be436bb09401?w=300&q=80", category: "Movie" as const, desc: "双雄宿命联手，打破漫威多元宇宙壁垒。" },
    { rank: 3, title: "黑袍纠察队 第四季 (The Boys S4)", rating: 7.8, hot: "8.5 万热度", poster: "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=300&q=80", category: "TV" as const, desc: "反英雄神剧高燃回归，沃特集团面临内部解体危机。" },
    { rank: 4, title: "三体 第一季 (3 Body Problem)", rating: 7.9, hot: "7.9 万热度", poster: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=300&q=80", category: "TV" as const, desc: "刘慈欣同名科幻名著网飞版巨资改编。" }
  ];

  const doubanHighRatings = [
    { rank: 1, title: "肖申克的救赎 (The Shawshank Redemption)", rating: 9.7, hot: "神作榜首", poster: "https://images.unsplash.com/photo-1485846234645-a62644f84728?w=300&q=80", category: "Movie" as const, desc: "希望是一件美好的事，也许是人间至善，而美好的事物永不消逝。" },
    { rank: 2, title: "霸王别姬 (Farewell My Concubine)", rating: 9.6, hot: "华语最高", poster: "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?w=300&q=80", category: "Movie" as const, desc: "风华绝代程蝶衣，人戏不分，红尘一梦。" },
    { rank: 3, title: "星际穿越 (Interstellar)", rating: 9.4, hot: "科幻神作", poster: "https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=300&q=80", category: "Movie" as const, desc: "爱是唯一可以跨越时间和空间维度的伟大事物。" }
  ];

  const animeTrends = [
    { rank: 1, title: "鬼灭之刃 柱训练篇", rating: 8.8, hot: "本季霸权", poster: "https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=300&q=80", category: "Anime" as const, desc: "幽浮社天花板特效，九柱集结特训备战无限城。" },
    { rank: 2, title: "怪兽8号 (Kaiju No. 8)", rating: 8.1, hot: "周刊连载", poster: "https://images.unsplash.com/photo-1560942485-b2a11cc13456?w=300&q=80", category: "Anime" as const, desc: "热血防卫队，大叔变身强大怪兽守护人类。" },
    { rank: 3, title: "无职转生 第二季", rating: 8.5, hot: "异世界奇幻", poster: "https://images.unsplash.com/photo-1578632767115-351597cf2477?w=300&q=80", category: "Anime" as const, desc: "异世界冒险史诗，废柴青年的重组与成长之旅。" }
  ];

  const currentBoardItems = 
    activeBoard === "netflix" ? netflixTrends : 
    activeBoard === "douban" ? doubanHighRatings : animeTrends;

  return (
    <div id="explore-tab-container" className="space-y-6">
      
      {/* Billboard Hero Banner */}
      <div className="bg-gradient-to-br from-violet-500/10 via-brand-primary/5 to-white/30 backdrop-blur-md rounded-3xl p-6 border border-white/60 shadow-sm relative overflow-hidden">
        <div className="relative z-10">
          <h2 className="text-2xl font-black text-txt-dark tracking-tight flex items-center gap-2.5">
            <Trophy className="w-6.5 h-6.5 text-amber-500" />
            <span>影视榜单 & 流行风向探索</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1 max-w-xl leading-relaxed">
            为您同步全球主流流媒体（Netflix, HBO, 豆瓣电影, 哔哩哔哩）每日及每周的热门风向标、高分佳作榜，实时追随流行趋势，告别片荒。
          </p>
        </div>
        <div className="absolute right-6 top-6 opacity-10 select-none">
          <Sparkles className="w-24 h-24 text-indigo-500" />
        </div>
      </div>

      {/* Toggle Tab Navigation for boards */}
      <div className="flex border-b border-slate-200/40">
        <button
          onClick={() => setActiveBoard("netflix")}
          className={`px-5 py-3.5 text-xs font-black relative flex items-center gap-2 transition-all ${
            activeBoard === "netflix" ? "text-brand-primary" : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <span>Netflix 流行榜</span>
          {activeBoard === "netflix" && (
            <motion.div layoutId="exploreUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-primary" />
          )}
        </button>

        <button
          onClick={() => setActiveBoard("douban")}
          className={`px-5 py-3.5 text-xs font-black relative flex items-center gap-2 transition-all ${
            activeBoard === "douban" ? "text-brand-primary" : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <span>豆瓣电影 TOP 高分榜</span>
          {activeBoard === "douban" && (
            <motion.div layoutId="exploreUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-primary" />
          )}
        </button>

        <button
          onClick={() => setActiveBoard("anime")}
          className={`px-5 py-3.5 text-xs font-black relative flex items-center gap-2 transition-all ${
            activeBoard === "anime" ? "text-brand-primary" : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <span>当季新番动漫推荐</span>
          {activeBoard === "anime" && (
            <motion.div layoutId="exploreUnderline" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-primary" />
          )}
        </button>
      </div>

      {/* Grid displays */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {currentBoardItems.map((item) => (
          <div
            key={item.rank}
            className="bg-white/70 backdrop-blur-md rounded-2xl border border-white/60 p-4 flex gap-4 hover:shadow-xs hover:bg-white/85 transition-all relative overflow-hidden"
          >
            {/* Rank badge ribbon */}
            <div className={`absolute top-0 left-0 w-8 h-8 flex items-center justify-center rounded-br-2xl font-black text-xs text-white ${
              item.rank === 1 ? "bg-amber-500 shadow-xs" : item.rank === 2 ? "bg-slate-400" : item.rank === 3 ? "bg-amber-700" : "bg-slate-300"
            }`}>
              #{item.rank}
            </div>

            {/* Poster cover thumbnail */}
            <div className="w-20 h-28 rounded-xl overflow-hidden bg-slate-50 border border-slate-100 shrink-0 relative mt-2">
              <img
                src={item.poster}
                alt={item.title}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>

            {/* Content info */}
            <div className="flex-1 flex flex-col justify-between pt-1">
              <div>
                <div className="flex items-start justify-between gap-2 pl-4">
                  <h4 className="font-headline font-bold text-sm text-txt-dark truncate leading-snug">
                    {item.title}
                  </h4>
                </div>

                <div className="flex gap-2 items-center text-[10px] text-slate-400 font-bold pl-4 mt-0.5">
                  <span className="flex items-center text-amber-500 gap-0.5">
                    <Star className="w-3.5 h-3.5 fill-current" />
                    <span>{item.rating} 分</span>
                  </span>
                  <span>•</span>
                  <span className="text-brand-primary">{item.hot}</span>
                </div>

                <p className="text-xs text-slate-500 line-clamp-2 mt-2 leading-relaxed pl-4">
                  {item.desc}
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-slate-200/40">
                <button
                  onClick={() => onSearchQuery(item.title.split(" (")[0])}
                  className="px-2.5 py-1.5 rounded-lg text-[10px] font-black text-slate-500 hover:text-brand-primary hover:bg-brand-primary/5 transition-all flex items-center gap-1 border border-slate-100"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>影视检索</span>
                </button>

                <button
                  onClick={() => onAddSubscription(item.title.split(" (")[0], item.category, item.poster)}
                  className="px-2.5 py-1.5 rounded-lg text-[10px] font-black bg-brand-primary text-white hover:bg-brand-primary-light hover:shadow-sm transition-all flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>一键订阅</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* RSS & Scraper notice bottom widget */}
      <div className="bg-white/50 backdrop-blur-md border border-white/40 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4 hover:bg-white/60 transition-all">
        <div className="flex gap-3 items-center text-left">
          <div className="w-10 h-10 rounded-full bg-brand-secondary-light/10 text-brand-secondary flex items-center justify-center shrink-0">
            <BookmarkCheck className="w-5.5 h-5.5" />
          </div>
          <div>
            <h4 className="text-xs font-black text-txt-dark">想看的新影视榜单中没有？</h4>
            <p className="text-[10px] text-slate-400 font-semibold leading-relaxed mt-0.5">
              您可以直接利用顶部的 磁力云端检索 或在 自动订阅 中配置私有 RSS 地址进行全自动轮询追踪。
            </p>
          </div>
        </div>
        <button
          onClick={() => onSearchQuery("")}
          className="bg-white/80 backdrop-blur-xs border border-white/60 hover:border-slate-300 text-slate-500 px-4 py-2 rounded-xl text-xs font-black tracking-wider flex items-center gap-1.5 shrink-0 transition-all active:scale-95 shadow-xs"
        >
          <span>立即前往磁力搜索</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

    </div>
  );
}
