import { useState, useMemo } from "react";
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

const PAGE_SIZE = 15;

const TIER_BADGE = {
  Low:    "bg-green-100 text-green-700",
  Medium: "bg-amber-100 text-amber-700",
  High:   "bg-red-100   text-red-700",
};

const TIER_ORDER = { Low: 0, Medium: 1, High: 2 };

const COLUMNS = [
  { key: "project_id",             label: "Project",             sortable: true },
  { key: "original_cost_cr",       label: "Original Cost",       sortable: true },
  { key: "cumulative_expenditure_cr", label: "Cumulative Spend", sortable: true },
  { key: "delay_months",           label: "Actual Delay",        sortable: true },
  { key: "predicted_delay_months", label: "Schedule Slippage", sortable: true },
  { key: "predicted_risk_tier",    label: "Distress Tier",      sortable: true },
];

function fmtCrores(n) {
  if (n == null || isNaN(Number(n))) return "—";
  return `₹${Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} Cr`;
}

function fmtMonths(n) {
  if (n == null || isNaN(Number(n))) return "—";
  const val = Number(n).toFixed(1);
  return Number(n) > 0 ? `+${val} mo` : `${val} mo`;
}

function SortIcon({ col, sortCol, sortDir }) {
  if (sortCol !== col)
    return <ChevronsUpDown className="inline w-3.5 h-3.5 ml-1 text-slate-400" />;
  return sortDir === "asc" ? (
    <ChevronUp className="inline w-3.5 h-3.5 ml-1 text-brand-ink" />
  ) : (
    <ChevronDown className="inline w-3.5 h-3.5 ml-1 text-brand-ink" />
  );
}

/**
 * ProjectsTable — sortable, filterable, paginated table for construction projects.
 * @param {{ projects: object[], onRowClick: (project_id: number) => void }} props
 */
