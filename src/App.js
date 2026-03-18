import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './App.css';

// ===== 3-COLOR HIGHLIGHT SYSTEM =====
// All keywords and patterns map to 3 categories: model (blue), task (green), method (purple)
// Each entry carries a sublabel shown on hover tooltip

const KEYWORDS = [
  // Model-related (blue) — model names
  ...['LLM', 'LLMs', 'GPT', 'GPT-4', 'GPT-4o', 'GPT-3.5', 'GPT-3', 'CodeLlama', 'Code Llama',
    'CodeBERT', 'GraphCodeBERT', 'StarCoder', 'StarCoder2', 'DeepSeek', 'DeepSeek-Coder',
    'Codex', 'Copilot', 'GitHub Copilot', 'T5', 'CodeT5', 'CodeT5+', 'BERT', 'RoBERTa',
    'Llama', 'Llama 2', 'Llama 3', 'Qwen', 'Gemini', 'Claude', 'ChatGPT', 'transformer',
    'transformers', 'large language model', 'large language models'
  ].map(w => ({ word: w, cls: 'hl-model', label: 'Model name' })),
  // Model-related (blue) — model details
  ...['parameter', 'parameters', 'billion', 'million', '7B', '13B', '34B', '70B',
    'model size', 'fine-tuning', 'fine-tune', 'fine-tuned', 'pre-trained', 'pre-training',
    'quantization', 'quantized', 'LoRA', 'QLoRA', 'PEFT', 'adapter', 'adapters'
  ].map(w => ({ word: w, cls: 'hl-model', label: 'Model detail' })),
  // SE tasks (green)
  ...['code generation', 'code summarization', 'vulnerability detection', 'bug detection',
    'code review', 'code completion', 'code search', 'code translation',
    'defect prediction', 'program repair', 'test generation', 'automated program repair',
    'code clone detection', 'code smell', 'software vulnerability'
  ].map(w => ({ word: w, cls: 'hl-task', label: 'SE task' })),
  // Methods (purple)
  ...['training', 'inference', 'evaluation', 'benchmark', 'benchmarks', 'dataset', 'datasets',
    'deep learning', 'neural network', 'neural networks', 'machine learning'
  ].map(w => ({ word: w, cls: 'hl-method', label: 'Method' })),
];

// Sort longest first so longer phrases match before shorter substrings
KEYWORDS.sort((a, b) => b.word.length - a.word.length);

function buildHighlightRegex() {
  const escaped = KEYWORDS.map(e => e.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Wrap each keyword with \b word boundaries to prevent partial-word matches
  const regex = new RegExp(`(\\b(?:${escaped.join('|')})\\b)`, 'gi');
  const lookup = {};
  for (const e of KEYWORDS) {
    lookup[e.word.toLowerCase()] = { cls: e.cls, label: e.label };
  }
  return { regex, lookup };
}

const { regex: hlRegex, lookup: hlLookup } = buildHighlightRegex();

// Pattern-based rules — merged into the same 3 colors
const PATTERNS = [
  // Model size: number + B/b (e.g., 7B, 13B, 70b)
  { regex: /\b\d+\.?\d*[Bb]\b/g, cls: 'hl-model', label: 'Model size' },
  // billion/million parameters/params
  { regex: /\b\d+\.?\d*\s*(?:billion|million|B|M|K)\s+(?:parameters?|params?)\b/gi, cls: 'hl-model', label: 'Model size' },
  // Model variants: known model name followed by -base, -large, -instruct, etc.
  { regex: /\b(?:GPT|Llama|CodeLlama|Qwen|DeepSeek|Gemma|Mistral|Phi|StarCoder|CodeT5|BERT|RoBERTa|T5|Falcon|Vicuna|WizardCoder|CodeGen|InCoder|SantaCoder|OctoCoder)[-](?:base|large|small|medium|instruct|chat|coder|plus|xl|xxl)\b/gi, cls: 'hl-model', label: 'Model variant' },
  // Version patterns: v1, v2, v3, GPT-3.5, GPT-4o, etc.
  { regex: /\b(?:v\d+(?:\.\d+)?|GPT-\d+(?:\.\d+)?[a-z]?)\b/gi, cls: 'hl-model', label: 'Version' },
  // Numeric context: number + ML-specific units (parameters/layers/tokens/epochs/GPUs)
  { regex: /\b\d+[\d,]*\.?\d*\s*(?:parameters?|layers?|tokens?|epochs?|GPUs?)\b/gi, cls: 'hl-model', label: 'Numeric context' },
  // Action phrases → method (purple)
  { regex: /\b(?:fine-tuned|trained|evaluated|pre-trained|finetuned)\s+on\b/gi, cls: 'hl-method', label: 'Action phrase' },
];

function buildPatternRegex() {
  const parts = PATTERNS.map((p, i) => `(?<_p${i}>${p.regex.source})`);
  return new RegExp(parts.join('|'), 'gi');
}
const patternRegex = buildPatternRegex();

function applyPatterns(text, keyOffset) {
  const result = [];
  let lastIndex = 0;
  let match;
  patternRegex.lastIndex = 0;
  while ((match = patternRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(text.slice(lastIndex, match.index));
    }
    let cls = 'hl-model';
    let label = 'Model';
    for (let i = 0; i < PATTERNS.length; i++) {
      if (match.groups && match.groups[`_p${i}`] !== undefined) {
        cls = PATTERNS[i].cls;
        label = PATTERNS[i].label;
        break;
      }
    }
    result.push(
      <span key={`p${keyOffset}-${match.index}`} className={`${cls} hl-tip`} data-tip={`${label}: ${match[0]}`}>{match[0]}</span>
    );
    lastIndex = patternRegex.lastIndex;
  }
  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }
  return result.length > 0 ? result : [text];
}

