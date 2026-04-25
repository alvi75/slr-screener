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

describe('Project Management', () => {
  test('Sidebar shows demo project with Demo badge', async () => {
    renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Open sidebar via hamburger
    const hamburger = screen.getByLabelText('Menu');
    fireEvent.click(hamburger);

    await waitFor(() => {
      expect(screen.getByText('Projects')).toBeInTheDocument();
      expect(screen.getByText('Model Sizes in SE Research 2025')).toBeInTheDocument();
      expect(screen.getByText('Demo')).toBeInTheDocument();
    });

    // Should show paper count in meta
    const meta = document.querySelector('.project-item-meta');
    expect(meta).not.toBeNull();
    expect(meta.textContent).toContain('5');
    expect(meta.textContent).toContain('papers');
  });

  test('New project creation navigates to setup page', async () => {
    renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Open sidebar
    const hamburger = screen.getByLabelText('Menu');
    fireEvent.click(hamburger);

    await waitFor(() => {
      expect(screen.getByText('+ New Project')).toBeInTheDocument();
    });

    // Click New Project
    fireEvent.click(screen.getByText('+ New Project'));

    // Should show setup page
    await waitFor(() => {
      expect(screen.getByText('Import your papers to begin screening')).toBeInTheDocument();
    });

    // Should show the 4 import methods
    expect(screen.getByText('Upload CSV / Excel')).toBeInTheDocument();
    expect(screen.getByText('Upload JSON')).toBeInTheDocument();
    expect(screen.getByText('Add Papers Manually')).toBeInTheDocument();
    expect(screen.getByText('Upload PDFs')).toBeInTheDocument();
  });

  test('Switching back to demo after new project loads correct data', async () => {
    renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Open sidebar, go to new project
    fireEvent.click(screen.getByLabelText('Menu'));
    await waitFor(() => expect(screen.getByText('+ New Project')).toBeInTheDocument());
    fireEvent.click(screen.getByText('+ New Project'));

    // Should be on setup page
    await waitFor(() => {
      expect(screen.getByText('Import your papers to begin screening')).toBeInTheDocument();
    });

    // Click demo link to go back
    const demoLink = screen.getByText(/built-in demo dataset/);
    fireEvent.click(demoLink);

    // Should load back into screener with demo data
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });
  });

  test('Project sidebar shows correct screened count after decisions', async () => {
    renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Make 2 decisions
    fireEvent.keyDown(document, { key: 'y' });
    await waitFor(() => expect(screen.getByText(MOCK_PAPERS[1].title)).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'n' });

    // Open sidebar
    fireEvent.click(screen.getByLabelText('Menu'));
    await waitFor(() => {
      const meta = document.querySelector('.project-item-meta');
      expect(meta).not.toBeNull();
      expect(meta.textContent).toContain('5');
      expect(meta.textContent).toContain('2');
      expect(meta.textContent).toContain('screened');
    });
  });

  test('Three-dot menu shows project actions', async () => {
    renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Open sidebar
    fireEvent.click(screen.getByLabelText('Menu'));
    await waitFor(() => expect(screen.getByText('Projects')).toBeInTheDocument());

    // Click three-dot menu
    const menuBtn = document.querySelector('.project-menu-btn');
    expect(menuBtn).not.toBeNull();
    fireEvent.click(menuBtn);

    await waitFor(() => {
      const dropdown = document.querySelector('.project-menu-dropdown');
      expect(dropdown).not.toBeNull();
      const buttons = Array.from(dropdown.querySelectorAll('button')).map(b => b.textContent);
      expect(buttons).toContain('Rename');
      expect(buttons).toContain('Add Papers');
      expect(buttons).toContain('Export JSON');
      expect(buttons).toContain('Export CSV');
      expect(buttons).toContain('Share Project');
      expect(buttons).toContain('Duplicate');
    });
  });

  test('Share Project opens share modal', async () => {
    renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Open sidebar
    fireEvent.click(screen.getByLabelText('Menu'));
    await waitFor(() => expect(screen.getByText('Projects')).toBeInTheDocument());

    // Click three-dot menu
    const menuBtn = document.querySelector('.project-menu-btn');
    fireEvent.click(menuBtn);

    await waitFor(() => {
      expect(screen.getByText('Share Project')).toBeInTheDocument();
    });

    // Click Share Project
    fireEvent.click(screen.getByText('Share Project'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Email address')).toBeInTheDocument();
      expect(screen.getByText('Send Invite')).toBeInTheDocument();
      expect(screen.getByText('No collaborators yet. Invite someone above.')).toBeInTheDocument();
    });
  });

  test('Share modal shows validation error for empty email', async () => {
    renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Open sidebar -> three-dot -> Share Project
    fireEvent.click(screen.getByLabelText('Menu'));
    await waitFor(() => expect(screen.getByText('Projects')).toBeInTheDocument());
    fireEvent.click(document.querySelector('.project-menu-btn'));
    await waitFor(() => expect(screen.getByText('Share Project')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Share Project'));

    await waitFor(() => expect(screen.getByText('Send Invite')).toBeInTheDocument());

    // Click Send Invite with empty email
    fireEvent.click(screen.getByText('Send Invite'));

    await waitFor(() => {
      expect(screen.getByText('Please enter an email address.')).toBeInTheDocument();
    });
  });

  test('Share modal shows validation error for self-invite', async () => {
    renderApp(App);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Open share modal
    fireEvent.click(screen.getByLabelText('Menu'));
    await waitFor(() => expect(screen.getByText('Projects')).toBeInTheDocument());
    fireEvent.click(document.querySelector('.project-menu-btn'));
    await waitFor(() => expect(screen.getByText('Share Project')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Share Project'));

    await waitFor(() => expect(screen.getByText('Send Invite')).toBeInTheDocument());

    // Type own email and try to invite
    fireEvent.change(screen.getByPlaceholderText('Email address'), { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByText('Send Invite'));

    await waitFor(() => {
      expect(screen.getByText('You cannot invite yourself.')).toBeInTheDocument();
    });
  });
});
