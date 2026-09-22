import { AlertTriangle } from "lucide-react";

/**
 * AlertsPanel — Top-10 high-risk projects, sorted by predicted overrun.
 * @param {{ projects: Array<object>,
 *           totalHighRisk: number,
 *           onRowClick: (id: number) => void }} props
 */
export default function AlertsPanel({ projects, totalHighRisk, onRowClick }) {
  // ── Sort (projects are already filtered to High risk by parent) ─────
  const sorted = (projects ?? [])
    .slice()
    .sort((a, b) => b.predicted_overrun_pct - a.predicted_overrun_pct);

  const total = totalHighRisk ?? sorted.length;
  const top10 = sorted.slice(0, 10);
  const remaining = total - top10.length;

  // ── Reason string ───────────────────────────────────────────────────
  function reason(p) {
    if (p.materials_ppi > 180) {
      return `Bid during elevated materials pricing (PPI: ${p.materials_ppi.toFixed(1)})`;
    }
    return "High predicted cost deviation";
  }

  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-500" strokeWidth={2} />
          <h3 className="text-lg font-semibold text-slate-900">
            High-Risk Alerts
          </h3>
        </div>
        {total > 0 && (
          <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
            {total} total
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
      {top10.map((p) => (
        <div
          key={p.project_id}
          onClick={() => onRowClick?.(p.project_id)}
          className="flex items-center justify-between gap-4 border-b border-slate-100
                     py-3 hover:bg-red-50 cursor-pointer transition-colors
                     first:pt-0 last:border-b-0"
        >
          {/* Left: ID + reason */}
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800">
              Project #{p.project_id}
            </p>
            <p className="text-xs text-slate-400 truncate">{reason(p)}</p>
          </div>

          {/* Right: overrun % */}
          <span className="shrink-0 text-sm font-bold text-red-600">
            {p.predicted_overrun_pct >= 0 ? "+" : ""}
            {p.predicted_overrun_pct.toFixed(2)}%
          </span>
        </div>
      ))}

      {/* ── "More" footer ───────────────────────────────────────────── */}
      {remaining > 0 && (
        <p className="text-xs text-slate-400 mt-3 text-center">
          + {remaining} more high-risk project{remaining !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
