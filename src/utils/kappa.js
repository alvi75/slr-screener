/**
 * Inter-rater agreement statistics: Cohen's Kappa (2 raters) and Fleiss' Kappa (3+ raters).
 * Categories: 'Yes', 'No', 'Maybe'
 */

const CATEGORIES = ['Yes', 'No', 'Maybe'];

/**
 * Cohen's Kappa for exactly 2 raters.
 * @param {string[]} rater1 - Array of decisions from rater 1
 * @param {string[]} rater2 - Array of decisions from rater 2 (same order/length)
 * @returns {number} Kappa coefficient (-1 to 1)
 */
export function cohensKappa(rater1, rater2) {
  if (!rater1 || !rater2 || rater1.length === 0 || rater1.length !== rater2.length) return 0;

  const n = rater1.length;

  // Build confusion matrix counts
  const matrix = {};
  for (const c1 of CATEGORIES) {
    matrix[c1] = {};
    for (const c2 of CATEGORIES) {
      matrix[c1][c2] = 0;
    }
  }

  for (let i = 0; i < n; i++) {
    const a = rater1[i];
    const b = rater2[i];
    if (matrix[a] && matrix[a][b] !== undefined) {
      matrix[a][b]++;
    }
  }

  // Observed agreement
  let agree = 0;
  for (const c of CATEGORIES) {
    agree += matrix[c][c];
  }
  const po = agree / n;

  // Expected agreement by chance
  let pe = 0;
  for (const c of CATEGORIES) {
    let r1Count = 0;
    let r2Count = 0;
    for (const c2 of CATEGORIES) {
      r1Count += matrix[c][c2];
      r2Count += matrix[c2][c];
    }
    pe += (r1Count / n) * (r2Count / n);
  }

  if (pe === 1) return 1;
  return (po - pe) / (1 - pe);
}

/**
 * Fleiss' Kappa for 3+ raters.
 * @param {Array<Object>} ratingsPerItem - Array of objects, one per item.
 *   Each object maps category -> count of raters who chose that category.
 *   e.g. [{ Yes: 2, No: 1, Maybe: 0 }, ...]
 * @param {number} numRaters - Number of raters per item
 * @returns {number} Kappa coefficient
 */
export function fleissKappa(ratingsPerItem, numRaters) {
  if (!ratingsPerItem || ratingsPerItem.length === 0 || numRaters < 2) return 0;

  const N = ratingsPerItem.length;
  const n = numRaters;
  const k = CATEGORIES.length;

  // P_i for each item: proportion of agreeing pairs
  const P_i = ratingsPerItem.map(item => {
    let sum = 0;
    for (const c of CATEGORIES) {
      const nij = item[c] || 0;
      sum += nij * nij;
    }
    return (sum - n) / (n * (n - 1));
  });

  // P-bar: mean of P_i
  const Pbar = P_i.reduce((a, b) => a + b, 0) / N;

  // p_j for each category: proportion of all assignments in that category
  const pj = {};
  for (const c of CATEGORIES) {
    let total = 0;
    for (const item of ratingsPerItem) {
      total += item[c] || 0;
    }
    pj[c] = total / (N * n);
  }

  // P-bar_e: expected agreement by chance
  let PbarE = 0;
  for (const c of CATEGORIES) {
    PbarE += pj[c] * pj[c];
  }

  if (PbarE === 1) return 1;
  return (Pbar - PbarE) / (1 - PbarE);
}

/**
 * Interpret a Kappa value.
 * @param {number} kappa
 * @returns {{ label: string, color: string }}
 */
export function interpretKappa(kappa) {
  if (kappa > 0.8) return { label: 'Almost Perfect', color: '#00b894' };
  if (kappa > 0.6) return { label: 'Substantial', color: '#00cec9' };
  if (kappa > 0.4) return { label: 'Moderate', color: '#fdcb6e' };
  if (kappa > 0.2) return { label: 'Fair', color: '#e17055' };
  return { label: 'Poor', color: '#d63031' };
}

/**
 * Detect conflicts and compute agreement from multiple annotators' decisions.
 * @param {Object} annotatorDecisions - { annotatorId: { paperId: decision, ... }, ... }
 * @param {number} totalPapers - Total number of papers in the project
 * @returns {{ conflicts: string[], agreed: string[], screened: string[], agreementRate: number, kappa: number, kappaType: string }}
 */
export function analyzeConflicts(annotatorDecisions) {
  const annotatorIds = Object.keys(annotatorDecisions);
  if (annotatorIds.length === 0) return { conflicts: [], agreed: [], screened: [], agreementRate: 0, kappa: 0, kappaType: 'none' };

  // Collect all paper IDs that have been screened by at least 2 annotators
  const paperIds = new Set();
  for (const id of annotatorIds) {
    for (const paperId of Object.keys(annotatorDecisions[id] || {})) {
      paperIds.add(paperId);
    }
  }

  const screened = []; // papers screened by all annotators
  const conflicts = [];
  const agreed = [];

  for (const paperId of paperIds) {
    const decisions = [];
    for (const annotatorId of annotatorIds) {
      const d = annotatorDecisions[annotatorId]?.[paperId];
      if (d) decisions.push(d);
    }
    // Only consider papers screened by at least 2 annotators
    if (decisions.length < 2) continue;
    screened.push(paperId);

    const allSame = decisions.every(d => d === decisions[0]);
    if (allSame) {
      agreed.push(paperId);
    } else {
      conflicts.push(paperId);
    }
  }

  const agreementRate = screened.length > 0 ? (agreed.length / screened.length) * 100 : 0;

  // Compute Kappa
  let kappa = 0;
  let kappaType = 'none';

  if (annotatorIds.length === 2 && screened.length > 0) {
    // Cohen's Kappa
    const r1 = [];
    const r2 = [];
    for (const paperId of screened) {
      r1.push(annotatorDecisions[annotatorIds[0]][paperId]);
      r2.push(annotatorDecisions[annotatorIds[1]][paperId]);
    }
    kappa = cohensKappa(r1, r2);
    kappaType = "Cohen's";
  } else if (annotatorIds.length >= 3 && screened.length > 0) {
    // Fleiss' Kappa
    const ratingsPerItem = screened.map(paperId => {
      const counts = { Yes: 0, No: 0, Maybe: 0 };
      for (const annotatorId of annotatorIds) {
        const d = annotatorDecisions[annotatorId]?.[paperId];
        if (d && counts[d] !== undefined) counts[d]++;
      }
      return counts;
    });
    kappa = fleissKappa(ratingsPerItem, annotatorIds.length);
    kappaType = "Fleiss'";
  }

  return { conflicts, agreed, screened, agreementRate, kappa, kappaType };
}
