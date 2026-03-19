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

var mockCollectionGroupFn = jest.fn((_db, name) => ({ _collectionGroup: name }));
var mockWhereFn = jest.fn();

jest.mock('firebase/firestore', () => ({
  doc: (...args) => mockDocFn(...args),
  collection: (...args) => mockCollectionFn(...args),
  setDoc: (...args) => mockSetDoc(...args),
  getDoc: (...args) => mockGetDoc(...args),
  getDocs: (...args) => mockGetDocs(...args),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  writeBatch: () => ({ set: mockBatchSet, delete: mockBatchDelete, commit: mockBatchCommit }),
  query: (colRef, ...conditions) => colRef,
  orderBy: jest.fn(),
  where: (...args) => mockWhereFn(...args),
  collectionGroup: (...args) => mockCollectionGroupFn(...args),
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
  saveProjectMeta,
  getProjectMeta,
  addCollaborator,
  removeCollaborator,
  updateCollaboratorRole,
  getCollaborators,
  acceptInvite,
  declineInvite,
  getSharedProjects,
  saveFinalDecision,
  getFinalDecisions,
  deleteFinalDecision,
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

  // ── Project Sharing / Collaborators ────────────────────────

  describe('saveProjectMeta', () => {
    test('writes to top-level projects collection with merge', async () => {
      await saveProjectMeta('proj1', { ownerId: 'user1', ownerEmail: 'a@b.com', projectName: 'Test' });

      expect(mockDocFn).toHaveBeenCalledWith('MOCK_DB', 'projects', 'proj1');
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _path: 'projects/proj1' }),
        expect.objectContaining({ ownerId: 'user1', ownerEmail: 'a@b.com', projectName: 'Test', updatedAt: 'SERVER_TIMESTAMP' }),
        { merge: true }
      );
    });
  });

  describe('getProjectMeta', () => {
    test('returns project meta when exists', async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        id: 'proj1',
        data: () => ({ ownerId: 'user1', ownerEmail: 'a@b.com', projectName: 'Test' }),
      });
      const meta = await getProjectMeta('proj1');
      expect(meta).toEqual({ id: 'proj1', ownerId: 'user1', ownerEmail: 'a@b.com', projectName: 'Test' });
    });

    test('returns null when not found', async () => {
      mockGetDoc.mockResolvedValueOnce({ exists: () => false });
      const meta = await getProjectMeta('proj1');
      expect(meta).toBeNull();
    });
  });

  describe('addCollaborator', () => {
    test('writes to correct path with pending status', async () => {
      await addCollaborator('proj1', 'collab@test.com', 'annotator', 'user1');

      expect(mockDocFn).toHaveBeenCalledWith('MOCK_DB', 'projects', 'proj1', 'collaborators', 'collab@test.com');
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _path: 'projects/proj1/collaborators/collab@test.com' }),
        expect.objectContaining({
          email: 'collab@test.com',
          role: 'annotator',
          status: 'pending',
          invitedBy: 'user1',
          invitedAt: 'SERVER_TIMESTAMP',
        })
      );
    });
  });

  describe('removeCollaborator', () => {
    test('deletes the correct document', async () => {
      await removeCollaborator('proj1', 'collab@test.com');

      expect(mockDocFn).toHaveBeenCalledWith('MOCK_DB', 'projects', 'proj1', 'collaborators', 'collab@test.com');
      expect(mockDeleteDoc).toHaveBeenCalled();
    });
  });

  describe('updateCollaboratorRole', () => {
    test('updates role with merge', async () => {
      await updateCollaboratorRole('proj1', 'collab@test.com', 'viewer');

      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _path: 'projects/proj1/collaborators/collab@test.com' }),
        expect.objectContaining({ role: 'viewer', updatedAt: 'SERVER_TIMESTAMP' }),
        { merge: true }
      );
    });
  });

  describe('getCollaborators', () => {
    test('returns formatted collaborator list', async () => {
      mockGetDocs.mockResolvedValueOnce(mockQuerySnap([
        mockDocSnap('alice@test.com', { email: 'alice@test.com', role: 'annotator', status: 'accepted', invitedBy: 'user1' }),
        mockDocSnap('bob@test.com', { email: 'bob@test.com', role: 'viewer', status: 'pending', invitedBy: 'user1' }),
      ]));

      const collabs = await getCollaborators('proj1');
      expect(collabs).toEqual([
        { email: 'alice@test.com', role: 'annotator', status: 'accepted', invitedBy: 'user1' },
        { email: 'bob@test.com', role: 'viewer', status: 'pending', invitedBy: 'user1' },
      ]);
    });

    test('returns empty array when no collaborators', async () => {
      mockGetDocs.mockResolvedValueOnce(mockQuerySnap([]));
      const collabs = await getCollaborators('proj1');
      expect(collabs).toEqual([]);
    });
  });

  describe('acceptInvite', () => {
    test('updates status to accepted with merge', async () => {
      await acceptInvite('proj1', 'collab@test.com');

      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _path: 'projects/proj1/collaborators/collab@test.com' }),
        expect.objectContaining({ status: 'accepted', acceptedAt: 'SERVER_TIMESTAMP' }),
        { merge: true }
      );
    });
  });

  describe('declineInvite', () => {
    test('updates status to declined with merge', async () => {
      await declineInvite('proj1', 'collab@test.com');

      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _path: 'projects/proj1/collaborators/collab@test.com' }),
        expect.objectContaining({ status: 'declined', declinedAt: 'SERVER_TIMESTAMP' }),
        { merge: true }
      );
    });
  });

  describe('getSharedProjects', () => {
    test('queries collectionGroup and extracts projectId from path', async () => {
      mockGetDocs.mockResolvedValueOnce({
        docs: [
          {
            data: () => ({ email: 'user@test.com', role: 'annotator', status: 'pending' }),
            ref: { parent: { parent: { id: 'proj1' } } },
          },
          {
            data: () => ({ email: 'user@test.com', role: 'viewer', status: 'accepted' }),
            ref: { parent: { parent: { id: 'proj2' } } },
          },
        ],
      });

      const shared = await getSharedProjects('user@test.com');
      expect(shared).toEqual([
        { projectId: 'proj1', email: 'user@test.com', role: 'annotator', status: 'pending' },
        { projectId: 'proj2', email: 'user@test.com', role: 'viewer', status: 'accepted' },
      ]);
      expect(mockCollectionGroupFn).toHaveBeenCalledWith('MOCK_DB', 'collaborators');
    });

    test('returns empty array when no email', async () => {
      const shared = await getSharedProjects('');
      expect(shared).toEqual([]);
    });

    test('returns empty array when null email', async () => {
      const shared = await getSharedProjects(null);
      expect(shared).toEqual([]);
    });
  });

  // ── Final Decisions (Conflict Resolution) ──────────────────

  describe('saveFinalDecision', () => {
    test('writes to correct path with timestamp', async () => {
      await saveFinalDecision('proj1', '5', { decision: 'Yes', resolvedBy: 'owner@test.com', comment: 'Majority rule' });

      expect(mockDocFn).toHaveBeenCalledWith('MOCK_DB', 'projects', 'proj1', 'finalDecisions', '5');
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ _path: 'projects/proj1/finalDecisions/5' }),
        expect.objectContaining({
          decision: 'Yes',
          resolvedBy: 'owner@test.com',
          comment: 'Majority rule',
          resolvedAt: 'SERVER_TIMESTAMP',
        })
      );
    });
  });

  describe('getFinalDecisions', () => {
    test('returns final decisions as map', async () => {
      mockGetDocs.mockResolvedValueOnce(mockQuerySnap([
        mockDocSnap('3', { decision: 'Yes', resolvedBy: 'owner@test.com', comment: 'Clear yes', resolvedAt: 'ts' }),
        mockDocSnap('7', { decision: 'No', resolvedBy: 'owner@test.com', comment: '', resolvedAt: 'ts' }),
      ]));

      const results = await getFinalDecisions('proj1');
      expect(results).toEqual({
        '3': { decision: 'Yes', resolvedBy: 'owner@test.com', comment: 'Clear yes', resolvedAt: 'ts' },
        '7': { decision: 'No', resolvedBy: 'owner@test.com', comment: '', resolvedAt: 'ts' },
      });
    });

    test('returns empty object when no final decisions', async () => {
      mockGetDocs.mockResolvedValueOnce(mockQuerySnap([]));
      const results = await getFinalDecisions('proj1');
      expect(results).toEqual({});
    });
  });

  describe('deleteFinalDecision', () => {
    test('deletes the correct document', async () => {
      await deleteFinalDecision('proj1', '5');
      expect(mockDocFn).toHaveBeenCalledWith('MOCK_DB', 'projects', 'proj1', 'finalDecisions', '5');
      expect(mockDeleteDoc).toHaveBeenCalled();
    });
  });
});
