import React, { useState, useMemo } from 'react';
import { useAuth } from './contexts/AuthContext';

const PW_RULES = [
  { key: 'length', label: 'At least 8 characters', test: pw => pw.length >= 8 },
  { key: 'upper', label: 'One uppercase letter', test: pw => /[A-Z]/.test(pw) },
  { key: 'lower', label: 'One lowercase letter', test: pw => /[a-z]/.test(pw) },
  { key: 'number', label: 'One number', test: pw => /[0-9]/.test(pw) },
  { key: 'special', label: 'One special character (!@#$%^&*)', test: pw => /[!@#$%^&*]/.test(pw) },
];

function getStrength(passed) {
  if (passed <= 2) return { level: 'weak', label: 'Weak', color: '#d63031' };
  if (passed <= 4) return { level: 'medium', label: 'Medium', color: '#fdcb6e' };
  return { level: 'strong', label: 'Strong', color: '#00b894' };
}

export default function LoginPage() {
  const { login, signup, googleSignIn, resetPassword } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const ruleResults = useMemo(() => PW_RULES.map(r => ({ ...r, passed: r.test(password) })), [password]);
  const passedCount = ruleResults.filter(r => r.passed).length;
  const strength = getStrength(passedCount);
  const allPassed = passedCount === PW_RULES.length;

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');

    if (isSignUp) {
      if (!allPassed) {
        return setError('Password does not meet all requirements.');
      }
      if (password !== confirmPassword) {
        return setError('Passwords do not match.');
      }
    } else {
      if (password.length < 1) {
        return setError('Please enter your password.');
      }
    }

    setSubmitting(true);
    try {
      if (isSignUp) {
        await signup(email, password);
        setMessage('Verification email sent to ' + email + '. Check your inbox and click the link to verify your account.');
      } else {
        await login(email, password);
      }
    } catch (err) {
      const code = err.code || '';
      if (code === 'auth/user-not-found' || code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('Invalid email or password.');
      } else if (code === 'auth/email-already-in-use') {
        setError('An account with this email already exists.');
      } else if (code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else {
        setError(err.message);
      }
    }
    setSubmitting(false);
  }

  async function handleForgotPassword(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!resetEmail.trim()) {
      return setError('Please enter your email address.');
    }
    setSubmitting(true);
    try {
      await resetPassword(resetEmail.trim());
      setMessage(`Password reset email sent to ${resetEmail.trim()}. Check your inbox.`);
    } catch (err) {
      const code = err.code || '';
      if (code === 'auth/user-not-found') {
        setError('No account found with this email address.');
      } else if (code === 'auth/invalid-email') {
        setError('Please enter a valid email address.');
      } else {
        setError(err.message);
      }
    }
    setSubmitting(false);
  }

  async function handleGoogle() {
    setError('');
    setMessage('');
    try {
      await googleSignIn();
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setError('Google sign-in failed. Please try again.');
      }
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h1><span className="logo-bold">SLR</span> <span className="logo-light">Screener</span></h1>
          <p className="login-subtitle">Systematic Literature Review Screening Platform</p>
        </div>

        <button className="login-google-btn" onClick={handleGoogle} type="button">
          <svg viewBox="0 0 24 24" width="18" height="18" className="login-google-icon">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </button>

        {isForgotPassword ? (
          <>
            <div className="login-divider"><span>Reset Password</span></div>
            <form onSubmit={handleForgotPassword} className="login-form">
              <input
                type="email"
                placeholder="Email address"
                className="login-input"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                required
                autoComplete="email"
              />
              {error && <div className="login-error">{error}</div>}
              {message && <div className="login-message">{message}</div>}
              <button type="submit" className="login-submit-btn" disabled={submitting}>
                {submitting ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
            <div className="login-toggle">
              <button className="login-toggle-btn" onClick={() => { setIsForgotPassword(false); setError(''); setMessage(''); }}>Back to Sign In</button>
            </div>
          </>
        ) : (
          <>
        <div className="login-divider">
          <span>or</span>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <input
            type="email"
            placeholder="Email address"
            className="login-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />

          <div className="login-pw-wrapper">
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              className="login-input login-input-pw"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
            />
            <button
              type="button"
              className="login-pw-toggle"
              onClick={() => setShowPassword(v => !v)}
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                  <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>

          {!isSignUp && (
            <div className="login-forgot">
              <button type="button" className="login-toggle-btn" onClick={() => { setIsForgotPassword(true); setResetEmail(email); setError(''); setMessage(''); }}>Forgot Password?</button>
            </div>
          )}

          {isSignUp && password.length > 0 && (
            <div className="pw-strength">
              <div className="pw-strength-bar">
                <div
                  className={`pw-strength-fill pw-${strength.level}`}
                  style={{ width: `${(passedCount / PW_RULES.length) * 100}%` }}
                />
              </div>
              <span className={`pw-strength-label pw-${strength.level}`}>{strength.label}</span>
            </div>
          )}

          {isSignUp && password.length > 0 && (
            <ul className="pw-rules">
              {ruleResults.map(r => (
                <li key={r.key} className={r.passed ? 'pw-rule-pass' : 'pw-rule-fail'}>
                  <span className="pw-rule-icon">{r.passed ? '\u2713' : '\u2717'}</span>
                  {r.label}
                </li>
              ))}
            </ul>
          )}

          {isSignUp && (
            <div className="login-pw-wrapper">
              <input
                type={showConfirm ? 'text' : 'password'}
                placeholder="Confirm password"
                className="login-input login-input-pw"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
              />
              <button
                type="button"
                className="login-pw-toggle"
                onClick={() => setShowConfirm(v => !v)}
                tabIndex={-1}
                aria-label={showConfirm ? 'Hide confirm password' : 'Show confirm password'}
              >
                {showConfirm ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>
          )}

          {error && <div className="login-error">{error}</div>}
          {message && <div className="login-message">{message}</div>}

          <button type="submit" className="login-submit-btn" disabled={submitting}>
            {submitting ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>

        <div className="login-toggle">
          {isSignUp ? (
            <span>Already have an account? <button className="login-toggle-btn" onClick={() => { setIsSignUp(false); setError(''); setMessage(''); }}>Sign In</button></span>
          ) : (
            <span>Don't have an account? <button className="login-toggle-btn" onClick={() => { setIsSignUp(true); setError(''); setMessage(''); }}>Sign Up</button></span>
          )}
        </div>
          </>
        )}
      </div>
    </div>
  );
}
