import { useState, useEffect } from 'react';
import { Bell, Check } from 'lucide-react';

const formatCost = (value) => {
  if (value == null || value === '') return '—';
  const num = Number(value);
  return isNaN(num) ? value : num.toLocaleString('en-IN');
};

export default function IndiaProjectModal({ project, authFetch, userRole, onClose }) {
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState(null);

  // Field Report Form State (for admin / field_officer)
  const [expenditureUpdate, setExpenditureUpdate] = useState('');
  const [delayReason, setDelayReason] = useState('');
  const [reportNotes, setReportNotes] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportSubmitError, setReportSubmitError] = useState(null);
  const [reportSubmitSuccess, setReportSubmitSuccess] = useState(false);

  const [feedbackList, setFeedbackList] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState(null);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackCategory, setFeedbackCategory] = useState('delay');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [feedbackSubmitError, setFeedbackSubmitError] = useState(null);

  // Follow State (for role "public")
  const [isFollowing, setIsFollowing] = useState(false);
  const [isFollowingLoading, setIsFollowingLoading] = useState(false);

  // Check follow status when modal opens for public users
  useEffect(() => {
    if (!project || !project.project_id || userRole !== 'public') {
      setIsFollowing(false);
      return;
    }

    let isMounted = true;
    const url = 'http://127.0.0.1:8000/india/me/following';
    const fetchPromise =
      authFetch && typeof authFetch.get === 'function'
        ? authFetch.get(url)
        : fetch(url).then((res) => res.json());

    fetchPromise
      .then((res) => {
        if (isMounted) {
          const data = res?.data !== undefined ? res.data : res;
          if (Array.isArray(data)) {
            const currentPid = String(project.project_id);
            const isFollowed = data.some(
              (item) => String(item.project_id) === currentPid
            );
            setIsFollowing(isFollowed);
          }
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('Failed to check following status:', err);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [project?.project_id, userRole, authFetch]);

  // Toggle follow handler
  const handleToggleFollow = async () => {
    if (!project || !project.project_id || isFollowingLoading) return;
    setIsFollowingLoading(true);

    const url = `http://127.0.0.1:8000/india/projects/${project.project_id}/follow`;
    try {
      let res;
      if (authFetch && typeof authFetch.post === 'function') {
        res = await authFetch.post(url);
      } else {
        const r = await fetch(url, { method: 'POST' });
        res = await r.json();
      }
      const data = res?.data !== undefined ? res.data : res;
      if (data && typeof data.following === 'boolean') {
        setIsFollowing(data.following);
      }
    } catch (err) {
      console.error('Failed to toggle follow status:', err);
    } finally {
      setIsFollowingLoading(false);
    }
  };

  // Close on Escape key press and manage body scroll lock
  useEffect(() => {
    if (!project) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [project, onClose]);

  // Fetch field reports when modal opens for a project
  useEffect(() => {
    if (!project || !project.project_id) {
      setReports([]);
      setReportsLoading(false);
      return;
    }

    let isMounted = true;
    setReportsLoading(true);
    setReportsError(null);

    const url = `http://127.0.0.1:8000/india/projects/${project.project_id}/reports`;
    const fetchPromise =
      authFetch && typeof authFetch.get === 'function'
        ? authFetch.get(url)
        : fetch(url).then((res) => res.json());

    fetchPromise
      .then((res) => {
        if (isMounted) {
          const data = res?.data !== undefined ? res.data : res;
          setReports(Array.isArray(data) ? data : []);
          setReportsLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('Failed to fetch project reports:', err);
          setReportsError('Failed to load field reports.');
          setReportsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [project?.project_id, authFetch]);

  // Fetch community feedback when modal opens for a project
  useEffect(() => {
    if (!project || !project.project_id) {
      setFeedbackList([]);
      setFeedbackLoading(false);
      return;
    }

    let isMounted = true;
    setFeedbackLoading(true);
    setFeedbackError(null);

    const url = `http://127.0.0.1:8000/india/projects/${project.project_id}/feedback`;
    const fetchPromise =
      authFetch && typeof authFetch.get === 'function'
        ? authFetch.get(url)
        : fetch(url).then((res) => res.json());

    fetchPromise
      .then((res) => {
        if (isMounted) {
          const data = res?.data !== undefined ? res.data : res;
          setFeedbackList(Array.isArray(data) ? data : []);
          setFeedbackLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('Failed to fetch project feedback:', err);
          setFeedbackError('Failed to load community feedback.');
          setFeedbackLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [project?.project_id, authFetch]);

  // Submit field report handler (admin / field_officer)
  const handleReportSubmit = async (e) => {
    e.preventDefault();
    if (!project?.project_id || isSubmittingReport) return;

    const trimmedExp = expenditureUpdate.trim();
    if (trimmedExp === '' || isNaN(Number(trimmedExp)) || Number(trimmedExp) < 0) {
      setReportSubmitError('Please enter a valid non-negative expenditure amount.');
      return;
    }

    setIsSubmittingReport(true);
    setReportSubmitError(null);

    const payload = {
      expenditure_update_cr: Number(trimmedExp),
      delay_reason: delayReason.trim() ? delayReason.trim() : null,
      notes: reportNotes.trim() ? reportNotes.trim() : '',
    };

    try {
      const url = `http://127.0.0.1:8000/india/projects/${project.project_id}/report`;
      let newReport;

      if (authFetch && typeof authFetch.post === 'function') {
        const res = await authFetch.post(url, payload);
        newReport = res?.data !== undefined ? res.data : res;
      } else {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Submission failed');
        newReport = await res.json();
      }

      // Optimistic update: prepend new report to reports list
      setReports((prev) => [newReport, ...prev]);
      setExpenditureUpdate('');
      setDelayReason('');
      setReportNotes('');
      setReportSubmitSuccess(true);
      setTimeout(() => {
        setReportSubmitSuccess(false);
      }, 2000);
    } catch (err) {
      console.error('Error submitting field report:', err);
      setReportSubmitError(
        err?.response?.data?.detail || 'Failed to submit field report. Please try again.'
      );
    } finally {
      setIsSubmittingReport(false);
    }
  };

  // Submit feedback handler
  const handleFeedbackSubmit = async (e) => {
    e.preventDefault();
    const trimmedMessage = feedbackMessage.trim();
    if (!trimmedMessage || isSubmittingFeedback || !project?.project_id) return;

    setIsSubmittingFeedback(true);
    setFeedbackSubmitError(null);

    const payload = {
      message: trimmedMessage,
      category: feedbackCategory,
    };

    try {
      const url = `http://127.0.0.1:8000/india/projects/${project.project_id}/feedback`;
      let newEntry;

      if (authFetch && typeof authFetch.post === 'function') {
        const res = await authFetch.post(url, payload);
        newEntry = res?.data !== undefined ? res.data : res;
      } else {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Submission failed');
        newEntry = await res.json();
      }

      setFeedbackList((prev) => [newEntry, ...prev]);
      setFeedbackMessage('');
      setFeedbackCategory('delay');
    } catch (err) {
      console.error('Error submitting feedback:', err);
      setFeedbackSubmitError(
        err?.response?.data?.detail || 'Failed to submit feedback. Please try again.'
      );
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  // If project is null, render nothing
  if (!project) return null;

  // Status badge styling
  const renderStatusBadge = (status) => {
    switch (status) {
      case 'Completed':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            Completed
          </span>
        );
      case 'Ongoing':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#EEF0F6] text-brand-ink border border-[#C8CEDE]">
            Ongoing
          </span>
        );
      case 'Newly Added':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
            Newly Added
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
            {status || 'Unknown'}
          </span>
        );
    }
  };

  // Category badge styling for feedback
  const renderCategoryBadge = (category) => {
    switch (category) {
      case 'delay':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
            Delay
          </span>
        );
      case 'quality':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-red-50 text-red-700 border border-red-200">
            Quality Issue
          </span>
        );
      case 'safety':
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200">
            Safety Concern
          </span>
        );
      case 'other':
      default:
        return (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
            Other
          </span>
        );
    }
  };

  // Financial summary logic
  const origCost = project.original_cost_cr;
  const expCost = project.expenditure_cr;
  const revCost = project.revised_cost_cr;
  const isCostDifferent =
    revCost != null && origCost != null && Number(revCost) !== Number(origCost);
  const isCostEscalated = isCostDifferent && Number(revCost) > Number(origCost);

  // Timeline entries
  const timelineItems = [
    { label: 'Approval Date', value: project.approval_date },
    { label: 'Start Date', value: project.start_date },
    {
      label: 'Original Target',
      value: project.original_doc || (project.revised_doc ? null : project.target_doc),
    },
    {
      label: 'Revised Target',
      value: project.revised_doc || (project.original_doc && project.target_doc ? project.target_doc : null),
    },
    { label: 'Actual Completion', value: project.actual_completion },
  ].filter((item) => item.value != null && item.value !== '' && item.value !== 'NA');

  // Format date helper for reports
  const formatReportDate = (timestamp) => {
    if (!timestamp) return '—';
    try {
      const d = new Date(timestamp);
      if (isNaN(d.getTime())) return timestamp;
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return timestamp;
    }
  };

  const canSubmitReport = userRole === 'admin' || userRole === 'field_officer';
  const isExpenditureValid =
    expenditureUpdate.trim() !== '' &&
    !isNaN(Number(expenditureUpdate)) &&
    Number(expenditureUpdate) >= 0;
  const isReportSubmitDisabled = !isExpenditureValid || isSubmittingReport;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs transition-opacity"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-auto max-h-[85vh] overflow-y-auto p-6 relative border border-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. Header */}
        <div className="flex justify-between items-start gap-4 pb-4 border-b border-slate-100">
          <div className="flex-1 pr-2">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-xl font-bold text-slate-900 leading-tight">
                {project.name}
              </h2>
              {renderStatusBadge(project.status)}
            </div>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              {[project.sector, project.ministry, project.state]
                .filter(Boolean)
                .join(' • ')}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {userRole === 'public' && (
              <button
                type="button"
                onClick={handleToggleFollow}
                disabled={isFollowingLoading}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                  isFollowing
                    ? 'bg-[#EEF0F6] text-brand-ink border border-[#C8CEDE] hover:bg-[#DDE0EA]'
                    : 'bg-white text-slate-600 border border-slate-300 hover:border-brand-amber hover:text-slate-900'
                }`}
                aria-label={isFollowing ? 'Unfollow project' : 'Follow project'}
              >
                {isFollowing ? (
                  <>
                    <Check className="w-4 h-4 text-brand-ink" />
                    <span>Following</span>
                  </>
                ) : (
                  <>
                    <Bell className="w-4 h-4 text-slate-500" />
                    <span>Follow</span>
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              aria-label="Close modal"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* 2. Financial Summary Row */}
        <div className="mt-5">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
            Financial Summary
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Original Cost */}
            <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/70">
              <div className="text-xs text-slate-500 font-medium mb-1">Original Cost</div>
              <div className="text-base font-bold text-slate-900">
                {origCost != null ? `₹${formatCost(origCost)} Cr` : '—'}
              </div>
            </div>

            {/* Expenditure */}
            <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/70">
              <div className="text-xs text-slate-500 font-medium mb-1">Expenditure</div>
              <div className="text-base font-bold text-slate-900">
                {expCost != null ? `₹${formatCost(expCost)} Cr` : '—'}
              </div>
            </div>

            {/* Revised Cost */}
            <div
              className={`rounded-xl p-3.5 border ${
                isCostEscalated
                  ? 'bg-red-50/80 border-red-200'
                  : 'bg-slate-50 border-slate-200/70'
              }`}
            >
              <div
                className={`text-xs font-medium mb-1 ${
                  isCostEscalated ? 'text-red-700' : 'text-slate-500'
                }`}
              >
                Revised Cost
              </div>
              <div
                className={`text-base font-bold ${
                  isCostEscalated
                    ? 'text-red-600'
                    : isCostDifferent
                    ? 'text-slate-900'
                    : 'text-slate-600'
                }`}
              >
                {isCostDifferent
                  ? `₹${formatCost(revCost)} Cr`
                  : origCost != null
                  ? `₹${formatCost(origCost)} Cr (No change)`
                  : '—'}
              </div>
            </div>
          </div>
        </div>

        {/* 3. Physical Progress Bar (larger h-3) */}
        {project.physical_progress_pct != null && (
          <div className="mt-5 bg-slate-50 rounded-xl p-3.5 border border-slate-200/70">
            <div className="flex justify-between items-center text-xs font-semibold text-slate-700 mb-2">
              <span>Physical Progress</span>
              <span className="text-brand-ink text-sm font-bold">
                {project.physical_progress_pct}%
              </span>
            </div>
            <div className="w-full bg-slate-200/70 h-3 rounded-full overflow-hidden">
              <div
                className="bg-brand-ink h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(0, project.physical_progress_pct))}%`,
                }}
              />
            </div>
          </div>
        )}

        {/* 4. Timeline Section */}
        {timelineItems.length > 0 && (
          <div className="mt-5">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
              Project Timeline
            </h3>
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/70 space-y-2.5">
              {timelineItems.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between text-xs py-1 border-b border-slate-200/50 last:border-0"
                >
                  <div className="flex items-center gap-2 text-slate-600 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-amber"></span>
                    <span>{item.label}</span>
                  </div>
                  <span className="font-semibold text-slate-900">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 5. Delay Note Callout */}
        {project.delay_note && (
          <div className="mt-5 p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-start gap-2.5">
            <svg
              className="w-4 h-4 text-amber-600 shrink-0 mt-0.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <div className="font-bold text-amber-900 uppercase tracking-wider text-[10px] mb-0.5">
                Delay & Impact Notice
              </div>
              <p className="leading-relaxed">{project.delay_note}</p>
            </div>
          </div>
        )}

        {/* 6. Field Reports Section */}
        <div className="mt-6 pt-5 border-t border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Field Reports
            </h3>
            <span className="text-xs text-slate-500 font-medium">
              {reports.length} report{reports.length === 1 ? '' : 's'}
            </span>
          </div>

          {/* Submit Field Report Form (Admin and field officer only) */}
          {canSubmitReport && (
            <div className="mb-5 bg-slate-50 border border-slate-200/80 rounded-xl p-4">
              <div className="mb-3">
                <h4 className="text-sm font-semibold text-slate-700">
                  Submit Field Report
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Visible to admin and field officer roles only
                </p>
              </div>

              <form onSubmit={handleReportSubmit} className="space-y-3">
                {/* Expenditure Update */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Expenditure Spent This Period (₹ Cr) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={expenditureUpdate}
                    onChange={(e) => setExpenditureUpdate(e.target.value)}
                    placeholder="e.g. 24.50"
                    required
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-amber/50 focus:border-brand-amber transition-colors"
                  />
                </div>

                {/* Delay Reason */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Delay Reason (if any)
                  </label>
                  <input
                    type="text"
                    value={delayReason}
                    onChange={(e) => setDelayReason(e.target.value)}
                    placeholder="e.g. Land acquisition delay, monsoon disruption, contractor issue"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-amber/50 focus:border-brand-amber transition-colors"
                  />
                </div>

                {/* Additional Notes */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Additional Notes
                  </label>
                  <textarea
                    rows={2}
                    value={reportNotes}
                    onChange={(e) => setReportNotes(e.target.value)}
                    placeholder="Progress update, issues encountered, anything relevant this period"
                    className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-amber/50 focus:border-brand-amber transition-colors resize-none"
                  />
                </div>

                {/* Error Banner */}
                {reportSubmitError && (
                  <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                    {reportSubmitError}
                  </div>
                )}

                {/* Success Banner */}
                {reportSubmitSuccess && (
                  <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2 flex items-center gap-1.5 transition-opacity">
                    <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Report submitted</span>
                  </div>
                )}

                <div className="flex justify-end pt-1">
                  <button
                    type="submit"
                    disabled={isReportSubmitDisabled}
                    className="bg-brand-ink text-white rounded-lg px-4 py-2 text-xs font-semibold hover:bg-brand-ink-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isSubmittingReport ? 'Submitting...' : 'Submit Weekly Report'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Spinner during fetch */}
          {reportsLoading && (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-brand-ink border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs text-slate-500 ml-2 font-medium">
                Loading field reports...
              </span>
            </div>
          )}

          {/* Error Message */}
          {reportsError && !reportsLoading && (
            <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-100">
              {reportsError}
            </div>
          )}

          {/* Empty reports state */}
          {!reportsLoading && !reportsError && reports.length === 0 && (
            <div className="bg-slate-50 border border-slate-200/70 rounded-xl p-6 text-center text-xs text-slate-500">
              No field reports submitted yet for this project.
            </div>
          )}

          {/* Reports List */}
          {!reportsLoading && reports.length > 0 && (
            <div className="space-y-3">
              {reports.map((report, idx) => (
                <div
                  key={report.id || idx}
                  className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/70 text-xs"
                >
                  <div className="flex items-center justify-between text-slate-500 mb-2">
                    <span className="font-semibold text-slate-800">
                      Filed by: {report.submitted_by || 'Unknown'}
                    </span>
                    <span>{formatReportDate(report.timestamp)}</span>
                  </div>

                  {report.expenditure_update_cr != null && (
                    <div className="mb-1.5 text-slate-700">
                      <strong className="text-slate-900">Expenditure Update:</strong>{' '}
                      ₹{formatCost(report.expenditure_update_cr)} Cr
                    </div>
                  )}

                  {report.delay_reason && (
                    <div className="mb-1.5 text-amber-800 bg-amber-50/60 p-2 rounded border border-amber-100">
                      <strong className="text-amber-900">Delay Reason:</strong>{' '}
                      {report.delay_reason}
                    </div>
                  )}

                  {report.notes && (
                    <div className="text-slate-600 mt-1 bg-white p-2 rounded border border-slate-200/50">
                      <strong className="text-slate-800">Notes:</strong> {report.notes}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 7. Community Feedback Section */}
        <div className="mt-6 pt-5 border-t border-slate-100">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Community Feedback
            </h3>
            <span className="text-xs text-slate-500 font-medium">
              {feedbackList.length} response{feedbackList.length === 1 ? '' : 's'}
            </span>
          </div>

          {/* Spinner during fetch */}
          {feedbackLoading && (
            <div className="flex items-center justify-center py-6">
              <div className="w-5 h-5 border-2 border-brand-ink border-t-transparent rounded-full animate-spin"></div>
              <span className="text-xs text-slate-500 ml-2 font-medium">
                Loading community feedback...
              </span>
            </div>
          )}

          {/* Error Message */}
          {feedbackError && !feedbackLoading && (
            <div className="p-3 bg-red-50 text-red-700 text-xs rounded-lg border border-red-100 mb-3">
              {feedbackError}
            </div>
          )}

          {/* Empty feedback state */}
          {!feedbackLoading && !feedbackError && feedbackList.length === 0 && (
            <div className="bg-slate-50 border border-slate-200/70 rounded-xl p-5 text-center text-xs text-slate-500">
              No feedback submitted yet — be the first to share what you're seeing.
            </div>
          )}

          {/* Feedback entries list */}
          {!feedbackLoading && feedbackList.length > 0 && (
            <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
              {feedbackList.map((item, idx) => (
                <div
                  key={item.id || idx}
                  className="bg-slate-50 rounded-xl p-3 border border-slate-200/70 text-xs"
                >
                  <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                    {renderCategoryBadge(item.category)}
                    <span className="text-slate-400 text-[11px]">
                      {formatReportDate(item.timestamp)}
                    </span>
                  </div>
                  <p className="text-slate-700 leading-relaxed whitespace-pre-wrap">
                    {item.message}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Compact Submission Form */}
          <form
            onSubmit={handleFeedbackSubmit}
            className="mt-4 bg-slate-50 border border-slate-200/80 rounded-xl p-3.5"
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-semibold text-slate-700">Share Feedback</span>
              <select
                value={feedbackCategory}
                onChange={(e) => setFeedbackCategory(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-amber/50 focus:border-brand-amber cursor-pointer"
              >
                <option value="delay">Delay</option>
                <option value="quality">Quality Issue</option>
                <option value="safety">Safety Concern</option>
                <option value="other">Other</option>
              </select>
            </div>
            <textarea
              value={feedbackMessage}
              onChange={(e) => setFeedbackMessage(e.target.value)}
              rows={2}
              placeholder="What are you experiencing with this project?"
              className="w-full bg-white border border-slate-200 rounded-lg p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-amber/50 focus:border-brand-amber transition-colors resize-none"
            />
            {feedbackSubmitError && (
              <div className="mt-2 text-xs text-red-600">
                {feedbackSubmitError}
              </div>
            )}
            <div className="mt-2.5 flex justify-end">
              <button
                type="submit"
                disabled={!feedbackMessage.trim() || isSubmittingFeedback}
                className="bg-brand-ink text-white rounded-lg px-4 py-2 text-xs font-semibold hover:bg-brand-ink-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSubmittingFeedback ? 'Submitting...' : 'Submit Feedback'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
