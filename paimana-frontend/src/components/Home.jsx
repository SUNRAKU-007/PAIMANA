import { useEffect, useMemo, useState } from 'react'
import { feature } from 'topojson-client'
import { geoMercator, geoPath } from 'd3-geo'
import { ArrowRight, Eye, ShieldCheck, TrendingDown, Landmark } from 'lucide-react'
import api from '../api'

const fmtCr = (n) => {
  if (n == null) return '-'
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L Cr`
  return `₹${Math.round(n).toLocaleString('en-IN')} Cr`
}

const SHADES = ['#E8EDF5', '#C3D0E6', '#8CA3CB', '#4E6A9E', '#2A3B5E', '#16213E']

function shadeFor(count, max) {
  if (!count) return '#EEF0F4'
  const idx = Math.min(SHADES.length - 1, 1 + Math.floor((count / max) * (SHADES.length - 2)))
  return SHADES[idx]
}

function IndiaMap({ states }) {
  const [geo, setGeo] = useState(null)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    fetch('/india-states.json')
      .then((r) => r.json())
      .then((topo) => setGeo(feature(topo, topo.objects.states)))
      .catch(() => setGeo(null))
  }, [])

  const W = 620
  const H = 680
  const paths = useMemo(() => {
    if (!geo) return []
    const projection = geoMercator().fitSize([W, H], geo)
    const path = geoPath(projection)
    return geo.features.map((f) => ({ name: f.properties.st_nm, d: path(f) }))
  }, [geo])

  const max = Math.max(1, ...Object.values(states).map((s) => s.count))
  const active = hover ? states[hover] : null

  if (!geo) {
    return <div className="h-[420px] flex items-center justify-center text-sm text-slate-400">Loading map...</div>
  }

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto max-h-[640px]" role="img" aria-label="Map of India showing project counts by state">
        {paths.map(({ name, d }) => (
          <path
            key={name}
            d={d}
            fill={shadeFor(states[name]?.count, max)}
            stroke={hover === name ? '#E8871E' : '#FFFFFF'}
            strokeWidth={hover === name ? 2 : 0.7}
            onMouseEnter={() => setHover(name)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(name)}
            onBlur={() => setHover(null)}
            tabIndex={0}
            aria-label={`${name}: ${states[name]?.count || 0} projects`}
            className="cursor-pointer outline-none transition-colors"
          />
        ))}
      </svg>

      <div className="absolute top-2 right-2 sm:top-4 sm:right-4 w-56 rounded-xl bg-white/95 border border-slate-200 shadow-md p-4 pointer-events-none">
        {hover ? (
          <>
            <p className="text-xs uppercase tracking-wider text-slate-400">State / UT</p>
            <p className="font-semibold text-slate-900 leading-tight" style={{ fontFamily: "'Fraunces', serif" }}>{hover}</p>
            <p className="mt-2 text-3xl font-bold text-[#16213E]">{active?.count || 0}
              <span className="text-xs font-medium text-slate-500 ml-1.5">projects</span>
            </p>
            {active?.top_sectors?.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                {active.top_sectors.map((s) => (
                  <li key={s.sector} className="flex justify-between gap-2">
                    <span className="truncate">{s.sector}</span><span className="font-semibold">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-500 leading-snug">Hover over a state to see how many projects are underway there.</p>
        )}
      </div>

      <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-2 justify-center">
        <span>Fewer</span>
        {SHADES.map((c) => <span key={c} className="w-6 h-2.5 rounded-sm" style={{ backgroundColor: c }} />)}
        <span>More projects</span>
      </div>
    </div>
  )
}

const PILLARS = [
  { Icon: Eye, title: 'See every rupee', body: 'Each project shows what was spent, on what, and against which bill, not just a total.' },
  { Icon: TrendingDown, title: 'Catch overspending early', body: 'When money is spent far faster than work is completed, the contractor and administrators are alerted.' },
  { Icon: ShieldCheck, title: 'Verified people only', body: 'Contractors and field officers register with an ID issued by an administrator, then get approved.' },
  { Icon: Landmark, title: 'Built on MoSPI data', body: 'Ongoing central-sector infrastructure projects, scored for schedule and cost distress.' },
]

export default function Home({ onExplore, onLogin, onSector, authToken }) {
  const [stats, setStats] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    api.get('/public/stats').then((r) => setStats(r.data)).catch(() => setFailed(true))
  }, [])

  const maxSector = stats ? Math.max(...stats.sectors.map((s) => s.count), 1) : 1

  return (
    <div className="-m-4 md:-m-8">
      <section className="relative bg-gradient-to-b from-orange-50/70 via-white to-white text-[#16213E] px-6 md:px-12 py-14 md:py-20 border-b border-slate-200">
        <div className="max-w-5xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-orange-200 bg-white px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-[#B45F06]">
            <span className="flex h-2 w-5 overflow-hidden rounded-sm" aria-hidden="true">
              <span className="flex-1 bg-[#FF9933]" />
              <span className="flex-1 bg-slate-200" />
              <span className="flex-1 bg-[#138808]" />
            </span>
            पैमाना · The Yardstick
          </p>
          <h1 className="mt-5 text-4xl md:text-6xl font-bold leading-tight text-balance" style={{ fontFamily: "'Fraunces', serif" }}>
            Public money, measured in public.
          </h1>
          <p className="mt-5 max-w-2xl text-base md:text-lg text-slate-600 leading-relaxed">
            PAIMANA tracks India&apos;s ongoing infrastructure projects: how much has been spent, how much work has actually been done,
            and who is accountable. When the two drift apart, it says so.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={() => onExplore()} className="inline-flex items-center gap-2 bg-[#E8871E] hover:bg-[#d17812] text-white font-semibold px-5 py-3 rounded-lg cursor-pointer transition-colors">
              Browse all projects <ArrowRight size={16} />
            </button>
            {!authToken && (
              <button onClick={onLogin} className="px-5 py-3 rounded-lg border border-slate-300 bg-white text-[#16213E] hover:border-[#16213E] font-medium cursor-pointer transition-colors">
                Log in or register
              </button>
            )}
          </div>

          <dl className="mt-12 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              ['Projects tracked', stats?.total_projects?.toLocaleString('en-IN'), 'border-t-[#16213E]'],
              ['Sanctioned cost', stats && fmtCr(stats.total_cost_cr), 'border-t-[#FF9933]'],
              ['Spent so far', stats && fmtCr(stats.total_spent_cr), 'border-t-[#138808]'],
              ['Spend-vs-progress alerts', stats?.spend_alerts?.toLocaleString('en-IN'), 'border-t-red-600'],
            ].map(([label, value, accent]) => (
              <div key={label} className={`rounded-xl bg-white border border-slate-200 border-t-4 ${accent} p-4 shadow-sm`}>
                <dt className="text-xs uppercase tracking-wider text-slate-500">{label}</dt>
                <dd className="text-2xl md:text-3xl font-bold mt-1 text-[#16213E]">{value ?? '...'}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="px-6 md:px-12 py-12 bg-white border-b border-slate-200">
        <h2 className="text-2xl font-bold text-[#16213E]" style={{ fontFamily: "'Fraunces', serif" }}>What is PAIMANA?</h2>
        <p className="mt-2 max-w-3xl text-slate-600 leading-relaxed">
          Paimana means &ldquo;yardstick&rdquo;. It gives citizens, officials and contractors one shared measure of a project&apos;s health,
          built from official data plus verified field reports.
        </p>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PILLARS.map(({ Icon, title, body }) => (
            <div key={title} className="rounded-xl border border-slate-200 p-5 bg-[#FAF8F3]">
              <Icon size={22} className="text-[#E8871E]" />
              <h3 className="mt-3 font-semibold text-[#16213E]">{title}</h3>
              <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 md:px-12 py-12">
        <h2 className="text-2xl font-bold text-[#16213E]" style={{ fontFamily: "'Fraunces', serif" }}>Projects by sector</h2>
        <p className="mt-1 text-sm text-slate-500">Select a sector to see its projects.</p>
        {failed && <p className="mt-4 text-sm text-red-600">Could not reach the server. Start the backend and refresh.</p>}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(stats?.sectors || Array.from({ length: 6 }, () => null)).map((s, i) =>
            s ? (
              <button key={s.sector} onClick={() => onSector(s.sector)}
                className="text-left rounded-xl bg-white border border-slate-200 hover:border-[#E8871E] hover:shadow-md p-5 transition-all cursor-pointer group">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-semibold text-[#16213E] leading-tight">{s.sector}</h3>
                  <span className="text-3xl font-bold text-[#16213E]">{s.count}</span>
                </div>
                <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full bg-[#E8871E]" style={{ width: `${(s.count / maxSector) * 100}%` }} />
                </div>
                <p className="mt-2 text-xs text-slate-500 flex justify-between">
                  <span>{fmtCr(s.cost_cr)} sanctioned</span>
                  <span className="text-[#E8871E] opacity-0 group-hover:opacity-100 transition-opacity">View</span>
                </p>
              </button>
            ) : (
              <div key={i} className="h-[104px] rounded-xl bg-slate-100 animate-pulse" />
            )
          )}
        </div>
      </section>

      <section className="px-6 md:px-12 py-12 bg-white border-t border-slate-200">
        <h2 className="text-2xl font-bold text-[#16213E]" style={{ fontFamily: "'Fraunces', serif" }}>Where the projects are</h2>
        <p className="mt-1 text-sm text-slate-500 max-w-2xl">
          Projects spanning several states are counted in each of them.
          {stats && (stats.nationwide['PAN India'] || stats.nationwide['Offshore']) ? (
            <> Not shown on the map: {stats.nationwide['PAN India'] || 0} pan-India and {stats.nationwide['Offshore'] || 0} offshore projects.</>
          ) : null}
        </p>
        <div className="mt-6 max-w-3xl mx-auto">
          {stats ? <IndiaMap states={stats.states} /> : <div className="h-[420px] rounded-xl bg-slate-100 animate-pulse" />}
        </div>
      </section>

      <footer className="bg-white border-t border-slate-200 text-slate-600 text-sm">
        <div className="flex h-1" aria-hidden="true">
          <span className="flex-1 bg-[#FF9933]" />
          <span className="flex-1 bg-white" />
          <span className="flex-1 bg-[#138808]" />
        </div>
        <div className="px-6 md:px-12 py-8 flex flex-wrap justify-between gap-2">
          <span>PAIMANA. Infrastructure accountability, in the open.</span>
          <button onClick={() => onExplore()} className="text-[#B45F06] font-medium hover:underline cursor-pointer">Browse projects</button>
        </div>
      </footer>
    </div>
  )
}
