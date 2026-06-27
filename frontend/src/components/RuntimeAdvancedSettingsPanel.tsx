import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Cloud,
  RefreshCw,
  Rss,
  Save,
  Search,
  Send,
  Server,
  SlidersHorizontal,
  UserRound,
  Wifi,
} from "lucide-react";
import CollapsibleSection from "./CollapsibleSection";
import { settingsApi } from "../api/settings";
import type { RuntimeSettings } from "../api/types";
import { getApiErrorMessage } from "../api/errors";

type LogLevel = "INFO" | "SUCCESS" | "WARN" | "ERROR";

interface RuntimeAdvancedSettingsPanelProps {
  addLog: (level: LogLevel, message: string) => void | Promise<void>;
}

interface AdvancedRuntimeForm {
  hdhiveCookie: string;
  hdhiveBaseUrl: string;
  hdhiveLoginUsername: string;
  hdhiveAutoCheckinEnabled: boolean;
  hdhiveAutoCheckinMode: string;
  hdhiveAutoCheckinMethod: string;
  hdhiveAutoCheckinRunTime: string;
  httpProxy: string;
  httpsProxy: string;
  allProxy: string;
  socksProxy: string;
  tmdbApiKey: string;
  tmdbBaseUrl: string;
  tmdbImageBaseUrl: string;
  tmdbLanguage: string;
  tmdbRegion: string;
  pansouBaseUrl: string;
  tgIndexEnabled: boolean;
  tgSession: string;
  tgIndexRealtimeFallbackEnabled: boolean;
  tgIndexQueryLimitPerChannel: number;
  tgBackfillBatchSize: number;
  tgIncrementalIntervalMinutes: number;
  embySyncEnabled: boolean;
  embySyncIntervalMinutes: number;
  feiniuUrl: string;
  feiniuApiKey: string;
  feiniuSessionToken: string;
  feiniuSyncEnabled: boolean;
  feiniuSyncIntervalMinutes: number;
  subscriptionEnabled: boolean;
  subscriptionIntervalHours: number;
  subscriptionResourcePriority: string[];
  subscriptionOfflineTransferEnabled: boolean;
  subscriptionHdhiveAutoUnlockEnabled: boolean;
  subscriptionHdhiveUnlockMaxPointsPerItem: number;
  subscriptionHdhiveUnlockBudgetPointsPerRun: number;
  subscriptionHdhiveUnlockThresholdInclusive: boolean;
  subscriptionHdhivePreferFree: boolean;
  resourcePreferredResolutions: string;
  resourcePreferredHdr: string;
  resourcePreferredCodec: string;
  resourcePreferredAudio: string;
  resourcePreferredSubtitles: string;
  resourceExcludeTags: string;
  resourceMinSizeGb: string;
  resourceMaxSizeGb: string;
  chartSubscriptionEnabled: boolean;
  chartSubscriptionSourcesInput: string;
  chartSubscriptionLimit: number;
  chartSubscriptionIntervalHours: number;
  personFollowEnabled: boolean;
  personFollowIntervalHours: number;
  personFollowAutoSubscribe: boolean;
  updateSourceType: string;
  updateRepository: string;
  detailVisibleTabs: string[];
}

const SOURCE_OPTIONS = [
  { key: "hdhive", label: "HDHive" },
  { key: "pansou", label: "Pansou" },
  { key: "tg", label: "TG" },
];

const DETAIL_TAB_OPTIONS = [
  { key: "pan115", label: "115 聚合" },
  { key: "pan115_pansou", label: "115 Pansou" },
  { key: "pan115_hdhive", label: "115 HDHive" },
  { key: "pan115_tg", label: "115 TG" },
  { key: "quark", label: "夸克聚合" },
  { key: "quark_pansou", label: "夸克 Pansou" },
  { key: "quark_hdhive", label: "夸克 HDHive" },
  { key: "quark_tg", label: "夸克 TG" },
  { key: "magnet", label: "磁力聚合" },
  { key: "magnet_seedhub", label: "SeedHub" },
  { key: "magnet_butailing", label: "不太灵" },
];

