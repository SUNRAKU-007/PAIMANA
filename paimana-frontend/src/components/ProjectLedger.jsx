import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import api from '../api'

const cr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`
const when = (t) => (t ? new Date(t).toLocaleDateString() : '')

const STATUS_STYLE = {
  confirmed: 'bg-emerald-100 text-emerald-700',
  pending_confirmation: 'bg-amber-100 text-amber-800',
  rejected: 'bg-red-100 text-red-700',
}

function Status({ value }) {
  return (
    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${STATUS_STYLE[value] || 'bg-slate-100 text-slate-600'}`}>
      {String(value || '').replace('_', ' ')}
    </span>
  )
}

function NoticeReply({ notice, onSent }) {
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  async function send() {
    try {
      await api.post(`/india/notices/${notice.id}/respond`, { response: text })
      onSent()
    } catch (e) { setError(e.response?.data?.detail || 'Could not send.') }
  }
  return (
    <div className="mt-2 space-y-2">
      <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Explain what the spending covers and how progress is being measured"
        className="w-full border border-slate-300 rounded-lg p-2 text-xs" aria-label="Response to notice" />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button onClick={send} className="bg-[#16213E] text-white text-xs font-medium px-3 py-1.5 rounded-lg cursor-pointer">Send response</button>
    </div>
  )
}

export default function ProjectLedger({ projectId, userRole }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    api.get(`/india/projects/${projectId}/ledger`)
      .then((r) => live && setData(r.data))
      .catch((e) => live && setError(e.response?.status === 401 || e.response?.status === 403 ? 'Log in with a verified account to see the spending ledger.' : 'Ledger unavailable.'))
    return () => { live = false }
  }, [projectId, tick])

  if (error) return <p className="text-xs text-slate-500">{error}</p>
  if (!data) return <p className="text-xs text-slate-400">Loading ledger...</p>

  const { spend } = data
  const openNotices = data.notices.filter((n) => !n.resolved)

  return (
    <section className="space-y-4">
      <h4 className="font-semibold text-sm text-slate-800">Where the money went and how progress is measured</h4>

      {spend.spend_alert && (
        <div className={`flex gap-2 rounded-lg border p-3 text-xs ${spend.spend_alert === 'critical' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
          <AlertTriangle size={16} className="shrink-0" />
          <p>{spend.spend_pct}% of the budget is spent but only {spend.progress_pct}% of the work is done, a gap of {spend.progress_gap} points.</p>
        </div>
      )}

      {openNotices.map((n) => (
        <div key={n.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          <p className="font-semibold text-slate-800">Notice from administrator</p>
          <p className="mt-1 text-slate-700">{n.message}</p>
          {n.response
            ? <p className="mt-2 text-slate-600"><strong>Response:</strong> {n.response}</p>
            : userRole === 'contractor' && <NoticeReply notice={n} onSent={() => setTick((t) => t + 1)} />}
        </div>
      ))}

      <div>
        <p className="text-xs font-medium text-slate-600 mb-2">Confirmed spending by category (total {cr(data.confirmed_ledger_total_cr)} of {cr(data.recorded_expenditure_cr)} recorded)</p>
        {data.by_category.length === 0
          ? <p className="text-xs text-slate-400">No itemised spending confirmed yet.</p>
          : (
            <ul className="space-y-1.5">
              {data.by_category.map((c) => (
                <li key={c.category} className="text-xs">
                  <div className="flex justify-between"><span>{c.category}</span><span className="font-semibold">{cr(c.amount_cr)}</span></div>
                  <div className="h-1.5 rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#E8871E]" style={{ width: `${Math.min(100, (c.amount_cr / (data.confirmed_ledger_total_cr || 1)) * 100)}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-slate-600 mb-2">Spending entries</p>
          <ul className="space-y-2 max-h-64 overflow-y-auto">
            {data.spend_entries.length === 0 && <li className="text-xs text-slate-400">None yet.</li>}
            {data.spend_entries.map((s) => (
              <li key={s.report_id} className="text-xs border border-slate-200 rounded-lg p-2.5 bg-white">
                <div className="flex justify-between gap-2"><strong>{cr(s.amount_cr)}</strong><Status value={s.status} /></div>
                <p className="text-slate-700">{s.category}</p>
                {s.description && <p className="text-slate-500">{s.description}</p>}
                {s.bill_reference && <p className="text-slate-400">Bill: {s.bill_reference}</p>}
                <p className="text-slate-400">{when(s.timestamp)} · {s.submitted_by}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium text-slate-600 mb-2">Progress measurements</p>
          <ul className="space-y-2 max-h-64 overflow-y-auto">
            {data.progress_entries.length === 0 && <li className="text-xs text-slate-400">None yet.</li>}
            {data.progress_entries.map((p) => (
              <li key={p.report_id} className="text-xs border border-slate-200 rounded-lg p-2.5 bg-white">
                <div className="flex justify-between gap-2"><strong>{p.progress_pct}%</strong><Status value={p.status} /></div>
                <p className="text-slate-700">{p.method}</p>
                {p.details && <p className="text-slate-500">{p.details}</p>}
                <p className="text-slate-400">{when(p.timestamp)} · {p.submitted_by}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
