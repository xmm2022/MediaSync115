import type { ReactNode } from "react";

/**
 * 空态统一展示：图标 + 主文本 + 可选副提示 + 可选 CTA。
 *
 * 不渲染外层容器，由父级容器负责包裹与定位（各调用点的外层容器
 * 样式差异较大：glass / rounded-xl py-10 / h-80 等，保持在调用方更安全）。
 *
 * 主文本默认 var(--txt-secondary) 中等灰、副文本 var(--txt-muted) 更浅，
 * 与片单/目录等已存在的空态观感一致。
 */
export interface EmptyStateProps {
  icon: ReactNode;
  text: string;
  subtext?: string;
  cta?: ReactNode;
}

export default function EmptyState({ icon, text, subtext, cta }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-1 text-center">
      {icon}
      <p className="text-xs font-bold mt-1" style={{ color: "var(--txt-secondary)" }}>{text}</p>
      {subtext && <p className="text-[10px]" style={{ color: "var(--txt-muted)" }}>{subtext}</p>}
      {cta && <div className="mt-1">{cta}</div>}
    </div>
  );
}