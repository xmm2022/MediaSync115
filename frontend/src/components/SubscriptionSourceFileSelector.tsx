import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import {
  CheckCircle2,
  ClipboardList,
  RefreshCw,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { subscriptionApi } from "../api";
import { getApiErrorMessage } from "../api/errors";
import type { SubscriptionSource, SubscriptionSourceFile } from "../api/types";

interface SubscriptionSourceFileSelectorProps {
  subscriptionId: string;
  subscriptionTitle: string;
  source: SubscriptionSource;
  disabled?: boolean;
  addLog?: (
    level: "INFO" | "SUCCESS" | "WARN" | "ERROR",
    message: string,
  ) => Promise<void>;
  onSourceUpdated: (source: SubscriptionSource) => void;
  onRefresh?: () => Promise<void> | void;
}

const mutedTextStyle = { color: "var(--txt-muted)" } as CSSProperties;
const secondaryTextStyle = { color: "var(--txt-secondary)" } as CSSProperties;
const borderStyle = { border: "1px solid var(--border)" } as CSSProperties;

function normalizeIds(value: unknown): string[] {
  const rawItems = Array.isArray(value) ? value : [];
  return Array.from(
    new Set(rawItems.map((item) => String(item || "").trim()).filter(Boolean)),
  );
}

function getSourceFileId(file: SubscriptionSourceFile): string {
  return String(file.share_file_id || "").trim();
}

function sortSourceFiles(files: SubscriptionSourceFile[]): SubscriptionSourceFile[] {
  return [...files].sort((a, b) => {
    const seasonA = a.season_number ?? Number.MAX_SAFE_INTEGER;
    const seasonB = b.season_number ?? Number.MAX_SAFE_INTEGER;
    if (seasonA !== seasonB) return seasonA - seasonB;
    const episodeA = a.episode_number ?? Number.MAX_SAFE_INTEGER;
    const episodeB = b.episode_number ?? Number.MAX_SAFE_INTEGER;
    if (episodeA !== episodeB) return episodeA - episodeB;
    return String(a.file_name || "").localeCompare(String(b.file_name || ""));
  });
}

function formatFileSize(value?: number | null): string {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(1)} GB`;
  if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(size / 1024)} KB`;
}

function formatEpisodeLabel(file: SubscriptionSourceFile): string {
  if (file.season_number == null || file.episode_number == null) return "";
  return `S${String(file.season_number).padStart(2, "0")}E${String(file.episode_number).padStart(2, "0")}`;
}