const DEFAULT_FORM: AdvancedRuntimeForm = {
  hdhiveCookie: "",
  hdhiveBaseUrl: "https://hdhive.com/",
  hdhiveLoginUsername: "",
  hdhiveAutoCheckinEnabled: false,
  hdhiveAutoCheckinMode: "normal",
  hdhiveAutoCheckinMethod: "cookie",
  hdhiveAutoCheckinRunTime: "09:00",
  httpProxy: "",
  httpsProxy: "",
  allProxy: "",
  socksProxy: "",
  tmdbApiKey: "",
  tmdbBaseUrl: "https://api.themoviedb.org/3",
  tmdbImageBaseUrl: "https://image.tmdb.org/t/p/w500",
  tmdbLanguage: "zh-CN",
  tmdbRegion: "CN",
  pansouBaseUrl: "",
  tgIndexEnabled: true,
  tgSession: "",
  tgIndexRealtimeFallbackEnabled: true,
  tgIndexQueryLimitPerChannel: 120,
  tgBackfillBatchSize: 200,
  tgIncrementalIntervalMinutes: 30,
  embySyncEnabled: false,
  embySyncIntervalMinutes: 1440,
  feiniuUrl: "",
  feiniuApiKey: "",
  feiniuSessionToken: "",
  feiniuSyncEnabled: false,
  feiniuSyncIntervalMinutes: 1440,
  subscriptionEnabled: false,
  subscriptionIntervalHours: 24,
  subscriptionResourcePriority: ["hdhive", "pansou", "tg"],
  subscriptionOfflineTransferEnabled: false,
  subscriptionHdhiveAutoUnlockEnabled: false,
  subscriptionHdhiveUnlockMaxPointsPerItem: 10,
  subscriptionHdhiveUnlockBudgetPointsPerRun: 30,
  subscriptionHdhiveUnlockThresholdInclusive: true,
  subscriptionHdhivePreferFree: true,
  resourcePreferredResolutions: "",
  resourcePreferredHdr: "",
  resourcePreferredCodec: "",
  resourcePreferredAudio: "",
  resourcePreferredSubtitles: "",
  resourceExcludeTags: "CAM\nTS\n抢先版",
  resourceMinSizeGb: "",
  resourceMaxSizeGb: "",
  chartSubscriptionEnabled: false,
  chartSubscriptionSourcesInput: "",
  chartSubscriptionLimit: 20,
  chartSubscriptionIntervalHours: 24,
  personFollowEnabled: false,
  personFollowIntervalHours: 24,
  personFollowAutoSubscribe: true,
  updateSourceType: "official",
  updateRepository: "wangsy1007/mediasync115",
  detailVisibleTabs: DETAIL_TAB_OPTIONS.map((item) => item.key),
};

