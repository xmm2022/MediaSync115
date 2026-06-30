import type { Dispatch, SetStateAction } from "react";
import { Play, Radio, RefreshCw, Search, Server, SlidersHorizontal } from "lucide-react";
import type { AniRssDownloadClientStatus } from "../../api/types";
import DetailVisibleTabsPanel from "./DetailVisibleTabsPanel";

type ActionResult = {
  ok: boolean;
  msg: string;
};

type StringSetter = Dispatch<SetStateAction<string>>;
type BoolSetter = Dispatch<SetStateAction<boolean>>;

type ResourceMetadataSettingsProps = {
  busy: {
    isBusy: (key: string) => boolean;
    resultOf: (key: string) => ActionResult | undefined;
  };
  aniRss: {
    enabled: boolean;
    setEnabled: BoolSetter;
    baseUrl: string;
    setBaseUrl: StringSetter;
    mikanBaseUrl: string;
    setMikanBaseUrl: StringSetter;
    apiKey: string;
    setApiKey: StringSetter;
    apiKeyConfigured: boolean;
    defaultDownloadPath: string;
    setDefaultDownloadPath: StringSetter;
    downloadPathPresetsInput: string;
    setDownloadPathPresetsInput: StringSetter;
    downloadClientStatus: AniRssDownloadClientStatus | null;
    onSave: () => void;
    onCheckHealth: () => void;
    onCheckDownloadClient: () => void;
    onApplyDownloadClientDefaults: () => void;
  };
  hdHive: {
    baseUrl: string;
    setBaseUrl: StringSetter;
    loginUsername: string;
    setLoginUsername: StringSetter;
    cookie: string;
    setCookie: StringSetter;
    autoCheckinMode: string;
    setAutoCheckinMode: StringSetter;
    autoCheckinMethod: string;
    setAutoCheckinMethod: StringSetter;
    autoCheckinRunTime: string;
    setAutoCheckinRunTime: StringSetter;
    autoCheckinEnabled: boolean;
    setAutoCheckinEnabled: BoolSetter;
    onCheckLogin: () => void;
    onRunCheckin: () => void;
  };
  metadata: {
    tmdbApiKey: string;
    setTmdbApiKey: StringSetter;
    pansouBaseUrl: string;
    setPansouBaseUrl: StringSetter;
    tmdbBaseUrl: string;
    setTmdbBaseUrl: StringSetter;
    tmdbImageBaseUrl: string;
    setTmdbImageBaseUrl: StringSetter;
    tmdbLanguage: string;
    setTmdbLanguage: StringSetter;
    tmdbRegion: string;
    setTmdbRegion: StringSetter;
    tmdbLocalDbPath: string;
    setTmdbLocalDbPath: StringSetter;
    onCheckTmdb: () => void;
    onCheckPansou: () => void;
  };
  display: {
    visibleTabs: string[];
    onToggle: (tab: string, checked: boolean) => void;
  };
};

