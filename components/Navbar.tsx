import React from 'react';
import type { AuthUser, ThemeMode, WorkspaceView } from '../types';

interface NavbarProps {
  activeView: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  user: AuthUser | null;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onOpenAuth: () => void;
  onOpenPreferences: () => void;
  dueRevisionsCount?: number;
}

const NAV_ITEMS: Array<{ id: WorkspaceView; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: 'fa-compass' },
  { id: 'tutor', label: 'AI Tutor', icon: 'fa-chalkboard-user' },
  { id: 'playground', label: 'Playground', icon: 'fa-code' },
  { id: 'planner', label: 'Study Plan', icon: 'fa-calendar-check' },
];

const Navbar: React.FC<NavbarProps> = ({
  activeView,
  onNavigate,
  user,
  theme,
  onToggleTheme,
  onOpenAuth,
  onOpenPreferences,
  dueRevisionsCount = 0,
}) => {
  return (
    <header
      className="sticky top-0 z-40 border-b backdrop-blur-xl transition-colors"
      style={{
        backgroundColor: 'var(--header-bg)',
        borderColor: 'var(--border-subtle)',
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        {/* Left: Editorial Wordmark */}
        <button
          onClick={() => onNavigate('dashboard')}
          className="flex items-center gap-3 text-left shrink-0 focus:outline-none group"
        >
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center border transition-transform group-hover:scale-105"
            style={{
              backgroundColor: 'var(--btn-primary-bg)',
              color: 'var(--btn-primary-text)',
              borderColor: 'var(--border-strong)',
            }}
          >
            <i className="fa-solid fa-graduation-cap text-sm"></i>
          </span>
          <div>
            <div className="flex items-center gap-2">
              <span
                className="font-display font-semibold text-base leading-tight tracking-tight"
                style={{ color: 'var(--text-primary)' }}
              >
                Language Mentor
              </span>
              <span className="lm-neon-dot shrink-0" title="Adaptive Tutor Online" aria-hidden="true"></span>
            </div>
            <div
              className="text-[11px] font-ui font-medium hidden sm:block tracking-wide"
              style={{ color: 'var(--text-muted)' }}
            >
              Adaptive Multilingual Platform
            </div>
          </div>
        </button>

        {/* Center: Primary Navigation Pill Rail */}
        <nav
          className="hidden md:flex items-center gap-1 p-1 rounded-full lm-inset"
          aria-label="Primary Workspace"
        >
          {NAV_ITEMS.map((item) => {
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-ui font-medium transition-all flex items-center gap-2 whitespace-nowrap ${
                  active ? 'lm-tab-active shadow-sm' : 'hover:opacity-100 opacity-75'
                }`}
                style={active ? undefined : { color: 'var(--text-secondary)' }}
              >
                <i className={`fa-solid ${item.icon} text-xs`}></i>
                <span>{item.label}</span>
                {item.id === 'planner' && dueRevisionsCount > 0 && (
                  <span
                    className={`ml-0.5 text-[11px] px-1.5 py-0.5 rounded-full font-mono tabular-nums ${
                      active ? 'bg-black/20' : 'bg-amber-500/20 text-amber-400'
                    }`}
                  >
                    {dueRevisionsCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Right: Theme + Preferences + Account CTA */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onToggleTheme}
            className="w-9 h-9 rounded-full lm-btn-outline flex items-center justify-center"
            style={{ color: 'var(--text-secondary)' }}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle color theme"
          >
            <i className={`fa-solid ${theme === 'dark' ? 'fa-sun' : 'fa-moon'} text-xs`}></i>
          </button>

          <button
            onClick={onOpenPreferences}
            className="w-9 h-9 rounded-full lm-btn-outline flex items-center justify-center"
            style={{ color: 'var(--text-secondary)' }}
            title="Learning preferences & profile"
            aria-label="Learning preferences"
          >
            <i className="fa-solid fa-sliders text-xs"></i>
          </button>

          <button
            onClick={onOpenAuth}
            className="h-9 px-4 rounded-full lm-btn-primary text-xs sm:text-sm font-ui font-medium flex items-center gap-2 whitespace-nowrap"
          >
            <i className={`fa-solid ${user ? 'fa-user-check' : 'fa-right-to-bracket'} text-xs`}></i>
            <span className="max-w-[120px] truncate">{user ? user.fullName.split(' ')[0] : 'Sign In'}</span>
          </button>
        </div>
      </div>

      {/* Mobile Navigation Strip */}
      <nav
        className="flex md:hidden border-t overflow-x-auto no-scrollbar px-2 py-1.5 gap-1"
        style={{ borderColor: 'var(--border-subtle)' }}
        aria-label="Mobile Workspace"
      >
        {NAV_ITEMS.map((item) => {
          const active = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              className={`flex-1 min-w-[84px] py-2 px-2 rounded-full text-xs font-ui font-medium flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors ${
                active ? 'lm-tab-active' : ''
              }`}
              style={active ? undefined : { color: 'var(--text-secondary)' }}
            >
              <i className={`fa-solid ${item.icon}`}></i>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </header>
  );
};

export default Navbar;
