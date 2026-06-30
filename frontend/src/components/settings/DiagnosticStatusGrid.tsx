import type { DiagnosticStatusCard } from "./types";

export default function DiagnosticStatusGrid({ cards }: { cards: DiagnosticStatusCard[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
      {cards.map((item) => (
        <div key={item.label} className="rounded-xl p-3 space-y-1" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-black" style={{ color: "var(--txt)" }}>{item.label}</span>
            <span
              className="px-2 py-0.5 rounded-full text-[9px] font-black"
              style={item.summary.ok === true
                ? { color: "var(--accent-ok)", background: "rgba(34,197,94,0.12)" }
                : item.summary.ok === false
                  ? { color: "var(--accent-danger)", background: "rgba(239,68,68,0.12)" }
                  : { color: "var(--txt-muted)", background: "var(--surface)" }}
            >
              {item.summary.state}
            </span>
          </div>
          <p className="text-[9px] font-semibold truncate" title={item.summary.message} style={{ color: "var(--txt-muted)" }}>
            {item.summary.message}
          </p>
        </div>
      ))}
    </div>
  );
}
