/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from "react";
import { SyncDirectory } from "../types";
import { syncChartData } from "../data";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from "recharts";
import { 
  ArrowUpRight, 
  Library, 
  TrendingUp, 
  TrendingDown, 
  CloudDownload, 
  FileCheck,
  Disc,
  ArrowRight
} from "lucide-react";

interface UsageTabProps {
  directories: SyncDirectory[];
}

export default function UsageTab({ directories }: UsageTabProps) {
  // Sort directories to find those that are active or top consumers
  const movieDir = directories.find(d => d.id === "dir-1") || directories[0];
  const tvDir = directories.find(d => d.id === "dir-2") || directories[1];
  const animeDir = directories.find(d => d.id === "dir-3") || directories[2];

  return (
    <div className="space-y-10">
      {/* Hero Section: Dynamic Summary */}
      <section className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div className="md:col-span-8 p-8 rounded-2xl bg-white/70 backdrop-blur-md border border-white/60 flex flex-col justify-between relative overflow-hidden shadow-xs hover:bg-white/85 transition-all">
          <div className="relative z-10 space-y-4">
            <span className="font-label text-xs font-bold tracking-widest text-brand-primary uppercase bg-brand-primary-light/10 px-3.5 py-1.5 rounded-full">
              周度同步简报 Weekly Insight
            </span>
            <h2 className="font-headline text-4xl font-bold leading-tight text-txt-dark">
              本周索引吞吐率较上周攀升了 <span className="text-brand-primary">12%</span>。
            </h2>
          </div>
          
          <div className="mt-8 flex gap-12 relative z-10/2 text-left">
            <div className="space-y-1">
              <p className="text-sm text-slate-400 font-medium">日均同步空间 (MB/s)</p>
              <p className="font-headline text-3xl font-extrabold text-txt-dark">14.2 MB/s</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-slate-400 font-medium">日均轮询文件对象</p>
              <p className="font-headline text-3xl font-extrabold text-txt-dark">420 次/秒</p>
            </div>
          </div>
          
          {/* Abstract Gradient Decor */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-brand-primary/10 to-transparent rounded-full -mr-20 -mt-20 blur-3xl" />
        </div>

        {/* Saved Bandwidth Green Block */}
        <div className="md:col-span-4 p-8 rounded-2xl bg-brand-primary text-white flex flex-col justify-between shadow-xl shadow-brand-primary/15 relative">
          <div className="flex justify-between items-start">
            <div className="p-3 bg-brand-primary-light/20 rounded-xl text-white">
              <CloudDownload className="w-8 h-8 text-brand-primary-light" />
            </div>
            <span className="text-white/50 hover:text-white cursor-pointer select-none">
              <ArrowUpRight className="w-5 h-5" />
            </span>
          </div>

          <div className="space-y-1.5 mt-8">
            <p className="font-headline text-5xl font-black text-brand-primary-light tracking-tight">-14.2 TB</p>
            <p className="text-xs text-green-100 font-medium leading-relaxed">
              本月通过 strm 物理链路节约的宽带流量与 NAS 本地存储空间消耗。
            </p>
          </div>
        </div>
      </section>

      {/* Usage Trends Section (Pulse Chart) */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h3 className="font-headline text-2xl font-bold text-txt-dark">接口轮询与同步趋势图 (Usage Trends)</h3>
            <p className="text-sm text-slate-500">7-Day Resource Comparison - 115 API 查询负载与本地物理 .strm 成谱对比</p>
          </div>
          
          {/* Legend Custom */}
          <div className="flex gap-4 text-xs font-semibold">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-brand-primary-light" />
              <span className="text-slate-500">strm 创建件数 ( items )</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-brand-secondary" />
              <span className="text-slate-500">网盘 API 轮询次数 ( loops )</span>
            </div>
          </div>
        </div>

        <div className="p-6 md:p-8 rounded-2xl bg-white/70 backdrop-blur-md border border-white/60 shadow-xs h-80 flex flex-col justify-between hover:bg-white/80 transition-all">
          <div className="w-full h-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={syncChartData}
                margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                barSize={12}
                barGap={4}
              >
                <XAxis 
                  dataKey="name" 
                  tickLine={false} 
                  axisLine={false}
                  tick={{ fill: "#64748b", fontSize: 10, fontWeight: "bold" }}
                />
                <YAxis 
                  tickLine={false} 
                  axisLine={false}
                  tick={{ fill: "#64748b", fontSize: 10 }}
                />
                <Tooltip
                  cursor={{ fill: "rgba(124, 58, 237, 0.05)" }}
                  contentStyle={{ 
                    borderRadius: "12px", 
                    border: "1px solid #f1f5f9", 
                    fontSize: "12px",
                    fontWeight: "500",
                    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.03)"
                  }}
                />
                <Bar 
                  dataKey="generatedSTRM" 
                  name="创建 strm (个)" 
                  fill="#7c3aed" 
                  radius={[4, 4, 0, 0]} 
                />
                <Bar 
                  dataKey="apiRequests" 
                  name="115 API 请求 (次)" 
                  fill="#3b82f6" 
                  radius={[4, 4, 0, 0]} 
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {/* Top Consumers Layout */}
      <section className="space-y-6">
        <h3 className="font-headline text-2xl font-bold text-txt-dark">库空间比重与活跃度 (Top Mappings)</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Movie mapping */}
          {movieDir && (
            <div className="bg-white/60 backdrop-blur-md border border-white/60 p-6 rounded-2xl flex flex-col justify-between hover:bg-white/80 transition-all">
              <div className="flex justify-between items-start">
                <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center text-brand-primary border border-slate-100">
                  <Library className="w-6 h-6" />
                </div>
                <div className="flex items-center text-xs font-bold text-red-600 bg-red-50 px-2 py-0.5 rounded">
                  <TrendingUp className="w-3.5 h-3.5 mr-0.5" />
                  +4% vs LW
                </div>
              </div>

              <div className="mt-8">
                <p className="text-xs text-slate-400 font-bold tracking-wider uppercase mb-1">MOVIES COLLECTION</p>
                <h4 className="font-headline text-lg font-extrabold text-txt-dark truncate">{movieDir.name}</h4>
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="font-headline text-2xl font-black text-txt-dark">84.2</span>
                  <span className="text-xs font-medium text-slate-500">TB 虚拟空间</span>
                </div>
                <div className="w-full bg-white h-2 rounded-full mt-4 overflow-hidden border border-slate-100">
                  <div className="bg-brand-primary h-full w-[75%]" />
                </div>
              </div>
            </div>
          )}

          {/* TV Shows Mapping */}
          {tvDir && (
            <div className="bg-white/60 backdrop-blur-md border border-white/60 p-6 rounded-2xl flex flex-col justify-between hover:bg-white/80 transition-all">
              <div className="flex justify-between items-start">
                <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center text-brand-secondary border border-slate-100">
                  <Disc className="w-6 h-6" />
                </div>
                <div className="flex items-center text-xs font-bold text-brand-primary bg-emerald-50 px-2 py-0.5 rounded">
                  <TrendingDown className="w-3.5 h-3.5 mr-0.5" />
                  -12% vs LW
                </div>
              </div>

              <div className="mt-8">
                <p className="text-xs text-slate-400 font-bold tracking-wider uppercase mb-1">TV DRAMA EPISODES</p>
                <h4 className="font-headline text-lg font-extrabold text-txt-dark truncate">{tvDir.name}</h4>
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="font-headline text-2xl font-black text-txt-dark">{tvDir.itemCount.toLocaleString()}</span>
                  <span className="text-xs font-medium text-slate-500">个 .strm 节点</span>
                </div>
                <div className="w-full bg-white h-2 rounded-full mt-4 overflow-hidden border border-slate-100">
                  <div className="bg-brand-secondary h-full w-[45%]" />
                </div>
              </div>
            </div>
          )}

          {/* Anime mapping */}
          {animeDir && (
            <div className="bg-white/60 backdrop-blur-md border border-white/60 p-6 rounded-2xl flex flex-col justify-between hover:bg-white/80 transition-all">
              <div className="flex justify-between items-start">
                <div className="w-12 h-12 rounded-xl bg-white flex items-center justify-center text-brand-primary border border-slate-100">
                  <FileCheck className="w-6 h-6" />
                </div>
                <div className="text-xs font-bold text-slate-500 px-2 py-0.5 rounded bg-white border border-slate-100">
                  稳定运行
                </div>
              </div>

              <div className="mt-8">
                <p className="text-xs text-slate-400 font-bold tracking-wider uppercase mb-1">ANIME DIRECTORIES</p>
                <h4 className="font-headline text-lg font-extrabold text-txt-dark truncate">{animeDir.name}</h4>
                <div className="flex items-baseline gap-1 mt-2">
                  <span className="font-headline text-2xl font-black text-txt-dark">52.0</span>
                  <span className="text-xs font-medium text-slate-500">TB 已建链接</span>
                </div>
                <div className="w-full bg-white h-2 rounded-full mt-4 overflow-hidden border border-slate-100">
                  <div className="bg-brand-primary h-full w-[60%]" />
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
