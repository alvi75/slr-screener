import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render } from '@testing-library/react';

// Shared test helpers and mock data for SLR Screener tests

export const MOCK_PAPERS = [
  {
    conf: 'ICSE 2025', title: 'LLM-Based Code Generation with GPT-4',
    author: 'Alice Smith, Bob Jones', abstract: 'We evaluate large language models for code generation tasks using transformer architectures.',
    doi: '10.1145/0001', doi_url: 'https://doi.org/10.1145/0001',
    openalex_id: 'W001', arxiv_id: '2404.00001',
    pdf_url: 'https://arxiv.org/pdf/2404.00001', pdf_source: 'arxiv',
  },
  {
    conf: 'FSE 2025', title: 'Deep Learning for Vulnerability Detection',
    author: 'Carol White, Dave Brown', abstract: 'This paper presents a neural network approach to automated vulnerability detection in software.',
    doi: '10.1145/0002', doi_url: 'https://doi.org/10.1145/0002',
    openalex_id: 'W002', arxiv_id: '',
    pdf_url: '', pdf_source: 'not_found',
  },
  {
    conf: 'ICSE 2025', title: 'Fine-tuning CodeLlama for Program Repair',
    author: 'Eve Green', abstract: 'We fine-tuned CodeLlama-7B with LoRA adapters on program repair benchmark datasets.',
    doi: '10.1145/0003', doi_url: 'https://doi.org/10.1145/0003',
    openalex_id: 'W003', arxiv_id: '2404.00003',
    pdf_url: 'https://arxiv.org/pdf/2404.00003', pdf_source: 'arxiv',
  },
  {
    conf: 'ASE 2025', title: 'Test Generation Using Machine Learning',
    author: 'Frank Lee', abstract: 'A study on automated test generation using deep learning and training on evaluation benchmarks.',
    doi: '10.1145/0004', doi_url: 'https://doi.org/10.1145/0004',
    openalex_id: 'W004', arxiv_id: '',
    pdf_url: '', pdf_source: 'not_found',
  },
  {
    conf: 'FSE 2025', title: 'Defect Prediction with Pre-trained Models',
    author: 'Grace Kim', abstract: 'We apply pre-trained BERT models for software defect prediction with inference optimization.',
    doi: '10.1145/0005', doi_url: 'https://doi.org/10.1145/0005',
    openalex_id: 'W005', arxiv_id: '2404.00005',
    pdf_url: 'https://arxiv.org/pdf/2404.00005', pdf_source: 'arxiv',
  },
];

export const MOCK_JSON_RESPONSE = {
  metadata: { total_papers: MOCK_PAPERS.length, source: 'test', enriched_date: '2025-01-01' },
  papers: MOCK_PAPERS,
};

/** Mock authenticated user */
export const MOCK_USER = {
  uid: 'test-uid-123',
  email: 'test@example.com',
  displayName: 'Test User',
  photoURL: null,
  emailVerified: true,
  providerData: [{ providerId: 'password' }],
};

/**
 * Set up global fetch mock to return demo data for the enriched_papers JSON URL.
 * Returns a jest.fn() for fetch so tests can inspect calls.
 */
/**
 * Render App inside a MemoryRouter at a project route so tests land on the screener.
 */
export function renderApp(App, options = {}) {
  const route = options.route || '/project/model_sizes_in_se_research_2025';
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>
  );
}

export function setupFetchMock() {
  // Pre-set flags so the app loads demo data
  localStorage.setItem('slr-screener-has-data', '1');
  localStorage.setItem('slr-screener-is-demo', '1');
  localStorage.setItem('slr-screener-project-name', 'Model Sizes in SE Research 2025');

  const fetchMock = jest.fn((url) => {
    if (typeof url === 'string' && url.includes('enriched_papers_2025.json')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(MOCK_JSON_RESPONSE),
      });
    }
    // Default: reject unknown fetches
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
  });
  global.fetch = fetchMock;

  // Re-set firestore mock implementations (factory jest.fn implementations may get cleared)
  try {
    const fs = require('./services/firestore');
    if (fs.getProject && fs.getProject.mockImplementation) {
      fs.getProject.mockImplementation(() => Promise.resolve({ id: 'test', name: 'Test' }));
    }
    if (fs.getUserProfile && fs.getUserProfile.mockImplementation) {
      fs.getUserProfile.mockImplementation(() => Promise.resolve({ displayName: 'Test User', nameConfirmed: true }));
    }
    if (fs.getSharedProjects && fs.getSharedProjects.mockImplementation) {
      fs.getSharedProjects.mockImplementation(() => Promise.resolve([]));
    }
    if (fs.getDecisions && fs.getDecisions.mockImplementation) {
      fs.getDecisions.mockImplementation(() => Promise.resolve({}));
    }
    if (fs.getAIScores && fs.getAIScores.mockImplementation) {
      fs.getAIScores.mockImplementation(() => Promise.resolve({}));
    }
    if (fs.getCollaborators && fs.getCollaborators.mockImplementation) {
      fs.getCollaborators.mockImplementation(() => Promise.resolve([]));
    }
    if (fs.getProjects && fs.getProjects.mockImplementation) {
      fs.getProjects.mockImplementation(() => Promise.resolve([]));
    }
    if (fs.getAIDisagreements && fs.getAIDisagreements.mockImplementation) {
      fs.getAIDisagreements.mockImplementation(() => Promise.resolve({}));
    }
    if (fs.subscribeToNotifications && fs.subscribeToNotifications.mockImplementation) {
      fs.subscribeToNotifications.mockImplementation(() => () => {});
    }
    if (fs.subscribeToDecisions && fs.subscribeToDecisions.mockImplementation) {
      fs.subscribeToDecisions.mockImplementation(() => () => {});
    }
    if (fs.subscribeToSharedProjects && fs.subscribeToSharedProjects.mockImplementation) {
      fs.subscribeToSharedProjects.mockImplementation((_email, cb) => { cb([]); return () => {}; });
    }
    if (fs.deleteAllDecisions && fs.deleteAllDecisions.mockImplementation) {
      fs.deleteAllDecisions.mockImplementation(() => Promise.resolve());
    }
  } catch { /* firestore not mocked in this test file */ }

  return fetchMock;
}

/**
 * Clear all SLR-related localStorage keys between tests.
 */
export function clearStorage() {
  const keys = Object.keys(localStorage).filter(k => k.startsWith('slr-screener'));
  keys.forEach(k => localStorage.removeItem(k));
}

/**
 * Create a standard mock for the AuthContext module.
 * Call this BEFORE jest.mock() in each test file, or use the returned values.
 */
export function createAuthMock(overrides = {}) {
  return {
    currentUser: MOCK_USER,
    login: jest.fn(),
    signup: jest.fn(),
    logout: jest.fn(),
    googleSignIn: jest.fn(),
    resendVerification: jest.fn(),
    reloadUser: jest.fn(),
    resetPassword: jest.fn(() => Promise.resolve()),
    loading: false,
    ...overrides,
  };
}
