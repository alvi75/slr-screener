/**
 * Tests for Firestore service functions.
 * Mocks the firebase/firestore module to verify correct document paths and data.
 */

// Must use `var` with `mock` prefix so Jest hoisting can access them in the factory
/* eslint-disable no-var */
var mockSetDoc = jest.fn(() => Promise.resolve());
var mockGetDoc = jest.fn();
var mockGetDocs = jest.fn();
var mockDeleteDoc = jest.fn(() => Promise.resolve());
var mockBatchSet = jest.fn();
var mockBatchDelete = jest.fn();
var mockBatchCommit = jest.fn(() => Promise.resolve());
var mockDocFn = jest.fn((_db, ...segments) => ({ _path: segments.join('/') }));
var mockCollectionFn = jest.fn((_db, ...segments) => ({ _path: segments.join('/') }));
/* eslint-enable no-var */

jest.mock('firebase/firestore', () => ({
  doc: (...args) => mockDocFn(...args),
  collection: (...args) => mockCollectionFn(...args),
  setDoc: (...args) => mockSetDoc(...args),
  getDoc: (...args) => mockGetDoc(...args),
  getDocs: (...args) => mockGetDocs(...args),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  writeBatch: () => ({ set: mockBatchSet, delete: mockBatchDelete, commit: mockBatchCommit }),
  query: (colRef) => colRef,
  orderBy: jest.fn(),
  serverTimestamp: () => 'SERVER_TIMESTAMP',
}));

jest.mock('../firebase', () => ({ db: 'MOCK_DB' }));

import {
  saveProject,
  getProjects,
  getProject,
  deleteProject,
  saveDecision,
  deleteDecision,
  getDecisions,
  saveAllDecisions,
  saveAIScore,
  saveAllAIScores,
  getAIScores,
  syncDecisionsToFirestore,
  syncAIScoresToFirestore,
  syncProjectToFirestore,
} from '../services/firestore';

