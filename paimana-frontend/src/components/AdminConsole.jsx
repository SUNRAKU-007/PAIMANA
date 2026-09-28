import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, XCircle, Copy, RefreshCw } from 'lucide-react'
import api from '../api'

const TABS = [
  ['overview', 'Overview'],
  ['alerts', 'Spend alerts'],
  ['approvals', 'Approvals'],
  ['ids', 'Verification IDs'],
  ['users', 'Users'],
  ['settings', 'Alert settings'],
  ['audit', 'Audit log'],
]

const errMsg = (e) => e.response?.data?.detail || 'Something went wrong.'
const inputCls = 'w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#E8871E]/50 focus:border-[#E8871E]'
const btnPrimary = 'bg-[#16213E] hover:bg-[#1f2d54] text-white text-sm font-medium px-4 py-2 rounded-lg cursor-pointer disabled:opacity-50 transition-colors'
const btnGhost = 'border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium px-3 py-1.5 rounded-lg cursor-pointer transition-colors'

function useFetch(path, deps = []) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const load = useCallback(() => {
    api.get(path).then((r) => { setData(r.data); setError(null) }).catch((e) => setError(errMsg(e)))
  }, [path])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load, ...deps])
  return [data, error, load]
}

function Card({ title, children, action }) {
  return (
    <section className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4 gap-3">
        <h3 className="font-semibold text-[#16213E]">{title}</h3>{action}
      </div>
      {children}
    </section>
  )
}

const Msg = ({ error }) => error ? <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">{error}</p> : null
const Empty = ({ children }) => <p className="text-sm text-slate-500 py-6 text-center">{children}</p>

function LevelBadge({ level }) {
  const cls = level === 'critical' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
  return <span className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded-full ${cls}`}>{level}</span>
}

function NoticeForm({ alert, onDone }) {
  const [message, setMessage] = useState(
    `Reported expenditure (${alert.spend_pct}% of cost) is far ahead of physical progress (${alert.progress_pct}%). Please explain what the spend covers and share supporting bills.`
  )
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  async function send() {
    setBusy(true)
    try {
      await api.post('/admin/notices', { project_id: alert.project_id, message, severity: alert.spend_alert })
      onDone()
    } catch (e) { setError(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <div className="mt-3 space-y-2">
      <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} className={inputCls} aria-label="Notice message" />
      <Msg error={error} />
      <div className="flex gap-2">
        <button disabled={busy} onClick={send} className={btnPrimary}>{busy ? 'Sending...' : 'Send to contractor'}</button>
        <button onClick={onDone} className={btnGhost}>Cancel</button>
      </div>
    </div>
  )
}

function AlertsTab() {
  const [rows, error, reload] = useFetch('/admin/spend-alerts')
  const [notices, , reloadNotices] = useFetch('/admin/notices')
  const [open, setOpen] = useState(null)
  if (error) return <Msg error={error} />
  if (!rows) return <Empty>Loading...</Empty>
  return (
    <div className="space-y-6">
      <Card title={`Projects where spend is outrunning progress (${rows.length})`}>
        {rows.length === 0 && <Empty>No project is currently over its threshold.</Empty>}
        <ul className="divide-y divide-slate-100">
          {rows.slice(0, 100).map((r) => (
            <li key={r.project_id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 truncate max-w-xl">{r.name}</p>
                  <p className="text-xs text-slate-500">{r.sector} · {r.state} · Contractor: {r.assigned_contractor || 'unassigned'}</p>
                  <p className="text-xs text-slate-700 mt-1">
                    Spent <strong>{r.spend_pct}%</strong> of cost, completed <strong>{r.progress_pct}%</strong> of work
                    (gap <strong>{r.progress_gap} pts</strong>)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <LevelBadge level={r.spend_alert} />
                  {r.open_notice_id
                    ? <span className="text-xs text-slate-500">Notice open</span>
                    : r.assigned_contractor && <button className={btnGhost} onClick={() => setOpen(open === r.project_id ? null : r.project_id)}>Notify contractor</button>}
                </div>
              </div>
              {open === r.project_id && <NoticeForm alert={r} onDone={() => { setOpen(null); reload(); reloadNotices() }} />}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Notices sent">
        {!notices?.length ? <Empty>No notices yet.</Empty> : (
          <ul className="divide-y divide-slate-100">
            {notices.map((n) => (
              <li key={n.id} className="py-3 text-sm">
                <div className="flex justify-between gap-3 flex-wrap">
                  <p className="font-medium text-slate-900">{n.project_name} <span className="text-slate-400 font-normal">to {n.contractor}</span></p>
                  <span className={`text-xs font-semibold ${n.resolved ? 'text-emerald-700' : n.response ? 'text-blue-700' : 'text-amber-700'}`}>
                    {n.resolved ? 'Resolved' : n.response ? 'Response received' : 'Awaiting response'}
                  </span>
                </div>
                <p className="text-slate-600 mt-1">{n.message}</p>
                {n.response && <p className="mt-2 text-slate-800 bg-slate-50 border border-slate-200 rounded-lg p-2.5"><strong>Contractor:</strong> {n.response}</p>}
                {!n.resolved && n.response && (
                  <button className={`${btnGhost} mt-2`} onClick={() => api.patch(`/admin/notices/${n.id}/resolve`).then(() => { reloadNotices(); reload() })}>Mark resolved</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function Check({ ok, label }) {
  if (ok == null) return <span className="text-xs text-slate-400">{label}: n/a</span>
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${ok ? 'text-emerald-700' : 'text-red-600'}`}>
      {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}{label}
    </span>
  )
}