export default function ProjectsTable({ projects = [], onRowClick }) {
  const [tierFilter, setTierFilter] = useState("All");
  const [idFilter,   setIdFilter]   = useState("");
  const [sortCol,    setSortCol]    = useState("project_id");
  const [sortDir,    setSortDir]    = useState("asc");
  const [page,       setPage]       = useState(1);

  // ── Filter ──────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = idFilter.trim().toLowerCase();
    return projects.filter((p) => {
      const tierOk = tierFilter === "All" || p.predicted_risk_tier === tierFilter;
      const idOk =
        q === "" ||
        String(p.project_id).toLowerCase().includes(q) ||
        (p.project_name && p.project_name.toLowerCase().includes(q)) ||
        (p.sector && p.sector.toLowerCase().includes(q)) ||
        (p.ministry && p.ministry.toLowerCase().includes(q)) ||
        (p.state && p.state.toLowerCase().includes(q));
      return tierOk && idOk;
    });
  }, [projects, tierFilter, idFilter]);

  // ── Sort ────────────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av = a[sortCol];
      let bv = b[sortCol];
      if (sortCol === "original_cost_cr") {
        av = av ?? a.engineers_estimate;
        bv = bv ?? b.engineers_estimate;
      } else if (sortCol === "cumulative_expenditure_cr") {
        av = av ?? a.bid_total;
        bv = bv ?? b.bid_total;
      } else if (sortCol === "delay_months") {
        av = av ?? a.bid_days;
        bv = bv ?? b.bid_days;
      } else if (sortCol === "predicted_delay_months") {
        av = av ?? a.predicted_overrun_pct;
        bv = bv ?? b.predicted_overrun_pct;
      } else if (sortCol === "predicted_risk_tier") {
        av = TIER_ORDER[av] ?? 0;
        bv = TIER_ORDER[bv] ?? 0;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ?  1 : -1;
      return 0;
    });
  }, [filtered, sortCol, sortDir]);

  // ── Paginate ─────────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pageRows   = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function handleSort(col) {
    if (!COLUMNS.find((c) => c.key === col)?.sortable) return;
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
    setPage(1);
  }

  function handleTierChange(e) {
    setTierFilter(e.target.value);
    setPage(1);
  }

  function handleIdChange(e) {
    setIdFilter(e.target.value);
    setPage(1);
  }

  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">

      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-slate-100">
        {/* Text search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          <input
            id="project-id-filter"
            type="text"
            placeholder="Search project name, ID, sector..."
            value={idFilter}
            onChange={handleIdChange}
            className="pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50
                       focus:outline-none focus:ring-2 focus:ring-brand-amber/50 focus:border-brand-amber
                       placeholder:text-slate-400 w-64"
          />
        </div>

        {/* Tier dropdown */}
        <select
          id="tier-filter"
          value={tierFilter}
          onChange={handleTierChange}
          className="text-sm rounded-lg border border-slate-200 bg-slate-50 px-3 py-2
                     focus:outline-none focus:ring-2 focus:ring-brand-amber/50 focus:border-brand-amber
                     text-slate-700"
        >
          {["All", "Low", "Medium", "High"].map((t) => (
            <option key={t} value={t}>
              {t === "All" ? "All Distress Tiers" : t}
            </option>
          ))}
        </select>

        {/* Result count */}
        <span className="ml-auto text-xs text-slate-400">
          {filtered.length.toLocaleString()} project{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable && handleSort(col.key)}
                  className={`px-5 py-3 text-left text-xs font-semibold text-slate-500
                              uppercase tracking-wide whitespace-nowrap select-none
                              ${col.sortable ? "cursor-pointer hover:text-slate-700" : ""}`}
                >
                  {col.label}
                  {col.sortable && (
                    <SortIcon col={col.key} sortCol={sortCol} sortDir={sortDir} />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={COLUMNS.length}
                  className="text-center py-16 text-slate-400 text-sm"
                >
                  No projects match your filters
                </td>
              </tr>
            ) : (
              pageRows.map((p) => {
                const delayVal = p.predicted_delay_months ?? p.predicted_overrun_pct;
                const delayNum = Number(delayVal);
                const delayColor =
                  delayNum > 12  ? "text-red-600 font-semibold" :
                  delayNum > 0   ? "text-amber-600"             :
                                   "text-green-700";

                const actualDelayText = p.delay_months != null
                  ? `${Math.round(p.delay_months)} mo`
                  : (p.bid_days != null ? `${Math.round(p.bid_days)} days` : "—");

                return (
                  <tr
                    key={p.project_id}
                    onClick={() => onRowClick?.(p.project_id)}
                    className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer
                               transition-colors duration-100"
                  >
                    <td className="px-5 py-3.5">
                      <div className="font-mono text-xs font-semibold text-slate-800">
                        #{p.project_id}
                      </div>
                      {p.project_name && (
                        <div className="text-xs text-slate-600 truncate max-w-xs font-sans mt-0.5" title={p.project_name}>
                          {p.project_name}
                        </div>
                      )}
                      {(p.sector || p.state) && (
                        <div className="text-[11px] text-slate-400 font-sans mt-0.5">
                          {[p.sector, p.state].filter(Boolean).join(" • ")}
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-700 whitespace-nowrap">
                      {fmtCrores(p.original_cost_cr ?? p.engineers_estimate)}
                    </td>
                    <td className="px-5 py-3.5 text-slate-700 whitespace-nowrap">
                      {fmtCrores(p.cumulative_expenditure_cr ?? p.bid_total)}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600 whitespace-nowrap">
                      {actualDelayText}
                    </td>
                    <td className={`px-5 py-3.5 whitespace-nowrap ${delayColor}`}>
                      {fmtMonths(delayVal)}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span
                        className={`inline-block rounded-full px-2 py-1 text-xs font-medium
                                    ${TIER_BADGE[p.predicted_risk_tier] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {p.predicted_risk_tier}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ──────────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50">
          <p className="text-xs text-slate-500">
            Page {safePage} of {totalPages}
            {" · "}
            rows {(safePage - 1) * PAGE_SIZE + 1}–
            {Math.min(safePage * PAGE_SIZE, sorted.length)} of{" "}
            {sorted.length.toLocaleString()}
          </p>
          <div className="flex items-center gap-1">
            <button
              id="pagination-prev"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border
                         border-slate-200 text-slate-600 hover:bg-white
                         disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Prev
            </button>
            <button
              id="pagination-next"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg border
                         border-slate-200 text-slate-600 hover:bg-white
                         disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
