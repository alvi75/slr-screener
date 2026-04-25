import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../App';
import LoginPage from '../LoginPage';
import { setupFetchMock, clearStorage, MOCK_PAPERS, createAuthMock, renderApp } from '../testHelpers';

// Default: not authenticated (renders LoginPage)
const mockAuth = createAuthMock({ currentUser: null });

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('../services/firestore', () => ({
  saveProject: jest.fn(() => Promise.resolve()),
  getProject: jest.fn(() => Promise.resolve({ id: 'test', name: 'Test' })),
  getProjects: jest.fn(() => Promise.resolve([])),
  deleteProject: jest.fn(() => Promise.resolve()),
  saveDecision: jest.fn(() => Promise.resolve()),
  deleteDecision: jest.fn(() => Promise.resolve()),
  getDecisions: jest.fn(() => Promise.resolve({})),
  saveAllDecisions: jest.fn(() => Promise.resolve()),
  saveAIScore: jest.fn(() => Promise.resolve()),
  saveAllAIScores: jest.fn(() => Promise.resolve()),
  getAIScores: jest.fn(() => Promise.resolve({})),
  syncDecisionsToFirestore: jest.fn(),
  syncAIScoresToFirestore: jest.fn(),
  syncProjectToFirestore: jest.fn(),
  saveProjectMeta: jest.fn(() => Promise.resolve()),
  getProjectMeta: jest.fn(() => Promise.resolve(null)),
  addCollaborator: jest.fn(() => Promise.resolve()),
  removeCollaborator: jest.fn(() => Promise.resolve()),
  updateCollaboratorRole: jest.fn(() => Promise.resolve()),
  getCollaborators: jest.fn(() => Promise.resolve([])),
  acceptInvite: jest.fn(() => Promise.resolve()),
  declineInvite: jest.fn(() => Promise.resolve()),
  getSharedProjects: jest.fn(() => Promise.resolve([])),
  saveFinalDecision: jest.fn(() => Promise.resolve()),
  getFinalDecisions: jest.fn(() => Promise.resolve({})),
  deleteFinalDecision: jest.fn(() => Promise.resolve()),
  saveAIDisagreement: jest.fn(() => Promise.resolve()),
  getAIDisagreements: jest.fn(() => Promise.resolve({})),
  deleteAIDisagreement: jest.fn(() => Promise.resolve()),
  getUserProfile: jest.fn(() => Promise.resolve({ displayName: 'Test User', nameConfirmed: true })),
  saveUserProfile: jest.fn(() => Promise.resolve()),
  migrateDecisionsToSharedProject: jest.fn(() => Promise.resolve(0)),
  migrateAIScoresToSharedProject: jest.fn(() => Promise.resolve(0)),
  saveNotification: jest.fn(() => Promise.resolve()),
  markNotificationRead: jest.fn(() => Promise.resolve()),
  markAllNotificationsRead: jest.fn(() => Promise.resolve()),
  subscribeToNotifications: jest.fn(() => () => {}),
  subscribeToDecisions: jest.fn(() => () => {}),
  deleteAllDecisions: jest.fn(() => Promise.resolve()),
}));

jest.mock('xlsx', () => ({
  read: jest.fn(),
  utils: { sheet_to_json: jest.fn() },
}));

