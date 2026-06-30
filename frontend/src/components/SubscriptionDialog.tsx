/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SubscriptionDialog — 资源详情页的订阅弹窗
 *
 * 承载：
 *   1. 渠道选择（115 自动搜索 / 夸克 暂未接入 / PT 下载 MoviePilot）
 *   2. 115 渠道支持「绑定固定 115 分享链接」作为订阅来源（POST /subscriptions/{id}/sources）
 *   3. TV 类型支持订阅范围（tv_scope: all/season/episode + 季号/集段）
 *   4. 已订阅状态展示与取消入口
 *   5. PT 创建前对「已有 115 订阅会被后端改写 provider」的提示
 *
 * 后端约定：
 *   - 115 自动搜索订阅走 POST /api/subscriptions（带 tv_* 字段；toggle 不支持 tv_* 故不用）
 *   - 夸克订阅后端未接入，仅提示
 *   - PT 订阅走 POST /api/moviepilot/subscriptions
 *   - 取消订阅走 DELETE /api/subscriptions/{id}
 *   - 固定来源绑定走 POST /api/subscriptions/{id}/sources
 */

import React, { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  HardDrive, Cloud, Download, CheckCircle, RefreshCw, Rss, Link2, AlertTriangle, Film, Tv, X,
} from "lucide-react";
import { subscriptionApi } from "../api/subscription";
import { moviepilotApi } from "../api/moviepilot";
import type { MediaResourceLink } from "../types";

export type SubscriptionChannel = "pan115" | "quark" | "pt";

type TvScope = "all" | "season" | "episode";

interface TmdbSeason {
  season_number: number;
  name: string;
  episode_count: number;
}

interface SubscriptionDialogProps {
  open: boolean;
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  defaultPoster?: string;
  detail?: {
    poster_path?: string;
    overview?: string;
    release_date?: string;
    first_air_date?: string;
    vote_average?: number;
  } | null;
  seasons?: TmdbSeason[];
  /** 当前资源通道里已拉取的资源链接，用于「绑定固定 115 分享链接」选择 */
  resources: MediaResourceLink[];
  /** 当前订阅状态：id 为 null = 未订阅 */
  pan115SubId: string | null;
  ptSubId: string | null;
  addLog: (level: "INFO" | "SUCCESS" | "WARN" | "ERROR", message: string) => Promise<void>;
  onClose: () => void;
  /** 订阅状态变化后调用，用于父组件刷新 checkSubscription */
  onChanged: () => void | Promise<void>;
}

