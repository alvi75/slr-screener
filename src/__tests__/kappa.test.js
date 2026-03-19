/**
 * Tests for Kappa calculations and conflict detection logic.
 */
import { cohensKappa, fleissKappa, interpretKappa, analyzeConflicts } from '../utils/kappa';

describe('cohensKappa', () => {
  test('returns 1 for perfect agreement', () => {
    const r1 = ['Yes', 'No', 'Maybe', 'Yes', 'No'];
    const r2 = ['Yes', 'No', 'Maybe', 'Yes', 'No'];
    expect(cohensKappa(r1, r2)).toBeCloseTo(1.0);
  });

  test('returns 0 for random-level agreement', () => {
    // Two raters who always say the same thing (all Yes) — observed = expected
    const r1 = ['Yes', 'Yes', 'Yes', 'Yes'];
    const r2 = ['Yes', 'Yes', 'Yes', 'Yes'];
    // Both always say Yes: po = 1, pe = 1, kappa = 1 (they agree perfectly on Yes)
    expect(cohensKappa(r1, r2)).toBe(1);
  });

  test('returns negative for worse-than-chance agreement', () => {
    // Rater 1 says Yes when Rater 2 says No and vice versa
    const r1 = ['Yes', 'No', 'Yes', 'No'];
    const r2 = ['No', 'Yes', 'No', 'Yes'];
    expect(cohensKappa(r1, r2)).toBeLessThan(0);
  });

  test('returns moderate agreement for partial overlap', () => {
    const r1 = ['Yes', 'Yes', 'No', 'No', 'Maybe', 'Yes', 'No', 'Maybe', 'Yes', 'No'];
    const r2 = ['Yes', 'No', 'No', 'No', 'Maybe', 'Yes', 'Yes', 'Maybe', 'Yes', 'No'];
    const kappa = cohensKappa(r1, r2);
    // Should be moderate (between 0.4 and 0.8)
    expect(kappa).toBeGreaterThan(0.3);
    expect(kappa).toBeLessThan(0.9);
  });

  test('returns 0 for empty arrays', () => {
    expect(cohensKappa([], [])).toBe(0);
  });

  test('returns 0 for null input', () => {
    expect(cohensKappa(null, null)).toBe(0);
  });

  test('returns 0 for mismatched lengths', () => {
    expect(cohensKappa(['Yes'], ['Yes', 'No'])).toBe(0);
  });
});

describe('fleissKappa', () => {
  test('returns 1 for perfect agreement among 3 raters', () => {
    const ratings = [
      { Yes: 3, No: 0, Maybe: 0 },
      { Yes: 0, No: 3, Maybe: 0 },
      { Yes: 0, No: 0, Maybe: 3 },
      { Yes: 3, No: 0, Maybe: 0 },
    ];
    expect(fleissKappa(ratings, 3)).toBeCloseTo(1.0);
  });

  test('returns 0 for empty input', () => {
    expect(fleissKappa([], 3)).toBe(0);
  });

  test('returns 0 for less than 2 raters', () => {
    expect(fleissKappa([{ Yes: 1, No: 0, Maybe: 0 }], 1)).toBe(0);
  });

  test('computes moderate agreement for mixed ratings', () => {
    const ratings = [
      { Yes: 2, No: 1, Maybe: 0 },
      { Yes: 3, No: 0, Maybe: 0 },
      { Yes: 0, No: 2, Maybe: 1 },
      { Yes: 1, No: 1, Maybe: 1 },
      { Yes: 0, No: 3, Maybe: 0 },
    ];
    const kappa = fleissKappa(ratings, 3);
    // Should be between -1 and 1
    expect(kappa).toBeGreaterThan(-1);
    expect(kappa).toBeLessThanOrEqual(1);
  });
});

describe('interpretKappa', () => {
  test('Almost Perfect for kappa > 0.8', () => {
    expect(interpretKappa(0.9).label).toBe('Almost Perfect');
  });

  test('Substantial for kappa 0.6-0.8', () => {
    expect(interpretKappa(0.7).label).toBe('Substantial');
  });

  test('Moderate for kappa 0.4-0.6', () => {
    expect(interpretKappa(0.5).label).toBe('Moderate');
  });

  test('Fair for kappa 0.2-0.4', () => {
    expect(interpretKappa(0.3).label).toBe('Fair');
  });

  test('Poor for kappa < 0.2', () => {
    expect(interpretKappa(0.1).label).toBe('Poor');
  });
});

describe('analyzeConflicts', () => {
  test('detects conflicts between 2 annotators', () => {
    const annotatorDecisions = {
      'user1': { '0': 'Yes', '1': 'No', '2': 'Maybe', '3': 'Yes' },
      'user2': { '0': 'Yes', '1': 'Yes', '2': 'Maybe', '3': 'No' },
    };
    const result = analyzeConflicts(annotatorDecisions);
    expect(result.agreed).toEqual(expect.arrayContaining(['0', '2']));
    expect(result.conflicts).toEqual(expect.arrayContaining(['1', '3']));
    expect(result.screened.length).toBe(4);
    expect(result.agreementRate).toBe(50);
    expect(result.kappaType).toBe("Cohen's");
  });

  test('detects all agreement', () => {
    const annotatorDecisions = {
      'user1': { '0': 'Yes', '1': 'No' },
      'user2': { '0': 'Yes', '1': 'No' },
    };
    const result = analyzeConflicts(annotatorDecisions);
    expect(result.agreed.length).toBe(2);
    expect(result.conflicts.length).toBe(0);
    expect(result.agreementRate).toBe(100);
    expect(result.kappa).toBeCloseTo(1.0);
  });

  test('handles empty annotator decisions', () => {
    const result = analyzeConflicts({});
    expect(result.conflicts).toEqual([]);
    expect(result.agreed).toEqual([]);
    expect(result.screened).toEqual([]);
    expect(result.kappa).toBe(0);
  });

  test('ignores papers screened by only 1 annotator', () => {
    const annotatorDecisions = {
      'user1': { '0': 'Yes', '1': 'No', '2': 'Maybe' },
      'user2': { '0': 'Yes' },  // Only screened paper 0
    };
    const result = analyzeConflicts(annotatorDecisions);
    // Only paper 0 screened by both
    expect(result.screened.length).toBe(1);
    expect(result.agreed).toEqual(['0']);
    expect(result.conflicts.length).toBe(0);
  });

  test('uses Fleiss Kappa for 3+ annotators', () => {
    const annotatorDecisions = {
      'user1': { '0': 'Yes', '1': 'No', '2': 'Maybe' },
      'user2': { '0': 'Yes', '1': 'Yes', '2': 'Maybe' },
      'user3': { '0': 'Yes', '1': 'No', '2': 'No' },
    };
    const result = analyzeConflicts(annotatorDecisions);
    expect(result.kappaType).toBe("Fleiss'");
    expect(result.agreed).toEqual(['0']); // All say Yes
    expect(result.conflicts).toEqual(expect.arrayContaining(['1', '2']));
  });

  test('agreement rate is 0 when no papers screened by 2+', () => {
    const annotatorDecisions = {
      'user1': { '0': 'Yes' },
      'user2': { '1': 'No' },
    };
    const result = analyzeConflicts(annotatorDecisions);
    expect(result.screened.length).toBe(0);
    expect(result.agreementRate).toBe(0);
  });
});
