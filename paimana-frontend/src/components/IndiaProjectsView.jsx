import { useState, useEffect, useMemo } from 'react';
import IndiaProjectModal from './IndiaProjectModal';

const STATUS_TABS = ['All', 'Ongoing', 'Completed', 'Newly Added'];

const formatCost = (value) => {
  if (value == null || value === '') return '—';
  const num = Number(value);
  return isNaN(num) ? value : num.toLocaleString('en-IN');
};

export default function IndiaProjectsView({
  authFetch,
  userRole,
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

    const params = {};
    if (activeTab !== 'All') {
      params.status = activeTab;
    }
    if (debouncedSearch.trim()) {
      params.search = debouncedSearch.trim();
    }

    const fetchPromise = authFetch && typeof authFetch.get === 'function'
      ? authFetch.get('http://127.0.0.1:8000/india/projects', { params })
      : fetch(`http://127.0.0.1:8000/india/projects?${new URLSearchParams(params)}`).then((r) => r.json());

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
  }, [activeTab, debouncedSearch, authFetch]);

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
    <div className="w-full">
      {/* Filters Bar: Status Tabs & Search Box */}
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

        {/* Search Box */}
        <div className="relative w-full sm:w-72">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search project name..."
            className="w-full pl-9 pr-8 py-1.5 text-sm bg-white border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-amber/50 focus:border-brand-amber transition-colors shadow-sm"
          />
          <svg
            className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer text-xs"
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Result Count */}
      <div className="text-sm font-medium text-slate-500 mb-4">
        {loading ? 'Loading projects...' : `${projects.length} projects`}
      </div>

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
        <div className="bg-white rounded-xl shadow-sm border border-slate-200/80 p-12 text-center">
          <p className="text-slate-500 font-medium text-base">
            No projects match your search
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
        onClose={() => setSelectedProject(null)}
      />
    </div>
  );
}
