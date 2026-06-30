import { SlidersHorizontal } from "lucide-react";

type DetailTabOption = {
  key: string;
  label: string;
};

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
  { key: "moviepilot_pt", label: "PT·MoviePilot" },
] satisfies DetailTabOption[];

export default function DetailVisibleTabsPanel({
  visibleTabs,
  onToggle,
}: {
  visibleTabs: string[];
  onToggle: (tab: string, checked: boolean) => void;
}) {
  return (
    <div className="liquid-panel glass p-6 rounded-2xl space-y-4">
      <h3 className="font-headline text-base font-bold flex items-center gap-2" style={{ color: "var(--txt)" }}>
        <SlidersHorizontal className="w-4 h-4 text-blue-500" />
        影视资源搜索详情页面展示配置
      </h3>
      <div className="space-y-3">
        <p className="text-[10px]" style={{ color: "var(--txt-muted)" }}>
          控制影视详情页显示哪些检索源（例如 115 搜索、Quark 搜索、磁力来源等），关闭不用的检索源可以缩短页面加载并保持清爽。
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
          {DETAIL_TAB_OPTIONS.map((tab) => (
            <label key={tab.key} className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer" style={{ color: "var(--txt-secondary)" }}>
              <input
                type="checkbox"
                checked={visibleTabs.includes(tab.key)}
                onChange={(e) => onToggle(tab.key, e.target.checked)}
                className="accent-brand-primary"
              />
              {tab.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
