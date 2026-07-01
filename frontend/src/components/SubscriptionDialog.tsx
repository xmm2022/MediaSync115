/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  CheckCircle,
  Cloud,
  Download,
  Eye,
  File,
  FileVideo,
  ExternalLink,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Rss,
  Shield,
  Tv,
  X,
} from "lucide-react";
import { moviepilotApi } from "../api/moviepilot";
import { pan115Api } from "../api/pan115";
import { searchApi } from "../api/search";
import { subscriptionApi } from "../api/subscription";
import type { MediaResourceLink } from "../types";

export type SubscriptionChannel = "pan115" | "quark" | "pt";

type TvScope = "all" | "season" | "episode";
type Pan115SourceKey = "pansou" | "hdhive" | "tg" | "manual";

interface TmdbSeason {
  season_number: number;
  name: string;
  episode_count: number;
}

interface TmdbDetail {
  poster_path?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
}

interface SubscriptionDialogProps {
  open: boolean;
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  defaultPoster?: string;
  detail?: TmdbDetail | null;
  seasons?: TmdbSeason[];
  pan115SubId: string | null;
  ptSubId: string | null;
  pan115DefaultFolderName: string;
  quarkDefaultFolderName: string;
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => Promise<void>;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
}

interface ResourceLinkRaw {
  title?: string;
  name?: string;
  torrent_name?: string;
  subtitle?: string;
  size?: string | number;
  size_text?: string;
  seeds?: number;
  seeders?: number;
  pick_code?: string;
  pickcode?: string;
  share_link?: string;
  share_url?: string;
  url?: string;
  link?: string;
  download_url?: string;
  torrent_url?: string;
  receive_code?: string;
  access_code?: string;
  source_service?: string;
  site?: string;
  site_name?: string;
  resolution?: string;
  slug?: string;
  unlocked?: boolean;
  magnet?: string;
  magnet_url?: string;
  info_hash?: string;
}

interface Pan115Resource extends MediaResourceLink {
  sourceKey: Pan115SourceKey;
  sourceLabel: string;
}

interface SourceState {
  loading: boolean;
  loaded: boolean;
  error: string;
  items: Pan115Resource[];
}

interface SharePreviewFile {
  id?: string | number;
  file_id?: string | number;
  fid?: string | number;
  cid?: string | number;
  name?: string;
  file_name?: string;
  n?: string;
  title?: string;
  path?: string;
  parent_path?: string;
  size?: string | number;
  s?: string | number;
  file_size?: string | number;
  size_text?: string;
  sizeText?: string;
  is_video?: boolean | number | string;
  is_dir?: boolean | number | string;
  is_directory?: boolean | number | string;
  [key: string]: unknown;
}

interface SharePreviewState {
  loading: boolean;
  loaded: boolean;
  error: string;
  files: SharePreviewFile[];
  totalCount: number;
  videoCount: number;
}

interface TvMissingPreviewState {
  loading: boolean;
  loaded: boolean;
  status: string;
  message: string;
  missingEpisodeKeys: Set<string>;
  counts: {
    aired?: number;
    existing?: number;
    missing?: number;
  };
}

interface MoviePilotTorrent {
  key: string;
  title: string;
  size: string;
  site: string;
  seeders?: number;
  pubdate: string;
  pageUrl: string;
  enclosure: string;
  freeLabel: string;
  raw: Record<string, unknown>;
}

const SOURCE_META: { key: Pan115SourceKey; label: string; desc: string }[] = [
  { key: "pansou", label: "Pansou", desc: "聚合 115 分享" },
  { key: "hdhive", label: "HDHive", desc: "需解锁后可用" },
  { key: "tg", label: "TG", desc: "频道聚合资源" },
  { key: "manual", label: "固定链接", desc: "手动粘贴分享" },
];

const emptySourceState = (): SourceState => ({
  loading: false,
  loaded: false,
  error: "",
  items: [],
});

const emptySharePreviewState = (): SharePreviewState => ({
  loading: false,
  loaded: false,
  error: "",
  files: [],
  totalCount: 0,
  videoCount: 0,
});

const emptyTvMissingPreviewState = (): TvMissingPreviewState => ({
  loading: false,
  loaded: false,
  status: "",
  message: "",
  missingEpisodeKeys: new Set<string>(),
  counts: {},
});

const VIDEO_FILE_PATTERN = /\.(?:mkv|mp4|m4v|avi|mov|wmv|flv|webm|rmvb|ts|m2ts|iso)$/i;

function formatSizeValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 1024 ** 4) return `${(value / (1024 ** 4)).toFixed(1)} TB`;
    if (value >= 1024 ** 3) return `${(value / (1024 ** 3)).toFixed(1)} GB`;
    if (value >= 1024 ** 2) return `${(value / (1024 ** 2)).toFixed(1)} MB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${value} B`;
  }
  const text = String(value || "").trim();
  return text || "未知";
}

function extractResourceLinks(rawData: unknown): ResourceLinkRaw[] {
  if (Array.isArray(rawData)) return rawData as ResourceLinkRaw[];
  if (!rawData || typeof rawData !== "object") return [];
  const payload = rawData as Record<string, unknown>;
  return (payload.list as ResourceLinkRaw[])
    || (payload.items as ResourceLinkRaw[])
    || (payload.resources as ResourceLinkRaw[])
    || (payload.links as ResourceLinkRaw[])
    || [];
}

