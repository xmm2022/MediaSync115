/**
 * STRM 管理页 — 对接后端 /api/strm (config / generate / diagnose)
 * 以及 /api/archive (配置 + 扫描 + 任务) 归档入口。
 *
 * 后端 STRM 配置字段见 StrmConfigRequest：strm_enabled / strm_output_dir /
 * strm_base_url / strm_redirect_mode / strm_refresh_emby_after_generate /
 * strm_refresh_feiniu_after_generate / strm_proxy_enabled / strm_proxy_port。
 */
import React, { useEffect, useState } from "react";
import { strmApi, archiveApi } from "../api";
import { getApiErrorMessage } from "../api/errors";
import type { StrmConfig, ArchiveConfig } from "../api/types";
import { Film, RefreshCw, Play, CheckCircle2, XCircle, Settings2, Folder, ScanLine } from "lucide-react";
import ErrorBanner from "./ui/ErrorBanner";
import { motion } from "motion/react";

const INPUT_STYLE: React.CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border)",
  color: "var(--txt)",
};
const LABEL_STYLE: React.CSSProperties = { color: "var(--txt-muted)" };
const CHECK_LABEL_STYLE: React.CSSProperties = {
  background: "var(--surface-subtle)",
  border: "1px solid var(--border)",
  color: "var(--txt-secondary)",
};
const KEY_STYLE: React.CSSProperties = { color: "var(--txt-muted)" };
const VALUE_STYLE: React.CSSProperties = { color: "var(--txt)" };

