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
    render(<App />);
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
    render(<App />);
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
    render(<App />);
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
    render(<App />);
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
    render(<App />);
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
      expect(buttons).toContain('Duplicate');
    });
  });
});
