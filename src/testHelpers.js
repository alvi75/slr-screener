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
};

/**
 * Set up global fetch mock to return demo data for the enriched_papers JSON URL.
 * Returns a jest.fn() for fetch so tests can inspect calls.
 */
export function setupFetchMock() {
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
    loading: false,
    ...overrides,
  };
}
