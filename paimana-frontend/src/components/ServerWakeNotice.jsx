import { useEffect, useState } from 'react'
import { Loader2, AlertTriangle } from 'lucide-react'
import api from '../api'

// Free-tier hosts sleep when idle, and the first request can take 30-60s.
// Ping /health on load and, if it is slow, tell the visitor what is happening
// instead of leaving them on an empty page.
const SHOW_AFTER_MS = 2500
const GIVE_UP_AFTER_MS = 90000

export default function ServerWakeNotice() {
  const [state, setState] = useState('checking') // checking | waking | ready | down

  useEffect(() => {
    let cancelled = false
    const startedAt = Date.now()
    const showTimer = setTimeout(() => {
      if (!cancelled) setState((s) => (s === 'checking' ? 'waking' : s))
    }, SHOW_AFTER_MS)

    async function ping() {
      while (!cancelled && Date.now() - startedAt < GIVE_UP_AFTER_MS) {
        try {
          await api.get('/health', { timeout: 30000 })
          if (!cancelled) setState('ready')
          return
        } catch {
          await new Promise((r) => setTimeout(r, 3000))
        }
      }
      if (!cancelled) setState('down')
    }
    ping()

    return () => {
      cancelled = true
      clearTimeout(showTimer)
    }
  }, [])

  if (state === 'checking' || state === 'ready') return null

  const waking = state === 'waking'
  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-0 inset-x-0 z-[100] flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white shadow ${
        waking ? 'bg-slate-800' : 'bg-red-700'
      }`}
    >
      {waking ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>Waking up the server. The first load can take up to a minute.</span>
        </>
      ) : (
        <>
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <span>We can&apos;t reach the server right now.</span>
          <button type="button" onClick={() => window.location.reload()} className="underline underline-offset-2">
            Retry
          </button>
        </>
      )}
    </div>
  )
}