export default function SubscriptionSourceFileSelector({
  subscriptionId,
  subscriptionTitle,
  source,
  disabled = false,
  addLog,
  onSourceUpdated,
  onRefresh,
}: SubscriptionSourceFileSelectorProps) {
  const [editing, setEditing] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedIds = normalizeIds(source.selected_file_ids);
  const files = useMemo(() => sortSourceFiles(source.files || []), [source.files]);
  const knownFileIds = useMemo(
    () => new Set(files.map(getSourceFileId).filter(Boolean)),
    [files],
  );
  const missingSelectedIds = selectedIds.filter((id) => !knownFileIds.has(id));
  const draftSet = useMemo(() => new Set(draftIds), [draftIds]);

  const startEditing = () => {
    setDraftIds(selectedIds);
    setError("");
    setEditing(true);
  };

  const toggleDraftId = (fileId: string) => {
    setDraftIds((prev) => (
      prev.includes(fileId)
        ? prev.filter((item) => item !== fileId)
        : [...prev, fileId]
    ));
  };

  const saveSelection = async (nextIds: string[]) => {
    const normalized = normalizeIds(nextIds);
    setBusy(true);
    setError("");
    try {
      const response = await subscriptionApi.updateSource(subscriptionId, String(source.id), {
        selected_file_ids: normalized,
      });
      const updated = (response.data || {
        ...source,
        selected_file_ids: normalized,
      }) as SubscriptionSource;
      onSourceUpdated(updated);
      setDraftIds(normalizeIds(updated.selected_file_ids));
      setEditing(false);
      await onRefresh?.();
      await addLog?.(
        "INFO",
        `已更新 [${subscriptionTitle}] 的 115 补缺源文件范围`,
      );
    } catch (err) {
      setError(`更新文件范围失败: ${getApiErrorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const selectedLabel = selectedIds.length > 0
    ? `限制 ${selectedIds.length} 个文件`
    : "未限制文件";

  return (
    <div className="space-y-2 rounded-lg px-2 py-2" style={{ background: "var(--surface)", ...borderStyle }}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[9px] font-black" style={secondaryTextStyle}>
            <ClipboardList className="w-3 h-3" />
            <span>文件范围</span>
            <span
              className="rounded px-1.5 py-0.5"
              style={selectedIds.length > 0
                ? { background: "rgba(245,158,11,0.14)", color: "var(--accent-warn)" }
                : { background: "rgba(34,197,94,0.14)", color: "var(--accent-ok)" }}
            >
              {selectedLabel}
            </span>
          </div>
          <p className="mt-1 text-[9px] font-semibold" style={mutedTextStyle}>
            {files.length > 0
              ? `已记录 ${files.length} 个分享文件，可勾选限定后续扫描范围。`
              : selectedIds.length > 0
                ? "当前只保存了文件 ID；扫描来源后可按文件名勾选。"
                : "扫描时会按缺集自动匹配分享中的视频文件。"}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {selectedIds.length > 0 && (
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => void saveSelection([])}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[9px] font-black glass-hover disabled:opacity-50 cursor-pointer"
              style={{ color: "var(--txt-secondary)", ...borderStyle }}
              title="取消固定文件限制"
            >
              <XCircle className="w-3 h-3" />
              不限
            </button>
          )}
          <button
            type="button"
            disabled={disabled || busy}
            onClick={editing ? () => setEditing(false) : startEditing}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[9px] font-black glass-hover disabled:opacity-50 cursor-pointer"
            style={{ color: "var(--txt-secondary)", ...borderStyle }}
            title={editing ? "收起文件范围编辑" : "管理文件范围"}
          >
            <SlidersHorizontal className="w-3 h-3" />
            {editing ? "收起" : "管理"}
          </button>
        </div>
      </div>

      {editing && (
        <div className="space-y-2 rounded-lg p-2" style={{ background: "var(--surface-subtle)", ...borderStyle }}>
          {files.length > 0 ? (
            <div className="max-h-52 overflow-y-auto pr-1 space-y-1">
              {files.map((file) => {
                const fileId = getSourceFileId(file);
                const checked = Boolean(fileId && draftSet.has(fileId));
                const episodeLabel = formatEpisodeLabel(file);
                const fileSize = formatFileSize(file.file_size);
                return (
                  <label
                    key={file.id}
                    className="flex items-start gap-2 rounded px-2 py-1.5 cursor-pointer transition-colors hover:bg-white/5"
                    style={{ border: "1px solid transparent" }}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3.5 w-3.5 cursor-pointer"
                      checked={checked}
                      disabled={!fileId || busy}
                      onChange={() => fileId && toggleDraftId(fileId)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[9px] font-bold" style={{ color: "var(--txt)" }}>
                        {file.file_name}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-1 text-[8px] font-semibold" style={mutedTextStyle}>
                        {episodeLabel && <span>{episodeLabel}</span>}
                        {fileSize && <span>{fileSize}</span>}
                        {file.status && <span>{file.status}</span>}
                        {fileId && <span>{fileId}</span>}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          ) : (
            <div className="space-y-1">
              <p className="text-[9px] font-semibold" style={mutedTextStyle}>
                暂无已扫描文件。可以先扫描来源；若旧白名单已不需要，可直接保存为空。
              </p>
              {missingSelectedIds.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {missingSelectedIds.map((id) => (
                    <span
                      key={id}
                      className="rounded px-1.5 py-0.5 text-[8px] font-bold"
                      style={{ background: "rgba(245,158,11,0.14)", color: "var(--accent-warn)" }}
                    >
                      {id}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {missingSelectedIds.length > 0 && files.length > 0 && (
            <p className="text-[8px] font-semibold" style={{ color: "var(--accent-warn)" }}>
              还有 {missingSelectedIds.length} 个已保存 ID 未在最近扫描文件中出现，保存后会按当前勾选结果更新。
            </p>
          )}

          {error && (
            <p className="text-[9px] font-bold" style={{ color: "var(--accent-danger)" }}>
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => setDraftIds([])}
              className="rounded px-2 py-1 text-[9px] font-black glass-hover disabled:opacity-50 cursor-pointer"
              style={{ color: "var(--txt-secondary)", ...borderStyle }}
            >
              清空
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setDraftIds(selectedIds);
              }}
              className="rounded px-2 py-1 text-[9px] font-black glass-hover disabled:opacity-50 cursor-pointer"
              style={{ color: "var(--txt-secondary)", ...borderStyle }}
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void saveSelection(draftIds)}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[9px] font-black text-white disabled:opacity-50 cursor-pointer"
              style={{ background: "var(--brand-primary)" }}
            >
              {busy ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