function posterUrl(path: string | undefined, size = "w300"): string {
  if (!path) return "";
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

/** 从 resources 里筛出可作为 115 固定来源的分享链接 */
function pickPan115ShareLinks(resources: MediaResourceLink[]): MediaResourceLink[] {
  const seen = new Set<string>();
  const out: MediaResourceLink[] = [];
  for (const r of resources) {
    const url = String(r.shareUrl || "");
    const value = url.toLowerCase();
    if (!url || seen.has(url)) continue;
    if (!value.includes("115.com/") && !value.includes("115cdn.com/")) continue;
    seen.add(url);
    out.push(r);
  }
  return out;
}

export default function SubscriptionDialog({
  open, tmdbId, mediaType, title, defaultPoster, detail, seasons = [],
  resources, pan115SubId, ptSubId, addLog, onClose, onChanged,
}: SubscriptionDialogProps) {
  const [channel, setChannel] = useState<SubscriptionChannel>("pan115");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // 115 固定来源绑定
  const [bindFixedLink, setBindFixedLink] = useState(false);
  const [selectedShareUrl, setSelectedShareUrl] = useState<string>("");

  // TV 订阅范围
  const [tvScope, setTvScope] = useState<TvScope>("all");
  const [tvSeasonNumber, setTvSeasonNumber] = useState<number>(1);
  const [tvEpisodeStart, setTvEpisodeStart] = useState<number | "">("");
  const [tvEpisodeEnd, setTvEpisodeEnd] = useState<number | "">("");

  const isPan115Subscribed = pan115SubId !== null;
  const isPtSubscribed = ptSubId !== null;

  const pan115ShareLinks = useMemo(() => pickPan115ShareLinks(resources), [resources]);

  // 弹窗打开时重置本地状态
  useEffect(() => {
    if (!open) return;
    setError(null);
    setInfo(null);
    setSubmitting(false);
    setBindFixedLink(false);
    setSelectedShareUrl("");
    setTvScope("all");
    setTvSeasonNumber(seasons.find((s) => s.season_number > 0)?.season_number ?? 1);
    setTvEpisodeStart("");
    setTvEpisodeEnd("");
    setChannel("pan115");
  }, [open, seasons]);

  if (!open) return null;

  const buildTvParams = () => {
    if (mediaType !== "tv" || tvScope === "all") return {};
    if (tvScope === "season") {
      return { tv_scope: "season", tv_season_number: tvSeasonNumber };
    }
    return {
      tv_scope: "episode",
      tv_season_number: tvSeasonNumber,
      ...(tvEpisodeStart !== "" ? { tv_episode_start: Number(tvEpisodeStart) } : {}),
      ...(tvEpisodeEnd !== "" ? { tv_episode_end: Number(tvEpisodeEnd) } : {}),
    };
  };

  const handleCancel = async (channelType: SubscriptionChannel) => {
    const id = channelType === "pan115" ? pan115SubId : ptSubId;
    if (!id) return;
    setSubmitting(true);
    setError(null);
    try {
      await subscriptionApi.delete(id);
      await addLog("INFO", `已取消${channelType === "pan115" ? " 115 自动搜索" : " PT 下载"}订阅: ${title}`);
      await onChanged();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
      setError(`取消失败: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    setError(null);
    setInfo(null);

    if (channel === "quark") {
      setInfo("夸克订阅暂未接入。可在资源通道先把夸克分享链接转存一次，再由系统调度扫描。");
      return;
    }

    if (channel === "pt" && isPan115Subscribed) {
      const ok = window.confirm(
        `检测到「${title}」已存在 115 自动搜索订阅。\n\n` +
        `创建 MoviePilot PT 订阅会让后端将同一个 TMDB 订阅的归属从 MediaSync115 改写为 MoviePilot，` +
        `此后本系统定时扫描将不再处理它（115 自动搜索会失效，改由 MoviePilot 调度 PT 下载）。\n\n` +
        `确认继续创建 PT 订阅？`,
      );
      if (!ok) return;
    }

    if (channel === "pan115" && bindFixedLink && !selectedShareUrl) {
      setError("请选择一条 115 分享链接作为固定来源，或关闭「绑定固定来源」开关。");
      return;
    }

    setSubmitting(true);
    try {
      const tvParams = buildTvParams();
      const posterPath = detail?.poster_path || defaultPoster;
      const year = detail?.release_date?.split("-")[0] || detail?.first_air_date?.split("-")[0] || undefined;

      if (channel === "pan115") {
        // 用 create 而非 toggle：toggle 不支持 tv_* 字段
        const createResp = await subscriptionApi.create({
          tmdb_id: tmdbId,
          title,
          media_type: mediaType,
          ...(posterPath ? { poster_path: posterPath } : {}),
          ...(detail?.overview ? { overview: detail.overview } : {}),
          ...(year ? { year } : {}),
          ...(typeof detail?.vote_average === "number" ? { rating: detail.vote_average } : {}),
          auto_download: true,
          ...tvParams,
        });
        const created = createResp.data as { id?: string };
        const subId = created?.id ? String(created.id) : "";

        // 绑定固定来源（后端要求 TV 订阅 + tmdb_id 非空才能扫描，但绑定接口本身 POST /sources 不限类型）
        if (bindFixedLink && selectedShareUrl && subId) {
          const link = pan115ShareLinks.find((l) => l.shareUrl === selectedShareUrl);
          await subscriptionApi.createSource(subId, {
            share_url: selectedShareUrl,
            receive_code: link?.receiveCode || "",
            display_name: link?.name || title,
          });
          await addLog("SUCCESS", `已添加 115 订阅并绑定固定来源: ${title}`);
        } else {
          await addLog("SUCCESS", `已添加 115 自动搜索订阅: ${title}`);
        }
      } else {
        // PT
        await moviepilotApi.createSubscription({
          title,
          media_type: mediaType,
          tmdb_id: tmdbId,
          ...(posterPath ? { poster_path: posterPath } : {}),
          ...(detail?.overview ? { overview: detail.overview } : {}),
          ...(year ? { year } : {}),
          ...(typeof detail?.vote_average === "number" ? { rating: detail.vote_average } : {}),
          auto_download: true,
          ...tvParams,
        });
        await addLog("SUCCESS", `已创建 PT 下载订阅: ${title}`);
      }
      await onChanged();
      onClose();
    } catch (err: unknown) {
      const detailMsg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || String(err);
      setError(`操作失败: ${detailMsg}`);
    } finally {
      setSubmitting(false);
    }
  };

  const ChannelCard = ({
    channelKey, icon, label, desc, subscribed, accentColor,
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
      className={`relative w-full text-left rounded-2xl p-3 transition-all ${
        channel === channelKey
          ? "ring-2"
          : "glass-hover"
      } ${channelKey === "quark" ? "opacity-55 cursor-not-allowed" : "cursor-pointer"}`}
      style={{
        background: channel === channelKey ? "var(--surface-subtle)" : "var(--surface)",
        border: "1px solid var(--border)",
        ...(channel === channelKey ? { boxShadow: `0 0 0 2px ${accentColor}` } : {}),
      }}
    >
      <div className="flex items-start gap-2.5">
        <span className="shrink-0 mt-0.5" style={{ color: accentColor }}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-black" style={{ color: "var(--txt)" }}>{label}</span>
            {subscribed && (
              <span className="text-[9px] font-black px-1.5 py-0.5 rounded" style={{ background: "rgba(34,197,94,0.16)", color: "var(--accent-ok)" }}>
                已订阅
              </span>
            )}
            {channelKey === "quark" && (
              <span className="text-[9px] font-bold" style={{ color: "var(--txt-muted)" }}>未接入</span>
            )}
          </div>
          <p className="text-[10px] font-semibold leading-relaxed mt-1" style={{ color: "var(--txt-muted)" }}>{desc}</p>
        </div>
      </div>
    </button>
  );

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0"
          style={{ background: "rgba(11,8,30,.34)", backdropFilter: "blur(6px)" }}
          onClick={onClose}
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="relative w-full max-w-[560px] glass-heavy glass-iridescent rounded-3xl p-6 z-10 space-y-4 max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl shrink-0 flex items-center justify-center" style={{ background: "var(--brand-primary-bg-alpha-heavy)", border: "1px solid var(--brand-primary-border-alpha)" }}>
                <Rss className="w-5 h-5" style={{ color: "var(--brand-primary)" }} />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-black tracking-tight truncate" style={{ color: "var(--txt)" }}>添加订阅</h2>
                <p className="text-[10px] font-semibold truncate" style={{ color: "var(--txt-muted)" }}>{title}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center glass-hover"
              style={{ color: "var(--txt-muted)", border: "1px solid var(--border)" }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* 已订阅状态 / 取消入口 */}
          {(isPan115Subscribed || isPtSubscribed) && (
            <div className="rounded-2xl p-3 space-y-2" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)" }}>
              <div className="flex items-center gap-1.5 text-[11px] font-black" style={{ color: "var(--accent-ok)" }}>
                <CheckCircle className="w-3.5 h-3.5" />
                <span>当前已订阅</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {isPan115Subscribed && (
                  <button
                    type="button"
                    onClick={() => void handleCancel("pan115")}
                    disabled={submitting}
                    className="px-2.5 py-1.5 rounded-lg text-[10px] font-black flex items-center gap-1.5 transition-all glass-hover disabled:opacity-50"
                    style={{ color: "var(--accent-danger)", background: "var(--surface)", border: "1px solid var(--border)" }}
                  >
                    取消 115 订阅
                  </button>
                )}
                {isPtSubscribed && (
                  <button
                    type="button"
                    onClick={() => void handleCancel("pt")}
                    disabled={submitting}
                    className="px-2.5 py-1.5 rounded-lg text-[10px] font-black flex items-center gap-1.5 transition-all glass-hover disabled:opacity-50"
                    style={{ color: "var(--accent-danger)", background: "var(--surface)", border: "1px solid var(--border)" }}
                  >
                    取消 PT 订阅
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 渠道选择 */}
          <div className="space-y-2">
            <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: "var(--txt-muted)" }}>选择渠道</span>
            <ChannelCard
              channelKey="pan115"
              icon={<HardDrive className="w-4 h-4" />}
              label="115 自动搜索"
              desc="由本系统定时按 TMDB 搜索 115 资源并自动转存；可绑定固定分享链接作为来源。"
              subscribed={isPan115Subscribed}
              accentColor="var(--brand-primary)"
            />
            <ChannelCard
              channelKey="pt"
              icon={<Download className="w-4 h-4" />}
              label="PT 下载（MoviePilot）"
              desc="把订阅交给 MoviePilot 调度 PT 下载；不占用 115 自动搜索。"
              subscribed={isPtSubscribed}
              accentColor="var(--accent-info)"
            />
            <ChannelCard
              channelKey="quark"
              icon={<Cloud className="w-4 h-4" />}
              label="夸克订阅"
              desc="后端尚未接入夸克订阅扫描，请先在资源通道转存夸克分享。"
              subscribed={false}
              accentColor="var(--txt-muted)"
            />
          </div>

          {/* 115 渠道：固定来源绑定 */}
          {channel === "pan115" && (
            <div className="rounded-2xl p-3 space-y-2.5" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bindFixedLink}
                  onChange={(e) => setBindFixedLink(e.target.checked)}
                  className="mt-0.5 accent-[var(--brand-primary)]"
                />
                <span className="min-w-0">
                  <span className="text-xs font-black flex items-center gap-1" style={{ color: "var(--txt)" }}>
                    <Link2 className="w-3.5 h-3.5" style={{ color: "var(--brand-primary)" }} />
                    绑定固定 115 分享链接
                  </span>
                  <span className="text-[10px] font-semibold leading-relaxed block mt-0.5" style={{ color: "var(--txt-muted)" }}>
                    勾选后订阅扫描会固定扫这条分享链接（后端 POST /sources），不靠 TMDB 模糊搜索。需要在上方资源通道先切到 115 来源并展开。
                  </span>
                </span>
              </label>

              {bindFixedLink && (
                <div>
                  {pan115ShareLinks.length === 0 ? (
                    <p className="text-[10px] font-bold px-2 py-1.5 rounded" style={{ background: "rgba(245,158,11,0.12)", color: "var(--accent-warn)", border: "1px solid rgba(245,158,11,0.3)" }}>
                      当前资源通道没有可绑定的 115 分享链接。请先在上方切到 115 来源并确保有分享链接。
                    </p>
                  ) : (
                    <select
                      value={selectedShareUrl}
                      onChange={(e) => setSelectedShareUrl(e.target.value)}
                      className="w-full rounded-xl px-2.5 py-2 text-[10px] font-bold focus:outline-none"
                      style={{ color: "var(--txt)", background: "var(--surface)", border: "1px solid var(--border)" }}
                    >
                      <option value="">请选择一条 115 分享链接…</option>
                      {pan115ShareLinks.map((l) => (
                        <option key={l.shareUrl} value={l.shareUrl}>
                          {(l.name || "未命名") + (l.size ? ` · ${l.size}` : "") + (l.resolution ? ` · ${l.resolution}` : "")}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TV 订阅范围 */}
          {mediaType === "tv" && channel !== "quark" && (
            <div className="rounded-2xl p-3 space-y-2.5" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
              <div className="flex items-center gap-1.5">
                <Tv className="w-3.5 h-3.5" style={{ color: "var(--brand-primary)" }} />
                <span className="text-xs font-black" style={{ color: "var(--txt)" }}>TV 订阅范围</span>
              </div>
              <div className="flex gap-1.5">
                {([
                  { key: "all", label: "全季" },
                  { key: "season", label: "指定季" },
                  { key: "episode", label: "集段" },
                ] as const).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setTvScope(opt.key)}
                    className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${
                      tvScope === opt.key ? "text-white" : "glass-hover"
                    }`}
                    style={tvScope === opt.key
                      ? { background: "var(--brand-primary)", color: "#fff", border: "1px solid var(--brand-primary)" }
                      : { background: "var(--surface)", color: "var(--txt-secondary)", border: "1px solid var(--border)" }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {tvScope !== "all" && (
                <div className="grid grid-cols-3 gap-2">
                  <label className="space-y-1">
                    <span className="text-[10px] font-bold block" style={{ color: "var(--txt-muted)" }}>季号</span>
                    <select
                      value={tvSeasonNumber}
                      onChange={(e) => setTvSeasonNumber(Number(e.target.value))}
                      className="w-full rounded-xl px-2 py-1.5 text-[10px] font-bold focus:outline-none"
                      style={{ color: "var(--txt)", background: "var(--surface)", border: "1px solid var(--border)" }}
                    >
                      {seasons.filter((s) => s.season_number > 0).map((s) => (
                        <option key={s.season_number} value={s.season_number}>
                          S{s.season_number} ({s.episode_count || "?"}集)
                        </option>
                      ))}
                    </select>
                  </label>
                  {tvScope === "episode" && (
                    <>
                      <label className="space-y-1">
                        <span className="text-[10px] font-bold block" style={{ color: "var(--txt-muted)" }}>起始集</span>
                        <input
                          type="number"
                          min={1}
                          value={tvEpisodeStart}
                          onChange={(e) => setTvEpisodeStart(e.target.value === "" ? "" : Number(e.target.value))}
                          placeholder="如 1"
                          className="w-full rounded-xl px-2 py-1.5 text-[10px] font-bold focus:outline-none"
                          style={{ color: "var(--txt)", background: "var(--surface)", border: "1px solid var(--border)" }}
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-[10px] font-bold block" style={{ color: "var(--txt-muted)" }}>结束集</span>
                        <input
                          type="number"
                          min={1}
                          value={tvEpisodeEnd}
                          onChange={(e) => setTvEpisodeEnd(e.target.value === "" ? "" : Number(e.target.value))}
                          placeholder="如 12"
                          className="w-full rounded-xl px-2 py-1.5 text-[10px] font-bold focus:outline-none"
                          style={{ color: "var(--txt)", background: "var(--surface)", border: "1px solid var(--border)" }}
                        />
                      </label>
                    </>
                  )}
                </div>
              )}
              <p className="text-[9px] font-semibold" style={{ color: "var(--txt-muted)" }}>
                不选「全季」即精确订阅某季/某集段；后端按 tv_scope/tv_season_number/tv_episode_* 处理。
              </p>
            </div>
          )}

          {/* PT 改写 provider 提示 */}
          {channel === "pt" && isPan115Subscribed && (
            <div className="rounded-2xl p-2.5 flex gap-2 items-start" style={{ background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.3)" }}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "var(--accent-warn)" }} />
              <p className="text-[10px] font-semibold leading-relaxed" style={{ color: "var(--accent-warn)" }}>
                已有 115 自动搜索订阅。创建 PT 订阅会让后端把同一 TMDB 订阅改写为 MoviePilot 归属，本系统 115 自动扫描将不再处理它。提交时仍会再次确认。
              </p>
            </div>
          )}

          {/* 信息/错误提示 */}
          {info && (
            <div className="rounded-2xl p-2.5 flex gap-2 items-start" style={{ background: "rgba(99,102,241,0.10)", border: "1px solid rgba(99,102,241,0.3)" }}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "var(--accent-info)" }} />
              <p className="text-[10px] font-semibold leading-relaxed" style={{ color: "var(--accent-info)" }}>{info}</p>
            </div>
          )}
          {error && (
            <div className="rounded-2xl p-2.5 flex gap-2 items-start" style={{ background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.3)" }}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: "var(--accent-danger)" }} />
              <p className="text-[10px] font-semibold leading-relaxed" style={{ color: "var(--accent-danger)" }}>{error}</p>
            </div>
          )}

          {/* 提交 */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 rounded-xl text-xs font-black transition-all glass-hover disabled:opacity-50"
              style={{ color: "var(--txt-secondary)", background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              关闭
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || channel === "quark" || (channel === "pan115" && isPan115Subscribed) || (channel === "pt" && isPtSubscribed)}
              className="px-5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
              style={{ background: "var(--brand-primary)", color: "#fff", border: "1px solid var(--brand-primary)" }}
            >
              {submitting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : (channel === "pt" ? <Download className="w-3.5 h-3.5" /> : <Rss className="w-3.5 h-3.5" />)}
              {channel === "pt" ? "创建 PT 订阅" : channel === "quark" ? "暂未接入" : isPan115Subscribed ? "已订阅 115" : "创建 115 订阅"}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}