export default function StrmTab({ addLog }: { addLog: (l: "INFO" | "SUCCESS" | "WARN" | "ERROR", m: string) => Promise<void> }) {
  const [config, setConfig] = useState<StrmConfig | null>(null);
  const [archiveCfg, setArchiveCfg] = useState<ArchiveConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [diagnose, setDiagnose] = useState<unknown>(null);
  const [diagnoseLoading, setDiagnoseLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 表单本地态
  const [strmEnabled, setStrmEnabled] = useState(false);
  const [outputDir, setOutputDir] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [redirectMode, setRedirectMode] = useState("auto");
  const [refreshEmby, setRefreshEmby] = useState(false);
  const [refreshFeiniu, setRefreshFeiniu] = useState(false);
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyPort, setProxyPort] = useState<number | undefined>(undefined);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: c }, { data: ac }] = await Promise.all([
        strmApi.getConfig(),
        archiveApi.getConfig().catch(() => ({ data: null as ArchiveConfig | null })),
      ]);
      setConfig(c);
      setArchiveCfg(ac);
      setStrmEnabled(Boolean(c.strm_enabled));
      setOutputDir((c.strm_output_dir as string) || "");
      setBaseUrl((c.strm_base_url as string) || (c.suggested_base_url as string) || "");
      setRedirectMode((c.strm_redirect_mode as string) || "auto");
      setRefreshEmby(Boolean(c.strm_refresh_emby_after_generate));
      setRefreshFeiniu(Boolean(c.strm_refresh_feiniu_after_generate));
      setProxyEnabled(Boolean(c.strm_proxy_enabled));
      setProxyPort(c.strm_proxy_port as number | undefined);
    } catch (err: unknown) {
      console.error(err);
      setError(`加载 STRM/归档配置失败: ${getApiErrorMessage(err)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const { data } = await strmApi.updateConfig({
        strm_enabled: strmEnabled,
        strm_output_dir: outputDir.trim() || undefined,
        strm_base_url: baseUrl.trim() || undefined,
        strm_redirect_mode: redirectMode,
        strm_refresh_emby_after_generate: refreshEmby,
        strm_refresh_feiniu_after_generate: refreshFeiniu,
        strm_proxy_enabled: proxyEnabled,
        strm_proxy_port: proxyPort,
      });
      setConfig(data);
      await addLog("SUCCESS", "STRM 配置已保存");
    } catch (err: unknown) {
      const detail = getApiErrorMessage(err);
      setError(`保存失败: ${detail}`);
      addLog("ERROR", `STRM 配置保存失败: ${detail}`);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    if (!confirm("立即生成全库 STRM 文件？该操作可能耗时较长。")) return;
    setGenerating(true);
    setError(null);
    try {
      const result = await strmApi.generate();
      await addLog("SUCCESS", "STRM 生成任务已触发");
      setDiagnose(result.data);
    } catch (err: unknown) {
      const detail = getApiErrorMessage(err);
      setError(`生成失败: ${detail}`);
      addLog("ERROR", `STRM 生成失败: ${detail}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleDiagnose = async () => {
    setDiagnoseLoading(true);
    try {
      const { data } = await strmApi.diagnose();
      setDiagnose(data);
    } catch (err: unknown) {
      const detail = getApiErrorMessage(err);
      setDiagnose({ error: detail });
    } finally {
      setDiagnoseLoading(false);
    }
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      await archiveApi.runScan();
      await addLog("SUCCESS", "归档扫描已触发");
    } catch (err: unknown) {
      const detail = getApiErrorMessage(err);
      setError(`归档扫描失败: ${detail}`);
    } finally {
      setScanning(false);
    }
  };

  if (loading) {
    return (
      <div className="liquid-page flex items-center justify-center py-20">
        <div className="glass-heavy glass-iridescent rounded-3xl p-10">
          <RefreshCw className="w-6 h-6 animate-spin" style={{ color: "var(--brand-primary)" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="liquid-page space-y-6">
      {error && (
        <div className="glass-heavy glass-iridescent rounded-3xl p-4">
          <ErrorBanner message={error} onRetry={() => load()} onDismiss={() => setError(null)} />
        </div>
      )}

      {/* 标题 */}
      <div className="liquid-hero glass-heavy glass-iridescent glass-spotlight rounded-3xl p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight flex items-center gap-2.5" style={{ color: "var(--txt)" }}>
            <Film className="w-6.5 h-6.5" style={{ color: "var(--brand-primary)" }} />
            <span>STRM 虚拟文件管理</span>
          </h2>
          <p className="text-xs mt-1 max-w-xl leading-relaxed" style={{ color: "var(--txt-secondary)" }}>
            生成 .strm 指向文件供 Emby/飞牛直链播放，支持 302 重定向与代理回源。点击生成后可在媒体库看到 STRM 资源。
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-brand-primary text-white px-4 py-2.5 rounded-2xl text-xs font-black tracking-wider flex items-center gap-1.5 shrink-0 transition-all active:scale-95 shadow-md disabled:opacity-50"
          >
            <Play className="w-4 h-4" />
            <span>{generating ? "生成中…" : "立即生成"}</span>
          </button>
          <button
            onClick={handleDiagnose}
            disabled={diagnoseLoading}
            className="glass glass-hover px-4 py-2.5 rounded-2xl text-xs font-black tracking-wider flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
            style={{ color: "var(--txt-secondary)" }}
          >
            <ScanLine className="w-4 h-4" />
            <span>{diagnoseLoading ? "诊断中…" : "STRM 诊断"}</span>
          </button>
        </div>
      </div>

      {/* 运行时状态 */}
      {config?.runtime && (
        <div className="liquid-panel glass rounded-3xl p-4">
          <h3 className="text-sm font-black flex items-center gap-2 mb-3" style={{ color: "var(--txt)" }}>
            <Settings2 className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
            <span>运行时状态</span>
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {Object.entries(config.runtime as Record<string, unknown>).slice(0, 8).map(([k, v]) => (
              <div key={k} className="glass rounded-xl px-3 py-2">
                <div className="text-[10px] font-bold truncate" style={KEY_STYLE}>{k}</div>
                <div className="text-xs font-black truncate" style={VALUE_STYLE}>{String(v ?? "—")}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 配置表单 */}
      <div className="liquid-panel glass rounded-3xl p-5 space-y-4">
        <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
          <Settings2 className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
          <span>STRM 配置</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-center justify-between rounded-xl px-3 py-2.5" style={CHECK_LABEL_STYLE}>
            <span className="text-xs font-bold">启用 STRM 生成</span>
            <input type="checkbox" checked={strmEnabled} onChange={(e) => setStrmEnabled(e.target.checked)} className="w-4 h-4 accent-brand-primary" />
          </label>

          <div className="space-y-1">
            <label className="text-xs font-bold" style={LABEL_STYLE}>输出目录 (strm_output_dir)</label>
            <input type="text" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} placeholder="/app/strm" className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={INPUT_STYLE} />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold" style={LABEL_STYLE}>回源 Base URL (strm_base_url)</label>
            <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={config?.suggested_base_url as string || "http://host:9008"} className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={INPUT_STYLE} />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold" style={LABEL_STYLE}>重定向模式 (strm_redirect_mode)</label>
            <select value={redirectMode} onChange={(e) => setRedirectMode(e.target.value)} className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={INPUT_STYLE}>
              <option value="auto">自动选择</option>
              <option value="redirect">302 重定向</option>
              <option value="proxy">代理回源</option>
            </select>
          </div>

          <label className="flex items-center justify-between rounded-xl px-3 py-2.5" style={CHECK_LABEL_STYLE}>
            <span className="text-xs font-bold">生成后刷新 Emby</span>
            <input type="checkbox" checked={refreshEmby} onChange={(e) => setRefreshEmby(e.target.checked)} className="w-4 h-4 accent-brand-primary" />
          </label>

          <label className="flex items-center justify-between rounded-xl px-3 py-2.5" style={CHECK_LABEL_STYLE}>
            <span className="text-xs font-bold">生成后刷新飞牛</span>
            <input type="checkbox" checked={refreshFeiniu} onChange={(e) => setRefreshFeiniu(e.target.checked)} className="w-4 h-4 accent-brand-primary" />
          </label>

          <label className="flex items-center justify-between rounded-xl px-3 py-2.5" style={CHECK_LABEL_STYLE}>
            <span className="text-xs font-bold">启用 STRM 代理</span>
            <input type="checkbox" checked={proxyEnabled} onChange={(e) => setProxyEnabled(e.target.checked)} className="w-4 h-4 accent-brand-primary" />
          </label>

          <div className="space-y-1">
            <label className="text-xs font-bold" style={LABEL_STYLE}>代理端口 (strm_proxy_port)</label>
            <input type="number" value={proxyPort ?? ""} onChange={(e) => setProxyPort(e.target.value ? Number(e.target.value) : undefined)} className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={INPUT_STYLE} />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-xl text-xs font-black bg-brand-primary text-white hover:bg-brand-primary-light disabled:opacity-50 flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
            {saving ? "保存中…" : "保存配置"}
          </button>
        </div>
      </div>

      {/* 归档入口 */}
      <div className="liquid-panel glass rounded-3xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
            <Folder className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
            <span>自动归档</span>
          </h3>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="glass glass-hover px-3 py-1.5 rounded-lg text-[10px] font-black disabled:opacity-50 flex items-center gap-1"
            style={{ color: "var(--txt-secondary)" }}
          >
            <ScanLine className="w-3.5 h-3.5" />
            {scanning ? "扫描中…" : "立即扫描归档"}
          </button>
        </div>
        {archiveCfg && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            {Object.entries(archiveCfg as Record<string, unknown>).slice(0, 9).map(([k, v]) => (
              <div key={k} className="glass rounded-lg px-2 py-1.5">
                <div className="text-[9px] font-bold truncate" style={KEY_STYLE}>{k}</div>
                <div className="text-xs font-black truncate" style={VALUE_STYLE}>{String(v ?? "—")}</div>
              </div>
            ))}
          </div>
        )}
        {!archiveCfg && <p className="text-xs font-semibold" style={{ color: "var(--txt-muted)" }}>未加载到归档配置</p>}
      </div>

      {/* 诊断结果 */}
      {diagnose != null && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="liquid-panel glass rounded-3xl p-5 space-y-2">
          <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}>
            <ScanLine className="w-4 h-4" style={{ color: "var(--brand-primary)" }} />
            <span>诊断结果</span>
            {(diagnose as Record<string, unknown>)?.error ? (
              <XCircle className="w-4 h-4" style={{ color: "var(--accent-danger)" }} />
            ) : (
              <CheckCircle2 className="w-4 h-4" style={{ color: "var(--accent-ok)" }} />
            )}
          </h3>
          <pre className="text-[10px] rounded-xl p-3 overflow-auto max-h-80 font-mono leading-relaxed" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" }}>
{JSON.stringify(diagnose, null, 2)}
          </pre>
        </motion.div>
      )}
    </div>
  );
}