function mapPan115Links(rawData: unknown, sourceKey: Pan115SourceKey, sourceLabel: string): Pan115Resource[] {
  return extractResourceLinks(rawData).map((rl) => {
    const shareUrl = rl.share_link || rl.share_url || rl.url || rl.link || "";
    const receiveMatch = String(shareUrl).match(/[?&](?:password|pwd|receive_code)=([^&#]+)/i);
    return {
      name: rl.title || rl.name || rl.torrent_name || rl.subtitle || "未命名资源",
      size: typeof rl.size === "number" ? formatSizeValue(rl.size) : String(rl.size_text || rl.size || "未知"),
      seeds: rl.seeds ?? rl.seeders,
      pickcode: rl.pick_code || rl.pickcode,
      url: shareUrl || rl.download_url || rl.torrent_url || "",
      shareUrl,
      receiveCode: rl.receive_code || rl.access_code || (receiveMatch ? decodeURIComponent(receiveMatch[1]) : ""),
      sourceService: rl.source_service || rl.site_name || rl.site || sourceLabel,
      resolution: rl.resolution,
      slug: rl.slug,
      unlocked: rl.unlocked,
      sourceKey,
      sourceLabel,
    };
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return undefined;
}

function isTruthyFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  const text = String(value ?? "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes";
}

function findSharePreviewFiles(rawData: unknown): SharePreviewFile[] {
  if (Array.isArray(rawData)) return rawData.filter((item) => typeof item === "object" && item !== null) as SharePreviewFile[];
  const payload = asRecord(rawData);
  const data = asRecord(payload.data);
  for (const container of [payload, data]) {
    for (const key of ["list", "items", "files", "resources"]) {
      const value = container[key];
      if (Array.isArray(value)) {
        return value.filter((item) => typeof item === "object" && item !== null) as SharePreviewFile[];
      }
    }
  }
  return [];
}

function extractSharePreview(rawData: unknown): Pick<SharePreviewState, "files" | "totalCount" | "videoCount"> {
  const payload = asRecord(rawData);
  const data = asRecord(payload.data);
  const files = findSharePreviewFiles(rawData);
  const computedVideoCount = files.filter(isPreviewVideoFile).length;
  return {
    files,
    totalCount: firstNumber(payload.total_count, payload.total, data.total_count, data.total, files.length) ?? files.length,
    videoCount: firstNumber(payload.video_count, data.video_count, computedVideoCount) ?? computedVideoCount,
  };
}

function previewFileName(file: SharePreviewFile): string {
  return firstText(file.name, file.file_name, file.n, file.title, "未命名文件");
}

function previewFileKey(file: SharePreviewFile, index: number): string {
  return firstText(file.id, file.file_id, file.fid, file.cid, file.path, file.name, String(index));
}

function previewFileId(file: SharePreviewFile): string {
  return firstText(file.fid, file.file_id, file.id);
}

function previewFileSizeText(file: SharePreviewFile): string {
  const explicit = firstText(file.size_text, file.sizeText);
  if (explicit) return explicit;
  return formatSizeValue(file.size ?? file.s ?? file.file_size);
}

function previewFileSizeBytes(file: SharePreviewFile): number {
  const raw = file.size ?? file.s ?? file.file_size ?? file.size_text ?? file.sizeText;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const text = String(raw || "").replace(/,/g, "").trim();
  const match = text.match(/^([\d.]+)\s*(tb|gb|mb|kb|b|t|g|m|k)?/i);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  const unit = (match[2] || "b").toLowerCase();
  if (unit === "tb" || unit === "t") return value * 1024 ** 4;
  if (unit === "gb" || unit === "g") return value * 1024 ** 3;
  if (unit === "mb" || unit === "m") return value * 1024 ** 2;
  if (unit === "kb" || unit === "k") return value * 1024;
  return value;
}

function episodeKey(season: number, episode: number): string {
  return `${season}:${episode}`;
}

function formatEpisodeLabel(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function parsePreviewEpisode(fileName: string): { season: number; episode: number } | null {
  const cleanName = String(fileName || "")
    .replace(/\[.*?\]/g, "")
    .replace(/\{.*?\}/g, "")
    .replace(/\(.*?\)/g, "");
  let match = cleanName.match(/S(\d+)\s*E(\d+)/i);
  if (match) return { season: Number(match[1]), episode: Number(match[2]) };
  match = cleanName.match(/第(\d+)季.*?第(\d+)集/);
  if (match) return { season: Number(match[1]), episode: Number(match[2]) };
  match = cleanName.match(/第(\d+)集/);
  if (match) return { season: 1, episode: Number(match[1]) };
  match = cleanName.match(/EP?(\d+)/i);
  if (match) return { season: 1, episode: Number(match[1]) };
  match = cleanName.match(/(?:[-_ ]|^\s*)(\d{1,4})\s*(?:\.mp4|\.mkv|\.avi|\.ts|\.rmvb|\.flv|\.m4v|\.webm)/i);
  if (match) return { season: 1, episode: Number(match[1]) };
  return null;
}

function extractMissingEpisodeKeys(rawData: unknown): Set<string> {
  const payload = asRecord(rawData);
  const keys = new Set<string>();
  const pairs = Array.isArray(payload.missing_episodes) ? payload.missing_episodes : [];
  pairs.forEach((pair) => {
    if (!Array.isArray(pair) || pair.length !== 2) return;
    const season = Number(pair[0]);
    const episode = Number(pair[1]);
    if (Number.isFinite(season) && Number.isFinite(episode)) {
      keys.add(episodeKey(season, episode));
    }
  });
  return keys;
}

function isPreviewDirectory(file: SharePreviewFile): boolean {
  return isTruthyFlag(file.is_dir) || isTruthyFlag(file.is_directory);
}

function isPreviewVideoFile(file: SharePreviewFile): boolean {
  return isTruthyFlag(file.is_video) || VIDEO_FILE_PATTERN.test(previewFileName(file));
}

function scorePreviewVideoFile(file: SharePreviewFile): number {
  const name = previewFileName(file).toLowerCase();
  let score = previewFileSizeBytes(file);
  for (const [value, pattern] of [
    [8000, /\b(?:8k|4320p)\b/],
    [4000, /\b(?:4k|2160p|uhd)\b/],
    [3000, /\b(?:1440p|2k|qhd)\b/],
    [2000, /\b(?:1080p|fhd|full\s*hd)\b/],
    [1000, /\b720p\b/],
  ] as const) {
    if (pattern.test(name)) {
      score += value * 1_000_000_000;
      break;
    }
  }
  if (/\b(?:remux|bdremux)\b/.test(name)) score += 500_000_000;
  else if (/\b(?:bluray|blu-ray|bdrip|bd)\b/.test(name)) score += 400_000_000;
  else if (/\bweb[-.\s]?dl\b/.test(name)) score += 300_000_000;
  if (/\b(?:sample|trailer|preview|预告|样片|片段)\b/.test(name)) score -= 10_000_000_000_000;
  return score;
}

function SharePreviewPanel({
  preview,
  missingEpisodeKeys,
  missingStatusAvailable = false,
  selectedFileIds,
  onToggleSelected,
  onSelectFileIds,
}: {
  preview?: SharePreviewState;
  missingEpisodeKeys?: Set<string>;
  missingStatusAvailable?: boolean;
  selectedFileIds?: Set<string>;
  onToggleSelected?: (fileId: string) => void;
  onSelectFileIds?: (fileIds: string[]) => void;
}) {
  if (!preview) return null;
  if (preview.loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[10px] font-bold" style={{ background: "var(--surface)", color: "var(--txt-muted)", border: "1px solid var(--border)" }}>
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        正在读取分享文件...
      </div>
    );
  }
  if (preview.error) {
    return (
      <div className="flex items-start gap-2 rounded-lg px-2.5 py-2 text-[10px] font-bold" style={{ background: "rgba(239,68,68,0.08)", color: "var(--accent-danger)", border: "1px solid rgba(239,68,68,0.24)" }}>
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 break-words">{preview.error}</span>
      </div>
    );
  }
  if (!preview.loaded) return null;

  const videoFiles = preview.files.filter(isPreviewVideoFile);
  const missingVideoFiles = videoFiles.filter((file) => {
    const parsed = parsePreviewEpisode(previewFileName(file));
    return parsed && missingEpisodeKeys?.has(episodeKey(parsed.season, parsed.episode));
  });
  const missingVideoIds = missingVideoFiles.map(previewFileId).filter(Boolean);
  const bestCandidates = missingVideoFiles.length > 0 ? missingVideoFiles : videoFiles;
  const bestVideo = bestCandidates.length > 0
    ? [...bestCandidates].sort((a, b) => scorePreviewVideoFile(b) - scorePreviewVideoFile(a))[0]
    : null;
  const visibleFiles = preview.files.slice(0, 6);
  const matchedMissingCount = missingVideoFiles.length;

  return (
    <div className="rounded-lg p-2.5 space-y-2" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-black" style={{ color: "var(--txt-secondary)" }}>
          <FileVideo className="h-3.5 w-3.5" style={{ color: "var(--brand-primary)" }} />
          <span>{preview.totalCount} 个文件</span>
          <span style={{ color: "var(--txt-muted)" }}>·</span>
          <span>{preview.videoCount} 个视频</span>
          {missingStatusAvailable && (
            <>
              <span style={{ color: "var(--txt-muted)" }}>·</span>
              <span style={{ color: matchedMissingCount > 0 ? "var(--accent-ok)" : "var(--txt-muted)" }}>命中缺集 {matchedMissingCount}</span>
            </>
          )}
          {selectedFileIds && selectedFileIds.size > 0 && (
            <>
              <span style={{ color: "var(--txt-muted)" }}>·</span>
              <span style={{ color: "var(--brand-primary)" }}>已选 {selectedFileIds.size}</span>
            </>
          )}
        </div>
        {missingVideoIds.length > 0 && onSelectFileIds && (
          <button type="button" onClick={() => onSelectFileIds(missingVideoIds)} className="rounded-md px-2 py-1 text-[9px] font-black glass-hover" style={{ color: "var(--accent-ok)", border: "1px solid rgba(34,197,94,0.28)" }}>
            选中命中缺集
          </button>
        )}
      </div>
      {bestVideo && (
        <div className="min-w-0 rounded-md px-2 py-1.5 text-[10px] font-bold" style={{ background: "var(--brand-primary-bg-alpha)", color: "var(--brand-primary)", border: "1px solid var(--brand-primary-border-alpha)" }}>
          <span className="block truncate">{missingVideoFiles.length > 0 ? "优先缺集视频" : "优先视频"}：{previewFileName(bestVideo)}</span>
          <span className="mt-0.5 block text-[9px]" style={{ color: "var(--txt-muted)" }}>{previewFileSizeText(bestVideo)}</span>
        </div>
      )}
      {visibleFiles.length === 0 ? (
        <p className="text-[10px] font-semibold" style={{ color: "var(--txt-muted)" }}>分享中未解析到文件。</p>
      ) : (
        <div className="space-y-1">
          {visibleFiles.map((file, index) => {
            const isDir = isPreviewDirectory(file);
            const isVideo = isPreviewVideoFile(file);
            const fileId = previewFileId(file);
            const selectable = Boolean(fileId && isVideo && onToggleSelected);
            const checked = Boolean(fileId && selectedFileIds?.has(fileId));
            const parsedEpisode = isVideo ? parsePreviewEpisode(previewFileName(file)) : null;
            const parsedKey = parsedEpisode ? episodeKey(parsedEpisode.season, parsedEpisode.episode) : "";
            const hitMissing = Boolean(parsedKey && missingEpisodeKeys?.has(parsedKey));
            const Icon = isDir ? FolderOpen : isVideo ? FileVideo : File;
            return (
              <div key={previewFileKey(file, index)} className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5" style={{ background: "var(--surface-subtle)" }}>
                {selectable && (
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleSelected?.(fileId)}
                    className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--brand-primary)]"
                    aria-label={`选择 ${previewFileName(file)}`}
                  />
                )}
                <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: isVideo ? "var(--brand-primary)" : "var(--txt-muted)" }} />
                <span className="min-w-0 flex-1 truncate text-[10px] font-semibold" style={{ color: "var(--txt)" }}>{previewFileName(file)}</span>
                {parsedEpisode && (
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[8px] font-black" style={hitMissing ? { background: "rgba(34,197,94,0.16)", color: "var(--accent-ok)" } : { background: "var(--surface)", color: "var(--txt-muted)" }}>
                    {formatEpisodeLabel(parsedEpisode.season, parsedEpisode.episode)}{missingStatusAvailable ? (hitMissing ? " 缺" : " 非缺") : ""}
                  </span>
                )}
                {isVideo && !parsedEpisode && missingStatusAvailable && (
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[8px] font-black" style={{ background: "rgba(245,158,11,0.14)", color: "var(--accent-warn)" }}>
                    未识别
                  </span>
                )}
                {!isDir && <span className="shrink-0 text-[9px] font-bold" style={{ color: "var(--txt-muted)" }}>{previewFileSizeText(file)}</span>}
              </div>
            );
          })}
        </div>
      )}
      {preview.files.length > visibleFiles.length && (
        <p className="text-[9px] font-bold" style={{ color: "var(--txt-muted)" }}>还有 {preview.files.length - visibleFiles.length} 个文件未展开</p>
      )}
    </div>
  );
}

