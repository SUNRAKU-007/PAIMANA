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
  const isAdmin = effectiveRole === 'admin';
  const isOfficer = effectiveRole === 'field_officer' || effectiveRole === 'officer';
  const isContractor = effectiveRole === 'contractor';

  const getHeaderTitle = () => {
    if (isAdmin) return `Flagged Projects (${count})`;
    if (isOfficer) return `Assigned Project Alerts (${count})`;
    if (isContractor) return `Contract Alerts & Updates (${count})`;
    return `Updates on Followed Projects (${count})`;
  };

  const handleRowClick = (item) => {
    if (typeof onProjectClick === 'function') {
      onProjectClick({
        project_id: item.project_id,
        name: item.name || item.project_name,
        ...item,
      });
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
              {getHeaderTitle()}
            </h3>
            {count > 0 && (
              <span
                className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
                  isAdmin || isOfficer || isContractor
                    ? 'bg-red-50 text-red-700 border-red-100'
                    : 'bg-[#EEF0F6] text-brand-ink border-[#C8CEDE]'
                }`}
              >
                {isAdmin || isOfficer || isContractor ? 'Action needed' : 'Updates'}
              </span>
            )}
          </div>

          {/* Content */}
          {count === 0 ? (
            <div className="p-8 text-center flex flex-col items-center justify-center text-slate-500">
              {isAdmin ? (
                <>
                  <CheckCircle className="w-8 h-8 text-emerald-500 mb-2" />
                  <p className="text-xs font-semibold text-slate-700">
                    No flagged projects right now
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    All monitored infrastructure projects are operating normally.
                  </p>
                </>
              ) : isOfficer ? (
                <>
                  <CheckCircle className="w-8 h-8 text-emerald-500 mb-2" />
                  <p className="text-xs font-semibold text-slate-700">
                    No active alerts on your assigned project
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Your assigned project is on track with no pending risk flags.
                  </p>
                </>
              ) : isContractor ? (
                <>
                  <CheckCircle className="w-8 h-8 text-emerald-500 mb-2" />
                  <p className="text-xs font-semibold text-slate-700">
                    No active alerts on your assigned contract
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    All reports are reviewed and no contract risk flags are active.
                  </p>
                </>
              ) : (
                <>
                  <Bell className="w-8 h-8 text-slate-400 mb-2 stroke-[1.5]" />
                  <p className="text-xs font-semibold text-slate-700">
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
              {data.items.map((item, idx) => {
                const projName = item.name || item.project_name || `Project #${item.project_id}`;
                const primaryReason =
                  item.summary ||
                  (item.risk_reasons && item.risk_reasons.length > 0 ? item.risk_reasons[0] : null) ||
                  'Flagged for risk review';
                const tag = [item.sector, item.state].filter(Boolean).join(' • ');
                const isPending = item.type === 'pending_action';
                const isRejected = item.type === 'rejected_report';
                const isFlagged = item.is_flagged || item.type === 'risk_flag' || (item.risk_reasons && item.risk_reasons.length > 0);

                return (
                  <div
                    key={`${item.project_id}-${item.type || ''}-${item.timestamp || idx}`}
                    onClick={() => handleRowClick(item)}
                    className="p-3 hover:bg-slate-50/80 cursor-pointer transition-colors group text-left"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-medium text-sm text-slate-900 group-hover:text-brand-ink transition-colors truncate flex-1">
                        {projName}
                      </h4>
                      {isPending && (
                        <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full shrink-0">
                          Awaiting action
                        </span>
                      )}
                      {isRejected && (
                        <span className="text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded-full shrink-0">
                          Rejected
                        </span>
                      )}
                      {!isPending && !isRejected && isFlagged && (
                        <span className="text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200 px-1.5 py-0.5 rounded-full shrink-0">
                          Flagged
                        </span>
                      )}
                      {item.risk_reasons?.length > 1 && (
                        <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full shrink-0">
                          +{item.risk_reasons.length - 1} more
                        </span>
                      )}
                    </div>

                    {/* Summary / Risk Reason */}
                    <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                      {primaryReason}
                    </p>

                    {/* Footer Tags & Timestamp */}
                    <div className="mt-1.5 flex items-center justify-between gap-2">
                      {tag ? (
                        <span className="text-[10px] text-slate-400 font-medium bg-slate-100 px-1.5 py-0.5 rounded truncate max-w-[200px] sm:max-w-[260px]">
                          {tag}
                        </span>
                      ) : <span />}
                      {item.timestamp && (
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {formatTimestamp(item.timestamp)}
                        </span>
                      )}
                    </div>
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