function stringValue(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  return String(value);
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function optionalNumberValue(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatListInput(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((item) => String(item ?? "").trim()).filter(Boolean).join("\n");
}

function parseListInput(value: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  String(value || "")
    .split(/[\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => {
      if (seen.has(item)) return;
      seen.add(item);
      items.push(item);
    });
  return items;
}

function normalizePriority(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : DEFAULT_FORM.subscriptionResourcePriority;
  const allowed = SOURCE_OPTIONS.map((item) => item.key);
  const normalized = raw.map((item) => String(item || "").trim()).filter((item) => allowed.includes(item));
  return normalized.length > 0 ? normalized : DEFAULT_FORM.subscriptionResourcePriority;
}

function normalizeDetailTabs(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : DEFAULT_FORM.detailVisibleTabs;
  const allowed = DETAIL_TAB_OPTIONS.map((item) => item.key);
  const normalized = raw.map((item) => String(item || "").trim()).filter((item) => allowed.includes(item));
  return normalized.length > 0 ? normalized : DEFAULT_FORM.detailVisibleTabs;
}

function formatJsonInput(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  return JSON.stringify(value, null, 2);
}

function parseChartSources(value: string): unknown[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("榜单来源必须是 JSON 数组");
  }
  return parsed;
}

function formFromRuntime(rt: RuntimeSettings): AdvancedRuntimeForm {
  return {
    hdhiveCookie: stringValue(rt.hdhive_cookie),
    hdhiveBaseUrl: stringValue(rt.hdhive_base_url, DEFAULT_FORM.hdhiveBaseUrl),
    hdhiveLoginUsername: stringValue(rt.hdhive_login_username),
    hdhiveAutoCheckinEnabled: Boolean(rt.hdhive_auto_checkin_enabled),
    hdhiveAutoCheckinMode: stringValue(rt.hdhive_auto_checkin_mode, DEFAULT_FORM.hdhiveAutoCheckinMode),
    hdhiveAutoCheckinMethod: stringValue(rt.hdhive_auto_checkin_method, DEFAULT_FORM.hdhiveAutoCheckinMethod),
    hdhiveAutoCheckinRunTime: stringValue(rt.hdhive_auto_checkin_run_time, DEFAULT_FORM.hdhiveAutoCheckinRunTime),
    httpProxy: stringValue(rt.http_proxy),
    httpsProxy: stringValue(rt.https_proxy),
    allProxy: stringValue(rt.all_proxy),
    socksProxy: stringValue(rt.socks_proxy),
    tmdbApiKey: stringValue(rt.tmdb_api_key),
    tmdbBaseUrl: stringValue(rt.tmdb_base_url, DEFAULT_FORM.tmdbBaseUrl),
    tmdbImageBaseUrl: stringValue(rt.tmdb_image_base_url, DEFAULT_FORM.tmdbImageBaseUrl),
    tmdbLanguage: stringValue(rt.tmdb_language, DEFAULT_FORM.tmdbLanguage),
    tmdbRegion: stringValue(rt.tmdb_region, DEFAULT_FORM.tmdbRegion),
    pansouBaseUrl: stringValue(rt.pansou_base_url),
    tgIndexEnabled: Boolean(rt.tg_index_enabled ?? DEFAULT_FORM.tgIndexEnabled),
    tgSession: stringValue(rt.tg_session),
    tgIndexRealtimeFallbackEnabled: Boolean(
      rt.tg_index_realtime_fallback_enabled ?? DEFAULT_FORM.tgIndexRealtimeFallbackEnabled,
    ),
    tgIndexQueryLimitPerChannel: numberValue(
      rt.tg_index_query_limit_per_channel,
      DEFAULT_FORM.tgIndexQueryLimitPerChannel,
    ),
    tgBackfillBatchSize: numberValue(rt.tg_backfill_batch_size, DEFAULT_FORM.tgBackfillBatchSize),
    tgIncrementalIntervalMinutes: numberValue(
      rt.tg_incremental_interval_minutes,
      DEFAULT_FORM.tgIncrementalIntervalMinutes,
    ),
    embySyncEnabled: Boolean(rt.emby_sync_enabled),
    embySyncIntervalMinutes: numberValue(rt.emby_sync_interval_minutes, DEFAULT_FORM.embySyncIntervalMinutes),
    feiniuUrl: stringValue(rt.feiniu_url),
    feiniuApiKey: stringValue(rt.feiniu_api_key),
    feiniuSessionToken: stringValue(rt.feiniu_session_token),
    feiniuSyncEnabled: Boolean(rt.feiniu_sync_enabled),
    feiniuSyncIntervalMinutes: numberValue(
      rt.feiniu_sync_interval_minutes,
      DEFAULT_FORM.feiniuSyncIntervalMinutes,
    ),
    subscriptionEnabled: Boolean(rt.subscription_enabled),
    subscriptionIntervalHours: numberValue(rt.subscription_interval_hours, DEFAULT_FORM.subscriptionIntervalHours),
    subscriptionResourcePriority: normalizePriority(rt.subscription_resource_priority),
    subscriptionOfflineTransferEnabled: Boolean(rt.subscription_offline_transfer_enabled),
    subscriptionHdhiveAutoUnlockEnabled: Boolean(rt.subscription_hdhive_auto_unlock_enabled),
    subscriptionHdhiveUnlockMaxPointsPerItem: numberValue(
      rt.subscription_hdhive_unlock_max_points_per_item,
      DEFAULT_FORM.subscriptionHdhiveUnlockMaxPointsPerItem,
    ),
    subscriptionHdhiveUnlockBudgetPointsPerRun: numberValue(
      rt.subscription_hdhive_unlock_budget_points_per_run,
      DEFAULT_FORM.subscriptionHdhiveUnlockBudgetPointsPerRun,
    ),
    subscriptionHdhiveUnlockThresholdInclusive: Boolean(rt.subscription_hdhive_unlock_threshold_inclusive ?? true),
    subscriptionHdhivePreferFree: Boolean(rt.subscription_hdhive_prefer_free ?? true),
    resourcePreferredResolutions: formatListInput(rt.resource_preferred_resolutions),
    resourcePreferredHdr: formatListInput(rt.resource_preferred_hdr),
    resourcePreferredCodec: formatListInput(rt.resource_preferred_codec),
    resourcePreferredAudio: formatListInput(rt.resource_preferred_audio),
    resourcePreferredSubtitles: formatListInput(rt.resource_preferred_subtitles),
    resourceExcludeTags: formatListInput(rt.resource_exclude_tags),
    resourceMinSizeGb: rt.resource_min_size_gb == null ? "" : String(rt.resource_min_size_gb),
    resourceMaxSizeGb: rt.resource_max_size_gb == null ? "" : String(rt.resource_max_size_gb),
    chartSubscriptionEnabled: Boolean(rt.chart_subscription_enabled),
    chartSubscriptionSourcesInput: formatJsonInput(rt.chart_subscription_sources),
    chartSubscriptionLimit: numberValue(rt.chart_subscription_limit, DEFAULT_FORM.chartSubscriptionLimit),
    chartSubscriptionIntervalHours: numberValue(
      rt.chart_subscription_interval_hours,
      DEFAULT_FORM.chartSubscriptionIntervalHours,
    ),
    personFollowEnabled: Boolean(rt.person_follow_enabled),
    personFollowIntervalHours: numberValue(rt.person_follow_interval_hours, DEFAULT_FORM.personFollowIntervalHours),
    personFollowAutoSubscribe: Boolean(rt.person_follow_auto_subscribe ?? true),
    updateSourceType: stringValue(rt.update_source_type, DEFAULT_FORM.updateSourceType),
    updateRepository: stringValue(rt.update_repository, DEFAULT_FORM.updateRepository),
    detailVisibleTabs: normalizeDetailTabs(rt.detail_visible_tabs),
  };
}

const inputStyle = {
  background: "var(--surface-subtle)",
  border: "1px solid var(--border)",
  color: "var(--txt)",
} as React.CSSProperties;

function labelStyle(): React.CSSProperties {
  return { color: "var(--txt-muted)" };
}

function panelStyle(): React.CSSProperties {
  return { background: "var(--surface)", border: "1px solid var(--border)" };
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  placeholder = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="space-y-1.5 block">
      <span className="text-[10px] font-black uppercase tracking-wide" style={labelStyle()}>{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary"
        style={inputStyle}
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min = 0,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
}) {
  return (
    <label className="space-y-1.5 block">
      <span className="text-[10px] font-black uppercase tracking-wide" style={labelStyle()}>{label}</span>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary"
        style={inputStyle}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="space-y-1.5 block">
      <span className="text-[10px] font-black uppercase tracking-wide" style={labelStyle()}>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary"
        style={inputStyle}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  rows = 3,
  placeholder = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="space-y-1.5 block">
      <span className="text-[10px] font-black uppercase tracking-wide" style={labelStyle()}>{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full text-xs font-mono rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-brand-primary"
        style={inputStyle}
      />
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer" style={{ color: "var(--txt-secondary)" }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-brand-primary"
      />
      {label}
    </label>
  );
}

export default function RuntimeAdvancedSettingsPanel({ addLog }: RuntimeAdvancedSettingsPanelProps) {
  const [form, setForm] = useState<AdvancedRuntimeForm>(DEFAULT_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const updateField = <K extends keyof AdvancedRuntimeForm>(key: K, value: AdvancedRuntimeForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const loadRuntime = async () => {
    setLoading(true);
    setSaveError("");
    try {
      const { data } = await settingsApi.getRuntime();
      setForm(formFromRuntime(data));
    } catch (err) {
      const message = getApiErrorMessage(err, "加载高级运行时设置失败");
      setSaveError(message);
      await addLog("ERROR", message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRuntime();
  }, []);

  const priorityLabel = useMemo(
    () => form.subscriptionResourcePriority.map((source) => source.toUpperCase()).join(" > ") || "-",
    [form.subscriptionResourcePriority],
  );

  const togglePrioritySource = (source: string, checked: boolean) => {
    const next = checked
      ? [...form.subscriptionResourcePriority, source]
      : form.subscriptionResourcePriority.filter((item) => item !== source);
    updateField("subscriptionResourcePriority", normalizePriority(next));
  };

  const toggleDetailTab = (tab: string, checked: boolean) => {
    const next = checked
      ? [...form.detailVisibleTabs, tab]
      : form.detailVisibleTabs.filter((item) => item !== tab);
    updateField("detailVisibleTabs", normalizeDetailTabs(next));
  };

  const buildPayload = (): Record<string, unknown> => {
    const chartSources = parseChartSources(form.chartSubscriptionSourcesInput);
    if (!form.pansouBaseUrl.trim()) {
      throw new Error("Pansou Base URL 不能为空");
    }
    if (!form.tmdbBaseUrl.trim() || !form.tmdbImageBaseUrl.trim()) {
      throw new Error("TMDB Base URL 与图片 Base URL 不能为空");
    }
    if (!form.hdhiveBaseUrl.trim()) {
      throw new Error("HDHive Base URL 不能为空");
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(form.hdhiveAutoCheckinRunTime.trim())) {
      throw new Error("HDHive 自动签到时间必须为 HH:mm");
    }
    return {
      hdhive_cookie: form.hdhiveCookie.trim() || null,
      hdhive_base_url: form.hdhiveBaseUrl.trim(),
      hdhive_login_username: form.hdhiveLoginUsername.trim() || null,
      hdhive_auto_checkin_enabled: form.hdhiveAutoCheckinEnabled,
      hdhive_auto_checkin_mode: form.hdhiveAutoCheckinMode,
      hdhive_auto_checkin_method: form.hdhiveAutoCheckinMethod,
      hdhive_auto_checkin_run_time: form.hdhiveAutoCheckinRunTime.trim(),
      http_proxy: form.httpProxy.trim() || null,
      https_proxy: form.httpsProxy.trim() || null,
      all_proxy: form.allProxy.trim() || null,
      socks_proxy: form.socksProxy.trim() || null,
      tmdb_api_key: form.tmdbApiKey.trim() || null,
      tmdb_base_url: form.tmdbBaseUrl.trim(),
      tmdb_image_base_url: form.tmdbImageBaseUrl.trim(),
      tmdb_language: form.tmdbLanguage.trim() || "zh-CN",
      tmdb_region: form.tmdbRegion.trim() || "CN",
      pansou_base_url: form.pansouBaseUrl.trim(),
      tg_index_enabled: form.tgIndexEnabled,
      tg_session: form.tgSession.trim() || null,
      tg_index_realtime_fallback_enabled: form.tgIndexRealtimeFallbackEnabled,
      tg_index_query_limit_per_channel: Math.max(20, Math.round(form.tgIndexQueryLimitPerChannel || 120)),
      tg_backfill_batch_size: Math.max(50, Math.round(form.tgBackfillBatchSize || 200)),
      tg_incremental_interval_minutes: Math.max(15, Math.round(form.tgIncrementalIntervalMinutes || 30)),
      emby_sync_enabled: form.embySyncEnabled,
      emby_sync_interval_minutes: Math.max(15, Math.round(form.embySyncIntervalMinutes || 1440)),
      emby_sync_interval_hours: Math.max(1, Math.round((form.embySyncIntervalMinutes || 1440) / 60)),
      feiniu_url: form.feiniuUrl.trim() || null,
      feiniu_api_key: form.feiniuApiKey.trim() || null,
      feiniu_session_token: form.feiniuSessionToken.trim() || null,
      feiniu_sync_enabled: form.feiniuSyncEnabled,
      feiniu_sync_interval_minutes: Math.max(15, Math.round(form.feiniuSyncIntervalMinutes || 1440)),
      feiniu_sync_interval_hours: Math.max(1, Math.round((form.feiniuSyncIntervalMinutes || 1440) / 60)),
      subscription_enabled: form.subscriptionEnabled,
      subscription_interval_hours: Math.max(1, Math.round(form.subscriptionIntervalHours || 24)),
      subscription_resource_priority: form.subscriptionResourcePriority,
      subscription_offline_transfer_enabled: form.subscriptionOfflineTransferEnabled,
      subscription_hdhive_auto_unlock_enabled: form.subscriptionHdhiveAutoUnlockEnabled,
      subscription_hdhive_unlock_max_points_per_item: Math.max(
        1,
        Math.round(form.subscriptionHdhiveUnlockMaxPointsPerItem || 10),
      ),
      subscription_hdhive_unlock_budget_points_per_run: Math.max(
        1,
        Math.round(form.subscriptionHdhiveUnlockBudgetPointsPerRun || 30),
      ),
      subscription_hdhive_unlock_threshold_inclusive: form.subscriptionHdhiveUnlockThresholdInclusive,
      subscription_hdhive_prefer_free: form.subscriptionHdhivePreferFree,
      resource_preferred_resolutions: parseListInput(form.resourcePreferredResolutions),
      resource_preferred_hdr: parseListInput(form.resourcePreferredHdr),
      resource_preferred_codec: parseListInput(form.resourcePreferredCodec),
      resource_preferred_audio: parseListInput(form.resourcePreferredAudio),
      resource_preferred_subtitles: parseListInput(form.resourcePreferredSubtitles),
      resource_exclude_tags: parseListInput(form.resourceExcludeTags),
      resource_min_size_gb: optionalNumberValue(form.resourceMinSizeGb),
      resource_max_size_gb: optionalNumberValue(form.resourceMaxSizeGb),
      chart_subscription_enabled: form.chartSubscriptionEnabled,
      chart_subscription_sources: chartSources,
      chart_subscription_limit: Math.max(1, Math.round(form.chartSubscriptionLimit || 20)),
      chart_subscription_interval_hours: Math.max(1, Math.round(form.chartSubscriptionIntervalHours || 24)),
      person_follow_enabled: form.personFollowEnabled,
      person_follow_interval_hours: Math.max(1, Math.round(form.personFollowIntervalHours || 24)),
      person_follow_auto_subscribe: form.personFollowAutoSubscribe,
      update_source_type: form.updateSourceType,
      update_repository: form.updateRepository.trim() || DEFAULT_FORM.updateRepository,
      detail_visible_tabs: form.detailVisibleTabs,
    };
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError("");
    try {
      const payload = buildPayload();
      const response = await settingsApi.updateRuntime(payload);
      const updated = (response.data as { settings?: RuntimeSettings })?.settings;
      if (updated) {
        setForm(formFromRuntime(updated));
      }
      await addLog("SUCCESS", "高级运行时设置已保存");
    } catch (err) {
      const message = getApiErrorMessage(err, "保存高级运行时设置失败");
      setSaveError(message);
      await addLog("ERROR", message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <CollapsibleSection
      icon={<SlidersHorizontal className="w-4 h-4" />}
      title="高级运行时设置"
      subtitle="订阅、资源筛选、TG 索引、代理与同步任务"
      badge={loading ? "加载中" : "runtime"}
      defaultOpen={false}
    >
      <div className="space-y-5 pt-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-headline text-lg font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <SlidersHorizontal className="w-5 h-5 text-brand-primary" />
              运行时配置覆盖
            </h3>
            <p className="text-[10px] font-semibold mt-1" style={{ color: "var(--txt-muted)" }}>
              当前订阅优先级：{priorityLabel}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={loadRuntime}
              disabled={loading || saving}
              className="glass-hover px-3 py-2 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
              重新读取
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || saving}
              className="px-4 py-2 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"
            >
              <Save className="w-3 h-3" />
              {saving ? "保存中" : "保存高级配置"}
            </button>
          </div>
        </div>

        {saveError && (
          <p className="text-[11px] font-bold rounded-lg px-3 py-2" style={{ color: "var(--accent-danger)", background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.20)" }}>
            {saveError}
          </p>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <section className="rounded-2xl p-4 space-y-3" style={panelStyle()}>
            <h4 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <Rss className="w-4 h-4 text-emerald-500" />
              订阅流程
            </h4>
            <div className="flex flex-wrap gap-4">
              <ToggleField label="启用订阅扫描" checked={form.subscriptionEnabled} onChange={(value) => updateField("subscriptionEnabled", value)} />
              <ToggleField label="自动离线转存" checked={form.subscriptionOfflineTransferEnabled} onChange={(value) => updateField("subscriptionOfflineTransferEnabled", value)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <NumberField label="订阅间隔(小时)" min={1} value={form.subscriptionIntervalHours} onChange={(value) => updateField("subscriptionIntervalHours", value)} />
              <NumberField label="单项解锁积分" min={1} value={form.subscriptionHdhiveUnlockMaxPointsPerItem} onChange={(value) => updateField("subscriptionHdhiveUnlockMaxPointsPerItem", value)} />
              <NumberField label="单轮积分预算" min={1} value={form.subscriptionHdhiveUnlockBudgetPointsPerRun} onChange={(value) => updateField("subscriptionHdhiveUnlockBudgetPointsPerRun", value)} />
            </div>
            <div className="flex flex-wrap gap-4">
              <ToggleField label="HDHive 自动解锁" checked={form.subscriptionHdhiveAutoUnlockEnabled} onChange={(value) => updateField("subscriptionHdhiveAutoUnlockEnabled", value)} />
              <ToggleField label="积分阈值含等于" checked={form.subscriptionHdhiveUnlockThresholdInclusive} onChange={(value) => updateField("subscriptionHdhiveUnlockThresholdInclusive", value)} />
              <ToggleField label="优先免费资源" checked={form.subscriptionHdhivePreferFree} onChange={(value) => updateField("subscriptionHdhivePreferFree", value)} />
            </div>
            <div className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-wide" style={labelStyle()}>资源来源优先级</span>
              <div className="flex flex-wrap gap-3">
                {SOURCE_OPTIONS.map((source) => (
                  <ToggleField
                    key={source.key}
                    label={source.label}
                    checked={form.subscriptionResourcePriority.includes(source.key)}
                    onChange={(checked) => togglePrioritySource(source.key, checked)}
                  />
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-2xl p-4 space-y-3" style={panelStyle()}>
            <h4 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <Cloud className="w-4 h-4 text-indigo-500" />
              HDHive 基础与签到
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TextField label="HDHive Base URL" value={form.hdhiveBaseUrl} onChange={(value) => updateField("hdhiveBaseUrl", value)} placeholder="https://hdhive.com/" />
              <TextField label="HDHive 登录用户名" value={form.hdhiveLoginUsername} onChange={(value) => updateField("hdhiveLoginUsername", value)} />
              <div className="md:col-span-2">
                <TextAreaField label="HDHive Cookie" rows={3} value={form.hdhiveCookie} onChange={(value) => updateField("hdhiveCookie", value)} />
              </div>
              <SelectField
                label="签到模式"
                value={form.hdhiveAutoCheckinMode}
                onChange={(value) => updateField("hdhiveAutoCheckinMode", value)}
                options={[
                  { value: "normal", label: "普通签到" },
                  { value: "gamble", label: "魔法签到" },
                ]}
              />
              <SelectField
                label="签到方式"
                value={form.hdhiveAutoCheckinMethod}
                onChange={(value) => updateField("hdhiveAutoCheckinMethod", value)}
                options={[
                  { value: "cookie", label: "Cookie" },
                  { value: "web", label: "网页登录" },
                ]}
              />
              <TextField label="执行时间" value={form.hdhiveAutoCheckinRunTime} onChange={(value) => updateField("hdhiveAutoCheckinRunTime", value)} placeholder="09:00" />
              <div className="flex items-end">
                <ToggleField label="启用自动签到" checked={form.hdhiveAutoCheckinEnabled} onChange={(value) => updateField("hdhiveAutoCheckinEnabled", value)} />
              </div>
            </div>
          </section>

          <section className="rounded-2xl p-4 space-y-3" style={panelStyle()}>
            <h4 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <Search className="w-4 h-4 text-sky-500" />
              资源检索筛选
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TextAreaField label="偏好分辨率" value={form.resourcePreferredResolutions} onChange={(value) => updateField("resourcePreferredResolutions", value)} placeholder={"2160p\n1080p"} />
              <TextAreaField label="HDR 标签" value={form.resourcePreferredHdr} onChange={(value) => updateField("resourcePreferredHdr", value)} placeholder={"Dolby Vision\nHDR10"} />
              <TextAreaField label="编码" value={form.resourcePreferredCodec} onChange={(value) => updateField("resourcePreferredCodec", value)} placeholder={"H.265\nAV1"} />
              <TextAreaField label="音频/语言" value={form.resourcePreferredAudio} onChange={(value) => updateField("resourcePreferredAudio", value)} placeholder={"国语\nAtmos"} />
              <TextAreaField label="字幕" value={form.resourcePreferredSubtitles} onChange={(value) => updateField("resourcePreferredSubtitles", value)} placeholder={"中字\n简中"} />
              <TextAreaField label="排除标签" value={form.resourceExcludeTags} onChange={(value) => updateField("resourceExcludeTags", value)} />
              <TextField label="最小体积(GB)" value={form.resourceMinSizeGb} onChange={(value) => updateField("resourceMinSizeGb", value)} placeholder="0" />
              <TextField label="最大体积(GB)" value={form.resourceMaxSizeGb} onChange={(value) => updateField("resourceMaxSizeGb", value)} placeholder="80" />
            </div>
          </section>

          <section className="rounded-2xl p-4 space-y-3" style={panelStyle()}>
            <h4 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <Send className="w-4 h-4 text-cyan-500" />
              TG 索引
            </h4>
            <div className="flex flex-wrap gap-4">
              <ToggleField label="启用索引" checked={form.tgIndexEnabled} onChange={(value) => updateField("tgIndexEnabled", value)} />
              <ToggleField label="实时兜底查询" checked={form.tgIndexRealtimeFallbackEnabled} onChange={(value) => updateField("tgIndexRealtimeFallbackEnabled", value)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <NumberField label="单频道查询上限" min={20} value={form.tgIndexQueryLimitPerChannel} onChange={(value) => updateField("tgIndexQueryLimitPerChannel", value)} />
              <NumberField label="回灌批量大小" min={50} value={form.tgBackfillBatchSize} onChange={(value) => updateField("tgBackfillBatchSize", value)} />
              <NumberField label="增量间隔(分钟)" min={15} value={form.tgIncrementalIntervalMinutes} onChange={(value) => updateField("tgIncrementalIntervalMinutes", value)} />
            </div>
            <TextField label="TG Session" value={form.tgSession} onChange={(value) => updateField("tgSession", value)} type="password" />
          </section>

          <section className="rounded-2xl p-4 space-y-3" style={panelStyle()}>
            <h4 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <Server className="w-4 h-4 text-indigo-500" />
              Emby / 飞牛同步
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-3">
                <ToggleField label="Emby 定时同步" checked={form.embySyncEnabled} onChange={(value) => updateField("embySyncEnabled", value)} />
                <NumberField label="Emby 间隔(分钟)" min={15} value={form.embySyncIntervalMinutes} onChange={(value) => updateField("embySyncIntervalMinutes", value)} />
              </div>
              <div className="space-y-3">
                <ToggleField label="飞牛定时同步" checked={form.feiniuSyncEnabled} onChange={(value) => updateField("feiniuSyncEnabled", value)} />
                <NumberField label="飞牛间隔(分钟)" min={15} value={form.feiniuSyncIntervalMinutes} onChange={(value) => updateField("feiniuSyncIntervalMinutes", value)} />
              </div>
              <TextField label="飞牛 URL" value={form.feiniuUrl} onChange={(value) => updateField("feiniuUrl", value)} placeholder="http://fnos.local:5666" />
              <TextField label="飞牛 API Key" value={form.feiniuApiKey} onChange={(value) => updateField("feiniuApiKey", value)} type="password" />
              <div className="md:col-span-2">
                <TextField label="飞牛 Session Token" value={form.feiniuSessionToken} onChange={(value) => updateField("feiniuSessionToken", value)} type="password" />
              </div>
            </div>
          </section>

          <section className="rounded-2xl p-4 space-y-3" style={panelStyle()}>
            <h4 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <Cloud className="w-4 h-4 text-violet-500" />
              TMDB / Pansou
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TextField label="TMDB API Key" value={form.tmdbApiKey} onChange={(value) => updateField("tmdbApiKey", value)} type="password" />
              <TextField label="Pansou Base URL" value={form.pansouBaseUrl} onChange={(value) => updateField("pansouBaseUrl", value)} />
              <TextField label="TMDB Base URL" value={form.tmdbBaseUrl} onChange={(value) => updateField("tmdbBaseUrl", value)} />
              <TextField label="TMDB 图片 Base URL" value={form.tmdbImageBaseUrl} onChange={(value) => updateField("tmdbImageBaseUrl", value)} />
              <TextField label="语言" value={form.tmdbLanguage} onChange={(value) => updateField("tmdbLanguage", value)} />
              <TextField label="地区" value={form.tmdbRegion} onChange={(value) => updateField("tmdbRegion", value)} />
            </div>
          </section>

          <section className="rounded-2xl p-4 space-y-3" style={panelStyle()}>
            <h4 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <Wifi className="w-4 h-4 text-amber-500" />
              代理
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <TextField label="HTTP_PROXY" value={form.httpProxy} onChange={(value) => updateField("httpProxy", value)} />
              <TextField label="HTTPS_PROXY" value={form.httpsProxy} onChange={(value) => updateField("httpsProxy", value)} />
              <TextField label="ALL_PROXY" value={form.allProxy} onChange={(value) => updateField("allProxy", value)} />
              <TextField label="SOCKS_PROXY" value={form.socksProxy} onChange={(value) => updateField("socksProxy", value)} />
            </div>
          </section>

          <section className="rounded-2xl p-4 space-y-3" style={panelStyle()}>
            <h4 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <RefreshCw className="w-4 h-4 text-teal-500" />
              更新源
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <SelectField
                label="来源类型"
                value={form.updateSourceType}
                onChange={(value) => updateField("updateSourceType", value)}
                options={[
                  { value: "official", label: "官方仓库" },
                  { value: "custom_dockerhub", label: "自定义 DockerHub" },
                ]}
              />
              <TextField label="仓库" value={form.updateRepository} onChange={(value) => updateField("updateRepository", value)} placeholder="wangsy1007/mediasync115" />
            </div>
          </section>

          <section className="rounded-2xl p-4 space-y-3" style={panelStyle()}>
            <h4 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <BarChart3 className="w-4 h-4 text-lime-500" />
              详情页资源 Tab
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {DETAIL_TAB_OPTIONS.map((tab) => (
                <ToggleField
                  key={tab.key}
                  label={tab.label}
                  checked={form.detailVisibleTabs.includes(tab.key)}
                  onChange={(checked) => toggleDetailTab(tab.key, checked)}
                />
              ))}
            </div>
          </section>

          <section className="rounded-2xl p-4 space-y-3" style={panelStyle()}>
            <h4 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <BarChart3 className="w-4 h-4 text-rose-500" />
              榜单订阅
            </h4>
            <div className="flex flex-wrap gap-4">
              <ToggleField label="启用榜单订阅" checked={form.chartSubscriptionEnabled} onChange={(value) => updateField("chartSubscriptionEnabled", value)} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <NumberField label="每榜数量" min={1} value={form.chartSubscriptionLimit} onChange={(value) => updateField("chartSubscriptionLimit", value)} />
              <NumberField label="间隔(小时)" min={1} value={form.chartSubscriptionIntervalHours} onChange={(value) => updateField("chartSubscriptionIntervalHours", value)} />
              <div className="md:col-span-2">
                <TextAreaField label="榜单来源 JSON" rows={5} value={form.chartSubscriptionSourcesInput} onChange={(value) => updateField("chartSubscriptionSourcesInput", value)} placeholder={'[{"source":"douban","key":"movie_hot"}]'} />
              </div>
            </div>
          </section>

          <section className="rounded-2xl p-4 space-y-3" style={panelStyle()}>
            <h4 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
              <UserRound className="w-4 h-4 text-emerald-500" />
              影人关注
            </h4>
            <div className="flex flex-wrap gap-4">
              <ToggleField label="启用影人同步" checked={form.personFollowEnabled} onChange={(value) => updateField("personFollowEnabled", value)} />
              <ToggleField label="新作品自动订阅" checked={form.personFollowAutoSubscribe} onChange={(value) => updateField("personFollowAutoSubscribe", value)} />
            </div>
            <NumberField label="同步间隔(小时)" min={1} value={form.personFollowIntervalHours} onChange={(value) => updateField("personFollowIntervalHours", value)} />
          </section>
        </div>
      </div>
    </CollapsibleSection>
  );
}
