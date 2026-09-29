import { BrowserRouter, Routes, Route, Link, NavLink, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Analyze from './pages/Analyze.jsx';
import AB from './pages/AB.jsx';
import Ops from './pages/Ops.jsx';
import LandingHome from './pages/LandingHome.jsx';
import { CallDetail } from './pages/CallDetail';
import { Replay } from './pages/Replay';
import ConnectionStatus from './components/ConnectionStatus.jsx';

const NAV: [string, string][] = [
  ['/app', 'Dashboard'],
  ['/analyze', 'Analyze'],
  ['/ab', 'A/B'],
  ['/ops', 'Ops'],
];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)' }}>
      <header
        className="sticky top-0 z-10 backdrop-blur-sm"
        style={{ borderBottom: '1px solid var(--line)', background: 'rgba(252,250,246,0.94)' }}
      >
        <div className="max-w-6xl mx-auto px-8 py-3 flex items-center gap-8">
          <Link to="/" className="block group" title="Back to landing">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] transition-colors" style={{ color: 'var(--mut)' }}>Case File</p>
            <h1 className="text-lg tracking-tight" style={{ fontFamily: '"Newsreader", Georgia, serif', fontWeight: 600, color: 'var(--ink)' }}>
              CallAutopsy
            </h1>
          </Link>
          <nav className="flex gap-1 text-sm ml-auto flex-wrap">
            {NAV.map(([to, label]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/app'}
                className={({ isActive }) => `px-4 py-1.5 rounded-sm transition-colors ${isActive ? 'font-medium' : ''}`}
                style={({ isActive }) => ({
                  color: isActive ? 'var(--ink)' : 'var(--mut)',
                  background: isActive ? 'var(--hero)' : 'transparent',
                })}
              >
                {label}
              </NavLink>
            ))}
            <Link to="/" className="ml-3 px-4 py-1.5 rounded-sm text-sm" style={{ color: '#fff', background: 'var(--ink)' }}>
              ← Landing
            </Link>
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto w-full px-8 py-10 flex-1">{children}</main>
      <footer className="py-5 mt-10" style={{ borderTop: '1px solid var(--line)', background: 'rgba(252,250,246,0.6)' }}>
        <div className="max-w-6xl mx-auto px-8 flex items-center justify-between text-xs" style={{ color: 'var(--mut)' }}>
          <p className="font-mono">call-autopsy · post-call failure analysis</p>
          <p className="font-mono">STT · LLM · TTS · every failure with a cause of death</p>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ConnectionStatus />
      <Routes>
        <Route path="/" element={<LandingHome />} />
        {/* These pages carry their own case-file chrome (own topbar + header) */}
        <Route path="/app" element={<Dashboard />} />
        <Route path="/analyze" element={<Analyze />} />
        <Route path="/ab" element={<AB />} />
        <Route path="/ops" element={<Ops />} />
        {/* Call detail / replay use the legacy Shell */}
        <Route path="/calls/:id" element={<Shell><CallDetail /></Shell>} />
        <Route path="/calls/:id/replay" element={<Shell><Replay /></Shell>} />

        {/* Old routes → redirect into the grouped pages */}
        <Route path="/calibration" element={<Navigate replace to="/analyze?tab=calibration" />} />
        <Route path="/blast-radius" element={<Navigate replace to="/analyze?tab=blast-radius" />} />
        <Route path="/hallucination" element={<Navigate replace to="/analyze?tab=hallucination" />} />
        <Route path="/sla" element={<Navigate replace to="/ops?tab=sla" />} />
        <Route path="/healing" element={<Navigate replace to="/ops?tab=healing" />} />
        <Route path="/legacy" element={<Navigate replace to="/app" />} />
        <Route path="/samples" element={<Navigate replace to="/app" />} />
        <Route path="/cases" element={<Navigate replace to="/app" />} />
      </Routes>
    </BrowserRouter>
  );
}