function mapMoviePilotItems(rawData: unknown): MoviePilotTorrent[] {
  const payload = asRecord(rawData);
  const rows = Array.isArray(payload.items) ? payload.items : (Array.isArray(rawData) ? rawData : []);
  return rows.map((row, idx) => {
    const item = asRecord(row);
    const torrent = asRecord(item.torrent_info || item.torrent || item);
    const meta = asRecord(item.meta_info || item.meta || {});
    const media = asRecord(item.media_info || item.media || {});
    const title = firstText(torrent.title, torrent.name, torrent.torrent_name, meta.name, media.title, item.title, `PT 资源 ${idx + 1}`);
    const enclosure = firstText(torrent.enclosure, torrent.torrent_url, torrent.download_url, torrent.url, item.enclosure, item.torrent_url);
    const pageUrl = firstText(torrent.page_url, torrent.detail_url, item.page_url, item.detail_url);
    const site = firstText(torrent.site_name, torrent.source, item.source, torrent.site, "MoviePilot");
    const downloadFactor = firstNumber(torrent.downloadvolumefactor, torrent.download_volume_factor, item.downloadvolumefactor);
    const uploadFactor = firstNumber(torrent.uploadvolumefactor, torrent.upload_volume_factor, item.uploadvolumefactor);
    const freeLabel = downloadFactor === 0 ? "免费" : (downloadFactor && downloadFactor < 1 ? `${downloadFactor}x` : "");
    return {
      key: enclosure || pageUrl || `${title}-${idx}`,
      title,
      size: formatSizeValue(torrent.size ?? item.size),
      site,
      seeders: firstNumber(torrent.seeders, torrent.seeds, item.seeders, item.seeds),
      pubdate: firstText(torrent.pubdate, item.pubdate, torrent.date_elapsed),
      pageUrl,
      enclosure,
      freeLabel: freeLabel || (uploadFactor && uploadFactor > 1 ? `上传 ${uploadFactor}x` : ""),
      raw: item,
    };
  });
}

function posterUrl(path: string | undefined, size = "w185"): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

