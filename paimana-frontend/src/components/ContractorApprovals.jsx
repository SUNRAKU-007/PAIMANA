import { useState, useEffect } from 'react';
import { UserCheck, CheckCircle2, Clock, RefreshCw, AlertCircle, ShieldAlert } from 'lucide-react';

export default function ContractorApprovals({ authFetch }) {
  const [pendingContractors, setPendingContractors] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [approvingId, setApprovingId] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const fetchPending = async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const res = await authFetch.get('/admin/pending-contractors');
      setPendingContractors(res.data || []);
    } catch (err) {
      setErrorMessage(
        err.response?.data?.detail || 'Failed to fetch pending contractors. Please check admin permissions.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPending();
  }, []);

  const handleApprove = async (user) => {
    const targetId = user.id || user.user_id || user.username;
    setApprovingId(targetId);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const res = await authFetch.patch(`/admin/contractors/${encodeURIComponent(targetId)}/verify`);
      setSuccessMessage(
        res.data?.message || `Contractor "${user.full_name || user.username}" verified successfully!`
      );
      // Remove approved contractor from pending list
      setPendingContractors((prev) =>
        prev.filter((c) => (c.id || c.user_id || c.username) !== targetId)
      );
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (err) {
      setErrorMessage(
        err.response?.data?.detail || 'Failed to approve contractor. Please try again.'
      );
    } finally {
      setApprovingId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[#16213E] text-white">
              <UserCheck size={20} />
            </div>
            <h1
              className="text-2xl font-bold text-slate-900 tracking-tight"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              Account Approvals
            </h1>
          </div>
          <p className="text-sm text-slate-500 mt-1" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
            Review pending contractor and field officer account requests. Approved users are eligible for project assignment to submit weekly field reports or manage contractor contracts.
          </p>
        </div>

        <button
          onClick={fetchPending}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          Refresh List
        </button>
      </div>

      {/* Success banner */}
      {successMessage && (
        <div className="flex items-center gap-2 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium animate-fadeIn">
          <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Error banner */}
      {errorMessage && (
        <div className="flex items-center gap-2 p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm font-medium">
          <AlertCircle size={18} className="text-red-600 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
          <div className="w-8 h-8 border-2 border-[#16213E] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-500">Loading pending approval requests...</p>
        </div>
      ) : pendingContractors.length === 0 ? (
        /* Empty state */
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
          <div className="w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto mb-3.5">
            <CheckCircle2 size={28} />
          </div>
          <h3 className="text-lg font-semibold text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>
            No Pending Approvals
          </h3>
          <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
            All registered contractors and field officers have been reviewed. When a new officer or contractor signs up, their profile will appear here for verification.
          </p>
        </div>
      ) : (
        /* Table of pending users */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Pending Verification Requests ({pendingContractors.length})
            </span>
          </div>

          <div className="divide-y divide-slate-100">
            {pendingContractors.map((c) => {
              const cId = c.id || c.user_id || c.username;
              const isApproving = approvingId === cId;
              const isOfficer = c.role === 'field_officer' || c.role === 'officer';

              return (
                <div
                  key={cId}
                  className="px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors"
                >
                  <div className="flex items-start sm:items-center gap-3.5">
                    <div
                      className={`w-10 h-10 rounded-full font-bold text-sm flex items-center justify-center shrink-0 uppercase ${
                        isOfficer
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {(c.full_name || c.username || (isOfficer ? 'FO' : 'CO')).slice(0, 2)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 text-sm">
                          {c.full_name || c.username}
                        </span>
                        <span className="text-xs font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                          @{c.username}
                        </span>
                        <span
                          className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                            isOfficer
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {isOfficer ? 'Field Officer' : 'Contractor'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200 px-2 py-0.5 rounded-full">
                          <Clock size={11} />
                          Pending Admin Verification
                        </span>
                        {c.created_at && (
                          <>
                            <span className="text-xs text-slate-400">•</span>
                            <span className="text-xs text-slate-400">
                              Registered: {new Date(c.created_at).toLocaleDateString()}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:self-center self-end">
                    <button
                      onClick={() => handleApprove(c)}
                      disabled={isApproving}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 rounded-lg shadow-sm transition-colors cursor-pointer disabled:cursor-not-allowed"
                    >
                      {isApproving ? (
                        <>
                          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Approving...
                        </>
                      ) : (
                        <>
                          <UserCheck size={14} />
                          {isOfficer ? 'Approve Officer' : 'Approve Contractor'}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
