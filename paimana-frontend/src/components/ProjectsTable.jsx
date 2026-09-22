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
  { key: "project_id",            label: "Project ID",          sortable: true },
  { key: "engineers_estimate",    label: "Engineer's Estimate",  sortable: true },
  { key: "bid_total",             label: "Bid Total",            sortable: true },
  { key: "bid_days",              label: "Bid Days",             sortable: true },
  { key: "predicted_overrun_pct", label: "Predicted Overrun %",  sortable: true },
  { key: "predicted_risk_tier",   label: "Risk Tier",            sortable: true },
];

function fmtCurrency(n) {
  return (
    "$" +
    Number(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function fmtOverrun(n) {
  const val = Number(n).toFixed(1);
  return n > 0 ? `+${val}%` : `${val}%`;
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
    return projects.filter((p) => {
      const tierOk = tierFilter === "All" || p.predicted_risk_tier === tierFilter;
      const idOk   = idFilter === "" || String(p.project_id).includes(idFilter.trim());
      return tierOk && idOk;
    });
  }, [projects, tierFilter, idFilter]);

  // ── Sort ────────────────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let av = a[sortCol];
      let bv = b[sortCol];
      if (sortCol === "predicted_risk_tier") {
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
            placeholder="Search project ID…"
            value={idFilter}
            onChange={handleIdChange}
            className="pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50
                       focus:outline-none focus:ring-2 focus:ring-brand-amber/50 focus:border-brand-amber
                       placeholder:text-slate-400 w-48"
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
              {t === "All" ? "All Risk Tiers" : t}
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
                const overrun = Number(p.predicted_overrun_pct);
                const overrunColor =
                  overrun > 10  ? "text-red-600 font-semibold" :
                  overrun > 0   ? "text-amber-600"             :
                                  "text-green-700";

                return (
                  <tr
                    key={p.project_id}
                    onClick={() => onRowClick?.(p.project_id)}
                    className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer
                               transition-colors duration-100"
                  >
                    <td className="px-5 py-3.5 font-mono text-slate-700 font-medium">
                      #{p.project_id}
                    </td>
                    <td className="px-5 py-3.5 text-slate-700">
                      {fmtCurrency(p.engineers_estimate)}
                    </td>
                    <td className="px-5 py-3.5 text-slate-700">
                      {fmtCurrency(p.bid_total)}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">
                      {Math.round(p.bid_days)} days
                    </td>
                    <td className={`px-5 py-3.5 ${overrunColor}`}>
                      {fmtOverrun(p.predicted_overrun_pct)}
                    </td>
                    <td className="px-5 py-3.5">
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
