import { useState } from 'react';
import axios from 'axios';

const API = 'http://127.0.0.1:8000';

// ── Eye icons (inline SVG, no lucide dependency needed here) ─────────────────
function EyeOpen() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
function EyeOff() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

// ── Shared password field with inlined, absolutely-positioned eye icon ────────
// The wrapper is always `position:relative`; the icon button sits inside it.
// Error-block insertion elsewhere in the form cannot affect this element.
function PasswordField({ id, value, onChange, autoComplete, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <input
        id={id}
        type={show ? 'text' : 'password'}
        required
        autoComplete={autoComplete}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full px-4 py-3 pr-11 rounded-md border border-slate-300 bg-white text-slate-900 text-sm
                   placeholder:text-slate-400 outline-none transition-colors
                   focus:outline-none focus:border-[#E8871E] focus:ring-1 focus:ring-[#E8871E]"
        style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow(s => !s)}
        style={{
          position: 'absolute',
          right: '12px',
          top: '50%',
          transform: 'translateY(-50%)',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          color: '#94a3b8',
          display: 'flex',
          alignItems: 'center',
        }}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff /> : <EyeOpen />}
      </button>
    </div>
  );
}

export default function Login({ onLoginSuccess }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'

  // ── Login fields ─────────────────────────────────────────────────────────
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const params = new URLSearchParams();
      params.append('username', username.trim());
      params.append('password', password);

      const response = await axios.post(`${API}/auth/login`, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const { access_token, role, full_name } = response.data;
      if (onLoginSuccess) onLoginSuccess(access_token, role, full_name);
    } catch (err) {
      if (err.response && err.response.status === 401) {
        setError('Invalid username or password.');
      } else {
        setError(err.response?.data?.detail || 'Invalid username or password.');
      }
    } finally {
      setIsLoading(false);
    }
  }

  // ── Register fields ───────────────────────────────────────────────────────
  const [regUsername, setRegUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regFullName, setRegFullName] = useState('');

  async function handleRegister(e) {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      // 1. Create the account
      await axios.post(`${API}/auth/register`, {
        username: regUsername.trim(),
        password: regPassword,
        full_name: regFullName.trim(),
      });

      // 2. Auto-login with the same credentials
      const params = new URLSearchParams();
      params.append('username', regUsername.trim());
      params.append('password', regPassword);

      const loginRes = await axios.post(`${API}/auth/login`, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const { access_token, role, full_name } = loginRes.data;
      if (onLoginSuccess) onLoginSuccess(access_token, role, full_name);
    } catch (err) {
      setError(
        err.response?.data?.detail ||
        'Registration failed. The username may already be taken.'
      );
    } finally {
      setIsLoading(false);
    }
  }

  // ── Mode switch (clears errors + resets shared error) ────────────────────
  function switchMode(next) {
    setError('');
    setMode(next);
  }

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row">
      {/* LEFT PANEL (60% width on desktop, brand/story side) */}
      <div className="relative overflow-hidden w-full md:w-[60%] bg-[#16213E] text-white p-8 sm:p-12 md:p-16 lg:p-20 flex flex-col justify-between">
        {/* Subtle full-bleed topographic contour-line SVG pattern */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 1000 900"
          preserveAspectRatio="none"
          style={{ opacity: 0.14 }}
          aria-hidden="true"
        >
          <g stroke="#2A3B5E" fill="none" strokeWidth="1.5" strokeLinecap="round">
            {/* Flowing survey contour lines */}
            <path d="M-100,80 C 150,20 320,160 520,100 C 720,40 850,140 1100,90" />
            <path d="M-100,180 C 120,110 310,270 540,190 C 760,120 830,230 1100,170" />
            <path d="M-100,290 C 180,210 300,380 560,280 C 780,190 870,320 1100,260" />
            
            {/* Topographic elevation loops / ridges */}
            <path d="M 280,440 C 370,360 540,370 650,450 C 760,530 610,640 500,630 C 390,620 210,510 280,440 Z" />
            <path d="M 330,460 C 400,390 520,400 600,470 C 680,540 570,610 480,600 C 390,590 270,520 330,460 Z" />
            <path d="M 380,480 C 430,425 500,430 555,480 C 615,530 530,580 470,570 C 410,560 330,520 380,480 Z" />
            <path d="M 430,500 C 460,465 500,465 525,500 C 555,530 510,555 475,550 C 440,545 400,525 430,500 Z" />

            {/* Additional infrastructure contour bands */}
            <path d="M-100,430 C 90,350 220,490 440,400 C 660,310 820,450 1100,380" />
            <path d="M-100,570 C 110,490 250,640 500,550 C 720,470 840,610 1100,540" />
            <path d="M-100,700 C 140,620 340,780 580,680 C 770,600 860,730 1100,660" />
            <path d="M-100,830 C 160,750 380,900 620,800 C 810,720 890,850 1100,790" />
            <path d="M-100,940 C 180,860 420,990 660,910 C 840,840 910,950 1100,900" />
            
            {/* Northeast survey benchmark loop */}
            <path d="M 720,180 C 810,130 910,160 940,240 C 960,310 870,370 790,350 C 710,330 670,240 720,180 Z" />
            <path d="M 750,200 C 815,160 885,185 910,245 C 925,290 860,335 800,320 C 750,305 715,245 750,200 Z" />
          </g>
        </svg>

        {/* Content Container */}
        <div className="relative z-10">
          {/* Amber horizontal accent mark */}
          <div
            className="mb-8 md:mb-12 rounded-full"
            style={{ width: '48px', height: '3px', backgroundColor: '#E8871E' }}
            aria-hidden="true"
          />

          {/* Headline and Subhead */}
          <h1
            className="font-bold text-white tracking-tight leading-none"
            style={{
              fontFamily: "'Fraunces', serif",
              fontSize: 'clamp(2.5rem, 5vw, 4rem)',
            }}
          >
            PAIMANA
          </h1>
          <p
            className="text-slate-200 mt-2 font-normal text-lg sm:text-xl md:text-2xl"
            style={{ fontFamily: "'Fraunces', serif" }}
          >
            Infrastructure Intelligence Platform
          </p>

          {/* Supporting line */}
          <p
            className="mt-6 text-slate-300 text-sm sm:text-base leading-relaxed max-w-[40ch]"
            style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
          >
            Real project data. Real risk signals. Built for the people monitoring India&apos;s infrastructure.
          </p>
        </div>

        {/* Three small stat callouts */}
        <div className="relative z-10 mt-10 md:mt-auto pt-8 border-t border-slate-700/40 flex flex-col sm:flex-row md:flex-col lg:flex-row gap-4 sm:gap-6 md:gap-3 lg:gap-6">
          <div className="flex items-baseline space-x-2">
            <span
              className="font-medium text-base"
              style={{ color: '#E8871E', fontFamily: "'IBM Plex Mono', monospace" }}
            >
              1,451
            </span>
            <span
              className="text-slate-300 text-sm"
              style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
            >
              projects tracked
            </span>
          </div>

          <div className="flex items-baseline space-x-2">
            <span
              className="font-medium text-base"
              style={{ color: '#E8871E', fontFamily: "'IBM Plex Mono', monospace" }}
            >
              685
            </span>
            <span
              className="text-slate-300 text-sm"
              style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
            >
              flagged for review
            </span>
          </div>

          <div className="flex items-baseline space-x-2">
            <span
              className="font-medium text-base"
              style={{ color: '#E8871E', fontFamily: "'IBM Plex Mono', monospace" }}
            >
              3
            </span>
            <span
              className="text-slate-300 text-sm"
              style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
            >
              roles, one platform
            </span>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL (40% width, the actual form, on off-white #FAF8F3 background) */}
      <div
        className="w-full md:w-[40%] flex items-center justify-center p-6 sm:p-10 md:p-12"
        style={{ backgroundColor: '#FAF8F3' }}
      >
        <div className="w-full max-w-sm">

          {/* ── LOGIN MODE ─────────────────────────────────────────────────── */}
          {mode === 'login' && (
            <>
              <h2
                className="text-2xl font-semibold mb-6"
                style={{ color: '#16213E', fontFamily: "'Fraunces', serif" }}
              >
                Sign In
              </h2>

              {error && (
                <div className="mb-5 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="login-username"
                    className="block text-sm font-medium mb-1.5"
                    style={{ color: '#16213E', fontFamily: "'IBM Plex Sans', sans-serif" }}
                  >
                    Username
                  </label>
                  <input
                    id="login-username"
                    type="text"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your username"
                    className="w-full px-4 py-3 rounded-md border border-slate-300 bg-white text-slate-900 text-sm
                               placeholder:text-slate-400 outline-none transition-colors
                               focus:outline-none focus:border-[#E8871E] focus:ring-1 focus:ring-[#E8871E]"
                    style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="block text-sm font-medium mb-1.5"
                    style={{ color: '#16213E', fontFamily: "'IBM Plex Sans', sans-serif" }}
                  >
                    Password
                  </label>
                  <PasswordField
                    id="login-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="••••••••"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-[#16213E] hover:bg-[#1f2d54] text-white font-medium py-3 px-4
                             rounded-md transition-colors text-sm shadow-sm cursor-pointer
                             disabled:opacity-60 disabled:cursor-not-allowed mt-2"
                  style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
                >
                  {isLoading ? 'Logging in...' : 'Log In'}
                </button>

                {/* Demo credentials hint */}
                <p
                  className="pt-2 text-xs text-slate-400 text-center leading-relaxed"
                  style={{ fontFamily: "'IBM Plex Mono', monospace" }}
                >
                  Demo: admin/admin123 • officer1/officer123 • demo_user/demo123
                </p>

                {/* Switch to register */}
                <p
                  className="text-sm text-slate-500 text-center"
                  style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
                >
                  Don&apos;t have an account?{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className="font-medium text-amber-600 hover:underline cursor-pointer bg-transparent border-none p-0"
                    style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
                  >
                    Sign up
                  </button>
                </p>
              </form>
            </>
          )}

          {/* ── REGISTER MODE ──────────────────────────────────────────────── */}
          {mode === 'register' && (
            <>
              <h2
                className="text-2xl font-semibold mb-6"
                style={{ color: '#16213E', fontFamily: "'Fraunces', serif" }}
              >
                Create Account
              </h2>

              {error && (
                <div className="mb-5 p-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label
                    htmlFor="reg-fullname"
                    className="block text-sm font-medium mb-1.5"
                    style={{ color: '#16213E', fontFamily: "'IBM Plex Sans', sans-serif" }}
                  >
                    Full Name
                  </label>
                  <input
                    id="reg-fullname"
                    type="text"
                    required
                    autoComplete="name"
                    value={regFullName}
                    onChange={(e) => setRegFullName(e.target.value)}
                    placeholder="Your full name"
                    className="w-full px-4 py-3 rounded-md border border-slate-300 bg-white text-slate-900 text-sm
                               placeholder:text-slate-400 outline-none transition-colors
                               focus:outline-none focus:border-[#E8871E] focus:ring-1 focus:ring-[#E8871E]"
                    style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="reg-username"
                    className="block text-sm font-medium mb-1.5"
                    style={{ color: '#16213E', fontFamily: "'IBM Plex Sans', sans-serif" }}
                  >
                    Username
                  </label>
                  <input
                    id="reg-username"
                    type="text"
                    required
                    autoComplete="username"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    placeholder="Choose a username"
                    className="w-full px-4 py-3 rounded-md border border-slate-300 bg-white text-slate-900 text-sm
                               placeholder:text-slate-400 outline-none transition-colors
                               focus:outline-none focus:border-[#E8871E] focus:ring-1 focus:ring-[#E8871E]"
                    style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
                  />
                </div>

                <div>
                  <label
                    htmlFor="reg-password"
                    className="block text-sm font-medium mb-1.5"
                    style={{ color: '#16213E', fontFamily: "'IBM Plex Sans', sans-serif" }}
                  >
                    Password
                  </label>
                  <PasswordField
                    id="reg-password"
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="••••••••"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full bg-[#16213E] hover:bg-[#1f2d54] text-white font-medium py-3 px-4
                             rounded-md transition-colors text-sm shadow-sm cursor-pointer
                             disabled:opacity-60 disabled:cursor-not-allowed mt-2"
                  style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
                >
                  {isLoading ? 'Creating account...' : 'Create Account'}
                </button>

                {/* Switch back to login */}
                <p
                  className="text-sm text-slate-500 text-center"
                  style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
                >
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className="font-medium text-amber-600 hover:underline cursor-pointer bg-transparent border-none p-0"
                    style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
                  >
                    Log in
                  </button>
                </p>
              </form>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
