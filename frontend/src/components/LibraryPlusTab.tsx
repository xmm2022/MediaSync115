/**
 * 片单 / 关注影人 / 许可证 — 对接后端三组此前零组件使用的 API：
 *   watchlistApi  /api/watchlists (片单 CRUD、填充、TMDB 导入)
 *   personFollowApi /api/person-follows (影人关注、feed、同步)
 *   licenseApi /api/license (许可证状态、激活、特性检查)
 */
import React, { useEffect, useState } from "react";
import { watchlistApi, personFollowApi, licenseApi } from "../api";
import type { LicenseStatus, PersonFollowFeedItem, WatchlistItem, PersonFollowItem } from "../api/types";
import {
  Bookmark, Users, KeyRound, Plus, Trash2, RefreshCw, Sparkles, Rss, CheckCircle2, XCircle, Heart,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ErrorBanner from "./ui/ErrorBanner";
import EmptyState from "./ui/EmptyState";

type Sub = "watchlist" | "person" | "license";

function formatDateLabel(value?: string | null) {
  if (!value) return "日期未定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function getMediaTypeLabel(value?: string) {
  if (value === "movie") return "电影";
  if (value === "tv") return "剧集";
  return value || "作品";
}

function getLicenseTierLabel(tier?: string) {
  if (tier === "pro") return "Pro";
  return "Free";
}

function getLicenseFeatureLabel(feature: string) {
  const labels: Record<string, string> = {
    explore: "影视探索",
    subscription: "订阅管理",
    transfer: "资源转存",
    scheduler: "定时任务",
    workflow: "工作流",
    hdhive: "HDHive",
    telegram: "Telegram",
    quality_preference: "画质偏好",
    emby_sync: "Emby 同步",
    tg_bot: "TG Bot",
  };
  return labels[feature] || feature;
}

export default function LibraryPlusTab({ addLog }: { addLog: (l: "INFO" | "SUCCESS" | "WARN" | "ERROR", m: string) => Promise<void> }) {
  const [sub, setSub] = useState<Sub>("watchlist");

  return (
    <div className="space-y-6">
      <div className="glass-heavy rounded-3xl p-6">
        <h2 className="text-2xl font-black tracking-tight flex items-center gap-2.5" style={{ color: "var(--txt)" }}>
          <Bookmark className="w-6.5 h-6.5 text-rose-500" />
          <span>片单 / 影人 / 许可证</span>
        </h2>
        <p className="text-xs mt-1" style={{ color: "var(--txt-muted)" }}>管理想看片单、关注影人动态与许可证授权。</p>
      </div>

      {/* 子标签 */}
      <div className="flex gap-2">
        {([
          { k: "watchlist", label: "片单", icon: Bookmark },
          { k: "person", label: "关注影人", icon: Users },
          { k: "license", label: "许可证", icon: KeyRound },
        ] as { k: Sub; label: string; icon: React.ComponentType<{ className?: string }> }[]).map((s) => {
          const Icon = s.icon;
          const active = sub === s.k;
          return (
            <button
              key={s.k}
              onClick={() => setSub(s.k)}
              className={`px-4 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${active ? "glass-hover bg-brand-primary text-white border-brand-primary" : "glass-hover"}`}
              style={active ? undefined : { background: "var(--surface)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
            >
              <Icon className="w-4 h-4" />
              {s.label}
            </button>
          );
        })}
      </div>

      {sub === "watchlist" && <WatchlistPanel addLog={addLog} />}
      {sub === "person" && <PersonPanel addLog={addLog} />}
      {sub === "license" && <LicensePanel addLog={addLog} />}

      {/* 高级工具 (全局) */}
      {sub === "watchlist" && (
        <div className="glass rounded-2xl p-4 space-y-2">
          <p className="text-[10px] font-black" style={{ color:"var(--txt-muted)" }}>高级: 导入/预览</p>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={async () => { try { const r = await watchlistApi.listForStatus(); await addLog("SUCCESS", `状态映射: ${JSON.stringify(r.data)}`); } catch(e:any) { await addLog("ERROR", String(e)); } }}
              className="px-2 py-1 rounded text-[9px] font-bold glass-hover" style={{ color:"var(--txt-muted)", border:"1px solid var(--border)" }}>状态映射</button>
            <button onClick={async () => { try { const r = await watchlistApi.getImportCatalog(); await addLog("SUCCESS", `导入目录: ${JSON.stringify(r.data)}`); } catch(e:any) { await addLog("ERROR", String(e)); } }}
              className="px-2 py-1 rounded text-[9px] font-bold glass-hover" style={{ color:"var(--txt-muted)", border:"1px solid var(--border)" }}>导入目录</button>
            <button onClick={async () => { try { const r = await watchlistApi.getImportSources(); await addLog("SUCCESS", `导入来源: ${JSON.stringify(r.data)}`); } catch(e:any) { await addLog("ERROR", String(e)); } }}
              className="px-2 py-1 rounded text-[9px] font-bold glass-hover" style={{ color:"var(--txt-muted)", border:"1px solid var(--border)" }}>导入来源</button>
            <button onClick={async () => { try { const r = await watchlistApi.previewImport({source:"tmdb",media_type:"movie"}); await addLog("SUCCESS", `导入预览: ${JSON.stringify(r.data)}`); } catch(e:any) { await addLog("ERROR", String(e)); } }}
              className="px-2 py-1 rounded text-[9px] font-bold glass-hover" style={{ color:"var(--txt-muted)", border:"1px solid var(--border)" }}>导入预览</button>
            <button onClick={async () => { try { const r = await watchlistApi.importFromTmdb({source:"tmdb",media_type:"movie"}); await addLog("SUCCESS", `TMDB导入: ${JSON.stringify(r.data)}`); } catch(e:any) { await addLog("ERROR", String(e)); } }}
              className="px-2 py-1 rounded text-[9px] font-bold text-white" style={{ background:"var(--brand-primary)" }}>导入TMDB</button>
          </div>
        </div>
      )}
      {sub === "person" && (
        <div className="pt-2">
          <button onClick={async () => { try { const r = await personFollowApi.getStatusMap(); await addLog("SUCCESS", `影人状态: ${JSON.stringify(r.data)}`); } catch(e:any) { await addLog("ERROR", String(e)); } }}
            className="px-3 py-1.5 rounded-lg text-[10px] font-black glass-hover" style={{ color:"var(--txt-muted)", border:"1px solid var(--border)" }}>影人状态映射</button>
        </div>
      )}
    </div>
  );
}

// ============ 片单 ============
function WatchlistPanel({ addLog }: { addLog: (l: "INFO" | "SUCCESS" | "WARN" | "ERROR", m: string) => Promise<void> }) {
  const [lists, setLists] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data } = await watchlistApi.list();
      setLists(data ?? []);
    } catch (err: any) {
      const msg = err?.message || String(err);
      setLoadError(`加载片单失败: ${msg}`);
      await addLog("ERROR", `加载片单失败: ${msg}`);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      await watchlistApi.create({ name: newName.trim(), description: newDesc.trim() || undefined });
      setNewName(""); setNewDesc("");
      await addLog("SUCCESS", `已创建片单 [${newName.trim()}]`);
      await load();
    } catch (err: any) {
      await addLog("ERROR", `创建片单失败: ${err?.response?.data?.detail || err?.message}`);
    }
  };

  const handleFill = async (l: WatchlistItem) => {
    setBusy(`fill-${l.id}`);
    try {
      await watchlistApi.fill(l.id);
      await addLog("SUCCESS", `片单 [${l.name}] 已触发自动填充`);
    } catch (err: any) {
      await addLog("ERROR", `填充失败: ${err?.response?.data?.detail || err?.message}`);
    } finally { setBusy(null); }
  };

  const handleDelete = async (l: WatchlistItem) => {
    if (!confirm(`删除片单 [${l.name}]？`)) return;
    try {
      await watchlistApi.delete(l.id);
      setLists((p) => p.filter((x) => x.id !== l.id));
      await addLog("WARN", `已删除片单 [${l.name}]`);
    } catch (err: any) {
      await addLog("ERROR", `删除失败: ${err?.message || err}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* 新建 */}
      <div className="glass glass-hover rounded-2xl p-4 space-y-3">
        <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}><Plus className="w-4 h-4 text-brand-primary" /> 新建片单</h3>
        <div className="flex flex-col md:flex-row gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="片单名称 *" className="flex-1 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" } as React.CSSProperties} />
          <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="描述(可选)" className="flex-1 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" } as React.CSSProperties} />
          <button onClick={handleCreate} disabled={!newName.trim()} className="px-4 py-2 rounded-lg text-xs font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> 创建</button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={`sk-${i}`} className="glass rounded-2xl p-4 space-y-2 animate-pulse" aria-hidden="true">
              <div className="h-3.5 rounded w-1/2" style={{ background: "var(--surface-subtle)" }} />
              <div className="h-2.5 rounded w-3/4" style={{ background: "var(--surface-subtle)" }} />
              <div className="flex gap-1 pt-1">
                <div className="h-3 w-12 rounded" style={{ background: "var(--surface-subtle)" }} />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="glass rounded-2xl p-6 text-center">
          <ErrorBanner variant="block" message={loadError} onRetry={load} />
        </div>
      ) : lists.length === 0 ? (
        <div className="glass rounded-2xl p-6 text-center">
          <EmptyState icon={<Bookmark className="w-7 h-7" style={{ color: "var(--txt-muted)" }} />} text="暂无片单" subtext="在上方填入名称即可创建你的第一个片单。" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {lists.map((l) => (
            <div key={l.id} className="glass glass-hover rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-black truncate" style={{ color: "var(--txt)" }}>{l.name}</h4>
                <div className="flex gap-1">
                  <button onClick={() => handleFill(l)} disabled={busy === `fill-${l.id}`} className="p-1.5 rounded-lg bg-brand-primary/10 text-brand-primary border border-brand-primary/30 disabled:opacity-50" title="自动填充"><Sparkles className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleDelete(l)} className="p-1.5 rounded-lg text-red-500" title="删除" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid var(--border)" } as React.CSSProperties}><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              {l.description && <p className="text-[10px] font-semibold line-clamp-2" style={{ color: "var(--txt-muted)" }}>{l.description}</p>}
              <div className="flex flex-wrap gap-1 text-[9px] font-bold">
                {l.auto_fill_enabled && <span className="px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.16)", color: "var(--accent-ok)" } as React.CSSProperties}>自动填充</span>}
                <span className="px-1.5 py-0.5 rounded" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" } as React.CSSProperties}>{String((l as Record<string, unknown>).item_count ?? "—")} 项</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============ 影人 ============
function PersonPanel({ addLog }: { addLog: (l: "INFO" | "SUCCESS" | "WARN" | "ERROR", m: string) => Promise<void> }) {
  const [follows, setFollows] = useState<PersonFollowItem[]>([]);
  const [feed, setFeed] = useState<PersonFollowFeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [personId, setPersonId] = useState<number | undefined>(undefined);
  const [personName, setPersonName] = useState("");

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [l, f] = await Promise.all([
        personFollowApi.list().catch(() => ({ data: [] as PersonFollowItem[] })),
        personFollowApi.getFeed(20).catch(() => ({ data: [] as PersonFollowFeedItem[] })),
      ]);
      setFollows(l.data ?? []);
      setFeed(Array.isArray(f.data) ? f.data : []);
    } catch (err: any) {
      const msg = err?.message || String(err);
      setLoadError(`加载影人关注失败: ${msg}`);
      await addLog("ERROR", `加载影人关注失败: ${msg}`);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const handleFollow = async () => {
    if (!personId) return;
    try {
      await personFollowApi.create({ tmdb_person_id: personId, name: personName.trim() || `影人 ${personId}` });
      await addLog("SUCCESS", `已关注影人 ${personName || personId}`);
      setPersonId(undefined); setPersonName("");
      await load();
    } catch (err: any) {
      await addLog("ERROR", `关注失败: ${err?.response?.data?.detail || err?.message}`);
    }
  };

  const handleUnfollow = async (p: PersonFollowItem) => {
    try {
      await personFollowApi.delete(p.id);
      setFollows((prev) => prev.filter((x) => x.id !== p.id));
      await addLog("WARN", `已取消关注 ${p.name}`);
    } catch (err: any) {
      await addLog("ERROR", `取消关注失败: ${err?.message || err}`);
    }
  };

  const handleSync = async () => {
    setBusy("sync");
    try {
      await personFollowApi.sync();
      await addLog("SUCCESS", "影人作品同步完成");
      await load();
    } catch (err: any) {
      await addLog("ERROR", `同步失败: ${err?.response?.data?.detail || err?.message}`);
    } finally { setBusy(null); }
  };

  const handleToggleAuto = async (p: PersonFollowItem) => {
    try {
      await personFollowApi.update(p.id, { auto_subscribe_new_works: !p.auto_subscribe_new_works });
      setFollows((prev) => prev.map((x) => x.id === p.id ? { ...x, auto_subscribe_new_works: !x.auto_subscribe_new_works } : x));
    } catch (err: any) {
      await addLog("ERROR", `更新失败: ${err?.message || err}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="glass glass-hover rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}><Users className="w-4 h-4 text-brand-primary" /> 关注影人</h3>
          <button onClick={handleSync} disabled={busy === "sync"} className="px-3 py-1.5 rounded-lg text-[10px] font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"><RefreshCw className={`w-3 h-3 ${busy === "sync" ? "animate-spin" : ""}`} /> 同步作品</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[8rem_minmax(0,1fr)_auto] gap-2">
          <input type="number" value={personId ?? ""} onChange={(e) => setPersonId(e.target.value ? Number(e.target.value) : undefined)} placeholder="TMDB 影人 ID *" className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" } as React.CSSProperties} />
          <input value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="影人名(可选)" className="w-full text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" } as React.CSSProperties} />
          <button onClick={handleFollow} disabled={!personId} className="w-full sm:w-auto justify-center px-3 py-2 rounded-lg text-xs font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"><Heart className="w-3.5 h-3.5" /> 关注</button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={`sk-${i}`} className="glass rounded-2xl p-3 text-center space-y-2 animate-pulse" aria-hidden="true">
              <div className="w-16 h-16 rounded-full mx-auto" style={{ background: "var(--surface-subtle)" }} />
              <div className="h-2.5 rounded w-2/3 mx-auto" style={{ background: "var(--surface-subtle)" }} />
              <div className="h-2 rounded w-1/2 mx-auto" style={{ background: "var(--surface-subtle)" }} />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="glass rounded-2xl p-6 text-center">
          <ErrorBanner variant="block" message={loadError} onRetry={load} />
        </div>
      ) : follows.length === 0 ? (
        <div className="glass rounded-2xl p-6 text-center">
          <EmptyState icon={<Users className="w-7 h-7" style={{ color: "var(--txt-muted)" }} />} text="暂无关注的影人" subtext="在上方填入 TMDB 影人 ID 即可关注，追踪其新作动态。" />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {follows.map((p) => (
            <div key={p.id} className="glass glass-hover rounded-2xl p-3 text-center space-y-2">
              {p.profile_path ? (
                <img src={`https://image.tmdb.org/t/p/w200${p.profile_path}`} alt={p.name} className="w-16 h-16 rounded-full object-cover mx-auto" style={{ border: "1px solid var(--border)" } as React.CSSProperties} referrerPolicy="no-referrer" />
              ) : (
                <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto" style={{ background: "var(--surface-subtle)" } as React.CSSProperties}><Users className="w-6 h-6" style={{ color: "var(--txt-muted)" }} /></div>
              )}
              <div className="text-xs font-black truncate" style={{ color: "var(--txt)" }}>{p.name}</div>
              {p.known_for_department && <div className="text-[9px] font-bold" style={{ color: "var(--txt-muted)" }}>{p.known_for_department}</div>}
              <div className="flex gap-1 justify-center">
                <button onClick={() => handleToggleAuto(p)} className="px-2 py-0.5 rounded text-[9px] font-bold glass-hover" title="自动订阅新作" style={p.auto_subscribe_new_works ? { background: "rgba(34,197,94,0.16)", color: "var(--accent-ok)", border: "1px solid var(--border)" } : { background: "var(--surface-subtle)", color: "var(--txt-secondary)", border: "1px solid var(--border)" } as React.CSSProperties}>{p.auto_subscribe_new_works ? "自动订阅" : "手动"}</button>
                <button onClick={() => handleUnfollow(p)} className="px-2 py-0.5 rounded text-[9px] font-bold text-red-500" title="取消关注" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid var(--border)" } as React.CSSProperties}>取关</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && (
        <div className="glass rounded-2xl p-4 space-y-3">
          <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}><Rss className="w-4 h-4 text-brand-primary" /> 影人动态 Feed</h3>
          {feed.length === 0 ? (
            <p className="text-xs font-semibold" style={{ color: "var(--txt-muted)" }}>暂无即将上线作品</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {feed.map((item) => (
                <div key={item.id} className="glass glass-hover rounded-xl p-3 flex gap-3 min-w-0">
                  {item.poster_path ? (
                    <img src={`https://image.tmdb.org/t/p/w154${item.poster_path}`} alt={item.title} className="w-12 h-16 rounded-lg object-cover shrink-0" style={{ border: "1px solid var(--border)" } as React.CSSProperties} referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-12 h-16 rounded-lg shrink-0 flex items-center justify-center" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" } as React.CSSProperties}>
                      <Bookmark className="w-5 h-5" style={{ color: "var(--txt-muted)" }} />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" } as React.CSSProperties}>{getMediaTypeLabel(item.media_type)}</span>
                      {item.subscribed && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.16)", color: "var(--accent-ok)" } as React.CSSProperties}>已订阅</span>}
                    </div>
                    <div className="text-xs font-black truncate" style={{ color: "var(--txt)" }}>{item.title}</div>
                    <div className="text-[10px] font-bold mt-1 truncate" style={{ color: "var(--txt-muted)" }}>
                      {item.person_name} · {formatDateLabel(item.credit_date)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============ 许可证 ============
function LicensePanel({ addLog }: { addLog: (l: "INFO" | "SUCCESS" | "WARN" | "ERROR", m: string) => Promise<void> }) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");

  const load = async () => {
    try {
      const { data } = await licenseApi.getStatus();
      setStatus(data);
    } catch (err: any) {
      await addLog("ERROR", `加载许可证状态失败: ${err?.message || err}`);
    }
  };
  useEffect(() => { void load(); }, []);

  const handleActivate = async () => {
    setBusy(true);
    try {
      await licenseApi.activate(key.trim() || undefined);
      await addLog("SUCCESS", "许可证已激活");
      setKey("");
      await load();
    } catch (err: any) {
      await addLog("ERROR", `激活失败: ${err?.response?.data?.detail || err?.message}`);
    } finally { setBusy(false); }
  };

  const isLicensed = status?.tier === "pro";
  const hasLicenseKey = Boolean(status?.has_license_key);
  const features = Object.entries(status?.features ?? {});

  return (
    <div className="space-y-4">
      <div className="glass glass-hover rounded-2xl p-4 space-y-3" style={{ border: isLicensed ? "1px solid rgba(34,197,94,0.3)" : "1px solid rgba(245,158,11,0.3)" } as React.CSSProperties}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black flex items-center gap-2" style={{ color: "var(--txt)" }}><KeyRound className="w-4 h-4 text-brand-primary" /> 许可证状态</h3>
          <button onClick={load} className="px-3 py-1.5 rounded-lg text-[10px] font-black glass-hover flex items-center gap-1" style={{ background: "var(--surface)", color: "var(--txt-secondary)", border: "1px solid var(--border)" } as React.CSSProperties}><RefreshCw className="w-3 h-3" /> 刷新</button>
        </div>
        {isLicensed ? (
          <div className="flex items-center gap-2 text-xs font-bold" style={{ color: "var(--accent-ok)" }}><CheckCircle2 className="w-4 h-4" /> 已授权</div>
        ) : (
          <div className="flex items-center gap-2 text-xs font-bold" style={{ color: "var(--accent-warn)" }}><XCircle className="w-4 h-4" /> 免费版</div>
        )}
        {status ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded-xl p-3" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" } as React.CSSProperties}>
                <p className="text-[10px] font-black uppercase" style={{ color: "var(--txt-muted)" }}>当前等级</p>
                <p className="text-sm font-black mt-1" style={{ color: "var(--txt)" }}>{getLicenseTierLabel(status.tier)}</p>
              </div>
              <div className="rounded-xl p-3" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" } as React.CSSProperties}>
                <p className="text-[10px] font-black uppercase" style={{ color: "var(--txt-muted)" }}>许可证密钥</p>
                <p className="text-sm font-black mt-1" style={{ color: hasLicenseKey ? "var(--accent-ok)" : "var(--txt-secondary)" }}>
                  {hasLicenseKey ? "已配置" : "未配置"}
                </p>
              </div>
            </div>
            {features.length > 0 && (
              <div>
                <h4 className="text-xs font-black mb-2" style={{ color: "var(--txt)" }}>许可证功能</h4>
                <div className="flex flex-wrap gap-1.5">
                  {features.map(([feature, enabled]) => (
                    <span
                      key={feature}
                      className="text-[9px] font-bold px-2 py-1 rounded-lg"
                      style={enabled ? { background: "rgba(34,197,94,0.16)", color: "var(--accent-ok)" } : { background: "rgba(239,68,68,0.12)", color: "var(--accent-danger)" } as React.CSSProperties}
                    >
                      {getLicenseFeatureLabel(feature)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs font-semibold" style={{ color: "var(--txt-muted)" }}>正在加载许可证状态…</p>
        )}
      </div>

      <div className="glass glass-hover rounded-2xl p-4 space-y-2">
        <h3 className="text-sm font-black" style={{ color: "var(--txt)" }}>激活许可证</h3>
        <div className="flex gap-2">
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="许可证密钥" className="flex-1 text-xs rounded-lg px-3 py-2 font-mono focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" } as React.CSSProperties} />
          <button onClick={handleActivate} disabled={busy} className="px-4 py-2 rounded-lg text-xs font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"><KeyRound className="w-3.5 h-3.5" /> {busy ? "激活中" : "激活"}</button>
        </div>
        <div className="flex gap-2 mt-2">
          <button onClick={async () => { try { const r = await licenseApi.checkFeature("search"); await addLog("SUCCESS", `特性检测: ${JSON.stringify(r.data)}`); } catch(e: any) { await addLog("ERROR", String(e)); } }}
            className="px-3 py-1.5 rounded-lg text-[10px] font-black glass-hover" style={{ color: "var(--txt-muted)", border: "1px solid var(--border)" }}>特性检测</button>
        </div>
      </div>

    </div>
  );
}
