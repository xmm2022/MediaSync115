import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * 失败/错误状态统一展示。
 *
 * - variant="banner"：横向顶部叠加横幅，自带容器（背景 0.12 / 边框 0.3），
 *   适合页面内容上方持续显示的错误条（含「关闭」可由 onDismiss 提供）。
 * - variant="block"：居中纵向块，不渲染外层容器，由父级容器负责包裹与
 *   定位，适合把加载/错误/空态作为同一区域内互斥分支使用。
 *
 * 文本与图标统一使用 var(--accent-danger)；重试按钮使用品牌色与 surface-subtle。
 * 危险色透明度遵循批次 7 的归一约定（背景 0.12 / 边框 0.3）。
 */
export interface ErrorBannerProps {
  message: ReactNode;
  onRetry?: () => void;
  onDismiss?: () => void;
  /** 重试按钮处于执行中时显示 spinner */
  retrying?: boolean;
  /** 关闭按钮图标文本（默认「关闭」）；置空字符串则不渲染关闭按钮 */
  dismissLabel?: string;
  variant?: "banner" | "block";
  /** 自定义图标（默认 AlertTriangle） */
  icon?: ReactNode;
}

export default function ErrorBanner({
  message,
  onRetry,
  onDismiss,
  retrying = false,
  dismissLabel = "关闭",
  variant = "banner",
  icon,
}: ErrorBannerProps) {
  const glyph = icon ?? <AlertTriangle className="w-8 h-8 mx-auto shrink-0" style={{ color: "var(--accent-danger)" }} />;
  const retryButton = onRetry && (
    <button
      onClick={onRetry}
      className="px-4 py-2 text-xs font-bold rounded-lg glass-hover flex items-center gap-1.5"
      style={{ color: "var(--brand-primary)", background: "var(--surface-subtle)" }}
    >
      <RefreshCw className={`w-3.5 h-3.5 ${retrying ? "animate-spin" : ""}`} />
      重试
    </button>
  );

  if (variant === "block") {
    return (
      <div className="flex flex-col items-center gap-3 text-center">
        {glyph}
        <p className="text-xs font-semibold" style={{ color: "var(--accent-danger)" }}>{message}</p>
        <div className="flex items-center gap-2">
          {retryButton}
          {onDismiss && dismissLabel !== "" && (
            <button onClick={onDismiss} className="text-xs font-bold opacity-70 hover:opacity-100" style={{ color: "var(--accent-danger)" }}>{dismissLabel}</button>
          )}
        </div>
      </div>
    );
  }

  // banner variant — 横向叠加横幅，自带容器
  return (
    <div
      className="rounded-2xl px-5 py-3 flex items-center gap-2.5"
      style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}
    >
      <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: "var(--accent-danger)" }} />
      <span className="text-xs font-bold" style={{ color: "var(--accent-danger)" }}>{message}</span>
      <div className="ml-auto flex items-center gap-2">
        {onRetry && (
          <button
            onClick={onRetry}
            className="hover:opacity-70 text-xs font-bold flex items-center gap-1"
            style={{ color: "var(--accent-danger)" }}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${retrying ? "animate-spin" : ""}`} />
            重试
          </button>
        )}
        {onDismiss && dismissLabel !== "" && (
          <button onClick={onDismiss} className="hover:opacity-70 text-xs font-bold" style={{ color: "var(--accent-danger)" }}>
            {dismissLabel}
          </button>
        )}
      </div>
    </div>
  );
}