beforeEach(() => {
  jest.useFakeTimers();
  clearStorage();
  setupFetchMock();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  // Reset to unauthenticated by default
  mockAuth.currentUser = null;
  mockAuth.loading = false;
  mockAuth.resendVerification = jest.fn(() => Promise.resolve());
  mockAuth.reloadUser = jest.fn(() => Promise.resolve());
  mockAuth.logout = jest.fn();
  mockAuth.googleSignIn = jest.fn(() => Promise.resolve());
  mockAuth.resetPassword = jest.fn(() => Promise.resolve());
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Auth Flow', () => {
  test('Login page renders when user is not authenticated', () => {
    renderApp(App);
    expect(screen.getByText('SLR')).toBeInTheDocument();
    expect(screen.getByText('Screener')).toBeInTheDocument();
    expect(screen.getByText('Sign in with Google')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Email address')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
  });

  test('Login page shows sign-up form when toggled', () => {
    renderApp(App);

    fireEvent.click(screen.getByText('Sign Up'));

    expect(screen.getByPlaceholderText('Confirm password')).toBeInTheDocument();
    expect(screen.getByText('Create Account')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Sign In'));
    expect(screen.queryByPlaceholderText('Confirm password')).not.toBeInTheDocument();
  });

  test('Sign-up form shows error when passwords do not match', async () => {
    renderApp(App);

    fireEvent.click(screen.getByText('Sign Up'));

    fireEvent.change(screen.getByPlaceholderText('Email address'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'Strong1!' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'Different2@' } });

    fireEvent.submit(screen.getByPlaceholderText('Email address').closest('form'));

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    });
  });

  test('Sign-up form shows error when password does not meet requirements', async () => {
    renderApp(App);

    fireEvent.click(screen.getByText('Sign Up'));

    fireEvent.change(screen.getByPlaceholderText('Email address'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'weak' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'weak' } });

    fireEvent.submit(screen.getByPlaceholderText('Email address').closest('form'));

    await waitFor(() => {
      expect(screen.getByText('Password does not meet all requirements.')).toBeInTheDocument();
    });
  });

  test('Password strength indicator shows weak/medium/strong', () => {
    renderApp(App);
    fireEvent.click(screen.getByText('Sign Up'));

    // Weak password
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'ab' } });
    expect(screen.getByText('Weak')).toBeInTheDocument();

    // Medium password
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'Abc123' } });
    expect(screen.getByText('Medium')).toBeInTheDocument();

    // Strong password
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'Abc123!x' } });
    expect(screen.getByText('Strong')).toBeInTheDocument();
  });

  test('Password validation hints update in real-time', () => {
    renderApp(App);
    fireEvent.click(screen.getByText('Sign Up'));

    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'a' } });

    // Should show all 5 rules
    const rules = document.querySelectorAll('.pw-rules li');
    expect(rules.length).toBe(5);

    // Only lowercase should pass
    const passed = document.querySelectorAll('.pw-rule-pass');
    const failed = document.querySelectorAll('.pw-rule-fail');
    expect(passed.length).toBe(1); // lowercase
    expect(failed.length).toBe(4);

    // Type a strong password — all should pass
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'Abcdef1!' } });
    const allPassed = document.querySelectorAll('.pw-rule-pass');
    expect(allPassed.length).toBe(5);
  });

  test('Show/hide password toggle works', () => {
    renderApp(App);

    const pwInput = screen.getByPlaceholderText('Password');
    expect(pwInput.type).toBe('password');

    // Click the eye toggle
    const toggle = screen.getByLabelText('Show password');
    fireEvent.click(toggle);
    expect(pwInput.type).toBe('text');

    // Click again to hide
    const hideToggle = screen.getByLabelText('Hide password');
    fireEvent.click(hideToggle);
    expect(pwInput.type).toBe('password');
  });

  test('Validation hints hidden during sign-in mode', () => {
    renderApp(App);

    // In sign-in mode, type a password
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'test' } });

    // No strength indicator or rules should show
    expect(document.querySelector('.pw-strength')).toBeNull();
    expect(document.querySelector('.pw-rules')).toBeNull();
  });

  test('Google sign-in button calls googleSignIn', () => {
    renderApp(App);

    const googleBtn = screen.getByText('Sign in with Google');
    fireEvent.click(googleBtn);

    expect(mockAuth.googleSignIn).toHaveBeenCalled();
  });

  test('App renders screener when user is verified', async () => {
    mockAuth.currentUser = { uid: 'test-uid-123', email: 'test@example.com', displayName: 'Test User', photoURL: null, emailVerified: true, providerData: [{ providerId: 'password' }] };

    renderApp(App);

    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    expect(screen.getByText('Sign Out')).toBeInTheDocument();
  });

  test('Loading state shows loading indicator', () => {
    mockAuth.loading = true;

    renderApp(App);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  test('Header shows user avatar placeholder when no photoURL', async () => {
    mockAuth.currentUser = { uid: 'test-uid-123', email: 'test@example.com', displayName: 'Test User', photoURL: null, emailVerified: true, providerData: [{ providerId: 'password' }] };

    renderApp(App);

    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    const placeholder = document.querySelector('.header-avatar-placeholder');
    expect(placeholder).not.toBeNull();
    expect(placeholder.textContent).toBe('T');
  });

  test('Unverified email user sees verification screen with countdown', () => {
    mockAuth.currentUser = { uid: 'test-uid-123', email: 'unverified@example.com', displayName: 'Test User', photoURL: null, emailVerified: false, providerData: [{ providerId: 'password' }] };

    renderApp(App);

    expect(screen.getByText('Check Your Email')).toBeInTheDocument();
    expect(screen.getByText(/unverified@example.com/)).toBeInTheDocument();
    expect(screen.getByText('Checking verification status...')).toBeInTheDocument();
    expect(screen.getByText('Use Google sign-in instead')).toBeInTheDocument();
    expect(screen.getByText('Sign out and use a different account')).toBeInTheDocument();
    // Resend button should show countdown initially
    expect(screen.getByText(/Resend available in 60s/)).toBeInTheDocument();
  });

  test('Countdown timer ticks down and enables resend', () => {
    mockAuth.currentUser = { uid: 'test-uid-123', email: 'unverified@example.com', displayName: 'Test User', photoURL: null, emailVerified: false, providerData: [{ providerId: 'password' }] };

    renderApp(App);

    expect(screen.getByText(/Resend available in 60s/)).toBeInTheDocument();

    // Advance 30 seconds
    act(() => { jest.advanceTimersByTime(30000); });
    expect(screen.getByText(/Resend available in 30s/)).toBeInTheDocument();

    // Advance remaining 30 seconds
    act(() => { jest.advanceTimersByTime(30000); });
    expect(screen.getByText('Resend Verification Email')).toBeInTheDocument();
    expect(screen.getByText('Resend Verification Email')).not.toBeDisabled();
  });

  test('Resend button calls resendVerification and resets countdown', async () => {
    mockAuth.currentUser = { uid: 'test-uid-123', email: 'unverified@example.com', displayName: 'Test User', photoURL: null, emailVerified: false, providerData: [{ providerId: 'password' }] };

    renderApp(App);

    // Expire the countdown
    act(() => { jest.advanceTimersByTime(60000); });
    expect(screen.getByText('Resend Verification Email')).not.toBeDisabled();

    // Click resend
    await act(async () => {
      fireEvent.click(screen.getByText('Resend Verification Email'));
    });

    expect(mockAuth.resendVerification).toHaveBeenCalled();
    expect(screen.getByText('Verification email sent! Check your inbox.')).toBeInTheDocument();
    // Countdown should reset
    expect(screen.getByText(/Resend available in 60s/)).toBeInTheDocument();
  });

  test('Auto-poll calls reloadUser every 5 seconds', () => {
    mockAuth.currentUser = { uid: 'test-uid-123', email: 'unverified@example.com', displayName: 'Test User', photoURL: null, emailVerified: false, providerData: [{ providerId: 'password' }] };

    renderApp(App);

    expect(mockAuth.reloadUser).not.toHaveBeenCalled();

    // Advance 5 seconds — first poll
    act(() => { jest.advanceTimersByTime(5000); });
    expect(mockAuth.reloadUser).toHaveBeenCalledTimes(1);

    // Advance another 5 seconds — second poll
    act(() => { jest.advanceTimersByTime(5000); });
    expect(mockAuth.reloadUser).toHaveBeenCalledTimes(2);
  });

  test('Google sign-in button on verification screen calls googleSignIn', async () => {
    mockAuth.currentUser = { uid: 'test-uid-123', email: 'unverified@example.com', displayName: 'Test User', photoURL: null, emailVerified: false, providerData: [{ providerId: 'password' }] };

    renderApp(App);

    await act(async () => {
      fireEvent.click(screen.getByText('Use Google sign-in instead'));
    });

    expect(mockAuth.googleSignIn).toHaveBeenCalled();
  });

  test('Google sign-in users bypass email verification', async () => {
    mockAuth.currentUser = { uid: 'test-uid-123', email: 'google@example.com', displayName: 'Google User', photoURL: 'https://photo.url', emailVerified: true, providerData: [{ providerId: 'google.com' }] };

    renderApp(App);

    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });
  });

  test('Sign out from verification screen calls logout', () => {
    mockAuth.currentUser = { uid: 'test-uid-123', email: 'unverified@example.com', displayName: 'Test User', photoURL: null, emailVerified: false, providerData: [{ providerId: 'password' }] };

    renderApp(App);

    fireEvent.click(screen.getByText('Sign out and use a different account'));

    expect(mockAuth.logout).toHaveBeenCalled();
  });

  test('Forgot Password link shows reset form', () => {
    renderApp(App);

    fireEvent.click(screen.getByText('Forgot Password?'));

    expect(screen.getByText('Reset Password')).toBeInTheDocument();
    expect(screen.getByText('Send Reset Link')).toBeInTheDocument();
    expect(screen.getByText('Back to Sign In')).toBeInTheDocument();
    // Password field should not be visible
    expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument();
  });

  test('Forgot Password sends reset email and shows success', async () => {
    renderApp(App);

    fireEvent.click(screen.getByText('Forgot Password?'));
    fireEvent.change(screen.getByPlaceholderText('Email address'), { target: { value: 'reset@example.com' } });

    await act(async () => {
      fireEvent.submit(screen.getByPlaceholderText('Email address').closest('form'));
    });

    expect(mockAuth.resetPassword).toHaveBeenCalledWith('reset@example.com');
    expect(screen.getByText('Password reset email sent to reset@example.com. Check your inbox.')).toBeInTheDocument();
  });

  test('Forgot Password shows error for invalid email', async () => {
    mockAuth.resetPassword = jest.fn(() => Promise.reject({ code: 'auth/invalid-email' }));

    renderApp(App);

    fireEvent.click(screen.getByText('Forgot Password?'));
    fireEvent.change(screen.getByPlaceholderText('Email address'), { target: { value: 'bad-email' } });

    await act(async () => {
      fireEvent.submit(screen.getByPlaceholderText('Email address').closest('form'));
    });

    expect(screen.getByText('Please enter a valid email address.')).toBeInTheDocument();
  });

  test('Back to Sign In returns from forgot password view', () => {
    renderApp(App);

    fireEvent.click(screen.getByText('Forgot Password?'));
    expect(screen.getByText('Reset Password')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Back to Sign In'));
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.queryByText('Reset Password')).not.toBeInTheDocument();
  });
});
