import { useState } from 'react';
import { ChevronUp, ChevronDown, ShieldCheck, Activity, Layers } from 'lucide-react';

const STORAGE_KEY = 'paimana_welcome_banner_collapsed';

export default function WelcomeBanner() {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved !== null ? JSON.parse(saved) : false; // Default: expanded for new visitors
    } catch {
      return false;
    }
  });

  const handleToggle = (e) => {
    e.stopPropagation();
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (err) {
        console.error('Failed to save banner state to localStorage', err);
      }
      return next;
    });
  };

  if (isCollapsed) {
    return (
      <aside
        id="welcome-banner-collapsed"
        aria-label="PAIMANA Orientation Banner (Collapsed)"
        onClick={() => {
          setIsCollapsed(false);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(false));
          } catch {}
        }}
        className="w-full bg-[#16213E] hover:bg-[#1c2a4f] text-slate-200 border border-[#2A3B5E] rounded-xl px-4 py-2.5 shadow-xs flex items-center justify-between cursor-pointer transition-colors duration-200 group"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: '#E8871E' }}
            aria-hidden="true"
          />
          <span
            className="text-xs font-semibold uppercase tracking-wider text-amber-400"
            style={{ fontFamily: "'IBM Plex Mono', monospace" }}
          >
            PAIMANA Overview
          </span>
          <span className="text-slate-400 text-xs hidden sm:inline">•</span>
          <p className="text-xs text-slate-300 truncate">
            Tracking 1,731 ongoing Indian infrastructure projects across 21 sectors with AI schedule &amp; cost risk intelligence.
          </p>
        </div>

        <button
          type="button"
          id="toggle-welcome-banner-expand"
          onClick={handleToggle}
          className="flex items-center gap-1 text-xs text-slate-400 group-hover:text-amber-400 transition-colors shrink-0 ml-3 font-medium cursor-pointer"
          aria-label="Expand welcome orientation"
        >
          <span className="hidden sm:inline">Expand orientation</span>
          <ChevronDown size={16} />
        </button>
      </aside>
    );
  }

  return (
    <aside
      id="welcome-banner-expanded"
      aria-label="PAIMANA Orientation Banner (Expanded)"
      className="relative overflow-hidden w-full bg-[#16213E] text-white border border-[#2A3B5E] rounded-xl p-5 sm:p-6 shadow-sm transition-all duration-300"
    >
      {/* Background topographic subtle decoration */}
      <svg
        className="absolute right-0 top-0 h-full w-1/2 pointer-events-none opacity-[0.08]"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 500 200"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <g stroke="#ffffff" fill="none" strokeWidth="1.5">
          <path d="M0,40 C150,10 250,110 500,60" />
          <path d="M0,90 C120,40 280,160 500,110" />
          <path d="M0,140 C180,90 320,190 500,160" />
        </g>
      </svg>

      <div className="relative z-10 flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div className="space-y-2 max-w-4xl">
          {/* Header row with Amber accent */}
          <div className="flex items-center gap-2.5">
            <div
              className="w-6 h-[3px] rounded-full"
              style={{ backgroundColor: '#E8871E' }}
              aria-hidden="true"
            />
            <span
              className="text-xs font-semibold uppercase tracking-wider text-amber-400"
              style={{ fontFamily: "'IBM Plex Mono', monospace" }}
            >
              Infrastructure Intelligence Platform
            </span>
            <span className="text-slate-500 text-xs">•</span>
            <span className="text-[11px] text-slate-300 bg-white/10 px-2 py-0.5 rounded-full font-medium">
              MoSPI Public Flash Reporting
            </span>
          </div>

          {/* Title */}
          <h2
            className="text-lg sm:text-xl font-bold text-white tracking-tight"
            style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
          >
            Welcome to PAIMANA
          </h2>

          {/* Primary Orientation Copy */}
          <p
            className="text-sm sm:text-[15px] text-slate-200 leading-relaxed max-w-3xl"
            style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
          >
            PAIMANA tracks <strong className="text-amber-300 font-semibold">1,731 ongoing Indian infrastructure projects</strong> across 21 sectors sourced directly from MoSPI&apos;s national monitoring system, using machine learning and field telemetry to continuously diagnose schedule and cost distress in real time.
          </p>

          {/* Feature Highlights Pills */}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-300">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08]">
              <Activity size={13} className="text-[#E8871E]" />
              Live Cost &amp; Progress Alert Rules
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08]">
              <ShieldCheck size={13} className="text-[#E8871E]" />
              Officer Weekly Reports &amp; Contractor Sign-Off
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.06] border border-white/[0.08]">
              <Layers size={13} className="text-[#E8871E]" />
              Railways, Highways &amp; Metro Transit Telemetry
            </span>
          </div>
        </div>

        {/* Collapse Button */}
        <div className="flex items-center self-end md:self-start shrink-0">
          <button
            type="button"
            id="toggle-welcome-banner-collapse"
            onClick={handleToggle}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 hover:text-white text-xs font-medium transition-colors cursor-pointer border border-white/10"
            aria-label="Collapse welcome orientation"
            title="Collapse orientation banner"
          >
            <span>Collapse</span>
            <ChevronUp size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}