function cleanAbstractText(text) {
  let s = text;
  // Remove HTML/XML tags
  s = s.replace(/<[^>]*>/g, '');
  // Remove LaTeX math delimiters: $...$, $$...$$, \(...\), \[...\]
  s = s.replace(/\$\$(.*?)\$\$/g, '$1');
  s = s.replace(/\$(.*?)\$/g, '$1');
  s = s.replace(/\\\((.*?)\\\)/g, '$1');
  s = s.replace(/\\\[(.*?)\\\]/g, '$1');
  // \operatorname{X}, \mathrm{X}, \textbf{X}, \textit{X}, \text{X}, etc.
  s = s.replace(/\\(?:operatorname|mathrm|textbf|textit|text|mathcal|mathbb|emph|textrm|mathit|boldsymbol|mbox|hbox)\{([^}]*)\}/g, '$1');
  // \frac{a}{b} -> a/b
  s = s.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1/$2');
  // \sqrt{x} -> sqrt(x)
  s = s.replace(/\\sqrt\{([^}]*)\}/g, 'sqrt($1)');
  // Greek letters -> Unicode symbols
  const greekMap = {
    alpha: '\u03B1', beta: '\u03B2', gamma: '\u03B3', delta: '\u03B4', epsilon: '\u03B5',
    varepsilon: '\u03B5', zeta: '\u03B6', eta: '\u03B7', theta: '\u03B8', vartheta: '\u03B8',
    iota: '\u03B9', kappa: '\u03BA', lambda: '\u03BB', mu: '\u03BC', nu: '\u03BD',
    xi: '\u03BE', pi: '\u03C0', rho: '\u03C1', sigma: '\u03C3', tau: '\u03C4',
    upsilon: '\u03C5', phi: '\u03C6', varphi: '\u03C6', chi: '\u03C7', psi: '\u03C8',
    omega: '\u03C9',
    Gamma: '\u0393', Delta: '\u0394', Theta: '\u0398', Lambda: '\u039B', Xi: '\u039E',
    Pi: '\u03A0', Sigma: '\u03A3', Phi: '\u03A6', Psi: '\u03A8', Omega: '\u03A9',
  };
  for (const [cmd, sym] of Object.entries(greekMap)) {
    s = s.replace(new RegExp('\\\\' + cmd + '(?![a-zA-Z])', 'g'), sym);
  }
  // Common LaTeX symbols -> Unicode/readable
  s = s.replace(/\\%/g, '%');
  s = s.replace(/\\&/g, '&');
  s = s.replace(/\\#/g, '#');
  s = s.replace(/\\\$/g, '$');
  s = s.replace(/\\times(?![a-zA-Z])/g, '\u00D7');
  s = s.replace(/\\cdot(?![a-zA-Z])/g, '\u00B7');
  s = s.replace(/\\ldots|\\dots|\\cdots/g, '\u2026');
  s = s.replace(/\\leq(?![a-zA-Z])|\\le(?![a-zA-Z])/g, '\u2264');
  s = s.replace(/\\geq(?![a-zA-Z])|\\ge(?![a-zA-Z])/g, '\u2265');
  s = s.replace(/\\neq(?![a-zA-Z])|\\ne(?![a-zA-Z])/g, '\u2260');
  s = s.replace(/\\approx(?![a-zA-Z])/g, '\u2248');
  s = s.replace(/\\pm(?![a-zA-Z])/g, '\u00B1');
  s = s.replace(/\\infty(?![a-zA-Z])/g, '\u221E');
  s = s.replace(/\\rightarrow(?![a-zA-Z])|\\to(?![a-zA-Z])/g, '\u2192');
  s = s.replace(/\\leftarrow(?![a-zA-Z])/g, '\u2190');
  s = s.replace(/\\leftrightarrow(?![a-zA-Z])/g, '\u2194');
  s = s.replace(/\\in(?![a-zA-Z])/g, '\u2208');
  s = s.replace(/\\notin(?![a-zA-Z])/g, '\u2209');
  s = s.replace(/\\subset(?![a-zA-Z])/g, '\u2282');
  s = s.replace(/\\cup(?![a-zA-Z])/g, '\u222A');
  s = s.replace(/\\cap(?![a-zA-Z])/g, '\u2229');
  s = s.replace(/\\sim(?![a-zA-Z])/g, '~');
  s = s.replace(/\\log(?![a-zA-Z])/g, 'log');
  s = s.replace(/\\exp(?![a-zA-Z])/g, 'exp');
  s = s.replace(/\\min(?![a-zA-Z])/g, 'min');
  s = s.replace(/\\max(?![a-zA-Z])/g, 'max');
  s = s.replace(/\\sum(?![a-zA-Z])/g, '\u2211');
  s = s.replace(/\\prod(?![a-zA-Z])/g, '\u220F');
  s = s.replace(/\\forall(?![a-zA-Z])/g, '\u2200');
  s = s.replace(/\\exists(?![a-zA-Z])/g, '\u2203');
  s = s.replace(/\\neg(?![a-zA-Z])/g, '\u00AC');
  s = s.replace(/\\land(?![a-zA-Z])/g, '\u2227');
  s = s.replace(/\\lor(?![a-zA-Z])/g, '\u2228');
  s = s.replace(/\\emptyset(?![a-zA-Z])/g, '\u2205');
  s = s.replace(/\\ell(?![a-zA-Z])/g, '\u2113');
  // Superscript/subscript: remove ^ and _ with braces
  s = s.replace(/[_^]\{([^}]*)\}/g, '$1');
  s = s.replace(/[_^](.)/g, '$1');
  // Remove remaining \command (unknown commands)
  s = s.replace(/\\[a-zA-Z]+/g, '');
  // Remove leftover braces
  s = s.replace(/[{}]/g, '');
  // Fix "number %" -> "number%"
  s = s.replace(/(\d)\s+%/g, '$1%');
  // Fix "number x" multiplication when it's clearly numeric context
  s = s.replace(/(\d)\s*\u00D7\s*(\d)/g, '$1\u00D7$2');
  // Clean up empty parentheses/brackets from stripped content
  s = s.replace(/\(\s*,\s*\)/g, '');
  s = s.replace(/\(\s*\)/g, '');
  s = s.replace(/\[\s*\]/g, '');
  // Clean up orphaned commas in parentheses: (a, , b) -> (a, b)
  s = s.replace(/,\s*,/g, ',');
  // Clean up leading/trailing commas in parentheses: (, x) -> (x) and (x, ) -> (x)
  s = s.replace(/\(\s*,\s*/g, '(');
  s = s.replace(/\s*,\s*\)/g, ')');
  // Remove space before punctuation
  s = s.replace(/\s+([.,;:!?])/g, '$1');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function highlightAbstract(text) {
  const clean = cleanAbstractText(text);
  // First pass: split by keyword matches
  const parts = clean.split(hlRegex);
  const result = [];
  parts.forEach((part, i) => {
    const entry = hlLookup[part.toLowerCase()];
    if (entry) {
      // Keyword match — highlight with background + hover tooltip
      result.push(<span key={`k${i}`} className={`${entry.cls} hl-tip`} data-tip={`${entry.label}: ${part}`}>{part}</span>);
    } else if (part) {
      // Plain text — apply pattern-based highlights
      const patternParts = applyPatterns(part, i);
      patternParts.forEach((pp, j) => {
        if (typeof pp === 'string') {
          result.push(<React.Fragment key={`t${i}-${j}`}>{pp}</React.Fragment>);
        } else {
          result.push(pp);
        }
      });
    }
  });
  return result;
}

