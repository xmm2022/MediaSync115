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
  ExternalLink,
  HardDrive,
  Link2,
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

  const handleCancel = async (channelType: SubscriptionChannel) => {
    const id = channelType === "pan115" ? pan115SubId : ptSubId;
    if (!id) return;
    setSubmitting(true);
    setError(null);
    try {
      await subscriptionApi.delete(id);
      await addLog("INFO", `已取消${channelType === "pan115" ? " 115" : " PT"}订阅: ${title}`);
      await onChanged();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
      setError(`取消失败: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const createPan115Subscription = async () => {
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

    const manualSelected = selectedSources.includes("manual") && selectedPan115Key === "manual";
    if (manualSelected) {
      if (!manualShareUrl.trim()) throw new Error("请填写固定 115 分享链接");
      await subscriptionApi.createSource(subId, {
        share_url: manualShareUrl.trim(),
        receive_code: manualReceiveCode.trim(),
        display_name: manualDisplayName.trim() || title,
      });
      await addLog("SUCCESS", `已添加 115 订阅并绑定固定链接: ${title}`);
      return;
    }

    if (selectedResource?.shareUrl) {
      await subscriptionApi.createSource(subId, {
        share_url: selectedResource.shareUrl,
        receive_code: selectedResource.receiveCode || "",
        display_name: selectedResource.name || title,
      });
      await addLog("SUCCESS", `已添加 115 订阅并绑定固定来源: ${title}`);
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
                      取消 PT
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
                    <label className="flex cursor-pointer items-center gap-2 text-[10px] font-bold sm:col-span-2" style={{ color: "var(--txt-secondary)" }}>
                      <input type="radio" checked={selectedPan115Key === "manual"} onChange={() => setSelectedPan115Key("manual")} className="accent-[var(--brand-primary)]" />
                      选这条固定链接作为订阅来源
                    </label>
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
                              <button type="button" disabled={busy || lockedHdhive || !resource.shareUrl} onClick={() => void handleTransfer(resource)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-black text-white disabled:opacity-50" style={{ background: "var(--brand-primary)" }}>
                                {busy ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                                转存到 115
                              </button>
                            </div>
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
