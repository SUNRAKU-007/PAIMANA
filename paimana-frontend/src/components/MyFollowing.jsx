import { useState, useEffect, useMemo } from 'react';
import { Bookmark, BookmarkCheck, AlertTriangle } from 'lucide-react';
import IndiaProjectModal from './IndiaProjectModal';

const formatCost = (value) => {
  if (value == null || value === '') return '—';
  const num = Number(value);
  return isNaN(num) ? value : num.toLocaleString('en-IN');
};

export default function MyFollowing({
  authFetch,
  userRole,
  userName,
  selectedProject: controlledSelectedProject,
  onProjectClick,
  onBrowseClick,
}) {
  const [followedProjects, setFollowedProjects] = useState([]);
  const [allProjects, setAllProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [unfollowingId, setUnfollowingId] = useState(null);
  const [internalSelectedProject, setInternalSelectedProject] = useState(null);

  const selectedProject =
    controlledSelectedProject !== undefined
      ? controlledSelectedProject
      : internalSelectedProject;
  const setSelectedProject = onProjectClick || setInternalSelectedProject;

  const modalProject = useMemo(() => {
    if (!selectedProject) return null;
    if (selectedProject.sector && selectedProject.original_cost_cr !== undefined) {
      return selectedProject;
    }
    const match = allProjects.find(
      (p) => String(p.project_id) === String(selectedProject.project_id)
    );
    return match || selectedProject;
  }, [selectedProject, allProjects]);

  const loadFollowing = () => {
    setLoading(true);
    setError(null);

    const followingUrl = 'http://127.0.0.1:8000/india/me/following';
    const projectsUrl = 'http://127.0.0.1:8000/india/projects';

    const fetchFollowing =
      authFetch && typeof authFetch.get === 'function'
        ? authFetch.get(followingUrl)
        : fetch(followingUrl).then((r) => r.json());

    const fetchProjects =
      authFetch && typeof authFetch.get === 'function'
        ? authFetch.get(projectsUrl)
        : fetch(projectsUrl).then((r) => r.json());

    Promise.all([fetchFollowing, fetchProjects])
      .then(([followingRes, projectsRes]) => {
        const followingData =
          followingRes?.data !== undefined ? followingRes.data : followingRes;
        const projectsData =
          projectsRes?.data !== undefined ? projectsRes.data : projectsRes;

        const followingList = Array.isArray(followingData) ? followingData : [];
        const fullProjects = Array.isArray(projectsData) ? projectsData : [];
        setAllProjects(fullProjects);

        const projectMap = new Map(
          fullProjects.map((p) => [String(p.project_id), p])
        );

        const merged = followingList.map((fItem) => {
          const pid = String(fItem.project_id);
          const details = projectMap.get(pid);
          if (details) {
            return { ...details, name: details.name || fItem.name };
          }
          return {
            project_id: pid,
            name: fItem.name || `Project #${pid}`,
            status: 'Ongoing',
            is_flagged: false,
            risk_reasons: [],
          };
        });

        setFollowedProjects(merged);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load followed projects:', err);
        setError('Could not load your followed projects. Please try again.');
        setLoading(false);
      });
  };

  useEffect(() => {
    loadFollowing();
  }, [authFetch]);

  // Unfollow action
  const handleUnfollow = async (e, projectId) => {
    e.stopPropagation();
    const pidStr = String(projectId);
    setUnfollowingId(pidStr);

    const url = `http://127.0.0.1:8000/india/projects/${pidStr}/follow`;
    try {
      if (authFetch && typeof authFetch.post === 'function') {
        await authFetch.post(url);
      } else {
        await fetch(url, { method: 'POST' });
      }

      // Remove from list and update count
      setFollowedProjects((prev) =>
        prev.filter((p) => String(p.project_id) !== pidStr)
      );
    } catch (err) {
      console.error('Failed to unfollow project:', err);
    } finally {
      setUnfollowingId(null);
    }
  };

  // Status badge styling matching IndiaProjectsView
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
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
          Following ({followedProjects.length})
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {userName || 'Citizen'} •{' '}
          <span className="capitalize">{userRole || 'public'}</span>
        </p>
      </div>

      {/* ── Error state ─────────────────────────────────────────────────── */}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-4 mb-6">
          {error}
        </div>
      )}

      {/* ── Loading skeletons ────────────────────────────────────────────── */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div
              key={idx}
              className="bg-white rounded-xl shadow-sm p-5 border border-slate-100 animate-pulse flex flex-col justify-between h-56"
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
                <div className="h-8 bg-slate-100 rounded-lg w-full"></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Empty State ──────────────────────────────────────────────────── */}
      {!loading && !error && followedProjects.length === 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/80 p-12 text-center max-w-lg mx-auto mt-6">
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-amber-50 flex items-center justify-center text-brand-amber border border-amber-100">
            <Bookmark size={24} />
          </div>
          <h3 className="text-base font-semibold text-slate-800 mb-1.5">
            No followed projects yet
          </h3>
          <p className="text-slate-500 text-sm leading-relaxed mb-6">
            You're not following any projects yet. Browse projects and tap Follow
            to track updates here.
          </p>
          {onBrowseClick && (
            <button
              type="button"
              onClick={onBrowseClick}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-ink hover:bg-brand-ink-light text-white text-xs font-semibold transition-colors cursor-pointer shadow-sm"
            >
              Browse Indian Projects
            </button>
          )}
        </div>
      )}

      {/* ── Cards Grid ───────────────────────────────────────────────────── */}
      {!loading && followedProjects.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {followedProjects.map((project) => {
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
                className="bg-white rounded-xl shadow-sm p-5 border border-slate-100 hover:shadow-md hover:border-slate-200 transition-all flex flex-col justify-between cursor-pointer group"
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
                  <p className="text-xs text-slate-500 mt-1 mb-3">
                    {[project.sector, project.state].filter(Boolean).join(' • ') ||
                      'Infrastructure Project'}
                  </p>

                  {/* Cost Section */}
                  <div className="text-sm">
                    {hasCostEscalation ? (
                      <div>
                        <span className="line-through text-slate-400 font-normal mr-2 text-xs">
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

                  {/* Physical Progress Bar (Ongoing only) */}
                  {project.status === 'Ongoing' &&
                    project.physical_progress_pct != null && (
                      <div className="mt-3">
                        <div className="flex justify-between items-center text-xs text-slate-600 mb-1 font-medium">
                          <span>Progress</span>
                          <span>{project.physical_progress_pct}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-brand-ink h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.min(
                                100,
                                Math.max(0, project.physical_progress_pct)
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    )}

                  {/* Risk Reasons Callout (Red-tinted) */}
                  {project.is_flagged && (
                    <div className="mt-3 bg-red-50 border border-red-200/80 rounded-lg p-2.5 text-xs text-red-800">
                      <div className="flex items-center gap-1.5 font-semibold text-red-900 mb-1">
                        <AlertTriangle size={13} className="shrink-0 text-red-600" />
                        <span>Flagged Risk Review</span>
                      </div>
                      {project.risk_reasons && project.risk_reasons.length > 0 ? (
                        <ul className="list-disc list-inside space-y-0.5 text-red-700">
                          {project.risk_reasons.map((reason, rIdx) => (
                            <li key={rIdx} className="line-clamp-2">
                              {reason}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-red-700">Currently flagged for risk review.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Card Footer: Unfollow Button */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">
                    Click to view full details
                  </span>
                  <button
                    type="button"
                    onClick={(e) => handleUnfollow(e, project.project_id)}
                    disabled={unfollowingId === String(project.project_id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <BookmarkCheck size={13} className="text-brand-ink" />
                    {unfollowingId === String(project.project_id)
                      ? 'Unfollowing…'
                      : 'Unfollow'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Detail Modal ─────────────────────────────────────────────────── */}
      <IndiaProjectModal
        project={modalProject}
        authFetch={authFetch}
        userRole={userRole}
        onClose={() => {
          setSelectedProject(null);
          // Refresh list in case user toggled follow state inside modal
          loadFollowing();
        }}
      />
    </div>
  );
}
