import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../App';
import { setupFetchMock, clearStorage, MOCK_PAPERS, renderApp } from '../testHelpers';

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
  deleteAllDecisions: jest.fn(() => Promise.resolve()),
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

describe('Export', () => {
  test('Export CSV generates correct format with decisions', async () => {
    renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Make some decisions
    fireEvent.keyDown(document, { key: 'y' }); // Paper 1 = Yes
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[1].title)).toBeInTheDocument();
    });
    fireEvent.keyDown(document, { key: 'n' }); // Paper 2 = No

    // Mock URL.createObjectURL and the click/download
    const mockRevokeObjectURL = jest.fn();
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    // Capture the blob passed to createObjectURL
    let capturedBlob = null;
    global.URL.createObjectURL = jest.fn((blob) => {
      capturedBlob = blob;
      return 'blob:test';
    });

    // Mock createElement to capture the download
    const originalCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = originalCreateElement(tag);
      if (tag === 'a') {
        el.click = jest.fn();
      }
      return el;
    });

    // Click Export CSV
    const exportBtn = screen.getByText('Export CSV');
    fireEvent.click(exportBtn);

    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(capturedBlob).not.toBeNull();

    // Read the blob content using FileReader (blob.text() not available in jsdom)
    const csvText = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsText(capturedBlob);
    });
    const lines = csvText.split('\n');

    // Check header
    expect(lines[0]).toBe('conf,title,author,decision,ai_overall,ai_suggestion,ai_reason,ai_topical_alignment,ai_methodological_relevance,ai_specificity,abstract,doi,pdf_url,arxiv_id');

    // Paper 0 should have "Yes"
    expect(lines[1]).toContain('Yes');
    // Paper 1 should have "No"
    expect(lines[2]).toContain('No');
    // Paper 2 should have no decision (empty)
    const paper3Fields = lines[3].split(',');
    expect(paper3Fields[3]).toBe(''); // decision column empty
  });

  test('Decision Log shows all decided papers', async () => {
    renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Make decisions on first 3 papers
    fireEvent.keyDown(document, { key: 'y' }); // Paper 1 = Yes
    await waitFor(() => expect(screen.getByText(MOCK_PAPERS[1].title)).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'n' }); // Paper 2 = No
    await waitFor(() => expect(screen.getByText(MOCK_PAPERS[2].title)).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'n' }); // Paper 3 = No

    // Open Decision Log via the header button
    const logBtn = document.querySelector('.header-btn.btn-log');
    fireEvent.click(logBtn);

    // Should show all 3 decided papers
    await waitFor(() => {
      expect(screen.getByText('All (3)')).toBeInTheDocument();
      expect(screen.getByText('Yes (1)')).toBeInTheDocument();
      expect(screen.getByText('No (2)')).toBeInTheDocument();
    });

    // Paper titles should appear in sidebar items
    const sidebarItems = document.querySelectorAll('.sidebar-item');
    expect(sidebarItems.length).toBe(3);
  });

  test('Decision Log search filters by title', async () => {
    renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Make decisions on first 2 papers
    fireEvent.keyDown(document, { key: 'y' }); // Paper 1 = Yes
    await waitFor(() => expect(screen.getByText(MOCK_PAPERS[1].title)).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'n' }); // Paper 2 = No

    // Open Decision Log via the header button
    const logBtn = document.querySelector('.header-btn.btn-log');
    fireEvent.click(logBtn);

    await waitFor(() => {
      const sidebarItems = document.querySelectorAll('.sidebar-item');
      expect(sidebarItems.length).toBe(2);
    });

    // Search for "Vulnerability"
    const searchInput = screen.getByPlaceholderText('Search by title...');
    fireEvent.change(searchInput, { target: { value: 'Vulnerability' } });

    await waitFor(() => {
      const sidebarItems = document.querySelectorAll('.sidebar-item');
      expect(sidebarItems.length).toBe(1);
    });

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } });
    await waitFor(() => {
      const sidebarItems = document.querySelectorAll('.sidebar-item');
      expect(sidebarItems.length).toBe(2);
    });
  });
});
