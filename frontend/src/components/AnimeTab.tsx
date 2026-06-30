import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { animeApi } from "../api/anime";
import type {
  AniRssConfig,
  AniRssDownloadClientStatus,
  AniRssRssCandidate,
  AniRssSubscriptionStatus,
  BangumiSubject,
} from "../api/types";
import { getApiErrorMessage } from "../api/errors";

interface AnimeTabProps {
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => Promise<void>;
  onNavigateToSettings?: () => void;
}

type AniRssListItem = AniRssSubscriptionStatus;
type AniFilter = "all" | "tracking" | "paused" | "error" | "missing";
type AniSort = "recent" | "title" | "progress" | "status";
type SubscriptionStats = {
  total: number;
  tracking: number;
  paused: number;
  error: number;
  missing: number;
};

type PreviewSummary = {
  itemCount: number;
  omitCount: number;
  itemTitles: string[];
};

const ANIME_FILTERS: { key: AniFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "tracking", label: "追新中" },
  { key: "paused", label: "已暂停" },
  { key: "error", label: "异常" },
  { key: "missing", label: "外部缺失" },
];

function pickBangumiTitle(subject: BangumiSubject | null) {
  if (!subject) return "";
  return String(subject.name_cn || subject.name || "").trim();
}

function pickBangumiPoster(subject: BangumiSubject | null) {
  if (!subject) return "";
  return subject.images?.common || subject.images?.medium || subject.image || "";
}

function pickBangumiYear(subject: BangumiSubject | null) {
  const date = String(subject?.date || "").trim();
  return date.length >= 4 ? date.slice(0, 4) : "";
}

function pickBangumiRating(subject: BangumiSubject | null) {
  const raw = subject?.rating?.score ?? subject?.score;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function getRssSourceLabel(source: unknown) {
  const normalized = normalizeRssSource(source);
  if (normalized === "mikan") return "Mikan";
  if (normalized === "ani-bt") return "AniBT";
  if (normalized === "anime-garden") return "AnimeGarden";
  return normalized || "RSS";
}

function normalizeRssSource(source: unknown) {
  const normalized = String(source || "").trim().toLowerCase();
  if (normalized === "anibt" || normalized === "ani_bt") return "ani-bt";
  if (normalized === "animegarden" || normalized === "anime_garden") return "anime-garden";
  return normalized;
}

function getCandidateSource(candidate: AniRssRssCandidate) {
  return normalizeRssSource(candidate.rss_type || candidate.source);
}

function pickPreferredCandidate(candidates: AniRssRssCandidate[], source?: string) {
  const normalizedSource = normalizeRssSource(source);
  const scoped = normalizedSource
    ? candidates.filter((candidate) => getCandidateSource(candidate) === normalizedSource)
    : candidates;
  return (
    scoped.find((candidate) => String(candidate.subgroup || "").trim() === "ANi") ||
    scoped.find((candidate) => !candidate.subgroup_id) ||
    scoped[0] ||
    null
  );
}

function flattenAniRssList(raw: unknown): AniRssListItem[] {
  const payload = raw as { weekList?: { items?: AniRssListItem[] }[]; items?: AniRssListItem[] };
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.weekList)) {
    return payload.weekList.flatMap((week) => (Array.isArray(week.items) ? week.items : []));
  }
  return [];
}

function getAniEnabled(item: AniRssListItem) {
  return Boolean(item.enabled ?? item.enable);
}

function getAniStatus(item: AniRssListItem) {
  const status = String(item.status || "").trim();
  if (status) return status;
  return getAniEnabled(item) ? "tracking" : "paused";
}

function getAniStatusLabel(item: AniRssListItem) {
  return String(item.status_text || (
    getAniStatus(item) === "error"
      ? "错误"
      : getAniStatus(item) === "tracking"
        ? "追新中"
        : getAniStatus(item) === "missing"
          ? "外部不存在"
          : "暂停"
  ));
}

function getAniStatusStyle(item: AniRssListItem) {
  const status = getAniStatus(item);
  if (status === "error") {
    return { color: "var(--accent-danger)", background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.26)" };
  }
  if (status === "tracking") {
    return { color: "var(--accent-ok)", background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.24)" };
  }
  if (status === "missing") {
    return { color: "var(--accent-warn)", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.28)" };
  }
  return { color: "var(--txt-secondary)", background: "var(--surface)", border: "1px solid var(--border)" };
}

function getAniCurrentEpisode(item: AniRssListItem) {
  return item.current_episode ?? item.currentEpisodeNumber ?? 0;
}

function getAniTotalEpisodes(item: AniRssListItem) {
  return item.total_episodes ?? item.totalEpisodeNumber ?? "?";
}

function getAniProgressScore(item: AniRssListItem) {
  const current = Number(getAniCurrentEpisode(item) || 0);
  const total = Number(getAniTotalEpisodes(item) || 0);
  if (!Number.isFinite(total) || total <= 0) return current;
  return current / total;
}

function getAniRssUrl(item: AniRssListItem) {
  return String(item.rss_url || item.url || "");
}

function getAniDownloadPath(item: AniRssListItem) {
  return String(item.download_path || item.downloadPath || "");
}

function getAniCustomDownloadPath(item: AniRssListItem) {
  return Boolean(item.custom_download_path ?? item.customDownloadPath);
}

function getAniRecentHitTitle(item: AniRssListItem) {
  const hit = item.recent_hit || item.matched_items?.[0];
  return String(hit?.title || "").trim();
}

function getAniLastDownloadTime(item: AniRssListItem) {
  const raw = item.last_download_time ?? item.lastDownloadTime;
  const value = Number(raw || 0);
  return Number.isFinite(value) ? value : 0;
}

function hasPreviewCounts(item: AniRssListItem) {
  return item.matched_count != null || item.duplicate_ignored_count != null;
}

function getPreviewSummary(raw: Record<string, unknown> | null): PreviewSummary | null {
  if (!raw) return null;
  const preview = raw.preview && typeof raw.preview === "object" ? raw.preview as Record<string, unknown> : {};
  const items = Array.isArray(preview.items) ? preview.items : [];
  const omitList = Array.isArray(preview.omitList) ? preview.omitList : [];
  const itemTitles = items.slice(0, 5).map((item) => {
    if (typeof item === "string") return item;
    if (!item || typeof item !== "object") return "";
    const record = item as Record<string, unknown>;
    return String(record.title || record.name || record.episodeTitle || record.url || "").trim();
  }).filter(Boolean);
  return {
    itemCount: items.length,
    omitCount: omitList.length,
    itemTitles,
  };
}

