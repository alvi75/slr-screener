import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './App.css';

// Keyword categories for highlighting
const KEYWORDS = {
  model: {
    className: 'hl-model',
    words: [
      'LLM', 'LLMs', 'GPT', 'GPT-4', 'GPT-4o', 'GPT-3.5', 'GPT-3', 'CodeLlama', 'Code Llama',
      'CodeBERT', 'GraphCodeBERT', 'StarCoder', 'StarCoder2', 'DeepSeek', 'DeepSeek-Coder',
      'Codex', 'Copilot', 'GitHub Copilot', 'T5', 'CodeT5', 'CodeT5+', 'BERT', 'RoBERTa',
      'Llama', 'Llama 2', 'Llama 3', 'Qwen', 'Gemini', 'Claude', 'ChatGPT', 'transformer',
      'transformers', 'large language model', 'large language models'
    ],
  },
  detail: {
    className: 'hl-detail',
    words: [
      'parameter', 'parameters', 'billion', 'million', '7B', '13B', '34B', '70B',
      'model size', 'fine-tuning', 'fine-tune', 'fine-tuned', 'pre-trained', 'pre-training',
      'quantization', 'quantized', 'LoRA', 'QLoRA', 'PEFT', 'adapter', 'adapters',
    ],
  },
  task: {
    className: 'hl-task',
    words: [
      'code generation', 'code summarization', 'vulnerability detection', 'bug detection',
      'code review', 'code completion', 'code search', 'code translation',
      'defect prediction', 'program repair', 'test generation', 'automated program repair',
      'code clone detection', 'code smell', 'software vulnerability',
    ],
  },
  method: {
    className: 'hl-method',
    words: [
      'training', 'inference', 'evaluation', 'benchmark', 'benchmarks', 'dataset', 'datasets',
      'deep learning', 'neural network', 'neural networks', 'machine learning',
    ],
  },
};

