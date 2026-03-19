import React, { useState } from 'react';
import { useAuth } from './contexts/AuthContext';

export default function LoginPage() {
  const { login, signup, googleSignIn } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');

    if (isSignUp && password !== confirmPassword) {
      return setError('Passwords do not match.');
    }
    if (password.length < 6) {
      return setError('Password must be at least 6 characters.');
    }

    setSubmitting(true);
    try {
      if (isSignUp) {
        await signup(email, password);
        setMessage('Account created! A verification email has been sent to ' + email + '.');
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
          <input
            type="password"
            placeholder="Password"
            className="login-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
          />
          {isSignUp && (
            <input
              type="password"
              placeholder="Confirm password"
              className="login-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
            />
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
      </div>
    </div>
  );
}