export default function AnimeTab({ addLog, onNavigateToSettings }: AnimeTabProps) {
  const [config, setConfig] = useState<AniRssConfig | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BangumiSubject[]>([]);
  const [selected, setSelected] = useState<BangumiSubject | null>(null);
  const [rssUrl, setRssUrl] = useState("");
  const [rssType, setRssType] = useState("mikan");
  const [subgroup, setSubgroup] = useState("");
  const [downloadPath, setDownloadPath] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [subscriptions, setSubscriptions] = useState<AniRssListItem[]>([]);
  const [rssCandidates, setRssCandidates] = useState<AniRssRssCandidate[]>([]);
  const [rssCandidateMatched, setRssCandidateMatched] = useState<boolean | null>(null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [statusFilter, setStatusFilter] = useState<AniFilter>("all");
  const [sortMode, setSortMode] = useState<AniSort>("recent");
  const [downloadClientStatus, setDownloadClientStatus] = useState<AniRssDownloadClientStatus | null>(null);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [listSyncedLocal, setListSyncedLocal] = useState(false);

  const selectedTitle = pickBangumiTitle(selected);
  const selectedPoster = pickBangumiPoster(selected);
  const bgmUrl = selected ? `https://bgm.tv/subject/${selected.id}` : "";
  const aniRssReady = Boolean(config?.enabled && config.api_key_configured);
  const canSubmitAniRss = Boolean(config?.enabled && config.api_key_configured && rssUrl.trim() && selected);
  const previewSummary = useMemo(() => getPreviewSummary(preview), [preview]);
  const rssCandidateCounts = useMemo(() => {
    return rssCandidates.reduce<Record<string, number>>((acc, candidate) => {
      const source = getCandidateSource(candidate);
      if (!source) return acc;
      acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {});
  }, [rssCandidates]);
  const visibleRssCandidates = useMemo(() => {
    if (rssType === "other") return rssCandidates;
    const filtered = rssCandidates.filter((candidate) => getCandidateSource(candidate) === normalizeRssSource(rssType));
    return filtered.length > 0 ? filtered : rssCandidates;
  }, [rssCandidates, rssType]);
  const downloadPathPresets = useMemo(() => {
    const raw = [
      config?.default_download_path,
      ...(Array.isArray(config?.download_path_presets) ? config.download_path_presets : []),
    ];
    const seen = new Set<string>();
    return raw
      .map((item) => String(item || "").trim())
      .filter((item) => {
        if (!item || seen.has(item)) return false;
        seen.add(item);
        return true;
      });
  }, [config]);

  const subscriptionStats = useMemo<SubscriptionStats>(() => {
    return subscriptions.reduce<SubscriptionStats>(
      (acc, item) => {
        const status = getAniStatus(item);
        acc.total += 1;
        if (status === "tracking") acc.tracking += 1;
        else if (status === "missing") acc.missing += 1;
        else if (status === "error" || item.recent_error) acc.error += 1;
        else acc.paused += 1;
        return acc;
      },
      { total: 0, tracking: 0, paused: 0, error: 0, missing: 0 },
    );
  }, [subscriptions]);

  const filteredSubscriptions = useMemo(() => {
    const filtered = subscriptions.filter((item) => {
      const status = getAniStatus(item);
      if (statusFilter === "all") return true;
      if (statusFilter === "error") return status === "error" || Boolean(item.recent_error);
      return status === statusFilter;
    });
    return [...filtered].sort((a, b) => {
      if (sortMode === "title") {
        return String(a.title || "").localeCompare(String(b.title || ""), "zh-Hans-CN");
      }
      if (sortMode === "progress") {
        return getAniProgressScore(b) - getAniProgressScore(a);
      }
      if (sortMode === "status") {
        return getAniStatus(a).localeCompare(getAniStatus(b));
      }
      const aHit = getAniRecentHitTitle(a) ? 1 : 0;
      const bHit = getAniRecentHitTitle(b) ? 1 : 0;
      if (aHit !== bHit) return bHit - aHit;
      return getAniLastDownloadTime(b) - getAniLastDownloadTime(a);
    });
  }, [sortMode, statusFilter, subscriptions]);

  const createDisabledReason = useMemo(() => {
    if (!config) return "正在读取 ANI-RSS 配置";
    if (!config.enabled) return "未启用 ANI-RSS";
    if (!config.api_key_configured) return "未配置 ANI-RSS API Key";
    if (!selected) return "请先选择 Bangumi 条目";
    if (!rssUrl.trim()) return "请先填写或通过 ANI-RSS 获取 RSS 地址";
    return "";
  }, [config, rssUrl, selected]);

  const statusText = useMemo(() => {
    if (!config) return "检查中";
    if (!config.enabled) return "未启用";
    if (!config.base_url) return "未配置地址";
    if (!config.api_key_configured) return "未配置 API Key";
    return "已配置";
  }, [config]);

  const downloadClientText = useMemo(() => {
    if (!downloadClientStatus) return "未检测";
    if (downloadClientStatus.ready) return "配置正常";
    return "需要处理";
  }, [downloadClientStatus]);

  const loadConfig = async () => {
    try {
      const response = await animeApi.getAniRssConfig();
      setConfig(response.data);
    } catch (err) {
      setError(getApiErrorMessage(err, "读取 ANI-RSS 配置失败"));
    }
  };

  const loadSubscriptions = async (includePreview = false, syncLocal = true) => {
    const key = includePreview ? "sync-preview" : syncLocal ? "sync" : "read";
    setBusyKey(key);
    try {
      const response = syncLocal
        ? await animeApi.syncAniRssSubscriptions({ includePreview, previewLimit: 5, syncLocal: true })
        : await animeApi.listAniRssSubscriptions({ includePreview, previewLimit: 5, syncLocal: false });
      setSubscriptions(flattenAniRssList(response.data));
      setPreviewLoaded(includePreview);
      setListSyncedLocal(Boolean(response.data.sync?.sync_local));
    } catch (err) {
      setError(getApiErrorMessage(err, "读取 ANI-RSS 外部状态失败"));
    } finally {
      setBusyKey("");
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  useEffect(() => {
    if (config?.enabled && config.api_key_configured) {
      void loadSubscriptions(false, false);
    }
  }, [config?.enabled, config?.api_key_configured]);

  const runSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const keyword = query.trim();
    if (!keyword) return;
    setBusyKey("search");
    setError("");
    try {
      const response = await animeApi.searchBangumi(keyword, 12);
      setResults(Array.isArray(response.data.data) ? response.data.data : []);
      if (!response.data.data?.length) {
        setError(`Bangumi 未找到「${keyword}」，可以换中文名或日文名再试。`);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, "Bangumi 搜索失败"));
    } finally {
      setBusyKey("");
    }
  };

  const applyAniRssCandidate = (candidate: AniRssRssCandidate) => {
    setRssUrl(String(candidate.rss_url || ""));
    setRssType(String(candidate.rss_type || "mikan"));
    const candidateSubgroup = String(candidate.subgroup || "").trim();
    setSubgroup(candidateSubgroup && candidateSubgroup !== "全部字幕组" ? candidateSubgroup : "");
    setPreview(null);
  };

  const handleRssTypeChange = (nextType: string) => {
    setRssType(nextType);
    setPreview(null);
    if (nextType === "other") return;
    const preferred = pickPreferredCandidate(rssCandidates, nextType);
    if (preferred) {
      applyAniRssCandidate(preferred);
    }
  };

  const loadAniRssRssCandidates = async (subject: BangumiSubject | null = selected) => {
    const keyword = pickBangumiTitle(subject) || query.trim();
    if (!keyword) return;
    if (!aniRssReady) {
      setError("请先启用 ANI-RSS 并配置 API Key，再获取 RSS 候选。");
      return;
    }
    setBusyKey("rss-candidates");
    setError("");
    setRssCandidateMatched(null);
    try {
      const response = await animeApi.getAniRssRssCandidates(
        keyword,
        subject?.id,
        48,
        subject?.date ? String(subject.date) : undefined,
      );
      const candidates = Array.isArray(response.data.candidates) ? response.data.candidates : [];
      setRssCandidates(candidates);
      setRssCandidateMatched(Boolean(response.data.matched));
      if (candidates.length > 0) {
        const preferred = pickPreferredCandidate(candidates);
        if (preferred) applyAniRssCandidate(preferred);
        await addLog("SUCCESS", `已通过 ANI-RSS 获取 RSS 候选: ${keyword}`);
      } else {
        const details = Array.isArray(response.data.errors) && response.data.errors.length > 0
          ? ` ${response.data.errors[0]}`
          : "";
        setError(`ANI-RSS 未找到「${keyword}」对应当前 Bangumi 条目的 RSS。可以换 TV 主条目或手动填写 RSS。${details}`);
      }
    } catch (err) {
      setError(getApiErrorMessage(err, "通过 ANI-RSS 获取 RSS 失败"));
    } finally {
      setBusyKey("");
    }
  };

  const selectSubject = (subject: BangumiSubject) => {
    setSelected(subject);
    setPreview(null);
    setRssCandidates([]);
    setRssCandidateMatched(null);
    setRssUrl("");
    setSubgroup("");
    setDownloadPath("");
    if (!query.trim()) setQuery(pickBangumiTitle(subject));
    void loadAniRssRssCandidates(subject);
  };

  const buildPayload = () => {
    const customDownloadPath = downloadPath.trim();
    return {
      rss_url: rssUrl.trim(),
      rss_type: rssType,
      bgm_url: bgmUrl,
      bangumi_id: selected ? String(selected.id) : undefined,
      subgroup: subgroup.trim() || undefined,
      title: selectedTitle || undefined,
      poster_path: selectedPoster || undefined,
      overview: selected?.summary || undefined,
      year: pickBangumiYear(selected) || undefined,
      rating: pickBangumiRating(selected),
      enable: false,
      auto_download: true,
      download_path: customDownloadPath || undefined,
    };
  };

  const previewAniRss = async () => {
    if (!canSubmitAniRss) return;
    setBusyKey("preview");
    setError("");
    try {
      const response = await animeApi.previewAniRssSubscription(buildPayload());
      setPreview(response.data as Record<string, unknown>);
      await addLog("SUCCESS", `ANI-RSS 预览完成: ${selectedTitle}`);
    } catch (err) {
      setError(getApiErrorMessage(err, "ANI-RSS 预览失败"));
    } finally {
      setBusyKey("");
    }
  };

  const createAniRss = async () => {
    if (!canSubmitAniRss) return;
    setBusyKey("create");
    setError("");
    try {
      await animeApi.createAniRssSubscription(buildPayload());
      await addLog("SUCCESS", `已创建停用的 ANI-RSS 追番订阅: ${selectedTitle}`);
      setPreview(null);
      setShowAddPanel(false);
      await loadSubscriptions(false, true);
    } catch (err) {
      setError(getApiErrorMessage(err, "创建 ANI-RSS 订阅失败"));
    } finally {
      setBusyKey("");
    }
  };

  const toggleAniRssSubscription = async (item: AniRssListItem) => {
    const externalId = String(item.external_subscription_id || item.id || "").trim();
    if (!externalId) return;
    const nextEnable = !getAniEnabled(item);
    setBusyKey(`toggle-${externalId}`);
    setError("");
    try {
      await animeApi.setAniRssSubscriptionEnabled(externalId, nextEnable);
      await addLog("SUCCESS", `${nextEnable ? "已启用" : "已暂停"} ANI-RSS 追新: ${item.title || externalId}`);
      await loadSubscriptions(false, true);
    } catch (err) {
      setError(getApiErrorMessage(err, "切换 ANI-RSS 订阅状态失败"));
    } finally {
      setBusyKey("");
    }
  };

  const refreshAniRssSubscription = async (item: AniRssListItem) => {
    const externalId = String(item.external_subscription_id || item.id || "").trim();
    if (!externalId) return;
    setBusyKey(`refresh-${externalId}`);
    setError("");
    try {
      await animeApi.refreshAniRssSubscription(externalId);
      await addLog("SUCCESS", `已请求 ANI-RSS 刷新订阅: ${item.title || externalId}`);
      await loadSubscriptions(false, true);
    } catch (err) {
      setError(getApiErrorMessage(err, "刷新 ANI-RSS 订阅失败"));
    } finally {
      setBusyKey("");
    }
  };

  const previewExistingAniRssSubscription = async (item: AniRssListItem) => {
    const externalId = String(item.external_subscription_id || item.id || "").trim();
    if (!externalId) return;
    setBusyKey(`preview-existing-${externalId}`);
    setError("");
    try {
      const response = await animeApi.previewExistingAniRssSubscription(externalId, 5);
      if (response.data.item) {
        setSubscriptions((current) => current.map((sub) => {
          const subId = String(sub.external_subscription_id || sub.id || "").trim();
          return subId === externalId ? { ...sub, ...response.data.item } : sub;
        }));
        setPreviewLoaded(true);
      }
      await addLog("SUCCESS", `ANI-RSS 单项预览完成: ${item.title || externalId}`);
    } catch (err) {
      setError(getApiErrorMessage(err, "预览 ANI-RSS 订阅命中失败"));
    } finally {
      setBusyKey("");
    }
  };

  const deleteAniRssSubscription = async (item: AniRssListItem) => {
    const externalId = String(item.external_subscription_id || item.id || "").trim();
    if (!externalId || getAniStatus(item) === "missing") return;
    const title = String(item.title || externalId).trim();
    const confirmed = window.confirm(`确认删除 ANI-RSS 追番「${title}」？\n\n此操作只删除 ANI-RSS 订阅和本地镜像，不删除已下载文件。`);
    if (!confirmed) return;
    setBusyKey(`delete-${externalId}`);
    setError("");
    try {
      await animeApi.deleteAniRssSubscription(externalId);
      setSubscriptions((current) => current.filter((sub) => {
        const subId = String(sub.external_subscription_id || sub.id || "").trim();
        return subId !== externalId;
      }));
      await addLog("WARN", `已删除 ANI-RSS 追番订阅: ${title}`);
    } catch (err) {
      setError(getApiErrorMessage(err, "删除 ANI-RSS 订阅失败"));
    } finally {
      setBusyKey("");
    }
  };

  const checkAniRss = async () => {
    setBusyKey("health");
    setError("");
    try {
      await animeApi.checkAniRssHealth();
      await addLog("SUCCESS", "ANI-RSS 连通性检测通过");
      await loadConfig();
    } catch (err) {
      setError(getApiErrorMessage(err, "ANI-RSS 连通性检测失败"));
    } finally {
      setBusyKey("");
    }
  };

  const checkDownloadClient = async () => {
    setBusyKey("download-client-check");
    setError("");
    try {
      const response = await animeApi.getAniRssDownloadClientStatus();
      setDownloadClientStatus(response.data);
      await addLog("SUCCESS", "ANI-RSS 下载器配置检测完成");
    } catch (err) {
      setError(getApiErrorMessage(err, "检测 ANI-RSS 下载器配置失败"));
    } finally {
      setBusyKey("");
    }
  };

  const applyDownloadClientDefaults = async () => {
    setBusyKey("download-client-apply");
    setError("");
    try {
      const response = await animeApi.applyAniRssDownloadClientDefaults();
      setDownloadClientStatus(response.data.status || null);
      await addLog("SUCCESS", response.data.message || "已同步 ANI-RSS 下载器安全配置");
    } catch (err) {
      setError(getApiErrorMessage(err, "同步 ANI-RSS 下载器安全配置失败"));
    } finally {
      setBusyKey("");
    }
  };

  const metricCards: { key: AniFilter; label: string; value: number; tone: string }[] = [
    { key: "all" as AniFilter, label: "全部订阅", value: subscriptionStats.total, tone: "var(--brand-primary)" },
    { key: "tracking" as AniFilter, label: "追新中", value: subscriptionStats.tracking, tone: "var(--accent-ok)" },
    { key: "paused" as AniFilter, label: "已暂停", value: subscriptionStats.paused, tone: "var(--txt-secondary)" },
    { key: "error" as AniFilter, label: "异常", value: subscriptionStats.error, tone: "var(--accent-danger)" },
    { key: "missing" as AniFilter, label: "外部缺失", value: subscriptionStats.missing, tone: "var(--accent-warn)" },
  ];

  return (
    <div id="anime-tab-container" className="liquid-page space-y-6">
      <div className="liquid-hero glass-heavy glass-iridescent glass-spotlight rounded-3xl p-6">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-black tracking-tight flex items-center gap-2.5" style={{ color: "var(--txt)" }}>
              <Clapperboard className="w-6 h-6" style={{ color: "var(--brand-primary)" }} />
              <span>动漫追番</span>
            </h2>
            <p className="text-xs mt-1 max-w-2xl leading-relaxed" style={{ color: "var(--txt-secondary)" }}>
              ANI-RSS 外部追番状态、命中预览和下载器安全闭环。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-black px-2.5 py-1 rounded-lg" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>
              ANI-RSS：{statusText}
            </span>
            <span className="text-[10px] font-black px-2.5 py-1 rounded-lg" style={{ background: "var(--surface-subtle)", color: downloadClientStatus?.ready ? "var(--accent-ok)" : "var(--txt-secondary)", border: "1px solid var(--border)" }}>
              下载器：{downloadClientText}
            </span>
            <button
              type="button"
              onClick={() => setShowAddPanel((value) => !value)}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-black text-white cursor-pointer disabled:opacity-60"
              style={{ background: "var(--brand-primary)" }}
            >
              {showAddPanel ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              {showAddPanel ? "收起添加" : "添加追番"}
            </button>
            <button
              type="button"
              onClick={checkAniRss}
              disabled={busyKey === "health"}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-black glass-hover disabled:opacity-60 cursor-pointer"
              style={{ color: "var(--brand-primary)", border: "1px solid var(--brand-primary-border-alpha)", background: "var(--brand-primary-bg-alpha)" }}
            >
              {busyKey === "health" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              检测连接
            </button>
            {onNavigateToSettings && (
              <button
                type="button"
                onClick={onNavigateToSettings}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-black glass-hover cursor-pointer"
                style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)", background: "var(--surface)" }}
              >
                <Settings className="w-3.5 h-3.5" />
                配置
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="glass-heavy glass-iridescent rounded-2xl p-4 flex items-start gap-2" style={{ border: "1px solid rgba(245,158,11,0.28)", color: "var(--accent-warn)" }}>
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="text-xs font-bold leading-relaxed">{error}</p>
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
        {metricCards.map((item) => {
          const active = statusFilter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setStatusFilter(item.key)}
              className={`liquid-panel glass rounded-2xl p-4 text-left cursor-pointer transition-all ${active ? "card-selected" : ""}`}
              style={{ border: active ? "1px solid var(--brand-primary)" : "1px solid var(--border)" }}
            >
              <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>{item.label}</p>
              <p className="text-2xl font-black mt-2" style={{ color: item.tone }}>{item.value}</p>
            </button>
          );
        })}
      </section>

      <section className="liquid-panel glass rounded-3xl p-5 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <Activity className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
              追番看板
              <span className="text-xs font-semibold" style={{ color: "var(--txt-muted)" }}>({filteredSubscriptions.length}/{subscriptions.length})</span>
            </h3>
            <p className="text-[10px] font-bold mt-1" style={{ color: "var(--txt-muted)" }}>
              {previewLoaded
                ? "本次同步包含命中预览"
                : listSyncedLocal
                  ? "当前已同步本地追番镜像"
                  : "当前为只读外部状态"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {ANIME_FILTERS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setStatusFilter(item.key)}
                  className="px-2.5 py-1.5 rounded-lg text-[9px] font-black glass-hover cursor-pointer"
                  style={statusFilter === item.key
                    ? { color: "var(--brand-primary)", background: "var(--brand-primary-bg-alpha)", border: "1px solid var(--brand-primary-border-alpha)" }
                    : { color: "var(--txt-secondary)", background: "var(--surface)", border: "1px solid var(--border)" }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as AniSort)}
              className="text-[10px] font-bold px-2.5 py-1.5 input-premium"
              aria-label="追番排序"
            >
              <option value="recent">最近命中</option>
              <option value="title">标题</option>
              <option value="progress">集数进度</option>
              <option value="status">状态</option>
            </select>
            <button
              type="button"
              onClick={() => void loadSubscriptions(false, true)}
              disabled={busyKey === "sync"}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black glass-hover disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
              style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)", background: "var(--surface)" }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busyKey === "sync" ? "animate-spin" : ""}`} />
              同步外部状态
            </button>
            <button
              type="button"
              onClick={() => void loadSubscriptions(true, true)}
              disabled={busyKey === "sync-preview"}
              className="px-3 py-1.5 rounded-lg text-[10px] font-black glass-hover disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
              style={{ color: "var(--brand-primary)", border: "1px solid var(--brand-primary-border-alpha)", background: "var(--brand-primary-bg-alpha)" }}
            >
              <Search className={`w-3.5 h-3.5 ${busyKey === "sync-preview" ? "animate-spin" : ""}`} />
              同步并预览命中
            </button>
          </div>
        </div>

        {subscriptions.length === 0 ? (
          <div className="py-10 text-center rounded-2xl" style={{ background: "var(--surface-subtle)", border: "1px dashed var(--border)" }}>
            <p className="text-xs font-bold" style={{ color: "var(--txt-muted)" }}>暂无 ANI-RSS 订阅，或尚未配置连通。</p>
            <button
              type="button"
              onClick={() => setShowAddPanel(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-black text-white cursor-pointer"
              style={{ background: "var(--brand-primary)" }}
            >
              <Plus className="w-3.5 h-3.5" />
              添加追番
            </button>
          </div>
        ) : filteredSubscriptions.length === 0 ? (
          <div className="py-8 text-center rounded-2xl" style={{ background: "var(--surface-subtle)", border: "1px dashed var(--border)" }}>
            <p className="text-xs font-bold" style={{ color: "var(--txt-muted)" }}>当前筛选下没有订阅。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredSubscriptions.map((item) => {
              const itemId = String(item.external_subscription_id || item.id || "");
              const toggleBusy = busyKey === `toggle-${itemId}`;
              const refreshBusy = busyKey === `refresh-${itemId}`;
              const previewBusy = busyKey === `preview-existing-${itemId}`;
              const deleteBusy = busyKey === `delete-${itemId}`;
              const enabled = getAniEnabled(item);
              const statusStyle = getAniStatusStyle(item);
              const rss = getAniRssUrl(item);
              const downloadPathValue = getAniDownloadPath(item);
              const matchedCount = Number(item.matched_count || 0);
              const ignoredCount = Number(item.duplicate_ignored_count || 0);
              const recentHitTitle = getAniRecentHitTitle(item);
              return (
                <div key={item.id || item.external_subscription_id || item.title} className="rounded-2xl p-3 min-h-[190px] flex flex-col" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-xs font-black line-clamp-2 min-h-[2.25rem]" style={{ color: "var(--txt)" }}>{item.title || "未命名订阅"}</h4>
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-black shrink-0" style={statusStyle}>
                      {getAniStatusLabel(item)}
                    </span>
                  </div>
                  <p className="text-[10px] font-bold mt-1" style={{ color: "var(--txt-muted)" }}>
                    {item.subgroup || "字幕组未知"} · {getAniCurrentEpisode(item)}/{getAniTotalEpisodes(item)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold" style={{ color: "var(--txt-secondary)" }}>
                    <span>{getAniCustomDownloadPath(item) ? "自定义路径" : "默认路径"}</span>
                    {hasPreviewCounts(item) && (
                      <>
                        <span>命中 {matchedCount}</span>
                        <span>去重忽略 {ignoredCount}</span>
                      </>
                    )}
                  </div>
                  {recentHitTitle && (
                    <p className="text-[10px] mt-2 line-clamp-1" title={recentHitTitle} style={{ color: "var(--accent-ok)" }}>
                      最近命中：{recentHitTitle}
                    </p>
                  )}
                  {item.recent_error && (
                    <p className="text-[10px] mt-2 line-clamp-2" title={String(item.recent_error)} style={{ color: "var(--accent-warn)" }}>
                      最近错误：{String(item.recent_error)}
                    </p>
                  )}
                  {downloadPathValue && (
                    <p className="text-[10px] mt-2 line-clamp-1 break-all" title={downloadPathValue} style={{ color: "var(--txt-muted)" }}>
                      {downloadPathValue}
                    </p>
                  )}
                  <p className="text-[10px] mt-2 line-clamp-2 break-all" style={{ color: "var(--txt-secondary)" }}>{rss || "无 RSS 地址"}</p>
                  <div className="mt-auto pt-3 flex flex-wrap gap-2">
                    {getAniStatus(item) !== "missing" && (
                      <button
                        type="button"
                        onClick={() => void toggleAniRssSubscription(item)}
                        disabled={!itemId || toggleBusy}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[9px] font-black glass-hover disabled:opacity-50 cursor-pointer"
                        title={enabled ? "点击暂停 ANI-RSS 追新" : "点击启用 ANI-RSS 追新，可能开始添加下载任务"}
                        style={enabled
                          ? { color: "var(--accent-ok)", background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.24)" }
                          : { color: "var(--brand-primary)", background: "var(--brand-primary-bg-alpha)", border: "1px solid var(--brand-primary-border-alpha)" }}
                      >
                        {toggleBusy ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : enabled ? (
                          <Pause className="w-3 h-3" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                        {enabled ? "暂停追新" : "启用追新"}
                      </button>
                    )}
                    {getAniStatus(item) !== "missing" && (
                      <button
                        type="button"
                        onClick={() => void refreshAniRssSubscription(item)}
                        disabled={!itemId || refreshBusy}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[9px] font-black glass-hover disabled:opacity-50 cursor-pointer"
                        title="请求 ANI-RSS 同步此订阅"
                        style={{ color: "var(--txt-secondary)", background: "var(--surface)", border: "1px solid var(--border)" }}
                      >
                        {refreshBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        同步此项
                      </button>
                    )}
                    {getAniStatus(item) !== "missing" && (
                      <button
                        type="button"
                        onClick={() => void previewExistingAniRssSubscription(item)}
                        disabled={!itemId || previewBusy}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[9px] font-black glass-hover disabled:opacity-50 cursor-pointer"
                        style={{ color: "var(--brand-primary)", background: "var(--brand-primary-bg-alpha)", border: "1px solid var(--brand-primary-border-alpha)" }}
                      >
                        {previewBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                        预览命中
                      </button>
                    )}
                    {getAniStatus(item) !== "missing" && (
                      <button
                        type="button"
                        onClick={() => void deleteAniRssSubscription(item)}
                        disabled={!itemId || deleteBusy}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[9px] font-black glass-hover disabled:opacity-50 cursor-pointer"
                        title="删除 ANI-RSS 订阅；不会删除已下载文件"
                        style={{ color: "var(--accent-danger)", background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.24)" }}
                      >
                        {deleteBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                        删除
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="liquid-panel glass rounded-3xl p-5 space-y-3">
          <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
            <Server className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
            ANI-RSS 接入
          </h3>
          <div className="space-y-2 text-[10px] font-bold">
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: "var(--txt-muted)" }}>状态</span>
              <span style={{ color: aniRssReady ? "var(--accent-ok)" : "var(--accent-warn)" }}>{statusText}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: "var(--txt-muted)" }}>地址</span>
              <span className="truncate max-w-[220px]" title={config?.base_url || ""} style={{ color: "var(--txt-secondary)" }}>{config?.base_url || "-"}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span style={{ color: "var(--txt-muted)" }}>API Key</span>
              <span style={{ color: config?.api_key_configured ? "var(--accent-ok)" : "var(--accent-warn)" }}>{config?.api_key_configured ? "已配置" : "未配置"}</span>
            </div>
          </div>
        </div>
        <div className="liquid-panel glass rounded-3xl p-5 space-y-3 xl:col-span-2">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <ShieldCheck className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
              下载器安全
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={checkDownloadClient}
                disabled={busyKey === "download-client-check"}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black glass-hover disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)", background: "var(--surface)" }}
              >
                {busyKey === "download-client-check" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                检测下载器
              </button>
              <button
                type="button"
                onClick={applyDownloadClientDefaults}
                disabled={busyKey === "download-client-apply"}
                className="px-3 py-1.5 rounded-lg text-[10px] font-black glass-hover disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                style={{ color: "var(--accent-warn)", border: "1px solid rgba(245,158,11,0.28)", background: "rgba(245,158,11,0.10)" }}
              >
                {busyKey === "download-client-apply" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                同步安全配置
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px] font-bold">
            <div className="rounded-xl px-3 py-2" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}>
              <span className="block text-[9px] font-black uppercase" style={{ color: "var(--txt-muted)" }}>qBittorrent</span>
              <span className="block truncate">{downloadClientStatus?.qbittorrent?.version || "-"}</span>
              <span className="block truncate">{downloadClientStatus?.qbittorrent?.base_url || "-"}</span>
            </div>
            <div className="rounded-xl px-3 py-2" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}>
              <span className="block text-[9px] font-black uppercase" style={{ color: "var(--txt-muted)" }}>任务与开关</span>
              <span className="block">任务数：{downloadClientStatus?.qbittorrent?.torrent_count ?? "-"}</span>
              <span className="block">downloadNew：{downloadClientStatus?.actual?.download_new ? "开" : "关"}</span>
              <span className="block">autoStart：{downloadClientStatus?.actual?.auto_start ? "开" : "关"}</span>
            </div>
            <div className="rounded-xl px-3 py-2" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}>
              <span className="block text-[9px] font-black uppercase" style={{ color: "var(--txt-muted)" }}>下载路径</span>
              <span className="block truncate">{downloadClientStatus?.actual?.download_path_template || "-"}</span>
              <span className="block">qbUseDownloadPath：{downloadClientStatus?.actual?.qb_use_download_path ? "开" : "关"}</span>
            </div>
          </div>
          {!!downloadClientStatus?.issues?.length && (
            <p className="text-[10px] font-bold leading-relaxed" style={{ color: "var(--accent-warn)" }}>
              {downloadClientStatus.issues.join("；")}
            </p>
          )}
          {!!downloadClientStatus?.unsafe_flags?.length && (
            <p className="text-[10px] font-bold leading-relaxed" style={{ color: "var(--accent-danger)" }}>
              安全开关异常：{downloadClientStatus.unsafe_flags.join("；")}
            </p>
          )}
        </div>
      </section>

      {showAddPanel && (
        <section className="liquid-panel glass-heavy glass-iridescent rounded-3xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <Plus className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
              添加追番
            </h3>
            <button
              type="button"
              onClick={() => setShowAddPanel(false)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-black glass-hover cursor-pointer"
              style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)", background: "var(--surface)" }}
            >
              <X className="w-3.5 h-3.5" />
              关闭
            </button>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <section className="xl:col-span-7 rounded-2xl p-4 space-y-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between gap-3">
                <h4 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
                  <Search className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
                  Bangumi 搜番
                </h4>
              </div>
              <form onSubmit={runSearch} className="space-y-2">
                <label className="block space-y-1">
                  <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>Bangumi 关键词</span>
                  <div className="flex gap-2">
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="输入番名，例如 葬送的芙莉莲"
                      className="flex-1 px-4 py-3 rounded-2xl text-xs font-semibold outline-none"
                      style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" }}
                    />
                    <button
                      type="submit"
                      disabled={busyKey === "search" || !query.trim()}
                      className="px-4 py-3 rounded-2xl text-xs font-black text-white disabled:opacity-60 inline-flex items-center gap-1.5 cursor-pointer"
                      style={{ background: "var(--brand-primary)" }}
                    >
                      {busyKey === "search" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                      搜索
                    </button>
                  </div>
                </label>
              </form>

              {results.length === 0 ? (
                <div className="py-12 text-center rounded-2xl" style={{ background: "var(--surface-subtle)", border: "1px dashed var(--border)" }}>
                  <p className="text-xs font-bold" style={{ color: "var(--txt-muted)" }}>搜索并选择一个 Bangumi 条目。</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {results.map((subject) => {
                    const title = pickBangumiTitle(subject);
                    const active = selected?.id === subject.id;
                    return (
                      <button
                        key={subject.id}
                        type="button"
                        onClick={() => selectSubject(subject)}
                        className={`w-full glass-hover rounded-2xl p-3 flex gap-3 text-left transition-all cursor-pointer ${active ? "card-selected" : ""}`}
                        style={{ border: active ? "1px solid var(--brand-primary)" : "1px solid var(--border)" }}
                      >
                        <div className="w-14 h-20 rounded-xl overflow-hidden shrink-0" style={{ background: "var(--surface-subtle)" }}>
                          {pickBangumiPoster(subject) ? (
                            <img src={pickBangumiPoster(subject)} alt={title} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <Clapperboard className="w-5 h-5 m-auto mt-7" style={{ color: "var(--txt-muted)" }} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="text-sm font-black truncate" style={{ color: "var(--txt)" }}>{title || subject.name}</h4>
                            <span className="text-[9px] font-black shrink-0" style={{ color: "var(--accent-warn)" }}>
                              {pickBangumiRating(subject) ? `★ ${pickBangumiRating(subject)}` : "暂无评分"}
                            </span>
                          </div>
                          <p className="text-[10px] font-bold mt-0.5" style={{ color: "var(--txt-muted)" }}>
                            {subject.date || "日期未知"} · BGM {subject.id}
                          </p>
                          <p className="text-xs mt-2 line-clamp-2 leading-relaxed" style={{ color: "var(--txt-secondary)" }}>
                            {subject.summary || "暂无简介"}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="xl:col-span-5 rounded-2xl p-4 space-y-4" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <h4 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
                <Rss className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
                创建 ANI-RSS 订阅
              </h4>

              {selected ? (
                <div className="flex gap-3 rounded-2xl p-3" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                  <div className="w-14 h-20 rounded-xl overflow-hidden shrink-0">
                    {selectedPoster ? <img src={selectedPoster} alt={selectedTitle} className="w-full h-full object-cover" referrerPolicy="no-referrer" /> : null}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black truncate" style={{ color: "var(--txt)" }}>{selectedTitle}</p>
                    <a href={bgmUrl} target="_blank" rel="noreferrer" className="text-[10px] font-bold inline-flex items-center gap-1 mt-1" style={{ color: "var(--brand-primary)" }}>
                      Bangumi 条目 <ExternalLink className="w-3 h-3" />
                    </a>
                    <p className="text-[10px] font-bold mt-2" style={{ color: "var(--txt-muted)" }}>RSS 候选按当前 Bangumi 条目精确匹配。</p>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl p-4 text-xs font-bold" style={{ background: "var(--surface-subtle)", border: "1px dashed var(--border)", color: "var(--txt-muted)" }}>
                  请选择 Bangumi 条目。
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1 sm:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>RSS 地址</span>
                    <button
                      type="button"
                      onClick={() => void loadAniRssRssCandidates(selected)}
                      disabled={!selected || !aniRssReady || busyKey === "rss-candidates"}
                      title={!selected ? "请先选择 Bangumi 条目" : !aniRssReady ? "请先启用 ANI-RSS 并配置 API Key" : ""}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-black glass-hover disabled:opacity-50 cursor-pointer"
                      style={{ color: "var(--brand-primary)", border: "1px solid var(--brand-primary-border-alpha)", background: "var(--brand-primary-bg-alpha)" }}
                    >
                      {busyKey === "rss-candidates" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Rss className="w-3 h-3" />}
                      ANI-RSS 获取
                    </button>
                  </div>
                  <input
                    value={rssUrl}
                    onChange={(event) => {
                      setRssUrl(event.target.value);
                      setPreview(null);
                    }}
                    placeholder="https://example.com/rss.xml"
                    className="w-full text-xs font-mono px-3.5 py-2.5 input-premium"
                  />
                </label>
                {rssCandidates.length > 0 && (
                  <div className="sm:col-span-2 rounded-2xl p-3 space-y-2" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black" style={{ color: "var(--txt)" }}>ANI-RSS RSS 候选</span>
                      <span className="text-[9px] font-bold text-right" style={{ color: rssCandidateMatched ? "var(--accent-ok)" : "var(--accent-warn)" }}>
                        {rssCandidateMatched ? "已精确匹配 Bangumi" : "未匹配当前条目"}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-auto pr-1">
                      {visibleRssCandidates.map((candidate) => {
                        const active = rssUrl.trim() === String(candidate.rss_url || "").trim();
                        const candidateSubgroup = String(candidate.subgroup || "全部字幕组");
                        const candidateTitle = String(candidate.title || "ANI-RSS RSS");
                        const sourceLabel = getRssSourceLabel(candidate.source);
                        return (
                          <button
                            key={String(candidate.rss_url)}
                            type="button"
                            onClick={() => applyAniRssCandidate(candidate)}
                            className="rounded-xl px-3 py-2 text-left glass-hover cursor-pointer"
                            style={{ border: active ? "1px solid var(--brand-primary)" : "1px solid var(--border)", background: active ? "var(--brand-primary-bg-alpha)" : "var(--surface)" }}
                          >
                            <span className="flex items-center gap-1 min-w-0">
                              <span className="text-[8px] font-black rounded-md px-1.5 py-0.5 shrink-0" style={{ color: active ? "var(--brand-primary)" : "var(--txt-secondary)", background: active ? "var(--brand-primary-bg-alpha)" : "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                                {sourceLabel}
                              </span>
                              <span className="block text-[10px] font-black truncate" title={candidateTitle} style={{ color: active ? "var(--brand-primary)" : "var(--txt)" }}>{candidateTitle}</span>
                            </span>
                            <span className="block text-[9px] font-bold truncate mt-1" style={{ color: active ? "var(--brand-primary)" : "var(--txt-secondary)" }}>{candidateSubgroup}</span>
                            <span className="block text-[9px] font-mono truncate mt-1" style={{ color: "var(--txt-muted)" }}>{candidate.rss_url}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>RSS 来源</span>
                  <select value={rssType} onChange={(event) => handleRssTypeChange(event.target.value)} className="w-full text-xs px-3.5 py-2.5 input-premium">
                    <option value="mikan" disabled={rssCandidates.length > 0 && !rssCandidateCounts.mikan}>Mikan{rssCandidates.length > 0 ? ` (${rssCandidateCounts.mikan || 0})` : ""}</option>
                    <option value="ani-bt" disabled={rssCandidates.length > 0 && !rssCandidateCounts["ani-bt"]}>AniBT{rssCandidates.length > 0 ? ` (${rssCandidateCounts["ani-bt"] || 0})` : ""}</option>
                    <option value="anime-garden" disabled={rssCandidates.length > 0 && !rssCandidateCounts["anime-garden"]}>AnimeGarden{rssCandidates.length > 0 ? ` (${rssCandidateCounts["anime-garden"] || 0})` : ""}</option>
                    <option value="other">其他 RSS</option>
                  </select>
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>字幕组</span>
                  <input
                    value={subgroup}
                    onChange={(event) => {
                      setSubgroup(event.target.value);
                      setPreview(null);
                    }}
                    placeholder="留空时由 ANI-RSS 从 RSS 推断"
                    className="w-full text-xs px-3.5 py-2.5 input-premium"
                  />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>保存位置（可选）</span>
                  <input
                    value={downloadPath}
                    onChange={(event) => {
                      setDownloadPath(event.target.value);
                      setPreview(null);
                    }}
                    placeholder="留空使用 ANI-RSS 默认路径"
                    className="w-full text-xs font-mono px-3.5 py-2.5 input-premium"
                  />
                </label>
                {downloadPathPresets.length > 0 && (
                  <div className="sm:col-span-2 flex flex-wrap gap-1.5">
                    {downloadPathPresets.map((path) => (
                      <button
                        key={path}
                        type="button"
                        onClick={() => {
                          setDownloadPath(path);
                          setPreview(null);
                        }}
                        className="max-w-full rounded-lg px-2 py-1 text-[9px] font-mono font-bold truncate glass-hover cursor-pointer"
                        title={path}
                        style={{ color: "var(--txt-secondary)", background: "var(--surface-subtle)", border: "1px solid var(--border)" }}
                      >
                        {path}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl p-3" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                <p className="text-xs font-bold" style={{ color: "var(--txt-secondary)" }}>创建后保持停用</p>
                <p className="text-[10px] font-bold mt-1" style={{ color: "var(--txt-muted)" }}>
                  需要下载时，在追番看板中显式启用追新。
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={previewAniRss}
                  disabled={!canSubmitAniRss || busyKey === "preview"}
                  title={!canSubmitAniRss ? createDisabledReason : ""}
                  className="px-3 py-2 rounded-xl text-[10px] font-black glass-hover disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                  style={{ color: "var(--brand-primary)", border: "1px solid var(--brand-primary-border-alpha)", background: "var(--brand-primary-bg-alpha)" }}
                >
                  {busyKey === "preview" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  预览命中
                </button>
                <button
                  type="button"
                  onClick={createAniRss}
                  disabled={!canSubmitAniRss || busyKey === "create"}
                  title={!canSubmitAniRss ? createDisabledReason : ""}
                  className="px-3 py-2 rounded-xl text-[10px] font-black text-white disabled:opacity-50 inline-flex items-center gap-1.5 cursor-pointer"
                  style={{ background: "var(--brand-primary)" }}
                >
                  {busyKey === "create" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  创建停用订阅
                </button>
                {!canSubmitAniRss && createDisabledReason && (
                  <span className="self-center text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>{createDisabledReason}</span>
                )}
              </div>

              {preview && (
                <div className="rounded-2xl p-3 space-y-3" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                  <p className="text-[10px] font-black mb-2 flex items-center gap-1" style={{ color: "var(--accent-ok)" }}>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    ANI-RSS 预览已返回
                  </p>
                  {previewSummary ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="rounded-xl p-2" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                        <p className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>命中</p>
                        <p className="text-sm font-black" style={{ color: "var(--txt)" }}>{previewSummary.itemCount}</p>
                      </div>
                      <div className="rounded-xl p-2" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
                        <p className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>已忽略</p>
                        <p className="text-sm font-black" style={{ color: "var(--txt)" }}>{previewSummary.omitCount}</p>
                      </div>
                    </div>
                  ) : null}
                  {previewSummary?.itemTitles.length ? (
                    <div className="space-y-1">
                      {previewSummary.itemTitles.map((title) => (
                        <p key={title} className="text-[10px] font-bold truncate" title={title} style={{ color: "var(--txt-secondary)" }}>{title}</p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] font-bold" style={{ color: "var(--txt-muted)" }}>没有可展示的预览条目。</p>
                  )}
                </div>
              )}
            </section>
          </div>
        </section>
      )}
    </div>
  );
}
