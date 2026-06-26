/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { SyncDirectory, AutomationRule, SyncLog, ChartDataPoint } from "./types";

// Legacy mock data — not used by any active component (directories come from archive API).
// Kept for reference only.
export const initialDirectories: SyncDirectory[] = [
  {
    id: "dir-1",
    name: "4K精品电影库 (Movies)",
    localPath: "/volume1/Media/Movies",
    folderId115: "115203948512",
    targetClient: "emby",
    status: "syncing",
    speed: "-",
    progress: 75,
    enabled: true,
    totalSize: "-",
    itemCount: 0,
  },
  {
    id: "dir-2",
    name: "精品美剧&国剧 (TV Shows)",
    localPath: "/volume1/Media/TV",
    folderId115: "115204481085",
    targetClient: "feiniu",
    status: "idle",
    speed: "-",
    progress: 0,
    enabled: true,
    totalSize: "-",
    itemCount: 0,
  },
  {
    id: "dir-3",
    name: "热门动漫同步 (Animes)",
    localPath: "/volume1/Media/Animes",
    folderId115: "115205593190",
    targetClient: "emby",
    status: "scanning",
    speed: "-",
    progress: 34,
    enabled: true,
    totalSize: "-",
    itemCount: 0,
  },
  {
    id: "dir-4",
    name: "家庭私人相册与Vlog (Home Video)",
    localPath: "/volume1/Media/Family",
    folderId115: "115209930491",
    targetClient: "emby",
    status: "idle",
    speed: "-",
    progress: 0,
    enabled: false,
    totalSize: "-",
    itemCount: 0,
  }
];

export const initialRules: AutomationRule[] = [
  {
    id: "rule-1",
    name: "夜间智能增量高带宽模式 (Off-Peak Speed Boost)",
    icon: "Moon",
    description: "在凌晨 1:00 至上午 6:00 期间自动将同步并发数提高至 16 线程，最大化服务器与网盘的高速网络吞吐率，并在白天的峰值时刻按需平滑降速。",
    influence: "影响 12 个同步子目录",
    savings: "+150% 吞吐量",
    status: "active",
    enabled: true,
    colorType: "primary"
  },
  {
    id: "rule-2",
    name: "智能文件残影与垃圾清除 (Smart Deleted Purger)",
    icon: "Trash2",
    description: "根据 115 官方云端实时回收站及删除日志，自动将本地已不存在的视频 strm 软链接予以清理或剔出 Plex 数据刮削树，杜绝媒体库播放黑屏残留。",
    influence: "全自动静默运行",
    savings: "零延迟同步删除",
    status: "idle",
    enabled: true,
    colorType: "secondary"
  },
  {
    id: "rule-3",
    name: "Emby/Plex 媒体库增量秒级刷新 (Webhook Refresher)",
    icon: "BellRing",
    description: "当 strm 文件或媒体文件在本地更新完毕后，即时向绑定的多媒体客户端服务器发送 API 请求以快速进行单文件库同步刷新，无需全量库深度扫描重刮削。",
    influence: "每日至少节约 1.2 小时漫长扫库时间",
    savings: "秒级上架",
    status: "active",
    enabled: true,
    colorType: "primary"
  },
  {
    id: "rule-4",
    name: "115账号Cookies过期监控及微信推送 (Token Watchdog)",
    icon: "ShieldAlert",
    description: "当 115 账号凭证 UID/CID 发生变化或授权过期前，自动触发告警提示并在后台发送推送，防止自动同步链条中断。",
    influence: "安全防漏网守卫",
    savings: "安全无感",
    status: "idle",
    enabled: false,
    colorType: "neutral"
  }
];

export const syncChartData: ChartDataPoint[] = [
  { name: "MON", generatedSTRM: 145, apiRequests: 420 },
  { name: "TUE", generatedSTRM: 188, apiRequests: 512 },
  { name: "WED", generatedSTRM: 210, apiRequests: 620 },
  { name: "THU", generatedSTRM: 340, apiRequests: 890 }, // Day of the heavy scan
  { name: "FRI", generatedSTRM: 160, apiRequests: 480 },
  { name: "SAT", generatedSTRM: 120, apiRequests: 350 },
  { name: "SUN", generatedSTRM: 195, apiRequests: 530 }
];

export const initialLogs: SyncLog[] = [
  {
    id: "log-1",
    timestamp: "2026-06-23 08:34:01",
    level: "INFO",
    message: "MediaSync115 用户端挂载后台引擎初始化中..."
  },
  {
    id: "log-2",
    timestamp: "2026-06-23 08:34:02",
    level: "INFO",
    message: "尝试读取本地多媒体路径配置文件 /volume1/Media"
  },
  {
    id: "log-3",
    timestamp: "2026-06-23 08:34:04",
    level: "SUCCESS",
    message: "115 网盘账户认证建立成功，连接通道质量（延迟: 11ms - 快）"
  },
  {
    id: "log-4",
    timestamp: "2026-06-23 08:34:05",
    level: "INFO",
    message: "115 官方会员状态: 白金 VIP 会员 (可用容量: 115.4 TB / 150.0 TB), 协议验证正常."
  },
  {
    id: "log-5",
    timestamp: "2026-06-23 08:34:08",
    level: "INFO",
    message: "成功对接本地多媒体服务提供器: Emby Server 和 Plex Media Server ✅"
  },
  {
    id: "log-6",
    timestamp: "2026-06-23 08:42:15",
    level: "WARN",
    message: "115 API 请求过于密集触发全局冷却中，已配置自动延迟 1.5s 避让拉取..."
  },
  {
    id: "log-7",
    timestamp: "2026-06-23 08:42:17",
    level: "SUCCESS",
    message: "同步库【4K精品电影库 (Movies)】获取增量，在 115 根目录检索到 12 个新文件夹变更！"
  },
  {
    id: "log-8",
    timestamp: "2026-06-23 08:42:30",
    level: "SUCCESS",
    message: "扫描完成，创建物理串流中 -> /volume1/Media/Movies/Spider-Man.Across.the.Spider-Verse.2023.2160p.strm 已写入！"
  },
  {
    id: "log-9",
    timestamp: "2026-06-12 08:42:32",
    level: "INFO",
    message: "通知多媒体 Webhook：Emby 单文件夹 /Movies/Spider-Man 的刷新流程触发完毕..."
  }
];
