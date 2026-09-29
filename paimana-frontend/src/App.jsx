import { useState, useEffect } from 'react'
import { Building2, FlaskConical, Menu, Bookmark, LogIn, UserCheck, Clock, RefreshCw } from 'lucide-react'
import api, { setOnUnauthorizedCallback, API_BASE_URL } from './api'
import Login from './components/Login'
import KpiCards from './components/KpiCards'
import ChartsPanel from './components/ChartsPanel'
import AlertsPanel from './components/AlertsPanel'
import ProjectsTable from './components/ProjectsTable'
import ProjectDetail from './components/ProjectDetail'
import AssistantChat from './components/AssistantChat'
import IndiaProjectsView from './components/IndiaProjectsView'
import NotificationBell from './components/NotificationBell'
import IndiaAlertsPanel from './components/IndiaAlertsPanel'
import MyFollowing from './components/MyFollowing'
import ContractorApprovals from './components/ContractorApprovals'
import WelcomeBanner from './components/WelcomeBanner'

function App() {
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('authToken'))
  const [userRole, setUserRole] = useState(() => localStorage.getItem('userRole'))
  const [userName, setUserName] = useState(() => localStorage.getItem('userName'))
  const [isVerified, setIsVerified] = useState(() => localStorage.getItem('isVerified') !== 'false')
  const [assignedProjectId, setAssignedProjectId] = useState(() => localStorage.getItem('assignedProjectId'))

  const [checkingStatus, setCheckingStatus] = useState(false)
  const [statusCheckMsg, setStatusCheckMsg] = useState('')

  const [summary,  setSummary]  = useState(null)
  const [projects, setProjects] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)
  const [selectedProjectId, setSelectedProjectId] = useState(null)
  const [selectedProjectDetail, setSelectedProjectDetail] = useState(null)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [selectedIndiaProject, setSelectedIndiaProject] = useState(null)

  // ── Show Login overlay on demand (guest clicks Follow/Feedback/Log In) ─────
  const [showLoginOverlay, setShowLoginOverlay] = useState(false)

  // ── Active sidebar section ────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState('indian-projects')

  // ── Mobile sidebar drawer ─────────────────────────────────────────────────
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  function handleLogout() {
    localStorage.removeItem('authToken')
    localStorage.removeItem('userRole')
    localStorage.removeItem('userName')
    localStorage.removeItem('isVerified')
    localStorage.removeItem('assignedProjectId')
    setAuthToken(null)
    setUserRole(null)
    setUserName(null)
    setIsVerified(true)
    setAssignedProjectId(null)
    setSummary(null)
    setProjects([])
    setSelectedIndiaProject(null)
    setActiveSection('indian-projects')
  }

  function handleLoginSuccess(token, role, fullName, isVerifiedVal, assignedProjId) {
    const verified = isVerifiedVal !== false && isVerifiedVal !== 'false'
    localStorage.setItem('authToken', token)
    localStorage.setItem('userRole', role)
    localStorage.setItem('userName', fullName)
    localStorage.setItem('isVerified', String(verified))
    if (assignedProjId) {
      localStorage.setItem('assignedProjectId', assignedProjId)
      setAssignedProjectId(assignedProjId)
    } else {
      localStorage.removeItem('assignedProjectId')
      setAssignedProjectId(null)
    }
    setAuthToken(token)
    setUserRole(role)
    setUserName(fullName)
    setIsVerified(verified)
    setShowLoginOverlay(false)
  }

  async function handleCheckVerificationStatus() {
    setCheckingStatus(true)
    setStatusCheckMsg('')
    try {
      const res = await api.get('/auth/me')
      if (res.data?.is_verified) {
        localStorage.setItem('isVerified', 'true')
        setIsVerified(true)
        if (res.data?.assigned_project_id) {
          localStorage.setItem('assignedProjectId', res.data.assigned_project_id)
          setAssignedProjectId(res.data.assigned_project_id)
          setStatusCheckMsg('Your account has been approved and project assigned!')
        } else {
          localStorage.removeItem('assignedProjectId')
          setAssignedProjectId(null)
          setStatusCheckMsg('Account verified! An administrator will assign you to a project.')
        }
      } else {
        setStatusCheckMsg('Your account is still pending verification by an administrator.')
      }
    } catch {
      setStatusCheckMsg('Could not verify status. Please try again.')
    } finally {
      setCheckingStatus(false)
    }
  }

  // Auto-check if a verified contractor has been assigned a project
  useEffect(() => {
    if (authToken && userRole === 'contractor' && isVerified && !assignedProjectId) {
      api.get('/india/me/assigned-project')
        .then((res) => {
          const list = Array.isArray(res.data) ? res.data : []
          if (list.length > 0 && list[0]?.project_id) {
            const pid = String(list[0].project_id)
            localStorage.setItem('assignedProjectId', pid)
            setAssignedProjectId(pid)
          }
        })
        .catch(() => {})
    }
  }, [authToken, userRole, isVerified, assignedProjectId])

  // Load Model Lab data only when logged in, verified, and not an unassigned contractor
  useEffect(() => {
    if (!authToken || !isVerified || (userRole === 'contractor' && !assignedProjectId)) return

    setOnUnauthorizedCallback(handleLogout)
    setLoading(true)
    setError(null)

    Promise.all([
      api.get('/dashboard/summary'),
      api.get('/projects'),
    ])
      .then(([summaryRes, projectsRes]) => {
        setSummary(summaryRes.data)
        setProjects(projectsRes.data)
      })
      .catch((err) => {
        if (err.response?.status !== 401) {
          setError('Could not load dashboard. Is the backend running?')
        }
      })
      .finally(() => setLoading(false))
  }, [authToken])

  function handleRowClick(id) {
    setSelectedProjectId(id)
    setIsDetailLoading(true)
    api.get(`/projects/${id}/risk`)
      .then((res) => setSelectedProjectDetail(res.data))
      .catch((err) => {
        if (err.response?.status !== 401) {
          console.error('Failed to load project detail', err)
        }
      })
      .finally(() => setIsDetailLoading(false))
  }

  function handleCloseDetail() {
    setSelectedProjectId(null)
    setSelectedProjectDetail(null)
    setIsDetailLoading(false)
  }

  // â”€â”€ Login overlay (on-demand, for guests clicking Follow/Feedback/Log In) â”€â”€
  if (showLoginOverlay) {
    return (
      <Login
        onLoginSuccess={handleLoginSuccess}
        onCancel={() => setShowLoginOverlay(false)}
      />
    )
  }

  // ── Unverified Contractor Pending State ─────────────────────────────────────
  if (authToken && userRole === 'contractor' && !isVerified) {
    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#FAF8F3' }}>
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-6 rounded-full bg-[#E8871E]" />
            <span
              className="text-xl font-bold tracking-wider text-[#16213E]"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              PAIMANA
            </span>
            <span className="text-[11px] bg-amber-100 text-amber-800 font-semibold px-2.5 py-0.5 rounded-full uppercase tracking-wider ml-1">
              Pending Contractor
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">
              Logged in as <strong className="text-slate-900 font-semibold">{userName}</strong>
            </span>
            <button
              onClick={handleLogout}
              className="text-xs font-semibold text-slate-600 hover:text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-200 px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Log Out
            </button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white max-w-lg w-full rounded-2xl border border-slate-200 shadow-md p-8 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto shadow-inner">
              <Clock size={32} />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>
                Account Pending Admin Approval
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
                Welcome, <span className="font-semibold text-slate-800">{userName}</span>. Your contractor registration has been submitted and is currently awaiting administrator review and approval.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left space-y-2.5 text-xs text-slate-600">
              <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                <span className="text-slate-500 font-medium">Account Status</span>
                <span className="inline-flex items-center gap-1 font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  <Clock size={11} /> Pending Approval
                </span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                <span className="text-slate-500 font-medium">Role</span>
                <span className="font-semibold text-slate-800 uppercase tracking-wide">Contractor</span>
              </div>
              <p className="text-slate-500 pt-1 leading-normal">
                Contractor accounts require admin approval and project assignment. Once approved, an admin will assign you to a specific project — you will only see that project, not the full platform.
              </p>
            </div>

            {statusCheckMsg && (
              <div
                className={`p-3 rounded-lg text-xs font-medium ${
                  statusCheckMsg.includes('approved')
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                }`}
              >
                {statusCheckMsg}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={handleCheckVerificationStatus}
                disabled={checkingStatus}
                className="flex-1 flex items-center justify-center gap-2 bg-[#16213E] hover:bg-[#1f2d54] text-white font-medium py-3 px-4 rounded-xl text-sm transition-colors shadow-sm cursor-pointer disabled:opacity-60"
              >
                <RefreshCw size={15} className={checkingStatus ? 'animate-spin' : ''} />
                {checkingStatus ? 'Checking...' : 'Check Approval Status'}
              </button>
              <button
                onClick={handleLogout}
                className="px-5 py-3 border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium rounded-xl text-sm transition-colors cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // ── Verified Contractor without Assigned Project Waiting State ──────────────
  if (authToken && userRole === 'contractor' && isVerified && !assignedProjectId) {
    return (
      <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#FAF8F3' }}>
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-1.5 h-6 rounded-full bg-[#E8871E]" />
            <span
              className="text-xl font-bold tracking-wider text-[#16213E]"
              style={{ fontFamily: "'Fraunces', serif" }}
            >
              PAIMANA
            </span>
            <span className="text-[11px] bg-emerald-100 text-emerald-800 font-semibold px-2.5 py-0.5 rounded-full uppercase tracking-wider ml-1">
              Verified Contractor
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">
              Logged in as <strong className="text-slate-900 font-semibold">{userName}</strong>
            </span>
            <button
              onClick={handleLogout}
              className="text-xs font-semibold text-slate-600 hover:text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-200 px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer"
            >
              Log Out
            </button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="bg-white max-w-lg w-full rounded-2xl border border-slate-200 shadow-md p-8 text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-blue-50 border border-blue-200 text-[#16213E] flex items-center justify-center mx-auto shadow-inner">
              <Building2 size={32} />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-slate-900" style={{ fontFamily: "'Fraunces', serif" }}>
                You haven&apos;t been assigned to a project yet
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
                Welcome, <span className="font-semibold text-slate-800">{userName}</span>. Your contractor account has been approved by an administrator, but has not yet been assigned to a specific project.
              </p>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left space-y-2.5 text-xs text-slate-600">
              <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                <span className="text-slate-500 font-medium">Account Status</span>
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                  ✓ Verified by Admin
                </span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                <span className="text-slate-500 font-medium">Project Assignment</span>
                <span className="inline-flex items-center gap-1 font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                  <Clock size={11} /> Pending Assignment
                </span>
              </div>
              <p className="text-slate-500 pt-1 leading-normal">
                An administrator will assign you to a specific project — once assigned, you will only see that project.
              </p>
            </div>

            {statusCheckMsg && (
              <div
                className={`p-3 rounded-lg text-xs font-medium ${
                  statusCheckMsg.includes('assigned')
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                }`}
              >
                {statusCheckMsg}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={handleCheckVerificationStatus}
                disabled={checkingStatus}
                className="flex-1 flex items-center justify-center gap-2 bg-[#16213E] hover:bg-[#1f2d54] text-white font-medium py-3 px-4 rounded-xl text-sm transition-colors shadow-sm cursor-pointer disabled:opacity-60"
              >
                <RefreshCw size={15} className={checkingStatus ? 'animate-spin' : ''} />
                {checkingStatus ? 'Checking...' : 'Check Project Assignment'}
              </button>
              <button
                onClick={handleLogout}
                className="px-5 py-3 border border-slate-300 text-slate-700 hover:bg-slate-50 font-medium rounded-xl text-sm transition-colors cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // ── App Shell — renders for everyone (logged in or guest) ───────────────────
  return (
    <>
      <div className="flex min-h-screen">

        {/* Mobile backdrop */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Left Sidebar */}
        <aside
          className={[
            'fixed top-0 left-0 h-screen w-60 flex flex-col z-40 transition-transform duration-300 ease-in-out',
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          ].join(' ')}
          style={{ backgroundColor: '#16213E' }}
        >
          <div className="px-6 pt-8 pb-6">
            <div
              className="rounded-full mb-1.5"
              style={{ width: 24, height: 3, backgroundColor: '#E8871E' }}
            />
            <span
              className="text-white text-xl font-bold tracking-widest"
              style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
            >
              PAIMANA
            </span>
          </div>

          <nav className="flex flex-col gap-1 px-3 flex-1">
            {[
              { id: 'indian-projects', label: 'Indian Projects', Icon: Building2 },
              // My Projects: only logged-in public users
              ...(authToken && userRole === 'public'
                ? [{ id: 'my-projects', label: 'My Projects', Icon: Bookmark }]
                : []),
              // Account Approvals: only logged-in admin users
              ...(authToken && userRole === 'admin'
                ? [{
                    id: 'contractor-approvals',
                    label: 'Account Approvals',
                    Icon: UserCheck,
                    caption: 'Review & verify contractor & field officer accounts',
                  }]
                : []),
              // Model Lab: only logged-in users
              ...(authToken
                ? [{
                    id: 'model-lab',
                    label: 'Model Validation Lab',
                    Icon: FlaskConical,
                    caption: 'AI-powered distress diagnostics across 1,731 ongoing Indian infrastructure projects',
                  }]
                : []),
            ].map(({ id, label, Icon, caption }) => {
              const isActive = activeSection === id
              return (
                <div key={id}>
                  <button
                    onClick={() => { setActiveSection(id); setIsSidebarOpen(false) }}
                    className={[
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left cursor-pointer',
                      isActive
                        ? 'text-white border-l-2'
                        : 'text-slate-300 hover:bg-white/5 border-l-2 border-transparent',
                    ].join(' ')}
                    style={isActive ? { backgroundColor: 'rgba(255,255,255,0.10)', borderLeftColor: '#E8871E' } : {}}
                  >
                    <Icon size={17} className="shrink-0" />
                    {label}
                  </button>
                  {caption && (
                    <p className="text-xs text-slate-400 px-3 pt-0.5 pb-1 leading-snug ml-8">{caption}</p>
                  )}
                </div>
              )
            })}
          </nav>
        </aside>

        {/* Main content */}
        <div className="ml-0 md:ml-60 flex-1 flex flex-col min-h-screen" style={{ backgroundColor: '#FAF8F3' }}>

          {/* Top bar */}
          <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-4 md:px-8 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <button
                onClick={() => setIsSidebarOpen(o => !o)}
                className="md:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
                aria-label="Toggle navigation"
              >
                <Menu size={20} />
              </button>

              {authToken ? (
                <div className="flex items-center gap-1.5 sm:gap-2.5 text-xs sm:text-sm text-slate-600 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className="truncate">
                    <span className="hidden sm:inline">Logged in as </span>
                    <strong className="text-slate-900 font-semibold">{userName}</strong>{' '}
                    <span className="text-[10px] sm:text-xs uppercase tracking-wider bg-slate-100 text-slate-700 px-1.5 sm:px-2 py-0.5 rounded-full font-medium ml-1">
                      {userRole}
                    </span>
                  </span>
                </div>
              ) : (
                <span className="text-xs sm:text-sm text-slate-400 italic truncate">Browsing as guest</span>
              )}
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              {authToken && (
                <NotificationBell
                  authFetch={api}
                  userRole={userRole}
                  onProjectClick={(proj) => setSelectedIndiaProject(proj)}
                />
              )}
              {authToken ? (
                <button
                  onClick={handleLogout}
                  className="text-xs font-semibold text-slate-600 hover:text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-200 px-2.5 sm:px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer shrink-0"
                >
                  Log Out
                </button>
              ) : (
                <button
                  onClick={() => setShowLoginOverlay(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-white bg-[#16213E] hover:bg-[#1e2f5a] px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                >
                  <LogIn size={14} />
                  Log In
                </button>
              )}
            </div>
          </header>

          <main className="flex-1 p-8">

            {/* Indian Projects */}
            {activeSection === 'indian-projects' && (
              <>
                <div className="mb-6">
                  <WelcomeBanner />
                </div>
                {userRole !== 'field_officer' && userRole !== 'contractor' && (
                  <div className="mb-8">
                    <IndiaAlertsPanel
                      authFetch={authToken ? api : null}
                      onProjectClick={(proj) => setSelectedIndiaProject(proj)}
                    />
                  </div>
                )}
                <IndiaProjectsView
                  authFetch={authToken ? api : null}
                  userRole={userRole}
                  authToken={authToken}
                  onLoginRequest={() => setShowLoginOverlay(true)}
                  selectedProject={selectedIndiaProject}
                  onSelectProject={setSelectedIndiaProject}
                />
              </>
            )}

            {/* My Projects — logged-in public users only */}
            {activeSection === 'my-projects' && authToken && (
              <MyFollowing
                authFetch={api}
                userRole={userRole}
                userName={userName}
                selectedProject={selectedIndiaProject}
                onProjectClick={(proj) => setSelectedIndiaProject(proj)}
                onBrowseClick={() => setActiveSection('indian-projects')}
              />
            )}

            {/* Contractor Approvals — admin only */}
            {activeSection === 'contractor-approvals' && authToken && userRole === 'admin' && (
              <ContractorApprovals authFetch={api} />
            )}

            {/* Model Validation Lab ── logged-in only */}
            {activeSection === 'model-lab' && authToken && (
              <>
                <div className="mb-8">
                  <h2 className="font-semibold text-lg text-slate-700">Model Validation Lab</h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Portfolio Health Diagnostics: identifying which active projects are currently showing signs of schedule distress, using real MoSPI data across 1,731 ongoing projects.
                  </p>
                </div>
                {loading && (
                  <div className="flex items-center justify-center py-20">
                    <p className="text-slate-500 text-lg">Loading dashboardâ€¦</p>
                  </div>
                )}
                {error && (
                  <div className="bg-white rounded-xl shadow-sm p-8 max-w-md text-center">
                    <p className="text-red-600 font-semibold text-lg mb-2">Backend unavailable</p>
                    <p className="text-slate-500 text-sm">{error}</p>
                  </div>
                )}
                {!loading && !error && (
                  <>
                    <div className="mb-8"><KpiCards summary={summary} /></div>
                    <div className="mb-8">
                      <AlertsPanel
                        projects={projects.filter(p => p.predicted_risk_tier === 'High')}
                        totalHighRisk={summary?.risk_tier_counts?.High}
                        onRowClick={handleRowClick}
                      />
                    </div>
                    <ProjectsTable projects={projects} onRowClick={handleRowClick} />
                    <div className="mt-8">
                      <ChartsPanel riskCounts={summary?.risk_tier_counts} projects={projects} />
                    </div>
                  </>
                )}
              </>
            )}

          </main>
        </div>
      </div>

      {/* Overlays */}
      <ProjectDetail
        projectId={selectedProjectId}
        project={selectedProjectDetail}
        isLoading={isDetailLoading}
        onClose={handleCloseDetail}
      />

      <AssistantChat
        isDrawerOpen={selectedProjectId != null}
        endpoint={
          activeSection === 'model-lab'
            ? `${API_BASE_URL}/assistant/ask`
            : `${API_BASE_URL}/india/assistant/ask`
        }
      />
    </>
  )
}

export default App
