import React, { useEffect, useMemo, useState } from "react";
import {
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
} from "lucide-react";
import { animeApi } from "../api/anime";
import type { AniRssConfig, AniRssRssCandidate, AniRssSubscriptionStatus, BangumiSubject } from "../api/types";
import { getApiErrorMessage } from "../api/errors";

interface AnimeTabProps {
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => Promise<void>;
}

type AniRssListItem = AniRssSubscriptionStatus;

type PreviewSummary = {
  itemCount: number;
  omitCount: number;
  itemTitles: string[];
};

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

export default function AnimeTab({ addLog }: AnimeTabProps) {
  const [config, setConfig] = useState<AniRssConfig | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BangumiSubject[]>([]);
  const [selected, setSelected] = useState<BangumiSubject | null>(null);
  const [rssUrl, setRssUrl] = useState("");
  const [rssType, setRssType] = useState("mikan");
  const [subgroup, setSubgroup] = useState("");
  const [downloadPath, setDownloadPath] = useState("");
  const [enable, setEnable] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [subscriptions, setSubscriptions] = useState<AniRssListItem[]>([]);
  const [rssCandidates, setRssCandidates] = useState<AniRssRssCandidate[]>([]);
  const [rssCandidateMatched, setRssCandidateMatched] = useState<boolean | null>(null);

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

  const loadConfig = async () => {
    try {
      const response = await animeApi.getAniRssConfig();
      setConfig(response.data);
    } catch (err) {
      setError(getApiErrorMessage(err, "读取 ANI-RSS 配置失败"));
    }
  };

  const loadSubscriptions = async () => {
    setBusyKey("list");
    try {
      const response = await animeApi.syncAniRssSubscriptions({ includePreview: true, previewLimit: 5 });
      setSubscriptions(flattenAniRssList(response.data));
    } catch (err) {
      setError(getApiErrorMessage(err, "读取 ANI-RSS 订阅失败"));
    } finally {
      setBusyKey("");
    }
  };

  useEffect(() => {
    void loadConfig();
  }, []);

  useEffect(() => {
    if (config?.enabled && config.api_key_configured) {
      void loadSubscriptions();
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
      enable,
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
      await addLog("SUCCESS", `已创建 ANI-RSS 追番订阅: ${selectedTitle}`);
      setPreview(null);
      await loadSubscriptions();
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
      await loadSubscriptions();
    } catch (err) {
      setError(getApiErrorMessage(err, "切换 ANI-RSS 订阅状态失败"));
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
      await loadSubscriptions();
    } catch (err) {
      setError(getApiErrorMessage(err, "ANI-RSS 连通性检测失败"));
    } finally {
      setBusyKey("");
    }
  };

  return (
    <div id="anime-tab-container" className="liquid-page space-y-6">
      <div className="liquid-hero glass-heavy glass-iridescent glass-spotlight rounded-3xl p-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black tracking-tight flex items-center gap-2.5" style={{ color: "var(--txt)" }}>
              <Clapperboard className="w-6 h-6" style={{ color: "var(--brand-primary)" }} />
              <span>动漫追番</span>
            </h2>
            <p className="text-xs mt-1 max-w-2xl leading-relaxed" style={{ color: "var(--txt-secondary)" }}>
              Bangumi 负责番剧身份，ANI-RSS 负责日番 RSS 去重追新，MoviePilot 继续承担 PT 资源通道。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black px-2.5 py-1 rounded-lg" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>
              ANI-RSS：{statusText}
            </span>
            <button
              type="button"
              onClick={checkAniRss}
              disabled={busyKey === "health"}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-black glass-hover disabled:opacity-60"
              style={{ color: "var(--brand-primary)", border: "1px solid var(--brand-primary-border-alpha)", background: "var(--brand-primary-bg-alpha)" }}
            >
              {busyKey === "health" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              检测
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="glass-heavy glass-iridescent rounded-2xl p-4 flex items-start gap-2" style={{ border: "1px solid rgba(245,158,11,0.28)", color: "var(--accent-warn)" }}>
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <p className="text-xs font-bold leading-relaxed">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <section className="xl:col-span-7 liquid-panel glass rounded-3xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <Search className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
              Bangumi 搜番
            </h3>
          </div>
          <form onSubmit={runSearch} className="flex gap-2">
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
              className="px-4 py-3 rounded-2xl text-xs font-black text-white disabled:opacity-60 inline-flex items-center gap-1.5"
              style={{ background: "var(--brand-primary)" }}
            >
              {busyKey === "search" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              搜索
            </button>
          </form>

          {results.length === 0 ? (
            <div className="py-12 text-center rounded-2xl" style={{ background: "var(--surface-subtle)", border: "1px dashed var(--border)" }}>
              <p className="text-xs font-bold" style={{ color: "var(--txt-muted)" }}>先搜索并选择一个 Bangumi 条目。</p>
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
                    className={`w-full glass-hover rounded-2xl p-3 flex gap-3 text-left transition-all ${active ? "card-selected" : ""}`}
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

        <section className="xl:col-span-5 liquid-panel glass-heavy glass-iridescent rounded-3xl p-5 space-y-4">
          <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
            <Rss className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
            创建 ANI-RSS 订阅
          </h3>

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
                <p className="text-[10px] font-bold mt-2" style={{ color: "var(--txt-muted)" }}>会通过 ANI-RSS API 精确匹配 Mikan、AniBT、AnimeGarden RSS，也可以手动填写其他 RSS。</p>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl p-4 text-xs font-bold" style={{ background: "var(--surface-subtle)", border: "1px dashed var(--border)", color: "var(--txt-muted)" }}>
              先从左侧选择 Bangumi 条目，再创建追番订阅。
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
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[9px] font-black glass-hover disabled:opacity-50"
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
                        className="rounded-xl px-3 py-2 text-left glass-hover"
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
              <input value={subgroup} onChange={(event) => setSubgroup(event.target.value)} placeholder="留空时由 ANI-RSS 从 RSS 推断" className="w-full text-xs px-3.5 py-2.5 input-premium" />
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
          </div>

          <div className="rounded-2xl p-3" style={{ background: enable ? "rgba(245,158,11,0.10)" : "var(--surface-subtle)", border: enable ? "1px solid rgba(245,158,11,0.28)" : "1px solid var(--border)" }}>
            <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer" style={{ color: "var(--txt-secondary)" }}>
              <input type="checkbox" checked={enable} onChange={(event) => setEnable(event.target.checked)} className="accent-brand-primary" />
              创建后立即启用订阅
            </label>
            <p className="text-[10px] font-bold mt-1" style={{ color: enable ? "var(--accent-warn)" : "var(--txt-muted)" }}>
              {enable ? "启用后可能立即向 qBittorrent 添加任务。" : "默认先创建为停用状态，不会触发真实下载。"}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={previewAniRss}
              disabled={!canSubmitAniRss || busyKey === "preview"}
              title={!canSubmitAniRss ? createDisabledReason : ""}
              className="px-3 py-2 rounded-xl text-[10px] font-black glass-hover disabled:opacity-50 inline-flex items-center gap-1.5"
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
              className="px-3 py-2 rounded-xl text-[10px] font-black text-white disabled:opacity-50 inline-flex items-center gap-1.5"
              style={{ background: "var(--brand-primary)" }}
            >
              {busyKey === "create" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              创建订阅
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

      <section className="liquid-panel glass rounded-3xl p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
            <Rss className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
            ANI-RSS 外部订阅
            <span className="text-xs font-semibold" style={{ color: "var(--txt-muted)" }}>({subscriptions.length})</span>
          </h3>
          <button
            type="button"
            onClick={loadSubscriptions}
            disabled={busyKey === "list"}
            className="px-3 py-1.5 rounded-lg text-[10px] font-black glass-hover disabled:opacity-50 inline-flex items-center gap-1.5"
            style={{ color: "var(--txt-secondary)", border: "1px solid var(--border)", background: "var(--surface)" }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${busyKey === "list" ? "animate-spin" : ""}`} />
            刷新
          </button>
        </div>

        {subscriptions.length === 0 ? (
          <div className="py-8 text-center rounded-2xl" style={{ background: "var(--surface-subtle)", border: "1px dashed var(--border)" }}>
            <p className="text-xs font-bold" style={{ color: "var(--txt-muted)" }}>暂无 ANI-RSS 订阅，或尚未配置连通。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {subscriptions.map((item) => {
              const itemId = String(item.external_subscription_id || item.id || "");
              const toggleBusy = busyKey === `toggle-${itemId}`;
              const enabled = getAniEnabled(item);
              const statusStyle = getAniStatusStyle(item);
              const rss = getAniRssUrl(item);
              const downloadPathValue = getAniDownloadPath(item);
              const matchedCount = Number(item.matched_count || 0);
              const ignoredCount = Number(item.duplicate_ignored_count || 0);
              const recentHitTitle = getAniRecentHitTitle(item);
              return (
                <div key={item.id || item.title} className="rounded-2xl p-3" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-xs font-black line-clamp-2" style={{ color: "var(--txt)" }}>{item.title || "未命名订阅"}</h4>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-black" style={statusStyle}>
                        {getAniStatusLabel(item)}
                      </span>
                      {getAniStatus(item) !== "missing" && (
                        <button
                          type="button"
                          onClick={() => void toggleAniRssSubscription(item)}
                          disabled={!itemId || toggleBusy}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-black glass-hover disabled:opacity-50 cursor-pointer"
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
                    </div>
                  </div>
                  <p className="text-[10px] font-bold mt-1" style={{ color: "var(--txt-muted)" }}>
                    {item.subgroup || "字幕组未知"} · {getAniCurrentEpisode(item)}/{getAniTotalEpisodes(item)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold" style={{ color: "var(--txt-secondary)" }}>
                    <span>{getAniCustomDownloadPath(item) ? "自定义路径" : "默认路径"}</span>
                    <span>命中 {matchedCount}</span>
                    <span>去重忽略 {ignoredCount}</span>
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
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
