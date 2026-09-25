import { useState, useEffect } from 'react';
import { Bell, Check } from 'lucide-react';
import { API_BASE_URL } from '../api';

const formatCost = (value) => {
  if (value == null || value === '') return '—';
  const num = Number(value);
  return isNaN(num) ? value : num.toLocaleString('en-IN');
};

export default function IndiaProjectModal({ project, authFetch, userRole, authToken, onLoginRequest, onClose }) {
  const [reports, setReports] = useState([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsError, setReportsError] = useState(null);

  // Field Report Form State (for field_officer)
  const [expenditureUpdate, setExpenditureUpdate] = useState('');
  const [progressPct, setProgressPct] = useState('');
  const [delayReason, setDelayReason] = useState('');
  const [reportNotes, setReportNotes] = useState('');
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportSubmitError, setReportSubmitError] = useState(null);
  const [reportSubmitSuccess, setReportSubmitSuccess] = useState(false);

  // Contractor report confirmation/rejection state
  const [confirmingReportId, setConfirmingReportId] = useState(null);
  const [rejectingReportId, setRejectingReportId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [reportActionError, setReportActionError] = useState(null);
  const [reportActionSuccess, setReportActionSuccess] = useState(null);

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

  // Status Update state (for role "admin": "Completed" or "Terminated")
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusUpdateError, setStatusUpdateError] = useState(null);
  const [localStatus, setLocalStatus] = useState(null); // tracks optimistic status update

  // Local financial & progress tracking for immediate updates upon confirmation
  const [localExpenditure, setLocalExpenditure] = useState(project?.expenditure_cr);
  const [localProgress, setLocalProgress] = useState(project?.physical_progress_pct);

  // Project Assignment State (for admin assignment & display)
  const [assignedOfficer, setAssignedOfficer] = useState(project?.assigned_officer || '');
  const [assignedContractor, setAssignedContractor] = useState(project?.assigned_contractor || '');
  const [assignableUsers, setAssignableUsers] = useState({ officers: [], contractors: [] });
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignSuccess, setAssignSuccess] = useState(false);
  const [assignError, setAssignError] = useState(null);

  // Contractor "Flag as Delayed" state
  const [delayFlagNote, setDelayFlagNote] = useState('');
  const [isFlaggingDelay, setIsFlaggingDelay] = useState(false);
  const [delayFlagError, setDelayFlagError] = useState(null);
  const [delayFlagSuccess, setDelayFlagSuccess] = useState(false);
  const [localDelayFlagged, setLocalDelayFlagged] = useState(false);
  const [showDelayFlagForm, setShowDelayFlagForm] = useState(false);

  // Check follow status when modal opens for logged-in public users
  useEffect(() => {
    if (!project || !project.project_id || userRole !== 'public' || !authToken) {
      setIsFollowing(false);
      return;
    }

    let isMounted = true;
    const url = `${API_BASE_URL}/india/me/following`;
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

  // Sync assignment fields and reset action states when project changes
  useEffect(() => {
    setLocalStatus(null);
    setStatusUpdateError(null);
    setAssignedOfficer(project?.assigned_officer || '');
    setAssignedContractor(project?.assigned_contractor || '');
    setAssignSuccess(false);
    setAssignError(null);
    setLocalExpenditure(project?.expenditure_cr);
    setLocalProgress(project?.physical_progress_pct);
    // Reset delay flag local state when a new project is opened
    setLocalDelayFlagged(false);
    setDelayFlagSuccess(false);
    setDelayFlagError(null);
    setDelayFlagNote('');
    setShowDelayFlagForm(false);
    // Reset report actions
    setConfirmingReportId(null);
    setRejectingReportId(null);
    setRejectReason('');
    setReportActionError(null);
    setReportActionSuccess(null);
  }, [project?.project_id, project?.assigned_officer, project?.assigned_contractor, project?.status, project?.expenditure_cr, project?.physical_progress_pct]);

  // Load assignable officers & verified contractors for admin, filtering out busy users on other active projects
  useEffect(() => {
    if (userRole === 'admin' && project?.project_id) {
      const url = `${API_BASE_URL}/admin/assignable-users?project_id=${project.project_id}`;
      const fetchPromise =
        authFetch && typeof authFetch.get === 'function'
          ? authFetch.get(url)
          : fetch(url, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} }).then((r) => r.json());

      fetchPromise
        .then((res) => {
          const d = res?.data !== undefined ? res.data : res;
          if (d && (d.officers || d.contractors)) {
            setAssignableUsers({
              officers: d.officers || [],
              contractors: d.contractors || [],
            });
          }
        })
        .catch((err) => {
          console.error('Failed to load assignable users:', err);
        });
    }
  }, [userRole, project?.project_id, authFetch, authToken, localStatus]);

  // Save assignment handler
  const handleSaveAssignment = async (e) => {
    if (e) e.preventDefault();
    if (!project?.project_id || isAssigning) return;
    setIsAssigning(true);
    setAssignError(null);
    setAssignSuccess(false);

    const payload = {
      assigned_officer: assignedOfficer ? assignedOfficer.trim() : null,
      assigned_contractor: assignedContractor ? assignedContractor.trim() : null,
    };

    try {
      const url = `${API_BASE_URL}/india/projects/${project.project_id}/assign`;
      let res;
      if (authFetch && typeof authFetch.patch === 'function') {
        res = await authFetch.patch(url, payload);
      } else {
        const r = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const errData = await r.json().catch(() => ({}));
          throw new Error(errData.detail || 'Failed to update assignment');
        }
        res = await r.json();
      }
      const data = res?.data !== undefined ? res.data : res;
      project.assigned_officer = data.assigned_officer;
      project.assigned_contractor = data.assigned_contractor;
      setAssignedOfficer(data.assigned_officer || '');
      setAssignedContractor(data.assigned_contractor || '');
      setAssignSuccess(true);
      setTimeout(() => setAssignSuccess(false), 3000);
    } catch (err) {
      console.error('Error assigning personnel:', err);
      setAssignError(
        err?.response?.data?.detail || err?.message || 'Failed to save project assignment.'
      );
    } finally {
      setIsAssigning(false);
    }
  };

  // Toggle follow handler
  const handleToggleFollow = async () => {
    if (!project || !project.project_id || isFollowingLoading) return;
    setIsFollowingLoading(true);

    const url = `${API_BASE_URL}/india/projects/${project.project_id}/follow`;
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
    // Reset local status whenever a new project is opened
    setLocalStatus(null);
    setStatusUpdateError(null);

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

    const url = `${API_BASE_URL}/india/projects/${project.project_id}/reports`;
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

    const url = `${API_BASE_URL}/india/projects/${project.project_id}/feedback`;
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

  // Update Project Status handler (admin only: "Completed" or "Terminated")
  const handleUpdateStatus = async (newStatus) => {
    if (!project?.project_id || isUpdatingStatus) return;
    const isCompleted = newStatus === 'Completed';
    const message = isCompleted
      ? `Mark "${project.name}" as Completed?\n\nThis will mark the project as successfully finished, record the completion date, and automatically release any assigned personnel for reassignment.`
      : `Terminate "${project.name}"?\n\nThis will mark the project as cancelled/stopped (Terminated) and automatically release any assigned personnel for reassignment.`;
    const confirmed = window.confirm(message);
    if (!confirmed) return;

    setIsUpdatingStatus(true);
    setStatusUpdateError(null);

    try {
      const url = `${API_BASE_URL}/india/projects/${project.project_id}/status`;
      const payload = { status: newStatus };
      if (authFetch && typeof authFetch.patch === 'function') {
        await authFetch.patch(url, payload);
      } else {
        const res = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Request failed'); }
      }
      // Optimistic update
      setLocalStatus(newStatus);
      setAssignedOfficer('');
      setAssignedContractor('');
    } catch (err) {
      setStatusUpdateError(err?.response?.data?.detail || err?.message || 'Failed to update status.');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Submit field report handler (field_officer only)
  const handleReportSubmit = async (e) => {
    e.preventDefault();
    if (!project?.project_id || isSubmittingReport) return;

    const trimmedExp = expenditureUpdate.trim();
    const trimmedProg = progressPct.trim();

    if (trimmedExp === '' && trimmedProg === '') {
      setReportSubmitError('Please enter an expenditure update amount and/or physical progress percentage.');
      return;
    }

    if (trimmedExp !== '' && (isNaN(Number(trimmedExp)) || Number(trimmedExp) < 0)) {
      setReportSubmitError('Please enter a valid non-negative expenditure amount.');
      return;
    }

    if (trimmedProg !== '' && (isNaN(Number(trimmedProg)) || Number(trimmedProg) < 0 || Number(trimmedProg) > 100)) {
      setReportSubmitError('Physical progress must be a percentage between 0 and 100.');
      return;
    }

    setIsSubmittingReport(true);
    setReportSubmitError(null);

    const payload = {
      expenditure_update_cr: trimmedExp !== '' ? Number(trimmedExp) : null,
      progress_pct: trimmedProg !== '' ? Number(trimmedProg) : null,
      delay_reason: delayReason.trim() ? delayReason.trim() : null,
      notes: reportNotes.trim() ? reportNotes.trim() : '',
    };

    try {
      const url = `${API_BASE_URL}/india/projects/${project.project_id}/report`;
      let newReport;

      if (authFetch && typeof authFetch.post === 'function') {
        const res = await authFetch.post(url, payload);
        newReport = res?.data !== undefined ? res.data : res;
      } else {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.detail || 'Submission failed');
        }
        newReport = await res.json();
      }

      // Optimistic update: prepend new report with pending_confirmation status
      setReports((prev) => [newReport, ...prev]);
      setExpenditureUpdate('');
      setProgressPct('');
      setDelayReason('');
      setReportNotes('');
      setReportSubmitSuccess(true);
      setTimeout(() => {
        setReportSubmitSuccess(false);
      }, 3000);
    } catch (err) {
      console.error('Error submitting field report:', err);
      setReportSubmitError(
        err?.response?.data?.detail || err?.message || 'Failed to submit field report. Please try again.'
      );
    } finally {
      setIsSubmittingReport(false);
    }
  };

  // Contractor confirm report handler
  const handleConfirmReport = async (reportId) => {
    if (!project?.project_id || confirmingReportId) return;
    const confirmed = window.confirm(
      'Confirm this field report?\n\nThis will apply the reported expenditure and progress numbers to the official project records.'
    );
    if (!confirmed) return;

    setConfirmingReportId(reportId);
    setReportActionError(null);

    try {
      const url = `${API_BASE_URL}/india/projects/${project.project_id}/reports/${reportId}/confirm`;
      let updatedReport;
      if (authFetch && typeof authFetch.patch === 'function') {
        const res = await authFetch.patch(url, {});
        updatedReport = res?.data !== undefined ? res.data : res;
      } else {
        const res = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.detail || 'Confirmation failed');
        }
        updatedReport = await res.json();
      }

      setReports((prev) =>
        prev.map((r) =>
          String(r.id || r.report_id) === String(reportId)
            ? { ...r, ...updatedReport, status: 'confirmed' }
            : r
        )
      );

      if (updatedReport.expenditure_update_cr != null) {
        setLocalExpenditure(updatedReport.expenditure_update_cr);
      }
      if (updatedReport.progress_pct != null) {
        setLocalProgress(updatedReport.progress_pct);
      }
      if (updatedReport.project_status) {
        setLocalStatus(updatedReport.project_status);
      }

      setReportActionSuccess(`Report confirmed! Project official figures updated.`);
      setTimeout(() => setReportActionSuccess(null), 4000);
    } catch (err) {
      console.error('Error confirming report:', err);
      setReportActionError(err?.response?.data?.detail || err?.message || 'Failed to confirm report.');
    } finally {
      setConfirmingReportId(null);
    }
  };

  // Contractor reject report handler
  const handleRejectReport = async (reportId) => {
    if (!project?.project_id) return;
    const trimmedReason = rejectReason.trim();
    if (!trimmedReason) {
      setReportActionError('Please provide a reason for rejecting the report.');
      return;
    }

    setConfirmingReportId(reportId);
    setReportActionError(null);

    try {
      const url = `${API_BASE_URL}/india/projects/${project.project_id}/reports/${reportId}/reject`;
      const payload = { reason: trimmedReason };
      let updatedReport;
      if (authFetch && typeof authFetch.patch === 'function') {
        const res = await authFetch.patch(url, payload);
        updatedReport = res?.data !== undefined ? res.data : res;
      } else {
        const res = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.detail || 'Rejection failed');
        }
        updatedReport = await res.json();
      }

      setReports((prev) =>
        prev.map((r) =>
          String(r.id || r.report_id) === String(reportId)
            ? { ...r, ...updatedReport, status: 'rejected', rejection_reason: trimmedReason }
            : r
        )
      );

      setRejectingReportId(null);
      setRejectReason('');
      setReportActionSuccess(`Report rejected. Officer will see the feedback.`);
      setTimeout(() => setReportActionSuccess(null), 4000);
    } catch (err) {
      console.error('Error rejecting report:', err);
      setReportActionError(err?.response?.data?.detail || err?.message || 'Failed to reject report.');
    } finally {
      setConfirmingReportId(null);
    }
  };

  // Contractor flag-delay handler
  const handleFlagDelay = async () => {
    if (!project?.project_id || isFlaggingDelay) return;
    const confirmed = window.confirm(
      `Flag "${project.name}" as delayed?\n\nThis will record a contractor delay flag on this project, visible to the administrator.`
    );
    if (!confirmed) return;

    setIsFlaggingDelay(true);
    setDelayFlagError(null);

    const payload = { reason: delayFlagNote.trim() || null };

    try {
      const url = `${API_BASE_URL}/india/projects/${project.project_id}/flag-delay`;
      if (authFetch && typeof authFetch.patch === 'function') {
        await authFetch.patch(url, payload);
      } else {
        const res = await fetch(url, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.detail || 'Request failed');
        }
      }
      setLocalDelayFlagged(true);
      setDelayFlagSuccess(true);
      setShowDelayFlagForm(false);
      setDelayFlagNote('');
    } catch (err) {
      console.error('Error flagging delay:', err);
      setDelayFlagError(
        err?.response?.data?.detail || err?.message || 'Failed to flag project as delayed.'
      );
    } finally {
      setIsFlaggingDelay(false);
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
      const url = `${API_BASE_URL}/india/projects/${project.project_id}/feedback`;
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
      case 'Terminated':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
            Terminated
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
  const expCost = localExpenditure != null ? localExpenditure : project.expenditure_cr;
  const revCost = project.revised_cost_cr;
  const effectiveProgress = localProgress != null ? localProgress : project.physical_progress_pct;
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

  const canSubmitReport = userRole === 'field_officer';
  const effectiveStatus = localStatus || project.status;
  const isExpenditureValid =
    expenditureUpdate.trim() !== '' &&
    !isNaN(Number(expenditureUpdate)) &&
    Number(expenditureUpdate) >= 0;
  const isProgressValid =
    progressPct.trim() !== '' &&
    !isNaN(Number(progressPct)) &&
    Number(progressPct) >= 0 &&
    Number(progressPct) <= 100;
  const isReportSubmitDisabled =
    (!isExpenditureValid && !isProgressValid) || isSubmittingReport;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs transition-opacity"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-auto max-h-[85vh] overflow-y-auto p-4 sm:p-6 relative border border-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 1. Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 pb-4 border-b border-slate-100">
          <div className="flex items-start justify-between gap-2 w-full sm:w-auto flex-1 min-w-0">
            <div className="flex-1 min-w-0 pr-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 leading-tight">
                  {project.name}
                </h2>
                {renderStatusBadge(effectiveStatus)}
              </div>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                {[project.sector, project.ministry, project.state]
                  .filter(Boolean)
                  .join(' • ')}
              </p>
            </div>
            {/* Close button on mobile: placed at top-right of modal header */}
            <button
              type="button"
              onClick={onClose}
              className="sm:hidden text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              aria-label="Close modal"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap sm:flex-nowrap shrink-0">
            {/* Mark Finished vs Terminate — admin only, not already Completed or Terminated */}
            {userRole === 'admin' && effectiveStatus !== 'Completed' && effectiveStatus !== 'Terminated' && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => handleUpdateStatus('Completed')}
                  disabled={isUpdatingStatus}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 sm:px-3 py-1.5 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  title="Mark this project as Completed"
                >
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Mark Completed</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateStatus('Terminated')}
                  disabled={isUpdatingStatus}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 sm:px-3 py-1.5 text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-300 hover:bg-rose-100 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                  title="Terminate / Cancel this project"
                >
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  <span>Terminate Project</span>
                </button>
              </div>
            )}
            {/* Show completed / terminated badge */}
            {effectiveStatus === 'Completed' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                Marked Completed
              </span>
            )}
            {effectiveStatus === 'Terminated' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                Project Terminated
              </span>
            )}

            {/* Follow button — login prompt for guests, toggle for logged-in public */}
            {userRole === 'public' && authToken ? (
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
            ) : !authToken ? (
              <button
                type="button"
                onClick={onLoginRequest}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-300 hover:border-brand-amber hover:text-slate-900 transition-colors cursor-pointer"
                title="Log in to follow this project"
              >
                <Bell className="w-4 h-4 text-slate-400" />
                <span>Follow</span>
              </button>
            ) : null}
            {/* Close button on desktop */}
            <button
              type="button"
              onClick={onClose}
              className="hidden sm:inline-flex text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
              aria-label="Close modal"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Status update error banner */}
        {statusUpdateError && (
          <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {statusUpdateError}
          </div>
        )}

        {/* Assignment Badges (shown if assigned) */}
        {(assignedOfficer || assignedContractor || project.assigned_officer || project.assigned_contractor) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(assignedOfficer || project.assigned_officer) && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-800 border border-blue-200">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
                Assigned Officer: <strong className="font-semibold">{assignedOfficer || project.assigned_officer}</strong>
              </span>
            )}
            {(assignedContractor || project.assigned_contractor) && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                Assigned Contractor: <strong className="font-semibold">{assignedContractor || project.assigned_contractor}</strong>
              </span>
            )}
          </div>
        )}

        {/* Contractor Delay Flagged Badge (visible to all when flagged) */}
        {(project.is_delayed_by_contractor || localDelayFlagged) && (
          <div className="mt-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-300">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Delayed (flagged by contractor)
            </span>
          </div>
        )}

        {/* Admin Project Assignment Controls */}
        {userRole === 'admin' && (
          <div className="mt-4 bg-slate-50 border border-slate-200/80 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Project Personnel Assignment
                </h4>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {effectiveStatus === 'Completed' || effectiveStatus === 'Terminated'
                    ? 'Personnel assignment is closed for completed and terminated projects.'
                    : 'Assign an available field officer and/or verified contractor to this project'}
                </p>
              </div>
            </div>

            {effectiveStatus === 'Completed' || effectiveStatus === 'Terminated' ? (
              <div className="text-xs text-slate-500 italic bg-white p-3 rounded-lg border border-slate-200">
                This project is {effectiveStatus.toLowerCase()}. Assigned personnel are automatically released and eligible for new project assignments.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Officer Dropdown */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Assign Field Officer
                    </label>
                    <select
                      value={assignedOfficer}
                      onChange={(e) => setAssignedOfficer(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-amber/50 focus:border-brand-amber transition-colors"
                    >
                      <option value="">-- None / Unassigned --</option>
                      {assignableUsers.officers.map((u) => (
                        <option key={u.username} value={u.username}>
                          {u.username} {u.full_name && u.full_name !== u.username ? `(${u.full_name})` : ''}
                        </option>
                      ))}
                      {assignedOfficer && !assignableUsers.officers.some((u) => u.username === assignedOfficer) && (
                        <option value={assignedOfficer}>{assignedOfficer} (Current)</option>
                      )}
                    </select>
                  </div>

                  {/* Contractor Dropdown */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Assign Contractor
                    </label>
                    <select
                      value={assignedContractor}
                      onChange={(e) => setAssignedContractor(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-amber/50 focus:border-brand-amber transition-colors"
                    >
                      <option value="">-- None / Unassigned --</option>
                      {assignableUsers.contractors.map((u) => (
                        <option key={u.username} value={u.username}>
                          {u.username} {u.full_name && u.full_name !== u.username ? `(${u.full_name})` : ''}
                        </option>
                      ))}
                      {assignedContractor && !assignableUsers.contractors.some((u) => u.username === assignedContractor) && (
                        <option value={assignedContractor}>{assignedContractor} (Current)</option>
                      )}
                    </select>
                  </div>
                </div>

                {assignError && (
                  <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
                    {assignError}
                  </div>
                )}
                {assignSuccess && (
                  <div className="mt-3 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2 font-medium">
                    ✓ Project assignment updated successfully!
                  </div>
                )}

                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={handleSaveAssignment}
                    disabled={isAssigning}
                    className="inline-flex items-center gap-1.5 bg-[#16213E] hover:bg-[#1f2d54] text-white text-xs font-medium py-1.5 px-3.5 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {isAssigning ? 'Saving…' : 'Save Assignment'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

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
        {effectiveProgress != null && (
          <div className="mt-5 bg-slate-50 rounded-xl p-3.5 border border-slate-200/70">
            <div className="flex justify-between items-center text-xs font-semibold text-slate-700 mb-2">
              <span>Physical Progress</span>
              <span className="text-brand-ink text-sm font-bold">
                {effectiveProgress}%
              </span>
            </div>
            <div className="w-full bg-slate-200/70 h-3 rounded-full overflow-hidden">
              <div
                className="bg-brand-ink h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(0, effectiveProgress))}%`,
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

        {/* 5b. Contractor "Flag as Delayed" Action */}
        {userRole === 'contractor' && (
          <div className="mt-5 border-t border-slate-100 pt-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Contractor Action
              </h3>
            </div>

            {/* Already flagged banner */}
            {(project.is_delayed_by_contractor || localDelayFlagged) ? (
              <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
                <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <div className="text-sm font-semibold text-red-800">Delay Flagged</div>
                  {project.contractor_delay_reason && (
                    <p className="text-xs text-red-700 mt-0.5">{project.contractor_delay_reason}</p>
                  )}
                  {project.contractor_delay_timestamp && (
                    <p className="text-[11px] text-red-500 mt-1">
                      Submitted: {new Date(project.contractor_delay_timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <>
                {!showDelayFlagForm ? (
                  <button
                    type="button"
                    onClick={() => setShowDelayFlagForm(true)}
                    className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors cursor-pointer"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    Flag as Delayed
                  </button>
                ) : (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                    <h4 className="text-sm font-semibold text-red-800">Flag Project as Delayed</h4>
                    <p className="text-xs text-red-700">
                      This will notify the administrator that your project is experiencing a delay. You may optionally describe the reason.
                    </p>
                    <textarea
                      rows={3}
                      className="w-full bg-white border border-red-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-red-400/50 focus:border-red-400 transition-colors resize-none"
                      placeholder="Optional: briefly describe the delay reason (e.g. material supply delay, weather, site access issue)"
                      value={delayFlagNote}
                      onChange={(e) => setDelayFlagNote(e.target.value)}
                    />
                    {delayFlagError && (
                      <div className="text-xs text-red-700 bg-red-100 border border-red-200 rounded-lg p-2">
                        {delayFlagError}
                      </div>
                    )}
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        type="button"
                        onClick={() => { setShowDelayFlagForm(false); setDelayFlagNote(''); setDelayFlagError(null); }}
                        className="px-3.5 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleFlagDelay}
                        disabled={isFlaggingDelay}
                        className="px-4 py-1.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isFlaggingDelay ? 'Submitting…' : 'Confirm Flag'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
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

          {/* Submit Field Report Form (field_officer only) */}
          {canSubmitReport && (
            <div className="mb-5 bg-slate-50 border border-slate-200/80 rounded-xl p-4">
              <div className="mb-3">
                <h4 className="text-sm font-semibold text-slate-700">
                  Submit Field Report
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Reports are submitted in "Pending Confirmation" status awaiting contractor verification
                </p>
              </div>

              <form onSubmit={handleReportSubmit} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Expenditure Update */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Expenditure Spent This Period (₹ Cr)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      value={expenditureUpdate}
                      onChange={(e) => setExpenditureUpdate(e.target.value)}
                      placeholder="e.g. 24.50"
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-amber/50 focus:border-brand-amber transition-colors"
                    />
                  </div>

                  {/* Physical Progress Update */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Physical Progress Update (%)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      max="100"
                      value={progressPct}
                      onChange={(e) => setProgressPct(e.target.value)}
                      placeholder="e.g. 62.5"
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-amber/50 focus:border-brand-amber transition-colors"
                    />
                  </div>
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
                    <span>Report submitted (Pending Contractor Confirmation)</span>
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

          {/* Action alerts for contractor confirmation/rejection */}
          {reportActionSuccess && (
            <div className="mb-4 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3 font-medium flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{reportActionSuccess}</span>
            </div>
          )}
          {reportActionError && (
            <div className="mb-4 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">
              {reportActionError}
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
              {reports.map((report, idx) => {
                const repId = report.id || report.report_id || idx;
                const isPending = report.status === 'pending_confirmation';
                const isConfirmed = report.status === 'confirmed';
                const isRejected = report.status === 'rejected';

                return (
                  <div
                    key={repId}
                    className={`rounded-xl p-3.5 border text-xs transition-colors ${
                      isPending
                        ? 'bg-amber-50/40 border-amber-200'
                        : isRejected
                        ? 'bg-rose-50/30 border-rose-200'
                        : 'bg-slate-50 border-slate-200/70'
                    }`}
                  >
                    <div className="flex items-center justify-between text-slate-500 mb-2 flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-800">
                          Filed by: {report.submitted_by || 'Field Officer'}
                        </span>
                        {/* Status Badge */}
                        {isPending && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                            ⏳ Pending Confirmation
                          </span>
                        )}
                        {isConfirmed && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                            ✓ Confirmed
                          </span>
                        )}
                        {isRejected && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800 border border-rose-300">
                            ✕ Rejected
                          </span>
                        )}
                      </div>
                      <span>{formatReportDate(report.timestamp)}</span>
                    </div>

                    {report.expenditure_update_cr != null && (
                      <div className="mb-1.5 text-slate-700">
                        <strong className="text-slate-900">Expenditure Update:</strong>{' '}
                        ₹{formatCost(report.expenditure_update_cr)} Cr
                      </div>
                    )}

                    {report.progress_pct != null && (
                      <div className="mb-1.5 text-slate-700">
                        <strong className="text-slate-900">Physical Progress Update:</strong>{' '}
                        {report.progress_pct}%
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

                    {/* Confirmation metadata */}
                    {isConfirmed && (report.confirmed_by || report.confirmed_at) && (
                      <div className="mt-2 text-[11px] text-emerald-700 bg-emerald-50/70 p-2 rounded border border-emerald-100">
                        Confirmed by <strong className="font-semibold">{report.confirmed_by || 'Contractor'}</strong>
                        {report.confirmed_at ? ` on ${formatReportDate(report.confirmed_at)}` : ''}
                      </div>
                    )}

                    {/* Rejection callout with reason */}
                    {isRejected && (
                      <div className="mt-2 p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs">
                        <div className="font-semibold text-rose-800">
                          Rejection Reason: <span className="font-normal text-rose-700">{report.rejection_reason || 'Discrepancy noted.'}</span>
                        </div>
                        {report.rejected_at && (
                          <div className="text-[10px] text-rose-500 mt-0.5">
                            Rejected on {formatReportDate(report.rejected_at)}
                          </div>
                        )}
                        {userRole === 'field_officer' && (
                          <div className="text-[11px] text-rose-600 mt-1.5 font-medium">
                            Please review the feedback above and submit a revised report using the submission form above.
                          </div>
                        )}
                      </div>
                    )}

                    {/* Contractor Action: Confirm / Reject Pending Report */}
                    {userRole === 'contractor' && isPending && (
                      <div className="mt-3 pt-3 border-t border-amber-200/80 bg-amber-50/60 p-3 rounded-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-amber-900">
                            Contractor Verification Required
                          </span>
                          <span className="text-[11px] text-amber-700">
                            Confirming applies these figures to project records
                          </span>
                        </div>

                        {rejectingReportId === repId ? (
                          <div className="space-y-2 mt-2">
                            <label className="block text-xs font-medium text-rose-800">
                              Rejection Reason (required):
                            </label>
                            <input
                              type="text"
                              value={rejectReason}
                              onChange={(e) => setRejectReason(e.target.value)}
                              placeholder="e.g. Expenditure numbers do not match subcontractor bills, or site progress is disputed"
                              className="w-full bg-white border border-rose-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-400"
                            />
                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setRejectingReportId(null);
                                  setRejectReason('');
                                  setReportActionError(null);
                                }}
                                className="px-3 py-1 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                disabled={!rejectReason.trim() || confirmingReportId === repId}
                                onClick={() => handleRejectReport(repId)}
                                className="px-3 py-1 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {confirmingReportId === repId ? 'Rejecting…' : 'Confirm Rejection'}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              type="button"
                              disabled={confirmingReportId === repId}
                              onClick={() => handleConfirmReport(repId)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>{confirmingReportId === repId ? 'Confirming…' : 'Confirm Report'}</span>
                            </button>
                            <button
                              type="button"
                              disabled={confirmingReportId === repId}
                              onClick={() => {
                                setRejectingReportId(repId);
                                setRejectReason('');
                                setReportActionError(null);
                              }}
                              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-rose-700 bg-white hover:bg-rose-50 border border-rose-300 rounded-lg transition-colors cursor-pointer"
                            >
                              <span>Reject Report</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
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

          {/* Compact Submission Form — login prompt for guests, form for authenticated */}
          {!authToken ? (
            <div className="mt-4 bg-slate-50 border border-slate-200/80 rounded-xl p-4 flex flex-col items-center gap-3 text-center">
              <Bell className="w-5 h-5 text-slate-400" />
              <p className="text-xs text-slate-600 font-medium">
                Please log in to share feedback on this project.
              </p>
              <button
                type="button"
                onClick={onLoginRequest}
                className="bg-[#16213E] text-white rounded-lg px-4 py-2 text-xs font-semibold hover:bg-[#1e2f5a] transition-colors cursor-pointer"
              >
                Log In to Submit Feedback
              </button>
            </div>
          ) : (
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
          )}
        </div>
      </div>
    </div>
  );
}
