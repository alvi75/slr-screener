import {
  doc,
  collection,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  query,
  orderBy,
  where,
  collectionGroup,
} from 'firebase/firestore';
import { db } from '../firebase';

// ─── Project CRUD ────────────────────────────────────────────────

/**
 * Save or update project metadata for a user.
 * @param {string} userId
 * @param {string} projectId - Unique project ID (use a slug or generated ID)
 * @param {object} project - { name, isDemo, createdAt, settings, hlCategories, researchGoal, ... }
 * @returns {Promise<void>}
 */
export async function saveProject(userId, projectId, project) {
  const ref = doc(db, 'users', userId, 'projects', projectId);
  await setDoc(ref, { ...project, updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * Get all projects for a user, ordered by creation date.
 * @param {string} userId
 * @returns {Promise<Array<{id: string, ...}>>}
 */
export async function getProjects(userId) {
  const colRef = collection(db, 'users', userId, 'projects');
  let q;
  try {
    q = query(colRef, orderBy('createdAt', 'desc'));
  } catch {
    q = colRef;
  }
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * Get a single project by ID.
 * @param {string} userId
 * @param {string} projectId
 * @returns {Promise<object|null>}
 */
export async function getProject(userId, projectId) {
  const ref = doc(db, 'users', userId, 'projects', projectId);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Delete a project and all its sub-collections (decisions).
 * @param {string} userId
 * @param {string} projectId
 * @returns {Promise<void>}
 */
export async function deleteProject(userId, projectId) {
  // Delete all decisions first
  const decisionsRef = collection(db, 'users', userId, 'projects', projectId, 'decisions');
  const decSnap = await getDocs(decisionsRef);
  if (decSnap.size > 0) {
    const batch = writeBatch(db);
    decSnap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
  // Delete the project doc
  await deleteDoc(doc(db, 'users', userId, 'projects', projectId));
}

// ─── Decisions ───────────────────────────────────────────────────

/**
 * Save a single triage decision.
 * @param {string} userId
 * @param {string} projectId
 * @param {string} paperId - Paper index as string (e.g. "0", "42")
 * @param {string} decision - "Yes" | "No" | "Maybe"
 * @returns {Promise<void>}
 */
export async function saveDecision(userId, projectId, paperId, decision) {
  const ref = doc(db, 'users', userId, 'projects', projectId, 'decisions', String(paperId));
  await setDoc(ref, { decision, updatedAt: serverTimestamp() });
}

/**
 * Delete a single decision (e.g. on undo).
 * @param {string} userId
 * @param {string} projectId
 * @param {string} paperId
 * @returns {Promise<void>}
 */
export async function deleteDecision(userId, projectId, paperId) {
  const ref = doc(db, 'users', userId, 'projects', projectId, 'decisions', String(paperId));
  await deleteDoc(ref);
}

/**
 * Get all decisions for a project as { paperId: decision } map.
 * @param {string} userId
 * @param {string} projectId
 * @returns {Promise<object>} e.g. { "0": "Yes", "3": "Maybe" }
 */
export async function getDecisions(userId, projectId) {
  const colRef = collection(db, 'users', userId, 'projects', projectId, 'decisions');
  const snap = await getDocs(colRef);
  const decisions = {};
  snap.docs.forEach(d => {
    decisions[d.id] = d.data().decision;
  });
  return decisions;
}

/**
 * Save all decisions for a project at once (batch write).
 * Useful for initial sync from localStorage.
 * @param {string} userId
 * @param {string} projectId
 * @param {object} decisions - { paperId: decision, ... }
 * @returns {Promise<void>}
 */
export async function saveAllDecisions(userId, projectId, decisions) {
  const entries = Object.entries(decisions);
  // Firestore batches limited to 500 writes
  for (let i = 0; i < entries.length; i += 500) {
    const batch = writeBatch(db);
    const chunk = entries.slice(i, i + 500);
    for (const [paperId, decision] of chunk) {
      const ref = doc(db, 'users', userId, 'projects', projectId, 'decisions', String(paperId));
      batch.set(ref, { decision, updatedAt: serverTimestamp() });
    }
    await batch.commit();
  }
}

// ─── AI Scores (shared across users per project) ────────────────

/**
 * Save an AI score for a paper in a project.
 * Stored at the project level (not per-user) since scores are objective.
 * @param {string} projectId
 * @param {string} paperId
 * @param {object} scoreData - { score, suggestion, reason, model }
 * @returns {Promise<void>}
 */
export async function saveAIScore(projectId, paperId, scoreData) {
  const ref = doc(db, 'projects', projectId, 'aiScores', String(paperId));
  await setDoc(ref, { ...scoreData, updatedAt: serverTimestamp() });
}

/**
 * Save multiple AI scores in a batch.
 * @param {string} projectId
 * @param {object} scores - { paperId: { score, suggestion, reason, model }, ... }
 * @returns {Promise<void>}
 */
export async function saveAllAIScores(projectId, scores) {
  const entries = Object.entries(scores);
  for (let i = 0; i < entries.length; i += 500) {
    const batch = writeBatch(db);
    const chunk = entries.slice(i, i + 500);
    for (const [paperId, scoreData] of chunk) {
      const ref = doc(db, 'projects', projectId, 'aiScores', String(paperId));
      batch.set(ref, { ...scoreData, updatedAt: serverTimestamp() });
    }
    await batch.commit();
  }
}

/**
 * Get all AI scores for a project as { paperId: scoreData } map.
 * @param {string} projectId
 * @returns {Promise<object>}
 */
export async function getAIScores(projectId) {
  const colRef = collection(db, 'projects', projectId, 'aiScores');
  const snap = await getDocs(colRef);
  const scores = {};
  snap.docs.forEach(d => {
    const data = d.data();
    scores[d.id] = {
      score: data.score,
      suggestion: data.suggestion,
      reason: data.reason,
      model: data.model,
    };
  });
  return scores;
}

// ─── Sync helpers ────────────────────────────────────────────────

/**
 * Sync decisions from localStorage to Firestore (background, fire-and-forget).
 * Reads localStorage, writes to Firestore, logs errors but doesn't throw.
 * @param {string} userId
 * @param {string} projectId
 * @param {object} localDecisions - The current decisions object from state/localStorage
 */
export function syncDecisionsToFirestore(userId, projectId, localDecisions) {
  if (!userId || !projectId || !localDecisions) return;
  const entries = Object.entries(localDecisions);
  if (entries.length === 0) return;
  saveAllDecisions(userId, projectId, localDecisions).catch(err => {
    console.warn('[Firestore sync] Failed to sync decisions:', err.message);
  });
}

/**
 * Sync AI scores from localStorage to Firestore (background, fire-and-forget).
 * @param {string} projectId
 * @param {object} localScores - The current aiScores object from state/localStorage
 */
export function syncAIScoresToFirestore(projectId, localScores) {
  if (!projectId || !localScores) return;
  const entries = Object.entries(localScores);
  if (entries.length === 0) return;
  saveAllAIScores(projectId, localScores).catch(err => {
    console.warn('[Firestore sync] Failed to sync AI scores:', err.message);
  });
}

/**
 * Sync project settings to Firestore (background, fire-and-forget).
 * @param {string} userId
 * @param {string} projectId
 * @param {object} settings - Project metadata/settings to save
 */
export function syncProjectToFirestore(userId, projectId, settings) {
  if (!userId || !projectId) return;
  saveProject(userId, projectId, settings).catch(err => {
    console.warn('[Firestore sync] Failed to sync project:', err.message);
  });
}

// ─── Project Sharing / Collaborators ─────────────────────────────

/**
 * Save project meta at the top-level projects collection.
 * Used for sharing lookup — stores ownerId so collaborators can find the owner's data.
 * @param {string} projectId
 * @param {object} meta - { ownerId, ownerEmail, projectName }
 */
export async function saveProjectMeta(projectId, meta) {
  const ref = doc(db, 'projects', projectId);
  await setDoc(ref, { ...meta, updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * Get project meta from top-level projects collection.
 * @param {string} projectId
 * @returns {Promise<object|null>}
 */
export async function getProjectMeta(projectId) {
  const ref = doc(db, 'projects', projectId);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Add a collaborator to a project.
 * @param {string} projectId
 * @param {string} email - Collaborator's email
 * @param {string} role - "annotator" | "viewer"
 * @param {string} invitedByUserId - UID of the inviting user
 */
export async function addCollaborator(projectId, email, role, invitedByUserId) {
  const ref = doc(db, 'projects', projectId, 'collaborators', email);
  await setDoc(ref, {
    email,
    role,
    status: 'pending',
    invitedBy: invitedByUserId,
    invitedAt: serverTimestamp(),
  });
}

/**
 * Remove a collaborator from a project.
 * @param {string} projectId
 * @param {string} email
 */
export async function removeCollaborator(projectId, email) {
  const ref = doc(db, 'projects', projectId, 'collaborators', email);
  await deleteDoc(ref);
}

/**
 * Update a collaborator's role.
 * @param {string} projectId
 * @param {string} email
 * @param {string} newRole - "annotator" | "viewer"
 */
export async function updateCollaboratorRole(projectId, email, newRole) {
  const ref = doc(db, 'projects', projectId, 'collaborators', email);
  await setDoc(ref, { role: newRole, updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * Get all collaborators for a project.
 * @param {string} projectId
 * @returns {Promise<Array<{email, role, status, invitedBy, invitedAt}>>}
 */
export async function getCollaborators(projectId) {
  const colRef = collection(db, 'projects', projectId, 'collaborators');
  const snap = await getDocs(colRef);
  return snap.docs.map(d => ({ email: d.id, ...d.data() }));
}

/**
 * Accept a collaboration invite (update status from pending to accepted).
 * @param {string} projectId
 * @param {string} email
 */
export async function acceptInvite(projectId, email) {
  const ref = doc(db, 'projects', projectId, 'collaborators', email);
  await setDoc(ref, { status: 'accepted', acceptedAt: serverTimestamp() }, { merge: true });
}

/**
 * Get all projects shared with a user by email.
 * Uses a collectionGroup query across all 'collaborators' subcollections.
 * @param {string} userEmail
 * @returns {Promise<Array<{projectId, role, status}>>}
 */
export async function getSharedProjects(userEmail) {
  if (!userEmail) return [];
  const q = query(
    collectionGroup(db, 'collaborators'),
    where('email', '==', userEmail)
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => {
    // d.ref.path is "projects/{projectId}/collaborators/{email}"
    const projectId = d.ref.parent.parent.id;
    return { projectId, ...d.data() };
  });
}
