import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../App';
import { setupFetchMock, clearStorage, MOCK_PAPERS } from '../testHelpers';

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
  getProject: jest.fn(() => Promise.resolve(null)),
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
}));

jest.mock('xlsx', () => ({
  read: jest.fn(),
  utils: { sheet_to_json: jest.fn() },
}));

beforeEach(() => {
  clearStorage();
  setupFetchMock();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Triage', () => {
  test('Pressing Y marks paper as Yes and advances', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'y' });

    // Should advance to paper 2
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[1].title)).toBeInTheDocument();
    });

    // Decision should be saved in localStorage
    const decisions = JSON.parse(localStorage.getItem('slr-screener-decisions'));
    expect(decisions['0']).toBe('Yes');
  });

  test('Pressing N marks paper as No and advances', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'n' });

    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[1].title)).toBeInTheDocument();
    });

    const decisions = JSON.parse(localStorage.getItem('slr-screener-decisions'));
    expect(decisions['0']).toBe('No');
  });

  test('Changing decision on already-decided paper works without advancing', async () => {
    render(<App />);
    await waitFor(() => {
      expect(document.querySelector('.paper-title').textContent).toBe(MOCK_PAPERS[0].title);
    });

    // Make initial decision (advances)
    fireEvent.keyDown(document, { key: 'y' });
    await waitFor(() => {
      expect(document.querySelector('.paper-title').textContent).toBe(MOCK_PAPERS[1].title);
    });

    // Go back to paper 1
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(document.querySelector('.paper-title').textContent).toBe(MOCK_PAPERS[0].title);
    });

    // Change decision to No — should NOT advance since paper already has a decision
    fireEvent.keyDown(document, { key: 'n' });
    await waitFor(() => {
      // Should still be on paper 1
      expect(document.querySelector('.paper-title').textContent).toBe(MOCK_PAPERS[0].title);
    });

    const decisions = JSON.parse(localStorage.getItem('slr-screener-decisions'));
    expect(decisions['0']).toBe('No');
  });

  test('Decision badge shows on decided papers', async () => {
    render(<App />);
    await waitFor(() => {
      expect(document.querySelector('.paper-title').textContent).toBe(MOCK_PAPERS[0].title);
    });

    // Make a Yes decision, then go back to see the badge
    fireEvent.keyDown(document, { key: 'y' });
    await waitFor(() => {
      expect(document.querySelector('.paper-title').textContent).toBe(MOCK_PAPERS[1].title);
    });

    // Go back
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(document.querySelector('.paper-title').textContent).toBe(MOCK_PAPERS[0].title);
    });

    // Check for decision badge
    const badge = document.querySelector('.decision-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('Yes');
    expect(badge).toHaveClass('yes');
  });

  test('Decision counts update correctly in progress bar', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Initial state
    expect(screen.getByText('Yes: 0')).toBeInTheDocument();
    expect(screen.getByText('No: 0')).toBeInTheDocument();
    expect(screen.getByText('Remaining: 5')).toBeInTheDocument();

    // Make Yes decision
    fireEvent.keyDown(document, { key: 'y' });
    await waitFor(() => {
      expect(screen.getByText('Yes: 1')).toBeInTheDocument();
      expect(screen.getByText('Remaining: 4')).toBeInTheDocument();
    });

    // Make No decision on paper 2
    fireEvent.keyDown(document, { key: 'n' });
    await waitFor(() => {
      expect(screen.getByText('No: 1')).toBeInTheDocument();
      expect(screen.getByText('Remaining: 3')).toBeInTheDocument();
    });
  });
});
