import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../App';
import LoginPage from '../LoginPage';
import { setupFetchMock, clearStorage, MOCK_PAPERS, createAuthMock } from '../testHelpers';

// Default: not authenticated (renders LoginPage)
const mockAuth = createAuthMock({ currentUser: null });

jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

jest.mock('xlsx', () => ({
  read: jest.fn(),
  utils: { sheet_to_json: jest.fn() },
}));

beforeEach(() => {
  clearStorage();
  setupFetchMock();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  // Reset to unauthenticated by default
  mockAuth.currentUser = null;
  mockAuth.loading = false;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Auth Flow', () => {
  test('Login page renders when user is not authenticated', () => {
    render(<App />);
    expect(screen.getByText('SLR')).toBeInTheDocument();
    expect(screen.getByText('Screener')).toBeInTheDocument();
    expect(screen.getByText('Sign in with Google')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Email address')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
  });

  test('Login page shows sign-up form when toggled', () => {
    render(<App />);

    // Click "Sign Up" toggle
    fireEvent.click(screen.getByText('Sign Up'));

    // Should show confirm password field
    expect(screen.getByPlaceholderText('Confirm password')).toBeInTheDocument();
    expect(screen.getByText('Create Account')).toBeInTheDocument();

    // Toggle back to sign-in
    fireEvent.click(screen.getByText('Sign In'));
    expect(screen.queryByPlaceholderText('Confirm password')).not.toBeInTheDocument();
  });

  test('Sign-up form shows error when passwords do not match', async () => {
    render(<App />);

    // Switch to sign-up mode
    fireEvent.click(screen.getByText('Sign Up'));

    // Fill in mismatched passwords
    fireEvent.change(screen.getByPlaceholderText('Email address'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'different456' } });

    // Submit
    fireEvent.submit(screen.getByPlaceholderText('Email address').closest('form'));

    await waitFor(() => {
      expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    });
  });

  test('Sign-in form shows error for short password', async () => {
    render(<App />);

    fireEvent.change(screen.getByPlaceholderText('Email address'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: '123' } });

    fireEvent.submit(screen.getByPlaceholderText('Email address').closest('form'));

    await waitFor(() => {
      expect(screen.getByText('Password must be at least 6 characters.')).toBeInTheDocument();
    });
  });

  test('Google sign-in button calls googleSignIn', () => {
    render(<App />);

    const googleBtn = screen.getByText('Sign in with Google');
    fireEvent.click(googleBtn);

    expect(mockAuth.googleSignIn).toHaveBeenCalled();
  });

  test('App renders screener when user is authenticated', async () => {
    // Set authenticated user
    mockAuth.currentUser = { uid: 'test-uid-123', email: 'test@example.com', displayName: 'Test User', photoURL: null };

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Should show Sign Out button
    expect(screen.getByText('Sign Out')).toBeInTheDocument();
  });

  test('Loading state shows loading indicator', () => {
    mockAuth.loading = true;

    render(<App />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  test('Header shows user avatar placeholder when no photoURL', async () => {
    mockAuth.currentUser = { uid: 'test-uid-123', email: 'test@example.com', displayName: 'Test User', photoURL: null };

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Should show first letter of email as avatar placeholder
    const placeholder = document.querySelector('.header-avatar-placeholder');
    expect(placeholder).not.toBeNull();
    expect(placeholder.textContent).toBe('T');
  });
});
