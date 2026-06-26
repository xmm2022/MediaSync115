/**
 * 库入库徽章：渲染后端 explore/search 响应内嵌的 emby_status_map / feiniu_status_map。
 *
 * 后端 key 形如 "{media_type}:{tmdb_id}"（media_type ∈ movie|tv），值含
 * exists_in_emby/exists_in_feiniu 与 status。本组件把单个条目渲染为
 * "Emby 已入库" / "飞牛已入库" 绿标，或未入库黄标；服务未配置/请求失败时不显示。
 */
import React from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";

export interface BadgeStatus {
  emby?: { exists: boolean; status?: string };
  feiniu?: { exists: boolean; status?: string };
}

const HIDDEN_STATUSES = new Set(["not_configured", "request_failed", "cache_unavailable"]);

/** 构造与后端一致的 key："{media_type}:{tmdb_id}"，无 tmdb_id 返回 null。 */
export function buildBadgeKey(media_type?: string, tmdb_id?: number): string | null {
  const mt = (media_type || "").toLowerCase();
  if (mt !== "movie" && mt !== "tv") return null;
  const tid = tmdb_id ?? 0;
  if (!tid || tid <= 0) return null;
  return `${mt}:${tid}`;
}

/** 把后端某一路 status_map 合并进聚合表。 */
export function mergeStatusMap(
  agg: Record<string, BadgeStatus>,
  raw: Record<string, unknown> | undefined,
  source: "emby" | "feiniu",
) {
  if (!raw || typeof raw !== "object") return;
  for (const [key, val] of Object.entries(raw)) {
    if (!val || typeof val !== "object") continue;
    const v = val as Record<string, unknown>;
    const entry: BadgeStatus = agg[key] ?? {};
    if (source === "emby") {
      entry.emby = {
        exists: Boolean(v.exists_in_emby),
        status: typeof v.status === "string" ? v.status : undefined,
      };
    } else {
      entry.feiniu = {
        exists: Boolean(v.exists_in_feiniu),
        status: typeof v.status === "string" ? v.status : undefined,
      };
    }
    agg[key] = entry;
  }
}

export default function LibraryBadge({ status }: { status?: BadgeStatus }) {
  if (!status) return null;
  const badges: React.ReactNode[] = [];
  if (status.emby) {
    if (status.emby.exists) {
      badges.push(
        <span key="emby" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-200" title="Emby 已入库">
          <CheckCircle2 className="w-3 h-3" />
          <span>Emby</span>
        </span>,
      );
    } else if (status.emby.status && !HIDDEN_STATUSES.has(status.emby.status)) {
      badges.push(
        <span key="emby-miss" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200" title="Emby 未入库">
          <AlertCircle className="w-3 h-3" />
          <span>Emby</span>
        </span>,
      );
    }
  }
  if (status.feiniu) {
    if (status.feiniu.exists) {
      badges.push(
        <span key="feiniu" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold text-sky-700 bg-sky-100 border border-sky-200" title="飞牛已入库">
          <CheckCircle2 className="w-3 h-3" />
          <span>飞牛</span>
        </span>,
      );
    } else if (status.feiniu.status && !HIDDEN_STATUSES.has(status.feiniu.status)) {
      badges.push(
        <span key="feiniu-miss" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200" title="飞牛未入库">
          <AlertCircle className="w-3 h-3" />
          <span>飞牛</span>
        </span>,
      );
    }
  }
  if (badges.length === 0) return null;
  return <div className="flex gap-1 flex-wrap">{badges}</div>;
}