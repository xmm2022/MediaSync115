/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum PageName {
  DASHBOARD = "dashboard",
  SEARCH = "search",
  EXPLORE = "explore",
  SUBSCRIPTION = "subscription",
  USAGE = "usage",
  AUTOMATIONS = "automations",
  SETTINGS = "settings",
}

export interface MediaResource {
  id: string;
  title: string;
  poster: string;
  rating: number;
  year: number;
  category: "Movie" | "TV" | "Anime";
  description: string;
  tags: string[];
  links: MediaResourceLink[];
  // Fields for real backend API (search/explore + transfer)
  tmdb_id?: number;
  media_type?: "movie" | "tv" | "collection";
}

export interface MediaResourceLink {
  name: string;
  size: string;
  seeds?: number;
  pickcode?: string;
  url: string;
  /** Raw 115 share link used for transfer */
  shareUrl?: string;
  /** Receive code extracted from share link */
  receiveCode?: string;
  /** 资源来源服务标识(115/quark/pansou/hdhive/tg/seedhub/butailing) */
  sourceService?: string;
  /** 资源分辨率/编码标记(后端返回 resolution) */
  resolution?: string;
  /** HDHive 资源 slug，用于解锁 */
  slug?: string;
  /** HDHive 资源是否已解锁(后端返回) */
  unlocked?: boolean;
  /** 原始磁力链接(磁力来源) */
  magnetUrl?: string;
}

/**
 * 同步目录卡片 — 从后端 archive API 组合派生。
 *
 * 字段来源对照（诚实标注，无对应字段不编造）：
 *   id          ← ArchiveFolder.cid
 *   name        ← ArchiveFolder.name
 *   localPath   ← ArchiveConfig.archive_watch_cid（后端无"本地路径"概念，此处存监听 CID）
 *   folderId115 ← ArchiveFolder.cid
 *   targetClient ← 后端仅支持 emby/feiniu（全局 runtime settings），plex/jellyfin 无后端对应
 *   status      ← ArchiveTask.status 派生（archiving→syncing, 无任务→idle, failed→error）
 *   speed       ← 后端无实时速度字段，显示 "-"
 *   progress    ← 如有活跃 ArchiveTask 可派生进度，否则 0
 *   enabled     ← ArchiveConfig.archive_enabled（全局开关，非按目录）
 *   totalSize   ← 后端无此字段，显示 "-"
 *   itemCount   ← ArchiveFolder 接口当前不返回项数，显示 0
 */
export interface SyncDirectory {
  id: string;
  name: string;
  localPath: string;
  folderId115: string;
  targetClient: "emby" | "plex" | "jellyfin" | "feiniu";
  status: "syncing" | "idle" | "scanning" | "error";
  speed: string; // e.g. "4.2 MB/s" or "0 KB/s" — 后端无此字段，显示 "-"
  progress: number; // 0 to 100 — 从 ArchiveTask 派生，无任务时 0
  enabled: boolean;
  totalSize: string; // e.g. "84.2 TB" — 后端无此字段，显示 "-"
  itemCount: number; // e.g. 5400 — 后端 ArchiveFolder 不返回项数，显示 0
}

export interface SyncLog {
  id: string;
  timestamp: string;
  level: "INFO" | "SUCCESS" | "WARN" | "ERROR";
  message: string;
}

