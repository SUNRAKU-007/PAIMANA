import { useEffect } from "react";
import { X } from "lucide-react";

// ── Human-readable feature labels ───────────────────────────────────────
const FEATURE_LABELS = {
  materials_ppi: "Materials Price Index",
  log_engineers_estimate: "Project Size (log)",
  estimate_per_item: "Cost per Bid Item",
  bid_days: "Schedule Length",
  item_count: "Bid Complexity",
  start_month: "Bid Month",
  is_monsoon_season: "Monsoon Season",
  ppi_deviation: "Price Deviation from Average",
};

// ── Risk tier badge colors ──────────────────────────────────────────────
const TIER_STYLE = {
  Low: "bg-green-100 text-green-700",
  Medium: "bg-amber-100 text-amber-700",
  High: "bg-red-100 text-red-700",
};

// ── Currency formatter ──────────────────────────────────────────────────
const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/**
 * ProjectDetail — right-side slide-in drawer showing a single project's
 * prediction breakdown and feature influence.
 *
 * @param {{ projectId: number | null,
 *           project: object | null,
 *           isLoading: boolean,
 *           onClose: () => void }} props
 */
export default function ProjectDetail({ projectId, project, isLoading, onClose }) {
  // ── Escape key closes drawer ────────────────────────────────────────
  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose?.();
    }
    if (projectId != null) {
      document.addEventListener("keydown", handleKey);
      return () => document.removeEventListener("keydown", handleKey);
    }
  }, [projectId, onClose]);

  // Drawer opens as soon as a projectId is set (before data arrives)
  const isOpen = projectId != null;

  return (
    <>
      {/* ── Overlay ─────────────────────────────────────────────────── */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300
                    ${isOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      />

      {/* ── Drawer ──────────────────────────────────────────────────── */}
      <aside
        className={`fixed top-0 right-0 z-50 h-full w-full sm:w-96
                    bg-white shadow-2xl flex flex-col
                    transition-transform duration-300 ease-in-out
                    ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {isOpen && (
          <>
            {/* Header is always shown immediately */}
            <DrawerHeader
              projectId={projectId}
              tier={project?.predicted_risk_tier}
              onClose={onClose}
            />
            {isLoading || !project ? (
              <SkeletonBody />
            ) : (
              <DrawerBody project={project} />
            )}
          </>
        )}
      </aside>
    </>
  );
}

// ── Header (renders immediately with just the project ID) ───────────────
function DrawerHeader({ projectId, tier, onClose }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
      <div className="flex items-center gap-3 min-w-0">
        <h2 className="text-lg font-semibold text-slate-900 truncate">
          Project #{projectId}
        </h2>
        {tier && (
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0 ${TIER_STYLE[tier]}`}
          >
            {tier}
          </span>
        )}
      </div>
      <button
        onClick={onClose}
        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
        aria-label="Close"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}

// ── Skeleton shown while data is loading ────────────────────────────────
function SkeletonBody() {
  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 animate-pulse">
      {/* Metric cards skeleton */}
      <div className="grid grid-cols-3 gap-4">
        <div className="h-16 rounded-lg bg-slate-200" />
        <div className="h-16 rounded-lg bg-slate-200" />
        <div className="h-16 rounded-lg bg-slate-200" />
      </div>
      {/* Overrun callout skeleton */}
      <div className="h-24 rounded-xl bg-slate-200" />
      {/* Extra stats skeleton */}
      <div className="grid grid-cols-2 gap-4">
        <div className="h-16 rounded-lg bg-slate-200" />
        <div className="h-16 rounded-lg bg-slate-200" />
      </div>
      {/* Feature influence bars skeleton */}
      <div className="space-y-4">
        <div className="h-4 w-40 rounded bg-slate-200" />
        {[85, 70, 55, 45, 35, 25, 20, 15].map((w, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 w-28 rounded bg-slate-200" />
            <div
              className="h-2 rounded-full bg-slate-200"
              style={{ width: `${w}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Full body content (rendered once data has loaded) ────────────────────
function DrawerBody({ project }) {
  const p = project;
  const tier = p.predicted_risk_tier ?? "Low";
  const overrun = p.predicted_overrun_pct;
  const actual = p.actual_cost_overrun_pct;

  // ── Feature influence sorted desc ───────────────────────────────────
  const influences = Object.entries(p.feature_influence ?? {})
    .map(([key, value]) => ({ key, label: FEATURE_LABELS[key] ?? key, value }))
    .sort((a, b) => b.value - a.value);

  const maxInfluence = influences.length > 0 ? influences[0].value : 1;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
      {/* ── Key metrics ─────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <MetricCard label="Engineer's Estimate" value={usd.format(p.engineers_estimate)} />
        <MetricCard label="Bid Total" value={usd.format(p.bid_total)} />
        <MetricCard label="Bid Days" value={p.bid_days != null ? `${Math.round(p.bid_days)} days` : "—"} />
      </div>

      {/* ── Predicted overrun callout ────────────────────────────── */}
      <div className="rounded-xl bg-slate-50 p-5">
        <p className="text-sm font-medium text-slate-500 mb-1">
          Predicted Overrun
        </p>
        <p
          className={`text-3xl font-bold tracking-tight ${
            overrun >= 5 ? "text-red-600" : overrun <= -2 ? "text-green-600" : "text-slate-900"
          }`}
        >
          {overrun >= 0 ? "+" : ""}
          {overrun?.toFixed(2)}%
        </p>
        {actual != null && (
          <p className="text-sm text-slate-400 mt-1">
            Actual:{" "}
            <span className="font-medium text-slate-600">
              {actual >= 0 ? "+" : ""}
              {actual.toFixed(2)}%
            </span>
          </p>
        )}
      </div>

      {/* ── Extra stats ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <MetricCard label="Item Count" value={p.item_count} />
        <MetricCard
          label="Cost per Item"
          value={
            p.feature_values?.estimate_per_item != null
              ? usd.format(p.feature_values.estimate_per_item)
              : "—"
          }
        />
      </div>

      {/* ── Feature influence ────────────────────────────────────── */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">
          Why this prediction?
        </h3>
        <p className="text-xs text-slate-400 mb-4">
          Relative influence of each feature on the cost-overrun model
        </p>

        <div className="space-y-3">
          {influences.map(({ key, label, value }) => (
            <div key={key}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-slate-600">
                  {label}
                </span>
                <span className="text-xs text-slate-400">
                  {(value * 100).toFixed(1)}%
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand-ink transition-all duration-500"
                  style={{
                    width: `${maxInfluence > 0 ? (value / maxInfluence) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Tiny stat card ──────────────────────────────────────────────────────
function MetricCard({ label, value }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-3">
      <p className="text-[11px] font-medium text-slate-400 mb-0.5 truncate">
        {label}
      </p>
      <p className="text-sm font-semibold text-slate-800 truncate">{value}</p>
    </div>
  );
}