export default function ResourceMetadataSettings({
  busy,
  aniRss,
  hdHive,
  metadata,
  display,
}: ResourceMetadataSettingsProps) {
  const tmdbResult = busy.resultOf("tmdbCheck");

  return (
    <div className="space-y-6">
      <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
        <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
          <Radio className="w-4 h-4 text-violet-500" />
          ANI-RSS 接入与下载器安全
        </h3>
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs font-bold" style={{ color: "var(--txt)" }}>ANI-RSS 日番追新接入</span>
            <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
              <input type="checkbox" checked={aniRss.enabled} onChange={(e) => aniRss.setEnabled(e.target.checked)} className="accent-brand-primary" />
              启用
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1 block md:col-span-2">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>ANI-RSS 地址</span>
              <input value={aniRss.baseUrl} onChange={(e) => aniRss.setBaseUrl(e.target.value)} placeholder="e.g. http://ani-rss:7789" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block md:col-span-2">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>Mikan 域名（兼容）</span>
              <input value={aniRss.mikanBaseUrl} onChange={(e) => aniRss.setMikanBaseUrl(e.target.value)} placeholder="https://mikanani.me" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block md:col-span-2">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>API Key</span>
              <input type="password" value={aniRss.apiKey} onChange={(e) => aniRss.setApiKey(e.target.value)} placeholder={aniRss.apiKeyConfigured ? "已配置，留空不修改" : "配置 ANI-RSS API Key"} className="w-full text-xs px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block md:col-span-2">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>默认保存位置（可选）</span>
              <input value={aniRss.defaultDownloadPath} onChange={(e) => aniRss.setDefaultDownloadPath(e.target.value)} placeholder="/Media/番剧/${title}" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block md:col-span-2">
              <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>保存位置预设</span>
              <textarea value={aniRss.downloadPathPresetsInput} onChange={(e) => aniRss.setDownloadPathPresetsInput(e.target.value)} rows={4} placeholder={"/Media/番剧\n/Media/番剧/${title}\n/Media/国产动漫/${title}"} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium resize-y" />
            </label>
          </div>
          <div className="rounded-2xl p-3 space-y-2" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-black flex items-center gap-1.5" style={{ color: "var(--txt)" }}>
                  <Server className="w-3.5 h-3.5" />
                  下载器配置闭环
                </p>
                <p className="text-[10px] font-bold mt-1" style={{ color: "var(--txt-muted)" }}>
                  {aniRss.downloadClientStatus?.message || "尚未检测 ANI-RSS 到 qBittorrent 的连接状态"}
                </p>
              </div>
              <span
                className="inline-flex items-center justify-center rounded-lg px-2 py-1 text-[9px] font-black shrink-0"
                style={aniRss.downloadClientStatus?.ready
                  ? { color: "var(--accent-ok)", background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.24)" }
                  : { color: "var(--accent-warn)", background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.28)" }}
              >
                {aniRss.downloadClientStatus?.ready ? "配置正常" : "需要检测"}
              </span>
            </div>
            {aniRss.downloadClientStatus && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px] font-bold">
                <div className="rounded-xl px-2.5 py-2" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}>
                  <span className="block text-[9px] font-black uppercase" style={{ color: "var(--txt-muted)" }}>qBittorrent</span>
                  <span className="block truncate">{aniRss.downloadClientStatus.qbittorrent?.version || "-"}</span>
                  <span className="block truncate">{aniRss.downloadClientStatus.qbittorrent?.base_url || "-"}</span>
                </div>
                <div className="rounded-xl px-2.5 py-2" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}>
                  <span className="block text-[9px] font-black uppercase" style={{ color: "var(--txt-muted)" }}>任务数</span>
                  <span className="block">{aniRss.downloadClientStatus.qbittorrent?.torrent_count ?? "-"}</span>
                  <span className="block">downloadNew: {aniRss.downloadClientStatus.actual?.download_new ? "开" : "关"}</span>
                </div>
                <div className="rounded-xl px-2.5 py-2" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--txt-secondary)" }}>
                  <span className="block text-[9px] font-black uppercase" style={{ color: "var(--txt-muted)" }}>下载路径</span>
                  <span className="block truncate">{aniRss.downloadClientStatus.actual?.download_path_template || "-"}</span>
                  <span className="block">qbUseDownloadPath: {aniRss.downloadClientStatus.actual?.qb_use_download_path ? "开" : "关"}</span>
                </div>
              </div>
            )}
            {!!aniRss.downloadClientStatus?.issues?.length && (
              <p className="text-[10px] font-bold leading-relaxed" style={{ color: "var(--accent-warn)" }}>
                {aniRss.downloadClientStatus.issues.join("；")}
              </p>
            )}
            {!!aniRss.downloadClientStatus?.unsafe_flags?.length && (
              <p className="text-[10px] font-bold leading-relaxed" style={{ color: "var(--accent-danger)" }}>
                安全开关异常：{aniRss.downloadClientStatus.unsafe_flags.join("；")}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={aniRss.onSave} disabled={busy.isBusy("anirssConfigSave")} className="px-3 py-1.5 rounded-lg text-[9px] font-black bg-brand-primary text-white disabled:opacity-50 cursor-pointer">保存 ANI-RSS</button>
            <button type="button" onClick={aniRss.onCheckHealth} disabled={busy.isBusy("anirssHealth")} className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50 cursor-pointer" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>检测连通性</button>
            <button type="button" onClick={aniRss.onCheckDownloadClient} disabled={busy.isBusy("anirssDownloadClientCheck")} className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50 cursor-pointer" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}>检测下载器</button>
            <button type="button" onClick={aniRss.onApplyDownloadClientDefaults} disabled={busy.isBusy("anirssDownloadClientApply")} className="glass-hover px-3 py-1.5 rounded-lg text-[9px] font-black disabled:opacity-50 cursor-pointer" style={{ background: "rgba(245,158,11,0.10)", color: "var(--accent-warn)", border: "1px solid rgba(245,158,11,0.28)" }}>同步安全配置</button>
          </div>
        </div>
      </div>

      <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
        <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
          <SlidersHorizontal className="w-4 h-4 text-emerald-500" />
          HDHive 论坛签到与配置
        </h3>
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1 block">
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>HDHive Base URL</span>
              <input value={hdHive.baseUrl} onChange={(e) => hdHive.setBaseUrl(e.target.value)} placeholder="https://hdhive.com/" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block">
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>登录用户名</span>
              <input value={hdHive.loginUsername} onChange={(e) => hdHive.setLoginUsername(e.target.value)} className="w-full text-xs px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>Cookie 字符串</span>
              <textarea rows={3} value={hdHive.cookie} onChange={(e) => hdHive.setCookie(e.target.value)} className="w-full text-xs font-mono p-3 resize-none input-premium" />
            </label>
            <label className="space-y-1 block">
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>签到模式</span>
              <select value={hdHive.autoCheckinMode} onChange={(e) => hdHive.setAutoCheckinMode(e.target.value)} className="w-full text-xs px-3 py-2.5 input-premium">
                <option value="normal">普通签到</option>
                <option value="gamble">魔法签到</option>
              </select>
            </label>
            <label className="space-y-1 block">
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>签到方式</span>
              <select value={hdHive.autoCheckinMethod} onChange={(e) => hdHive.setAutoCheckinMethod(e.target.value)} className="w-full text-xs px-3 py-2.5 input-premium">
                <option value="cookie">Cookie</option>
                <option value="web">网页模拟登录</option>
              </select>
            </label>
            <label className="space-y-1 block">
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>自动检查运行时间 (HH:mm)</span>
              <input value={hdHive.autoCheckinRunTime} onChange={(e) => hdHive.setAutoCheckinRunTime(e.target.value)} placeholder="09:00" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
            </label>
            <div className="flex items-end pb-1.5">
              <label className="inline-flex items-center gap-2 text-xs font-black cursor-pointer">
                <input type="checkbox" checked={hdHive.autoCheckinEnabled} onChange={(e) => hdHive.setAutoCheckinEnabled(e.target.checked)} className="accent-brand-primary" />
                启用自动签到
              </label>
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={hdHive.onCheckLogin}
              disabled={busy.isBusy("hdhiveCheck")}
              className="glass-hover flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              style={{ background: "var(--surface-subtle)", color: "var(--brand-primary)", border: "1px solid var(--border)" }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy.isBusy("hdhiveCheck") ? "animate-spin" : ""}`} />
              <span>{busy.isBusy("hdhiveCheck") ? "检查中..." : "测试连接状态"}</span>
            </button>
            <button
              type="button"
              onClick={hdHive.onRunCheckin}
              disabled={busy.isBusy("hdhiveCheckinRun")}
              className="glass-hover flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              <Play className="w-3 h-3" />
              <span>{busy.isBusy("hdhiveCheckinRun") ? "签到中..." : "手动签到测试"}</span>
            </button>
          </div>
        </div>
      </div>

      <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
        <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
          <Search className="w-4 h-4 text-sky-500" />
          TMDB 搜刮器与第三方搜索 (Pansou)
        </h3>
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1 block md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>TMDB API 密钥 (Key)</span>
              <input type="password" value={metadata.tmdbApiKey} onChange={(e) => metadata.setTmdbApiKey(e.target.value)} placeholder="API 密钥" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>Pansou 搜索源 API 地址</span>
              <input value={metadata.pansouBaseUrl} onChange={(e) => metadata.setPansouBaseUrl(e.target.value)} placeholder="http://pansou-api.local" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>TMDB 后端基础地址</span>
              <input value={metadata.tmdbBaseUrl} onChange={(e) => metadata.setTmdbBaseUrl(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>TMDB 海报图片基础地址</span>
              <input value={metadata.tmdbImageBaseUrl} onChange={(e) => metadata.setTmdbImageBaseUrl(e.target.value)} className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block">
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>拉取首选语言</span>
              <input value={metadata.tmdbLanguage} onChange={(e) => metadata.setTmdbLanguage(e.target.value)} className="w-full text-xs px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block">
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>首选区域限制 (Region)</span>
              <input value={metadata.tmdbRegion} onChange={(e) => metadata.setTmdbRegion(e.target.value)} className="w-full text-xs px-3.5 py-2.5 input-premium" />
            </label>
            <label className="space-y-1 block md:col-span-2">
              <span className="text-[10px] font-black uppercase tracking-wide" style={{ color: "var(--txt-muted)" }}>本地 TMDB SQLite 路径</span>
              <input value={metadata.tmdbLocalDbPath} onChange={(e) => metadata.setTmdbLocalDbPath(e.target.value)} placeholder="data/tmdb_base.db" className="w-full text-xs font-mono px-3.5 py-2.5 input-premium" />
            </label>
          </div>
          {tmdbResult && (
            <p
              className="text-[10px] font-semibold rounded-lg px-3 py-2 break-words"
              style={{
                color: tmdbResult.ok ? "var(--accent-ok)" : "var(--accent-danger)",
                background: "var(--surface-subtle)",
                border: "1px solid var(--border)",
              }}
            >
              {tmdbResult.msg}
            </p>
          )}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={metadata.onCheckTmdb}
              disabled={busy.isBusy("tmdbCheck")}
              className="glass-hover flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              style={{ background: "var(--surface-subtle)", color: "var(--brand-primary)", border: "1px solid var(--border)" }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy.isBusy("tmdbCheck") ? "animate-spin" : ""}`} />
              <span>{busy.isBusy("tmdbCheck") ? "测试中..." : "测试 TMDB 连通性"}</span>
            </button>
            <button
              type="button"
              onClick={metadata.onCheckPansou}
              disabled={busy.isBusy("pansouCheck")}
              className="glass-hover flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
              style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy.isBusy("pansouCheck") ? "animate-spin" : ""}`} />
              <span>{busy.isBusy("pansouCheck") ? "测试中..." : "测试 Pansou 搜索源"}</span>
            </button>
          </div>
        </div>
      </div>

      <DetailVisibleTabsPanel visibleTabs={display.visibleTabs} onToggle={display.onToggle} />
    </div>
  );
}
