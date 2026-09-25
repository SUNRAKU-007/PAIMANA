import { useState, useEffect, useRef } from 'react';
import { Bell, CheckCircle } from 'lucide-react';
import { API_BASE_URL } from '../api';

export default function NotificationBell({ authFetch, userRole, onProjectClick }) {
  const [data, setData] = useState({
    role: userRole || 'public',
    count: 0,
    items: [],
  });
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  const fetchNotifications = () => {
    const url = `${API_BASE_URL}/india/notifications`;
    const fetchPromise =
      authFetch && typeof authFetch.get === 'function'
        ? authFetch.get(url)
        : fetch(url).then((r) => r.json());

    fetchPromise
      .then((res) => {
        const payload = res?.data !== undefined ? res.data : res;
        if (payload && Array.isArray(payload.items)) {
          setData({
            role: payload.role || userRole || 'public',
            count: typeof payload.count === 'number' ? payload.count : payload.items.length,
            items: payload.items,
          });
        }
      })
      .catch((err) => {
        console.error('Failed to fetch India notifications:', err);
      });
  };

  // Initial fetch and 60-second polling interval
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 60000);
    return () => clearInterval(interval);
  }, [authFetch, userRole]);

  // Click outside handler to close dropdown
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const count = data.count;
  const effectiveRole = data.role || userRole || 'public';
  const isAdminOrOfficer =
    effectiveRole === 'admin' || effectiveRole === 'field_officer';

  const handleRowClick = (item) => {
    if (typeof onProjectClick === 'function') {
      if (isAdminOrOfficer) {
        onProjectClick(item);
      } else {
        onProjectClick({
          project_id: item.project_id,
          name: item.project_name || item.name,
          ...item,
        });
      }
    }
    setIsOpen(false);
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return '';
    try {
      const d = new Date(timestamp);
      if (isNaN(d.getTime())) return timestamp;
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="relative p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-brand-amber/20"
        title="Notifications"
        aria-label="Notifications"
      >
        <Bell className="w-5 h-5" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-red-600 text-white text-[11px] font-bold rounded-full flex items-center justify-center leading-none shadow-sm animate-in fade-in zoom-in duration-200">
            {count}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="fixed sm:absolute top-14 sm:top-full left-3 right-3 sm:left-auto sm:right-0 mt-2 sm:w-96 max-w-[calc(100vw-1.5rem)] bg-white rounded-xl shadow-2xl border border-slate-100 max-h-96 overflow-y-auto overflow-x-hidden z-50 divide-y divide-slate-100">
          {/* Header */}
          <div className="p-3.5 bg-white/95 backdrop-blur-xs sticky top-0 z-10 flex items-center justify-between border-b border-slate-100">
            <h3 className="font-semibold text-sm text-slate-800">
              {isAdminOrOfficer
                ? `Flagged Projects (${count})`
                : `Updates on Your Projects (${count})`}
            </h3>
            {count > 0 && (
              <span
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                  isAdminOrOfficer
                    ? 'bg-red-50 text-red-700 border-red-100'
                     : 'bg-[#EEF0F6] text-brand-ink border-[#C8CEDE]'
                }`}
              >
                {isAdminOrOfficer ? 'Action needed' : 'Updates'}
              </span>
            )}
          </div>

          {/* Content */}
          {count === 0 ? (
            <div className="p-8 text-center flex flex-col items-center justify-center text-slate-500">
              {isAdminOrOfficer ? (
                <>
                  <CheckCircle className="w-8 h-8 text-emerald-500 mb-2" />
                  <p className="text-xs font-medium text-slate-600">
                    No flagged projects right now
                  </p>
                </>
              ) : (
                <>
                  <Bell className="w-8 h-8 text-slate-400 mb-2 stroke-[1.5]" />
                  <p className="text-xs font-medium text-slate-600">
                    Follow a project to get updates here
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Follow Indian infrastructure projects to receive field reports and updates
                  </p>
                </>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-50">
              {isAdminOrOfficer
                ? data.items.map((project) => {
                    const primaryReason =
                      project.risk_reasons && project.risk_reasons.length > 0
                        ? project.risk_reasons[0]
                        : 'Flagged for risk review';
                    const tag = [project.sector, project.state]
                      .filter(Boolean)
                      .join(' • ');

                    return (
                      <div
                        key={project.project_id || project.name}
                        onClick={() => handleRowClick(project)}
                        className="p-3 hover:bg-slate-50/80 cursor-pointer transition-colors group text-left"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-medium text-sm text-slate-900 group-hover:text-brand-ink transition-colors truncate flex-1">
                            {project.name}
                          </h4>
                          {project.risk_reasons?.length > 1 && (
                            <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.2 rounded-full shrink-0">
                              +{project.risk_reasons.length - 1} more
                            </span>
                          )}
                        </div>

                        {/* Primary Risk Reason */}
                        <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                          {primaryReason}
                        </p>

                        {/* Sector / State Tag */}
                        {tag && (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <span className="text-[10px] text-slate-400 font-medium bg-slate-100 px-1.5 py-0.5 rounded truncate max-w-[200px] sm:max-w-[280px]">
                              {tag}
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })
                : data.items.map((item, idx) => {
                    return (
                      <div
                        key={`${item.project_id}-${item.timestamp || idx}`}
                        onClick={() => handleRowClick(item)}
                        className="p-3 hover:bg-slate-50/80 cursor-pointer transition-colors group text-left"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-medium text-sm text-slate-900 group-hover:text-brand-ink transition-colors truncate flex-1">
                            {item.project_name || `Project #${item.project_id}`}
                          </h4>
                        </div>

                        {/* Summary */}
                        <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                          {item.summary}
                        </p>

                        {/* Timestamp */}
                        {item.timestamp && (
                          <p className="text-[11px] text-slate-400 mt-1.5">
                            {formatTimestamp(item.timestamp)}
                          </p>
                        )}
                      </div>
                    );
                  })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
