import { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';

export default function IndiaAlertsPanel({ authFetch, onProjectClick }) {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    const url = 'http://127.0.0.1:8000/india/alerts';
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

  return (
    <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-500" strokeWidth={2} />
          <h3 className="text-lg font-semibold text-slate-900">
            Flagged Indian Projects
          </h3>
        </div>
        {!loading && alerts.length > 0 && (
          <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700">
            {alerts.length} total
          </span>
        )}
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
    </div>
  );
}
