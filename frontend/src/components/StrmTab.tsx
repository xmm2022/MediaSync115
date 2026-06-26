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
import type { StrmConfig, ArchiveConfig } from "../api/types";
import { Film, RefreshCw, Play, AlertTriangle, CheckCircle2, XCircle, Settings2, Folder, ScanLine } from "lucide-react";
import { motion } from "motion/react";

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
  const [redirectMode, setRedirectMode] = useState("302");
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
      setRedirectMode((c.strm_redirect_mode as string) || "302");
      setRefreshEmby(Boolean(c.strm_refresh_emby_after_generate));
      setRefreshFeiniu(Boolean(c.strm_refresh_feiniu_after_generate));
      setProxyEnabled(Boolean(c.strm_proxy_enabled));
      setProxyPort(c.strm_proxy_port as number | undefined);
    } catch (err: any) {
      console.error(err);
      setError("加载 STRM/归档配置失败");
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
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || String(err);
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
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || String(err);
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
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || String(err);
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
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || String(err);
      setError(`归档扫描失败: ${detail}`);
    } finally {
      setScanning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="w-6 h-6 text-brand-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-3 flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <span className="text-xs font-bold text-red-700">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-600 text-xs font-bold">关闭</button>
        </div>
      )}

      {/* 标题 */}
      <div className="bg-gradient-to-br from-indigo-500/10 via-brand-primary/5 to-white/30 backdrop-blur-md rounded-3xl p-6 border border-white/60 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-txt-dark tracking-tight flex items-center gap-2.5">
            <Film className="w-6.5 h-6.5 text-indigo-500" />
            <span>STRM 虚拟文件管理</span>
          </h2>
          <p className="text-xs text-gray-500 mt-1 max-w-xl leading-relaxed">
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
            className="bg-white/80 border border-white/60 text-slate-500 px-4 py-2.5 rounded-2xl text-xs font-black tracking-wider flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
          >
            <ScanLine className="w-4 h-4" />
            <span>{diagnoseLoading ? "诊断中…" : "STRM 诊断"}</span>
          </button>
        </div>
      </div>

      {/* 运行时状态 */}
      {config?.runtime && (
        <div className="bg-white/60 backdrop-blur-md rounded-3xl border border-white/60 p-4 shadow-sm">
          <h3 className="text-sm font-black text-txt-dark flex items-center gap-2 mb-3">
            <Settings2 className="w-4 h-4 text-brand-primary" />
            <span>运行时状态</span>
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            {Object.entries(config.runtime as Record<string, unknown>).slice(0, 8).map(([k, v]) => (
              <div key={k} className="bg-white/70 border border-slate-200/50 rounded-xl px-3 py-2">
                <div className="text-[10px] text-slate-400 font-bold truncate">{k}</div>
                <div className="text-xs font-black text-txt-dark truncate">{String(v ?? "—")}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 配置表单 */}
      <div className="bg-white/70 backdrop-blur-md rounded-3xl border border-white/60 p-5 space-y-4 shadow-sm">
        <h3 className="text-sm font-black text-txt-dark flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-brand-primary" />
          <span>STRM 配置</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-center justify-between bg-white/60 border border-slate-200/50 rounded-xl px-3 py-2.5">
            <span className="text-xs font-bold text-slate-500">启用 STRM 生成</span>
            <input type="checkbox" checked={strmEnabled} onChange={(e) => setStrmEnabled(e.target.checked)} className="w-4 h-4 accent-brand-primary" />
          </label>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400">输出目录 (strm_output_dir)</label>
            <input type="text" value={outputDir} onChange={(e) => setOutputDir(e.target.value)} placeholder="/app/strm" className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400">回源 Base URL (strm_base_url)</label>
            <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={config?.suggested_base_url as string || "http://host:9008"} className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400">重定向模式 (strm_redirect_mode)</label>
            <select value={redirectMode} onChange={(e) => setRedirectMode(e.target.value)} className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary bg-white">
              <option value="302">302 重定向</option>
              <option value="proxy">代理回源</option>
            </select>
          </div>

          <label className="flex items-center justify-between bg-white/60 border border-slate-200/50 rounded-xl px-3 py-2.5">
            <span className="text-xs font-bold text-slate-500">生成后刷新 Emby</span>
            <input type="checkbox" checked={refreshEmby} onChange={(e) => setRefreshEmby(e.target.checked)} className="w-4 h-4 accent-brand-primary" />
          </label>

          <label className="flex items-center justify-between bg-white/60 border border-slate-200/50 rounded-xl px-3 py-2.5">
            <span className="text-xs font-bold text-slate-500">生成后刷新飞牛</span>
            <input type="checkbox" checked={refreshFeiniu} onChange={(e) => setRefreshFeiniu(e.target.checked)} className="w-4 h-4 accent-brand-primary" />
          </label>

          <label className="flex items-center justify-between bg-white/60 border border-slate-200/50 rounded-xl px-3 py-2.5">
            <span className="text-xs font-bold text-slate-500">启用 STRM 代理</span>
            <input type="checkbox" checked={proxyEnabled} onChange={(e) => setProxyEnabled(e.target.checked)} className="w-4 h-4 accent-brand-primary" />
          </label>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-400">代理端口 (strm_proxy_port)</label>
            <input type="number" value={proxyPort ?? ""} onChange={(e) => setProxyPort(e.target.value ? Number(e.target.value) : undefined)} className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" />
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
      <div className="bg-white/60 backdrop-blur-md rounded-3xl border border-white/60 p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-txt-dark flex items-center gap-2">
            <Folder className="w-4 h-4 text-brand-primary" />
            <span>自动归档</span>
          </h3>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1"
          >
            <ScanLine className="w-3.5 h-3.5" />
            {scanning ? "扫描中…" : "立即扫描归档"}
          </button>
        </div>
        {archiveCfg && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
            {Object.entries(archiveCfg as Record<string, unknown>).slice(0, 9).map(([k, v]) => (
              <div key={k} className="bg-white/60 border border-slate-200/50 rounded-lg px-2 py-1.5">
                <div className="text-[9px] text-slate-400 font-bold truncate">{k}</div>
                <div className="text-xs font-black text-txt-dark truncate">{String(v ?? "—")}</div>
              </div>
            ))}
          </div>
        )}
        {!archiveCfg && <p className="text-xs text-slate-400 font-semibold">未加载到归档配置</p>}
      </div>

      {/* 诊断结果 */}
      {diagnose != null && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white/70 backdrop-blur-md rounded-3xl border border-white/60 p-5 shadow-sm space-y-2">
          <h3 className="text-sm font-black text-txt-dark flex items-center gap-2">
            <ScanLine className="w-4 h-4 text-brand-primary" />
            <span>诊断结果</span>
            {(diagnose as Record<string, unknown>)?.error ? (
              <XCircle className="w-4 h-4 text-red-500" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            )}
          </h3>
          <pre className="text-[10px] text-slate-600 bg-slate-50 rounded-xl p-3 overflow-auto max-h-80 font-mono leading-relaxed">
{JSON.stringify(diagnose, null, 2)}
          </pre>
        </motion.div>
      )}
    </div>
  );
}