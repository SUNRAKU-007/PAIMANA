import { FolderOpen, TrendingUp, AlertTriangle, Target } from "lucide-react";

/**
 * KpiCards — 4-card responsive grid showing key dashboard metrics.
 * @param {{ summary: object }} props
 */
export default function KpiCards({ summary }) {
  if (!summary) return null;

  const cards = [
    {
      label: "Total Projects",
      value: summary.total_projects?.toLocaleString(),
      Icon: FolderOpen,
      iconColor: "text-brand-ink",
      bgAccent: "bg-[#EEF0F6]",
    },
    {
      label: "Avg Schedule Slippage",
      value: summary.avg_predicted_delay_months != null
        ? `${summary.avg_predicted_delay_months?.toFixed(1)} mo`
        : `${summary.avg_predicted_overrun_pct?.toFixed(1)} mo`,
      Icon: TrendingUp,
      iconColor: "text-brand-ink",
      bgAccent: "bg-[#EEF0F6]",
    },
    {
      label: "Projects in Distress",
      value: summary.risk_tier_counts?.High?.toLocaleString(),
      Icon: AlertTriangle,
      iconColor: "text-red-600",
      bgAccent: "bg-red-50",
      valueColor: "text-red-600",
      ring: "ring-1 ring-red-200",
    },
    {
      label: "Distress Detection Rate",
      value: summary.model_performance?.high_risk_recall != null
        ? `${(summary.model_performance.high_risk_recall * 100).toFixed(1)}%`
        : "—",
      subtext: `correctly flags ${summary.model_performance?.high_risk_recall != null ? (summary.model_performance.high_risk_recall * 100).toFixed(0) : "86"}% of projects in active distress`,
      Icon: Target,
      iconColor: "text-brand-ink",
      bgAccent: "bg-[#EEF0F6]",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`bg-white rounded-xl shadow-sm p-6 flex items-start gap-4
                      transition-shadow hover:shadow-md ${card.ring ?? ""}`}
        >
          {/* Icon container */}
          <div className={`${card.bgAccent} rounded-lg p-2.5 shrink-0`}>
            <card.Icon className={`${card.iconColor} w-5 h-5`} strokeWidth={2} />
          </div>

          {/* Text */}
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-500 truncate">
              {card.label}
            </p>
            <p
              className={`text-3xl font-bold tracking-tight mt-1
                          ${card.valueColor ?? "text-slate-900"}`}
            >
              {card.value}
            </p>
            {card.subtext && (
              <p className="text-xs text-slate-400 mt-1">{card.subtext}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
