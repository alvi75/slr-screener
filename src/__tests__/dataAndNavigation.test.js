import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../App';
import { setupFetchMock, clearStorage, MOCK_PAPERS, renderApp } from '../testHelpers';

// Mock auth so the app renders the screener instead of LoginPage
jest.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { uid: 'test-uid-123', email: 'test@example.com', displayName: 'Test User', photoURL: null, emailVerified: true, providerData: [{ providerId: 'password' }] },
    logout: jest.fn(),
    resendVerification: jest.fn(),
    reloadUser: jest.fn(),
    loading: false,
  }),
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
}));

// Mock xlsx to avoid issues in test environment
jest.mock('xlsx', () => ({
  read: jest.fn(),
  utils: { sheet_to_json: jest.fn() },
}));

beforeEach(() => {
  clearStorage();
  setupFetchMock();
  // Suppress console.log noise from the app
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Data & Navigation', () => {
  test('App loads and displays first paper from demo data', async () => {
    renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });
    expect(screen.getByText(MOCK_PAPERS[0].author)).toBeInTheDocument();
    expect(screen.getByText(/1 of 5/)).toBeInTheDocument();
  });

  test('Right arrow key advances to next paper', async () => {
    renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'ArrowRight' });

    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[1].title)).toBeInTheDocument();
    });
    expect(screen.getByText(/2 of 5/)).toBeInTheDocument();
  });

  test('Left arrow key goes to previous paper', async () => {
    renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Go forward first
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[1].title)).toBeInTheDocument();
    });

    // Go back
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });
  });

  test('Previous/Next buttons navigate correctly', async () => {
    renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Previous should be disabled on first paper
    const prevBtn = screen.getByText(/Previous/);
    expect(prevBtn).toBeDisabled();

    // Click Next
    const nextBtn = screen.getByText(/Next/);
    fireEvent.click(nextBtn);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[1].title)).toBeInTheDocument();
    });

    // Click Previous
    fireEvent.click(prevBtn);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });
  });

  test('Paper position saves to localStorage and restores on reload', async () => {
    const { unmount } = renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Navigate to paper 3
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[2].title)).toBeInTheDocument();
    });

    // Verify index saved
    expect(localStorage.getItem('slr-screener-index')).toBe('2');

    // Unmount and remount
    unmount();
    renderApp(App);

    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[2].title)).toBeInTheDocument();
    });
  });

  test('Venue filter shows only papers from selected venue', async () => {
    renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Click ICSE 2025 filter (there should be 2 ICSE papers)
    const icseBtn = screen.getByRole('button', { name: 'ICSE 2025' });
    fireEvent.click(icseBtn);

    await waitFor(() => {
      // Should show "1 / 2" in navigation (2 ICSE papers)
      expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument();
    });

    // Navigate to second ICSE paper
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[2].title)).toBeInTheDocument(); // second ICSE paper
    });

    // Click All to reset
    const allBtn = screen.getByRole('button', { name: 'All' });
    fireEvent.click(allBtn);
    await waitFor(() => {
      expect(screen.getByText(/\/ 5/)).toBeInTheDocument();
    });
  });
});