beforeEach(() => {
  jest.clearAllMocks();
  mockSetDoc.mockImplementation(() => Promise.resolve());
  mockDeleteDoc.mockImplementation(() => Promise.resolve());
  mockBatchCommit.mockImplementation(() => Promise.resolve());
  mockDocFn.mockImplementation((_db, ...segments) => ({ _path: segments.join('/') }));
  mockCollectionFn.mockImplementation((_db, ...segments) => ({ _path: segments.join('/') }));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function mockDocSnap(id, data, exists = true) {
  return { id, data: () => data, exists: () => exists, ref: { _path: id } };
}

function mockQuerySnap(docs) {
  return { docs, size: docs.length, empty: docs.length === 0 };
}

// ════════════════════════════════════════════════════════════════

describe('Firestore Service', () => {

  // ── Projects ────────────────────────────────────────────────

  describe('saveProject', () => {
    test('writes to correct path with merge and timestamp', async () => {
      await saveProject('user1', 'proj1', { name: 'My Project', isDemo: false });

      expect(mockDocFn).toHaveBeenCalledWith('MOCK_DB', 'users', 'user1', 'projects', 'proj1');
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _path: 'users/user1/projects/proj1' }),
        expect.objectContaining({ name: 'My Project', isDemo: false, updatedAt: 'SERVER_TIMESTAMP' }),
        { merge: true }
      );
    });
  });

  describe('getProjects', () => {
    test('returns all projects for a user', async () => {
      mockGetDocs.mockResolvedValueOnce(mockQuerySnap([
        mockDocSnap('proj1', { name: 'Project A', createdAt: 2 }),
        mockDocSnap('proj2', { name: 'Project B', createdAt: 1 }),
      ]));

      const projects = await getProjects('user1');

      expect(mockCollectionFn).toHaveBeenCalledWith('MOCK_DB', 'users', 'user1', 'projects');
      expect(projects).toEqual([
        { id: 'proj1', name: 'Project A', createdAt: 2 },
        { id: 'proj2', name: 'Project B', createdAt: 1 },
      ]);
    });

    test('returns empty array when no projects exist', async () => {
      mockGetDocs.mockResolvedValueOnce(mockQuerySnap([]));
      const projects = await getProjects('user1');
      expect(projects).toEqual([]);
    });
  });

  describe('getProject', () => {
    test('returns project data when it exists', async () => {
      mockGetDoc.mockResolvedValueOnce(mockDocSnap('proj1', { name: 'Test' }));
      const project = await getProject('user1', 'proj1');
      expect(project).toEqual({ id: 'proj1', name: 'Test' });
    });

    test('returns null when project does not exist', async () => {
      mockGetDoc.mockResolvedValueOnce(mockDocSnap('proj1', null, false));
      const project = await getProject('user1', 'proj1');
      expect(project).toBeNull();
    });
  });

  describe('deleteProject', () => {
    test('deletes all decisions then the project doc', async () => {
      mockGetDocs.mockResolvedValueOnce(mockQuerySnap([
        mockDocSnap('0', { decision: 'Yes' }),
        mockDocSnap('1', { decision: 'No' }),
      ]));

      await deleteProject('user1', 'proj1');

      expect(mockBatchDelete).toHaveBeenCalledTimes(2);
      expect(mockBatchCommit).toHaveBeenCalled();
      expect(mockDeleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _path: 'users/user1/projects/proj1' })
      );
    });

    test('deletes project even with no decisions', async () => {
      mockGetDocs.mockResolvedValueOnce(mockQuerySnap([]));

      await deleteProject('user1', 'proj1');

      expect(mockBatchDelete).not.toHaveBeenCalled();
      expect(mockDeleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _path: 'users/user1/projects/proj1' })
      );
    });
  });

  // ── Decisions ───────────────────────────────────────────────

  describe('saveDecision', () => {
    test('writes decision to correct path', async () => {
      await saveDecision('user1', 'proj1', '42', 'Yes');

      expect(mockDocFn).toHaveBeenCalledWith('MOCK_DB', 'users', 'user1', 'projects', 'proj1', 'decisions', '42');
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _path: 'users/user1/projects/proj1/decisions/42' }),
        { decision: 'Yes', updatedAt: 'SERVER_TIMESTAMP' }
      );
    });

    test('converts numeric paperId to string', async () => {
      await saveDecision('user1', 'proj1', 7, 'No');
      expect(mockDocFn).toHaveBeenCalledWith('MOCK_DB', 'users', 'user1', 'projects', 'proj1', 'decisions', '7');
    });
  });

  describe('deleteDecision', () => {
    test('deletes decision at correct path', async () => {
      await deleteDecision('user1', 'proj1', '5');
      expect(mockDeleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _path: 'users/user1/projects/proj1/decisions/5' })
      );
    });
  });

  describe('getDecisions', () => {
    test('returns decisions as { paperId: decision } map', async () => {
      mockGetDocs.mockResolvedValueOnce(mockQuerySnap([
        mockDocSnap('0', { decision: 'Yes', updatedAt: 'ts' }),
        mockDocSnap('3', { decision: 'No', updatedAt: 'ts' }),
        mockDocSnap('7', { decision: 'Maybe', updatedAt: 'ts' }),
      ]));

      const decisions = await getDecisions('user1', 'proj1');
      expect(decisions).toEqual({ '0': 'Yes', '3': 'No', '7': 'Maybe' });
    });

    test('returns empty object when no decisions', async () => {
      mockGetDocs.mockResolvedValueOnce(mockQuerySnap([]));
      const decisions = await getDecisions('user1', 'proj1');
      expect(decisions).toEqual({});
    });
  });

  describe('saveAllDecisions', () => {
    test('batch writes all decisions', async () => {
      const decisions = { '0': 'Yes', '1': 'No', '2': 'Maybe' };
      await saveAllDecisions('user1', 'proj1', decisions);

      expect(mockBatchSet).toHaveBeenCalledTimes(3);
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    });

    test('handles more than 500 decisions in multiple batches', async () => {
      const decisions = {};
      for (let i = 0; i < 600; i++) {
        decisions[String(i)] = i % 2 === 0 ? 'Yes' : 'No';
      }

      await saveAllDecisions('user1', 'proj1', decisions);

      expect(mockBatchCommit).toHaveBeenCalledTimes(2);
      expect(mockBatchSet).toHaveBeenCalledTimes(600);
    });
  });

  // ── AI Scores ──────────────────────────────────────────────

  describe('saveAIScore', () => {
    test('writes to shared project path (not per-user)', async () => {
      const scoreData = { score: 85, suggestion: 'yes', reason: 'Relevant paper', model: 'claude-sonnet-4-6' };
      await saveAIScore('proj1', '42', scoreData);

      expect(mockDocFn).toHaveBeenCalledWith('MOCK_DB', 'projects', 'proj1', 'aiScores', '42');
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _path: 'projects/proj1/aiScores/42' }),
        expect.objectContaining({ score: 85, suggestion: 'yes', reason: 'Relevant paper', model: 'claude-sonnet-4-6', updatedAt: 'SERVER_TIMESTAMP' })
      );
    });
  });

  describe('saveAllAIScores', () => {
    test('batch writes all scores', async () => {
      const scores = {
        '0': { score: 90, suggestion: 'yes', reason: 'Great', model: 'claude-sonnet-4-6' },
        '1': { score: 20, suggestion: 'no', reason: 'Irrelevant', model: 'claude-sonnet-4-6' },
      };
      await saveAllAIScores('proj1', scores);

      expect(mockBatchSet).toHaveBeenCalledTimes(2);
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAIScores', () => {
    test('returns scores as { paperId: scoreData } map', async () => {
      mockGetDocs.mockResolvedValueOnce(mockQuerySnap([
        mockDocSnap('0', { score: 85, suggestion: 'yes', reason: 'Good', model: 'claude-sonnet-4-6', updatedAt: 'ts' }),
        mockDocSnap('3', { score: 30, suggestion: 'no', reason: 'Bad', model: 'claude-haiku-4-5-20251001', updatedAt: 'ts' }),
      ]));

      const scores = await getAIScores('proj1');
      expect(scores).toEqual({
        '0': { score: 85, suggestion: 'yes', reason: 'Good', model: 'claude-sonnet-4-6' },
        '3': { score: 30, suggestion: 'no', reason: 'Bad', model: 'claude-haiku-4-5-20251001' },
      });
    });

    test('returns empty object when no scores', async () => {
      mockGetDocs.mockResolvedValueOnce(mockQuerySnap([]));
      const scores = await getAIScores('proj1');
      expect(scores).toEqual({});
    });
  });

  // ── Sync helpers ───────────────────────────────────────────

  describe('syncDecisionsToFirestore', () => {
    test('fires and forgets — does not throw on error', async () => {
      mockBatchCommit.mockRejectedValueOnce(new Error('Network error'));

      syncDecisionsToFirestore('user1', 'proj1', { '0': 'Yes' });

      await new Promise(r => setTimeout(r, 10));
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[Firestore sync]'),
        expect.any(String)
      );
    });

    test('skips sync when no data', () => {
      syncDecisionsToFirestore('user1', 'proj1', {});
      expect(mockBatchSet).not.toHaveBeenCalled();
    });

    test('skips sync when missing userId', () => {
      syncDecisionsToFirestore(null, 'proj1', { '0': 'Yes' });
      expect(mockBatchSet).not.toHaveBeenCalled();
    });
  });

  describe('syncAIScoresToFirestore', () => {
    test('fires and forgets', () => {
      syncAIScoresToFirestore('proj1', { '0': { score: 50, suggestion: 'maybe', reason: 'ok', model: 'test' } });
      expect(mockBatchSet).toHaveBeenCalled();
    });

    test('skips sync when no projectId', () => {
      syncAIScoresToFirestore(null, { '0': {} });
      expect(mockBatchSet).not.toHaveBeenCalled();
    });
  });

  describe('syncProjectToFirestore', () => {
    test('fires and forgets', () => {
      syncProjectToFirestore('user1', 'proj1', { name: 'Test' });
      expect(mockSetDoc).toHaveBeenCalled();
    });

    test('skips sync when missing userId or projectId', () => {
      syncProjectToFirestore(null, 'proj1', { name: 'Test' });
      expect(mockSetDoc).not.toHaveBeenCalled();
      syncProjectToFirestore('user1', null, { name: 'Test' });
      expect(mockSetDoc).not.toHaveBeenCalled();
    });
  });
});
