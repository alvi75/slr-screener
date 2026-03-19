import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../App';
import { setupFetchMock, clearStorage, MOCK_PAPERS } from '../testHelpers';

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

describe('Highlights', () => {
  test('Highlight toggle shows/hides keyword highlights', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Highlights should be ON by default — look for highlighted spans
    // Paper 0 abstract has "large language models", "code generation", "transformer"
    const abstractSection = document.querySelector('.abstract-text');
    expect(abstractSection).not.toBeNull();

    // There should be highlighted spans (hl-tip class)
    let highlightedSpans = abstractSection.querySelectorAll('.hl-tip');
    expect(highlightedSpans.length).toBeGreaterThan(0);

    // Toggle highlights OFF with H key
    fireEvent.keyDown(document, { key: 'h' });

    await waitFor(() => {
      // The button text should change
      expect(screen.getByText(/Highlights Off/)).toBeInTheDocument();
    });

    // Abstract should now be plain text, no hl-tip spans
    const plainAbstract = document.querySelector('.abstract-text');
    if (plainAbstract) {
      const spans = plainAbstract.querySelectorAll('.hl-tip');
      expect(spans.length).toBe(0);
    }

    // Toggle back ON
    fireEvent.keyDown(document, { key: 'h' });
    await waitFor(() => {
      expect(screen.getByText(/Highlights On/)).toBeInTheDocument();
    });

    // Highlights should be back
    const reHighlighted = document.querySelector('.abstract-text');
    if (reHighlighted) {
      highlightedSpans = reHighlighted.querySelectorAll('.hl-tip');
      expect(highlightedSpans.length).toBeGreaterThan(0);
    }
  });

  test('Keywords match whole words only (no partial matches)', async () => {
    render(<App />);

    // Navigate to paper 4 (index 3): "Test Generation Using Machine Learning"
    // Abstract: "automated test generation using deep learning and training on evaluation benchmarks"
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    // Go to paper 4
    for (let i = 0; i < 3; i++) {
      fireEvent.keyDown(document, { key: 'ArrowRight' });
    }
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[3].title)).toBeInTheDocument();
    });

    const abstractSection = document.querySelector('.abstract-text');
    expect(abstractSection).not.toBeNull();

    // "training" should be highlighted (it's a keyword)
    const allHighlighted = abstractSection.querySelectorAll('.hl-tip');
    const highlightedTexts = Array.from(allHighlighted).map(el => el.textContent.toLowerCase());

    // "training" should appear highlighted
    expect(highlightedTexts.some(t => t === 'training')).toBe(true);

    // "train" alone should NOT appear as a separate highlight (whole word matching)
    // The word "training" should not be split into "train" + "ing"
    expect(highlightedTexts.some(t => t === 'train')).toBe(false);
  });

  test('Hover tooltip appears on highlighted words', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(MOCK_PAPERS[0].title)).toBeInTheDocument();
    });

    const abstractSection = document.querySelector('.abstract-text');
    expect(abstractSection).not.toBeNull();

    // Find a highlighted span
    const highlightedSpans = abstractSection.querySelectorAll('.hl-tip');
    expect(highlightedSpans.length).toBeGreaterThan(0);

    // Each highlighted span should have a data-tip attribute for the tooltip
    const firstHighlight = highlightedSpans[0];
    expect(firstHighlight.getAttribute('data-tip')).toBeTruthy();
    // data-tip format is "Category: matched term"
    expect(firstHighlight.getAttribute('data-tip')).toContain(':');
  });
});
