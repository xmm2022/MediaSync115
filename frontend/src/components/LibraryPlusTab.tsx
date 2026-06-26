/**
 * 片单 / 关注影人 / 许可证 — 对接后端三组此前零组件使用的 API：
 *   watchlistApi  /api/watchlists (片单 CRUD、填充、TMDB 导入)
 *   personFollowApi /api/person-follows (影人关注、feed、同步)
 *   licenseApi /api/license (许可证状态、激活、特性检查)
 */
import React, { useEffect, useState } from "react";
import { watchlistApi, personFollowApi, licenseApi } from "../api";
import type { WatchlistItem, PersonFollowItem } from "../api/types";
import {
  Bookmark, Users, KeyRound, Plus, Trash2, RefreshCw, Sparkles, Rss, CheckCircle2, XCircle, Heart,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

type Sub = "watchlist" | "person" | "license";

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
  const [busy, setBusy] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await watchlistApi.list();
      setLists(data ?? []);
    } catch (err: any) {
      addLog("ERROR", `加载片单失败: ${err?.message || err}`);
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

      {loading ? <p className="text-xs font-semibold" style={{ color: "var(--txt-muted)" }}>加载中…</p> : lists.length === 0 ? (
        <p className="text-xs font-semibold" style={{ color: "var(--txt-muted)" }}>暂无片单</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {lists.map((l) => (
            <div key={l.id} className="glass glass-hover rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-black truncate" style={{ color: "var(--txt)" }}>{l.name}</h4>
                <div className="flex gap-1">
                  <button onClick={() => handleFill(l)} disabled={busy === `fill-${l.id}`} className="p-1.5 rounded-lg bg-brand-primary/10 text-brand-primary border border-brand-primary/30 disabled:opacity-50" title="自动填充"><Sparkles className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleDelete(l)} className="p-1.5 rounded-lg text-red-500" title="删除" style={{ background: "rgba(239,68,68,0.14)", border: "1px solid var(--border)" } as React.CSSProperties}><Trash2 className="w-3.5 h-3.5" /></button>
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
  const [feed, setFeed] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [personId, setPersonId] = useState<number | undefined>(undefined);
  const [personName, setPersonName] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [l, f] = await Promise.all([
        personFollowApi.list().catch(() => ({ data: [] as PersonFollowItem[] })),
        personFollowApi.getFeed(20).catch(() => ({ data: null })),
      ]);
      setFollows(l.data ?? []);
      setFeed(f.data ?? null);
    } catch (err: any) {
      addLog("ERROR", `加载影人关注失败: ${err?.message || err}`);
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
        <div className="flex gap-2">
          <input type="number" value={personId ?? ""} onChange={(e) => setPersonId(e.target.value ? Number(e.target.value) : undefined)} placeholder="TMDB 影人 ID *" className="w-32 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" } as React.CSSProperties} />
          <input value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="影人名(可选)" className="flex-1 text-xs rounded-lg px-3 py-2 focus:outline-none focus:border-brand-primary" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)", color: "var(--txt)" } as React.CSSProperties} />
          <button onClick={handleFollow} disabled={!personId} className="px-3 py-2 rounded-lg text-xs font-black bg-brand-primary text-white disabled:opacity-50 flex items-center gap-1"><Heart className="w-3.5 h-3.5" /> 关注</button>
        </div>
      </div>

      {loading ? <p className="text-xs font-semibold" style={{ color: "var(--txt-muted)" }}>加载中…</p> : follows.length === 0 ? (
        <p className="text-xs font-semibold" style={{ color: "var(--txt-muted)" }}>暂无关注的影人</p>
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
                <button onClick={() => handleUnfollow(p)} className="px-2 py-0.5 rounded text-[9px] font-bold text-red-500" title="取消关注" style={{ background: "rgba(239,68,68,0.14)", border: "1px solid var(--border)" } as React.CSSProperties}>取关</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {feed != null && (
        <div className="glass rounded-2xl p-4">
          <h3 className="text-sm font-black flex items-center gap-2 mb-2" style={{ color: "var(--txt)" }}><Rss className="w-4 h-4 text-brand-primary" /> 影人动态 Feed</h3>
          <pre className="text-[10px] rounded-xl p-3 overflow-auto max-h-64 font-mono" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" } as React.CSSProperties}>{JSON.stringify(feed, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

// ============ 许可证 ============
function LicensePanel({ addLog }: { addLog: (l: "INFO" | "SUCCESS" | "WARN" | "ERROR", m: string) => Promise<void> }) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState("");

  const load = async () => {
    try {
      const { data } = await licenseApi.getStatus();
      setStatus(data as Record<string, unknown>);
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

  const isLicensed = Boolean(status?.licensed || status?.is_licensed || status?.active);

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
          <div className="flex items-center gap-2 text-xs font-bold" style={{ color: "var(--accent-warn)" }}><XCircle className="w-4 h-4" /> 未授权 / 试用</div>
        )}
        {status && <pre className="text-[10px] rounded-xl p-3 overflow-auto max-h-48 font-mono" style={{ background: "var(--surface-subtle)", color: "var(--txt-secondary)" } as React.CSSProperties}>{JSON.stringify(status, null, 2)}</pre>}
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