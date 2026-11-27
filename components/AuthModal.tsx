import React, { useState } from 'react';
import type { AuthSessionResponse, AuthUser } from '../types';
import {
  confirmPasswordResetClient,
  requestPasswordResetClient,
  signInClient,
  signOutClient,
  signUpClient,
} from '../services/platformService';

interface AuthModalProps {
  isOpen: boolean;
  user: AuthUser | null;
  onClose: () => void;
  onAuthSuccess: (session: AuthSessionResponse) => void;
}

type AuthTab = 'signin' | 'signup' | 'reset';

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, user, onClose, onAuthSuccess }) => {
  const [tab, setTab] = useState<AuthTab>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [issuedCodeNotice, setIssuedCodeNotice] = useState<string | null>(null);
  const [resetRequested, setResetRequested] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const session = await signInClient({ email, password });
      onAuthSuccess(session);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const session = await signUpClient({ fullName, email, password });
      onAuthSuccess(session);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Account creation failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await requestPasswordResetClient(email);
      setResetRequested(true);
      setIssuedCodeNotice(
        res.resetCode
          ? `${res.message} One-time verification code: ${res.resetCode}`
          : res.message
      );
    } catch (err: any) {
      setError(err?.message || 'Could not request reset.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await confirmPasswordResetClient({
        email,
        resetCode,
        newPassword: password,
      });
      setSuccessMsg(res.message);
      setTab('signin');
      setPassword('');
      setResetCode('');
      setResetRequested(false);
      setIssuedCodeNotice(null);
    } catch (err: any) {
      setError(err?.message || 'Could not verify code.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await signOutClient();
      onAuthSuccess(session);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Sign out failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="w-full max-w-md rounded-2xl lm-surface shadow-2xl overflow-hidden">
        <div
          className="px-6 py-4 border-b flex items-center justify-between"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div>
            <h2 className="font-editorial font-semibold text-xl" style={{ color: 'var(--text-primary)' }}>
              {user ? 'Learner Account' : tab === 'signup' ? 'Create Account' : tab === 'reset' ? 'Reset Password' : 'Sign In'}
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {user
                ? 'Your progress, assessments, study plan & code history sync automatically.'
                : 'Save lessons, adaptive mastery, study schedules, and playground progress.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full lm-btn-outline flex items-center justify-center"
            style={{ color: 'var(--text-secondary)' }}
            aria-label="Close account modal"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="p-6 space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-xs font-medium text-red-400">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="p-3 rounded-xl lm-accent-soft text-xs font-medium">
              {successMsg}
            </div>
          )}

          {user ? (
            <div className="space-y-4">
              <div className="p-4 rounded-xl lm-inset space-y-1.5">
                <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Signed in as
                </div>
                <div className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>
                  {user.fullName}
                </div>
                <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {user.email}
                </div>
              </div>

              <button
                onClick={handleSignOut}
                disabled={loading}
                className="w-full py-3 rounded-full bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 text-sm font-semibold transition-colors disabled:opacity-45"
              >
                {loading ? 'Signing out...' : 'Sign Out'}
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-full lm-inset">
                {(['signin', 'signup', 'reset'] as AuthTab[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setTab(t);
                      setError(null);
                      setSuccessMsg(null);
                    }}
                    className={`py-2 rounded-full text-xs font-semibold transition-colors ${
                      tab === t ? 'lm-tab-active' : ''
                    }`}
                    style={tab === t ? undefined : { color: 'var(--text-secondary)' }}
                  >
                    {t === 'signin' ? 'Sign In' : t === 'signup' ? 'Sign Up' : 'Reset'}
                  </button>
                ))}
              </div>

              {tab === 'signin' && (
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full px-4 py-2.5 rounded-full lm-inset lm-input text-sm outline-none"
                      style={{ color: 'var(--text-primary)' }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      className="w-full px-4 py-2.5 rounded-full lm-inset lm-input text-sm outline-none"
                      style={{ color: 'var(--text-primary)' }}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 rounded-full lm-btn-primary text-sm font-semibold disabled:opacity-45"
                  >
                    {loading ? 'Signing in...' : 'Sign In'}
                  </button>
                </form>
              )}

              {tab === 'signup' && (
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      minLength={2}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Priya Sundaram"
                      className="w-full px-4 py-2.5 rounded-full lm-inset lm-input text-sm outline-none"
                      style={{ color: 'var(--text-primary)' }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                      Email Address
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full px-4 py-2.5 rounded-full lm-inset lm-input text-sm outline-none"
                      style={{ color: 'var(--text-primary)' }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                      Password
                    </label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      className="w-full px-4 py-2.5 rounded-full lm-inset lm-input text-sm outline-none"
                      style={{ color: 'var(--text-primary)' }}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 rounded-full lm-btn-primary text-sm font-semibold disabled:opacity-45"
                  >
                    {loading ? 'Creating account...' : 'Create Account & Sync Progress'}
                  </button>
                </form>
              )}

              {tab === 'reset' && (
                <form
                  onSubmit={resetRequested ? handleConfirmReset : handleRequestReset}
                  className="space-y-4"
                >
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                      Account Email
                    </label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full px-4 py-2.5 rounded-full lm-inset lm-input text-sm outline-none"
                      style={{ color: 'var(--text-primary)' }}
                    />
                  </div>

                  {issuedCodeNotice && (
                    <div className="p-3 rounded-xl lm-accent-soft text-xs leading-relaxed">
                      {issuedCodeNotice}
                    </div>
                  )}

                  {resetRequested && (
                    <>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                          Recovery Verification Code
                        </label>
                        <input
                          type="text"
                          required
                          value={resetCode}
                          onChange={(e) => setResetCode(e.target.value)}
                          placeholder="Enter 12-char code"
                          className="w-full px-4 py-2.5 rounded-full lm-inset lm-input text-sm font-mono uppercase outline-none"
                          style={{ color: 'var(--text-primary)' }}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                          New Password
                        </label>
                        <input
                          type="password"
                          required
                          minLength={8}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Minimum 8 characters"
                          className="w-full px-4 py-2.5 rounded-full lm-inset lm-input text-sm outline-none"
                          style={{ color: 'var(--text-primary)' }}
                        />
                      </div>
                    </>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3 rounded-full lm-btn-primary text-sm font-semibold disabled:opacity-45"
                  >
                    {loading
                      ? 'Processing...'
                      : resetRequested
                        ? 'Confirm New Password'
                        : 'Request Recovery Code'}
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