function buildHighlightRegex() {
  const allEntries = [];
  for (const [, cat] of Object.entries(KEYWORDS)) {
    for (const w of cat.words) {
      allEntries.push({ pattern: w, className: cat.className });
    }
  }
  allEntries.sort((a, b) => b.pattern.length - a.pattern.length);
  const escaped = allEntries.map((e) => e.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi');
  const lookup = {};
  for (const e of allEntries) {
    lookup[e.pattern.toLowerCase()] = e.className;
  }
  return { regex, lookup };
}

const { regex: hlRegex, lookup: hlLookup } = buildHighlightRegex();

function stripHtml(text) {
  // Remove XML/HTML tags and attributes like <tex xmlns:mml="...">, <italic>, <i>, etc.
  return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function highlightAbstract(text) {
  const clean = stripHtml(text);
  const parts = clean.split(hlRegex);
  return parts.map((part, i) => {
    const cls = hlLookup[part.toLowerCase()];
    if (cls) {
      return <span key={i} className={cls}>{part}</span>;
    }
    return part;
  });
}

const VENUES = ['All', 'ICSE 2025', 'FSE 2025', 'ASE 2025', 'TOSEM 2025', 'TSE 2025'];
const STORAGE_KEY = 'slr-screener-decisions';
const INDEX_KEY = 'slr-screener-index';

function venueCls(conf) {
  if (conf.includes('ICSE')) return 'icse';
  if (conf.includes('FSE')) return 'fse';
  if (conf.includes('ASE')) return 'ase';
  if (conf.includes('TOSEM')) return 'tosem';
  if (conf.includes('TSE')) return 'tse';
  return '';
}

function App() {
  const [papers, setPapers] = useState([]);
  const [decisions, setDecisions] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [venueFilter, setVenueFilter] = useState('All');
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [loading, setLoading] = useState(true);
  const [abstractEdits, setAbstractEdits] = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [sidebarFilter, setSidebarFilter] = useState('All');
  const [undoStack, setUndoStack] = useState([]);

  // Use ref to track whether we should auto-advance after decision
  const shouldAdvanceRef = useRef(false);

  // Load data
  useEffect(() => {
    fetch(process.env.PUBLIC_URL + '/enriched_papers_2025.json')
      .then((r) => r.json())
      .then((data) => {
        setPapers(data.papers);
        setLoading(false);
      });
  }, []);

  // Load saved state
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setDecisions(JSON.parse(saved));
      const savedIdx = localStorage.getItem(INDEX_KEY);
      if (savedIdx) setCurrentIndex(parseInt(savedIdx, 10));
      const savedEdits = localStorage.getItem('slr-screener-abstracts');
      if (savedEdits) setAbstractEdits(JSON.parse(savedEdits));
    } catch (e) { /* ignore */ }
  }, []);

  // Auto-save
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(decisions));
  }, [decisions]);

  useEffect(() => {
    if (Object.keys(abstractEdits).length > 0) {
      localStorage.setItem('slr-screener-abstracts', JSON.stringify(abstractEdits));
    }
  }, [abstractEdits]);

  // Venue-only filtering (no decision filter in main view)
  const filteredIndices = useMemo(() => {
    return papers.reduce((acc, p, i) => {
      if (venueFilter !== 'All' && p.conf !== venueFilter) return acc;
      acc.push(i);
      return acc;
    }, []);
  }, [papers, venueFilter]);

  const safeIndex = Math.min(currentIndex, Math.max(0, filteredIndices.length - 1));
  const globalIndex = filteredIndices[safeIndex];
  const paper = papers[globalIndex];

  // Save index
  useEffect(() => {
    localStorage.setItem(INDEX_KEY, String(safeIndex));
  }, [safeIndex]);

  const getAbstract = useCallback((gIdx) => {
    if (abstractEdits[gIdx]) return abstractEdits[gIdx];
    return papers[gIdx]?.abstract || '';
  }, [papers, abstractEdits]);

  // Handle auto-advance after decision state updates
  useEffect(() => {
    if (shouldAdvanceRef.current) {
      shouldAdvanceRef.current = false;
      setCurrentIndex((prev) => {
        const maxIdx = filteredIndices.length - 1;
        return prev < maxIdx ? prev + 1 : prev;
      });
    }
  }, [decisions, filteredIndices.length]);

  const makeDecision = useCallback((d) => {
    if (globalIndex === undefined) return;
    const prevDecision = decisions[globalIndex] || null;

    // Push to undo stack
    setUndoStack((stack) => [...stack.slice(-50), { globalIndex, previousDecision: prevDecision }]);

    // Only auto-advance if this is a NEW decision (no previous decision)
    if (!prevDecision) {
      shouldAdvanceRef.current = true;
    }

    setDecisions((prev) => ({ ...prev, [globalIndex]: d }));
  }, [globalIndex, decisions]);

  const undoDecision = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack;
      const last = stack[stack.length - 1];
      setDecisions((prev) => {
        const next = { ...prev };
        if (last.previousDecision) {
          next[last.globalIndex] = last.previousDecision;
        } else {
          delete next[last.globalIndex];
        }
        return next;
      });
      return stack.slice(0, -1);
    });
  }, []);

  const jumpToPaper = useCallback((gIdx) => {
    const pos = filteredIndices.indexOf(gIdx);
    if (pos !== -1) {
      setCurrentIndex(pos);
    } else {
      // Reset venue filter to show all papers, then jump
      setVenueFilter('All');
      // When venue is "All", filteredIndices = [0,1,2,...n], so position = gIdx
      setCurrentIndex(gIdx);
    }
  }, [filteredIndices]);

  // Sidebar decided papers list
  const sidebarPapers = useMemo(() => {
    const searchLower = sidebarSearch.toLowerCase();
    return Object.entries(decisions)
      .filter(([, d]) => {
        if (sidebarFilter === 'Yes' && d !== 'Yes') return false;
        if (sidebarFilter === 'No' && d !== 'No') return false;
        if (sidebarFilter === 'Maybe' && d !== 'Maybe') return false;
        return true;
      })
      .map(([idx, d]) => ({ idx: Number(idx), decision: d, paper: papers[Number(idx)] }))
      .filter((item) => item.paper && (!searchLower || item.paper.title.toLowerCase().includes(searchLower)))
      .sort((a, b) => a.idx - b.idx);
  }, [decisions, papers, sidebarSearch, sidebarFilter]);

  const goNext = useCallback(() => {
    if (safeIndex < filteredIndices.length - 1) setCurrentIndex(safeIndex + 1);
  }, [safeIndex, filteredIndices.length]);

  const goPrev = useCallback(() => {
    if (safeIndex > 0) setCurrentIndex(safeIndex - 1);
  }, [safeIndex]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e) {
      if (editing) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch (e.key.toLowerCase()) {
        case 'y': makeDecision('Yes'); break;
        case 'n': makeDecision('No'); break;
        case 'm': makeDecision('Maybe'); break;
        case 'u': undoDecision(); break;
        case 'arrowright': goNext(); break;
        case 'arrowleft': goPrev(); break;
        default: break;
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [editing, makeDecision, undoDecision, goNext, goPrev]);

  // Export CSV
  const exportCSV = useCallback(() => {
    const escapeCSV = (s) => {
      if (!s) return '';
      const str = String(s);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };
    const header = 'conf,title,author,decision,abstract,doi,pdf_url,arxiv_id';
    const rows = papers.map((p, i) => {
      const abs = getAbstract(i);
      return [
        escapeCSV(p.conf), escapeCSV(p.title), escapeCSV(p.author),
        escapeCSV(decisions[i] || ''), escapeCSV(abs),
        escapeCSV(p.doi || ''), escapeCSV(p.pdf_url || ''), escapeCSV(p.arxiv_id || ''),
      ].join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'slr_triage_results.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [papers, decisions, getAbstract]);

  const clearAllDecisions = useCallback(() => {
    setDecisions({});
    setUndoStack([]);
    setCurrentIndex(0);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(INDEX_KEY);
  }, []);

  // Progress stats
  const totalPapers = papers.length;
  const yesCount = Object.values(decisions).filter((d) => d === 'Yes').length;
  const noCount = Object.values(decisions).filter((d) => d === 'No').length;
  const maybeCount = Object.values(decisions).filter((d) => d === 'Maybe').length;
  const decidedCount = yesCount + noCount + maybeCount;

  if (loading) {
    return <div className="app" style={{ textAlign: 'center', paddingTop: 100 }}>Loading papers...</div>;
  }

  const abstract = paper ? getAbstract(globalIndex) : '';
  const isMissing = !abstract || abstract === 'not_found';
  const scholarUrl = paper
    ? `https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`
    : '';

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <h1>SLR Paper Screener</h1>
        <div className="header-actions">
          <span style={{ fontSize: 13, color: '#636e72' }}>
            {decidedCount}/{totalPapers} screened
          </span>
          <button className="export-btn" onClick={exportCSV}>Export CSV</button>
          <button className="sidebar-toggle-btn" onClick={() => setSidebarOpen((v) => !v)}>
            {sidebarOpen ? 'Hide Log' : 'Decision Log'}
          </button>
        </div>
      </div>

      {/* Progress */}
      <div className="progress-section">
        <div className="progress-stats">
          <span>Yes: {yesCount}</span>
          <span>Maybe: {maybeCount}</span>
          <span>No: {noCount}</span>
          <span>Remaining: {totalPapers - decidedCount}</span>
        </div>
        <div className="progress-bar-track">
          <div className="progress-bar-segments">
            {yesCount > 0 && <div className="progress-bar-fill fill-yes" style={{ width: `${(yesCount / totalPapers) * 100}%` }} />}
            {maybeCount > 0 && <div className="progress-bar-fill fill-maybe" style={{ width: `${(maybeCount / totalPapers) * 100}%` }} />}
            {noCount > 0 && <div className="progress-bar-fill fill-no" style={{ width: `${(noCount / totalPapers) * 100}%` }} />}
          </div>
        </div>
      </div>

      {/* Venue Filter */}
      <div className="filters">
        <span className="filter-label">Venue:</span>
        {VENUES.map((v) => (
          <button
            key={v}
            className={`filter-btn ${venueFilter === v ? 'active' : ''}`}
            onClick={() => { setVenueFilter(v); setCurrentIndex(0); }}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="legend">
        <div className="legend-item"><div className="legend-swatch" style={{ background: '#ffecd2' }} /> Model names</div>
        <div className="legend-item"><div className="legend-swatch" style={{ background: '#dfe6fd' }} /> Model details</div>
        <div className="legend-item"><div className="legend-swatch" style={{ background: '#c8f7c5' }} /> SE tasks</div>
        <div className="legend-item"><div className="legend-swatch" style={{ background: '#e8daef' }} /> Methods</div>
      </div>

      {/* Paper */}
      {paper ? (
        <>
          <div className="paper-card">
            <div className="paper-meta">
              <span className={`venue-badge ${venueCls(paper.conf)}`}>{paper.conf}</span>
              <span className="paper-number">#{globalIndex + 1} of {totalPapers}</span>
              {decisions[globalIndex] && (
                <span className={`decision-badge ${decisions[globalIndex].toLowerCase()}`}>
                  {decisions[globalIndex]}
                </span>
              )}
            </div>
            <div className="paper-title">{paper.title}</div>
            <div className="paper-authors">{paper.author}</div>

            {/* Links */}
            <div className="paper-links">
              {paper.pdf_url && (
                <a className="paper-link" href={paper.pdf_url} target="_blank" rel="noreferrer">PDF</a>
              )}
              {paper.doi_url && (
                <a className="paper-link" href={paper.doi_url} target="_blank" rel="noreferrer">DOI</a>
              )}
              {paper.arxiv_id && (
                <a className="paper-link" href={`https://arxiv.org/abs/${paper.arxiv_id}`} target="_blank" rel="noreferrer">arXiv</a>
              )}
              {paper.openalex_id && (
                <a className="paper-link" href={paper.openalex_id} target="_blank" rel="noreferrer">OpenAlex</a>
              )}
            </div>

            {/* Abstract */}
            <div className="abstract-section">
              <div className="abstract-label">
                Abstract
                {!editing && (
                  <button className="edit-btn" onClick={() => { setEditing(true); setEditText(abstract); }}>Edit</button>
                )}
              </div>

              {editing ? (
                <div>
                  <textarea
                    className="abstract-edit"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    autoFocus
                  />
                  <div className="edit-actions">
                    <button className="save-btn" onClick={() => {
                      setAbstractEdits((prev) => ({ ...prev, [globalIndex]: editText }));
                      setEditing(false);
                    }}>Save</button>
                    <button className="cancel-btn" onClick={() => setEditing(false)}>Cancel</button>
                  </div>
                </div>
              ) : isMissing ? (
                <div className="abstract-warning">
                  Abstract not available.
                  <a href={scholarUrl} target="_blank" rel="noreferrer">Search on Google Scholar</a>
                  <span style={{ marginLeft: 4 }}> — or click Edit to paste it manually.</span>
                </div>
              ) : (
                <div className="abstract-text">{highlightAbstract(abstract)}</div>
              )}
            </div>
          </div>

          {/* Decision buttons */}
          <div className="decision-section">
            <button
              className={`decision-btn btn-yes ${decisions[globalIndex] === 'Yes' ? 'selected' : ''}`}
              onClick={() => makeDecision('Yes')}
            >
              Yes <span className="shortcut">Y</span>
            </button>
            <button
              className={`decision-btn btn-maybe ${decisions[globalIndex] === 'Maybe' ? 'selected' : ''}`}
              onClick={() => makeDecision('Maybe')}
            >
              Maybe <span className="shortcut">M</span>
            </button>
            <button
              className={`decision-btn btn-no ${decisions[globalIndex] === 'No' ? 'selected' : ''}`}
              onClick={() => makeDecision('No')}
            >
              No <span className="shortcut">N</span>
            </button>
            <button
              className="decision-btn btn-undo"
              onClick={undoDecision}
              disabled={undoStack.length === 0}
            >
              Undo <span className="shortcut">U</span>
            </button>
          </div>

          {/* Navigation */}
          <div className="navigation">
            <button className="nav-btn" onClick={goPrev} disabled={safeIndex === 0}>
              &larr; Previous
            </button>
            <span className="nav-info">{safeIndex + 1} / {filteredIndices.length}</span>
            <button className="nav-btn" onClick={goNext} disabled={safeIndex >= filteredIndices.length - 1}>
              Next &rarr;
            </button>
          </div>

          <div className="keyboard-hints">
            <kbd>Y</kbd> Yes &nbsp; <kbd>N</kbd> No &nbsp; <kbd>M</kbd> Maybe &nbsp; <kbd>U</kbd> Undo &nbsp; <kbd>&larr;</kbd> <kbd>&rarr;</kbd> Navigate
          </div>
        </>
      ) : (
        <div className="paper-card" style={{ textAlign: 'center', color: '#b2bec3' }}>
          No papers match the current filters.
        </div>
      )}

      {/* Sidebar */}
      <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>Decision Log</h2>
          <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>&times;</button>
        </div>
        <input
          className="sidebar-search"
          type="text"
          placeholder="Search by title..."
          value={sidebarSearch}
          onChange={(e) => setSidebarSearch(e.target.value)}
        />
        <div className="sidebar-filters">
          {['All', 'Yes', 'No', 'Maybe'].map((f) => {
            const count = f === 'All' ? decidedCount
              : f === 'Yes' ? yesCount
              : f === 'No' ? noCount : maybeCount;
            return (
              <button
                key={f}
                className={`sidebar-filter-btn ${sidebarFilter === f ? `active sf-${f.toLowerCase()}` : ''}`}
                onClick={() => setSidebarFilter(f)}
              >
                {f} ({count})
              </button>
            );
          })}
        </div>
        <div className="sidebar-list">
          {sidebarPapers.length === 0 ? (
            <div className="sidebar-empty">No decisions yet.</div>
          ) : (
            sidebarPapers.map((item) => (
              <div
                key={item.idx}
                className={`sidebar-item ${item.idx === globalIndex ? 'active' : ''}`}
                onClick={() => jumpToPaper(item.idx)}
              >
                <div className="sidebar-item-top">
                  <span className={`venue-badge small ${venueCls(item.paper.conf)}`}>{item.paper.conf}</span>
                  <span className={`sidebar-decision ${item.decision.toLowerCase()}`}>{item.decision}</span>
                </div>
                <div className="sidebar-item-title">
                  {item.paper.title.length > 80 ? item.paper.title.slice(0, 80) + '...' : item.paper.title}
                </div>
              </div>
            ))
          )}
        </div>
        {decidedCount > 0 && (
          <div className="sidebar-footer">
            <button className="reset-btn full-width" onClick={() => { if (window.confirm(`Clear all ${decidedCount} decisions? This cannot be undone.`)) clearAllDecisions(); }}>
              Reset All Decisions
            </button>
          </div>
        )}
      </div>
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
    </div>
  );
}

export default App;
