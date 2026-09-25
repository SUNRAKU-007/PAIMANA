import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, ChevronUp, ChevronDown } from 'lucide-react';
import { API_BASE_URL } from '../api';

const STORAGE_KEY = 'paimana_flagged_section_collapsed';

export default function IndiaAlertsPanel({ authFetch, onProjectClick }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved !== null ? JSON.parse(saved) : false; // Default: expanded for first-time visitors
    } catch {
      return false;
    }
  });

  const toggleCollapsed = (e) => {
    e?.stopPropagation();
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (err) {
        console.error('Failed to save flagged section state to localStorage', err);
      }
      return next;
    });
  };

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    const url = `${API_BASE_URL}/india/alerts`;
    const fetchPromise =
      authFetch && typeof authFetch.get === 'function'
        ? authFetch.get(url)
        : fetch(url).then((res) => res.json());

    fetchPromise
      .then((res) => {
        if (isMounted) {
          const data = res?.data !== undefined ? res.data : res;
          setAlerts(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('Failed to fetch India alerts:', err);
          setError('Could not load flagged India projects.');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [authFetch]);

  const renderStatusBadge = (status) => {
    switch (status) {
      case 'Completed':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
            Completed
          </span>
        );
      case 'Ongoing':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#EEF0F6] text-brand-ink border border-[#C8CEDE] shrink-0">
            Ongoing
          </span>
        );
      case 'Newly Added':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 shrink-0">
            Newly Added
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
            {status || 'Unknown'}
          </span>
        );
    }
  };

  if (isCollapsed) {
    return (
      <section
        id="flagged-section-collapsed"
        aria-label="Flagged Indian Projects (Collapsed)"
        onClick={() => {
          setIsCollapsed(false);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(false));
          } catch {}
        }}
        className="w-full bg-white hover:bg-slate-50/80 rounded-xl shadow-xs px-5 py-3 border border-slate-200/80 flex items-center justify-between cursor-pointer transition-colors duration-200 group"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" strokeWidth={2} />
          <h3 className="text-base font-semibold text-slate-900 truncate">
            Flagged Indian Projects
          </h3>
          {!loading && alerts.length > 0 && (
            <span
              id="flagged-count-badge-collapsed"
              data-testid="flagged-count-badge"
              className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700 shrink-0 ml-1"
            >
              {alerts.length} total
            </span>
          )}
          {loading && (
            <span className="text-xs text-slate-400 ml-2">Loading...</span>
          )}
        </div>

        <button
          type="button"
          id="toggle-flagged-section-expand"
          onClick={toggleCollapsed}
          className="flex items-center gap-1 text-xs text-slate-500 group-hover:text-slate-800 transition-colors font-medium px-2 py-1 rounded-md hover:bg-slate-100 shrink-0 cursor-pointer ml-3"
          aria-label="Expand flagged projects section"
        >
          <span className="hidden sm:inline">Expand</span>
          <ChevronDown size={16} />
        </button>
      </section>
    );
  }

  return (
    <section
      id="flagged-section-expanded"
      aria-label="Flagged Indian Projects (Expanded)"
      className="bg-white rounded-xl shadow-sm p-6 border border-slate-100 transition-all duration-300"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0" strokeWidth={2} />
          <h3 className="text-lg font-semibold text-slate-900">
            Flagged Indian Projects
          </h3>
          {!loading && alerts.length > 0 && (
            <span
              id="flagged-count-badge-expanded"
              data-testid="flagged-count-badge"
              className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700 ml-1"
            >
              {alerts.length} total
            </span>
          )}
        </div>

        <button
          type="button"
          id="toggle-flagged-section-collapse"
          onClick={toggleCollapsed}
          className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition-colors font-medium px-2 py-1 rounded-md hover:bg-slate-100 cursor-pointer"
          aria-label="Collapse flagged projects section"
          title="Collapse flagged projects"
        >
          <span className="hidden sm:inline">Collapse</span>
          <ChevronUp size={16} />
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="py-8 text-center text-xs text-slate-400">
          Loading alerts...
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="p-3 text-xs text-red-600 bg-red-50 rounded-lg border border-red-100">
          {error}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && alerts.length === 0 && (
        <div className="py-8 text-center flex flex-col items-center justify-center text-slate-500">
          <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-2">
            <CheckCircle className="w-5 h-5" />
          </div>
          <p className="text-sm font-medium text-slate-700">
            No projects currently flagged
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            All monitored infrastructure projects are progressing within target thresholds.
          </p>
        </div>
      )}

      {/* Rows */}
      {!loading && alerts.length > 0 && (
        <div className="divide-y divide-slate-100">
          {alerts.map((project) => {
            const subtitle = [project.sector, project.state]
              .filter(Boolean)
              .join(' • ');

            return (
              <div
                key={project.project_id || project.name}
                onClick={() => onProjectClick?.(project)}
                className="flex items-start justify-between gap-4 py-3.5 hover:bg-red-50/50 px-2 rounded-lg cursor-pointer transition-colors group"
              >
                {/* Left: Project Details & Reasons */}
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-medium text-slate-900 group-hover:text-red-700 transition-colors">
                    {project.name}
                  </h4>
                  {subtitle && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      {subtitle}
                    </p>
                  )}

                  {/* All Risk Reasons Bullet Points */}
                  {project.risk_reasons && project.risk_reasons.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {project.risk_reasons.map((reason, idx) => (
                        <li
                          key={idx}
                          className="text-xs text-red-700 flex items-start gap-1.5"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 mt-1.5" />
                          <span>{reason}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Right: Status Badge */}
                <div className="shrink-0 pt-0.5">
                  {renderStatusBadge(project.status)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