function ApprovalsTab() {
  const [queue, error, reload] = useFetch('/admin/approval-queue')
  const [rejecting, setRejecting] = useState(null)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState(null)

  async function act(fn) {
    setMsg(null)
    try { await fn(); reload() } catch (e) { setMsg(errMsg(e)) }
  }
  if (error) return <Msg error={error} />
  if (!queue) return <Empty>Loading...</Empty>
  return (
    <Card title={`Accounts awaiting approval (${queue.length})`}>
      <Msg error={msg} />
      {queue.length === 0 && <Empty>Nothing to review.</Empty>}
      <ul className="divide-y divide-slate-100">
        {queue.map((u) => {
          const canApprove = u.id_valid && u.id_role_matches
          return (
            <li key={u.username} className="py-4">
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-900">{u.full_name} <span className="text-slate-400 font-normal">@{u.username}</span></p>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">{u.role.replace('_', ' ')} · {u.organization || 'no organisation'}</p>
                  <p className="text-xs mt-1 font-mono text-slate-700">ID submitted: {u.verification_id || 'none'}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                    <Check ok={u.id_valid} label="ID is valid" />
                    <Check ok={u.id_role_matches} label="Role matches ID" />
                    <Check ok={u.name_matches} label={`Name matches${u.issued_holder_name ? ` (${u.issued_holder_name})` : ''}`} />
                  </div>
                  {u.pre_assigned_project_id && <p className="text-xs text-slate-600 mt-1">Will be auto-assigned to project {u.pre_assigned_project_id}</p>}
                </div>
                <div className="flex items-start gap-2">
                  <button disabled={!canApprove} className={btnPrimary} onClick={() => act(() => api.patch(`/admin/users/${u.username}/approve`))}>Approve</button>
                  <button className={btnGhost} onClick={() => { setRejecting(rejecting === u.username ? null : u.username); setReason('') }}>Reject</button>
                </div>
              </div>
              {rejecting === u.username && (
                <div className="mt-3 flex gap-2">
                  <input className={inputCls} placeholder="Reason shown to the applicant" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button className={btnPrimary} onClick={() => act(() => api.patch(`/admin/users/${u.username}/reject`, { reason }).then(() => setRejecting(null)))}>Confirm</button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function IdsTab() {
  const [ids, error, reload] = useFetch('/admin/issued-ids')
  const [form, setForm] = useState({ role: 'contractor', holder_name: '', organization: '', project_id: '' })
  const [formError, setFormError] = useState(null)
  const [created, setCreated] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function issue(e) {
    e.preventDefault()
    setFormError(null)
    try {
      const res = await api.post('/admin/issued-ids', { ...form, project_id: form.project_id || null })
      setCreated(res.data.code)
      setForm({ ...form, holder_name: '', organization: '', project_id: '' })
      reload()
    } catch (err) { setFormError(errMsg(err)) }
  }
  return (
    <div className="space-y-6">
      <Card title="Issue a verification ID">
        <p className="text-sm text-slate-600 mb-4">Give the code to the person offline. They must enter it, with the same name, when registering.</p>
        <form onSubmit={issue} className="grid gap-3 sm:grid-cols-2">
          <select className={inputCls} value={form.role} onChange={set('role')} aria-label="Role">
            <option value="contractor">Contractor</option>
            <option value="field_officer">Field officer</option>
          </select>
          <input className={inputCls} required placeholder="Full name of holder" value={form.holder_name} onChange={set('holder_name')} />
          <input className={inputCls} placeholder="Organisation / department" value={form.organization} onChange={set('organization')} />
          <input className={inputCls} placeholder="Project ID to auto-assign (optional)" value={form.project_id} onChange={set('project_id')} />
          <div className="sm:col-span-2 space-y-2">
            <Msg error={formError} />
            {created && (
              <p className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3 flex items-center gap-2">
                Issued <code className="font-mono font-bold">{created}</code>
                <button type="button" aria-label="Copy code" onClick={() => navigator.clipboard?.writeText(created)}><Copy size={14} /></button>
              </p>
            )}
            <button className={btnPrimary}>Issue ID</button>
          </div>
        </form>
      </Card>
      <Card title="Issued IDs">
        {error && <Msg error={error} />}
        {ids && ids.length === 0 && <Empty>No IDs issued yet.</Empty>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-2 pr-4">Code</th><th className="pr-4">Holder</th><th className="pr-4">Role</th><th className="pr-4">Project</th><th className="pr-4">Status</th><th /></tr></thead>
            <tbody>
              {(ids || []).map((i) => (
                <tr key={i.code} className="border-t border-slate-100">
                  <td className="py-2 pr-4 font-mono text-xs">{i.code}</td>
                  <td className="pr-4">{i.holder_name}</td>
                  <td className="pr-4">{i.role.replace('_', ' ')}</td>
                  <td className="pr-4">{i.project_id || '-'}</td>
                  <td className="pr-4">{i.revoked ? 'Revoked' : i.used_by ? `Used by ${i.used_by}` : 'Unused'}</td>
                  <td>{!i.revoked && !i.used_by && <button className={btnGhost} onClick={() => api.delete(`/admin/issued-ids/${i.code}`).then(reload)}>Revoke</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function UsersTab() {
  const [users, error, reload] = useFetch('/admin/users')
  const [msg, setMsg] = useState(null)
  async function suspend(u) {
    const reason = window.prompt(`Reason for suspending ${u.username}?`)
    if (!reason) return
    try { await api.patch(`/admin/users/${u.username}/suspend`, { reason }); reload() } catch (e) { setMsg(errMsg(e)) }
  }
  return (
    <Card title="All users">
      <Msg error={error || msg} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs uppercase text-slate-500"><th className="py-2 pr-4">User</th><th className="pr-4">Role</th><th className="pr-4">Status</th><th className="pr-4">Project</th><th /></tr></thead>
          <tbody>
            {(users || []).map((u) => (
              <tr key={u.username} className="border-t border-slate-100">
                <td className="py-2 pr-4">{u.full_name} <span className="text-slate-400">@{u.username}</span></td>
                <td className="pr-4">{u.role}</td>
                <td className="pr-4">{u.account_status}</td>
                <td className="pr-4">{u.assigned_project_id || '-'}</td>
                <td>
                  {u.role !== 'admin' && (u.account_status === 'suspended'
                    ? <button className={btnGhost} onClick={() => api.patch(`/admin/users/${u.username}/reinstate`).then(reload)}>Reinstate</button>
                    : <button className={btnGhost} onClick={() => suspend(u)}>Suspend</button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function SettingsTab() {
  const [settings, error] = useFetch('/admin/settings')
  const [form, setForm] = useState(null)
  const [msg, setMsg] = useState(null)
  useEffect(() => { if (settings) setForm(settings) }, [settings])
  if (!form) return <Msg error={error} />
  const fields = [
    ['spend_gap_warning_pts', 'Warning when spend % exceeds progress % by (points)'],
    ['spend_gap_critical_pts', 'Critical when the gap exceeds (points)'],
    ['spend_gap_min_spend_pct', 'Ignore projects that have spent less than (% of cost)'],
  ]
  async function save(e) {
    e.preventDefault()
    try {
      const body = Object.fromEntries(fields.map(([k]) => [k, Number(form[k])]))
      await api.put('/admin/settings', body)
      setMsg({ ok: true, text: 'Saved. Alerts now use these thresholds.' })
    } catch (err) { setMsg({ ok: false, text: errMsg(err) }) }
  }
  return (
    <Card title="Spend-versus-progress alert thresholds">
      <form onSubmit={save} className="space-y-4 max-w-lg">
        {fields.map(([k, label]) => (
          <label key={k} className="block text-sm text-slate-700">{label}
            <input type="number" min="0" max="100" step="any" className={`${inputCls} mt-1`} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          </label>
        ))}
        {msg && <p className={`text-sm ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`}>{msg.text}</p>}
        <button className={btnPrimary}>Save thresholds</button>
      </form>
    </Card>
  )
}

function AuditTab() {
  const [log, error, reload] = useFetch('/admin/audit-log')
  return (
    <Card title="Recent admin actions" action={<button className={btnGhost} onClick={reload}><RefreshCw size={12} className="inline mr-1" />Refresh</button>}>
      <Msg error={error} />
      {log && log.length === 0 && <Empty>No actions recorded yet.</Empty>}
      <ul className="divide-y divide-slate-100 text-sm">
        {(log || []).map((l, i) => (
          <li key={i} className="py-2 flex flex-wrap gap-x-3">
            <span className="text-xs text-slate-400 w-40 shrink-0">{new Date(l.timestamp).toLocaleString()}</span>
            <span><strong>{l.actor}</strong> {l.action.replaceAll('_', ' ')} {l.target && <code className="text-xs">{l.target}</code>} {l.detail && <span className="text-slate-500">{l.detail}</span>}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function OverviewTab({ go }) {
  const [o, error] = useFetch('/admin/overview')
  if (error) return <Msg error={error} />
  if (!o) return <Empty>Loading...</Empty>
  const tiles = [
    ['Critical spend alerts', o.spend_alerts_critical, 'alerts', o.spend_alerts_critical > 0],
    ['Critical, no notice sent', o.spend_alerts_without_notice, 'alerts', o.spend_alerts_without_notice > 0],
    ['Notices awaiting response', o.notices_awaiting_response, 'alerts', false],
    ['Accounts to approve', o.pending_approvals, 'approvals', o.pending_approvals > 0],
    ['Unused verification IDs', o.ids_unused, 'ids', false],
    ['Suspended accounts', o.suspended_accounts, 'users', false],
    ['Active projects with no contractor', o.projects_unassigned_contractor, null, false],
    ['Active projects with no officer', o.projects_unassigned_officer, null, false],
    ['Field reports pending', o.reports_pending, null, false],
  ]
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(([label, value, tab, hot]) => (
          <button key={label} disabled={!tab} onClick={() => tab && go(tab)}
            className={`text-left rounded-xl border p-4 bg-white ${hot ? 'border-red-300' : 'border-slate-200'} ${tab ? 'hover:shadow-md cursor-pointer' : 'cursor-default'} transition-shadow`}>
            <p className={`text-3xl font-bold ${hot ? 'text-red-600' : 'text-[#16213E]'}`}>{value}</p>
            <p className="text-xs text-slate-500 mt-1">{label}</p>
          </button>
        ))}
      </div>
      <Card title="Largest spend-versus-progress gaps">
        {o.top_alerts.length === 0 && <Empty>None right now.</Empty>}
        <ul className="divide-y divide-slate-100">
          {o.top_alerts.map((a) => (
            <li key={a.project_id} className="py-2 flex justify-between gap-3 text-sm">
              <span className="truncate">{a.name}</span>
              <span className="shrink-0 flex items-center gap-2"><AlertTriangle size={14} className="text-red-500" />{a.spend_pct}% spent / {a.progress_pct}% done</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

export default function AdminConsole() {
  const [tab, setTab] = useState('overview')
  return (
    <div>
      <h2 className="text-2xl font-bold text-[#16213E]" style={{ fontFamily: "'Fraunces', serif" }}>Admin console</h2>
      <div className="mt-4 mb-6 flex flex-wrap gap-1 border-b border-slate-200" role="tablist">
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium cursor-pointer border-b-2 -mb-px ${tab === id ? 'border-[#E8871E] text-[#16213E]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab go={setTab} />}
      {tab === 'alerts' && <AlertsTab />}
      {tab === 'approvals' && <ApprovalsTab />}
      {tab === 'ids' && <IdsTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  )
}