export default function SubscriptionDialog({
  open,
  tmdbId,
  mediaType,
  title,
  defaultPoster,
  detail,
  seasons = [],
  pan115SubId,
  ptSubId,
  pan115DefaultFolderName,
  quarkDefaultFolderName,
  addLog,
  onClose,
  onChanged,
}: SubscriptionDialogProps) {
  const [channel, setChannel] = useState<SubscriptionChannel>("pan115");
  const [selectedSources, setSelectedSources] = useState<Pan115SourceKey[]>(["pansou", "hdhive"]);
  const [sourceState, setSourceState] = useState<Record<Pan115SourceKey, SourceState>>({
    pansou: emptySourceState(),
    hdhive: emptySourceState(),
    tg: emptySourceState(),
    manual: emptySourceState(),
  });
  const [selectedPan115Key, setSelectedPan115Key] = useState("");
  const [manualShareUrl, setManualShareUrl] = useState("");
  const [manualReceiveCode, setManualReceiveCode] = useState("");
  const [manualDisplayName, setManualDisplayName] = useState("");
  const [ptItems, setPtItems] = useState<MoviePilotTorrent[]>([]);
  const [ptLoading, setPtLoading] = useState(false);
  const [ptLoaded, setPtLoaded] = useState(false);
  const [ptError, setPtError] = useState("");
  const [selectedPtKey, setSelectedPtKey] = useState("");
  const [previewByKey, setPreviewByKey] = useState<Record<string, SharePreviewState>>({});
  const [selectedPreviewFileIds, setSelectedPreviewFileIds] = useState<Record<string, Set<string>>>({});
  const [tvMissingPreview, setTvMissingPreview] = useState<TvMissingPreviewState>(emptyTvMissingPreviewState());
  const [submitting, setSubmitting] = useState(false);
  const [transferringKey, setTransferringKey] = useState("");
  const [unlockingSlug, setUnlockingSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [tvScope, setTvScope] = useState<TvScope>("all");
  const [tvSeasonNumber, setTvSeasonNumber] = useState<number>(1);
  const [tvEpisodeStart, setTvEpisodeStart] = useState<number | "">("");
  const [tvEpisodeEnd, setTvEpisodeEnd] = useState<number | "">("");

  const isPan115Subscribed = pan115SubId !== null;
  const isPtSubscribed = ptSubId !== null;
  const poster = posterUrl(detail?.poster_path || defaultPoster);
  const year = detail?.release_date?.split("-")[0] || detail?.first_air_date?.split("-")[0] || "";
  const rating = typeof detail?.vote_average === "number" ? detail.vote_average.toFixed(1) : "";

  const resources = useMemo(
    () => selectedSources.flatMap((source) => sourceState[source]?.items || []),
    [selectedSources, sourceState],
  );
  const selectedResource = useMemo(
    () => resources.find((item) => `${item.sourceKey}:${item.shareUrl || item.url}` === selectedPan115Key),
    [resources, selectedPan115Key],
  );
  const selectedPtItem = useMemo(
    () => ptItems.find((item) => item.key === selectedPtKey),
    [ptItems, selectedPtKey],
  );
  const manualPreviewKey = useMemo(
    () => `manual:${manualShareUrl.trim()}:${manualReceiveCode.trim()}`,
    [manualReceiveCode, manualShareUrl],
  );
  const tvMissingStatusAvailable = mediaType === "tv" && tvMissingPreview.loaded && tvMissingPreview.status === "ok";

  const buildTvParams = () => {
    if (mediaType !== "tv" || tvScope === "all") return {};
    if (tvScope === "season") {
      return { tv_scope: "season", tv_season_number: tvSeasonNumber };
    }
    return {
      tv_scope: "episode_range",
      tv_season_number: tvSeasonNumber,
      ...(tvEpisodeStart !== "" ? { tv_episode_start: Number(tvEpisodeStart) } : {}),
      ...(tvEpisodeEnd !== "" ? { tv_episode_end: Number(tvEpisodeEnd) } : {}),
    };
  };

  const resetLoadedPan115Resources = () => {
    setSourceState((prev) => ({
      ...prev,
      pansou: emptySourceState(),
      hdhive: emptySourceState(),
      tg: emptySourceState(),
    }));
    setPreviewByKey({});
    setSelectedPreviewFileIds({});
    setSelectedPan115Key((current) => (current === "manual" ? current : ""));
  };

  const resetState = () => {
    setChannel("pan115");
    setSelectedSources(["pansou", "hdhive"]);
    setSourceState({
      pansou: emptySourceState(),
      hdhive: emptySourceState(),
      tg: emptySourceState(),
      manual: emptySourceState(),
    });
    setSelectedPan115Key("");
    setManualShareUrl("");
    setManualReceiveCode("");
    setManualDisplayName("");
    setPtItems([]);
    setPtLoading(false);
    setPtLoaded(false);
    setPtError("");
    setSelectedPtKey("");
    setPreviewByKey({});
    setSelectedPreviewFileIds({});
    setTvMissingPreview(emptyTvMissingPreviewState());
    setSubmitting(false);
    setTransferringKey("");
    setUnlockingSlug("");
    setError(null);
    setInfo(null);
    setTvScope("all");
    setTvSeasonNumber(seasons.find((s) => s.season_number > 0)?.season_number ?? 1);
    setTvEpisodeStart("");
    setTvEpisodeEnd("");
  };

  useEffect(() => {
    if (open) resetState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tmdbId]);

  const fetchPan115Source = async (source: Pan115SourceKey) => {
    if (source === "manual") return;
    const current = sourceState[source];
    if (current.loading || current.loaded) return;
    const sourceLabel = SOURCE_META.find((item) => item.key === source)?.label || source;
    setSourceState((prev) => ({
      ...prev,
      [source]: { ...prev[source], loading: true, error: "" },
    }));
    try {
      const season = mediaType === "tv" && tvScope !== "all" ? tvSeasonNumber : null;
      let response: { data: unknown };
      if (source === "pansou") {
        response = mediaType === "movie"
          ? await searchApi.getMoviePan115Pansou(tmdbId)
          : await searchApi.getTvPan115Pansou(tmdbId, 1, false, season);
      } else if (source === "hdhive") {
        response = mediaType === "movie"
          ? await searchApi.getMoviePan115Hdhive(tmdbId)
          : await searchApi.getTvPan115Hdhive(tmdbId, 1, false, season);
      } else {
        response = mediaType === "movie"
          ? await searchApi.getMoviePan115Tg(tmdbId)
          : await searchApi.getTvPan115Tg(tmdbId, 1, false, season);
      }
      setSourceState((prev) => ({
        ...prev,
        [source]: {
          loading: false,
          loaded: true,
          error: "",
          items: mapPan115Links(response.data, source, sourceLabel),
        },
      }));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
      setSourceState((prev) => ({
        ...prev,
        [source]: { ...prev[source], loading: false, loaded: true, error: msg, items: [] },
      }));
    }
  };

  useEffect(() => {
    if (!open || channel !== "pan115") return;
    selectedSources.forEach((source) => {
      void fetchPan115Source(source);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channel, selectedSources, tvScope, tvSeasonNumber]);

  const fetchPtItems = async (force = false) => {
    if (ptLoading || (ptLoaded && !force)) return;
    setPtLoading(true);
    setPtError("");
    try {
      const response = await moviepilotApi.search(title);
      setPtItems(mapMoviePilotItems(response.data));
      setPtLoaded(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
      setPtError(msg);
      setPtLoaded(true);
    } finally {
      setPtLoading(false);
    }
  };

  useEffect(() => {
    if (open && channel === "pt") void fetchPtItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channel]);

  const fetchTvMissingPreview = async (force = false) => {
    if (mediaType !== "tv" || !tmdbId) return;
    if (tvMissingPreview.loading && !force) return;
    const scope = tvScope === "episode" ? "episode_range" : tvScope;
    const params: Record<string, unknown> = {
      tv_scope: scope,
      tv_follow_mode: "missing",
      tv_include_specials: false,
      refresh: force,
    };
    if (scope !== "all") {
      params.tv_season_number = tvSeasonNumber;
    }
    if (scope === "episode_range") {
      if (tvEpisodeStart !== "") params.tv_episode_start = Number(tvEpisodeStart);
      if (tvEpisodeEnd !== "") params.tv_episode_end = Number(tvEpisodeEnd);
    }

    setTvMissingPreview((prev) => ({ ...prev, loading: true }));
    try {
      const response = await subscriptionApi.getTvMissingPreview(tmdbId, params);
      const payload = asRecord(response.data);
      const counts = asRecord(payload.counts);
      setTvMissingPreview({
        loading: false,
        loaded: true,
        status: firstText(payload.status),
        message: firstText(payload.message),
        missingEpisodeKeys: extractMissingEpisodeKeys(payload),
        counts: {
          aired: firstNumber(counts.aired),
          existing: firstNumber(counts.existing),
          missing: firstNumber(counts.missing),
        },
      });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
      setTvMissingPreview({
        ...emptyTvMissingPreviewState(),
        loaded: true,
        status: "error",
        message: msg,
      });
    }
  };

  useEffect(() => {
    if (!open || channel !== "pan115" || mediaType !== "tv") {
      setTvMissingPreview(emptyTvMissingPreviewState());
      return;
    }
    void fetchTvMissingPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channel, mediaType, tmdbId, tvScope, tvSeasonNumber, tvEpisodeStart, tvEpisodeEnd]);

  const toggleSource = (source: Pan115SourceKey) => {
    setSelectedSources((prev) => {
      const exists = prev.includes(source);
      const next = exists ? prev.filter((item) => item !== source) : [...prev, source];
      if (exists && source !== "manual" && selectedPan115Key.startsWith(`${source}:`)) {
        setSelectedPan115Key("");
      }
      return next;
    });
  };

  const handleUnlock = async (resource: Pan115Resource) => {
    if (!resource.slug) return;
    setUnlockingSlug(resource.slug);
    setError(null);
    try {
      await searchApi.unlockHdhiveResource(resource.slug);
      setSourceState((prev) => ({
        ...prev,
        [resource.sourceKey]: {
          ...prev[resource.sourceKey],
          items: prev[resource.sourceKey].items.map((item) => (
            item.slug === resource.slug ? { ...item, unlocked: true } : item
          )),
        },
      }));
      await addLog("SUCCESS", `HDHive 已解锁: ${resource.name}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
      setError(`解锁失败: ${msg}`);
    } finally {
      setUnlockingSlug("");
    }
  };

  const selectPreviewFileIds = (previewKey: string, fileIds: string[]) => {
    const normalizedIds = Array.from(new Set(fileIds.map((item) => String(item || "").trim()).filter(Boolean)));
    setSelectedPreviewFileIds((prev) => ({
      ...prev,
      [previewKey]: new Set(normalizedIds),
    }));
  };

  const togglePreviewFileId = (previewKey: string, fileId: string) => {
    const normalizedId = String(fileId || "").trim();
    if (!normalizedId) return;
    setSelectedPreviewFileIds((prev) => {
      const nextSet = new Set(prev[previewKey] || []);
      if (nextSet.has(normalizedId)) {
        nextSet.delete(normalizedId);
      } else {
        nextSet.add(normalizedId);
      }
      return { ...prev, [previewKey]: nextSet };
    });
  };

  const getSelectedPreviewFileIds = (previewKey: string): string[] => (
    Array.from(selectedPreviewFileIds[previewKey] || [])
  );

  const suggestedMissingPreviewFileIds = (files: SharePreviewFile[]): string[] => {
    if (!tvMissingStatusAvailable) return [];
    return files
      .filter((file) => {
        if (!isPreviewVideoFile(file)) return false;
        const parsed = parsePreviewEpisode(previewFileName(file));
        return parsed && tvMissingPreview.missingEpisodeKeys.has(episodeKey(parsed.season, parsed.episode));
      })
      .map(previewFileId)
      .filter(Boolean);
  };

  const handleTransfer = async (resource: Pan115Resource) => {
    if (!resource.shareUrl) {
      setError("该资源没有 115 分享链接，无法转存。");
      return;
    }
    const key = `${resource.sourceKey}:${resource.shareUrl}`;
    setTransferringKey(key);
    setError(null);
    try {
      await pan115Api.saveShareToFolder(resource.shareUrl, title, "0", resource.receiveCode || "", null);
      await addLog("SUCCESS", `已转存到 115: ${resource.name}`);
      setInfo(`已转存到 115：${resource.name}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
      setError(`转存失败: ${msg}`);
      await addLog("ERROR", `115 转存失败: ${msg}`);
    } finally {
      setTransferringKey("");
    }
  };

  const handlePreviewShare = async (previewKey: string, shareUrl: string, receiveCode = "") => {
    const normalizedUrl = shareUrl.trim();
    if (!normalizedUrl) return;
    setPreviewByKey((prev) => ({
      ...prev,
      [previewKey]: { ...emptySharePreviewState(), loading: true },
    }));
    try {
      const response = await pan115Api.extractShareFiles(normalizedUrl, receiveCode.trim());
      const preview = extractSharePreview(response.data);
      setPreviewByKey((prev) => ({
        ...prev,
        [previewKey]: {
          loading: false,
          loaded: true,
          error: "",
          ...preview,
        },
      }));
      const suggestedIds = suggestedMissingPreviewFileIds(preview.files);
      if (suggestedIds.length > 0 && !selectedPreviewFileIds[previewKey]?.size) {
        selectPreviewFileIds(previewKey, suggestedIds);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
      setPreviewByKey((prev) => ({
        ...prev,
        [previewKey]: {
          ...emptySharePreviewState(),
          loaded: true,
          error: `预览失败: ${msg}`,
        },
      }));
    }
  };

  const handleCancel = async (channelType: SubscriptionChannel) => {
    const id = channelType === "pan115" ? pan115SubId : ptSubId;
    if (!id) return;
    setSubmitting(true);
    setError(null);
    try {
      await subscriptionApi.delete(id);
      await addLog(
        "INFO",
        channelType === "pt"
          ? `已删除 MoviePilot 本地镜像，外部 PT 订阅仍需在 MoviePilot 管理: ${title}`
          : `已取消 115 订阅: ${title}`,
      );
      await onChanged();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
      setError(`取消失败: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const scanFixedSourceAfterCreate = async (subId: string, sourceId: string, sourceName: string) => {
    if (mediaType !== "tv" || !subId || !sourceId) return;
    try {
      const response = await subscriptionApi.scanSource(subId, sourceId);
      const stats = asRecord(asRecord(response.data).stats);
      const transferredCount = firstNumber(stats.transferred_count, stats.transferredCount, 0) ?? 0;
      const selectedCount = firstNumber(stats.selected_count, stats.selectedCount, transferredCount) ?? transferredCount;
      const level = transferredCount > 0 ? "SUCCESS" : "INFO";
      await addLog(level, `固定 115 来源缺集扫描完成: ${sourceName}，匹配 ${selectedCount} 个，转存 ${transferredCount} 个`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
      await addLog("WARN", `固定 115 来源已绑定，但立即缺集扫描失败: ${msg}`);
    }
  };

  const createPan115Subscription = async () => {
    const manualSelected = selectedSources.includes("manual") && selectedPan115Key === "manual";
    if (manualSelected && !manualShareUrl.trim()) {
      throw new Error("请填写固定 115 分享链接");
    }

    const posterPath = detail?.poster_path || defaultPoster;
    const createResp = await subscriptionApi.create({
      tmdb_id: tmdbId,
      title,
      media_type: mediaType,
      ...(posterPath ? { poster_path: posterPath } : {}),
      ...(detail?.overview ? { overview: detail.overview } : {}),
      ...(year ? { year } : {}),
      ...(typeof detail?.vote_average === "number" ? { rating: detail.vote_average } : {}),
      auto_download: true,
      ...buildTvParams(),
    });
    const subId = String((createResp.data as { id?: string | number })?.id || "");

    const rollbackCreatedSubscription = async (reason: string): Promise<boolean> => {
      if (!subId) return false;
      try {
        await subscriptionApi.delete(subId);
        await onChanged();
        await addLog("WARN", `固定 115 来源绑定失败，已回滚订阅: ${title}（${reason}）`);
        return true;
      } catch (rollbackErr: unknown) {
        const rollbackMsg = (rollbackErr as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(rollbackErr);
        await addLog("ERROR", `固定 115 来源绑定失败，且回滚订阅失败: ${title}（${rollbackMsg}）`);
        return false;
      }
    };

    if (manualSelected) {
      let sourceResp;
      try {
        sourceResp = await subscriptionApi.createSource(subId, {
          share_url: manualShareUrl.trim(),
          receive_code: manualReceiveCode.trim(),
          display_name: manualDisplayName.trim() || title,
          selected_file_ids: getSelectedPreviewFileIds(manualPreviewKey),
        });
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
        const rolledBack = await rollbackCreatedSubscription(msg);
        throw new Error(rolledBack ? `固定 115 来源绑定失败，已回滚订阅: ${msg}` : `固定 115 来源绑定失败，且订阅回滚失败: ${msg}`);
      }
      await addLog("SUCCESS", `已添加 115 订阅并绑定固定链接: ${title}`);
      const sourceId = String((sourceResp.data as { id?: string | number })?.id || "");
      await scanFixedSourceAfterCreate(subId, sourceId, manualDisplayName.trim() || title);
      return;
    }

    if (selectedResource?.shareUrl) {
      let sourceResp;
      try {
        sourceResp = await subscriptionApi.createSource(subId, {
          share_url: selectedResource.shareUrl,
          receive_code: selectedResource.receiveCode || "",
          display_name: selectedResource.name || title,
          selected_file_ids: getSelectedPreviewFileIds(selectedPan115Key),
        });
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
        const rolledBack = await rollbackCreatedSubscription(msg);
        throw new Error(rolledBack ? `固定 115 来源绑定失败，已回滚订阅: ${msg}` : `固定 115 来源绑定失败，且订阅回滚失败: ${msg}`);
      }
      await addLog("SUCCESS", `已添加 115 订阅并绑定固定来源: ${title}`);
      const sourceId = String((sourceResp.data as { id?: string | number })?.id || "");
      await scanFixedSourceAfterCreate(subId, sourceId, selectedResource.name || title);
      return;
    }

    await addLog("SUCCESS", `已添加 115 自动搜索订阅: ${title}`);
  };

  const createPtSubscription = async () => {
    const posterPath = detail?.poster_path || defaultPoster;
    await moviepilotApi.createSubscription({
      title,
      media_type: mediaType,
      tmdb_id: tmdbId,
      ...(posterPath ? { poster_path: posterPath } : {}),
      ...(detail?.overview ? { overview: detail.overview } : {}),
      ...(year ? { year } : {}),
      ...(typeof detail?.vote_average === "number" ? { rating: detail.vote_average } : {}),
      auto_download: true,
    });
    await addLog("SUCCESS", `已创建 MoviePilot TMDB 订阅: ${title}`);
  };

  const pushPtDownload = async (item: MoviePilotTorrent) => {
    await moviepilotApi.pushDownload({
      item: item.raw,
      title,
      media_type: mediaType,
      tmdb_id: tmdbId,
    });
    await addLog("SUCCESS", `已推送 MoviePilot 下载: ${item.title}`);
  };

  const handleSubmit = async () => {
    setError(null);
    setInfo(null);
    if (channel === "quark") return;
    if (channel === "pan115" && isPan115Subscribed) return;
    if (channel === "pt" && isPtSubscribed && !selectedPtItem) return;

    setSubmitting(true);
    try {
      if (channel === "pan115") {
        await createPan115Subscription();
      } else if (selectedPtItem) {
        await pushPtDownload(selectedPtItem);
      } else {
        await createPtSubscription();
      }
      await onChanged();
      onClose();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || (err as Error)?.message || String(err);
      setError(`操作失败: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const submitLabel = channel === "pt"
    ? (selectedPtItem ? "推送下载" : "创建 TMDB 订阅")
    : channel === "quark"
      ? "暂未接入"
      : isPan115Subscribed
        ? "已订阅 115"
        : "创建 115 订阅";

  const ChannelCard = ({
    channelKey,
    icon,
    label,
    desc,
    subscribed,
    accentColor,
  }: {
    channelKey: SubscriptionChannel;
    icon: React.ReactNode;
    label: string;
    desc: string;
    subscribed: boolean;
    accentColor: string;
  }) => (
    <button
      type="button"
      onClick={() => setChannel(channelKey)}
      disabled={channelKey === "quark"}
      className={`rounded-2xl p-3 text-left transition-all ${channelKey === "quark" ? "opacity-55 cursor-not-allowed" : "cursor-pointer glass-hover"}`}
      style={{
        background: channel === channelKey ? "var(--surface-subtle)" : "var(--surface)",
        border: "1px solid var(--border)",
        ...(channel === channelKey ? { boxShadow: `0 0 0 2px ${accentColor}` } : {}),
      }}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0" style={{ color: accentColor }}>{icon}</span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-xs font-black" style={{ color: "var(--txt)" }}>
            {label}
            {subscribed && (
              <span className="rounded px-1.5 py-0.5 text-[9px]" style={{ background: "rgba(34,197,94,0.16)", color: "var(--accent-ok)" }}>
                已订阅
              </span>
            )}
          </span>
          <span className="mt-1 block text-[10px] font-semibold leading-relaxed" style={{ color: "var(--txt-muted)" }}>
            {desc}
          </span>
        </span>
      </div>
    </button>
  );

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0"
          style={{ background: "rgba(11,8,30,.34)", backdropFilter: "blur(6px)" }}
          onClick={onClose}
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 16 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 16 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="relative z-10 max-h-[92vh] w-full max-w-[720px] overflow-y-auto rounded-3xl p-4 sm:p-5 space-y-4 glass-heavy glass-iridescent"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="h-16 w-11 shrink-0 overflow-hidden rounded-xl" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                {poster ? (
                  <img src={poster} alt={title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <Rss className="m-auto mt-5 h-5 w-5" style={{ color: "var(--txt-muted)" }} />
                )}
              </div>
              <div className="min-w-0">
                <h2 className="truncate text-base font-black" style={{ color: "var(--txt)" }}>添加订阅</h2>
                <p className="truncate text-xs font-bold" style={{ color: "var(--txt-secondary)" }}>{title}</p>
                <p className="mt-1 text-[10px] font-semibold" style={{ color: "var(--txt-muted)" }}>
                  {[year, mediaType === "tv" ? "剧集" : "电影", rating ? `${rating} 分` : ""].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg glass-hover"
              style={{ color: "var(--txt-muted)", border: "1px solid var(--border)" }}
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {(isPan115Subscribed || isPtSubscribed) && (
            <div className="rounded-2xl p-3" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)" }}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] font-black" style={{ color: "var(--accent-ok)" }}>
                  <CheckCircle className="h-3.5 w-3.5" />
                  <span>当前已订阅{isPan115Subscribed ? " 115" : ""}{isPan115Subscribed && isPtSubscribed ? " ·" : ""}{isPtSubscribed ? " PT" : ""}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {isPan115Subscribed && (
                    <button type="button" onClick={() => void handleCancel("pan115")} disabled={submitting} className="rounded-lg px-2.5 py-1.5 text-[10px] font-black glass-hover disabled:opacity-50" style={{ color: "var(--accent-danger)", background: "var(--surface)", border: "1px solid var(--border)" }}>
                      取消 115
                    </button>
                  )}
                  {isPtSubscribed && (
                    <button type="button" onClick={() => void handleCancel("pt")} disabled={submitting} className="rounded-lg px-2.5 py-1.5 text-[10px] font-black glass-hover disabled:opacity-50" style={{ color: "var(--accent-danger)", background: "var(--surface)", border: "1px solid var(--border)" }}>
                      删除 PT 镜像
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <ChannelCard
              channelKey="pan115"
              icon={<HardDrive className="h-4 w-4" />}
              label="115"
              desc="自动搜索或绑定固定 115 分享来源。"
              subscribed={isPan115Subscribed}
              accentColor="var(--brand-primary)"
            />
            <ChannelCard
              channelKey="pt"
              icon={<Download className="h-4 w-4" />}
              label="PT"
              desc="选择种子立即推送，或创建 TMDB 订阅。"
              subscribed={isPtSubscribed}
              accentColor="var(--accent-info)"
            />
            <ChannelCard
              channelKey="quark"
              icon={<Cloud className="h-4 w-4" />}
              label="夸克"
              desc="订阅渠道暂未接入。"
              subscribed={false}
              accentColor="var(--txt-muted)"
            />
          </div>

          {channel === "pan115" && (
            <div className="space-y-3">
              <div className="rounded-2xl p-3 space-y-2" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                <div className="flex flex-wrap gap-2">
                  {SOURCE_META.map((source) => (
                    <label
                      key={source.key}
                      className="flex cursor-pointer items-start gap-2 rounded-xl px-2.5 py-2"
                      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedSources.includes(source.key)}
                        onChange={() => toggleSource(source.key)}
                        className="mt-0.5 accent-[var(--brand-primary)]"
                      />
                      <span>
                        <span className="block text-[10px] font-black" style={{ color: "var(--txt)" }}>{source.label}</span>
                        <span className="block text-[9px] font-semibold" style={{ color: "var(--txt-muted)" }}>{source.desc}</span>
                      </span>
                    </label>
                  ))}
                </div>

                {mediaType === "tv" && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2" style={tvMissingStatusAvailable ? { background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.24)" } : { background: "var(--surface)", border: "1px solid var(--border)" }}>
                    <div className="min-w-0 text-[10px] font-bold" style={{ color: tvMissingStatusAvailable ? "var(--accent-ok)" : "var(--txt-muted)" }}>
                      {tvMissingPreview.loading
                        ? "正在计算当前 TV 范围缺集..."
                        : tvMissingStatusAvailable
                          ? `当前范围缺 ${tvMissingPreview.counts.missing ?? tvMissingPreview.missingEpisodeKeys.size} 集；文件预览会标出命中项`
                          : `缺集状态不可用${tvMissingPreview.message ? `：${tvMissingPreview.message}` : ""}`}
                    </div>
                    <button type="button" onClick={() => void fetchTvMissingPreview(true)} disabled={tvMissingPreview.loading} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-black glass-hover disabled:opacity-50" style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>
                      <RefreshCw className={`h-3 w-3 ${tvMissingPreview.loading ? "animate-spin" : ""}`} />
                      刷新缺集
                    </button>
                  </div>
                )}

                {selectedSources.includes("manual") && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_120px]">
                    <label className="space-y-1">
                      <span className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>115 分享链接</span>
                      <input
                        value={manualShareUrl}
                        onChange={(event) => {
                          setManualShareUrl(event.target.value);
                          setSelectedPan115Key("manual");
                        }}
                        placeholder="https://115.com/s/..."
                        className="w-full rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                        style={{ color: "var(--txt)", background: "var(--surface)", border: "1px solid var(--border)" }}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>提取码</span>
                      <input
                        value={manualReceiveCode}
                        onChange={(event) => setManualReceiveCode(event.target.value)}
                        className="w-full rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                        style={{ color: "var(--txt)", background: "var(--surface)", border: "1px solid var(--border)" }}
                      />
                    </label>
                    <label className="space-y-1 sm:col-span-2">
                      <span className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>显示名称</span>
                      <input
                        value={manualDisplayName}
                        onChange={(event) => setManualDisplayName(event.target.value)}
                        placeholder={title}
                        className="w-full rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                        style={{ color: "var(--txt)", background: "var(--surface)", border: "1px solid var(--border)" }}
                      />
                    </label>
                    <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2">
                      <label className="flex cursor-pointer items-center gap-2 text-[10px] font-bold" style={{ color: "var(--txt-secondary)" }}>
                        <input type="radio" checked={selectedPan115Key === "manual"} onChange={() => setSelectedPan115Key("manual")} className="accent-[var(--brand-primary)]" />
                        选这条固定链接作为订阅来源
                      </label>
                      <button type="button" disabled={!manualShareUrl.trim() || previewByKey[manualPreviewKey]?.loading} onClick={() => void handlePreviewShare(manualPreviewKey, manualShareUrl, manualReceiveCode)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-black glass-hover disabled:opacity-50" style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>
                        {previewByKey[manualPreviewKey]?.loading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                        预览文件
                      </button>
                    </div>
                    <div className="sm:col-span-2">
                      <SharePreviewPanel
                        preview={previewByKey[manualPreviewKey]}
                        missingEpisodeKeys={tvMissingPreview.missingEpisodeKeys}
                        missingStatusAvailable={tvMissingStatusAvailable}
                        selectedFileIds={selectedPreviewFileIds[manualPreviewKey]}
                        onToggleSelected={(fileId) => togglePreviewFileId(manualPreviewKey, fileId)}
                        onSelectFileIds={(fileIds) => selectPreviewFileIds(manualPreviewKey, fileIds)}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1 no-scrollbar">
                {selectedSources.filter((source) => source !== "manual").map((source) => {
                  const state = sourceState[source];
                  const label = SOURCE_META.find((item) => item.key === source)?.label || source;
                  return (
                    <div key={source} className="rounded-2xl p-3 space-y-2" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-xs font-black" style={{ color: "var(--txt)" }}>{label}</h3>
                        {state.loading && <RefreshCw className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--txt-muted)" }} />}
                      </div>
                      {state.error && <p className="text-[10px] font-bold" style={{ color: "var(--accent-danger)" }}>{state.error}</p>}
                      {!state.loading && state.loaded && state.items.length === 0 && !state.error && (
                        <p className="rounded-xl px-3 py-2 text-[10px] font-semibold" style={{ color: "var(--txt-muted)", background: "var(--surface-subtle)", border: "1px dashed var(--border)" }}>暂无资源</p>
                      )}
                      {state.items.map((resource) => {
                        const key = `${resource.sourceKey}:${resource.shareUrl || resource.url}`;
                        const lockedHdhive = Boolean(resource.slug && !resource.unlocked);
                        const busy = transferringKey === key;
                        const preview = previewByKey[key];
                        const previewBusy = Boolean(preview?.loading);
                        return (
                          <div key={key} className="rounded-xl p-2.5 space-y-2" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                            <div className="flex items-start gap-2">
                              <input
                                type="radio"
                                className="mt-1 accent-[var(--brand-primary)]"
                                checked={selectedPan115Key === key}
                                disabled={lockedHdhive}
                                onChange={() => setSelectedPan115Key(key)}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="break-all text-xs font-bold leading-snug" style={{ color: "var(--txt)" }}>{resource.name}</p>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={{ background: "var(--surface)", color: "var(--txt-secondary)" }}>{resource.size}</span>
                                  {resource.resolution && <span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={{ background: "rgba(99,102,241,0.14)", color: "var(--accent-info)" }}>{resource.resolution}</span>}
                                  {resource.slug && <span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={resource.unlocked ? { background: "rgba(34,197,94,0.16)", color: "var(--accent-ok)" } : { background: "rgba(245,158,11,0.16)", color: "var(--accent-warn)" }}>{resource.unlocked ? "已解锁" : "待解锁"}</span>}
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-wrap justify-end gap-1.5">
                              {resource.slug && !resource.unlocked && (
                                <button type="button" disabled={unlockingSlug === resource.slug} onClick={() => void handleUnlock(resource)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-black text-white disabled:opacity-50" style={{ background: "var(--accent-warn)" }}>
                                  {unlockingSlug === resource.slug ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Shield className="h-3 w-3" />}
                                  解锁
                                </button>
                              )}
                              <button type="button" disabled={previewBusy || lockedHdhive || !resource.shareUrl} onClick={() => void handlePreviewShare(key, resource.shareUrl || "", resource.receiveCode || "")} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-black glass-hover disabled:opacity-50" style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>
                                {previewBusy ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Eye className="h-3 w-3" />}
                                预览文件
                              </button>
                              <button type="button" disabled={busy || lockedHdhive || !resource.shareUrl} onClick={() => void handleTransfer(resource)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-black text-white disabled:opacity-50" style={{ background: "var(--brand-primary)" }}>
                                {busy ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                                转存到 115
                              </button>
                            </div>
                            <SharePreviewPanel
                              preview={preview}
                              missingEpisodeKeys={tvMissingPreview.missingEpisodeKeys}
                              missingStatusAvailable={tvMissingStatusAvailable}
                              selectedFileIds={selectedPreviewFileIds[key]}
                              onToggleSelected={(fileId) => togglePreviewFileId(key, fileId)}
                              onSelectFileIds={(fileIds) => selectPreviewFileIds(key, fileIds)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {channel === "pt" && (
            <div className="rounded-2xl p-3 space-y-2" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-black" style={{ color: "var(--txt)" }}>MoviePilot 种子</h3>
                <button type="button" onClick={() => { setPtLoaded(false); setPtItems([]); void fetchPtItems(true); }} disabled={ptLoading} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-black glass-hover disabled:opacity-50" style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>
                  <RefreshCw className={`h-3.5 w-3.5 ${ptLoading ? "animate-spin" : ""}`} />
                  刷新
                </button>
              </div>
              {ptError && <p className="text-[10px] font-bold" style={{ color: "var(--accent-danger)" }}>{ptError}</p>}
              {ptLoading ? (
                <div className="py-8 text-center">
                  <RefreshCw className="mx-auto h-5 w-5 animate-spin" style={{ color: "var(--txt-muted)" }} />
                  <p className="mt-2 text-[10px] font-semibold" style={{ color: "var(--txt-muted)" }}>搜索 MoviePilot...</p>
                </div>
              ) : ptItems.length === 0 ? (
                <p className="rounded-xl px-3 py-4 text-center text-[10px] font-semibold" style={{ color: "var(--txt-muted)", background: "var(--surface)", border: "1px dashed var(--border)" }}>暂无种子；不选择种子时可创建 TMDB 订阅</p>
              ) : (
                <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1 no-scrollbar">
                  {ptItems.map((item) => (
                    <div key={item.key} className="rounded-xl p-2.5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                      <label className="flex cursor-pointer items-start gap-2">
                        <input type="radio" checked={selectedPtKey === item.key} onChange={() => setSelectedPtKey(item.key)} className="mt-1 accent-[var(--brand-primary)]" />
                        <span className="min-w-0 flex-1">
                          <span className="block break-all text-xs font-bold leading-snug" style={{ color: "var(--txt)" }}>{item.title}</span>
                          <span className="mt-1 flex flex-wrap gap-1">
                            <span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" }}>{item.site}</span>
                            <span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" }}>{item.size}</span>
                            {item.seeders != null && <span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={{ background: "rgba(34,197,94,0.14)", color: "var(--accent-ok)" }}>做种 {item.seeders}</span>}
                            {item.freeLabel && <span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={{ background: "rgba(245,158,11,0.14)", color: "var(--accent-warn)" }}>{item.freeLabel}</span>}
                            {item.pubdate && <span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={{ background: "var(--surface-subtle)", color: "var(--txt-muted)" }}>{item.pubdate}</span>}
                          </span>
                        </span>
                      </label>
                      {item.pageUrl && (
                        <div className="mt-2 flex justify-end">
                          <a href={item.pageUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-black glass-hover" style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>
                            <ExternalLink className="h-3 w-3" />
                            详情页
                          </a>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {selectedPtKey && (
                <button type="button" onClick={() => setSelectedPtKey("")} className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>
                  清除种子选择，改为创建 TMDB 订阅
                </button>
              )}
            </div>
          )}

          {mediaType === "tv" && channel === "pan115" && (
            <div className="rounded-2xl p-3 space-y-2.5" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
              <div className="flex items-center gap-1.5">
                <Tv className="h-3.5 w-3.5" style={{ color: "var(--brand-primary)" }} />
                <span className="text-xs font-black" style={{ color: "var(--txt)" }}>TV 订阅范围</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {([{ key: "all", label: "全季" }, { key: "season", label: "指定季" }, { key: "episode", label: "集段" }] as const).map((opt) => (
                  <button key={opt.key} type="button" onClick={() => { setTvScope(opt.key); resetLoadedPan115Resources(); }} className={`rounded-lg px-3 py-1.5 text-[10px] font-black transition-all ${tvScope === opt.key ? "" : "glass-hover"}`} style={tvScope === opt.key ? { background: "var(--brand-primary)", color: "#fff", border: "1px solid var(--brand-primary)" } : { background: "var(--surface)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>
                    {opt.label}
                  </button>
                ))}
              </div>
              {tvScope !== "all" && (
                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-1">
                    <span className="block text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>季号</span>
                    <select value={tvSeasonNumber} onChange={(event) => { setTvSeasonNumber(Number(event.target.value)); resetLoadedPan115Resources(); }} className="w-full rounded-xl px-2 py-1.5 text-[10px] font-bold focus:outline-none" style={{ color: "var(--txt)", background: "var(--surface)", border: "1px solid var(--border)" }}>
                      {seasons.filter((s) => s.season_number > 0).map((s) => (
                        <option key={s.season_number} value={s.season_number}>S{s.season_number} ({s.episode_count || "?"}集)</option>
                      ))}
                    </select>
                  </label>
                  {tvScope === "episode" && (
                    <>
                      <label className="space-y-1">
                        <span className="block text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>起始集</span>
                        <input type="number" min={1} value={tvEpisodeStart} onChange={(event) => setTvEpisodeStart(event.target.value === "" ? "" : Number(event.target.value))} className="w-full rounded-xl px-2 py-1.5 text-[10px] font-bold focus:outline-none" style={{ color: "var(--txt)", background: "var(--surface)", border: "1px solid var(--border)" }} />
                      </label>
                      <label className="space-y-1">
                        <span className="block text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>结束集</span>
                        <input type="number" min={1} value={tvEpisodeEnd} onChange={(event) => setTvEpisodeEnd(event.target.value === "" ? "" : Number(event.target.value))} className="w-full rounded-xl px-2 py-1.5 text-[10px] font-bold focus:outline-none" style={{ color: "var(--txt)", background: "var(--surface)", border: "1px solid var(--border)" }} />
                      </label>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {channel === "quark" && (
            <div className="rounded-2xl p-3 text-[10px] font-semibold" style={{ background: "var(--surface-subtle)", color: "var(--txt-muted)", border: "1px solid var(--border)" }}>
              夸克订阅暂未接入。夸克分享转存仍在 115 网盘页的分享链接转存中处理。
            </div>
          )}

          <div className="rounded-2xl p-3" style={{ background: "var(--brand-primary-bg-alpha)", border: "1px solid var(--brand-primary-border-alpha)" }}>
            <div className="flex items-start gap-2">
              <Shield className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--brand-primary)" }} />
              <div className="min-w-0 space-y-1 text-[10px] font-bold">
                <p style={{ color: "var(--brand-primary)" }}>115 转存目标：{pan115DefaultFolderName || "根目录（未配置）"}</p>
                <p style={{ color: "var(--txt-muted)" }}>夸克转存目标：{quarkDefaultFolderName || "根目录（未配置）"}</p>
              </div>
            </div>
          </div>

          {info && (
            <div className="rounded-2xl p-2.5 text-[10px] font-semibold" style={{ background: "rgba(99,102,241,0.10)", color: "var(--accent-info)", border: "1px solid rgba(99,102,241,0.3)" }}>
              {info}
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-2xl p-2.5" style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.3)" }}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--accent-danger)" }} />
              <p className="text-[10px] font-semibold leading-relaxed" style={{ color: "var(--accent-danger)" }}>{error}</p>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded-xl px-4 py-2 text-xs font-black glass-hover disabled:opacity-50" style={{ color: "var(--txt-secondary)", background: "var(--surface)", border: "1px solid var(--border)" }}>
              关闭
            </button>
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={submitting || channel === "quark" || (channel === "pan115" && isPan115Subscribed) || (channel === "pt" && isPtSubscribed && !selectedPtItem)}
              className="flex items-center gap-1.5 rounded-xl px-5 py-2 text-xs font-black transition-all active:scale-95 disabled:opacity-50"
              style={{ background: "var(--brand-primary)", color: "#fff", border: "1px solid var(--brand-primary)" }}
            >
              {submitting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : (channel === "pt" ? <Download className="h-3.5 w-3.5" /> : <Rss className="h-3.5 w-3.5" />)}
              {submitLabel}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
