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
  links: {
    name: string;
    size: string;
    seeds?: number;
    pickcode?: string;
    url: string;
  }[];
}

export interface SubscriptionItem {
  id: string;
  title: string;
  poster: string;
  category: "Movie" | "TV" | "Anime";
  status: "subscribing" | "paused" | "completed";
  progress: string; // e.g., "第 12 集 / 共 24 集" or "全 1 集"
  lastUpdated: string;
  rssSource: string;
  autoTransfer: boolean;
  targetDirId: string;
}

export interface SyncDirectory {
  id: string;
  name: string;
  localPath: string;
  folderId115: string;
  targetClient: "emby" | "plex" | "jellyfin";
  status: "syncing" | "idle" | "scanning" | "error";
  speed: string; // e.g. "4.2 MB/s" or "0 KB/s"
  progress: number; // 0 to 100
  enabled: boolean;
  totalSize: string; // e.g. "84.2 TB"
  itemCount: number; // e.g. 5400
}

export interface AutomationRule {
  id: string;
  name: string;
  icon: string; // Lucide icon alias
  description: string;
  influence: string;
  savings: string;
  status: "active" | "idle" | "error";
  enabled: boolean;
  colorType: "primary" | "secondary" | "neutral";
}

export interface SyncLog {
  id: string;
  timestamp: string;
  level: "INFO" | "SUCCESS" | "WARN" | "ERROR";
  message: string;
}

export interface ChartDataPoint {
  name: string; // Day of week, e.g. "MON"
  generatedSTRM: number;
  apiRequests: number;
}
