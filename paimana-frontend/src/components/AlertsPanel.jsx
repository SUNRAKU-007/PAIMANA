import { AlertTriangle } from "lucide-react";

/**
 * AlertsPanel — Top-10 high-risk projects, sorted by predicted delay.
 * @param {{ projects: Array<object>,
 *           totalHighRisk: number,
 *           onRowClick: (id: number) => void }} props
 */
export default function AlertsPanel({ projects, totalHighRisk, onRowClick }) {
  // ── Sort (projects are already filtered to High risk by parent) ─────
  const sorted = (projects ?? [])
    .slice()
    .sort((a, b) => {
      const bDelay = Number(b.predicted_delay_months ?? b.predicted_overrun_pct ?? 0);
      const aDelay = Number(a.predicted_delay_months ?? a.predicted_overrun_pct ?? 0);
      return bDelay - aDelay;
    });

  const total = totalHighRisk ?? sorted.length;
  const top10 = sorted.slice(0, 10);
  const remaining = total - top10.length;

  // ── Reason string ───────────────────────────────────────────────────
  function reason(p) {
    const delay = Number(p.predicted_delay_months ?? p.predicted_overrun_pct ?? 0);
    const parts = [];
    if (p.sector) parts.push(p.sector);
    if (p.state) parts.push(p.state);
    if (delay >= 24) {
      parts.push("Critical 2+ yr delay");
    } else {
      parts.push("High delay risk");
    }
    return parts.join(" • ");
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-500" strokeWidth={2} />
          <h3 className="text-lg font-semibold text-slate-900">
            Active Distress Alerts
          </h3>
        </div>
        {total > 0 && (
          <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
            {total} projects
          </span>
        )}
      </div>

      {/* ── Empty state ─────────────────────────────────────────────── */}
      {total === 0 && (
        <p className="text-sm text-slate-400 py-6 text-center">
          No high-risk projects detected.
        </p>
      )}

      {/* ── Rows ────────────────────────────────────────────────────── */}
      {top10.map((p) => {
        const delay = p.predicted_delay_months ?? p.predicted_overrun_pct;
        const delayNum = Number(delay ?? 0);

        return (
          <div
            key={p.project_id}
            onClick={() => onRowClick?.(p.project_id)}
            className="flex items-center justify-between gap-4 border-b border-slate-100
                       py-3 hover:bg-red-50/50 cursor-pointer transition-colors
                       first:pt-0 last:border-b-0"
          >
            {/* Left: ID + Project Name + reason */}
            <div className="min-w-0 pr-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-800">
                  #{p.project_id}
                </span>
                {p.project_name && (
                  <span className="text-xs text-slate-600 truncate max-w-xs font-medium" title={p.project_name}>
                    {p.project_name}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 truncate mt-0.5">{reason(p)}</p>
            </div>

            {/* Right: delay */}
            <span className="shrink-0 text-sm font-bold text-red-600">
              {delayNum > 0 ? "+" : ""}
              {delayNum.toFixed(1)} mo delay
            </span>
          </div>
        );
      })}

      {/* ── "More" footer ───────────────────────────────────────────── */}
      {remaining > 0 && (
        <p className="text-xs text-slate-400 mt-3 text-center">
          + {remaining} more high-risk project{remaining !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