// ===== AI SCORING =====
const SCORING_PROMPT = `You are helping screen papers for a systematic literature review. The research goal is: identify papers that use, evaluate, or experiment with AI/ML models for software engineering tasks, especially papers that mention specific model names, model sizes, parameter counts, fine-tuning, or quantization. Rate this abstract 0-100 for relevance and suggest Yes/No/Maybe. Respond in JSON only: {"score": number, "suggestion": "yes"|"no"|"maybe", "reason": "one sentence why"}`;

const PROXY_URL = 'http://localhost:3001/api/score';

async function scoreOneAbstract(apiKey, title, abstract) {
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 150,
      messages: [
        { role: 'user', content: `${SCORING_PROMPT}\n\nTitle: ${title}\nAbstract: ${abstract}` },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API ${res.status}: ${err}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || '';
  // Parse JSON from response (handle markdown code blocks)
  const jsonStr = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(jsonStr);
  // Validate expected fields
  if (typeof parsed.score !== 'number' || !parsed.suggestion || !parsed.reason) {
    throw new Error('Unexpected response format: ' + jsonStr);
  }
  return { score: parsed.score, suggestion: parsed.suggestion.toLowerCase(), reason: parsed.reason };
}

const VENUES = ['All', 'ICSE 2025', 'FSE 2025', 'ASE 2025', 'TOSEM 2025', 'TSE 2025'];
const STORAGE_KEY = 'slr-screener-decisions';
const INDEX_KEY = 'slr-screener-index';
const VENUE_KEY = 'slr-screener-venue';
const SCORES_KEY = 'slr-screener-scores';
const APIKEY_KEY = 'slr-screener-apikey';

function venueCls(conf) {
  if (conf.includes('ICSE')) return 'icse';
  if (conf.includes('FSE')) return 'fse';
  if (conf.includes('ASE')) return 'ase';
  if (conf.includes('TOSEM')) return 'tosem';
  if (conf.includes('TSE')) return 'tse';
  return '';
}

function App() {
  // Initialize state from localStorage synchronously to avoid race conditions
  const [papers, setPapers] = useState([]);
  const [decisions, setDecisions] = useState(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s) : {}; }
    catch { return {}; }
  });
  const [currentIndex, setCurrentIndex] = useState(() => {
    try { const s = localStorage.getItem(INDEX_KEY); return s ? parseInt(s, 10) : 0; }
    catch { return 0; }
  });
  const [venueFilter, setVenueFilter] = useState(() => {
    try {
      const s = localStorage.getItem(VENUE_KEY);
      return s && VENUES.includes(s) ? s : 'All';
    } catch { return 'All'; }
  });
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [loading, setLoading] = useState(true);
  const [abstractEdits, setAbstractEdits] = useState(() => {
    try { const s = localStorage.getItem('slr-screener-abstracts'); return s ? JSON.parse(s) : {}; }
    catch { return {}; }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [sidebarFilter, setSidebarFilter] = useState('All');
  const [undoStack, setUndoStack] = useState([]);
  const [highlightsOn, setHighlightsOn] = useState(() => {
    try { return localStorage.getItem('slr-screener-highlights') !== 'off'; }
    catch { return true; }
  });
  const [aiInsightsOpen, setAiInsightsOpen] = useState(false);

  // AI scoring state
  const [aiScores, setAiScores] = useState(() => {
    try { const s = localStorage.getItem(SCORES_KEY); return s ? JSON.parse(s) : {}; }
    catch { return {}; }
  });
  const [apiKey, setApiKey] = useState(() => {
    try { return localStorage.getItem(APIKEY_KEY) || ''; }
    catch { return ''; }
  });
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [scoringProgress, setScoringProgress] = useState(null); // { done, total, errors }
  const [sortByScore, setSortByScore] = useState(false);
  const scoringAbortRef = useRef(false);

  console.log('[SLR] Restored state — index:', currentIndex, 'venue:', venueFilter, 'decisions:', Object.keys(decisions).length);

  // Load data
  const loadData = useCallback(() => {
    fetch(process.env.PUBLIC_URL + '/enriched_papers_2025.json?t=' + Date.now())
      .then((r) => r.json())
      .then((data) => {
        setPapers(data.papers);
        setLoading(false);
      });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Auto-save decisions
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(decisions));
  }, [decisions]);

  // Auto-save abstract edits
  useEffect(() => {
    if (Object.keys(abstractEdits).length > 0) {
      localStorage.setItem('slr-screener-abstracts', JSON.stringify(abstractEdits));
    }
  }, [abstractEdits]);

  // Save venue filter
  useEffect(() => {
    localStorage.setItem(VENUE_KEY, venueFilter);
  }, [venueFilter]);

  // Save highlights toggle
  useEffect(() => {
    localStorage.setItem('slr-screener-highlights', highlightsOn ? 'on' : 'off');
  }, [highlightsOn]);

  // Save AI scores
  useEffect(() => {
    localStorage.setItem(SCORES_KEY, JSON.stringify(aiScores));
  }, [aiScores]);

  // Venue-only filtering, optionally sorted by AI score
  const filteredIndices = useMemo(() => {
    const indices = papers.reduce((acc, p, i) => {
      if (venueFilter !== 'All' && p.conf !== venueFilter) return acc;
      acc.push(i);
      return acc;
    }, []);
    if (sortByScore) {
      indices.sort((a, b) => {
        const sa = aiScores[a]?.score ?? -1;
        const sb = aiScores[b]?.score ?? -1;
        return sb - sa; // highest score first
      });
    }
    return indices;
  }, [papers, venueFilter, sortByScore, aiScores]);

  const safeIndex = Math.min(currentIndex, Math.max(0, filteredIndices.length - 1));
  const globalIndex = filteredIndices[safeIndex];
  const paper = papers[globalIndex];

  // Save index (only after papers loaded to avoid overwriting with 0)
  useEffect(() => {
    if (papers.length > 0) {
      console.log('[SLR] Saving index:', currentIndex, 'venue:', venueFilter);
      localStorage.setItem(INDEX_KEY, String(currentIndex));
    }
  }, [currentIndex, papers.length, venueFilter]);

  const getAbstract = useCallback((gIdx) => {
    if (abstractEdits[gIdx]) return abstractEdits[gIdx];
    return papers[gIdx]?.abstract || '';
  }, [papers, abstractEdits]);

  // Store undo stack in a ref so callbacks always see the latest value
  const undoStackRef = useRef(undoStack);
  undoStackRef.current = undoStack;

  const makeDecision = useCallback((d) => {
    if (globalIndex === undefined) return;
    const prevDecision = decisions[globalIndex] || null;

    // Push to undo stack (with index we came from, so undo can navigate back)
    setUndoStack((stack) => [...stack.slice(-50), {
      globalIndex,
      previousDecision: prevDecision,
      fromIndex: currentIndex,
    }]);
    setDecisions((prev) => ({ ...prev, [globalIndex]: d }));

    // Only auto-advance if this is a NEW decision (no previous decision)
    if (!prevDecision) {
      setCurrentIndex((prev) => {
        const maxIdx = filteredIndices.length - 1;
        return prev < maxIdx ? prev + 1 : prev;
      });
    }
  }, [globalIndex, decisions, filteredIndices.length, currentIndex]);

  const undoDecision = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];

    setUndoStack(stack.slice(0, -1));
    setDecisions((prev) => {
      const next = { ...prev };
      if (last.previousDecision) {
        next[last.globalIndex] = last.previousDecision;
      } else {
        delete next[last.globalIndex];
      }
      return next;
    });

    // Navigate back to the paper where the decision was made
    if (last.fromIndex !== undefined) {
      setCurrentIndex(last.fromIndex);
    }
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
        case 'h': setHighlightsOn(v => !v); break;
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
    const header = 'conf,title,author,decision,ai_score,ai_suggestion,ai_reason,abstract,doi,pdf_url,arxiv_id';
    const rows = papers.map((p, i) => {
      const abs = getAbstract(i);
      const score = aiScores[i];
      return [
        escapeCSV(p.conf), escapeCSV(p.title), escapeCSV(p.author),
        escapeCSV(decisions[i] || ''),
        escapeCSV(score?.score ?? ''), escapeCSV(score?.suggestion ?? ''), escapeCSV(score?.reason ?? ''),
        escapeCSV(abs),
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
  }, [papers, decisions, getAbstract, aiScores]);

  const clearAllDecisions = useCallback(() => {
    setDecisions({});
    setUndoStack([]);
    setCurrentIndex(0);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(INDEX_KEY);
  }, []);

  // AI scoring — batch process unscored papers
  const startScoring = useCallback(async () => {
    if (!apiKey) { setShowApiKeyModal(true); return; }

    // Check proxy is running
    try {
      const health = await fetch('http://localhost:3001/api/health');
      if (!health.ok) throw new Error();
    } catch {
      alert('Proxy server is not running.\n\nStart it in a separate terminal:\n  node server.js');
      return;
    }

    // Find unscored papers that have abstracts
    const unscored = [];
    for (let i = 0; i < papers.length; i++) {
      if (aiScores[i]) continue;
      const abs = getAbstract(i);
      if (!abs || abs === 'not_found') continue;
      unscored.push(i);
    }
    if (unscored.length === 0) { alert('All papers with abstracts have been scored.'); return; }

    scoringAbortRef.current = false;
    const total = unscored.length;
    let done = 0;
    let errors = 0;
    setScoringProgress({ done: 0, total, errors: 0 });

    // Process in batches of 5
    for (let b = 0; b < unscored.length; b += 5) {
      if (scoringAbortRef.current) break;
      const batch = unscored.slice(b, b + 5);
      const results = await Promise.allSettled(
        batch.map(async (idx) => {
          const abs = cleanAbstractText(getAbstract(idx));
          const result = await scoreOneAbstract(apiKey, papers[idx].title, abs);
          return { idx, result };
        })
      );
      const newScores = {};
      for (const r of results) {
        if (r.status === 'fulfilled') {
          newScores[r.value.idx] = r.value.result;
        } else {
          errors++;
          console.error('[SLR] Scoring error:', r.reason);
        }
      }
      done += batch.length;
      setAiScores(prev => ({ ...prev, ...newScores }));
      setScoringProgress({ done, total, errors });
    }
    // Clear progress after a short delay so user sees 100%
    setTimeout(() => setScoringProgress(null), 2000);
  }, [apiKey, papers, aiScores, getAbstract]);

  const stopScoring = useCallback(() => {
    scoringAbortRef.current = true;
  }, []);

  const pendingScoreRef = useRef(false);
  const saveApiKey = useCallback((key) => {
    setApiKey(key);
    localStorage.setItem(APIKEY_KEY, key);
    setShowApiKeyModal(false);
    pendingScoreRef.current = true;
  }, []);

  // Auto-start scoring after API key is saved
  useEffect(() => {
    if (pendingScoreRef.current && apiKey) {
      pendingScoreRef.current = false;
      startScoring();
    }
  }, [apiKey, startScoring]);

  const clearScores = useCallback(() => {
    if (window.confirm('Clear all AI scores? This cannot be undone.')) {
      setAiScores({});
      localStorage.removeItem(SCORES_KEY);
    }
  }, []);

  // Sorted scored papers list for AI Insights sidebar
  const scoredPapersList = useMemo(() => {
    return Object.entries(aiScores)
      .map(([idx, score]) => ({ idx: Number(idx), ...score, paper: papers[Number(idx)] }))
      .filter(item => item.paper)
      .sort((a, b) => b.score - a.score);
  }, [aiScores, papers]);

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
        <h1><span className="logo-bold">SLR</span> <span className="logo-light">Screener</span></h1>
        <div className="header-actions">
          <span style={{ fontSize: 13, color: '#636e72' }}>
            {decidedCount}/{totalPapers} screened
          </span>
          <button className="header-btn btn-reload" onClick={loadData}>Reload Data</button>
          <button className="header-btn btn-score" onClick={scoringProgress ? stopScoring : startScoring}>
            {scoringProgress
              ? `Scoring ${scoringProgress.done}/${scoringProgress.total}${scoringProgress.errors > 0 ? ` (${scoringProgress.errors} err)` : ''}`
              : `Score Papers${Object.keys(aiScores).length > 0 ? ` (${Object.keys(aiScores).length})` : ''}`}
          </button>
          <button className="header-btn btn-export" onClick={exportCSV}>Export CSV</button>
          <button className="header-btn btn-log" onClick={() => { setSidebarOpen((v) => !v); setAiInsightsOpen(false); }}>
            Decision Log
          </button>
          {Object.keys(aiScores).length > 0 && (
            <button className="header-btn btn-insights" onClick={() => { setAiInsightsOpen((v) => !v); setSidebarOpen(false); }}>
              AI Insights
            </button>
          )}
        </div>
      </div>

      {/* Scoring progress bar */}
      {scoringProgress && (
        <div className="scoring-progress-track">
          <div className="scoring-progress-fill" style={{ width: `${(scoringProgress.done / scoringProgress.total) * 100}%` }} />
        </div>
      )}

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

      {/* Venue Filter + Highlights Toggle */}
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
        <button
          className={`highlight-toggle ${highlightsOn ? 'on' : ''}`}
          onClick={() => setHighlightsOn(v => !v)}
          title="Toggle keyword highlights (H)"
        >
          Highlights {highlightsOn ? 'On' : 'Off'}
        </button>
        {Object.keys(aiScores).length > 0 && (
          <button
            className={`highlight-toggle ${sortByScore ? 'on' : ''}`}
            onClick={() => { setSortByScore(v => !v); setCurrentIndex(0); }}
            title="Sort papers by AI relevance score"
          >
            Sort by Score {sortByScore ? 'On' : 'Off'}
          </button>
        )}
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
              {aiScores[globalIndex] && (
                <span className={`ai-score-badge score-${aiScores[globalIndex].score >= 70 ? 'high' : aiScores[globalIndex].score >= 40 ? 'mid' : 'low'}`}
                  title={`AI suggestion: ${aiScores[globalIndex].suggestion}`}>
                  AI: {aiScores[globalIndex].score}
                </span>
              )}
            </div>
            <div className="paper-title">{paper.title}</div>
            <div className="paper-authors">{paper.author}</div>

            {/* Links */}
            <div className="paper-links">
              {paper.pdf_url && (
                <a className="link-btn link-pdf" href={paper.pdf_url} target="_blank" rel="noreferrer">PDF</a>
              )}
              {paper.doi && (
                <a className="link-btn link-publisher" href={`https://doi.org/${paper.doi}`} target="_blank" rel="noreferrer">Publisher</a>
              )}
              <a className="link-btn link-scholar" href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`} target="_blank" rel="noreferrer">Google Scholar</a>
              {paper.arxiv_id && (
                <a className="link-btn link-arxiv" href={`https://arxiv.org/abs/${paper.arxiv_id}`} target="_blank" rel="noreferrer">arXiv</a>
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
                <div className="abstract-text">{highlightsOn ? highlightAbstract(abstract) : cleanAbstractText(abstract)}</div>
              )}
            </div>
          </div>

          {/* Decision buttons */}
          <div className="decision-section">
            {(() => { const sug = aiScores[globalIndex]?.suggestion?.toLowerCase(); return <>
            <button
              className={`decision-btn btn-yes ${decisions[globalIndex] === 'Yes' ? 'selected' : ''} ${sug === 'yes' ? 'ai-suggested' : ''}`}
              onClick={() => makeDecision('Yes')}
            >
              Yes <span className="shortcut">Y</span>
            </button>
            <button
              className={`decision-btn btn-maybe ${decisions[globalIndex] === 'Maybe' ? 'selected' : ''} ${sug === 'maybe' ? 'ai-suggested' : ''}`}
              onClick={() => makeDecision('Maybe')}
            >
              Maybe <span className="shortcut">M</span>
            </button>
            <button
              className={`decision-btn btn-no ${decisions[globalIndex] === 'No' ? 'selected' : ''} ${sug === 'no' ? 'ai-suggested' : ''}`}
              onClick={() => makeDecision('No')}
            >
              No <span className="shortcut">N</span>
            </button>
            </>; })()}
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
        {(decidedCount > 0 || Object.keys(aiScores).length > 0) && (
          <div className="sidebar-footer">
            {decidedCount > 0 && (
              <button className="reset-btn full-width" onClick={() => { if (window.confirm(`Clear all ${decidedCount} decisions? This cannot be undone.`)) clearAllDecisions(); }}>
                Reset All Decisions
              </button>
            )}
            {Object.keys(aiScores).length > 0 && (
              <button className="reset-btn full-width" style={{ marginTop: decidedCount > 0 ? 8 : 0 }} onClick={clearScores}>
                Clear AI Scores ({Object.keys(aiScores).length})
              </button>
            )}
            {apiKey && (
              <button className="reset-btn full-width" style={{ marginTop: 8, borderColor: '#b2bec3', color: '#636e72' }}
                onClick={() => setShowApiKeyModal(true)}>
                Change API Key
              </button>
            )}
          </div>
        )}
      </div>
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

      {/* AI Insights Sidebar */}
      <div className={`sidebar ai-sidebar ${aiInsightsOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>AI Insights</h2>
          <button className="sidebar-close" onClick={() => setAiInsightsOpen(false)}>&times;</button>
        </div>
        {/* Current paper insight */}
        {aiScores[globalIndex] ? (
          <div className="ai-insight-current">
            <div className="ai-insight-label">Current Paper</div>
            <div className="ai-insight-score-row">
              <span className={`ai-score-badge score-${aiScores[globalIndex].score >= 70 ? 'high' : aiScores[globalIndex].score >= 40 ? 'mid' : 'low'}`}>
                Score: {aiScores[globalIndex].score}
              </span>
              <span className={`sidebar-decision ${aiScores[globalIndex].suggestion}`}>
                {aiScores[globalIndex].suggestion.charAt(0).toUpperCase() + aiScores[globalIndex].suggestion.slice(1)}
              </span>
            </div>
            <div className="ai-insight-reason">{aiScores[globalIndex].reason}</div>
          </div>
        ) : (
          <div className="ai-insight-current">
            <div className="ai-insight-label">Current Paper</div>
            <div className="ai-insight-empty">Not scored yet</div>
          </div>
        )}
        {/* Scored papers list */}
        <div className="ai-insight-list-label">All Scored Papers ({scoredPapersList.length})</div>
        <div className="sidebar-list">
          {scoredPapersList.map((item) => (
            <div
              key={item.idx}
              className={`sidebar-item ${item.idx === globalIndex ? 'active' : ''}`}
              onClick={() => { jumpToPaper(item.idx); }}
            >
              <div className="sidebar-item-top">
                <span className={`ai-score-badge score-${item.score >= 70 ? 'high' : item.score >= 40 ? 'mid' : 'low'}`}>
                  {item.score}
                </span>
                <span className={`sidebar-decision ${item.suggestion}`}>
                  {item.suggestion.charAt(0).toUpperCase() + item.suggestion.slice(1)}
                </span>
              </div>
              <div className="sidebar-item-title">
                {item.paper.title.length > 80 ? item.paper.title.slice(0, 80) + '...' : item.paper.title}
              </div>
            </div>
          ))}
        </div>
      </div>
      {aiInsightsOpen && <div className="sidebar-overlay" onClick={() => setAiInsightsOpen(false)} />}

      {/* API Key Modal */}
      {showApiKeyModal && (
        <>
          <div className="sidebar-overlay" onClick={() => setShowApiKeyModal(false)} />
          <div className="api-key-modal">
            <h3>Anthropic API Key</h3>
            <p>Enter your API key to enable AI scoring. The key is stored only in your browser's localStorage.</p>
            <input
              type="password"
              className="api-key-input"
              placeholder="sk-ant-..."
              defaultValue={apiKey}
              onKeyDown={(e) => { if (e.key === 'Enter') saveApiKey(e.target.value.trim()); }}
              autoFocus
            />
            <div className="edit-actions">
              <button className="save-btn" onClick={(e) => {
                const input = e.target.closest('.api-key-modal').querySelector('input');
                saveApiKey(input.value.trim());
              }}>Save & Start Scoring</button>
              <button className="cancel-btn" onClick={() => setShowApiKeyModal(false)}>Cancel</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default App;
