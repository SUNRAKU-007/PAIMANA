import { useState, useEffect, useMemo } from 'react';
import { PlusCircle, X } from 'lucide-react';
import IndiaProjectModal from './IndiaProjectModal';
import { API_BASE_URL } from '../api';

const STATUS_TABS = ['All', 'Ongoing', 'Completed', 'Terminated', 'Newly Added'];

const SECTOR_OPTIONS = [
  'Railways', 'Urban Public Transport', 'Oil & Gas', 'Water Resources',
  'Telecommunication', 'Roads & Highways', 'Coal', 'Electricity Generation',
  'Transmission & Distribution', 'Waste & Water', 'Healthcare',
  'Real Estate', 'Other',
];

const VALID_STATUSES = ['Newly Added', 'Ongoing', 'Completed', 'Terminated'];

// ── Add Project Modal ─────────────────────────────────────────────────────────
function AddProjectModal({ authFetch, onSuccess, onClose }) {
  const [form, setForm] = useState({
    name: '', sector: '', ministry: '', state: '',
    status: 'Newly Added',
    original_cost_cr: '', expenditure_cr: '',
    start_date: '', target_doc: '', approval_date: '',
    delay_note: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Project name is required.'); return; }
    setSubmitting(true);
    setError(null);

    const payload = { name: form.name.trim() };
    if (form.sector)          payload.sector          = form.sector;
    if (form.ministry)        payload.ministry        = form.ministry.trim();
    if (form.state)           payload.state           = form.state.trim();
    if (form.status)          payload.status          = form.status;
    if (form.original_cost_cr !== '')  payload.original_cost_cr  = Number(form.original_cost_cr);
    if (form.expenditure_cr !== '')    payload.expenditure_cr    = Number(form.expenditure_cr);
    if (form.start_date)      payload.start_date      = form.start_date.trim();
    if (form.target_doc)      payload.target_doc      = form.target_doc.trim();
    if (form.approval_date)   payload.approval_date   = form.approval_date.trim();
    if (form.delay_note)      payload.delay_note      = form.delay_note.trim();

    try {
      const url = `${API_BASE_URL}/india/projects`;
      let result;
      if (authFetch && typeof authFetch.post === 'function') {
        const res = await authFetch.post(url, payload);
        result = res?.data !== undefined ? res.data : res;
      } else {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Request failed'); }
        result = await res.json();
      }
      onSuccess(result);
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Failed to create project.');
    } finally {
      setSubmitting(false);
    }
  };

  const fieldCls = 'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-amber/50 focus:border-brand-amber transition-colors';
  const labelCls = 'block text-xs font-medium text-slate-700 mb-1';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 border border-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Add New Project</h2>
            <p className="text-xs text-slate-500 mt-0.5">Admin only — will be saved to the project dataset</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Name */}
          <div>
            <label className={labelCls}>Project Name <span className="text-red-500">*</span></label>
            <input className={fieldCls} value={form.name} onChange={set('name')} placeholder="e.g. Delhi-Meerut RRTS" required />
          </div>

          {/* Sector + Status */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Sector</label>
              <select className={fieldCls} value={form.sector} onChange={set('sector')}>
                <option value="">— Select —</option>
                {SECTOR_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select className={fieldCls} value={form.status} onChange={set('status')}>
                {VALID_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Ministry + State */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Ministry / Department</label>
              <input className={fieldCls} value={form.ministry} onChange={set('ministry')} placeholder="e.g. Ministry of Railways" />
            </div>
            <div>
              <label className={labelCls}>State / Region</label>
              <input className={fieldCls} value={form.state} onChange={set('state')} placeholder="e.g. Uttar Pradesh" />
            </div>
          </div>

          {/* Cost fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Original Cost (₹ Cr)</label>
              <input type="number" step="any" min="0" className={fieldCls} value={form.original_cost_cr} onChange={set('original_cost_cr')} placeholder="e.g. 45000" />
            </div>
            <div>
              <label className={labelCls}>Expenditure So Far (₹ Cr)</label>
              <input type="number" step="any" min="0" className={fieldCls} value={form.expenditure_cr} onChange={set('expenditure_cr')} placeholder="e.g. 12000" />
            </div>
          </div>

          {/* Date fields */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Approval Date</label>
              <input className={fieldCls} value={form.approval_date} onChange={set('approval_date')} placeholder="MM/YYYY" />
            </div>
            <div>
              <label className={labelCls}>Start Date</label>
              <input className={fieldCls} value={form.start_date} onChange={set('start_date')} placeholder="MM/YYYY" />
            </div>
            <div>
              <label className={labelCls}>Target Completion</label>
              <input className={fieldCls} value={form.target_doc} onChange={set('target_doc')} placeholder="MM/YYYY" />
            </div>
          </div>

          {/* Delay note */}
          <div>
            <label className={labelCls}>Delay Note (optional)</label>
            <textarea rows={2} className={fieldCls + ' resize-none'} value={form.delay_note} onChange={set('delay_note')} placeholder="Any known delays or issues..." />
          </div>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2.5">{error}</div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer">Cancel</button>
            <button type="submit" disabled={submitting} className="px-5 py-2 text-sm font-semibold text-white bg-[#16213E] rounded-lg hover:bg-[#1e2f5a] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
              {submitting ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const formatCost = (value) => {
  if (value == null || value === '') return '—';
  const num = Number(value);
  return isNaN(num) ? value : num.toLocaleString('en-IN');
};

export default function IndiaProjectsView({
  authFetch,
  userRole,
  authToken,
  onLoginRequest,
  selectedProject: controlledSelectedProject,
  onSelectProject,
}) {
  const [activeTab, setActiveTab] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [internalSelectedProject, setInternalSelectedProject] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const isAssignedRole = userRole === 'field_officer' || userRole === 'contractor';

  const selectedProject =
    controlledSelectedProject !== undefined
      ? controlledSelectedProject
      : internalSelectedProject;
  const setSelectedProject = onSelectProject || setInternalSelectedProject;

  const modalProject = useMemo(() => {
    if (!selectedProject) return null;
    if (selectedProject.sector && selectedProject.original_cost_cr !== undefined) {
      return selectedProject;
    }
    const match = projects.find(
      (p) => String(p.project_id) === String(selectedProject.project_id)
    );
    return match || selectedProject;
  }, [selectedProject, projects]);

  // Debounce search input by 400ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Fetch projects on mount and when filters change
  useEffect(() => {
    let isCancelled = false;
    setLoading(true);
    setError(null);

    const isAssignedRole = userRole === 'field_officer' || userRole === 'contractor';

    let fetchPromise;
    if (isAssignedRole) {
      const url = `${API_BASE_URL}/india/me/assigned-project`;
      fetchPromise = authFetch && typeof authFetch.get === 'function'
        ? authFetch.get(url)
        : fetch(url, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} }).then((r) => r.json());
    } else {
      const params = {};
      if (activeTab !== 'All') {
        params.status = activeTab;
      }
      if (debouncedSearch.trim()) {
        params.search = debouncedSearch.trim();
      }

      fetchPromise = authFetch && typeof authFetch.get === 'function'
        ? authFetch.get(`${API_BASE_URL}/india/projects`, { params })
        : fetch(`${API_BASE_URL}/india/projects?${new URLSearchParams(params)}`).then((r) => r.json());
    }

    fetchPromise
      .then((res) => {
        if (!isCancelled) {
          const data = res?.data !== undefined ? res.data : res;
          setProjects(Array.isArray(data) ? data : []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.error('Failed to load India projects:', err);
          setError('Could not load Indian infrastructure projects.');
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [activeTab, debouncedSearch, authFetch, userRole, authToken]);

  const renderStatusBadge = (status) => {
    switch (status) {
      case 'Completed':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
            Completed
          </span>
        );
      case 'Terminated':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200 shrink-0">
            Terminated
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
    <div className="w-full">
      {/* Add Project Modal */}
      {showAddModal && (
        <AddProjectModal
          authFetch={authFetch}
          onSuccess={(newProject) => {
            setProjects((prev) => [newProject, ...prev]);
            setShowAddModal(false);
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* Role-Specific Header / Standard Filters Bar */}
      {isAssignedRole ? (
        <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-800">
                {userRole === 'field_officer' ? 'My Assigned Project' : 'My Assigned Project Contract'}
              </h2>
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 uppercase tracking-wider">
                {userRole === 'field_officer' ? 'Field Officer View' : 'Contractor View'}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {userRole === 'field_officer'
                ? 'Only projects assigned to you for weekly progress reporting are visible.'
                : 'Only the project assigned to your contractor account is visible.'}
            </p>
          </div>
          <div className="text-xs text-slate-500 font-medium">
            {loading ? 'Checking assignment...' : `${projects.length} assigned project${projects.length === 1 ? '' : 's'}`}
          </div>
        </div>
      ) : (
        /* Filters Bar: Status Tabs & Search Box */
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 mb-5">
          {/* Status Tabs (Pill / Segmented control) */}
          <div className="flex flex-wrap gap-2 items-center">
            {STATUS_TABS.map((tab) => {
              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-full border px-4 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-brand-ink text-white border-brand-ink shadow-sm'
                      : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {tab}
                </button>
              );
            })}
          </div>

          {/* Right side: Search + Add button */}
          <div className="flex items-center gap-2">
            {/* Add Project button — admin only */}
            {userRole === 'admin' && authToken && (
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-white bg-[#16213E] hover:bg-[#1e2f5a] px-3.5 py-2 rounded-lg transition-colors cursor-pointer shrink-0"
              >
                <PlusCircle size={14} />
                Add Project
              </button>
            )}

            {/* Search Box */}
            <div className="relative w-full sm:w-72">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search project name..."
                className="w-full pl-9 pr-8 py-1.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-amber/50 focus:border-brand-amber transition-colors shadow-sm"
              />
              <svg className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchTerm && (
                <button type="button" onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer text-xs" title="Clear search">✕</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Result Count (Only for public / admin browse list) */}
      {!isAssignedRole && (
        <div className="text-sm font-medium text-slate-500 mb-4">
          {loading ? 'Loading projects...' : `${projects.length} projects`}
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-4 mb-6">
          {error}
        </div>
      )}

      {/* Loading State: 6 Skeleton Cards */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="bg-white rounded-xl shadow-sm p-5 border border-slate-100 animate-pulse flex flex-col justify-between h-48"
            >
              <div>
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div className="h-4 bg-slate-200 rounded w-3/4"></div>
                  <div className="h-5 bg-slate-200 rounded-full w-16"></div>
                </div>
                <div className="h-3 bg-slate-200 rounded w-1/2 mb-4"></div>
              </div>
              <div className="space-y-2">
                <div className="h-4 bg-slate-200 rounded w-24"></div>
                <div className="h-2 bg-slate-100 rounded-full w-full"></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && projects.length === 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-10 text-center max-w-lg mx-auto my-6">
          <div className="w-14 h-14 rounded-full bg-amber-50 border border-amber-200 text-brand-amber flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-slate-800 mb-2">
            {userRole === 'field_officer'
              ? 'No Project Assigned Yet'
              : userRole === 'contractor'
              ? "You haven't been assigned to a project yet"
              : 'No projects match your search'}
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            {userRole === 'field_officer'
              ? "You haven't been assigned to an infrastructure project yet. An administrator will assign you to a project to submit weekly field reports."
              : userRole === 'contractor'
              ? 'Your contractor account has been approved by an administrator, but has not yet been assigned to a specific project.'
              : 'Try clearing your search query or switching status filters.'}
          </p>
        </div>
      )}

      {/* Card Grid */}
      {!loading && projects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => {
            const origCost = project.original_cost_cr;
            const revCost = project.revised_cost_cr;
            const hasCostEscalation =
              revCost != null &&
              origCost != null &&
              Number(revCost) !== Number(origCost);

            return (
              <div
                key={project.project_id || project.name}
                onClick={() => setSelectedProject(project)}
                className="bg-white rounded-xl shadow-sm p-5 border border-slate-100 hover:shadow-md hover:border-slate-200 transition-all flex flex-col justify-between cursor-pointer"
              >
                <div>
                  {/* Header: Title & Status Badge */}
                  <div className="flex justify-between items-start gap-3">
                    <h3
                      className="font-semibold text-base line-clamp-2 text-slate-900 group-hover:text-brand-ink transition-colors"
                      title={project.name}
                    >
                      {project.name}
                    </h3>
                    {renderStatusBadge(project.status)}
                  </div>

                  {/* Sector & State Subtext */}
                  <p className="text-xs text-slate-500 mt-1 mb-4">
                    {[project.sector, project.state].filter(Boolean).join(' • ')}
                  </p>
                </div>

                <div>
                  {/* Cost Section */}
                  <div className="text-sm">
                    {hasCostEscalation ? (
                      <div>
                        <span className="line-through text-slate-400 font-normal mr-2">
                          ₹{formatCost(origCost)} Cr
                        </span>
                        <span className="font-bold text-red-600">
                          ₹{formatCost(revCost)} Cr
                        </span>
                      </div>
                    ) : (
                      <span className="font-bold text-slate-900">
                        {origCost != null ? `₹${formatCost(origCost)} Cr` : '—'}
                      </span>
                    )}
                  </div>

                  {/* Physical Progress Bar (only for Ongoing when present) */}
                  {project.status === 'Ongoing' && project.physical_progress_pct != null && (
                    <div className="mt-3">
                      <div className="flex justify-between items-center text-xs text-slate-600 mb-1 font-medium">
                        <span>Progress</span>
                        <span>{project.physical_progress_pct}%</span>
                      </div>
                      <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                        <div
                          className="bg-brand-ink h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.min(100, Math.max(0, project.physical_progress_pct))}%`,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Delay Note Callout */}
                  {project.delay_note && (
                    <div className="mt-3 bg-red-50 text-red-700 text-xs rounded p-2 border border-red-100">
                      {project.delay_note}
                    </div>
                  )}

                  {/* Assigned role indicator badges */}
                  {(project.assigned_officer || project.assigned_contractor) && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 pt-2.5 border-t border-slate-100">
                      {project.assigned_officer && (
                        <span className="text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium border border-blue-200">
                          Officer: {project.assigned_officer}
                        </span>
                      )}
                      {project.assigned_contractor && (
                        <span className="text-[10px] bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded font-medium border border-emerald-200">
                          Contractor: {project.assigned_contractor}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Modal */}
      <IndiaProjectModal
        project={modalProject}
        authFetch={authFetch}
        userRole={userRole}
        authToken={authToken}
        onLoginRequest={onLoginRequest}
        onClose={() => setSelectedProject(null)}
      />
    </div>
  );
}
