import { useState, useEffect } from 'react'
import { Building2, FlaskConical, Menu, Bookmark } from 'lucide-react'
import api, { setOnUnauthorizedCallback } from './api'
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

function App() {
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('authToken'))
  const [userRole, setUserRole] = useState(() => localStorage.getItem('userRole'))
  const [userName, setUserName] = useState(() => localStorage.getItem('userName'))

  const [summary,  setSummary]  = useState(null)
  const [projects, setProjects] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [selectedProjectId, setSelectedProjectId] = useState(null)
  const [selectedProjectDetail, setSelectedProjectDetail] = useState(null)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [selectedIndiaProject, setSelectedIndiaProject] = useState(null)

  // ── Active sidebar section ─────────────────────────────────────────────────
  const [activeSection, setActiveSection] = useState('indian-projects')

  // ── Mobile sidebar drawer ─────────────────────────────────────────────────
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  function handleLogout() {
    localStorage.removeItem('authToken')
    localStorage.removeItem('userRole')
    localStorage.removeItem('userName')
    setAuthToken(null)
    setUserRole(null)
    setUserName(null)
    setSummary(null)
    setProjects([])
    setSelectedIndiaProject(null)
  }

  function handleLoginSuccess(token, role, fullName) {
    localStorage.setItem('authToken', token)
    localStorage.setItem('userRole', role)
    localStorage.setItem('userName', fullName)
    setAuthToken(token)
    setUserRole(role)
    setUserName(fullName)
  }

  useEffect(() => {
    if (!authToken) return

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
          setError('Could not load dashboard. Is the backend running on port 8000?')
        }
      })
      .finally(() => {
        setLoading(false)
      })
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

  // ── Pre-login: Render ONLY Login component ─────────────────────────────────
  if (!authToken) {
    return <Login onLoginSuccess={handleLoginSuccess} />
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-[#FAF8F3] flex items-center justify-center">
        <p className="text-slate-500 text-lg">Loading dashboard…</p>
      </div>
    )
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-[#FAF8F3] flex items-center justify-center px-8">
        <div className="bg-white rounded-xl shadow-sm p-8 max-w-md text-center">
          <p className="text-red-600 font-semibold text-lg mb-2">Backend unavailable</p>
          <p className="text-slate-500 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  // ── App Shell ──────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Layout: sidebar + main ─────────────────────────────────────────── */}
      <div className="flex min-h-screen">

        {/* ── Mobile backdrop ──────────────────────────────────────────────── */}
        {isSidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setIsSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* ── Left Sidebar ─────────────────────────────────────────────────
             Mobile: overlay drawer (translate-x controlled by isSidebarOpen)
             md+:    permanent, always visible (translate-x-0, no overlay)   */}
        <aside
          className={[
            'fixed top-0 left-0 h-screen w-60 flex flex-col z-40 transition-transform duration-300 ease-in-out',
            // Mobile: slide in/out; md and above: always visible
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          ].join(' ')}
          style={{ backgroundColor: '#16213E' }}
        >
          {/* Wordmark */}
          <div className="px-6 pt-8 pb-6">
            {/* Amber accent bar */}
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

          {/* Nav items */}
          <nav className="flex flex-col gap-1 px-3 flex-1">
            {[
              {
                id: 'indian-projects',
                label: 'Indian Projects',
                Icon: Building2,
              },
              ...(userRole === 'public'
                ? [
                    {
                      id: 'my-projects',
                      label: 'My Projects',
                      Icon: Bookmark,
                    },
                  ]
                : []),
              {
                id: 'model-lab',
                label: 'Model Validation Lab',
                Icon: FlaskConical,
                caption: 'ML proof-of-concept on real construction bid data',
              },
            ].map(({ id, label, Icon, caption }) => {
              const isActive = activeSection === id
              return (
                <div key={id}>
                  <button
                    onClick={() => {
                      setActiveSection(id)
                      setIsSidebarOpen(false) // close drawer on mobile after selection
                    }}
                    className={[
                      'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left cursor-pointer',
                      isActive
                        ? 'text-white border-l-2'
                        : 'text-slate-300 hover:bg-white/5 border-l-2 border-transparent',
                    ].join(' ')}
                    style={
                      isActive
                        ? { backgroundColor: 'rgba(255,255,255,0.10)', borderLeftColor: '#E8871E' }
                        : {}
                    }
                  >
                    <Icon size={17} className="shrink-0" />
                    {label}
                  </button>
                  {caption && (
                    <p className="text-xs text-slate-400 px-3 pt-0.5 pb-1 leading-snug ml-8">
                      {caption}
                    </p>
                  )}
                </div>
              )
            })}
          </nav>
        </aside>

        {/* ── Main content area ────────────────────────────────────────────── */}
        {/* ml-0 on mobile (sidebar is overlay), ml-60 at md+ (sidebar is permanent) */}
        <div className="ml-0 md:ml-60 flex-1 flex flex-col min-h-screen" style={{ backgroundColor: '#FAF8F3' }}>

          {/* Top bar */}
          <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-4 md:px-8 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Hamburger — only visible below md breakpoint */}
              <button
                onClick={() => setIsSidebarOpen(o => !o)}
                className="md:hidden p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Toggle navigation"
              >
                <Menu size={20} />
              </button>
              <div className="flex items-center gap-2.5 text-sm text-slate-600">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span>
                  Logged in as <strong className="text-slate-900 font-semibold">{userName}</strong>{' '}
                  <span className="text-xs uppercase tracking-wider bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-medium ml-1">
                    {userRole}
                  </span>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell
                authFetch={api}
                userRole={userRole}
                onProjectClick={(proj) => setSelectedIndiaProject(proj)}
              />
              <button
                onClick={handleLogout}
                className="text-xs font-semibold text-slate-600 hover:text-red-600 hover:bg-red-50 border border-slate-200 hover:border-red-200 px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                Log Out
              </button>
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 p-8">

            {/* ── Indian Projects view ─────────────────────────────────────── */}
            {activeSection === 'indian-projects' && (
              <>
                <div className="mb-8">
                  <IndiaAlertsPanel
                    authFetch={api}
                    onProjectClick={(proj) => setSelectedIndiaProject(proj)}
                  />
                </div>
                <IndiaProjectsView
                  authFetch={api}
                  userRole={userRole}
                  selectedProject={selectedIndiaProject}
                  onSelectProject={setSelectedIndiaProject}
                />
              </>
            )}

            {/* ── My Projects view (public users only) ────────────────────── */}
            {activeSection === 'my-projects' && (
              <MyFollowing
                authFetch={api}
                userRole={userRole}
                userName={userName}
                selectedProject={selectedIndiaProject}
                onProjectClick={(proj) => setSelectedIndiaProject(proj)}
                onBrowseClick={() => setActiveSection('indian-projects')}
              />
            )}

            {/* ── Model Validation Lab view ────────────────────────────────── */}
            {activeSection === 'model-lab' && (
              <>
                <div className="mb-8">
                  <h2 className="font-semibold text-lg text-slate-700">Model Validation Lab</h2>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Proof-of-concept: does materials pricing predict cost overrun better than conventional fields?
                  </p>
                </div>
                <div className="mb-8">
                  <KpiCards summary={summary} />
                </div>
                <div className="mb-8">
                  <AlertsPanel
                    projects={projects.filter(p => p.predicted_risk_tier === 'High')}
                    totalHighRisk={summary?.risk_tier_counts?.High}
                    onRowClick={handleRowClick}
                  />
                </div>
                <ProjectsTable
                  projects={projects}
                  onRowClick={handleRowClick}
                />
                <div className="mt-8">
                  <ChartsPanel
                    riskCounts={summary?.risk_tier_counts}
                    projects={projects}
                  />
                </div>
              </>
            )}

          </main>
        </div>
      </div>

      {/* ── Overlays / portals ──────────────────────────────────────────────── */}
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
            ? 'http://127.0.0.1:8000/assistant/ask'
            : 'http://127.0.0.1:8000/india/assistant/ask'
        }
      />
    </>
  )
}

export default App
