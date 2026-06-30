type SourceOption = {
  key: string;
  label: string;
};

const SOURCE_OPTIONS = [
  { key: "hdhive", label: "HDHive" },
  { key: "pansou", label: "Pansou" },
  { key: "tg", label: "TG" },
] satisfies SourceOption[];

export default function ResourcePriorityOptions({
  selectedSources,
  onToggle,
}: {
  selectedSources: string[];
  onToggle: (source: string, checked: boolean) => void;
}) {
  return (
    <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
      <p className="text-[10px]" style={{ color: "var(--txt-muted)" }}>
        资源优先级选项: 勾选当前追更时的第一备选数据源抓取优先级顺位。
      </p>
      <div className="flex flex-wrap gap-4 pt-2">
        {SOURCE_OPTIONS.map((source) => (
          <label key={source.key} className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
            <input
              type="checkbox"
              checked={selectedSources.includes(source.key)}
              onChange={(e) => onToggle(source.key, e.target.checked)}
              className="accent-brand-primary"
            />
            {source.label}
          </label>
        ))}
      </div>
    </div>
  );
}
