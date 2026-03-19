import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from './contexts/AuthContext';
import LoginPage from './LoginPage';
import {
  saveProject as fsSaveProject,
  getProject as fsGetProject,
  deleteProject as fsDeleteProject,
  saveDecision as fsSaveDecision,
  deleteDecision as fsDeleteDecision,
  getDecisions as fsGetDecisions,
  saveAllAIScores as fsSaveAllAIScores,
  getAIScores as fsGetAIScores,
  syncDecisionsToFirestore,
  syncAIScoresToFirestore,
  syncProjectToFirestore,
  saveProjectMeta as fsSaveProjectMeta,
  getProjectMeta as fsGetProjectMeta,
  addCollaborator as fsAddCollaborator,
  removeCollaborator as fsRemoveCollaborator,
  updateCollaboratorRole as fsUpdateCollaboratorRole,
  getCollaborators as fsGetCollaborators,
  acceptInvite as fsAcceptInvite,
  getSharedProjects as fsGetSharedProjects,
  saveFinalDecision as fsSaveFinalDecision,
  getFinalDecisions as fsGetFinalDecisions,
} from './services/firestore';
import { analyzeConflicts, interpretKappa } from './utils/kappa';
import './App.css';

// ===== HIGHLIGHT SYSTEM =====
// Categories are customizable via Highlight Settings panel, stored in localStorage.
// Each category: { name, color, cls, keywords: string[] }

const DEFAULT_CATEGORIES = [
  {
    name: 'Model info', color: '#dbeafe', textColor: '#1d4ed8', cls: 'hl-cat-0',
    keywords: 'LLM, LLMs, GPT, GPT-4, GPT-4o, GPT-3.5, GPT-3, CodeLlama, Code Llama, CodeBERT, GraphCodeBERT, StarCoder, StarCoder2, DeepSeek, DeepSeek-Coder, Codex, Copilot, GitHub Copilot, T5, CodeT5, CodeT5+, BERT, RoBERTa, Llama, Llama 2, Llama 3, Qwen, Gemini, Claude, ChatGPT, transformer, transformers, large language model, large language models, parameter, parameters, billion, million, 7B, 13B, 34B, 70B, model size, fine-tuning, fine-tune, fine-tuned, pre-trained, pre-training, quantization, quantized, LoRA, QLoRA, PEFT, adapter, adapters',
  },
  {
    name: 'SE tasks', color: '#dcfce7', textColor: '#15803d', cls: 'hl-cat-1',
    keywords: 'code generation, code summarization, vulnerability detection, bug detection, code review, code completion, code search, code translation, defect prediction, program repair, test generation, automated program repair, code clone detection, code smell, software vulnerability',
  },
  {
    name: 'Methods', color: '#f3e8ff', textColor: '#7e22ce', cls: 'hl-cat-2',
    keywords: 'training, inference, evaluation, benchmark, benchmarks, dataset, datasets, deep learning, neural network, neural networks, machine learning',
  },
];

const DEFAULT_RESEARCH_GOAL = 'Identify papers that use, evaluate, or experiment with AI/ML models for software engineering tasks, especially papers that mention specific model names, model sizes, parameter counts, fine-tuning, or quantization.';

const HL_CATEGORIES_KEY = 'slr-screener-hl-categories';
const RESEARCH_GOAL_KEY = 'slr-screener-research-goal';

const PRESET_COLORS = [
  { bg: '#dbeafe', text: '#1d4ed8' },
  { bg: '#dcfce7', text: '#15803d' },
  { bg: '#f3e8ff', text: '#7e22ce' },
  { bg: '#fef3c7', text: '#b45309' },
  { bg: '#fce7f3', text: '#be185d' },
];

function buildHighlightData(categories) {
  const keywords = [];
  for (const cat of categories) {
    const words = cat.keywords.split(',').map(w => w.trim()).filter(Boolean);
    for (const word of words) {
      keywords.push({ word, cls: cat.cls, label: cat.name });
    }
  }
  keywords.sort((a, b) => b.word.length - a.word.length);
  if (keywords.length === 0) return { regex: null, lookup: {} };
  const escaped = keywords.map(e => e.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(\\b(?:${escaped.join('|')})\\b)`, 'gi');
  const lookup = {};
  for (const e of keywords) {
    lookup[e.word.toLowerCase()] = { cls: e.cls, label: e.label };
  }
  return { regex, lookup };
}

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

function highlightAbstract(text, hlData) {
  const clean = cleanAbstractText(text);
  if (!hlData.regex) return [clean];
  // First pass: split by keyword matches
  const parts = clean.split(hlData.regex);
  const result = [];
  parts.forEach((part, i) => {
    const entry = hlData.lookup[part.toLowerCase()];
    if (entry) {
      result.push(<span key={`k${i}`} className={`${entry.cls} hl-tip`} data-tip={`${entry.label}: ${part}`}>{part}</span>);
    } else if (part) {
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
function buildScoringPrompt(goal) {
  return `You are helping screen papers for a systematic literature review. The research goal is: ${goal} Rate this abstract 0-100 for relevance and suggest Yes/No/Maybe. Respond in JSON only: {"score": number, "suggestion": "yes"|"no"|"maybe", "reason": "one sentence why"}`;
}

const PROXY_URL = 'http://localhost:3001/api/score';

const AI_MODELS = [
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', desc: 'Fast & cheap, good for bulk scoring' },
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6', desc: 'Balanced quality & speed (recommended)' },
  { id: 'claude-opus-4-6', name: 'Opus 4.6', desc: 'Highest accuracy, slower & costlier' },
];
const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MODEL_KEY = 'slr-screener-model';

function modelName(modelId) {
  return AI_MODELS.find(m => m.id === modelId)?.name || modelId;
}

async function scoreOneAbstract(apiKey, title, abstract, model, goal) {
  const prompt = buildScoringPrompt(goal);
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: 150,
      messages: [
        { role: 'user', content: `${prompt}\n\nTitle: ${title}\nAbstract: ${abstract}` },
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
  return { score: parsed.score, suggestion: parsed.suggestion.toLowerCase(), reason: parsed.reason, model };
}

// ===== SETUP / IMPORT HELPERS =====
const COLUMN_HINTS = {
  title: ['title', 'paper title', 'paper_title', 'name', 'paper name'],
  author: ['author', 'authors', 'writer', 'writers', 'author(s)'],
  abstract: ['abstract', 'summary', 'description'],
  conf: ['conf', 'conference', 'venue', 'source', 'journal', 'proceeding', 'proceedings'],
  doi: ['doi', 'DOI'],
  doi_url: ['doi_url', 'doi url', 'doi link'],
  arxiv_id: ['arxiv_id', 'arxiv', 'arxiv id'],
  pdf_url: ['pdf_url', 'pdf', 'pdf link', 'pdf url'],
  year: ['year', 'pub_year', 'publication year'],
};

function autoDetectColumns(headers) {
  const mapping = {};
  for (const [field, hints] of Object.entries(COLUMN_HINTS)) {
    for (const header of headers) {
      const h = header.toLowerCase().trim();
      if (hints.includes(h)) { mapping[header] = field; break; }
    }
  }
  return mapping;
}

function normalizePaper(raw) {
  const val = (v) => v || 'not_found';
  const doi = raw.doi || '';
  return {
    conf: val(raw.conf || raw.venue || raw.conference),
    title: val(raw.title),
    author: val(raw.author || raw.authors),
    abstract: val(raw.abstract || raw.summary),
    doi: val(doi),
    doi_url: doi ? `https://doi.org/${doi}` : val(raw.doi_url),
    openalex_id: val(raw.openalex_id),
    arxiv_id: val(raw.arxiv_id),
    pdf_url: val(raw.pdf_url),
    pdf_source: val(raw.pdf_source),
  };
}

function projectSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'project';
}

const S2_PROXY = 'http://localhost:3001/api/semantic-scholar';

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

// ===== SETUP VIEW COMPONENT =====
function SetupView({ onImport, onLoadDemo, apiKey, setApiKey, appendMode, onAppend }) {
  const handleImport = useCallback((papers, customName) => {
    if (appendMode && onAppend) {
      onAppend(papers);
    } else {
      onImport(papers, customName);
    }
  }, [appendMode, onAppend, onImport]);

  const [activeMethod, setActiveMethod] = useState(null); // 'csv' | 'json' | 'titles' | 'pdf'

  // CSV/Excel state
  const [csvRows, setCsvRows] = useState(null);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvMapping, setCsvMapping] = useState({});
  const [csvFileName, setCsvFileName] = useState('');
  const [csvProjectName, setCsvProjectName] = useState('');

  // JSON state
  const [jsonPapers, setJsonPapers] = useState(null);
  const [jsonFileName, setJsonFileName] = useState('');
  const [jsonNoVenue, setJsonNoVenue] = useState(false);
  const [jsonDefaultVenue, setJsonDefaultVenue] = useState('');

  // Manual entry state
  const emptyEntry = () => ({ title: '', venue: '', doi: '', arxiv_id: '', abstract: '', author: '', fetched: false });
  const [manualEntries, setManualEntries] = useState([emptyEntry()]);
  const [manualProjectName, setManualProjectName] = useState('');
  const [manualFetching, setManualFetching] = useState(false);
  const [manualProgress, setManualProgress] = useState({ done: 0, total: 0 });

  // PDF state
  const [pdfFiles, setPdfFiles] = useState([]);
  const [pdfResults, setPdfResults] = useState([]);
  const [pdfProcessing, setPdfProcessing] = useState(false);
  const [pdfProjectName, setPdfProjectName] = useState('');
  const [pdfDefaultVenue, setPdfDefaultVenue] = useState('');

  const SCHEMA_FIELDS = ['title', 'author', 'abstract', 'conf', 'doi', 'doi_url', 'arxiv_id', 'pdf_url', 'year', '(skip)'];

  // === CSV/Excel handler ===
  const handleCsvFile = useCallback((file) => {
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (rows.length === 0) { alert('No data found in file.'); return; }
      const headers = Object.keys(rows[0]);
      setCsvHeaders(headers);
      setCsvRows(rows);
      setCsvMapping(autoDetectColumns(headers));
    };
    reader.readAsArrayBuffer(file);
  }, []);

  const importCsv = useCallback(() => {
    if (!csvRows) return;
    const reverseMap = {};
    for (const [header, field] of Object.entries(csvMapping)) {
      if (field && field !== '(skip)') reverseMap[field] = header;
    }
    if (!reverseMap.title) { alert('Please map at least the "title" column.'); return; }
    const papers = csvRows.map((row) => {
      const raw = {};
      for (const [field, header] of Object.entries(reverseMap)) {
        raw[field] = row[header] || '';
      }
      return normalizePaper(raw);
    }).filter(p => p.title);
    handleImport(papers, csvProjectName || undefined);
  }, [csvRows, csvMapping, csvProjectName, handleImport]);

  // === JSON handler ===
  const handleJsonFile = useCallback((file) => {
    setJsonFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        let papers;
        if (Array.isArray(parsed)) {
          papers = parsed;
        } else if (parsed.papers && Array.isArray(parsed.papers)) {
          papers = parsed.papers;
        } else {
          alert('JSON must be an array of papers or an object with a "papers" array.'); return;
        }
        const normalized = papers.map(normalizePaper).filter(p => p.title && p.title !== 'not_found');
        // Check if any paper has a real venue
        const hasVenue = normalized.some(p => p.conf && p.conf !== 'not_found');
        setJsonNoVenue(!hasVenue);
        setJsonDefaultVenue('');
        setJsonPapers(normalized);
      } catch (err) {
        alert('Invalid JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
  }, []);

  // === Paste titles handler ===
  // Update a single entry field
  const updateEntry = useCallback((idx, field, value) => {
    setManualEntries(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }, []);

  // Fetch missing info from Semantic Scholar
  const fetchMissingInfo = useCallback(async () => {
    const toFetch = manualEntries.filter(e => e.title.trim() && !e.fetched);
    if (toFetch.length === 0) { alert('All entries are already fetched or have no title.'); return; }
    setManualFetching(true);
    setManualProgress({ done: 0, total: toFetch.length });
    let fetchIdx = 0;
    const updated = [...manualEntries];
    for (let i = 0; i < updated.length; i++) {
      if (!updated[i].title.trim() || updated[i].fetched) continue;
      try {
        const res = await fetch(S2_PROXY + '/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: updated[i].title }),
        });
        const data = await res.json();
        if (data.found) {
          updated[i] = {
            ...updated[i],
            author: updated[i].author || data.author || '',
            abstract: updated[i].abstract || data.abstract || '',
            doi: updated[i].doi || data.doi || '',
            arxiv_id: updated[i].arxiv_id || data.arxiv_id || '',
            venue: updated[i].venue || (data.venue ? `${data.venue} ${data.year || ''}`.trim() : ''),
            fetched: true,
          };
        } else {
          updated[i] = { ...updated[i], fetched: true };
        }
      } catch {
        updated[i] = { ...updated[i], fetched: true };
      }
      fetchIdx++;
      setManualProgress({ done: fetchIdx, total: toFetch.length });
      if (fetchIdx < toFetch.length) await new Promise(r => setTimeout(r, 1000));
    }
    setManualEntries(updated);
    setManualFetching(false);
  }, [manualEntries]);

  // === PDF handler ===
  const handlePdfFiles = useCallback(async (files, currentApiKey) => {
    setPdfProcessing(true);
    // Initialize results with 'pending' status
    const initial = files.map(f => ({
      name: f.name, text: '', title: '', author: '', abstract: '',
      status: 'processing', error: null, extracted: false,
    }));
    setPdfResults(initial);

    for (let fi = 0; fi < files.length; fi++) {
      const file = files[fi];
      try {
        // Step 1: Extract text from first 2 pages
        const arrayBuffer = await file.arrayBuffer();
        const pdfjsLib = await import('pdfjs-dist/build/pdf');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '';
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
        let fullText = '';
        for (let p = 1; p <= Math.min(pdf.numPages, 2); p++) {
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          fullText += content.items.map(i => i.str).join(' ') + '\n';
        }
        const rawText = fullText.trim();

        // Step 2: If API key available, extract with AI
        if (currentApiKey) {
          try {
            const res = await fetch('http://localhost:3001/api/score', {
              method: 'POST',
              headers: { 'content-type': 'application/json', 'x-api-key': currentApiKey },
              body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 800,
                messages: [{
                  role: 'user',
                  content: `Extract the paper metadata from the text below. Return ONLY a JSON object with these fields:\n{"title": "full paper title", "authors": "comma-separated author names", "abstract": "full abstract text"}\n\nRules:\n- Extract the exact title as it appears in the paper\n- List all authors separated by commas\n- Extract the complete abstract\n- If you cannot find a field, use an empty string\n\nText from first 2 pages:\n${rawText.slice(0, 4000)}`
                }],
              }),
            });
            const data = await res.json();
            const aiText = data.content?.[0]?.text || '';
            const jsonStr = aiText.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
            const parsed = JSON.parse(jsonStr);
            setPdfResults(prev => {
              const updated = [...prev];
              updated[fi] = { ...updated[fi], text: rawText, title: parsed.title || '', author: parsed.authors || '', abstract: parsed.abstract || '', status: 'done', extracted: true };
              return updated;
            });
          } catch (aiErr) {
            // AI failed, fall back to raw text
            setPdfResults(prev => {
              const updated = [...prev];
              updated[fi] = { ...updated[fi], text: rawText, title: file.name.replace(/\.pdf$/i, ''), author: '', abstract: '', status: 'done', extracted: false };
              return updated;
            });
          }
        } else {
          // No API key — just use filename as title
          setPdfResults(prev => {
            const updated = [...prev];
            updated[fi] = { ...updated[fi], text: rawText, title: file.name.replace(/\.pdf$/i, ''), author: '', abstract: '', status: 'done', extracted: false };
            return updated;
          });
        }
      } catch (err) {
        setPdfResults(prev => {
          const updated = [...prev];
          updated[fi] = { ...updated[fi], status: 'failed', error: err.message };
          return updated;
        });
      }
    }
    setPdfProcessing(false);
  }, []);

  const updatePdfResult = useCallback((idx, field, value) => {
    setPdfResults(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: value };
      return updated;
    });
  }, []);

  const importPdfs = useCallback(() => {
    const papers = pdfResults
      .filter(r => r.status === 'done' && r.title.trim())
      .map(r => normalizePaper({
        title: r.title, author: r.author || '', abstract: r.abstract || '',
        conf: pdfDefaultVenue || '',
      }));
    if (papers.length === 0) { alert('No papers to import.'); return; }
    handleImport(papers, pdfProjectName || undefined);
  }, [pdfResults, pdfDefaultVenue, pdfProjectName, handleImport]);

  // Drag-and-drop
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    if (activeMethod === 'pdf') {
      const pdfs = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
      if (pdfs.length > 0) { setPdfFiles(pdfs); handlePdfFiles(pdfs, apiKey); }
    }
  }, [activeMethod, handlePdfFiles, apiKey]);

  const methods = [
    { id: 'csv', icon: '📊', title: 'Upload CSV / Excel', desc: 'Import a spreadsheet with paper titles, authors, abstracts, venues, DOIs, and more. We\'ll auto-detect your columns.', primary: true },
    { id: 'json', icon: '{ }', title: 'Upload JSON', desc: 'Already have structured data? Drop your JSON file here.' },
    { id: 'titles', icon: '📝', title: 'Add Papers Manually', desc: 'Enter papers one by one with titles, venues, and DOIs. We\'ll auto-fetch missing info from Semantic Scholar.' },
    { id: 'pdf', icon: '📄', title: 'Upload PDFs', desc: 'Upload one or multiple PDF files. We\'ll extract title, authors, and abstract from the first 2 pages of each paper using AI.' },
  ];

  return (
    <div className="setup-view">
      {appendMode && (
        <div className="append-banner">
          Adding papers to: <strong>{appendMode}</strong>
        </div>
      )}
      <div className="setup-header">
        <h1><span className="logo-bold">SLR</span> <span className="logo-light">Screener</span></h1>
        <p className="setup-subtitle">{appendMode ? 'Choose how to add more papers' : 'Import your papers to begin screening'}</p>
      </div>

      {!activeMethod ? (
        <>
          <div className="setup-grid">
            {methods.map(m => (
              <button key={m.id} className={`setup-card ${m.primary ? 'primary' : ''}`} onClick={() => setActiveMethod(m.id)}>
                <span className="setup-card-icon">{m.icon}</span>
                <span className="setup-card-title">{m.title}</span>
                <span className="setup-card-desc">{m.desc}</span>
              </button>
            ))}
          </div>
          {appendMode ? (
            <div className="setup-footer">
              <button className="setup-demo-link" onClick={() => onAppend(null)}>Cancel and return to screening</button>
            </div>
          ) : (
            <div className="setup-footer">
              <button className="setup-demo-link" onClick={onLoadDemo}>
                or use the built-in demo dataset (1,100 SE papers)
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="setup-workflow">
          <button className="setup-back" onClick={() => setActiveMethod(null)}>&larr; Back to options</button>

          {/* === CSV/Excel Workflow === */}
          {activeMethod === 'csv' && (
            <div className="setup-panel">
              <h2>Upload CSV / Excel</h2>
              {!csvRows ? (
                <>
                  <div className="upload-zone" onClick={() => document.getElementById('csv-input').click()}>
                    <input id="csv-input" type="file" accept=".csv,.xlsx,.xls,.tsv" style={{ display: 'none' }}
                      onChange={(e) => e.target.files[0] && handleCsvFile(e.target.files[0])} />
                    <span className="upload-zone-icon">📁</span>
                    <span className="upload-zone-text">Click to select or drag a CSV/Excel file</span>
                    <span className="upload-zone-hint">Supports .csv, .xlsx, .xls, .tsv</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="csv-project-name">
                    <label className="manual-label">Project Name</label>
                    <input className="manual-input" placeholder="e.g., My Literature Review"
                      value={csvProjectName} onChange={(e) => setCsvProjectName(e.target.value)} />
                  </div>

                  <div className="setup-file-info">
                    <strong>{csvFileName}</strong> — {csvRows.length} rows, {csvHeaders.length} columns detected
                  </div>

                  <h3>Map Your Columns</h3>
                  <p className="setup-hint">We auto-detected some columns. Use the dropdowns to map your spreadsheet columns to the fields below.</p>

                  <div className="csv-mapping-grid">
                    {[
                      { field: 'title', label: 'Title', required: true },
                      { field: 'author', label: 'Author' },
                      { field: 'abstract', label: 'Abstract' },
                      { field: 'conf', label: 'Venue / Conference' },
                      { field: 'doi', label: 'DOI' },
                      { field: 'arxiv_id', label: 'arXiv ID' },
                    ].map(({ field, label, required }) => {
                      // Find which header is currently mapped to this field
                      const mappedHeader = Object.entries(csvMapping).find(([, v]) => v === field)?.[0] || '';
                      return (
                        <div key={field} className={`csv-mapping-item ${required ? 'required' : ''}`}>
                          <label className="csv-mapping-label">
                            {label} {required && <span className="csv-required">*required</span>}
                          </label>
                          <select className="csv-mapping-select" value={mappedHeader}
                            onChange={(e) => {
                              setCsvMapping(prev => {
                                const next = { ...prev };
                                // Remove old mapping for this field
                                for (const [k, v] of Object.entries(next)) {
                                  if (v === field) delete next[k];
                                }
                                // Set new mapping
                                if (e.target.value) next[e.target.value] = field;
                                return next;
                              });
                            }}>
                            <option value="">-- not mapped --</option>
                            {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                          </select>
                          {mappedHeader && csvRows[0] && (
                            <span className="csv-mapping-preview">e.g. "{String(csvRows[0][mappedHeader] || '').slice(0, 60)}"</span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="csv-info-note">
                    Any field you provide (DOI, arXiv ID, venue) enables richer features during screening &mdash; PDF links, publisher links, arXiv links, and venue filtering. Only "title" is required to get started.
                  </div>

                  {/* Preview table */}
                  <h3>Preview</h3>
                  <div className="csv-preview-table">
                    <div className="csv-preview-scroll">
                      <table>
                        <thead>
                          <tr>
                            {['title', 'author', 'abstract', 'conf', 'doi', 'arxiv_id']
                              .filter(f => Object.values(csvMapping).includes(f))
                              .map(f => <th key={f}>{f === 'conf' ? 'Venue' : f.charAt(0).toUpperCase() + f.slice(1)}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {csvRows.slice(0, 5).map((row, ri) => {
                            const reverseMap = {};
                            for (const [header, field] of Object.entries(csvMapping)) {
                              if (field && field !== '(skip)') reverseMap[field] = header;
                            }
                            return (
                              <tr key={ri}>
                                {['title', 'author', 'abstract', 'conf', 'doi', 'arxiv_id']
                                  .filter(f => Object.values(csvMapping).includes(f))
                                  .map(f => (
                                    <td key={f}>{reverseMap[f] ? String(row[reverseMap[f]] || '').slice(0, 80) : ''}{reverseMap[f] && String(row[reverseMap[f]] || '').length > 80 ? '...' : ''}</td>
                                  ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    {csvRows.length > 5 && <div className="csv-preview-more">...and {csvRows.length - 5} more rows</div>}
                  </div>

                  <div className="setup-actions" style={{ marginTop: 16 }}>
                    <button className="save-btn" onClick={importCsv}
                      disabled={!Object.values(csvMapping).includes('title')}>
                      Start Screening ({csvRows.length} papers)
                    </button>
                    <button className="cancel-btn" onClick={() => { setCsvRows(null); setCsvHeaders([]); setCsvMapping({}); setCsvFileName(''); }}>Choose Different File</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* === JSON Workflow === */}
          {activeMethod === 'json' && (
            <div className="setup-panel">
              <h2>{'{ }'} Upload JSON</h2>
              {!jsonPapers ? (
                <>
                  <div className="upload-zone" onClick={() => document.getElementById('json-input').click()}>
                    <input id="json-input" type="file" accept=".json" style={{ display: 'none' }}
                      onChange={(e) => e.target.files[0] && handleJsonFile(e.target.files[0])} />
                    <span className="upload-zone-icon">📁</span>
                    <span className="upload-zone-text">Click to select a JSON file</span>
                    <span className="upload-zone-hint">Array of papers or {'{ "papers": [...] }'} format</span>
                  </div>
                  <div className="json-examples">
                    <h3>Example 1 (minimal):</h3>
                    <pre className="json-code">{`[
  {"title": "Paper Title Here", "author": "Author Name", "conf": "ICSE 2025"},
  {"title": "Another Paper", "author": "John Doe", "conf": "FSE 2025"}
]`}</pre>
                    <h3>Example 2 (full):</h3>
                    <pre className="json-code">{`{"papers": [
  {
    "title": "Paper Title",
    "author": "Author Name",
    "abstract": "Paper abstract text...",
    "conf": "ICSE 2025",
    "doi": "10.1145/xxxxx",
    "arxiv_id": "2404.11671"
  }
]}`}</pre>
                    <p className="setup-hint" style={{ marginTop: 12 }}>
                      Only <strong>"title"</strong> is required. Add <strong>"conf"</strong> (venue name like ICSE 2025, FSE 2025) to enable venue filtering.
                      Any missing fields will be handled automatically — papers without abstracts get a Google Scholar link and Edit button for manual entry during screening.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="setup-file-info">
                    <strong>{jsonFileName}</strong> — {jsonPapers.length} papers found
                  </div>
                  {jsonNoVenue && (
                    <div className="venue-prompt">
                      <p className="venue-prompt-text">No venue/conference field detected. Enter a default venue to apply to all papers (optional):</p>
                      <input
                        className="venue-prompt-input"
                        type="text"
                        value={jsonDefaultVenue}
                        onChange={(e) => setJsonDefaultVenue(e.target.value)}
                        placeholder="e.g., ICSE 2025, FSE 2025, ASE 2025"
                      />
                    </div>
                  )}
                  <h3>Preview</h3>
                  <div className="preview-table">
                    <div className="preview-header">
                      <span>Title</span><span>Authors</span><span>Venue</span><span>Abstract</span>
                    </div>
                    {jsonPapers.slice(0, 5).map((p, i) => {
                      const venue = (p.conf && p.conf !== 'not_found') ? p.conf : (jsonDefaultVenue || '—');
                      return (
                        <div key={i} className="preview-row">
                          <span>{p.title.slice(0, 40)}{p.title.length > 40 ? '...' : ''}</span>
                          <span>{(p.author && p.author !== 'not_found') ? p.author.slice(0, 25) : '—'}</span>
                          <span>{venue}</span>
                          <span>{(p.abstract && p.abstract !== 'not_found') ? p.abstract.slice(0, 30) + '...' : '—'}</span>
                        </div>
                      );
                    })}
                    {jsonPapers.length > 5 && <div className="preview-more">...and {jsonPapers.length - 5} more</div>}
                  </div>
                  <div className="setup-actions">
                    <button className="save-btn" onClick={() => {
                      let toImport = jsonPapers;
                      if (jsonNoVenue && jsonDefaultVenue.trim()) {
                        toImport = jsonPapers.map(p => ({
                          ...p,
                          conf: (p.conf && p.conf !== 'not_found') ? p.conf : jsonDefaultVenue.trim(),
                        }));
                      }
                      handleImport(toImport);
                    }}>Import {jsonPapers.length} Papers</button>
                    <button className="cancel-btn" onClick={() => { setJsonPapers(null); setJsonNoVenue(false); }}>Choose Different File</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* === Add Papers Manually === */}
          {activeMethod === 'titles' && (
            <div className="setup-panel">
              <h2>📝 Add Papers</h2>
              <p className="setup-hint">Enter your papers below. Fill in what you have — use "Fetch Missing Info" to auto-fill the rest from Semantic Scholar.</p>

              <div className="manual-project-name">
                <label className="manual-label">Project Name</label>
                <input
                  className="manual-input"
                  value={manualProjectName}
                  onChange={(e) => setManualProjectName(e.target.value)}
                  placeholder="e.g., LLM Code Generation Survey"
                />
              </div>

              <div className="manual-entries">
                {manualEntries.map((entry, i) => (
                  <div key={i} className={`manual-card ${entry.fetched ? 'fetched' : ''}`}>
                    <div className="manual-card-header">
                      <span className="manual-card-num">Paper {i + 1}</span>
                      {entry.fetched && <span className="manual-fetched-badge">✓ Fetched</span>}
                      {manualEntries.length > 1 && (
                        <button className="manual-remove" onClick={() => setManualEntries(prev => prev.filter((_, j) => j !== i))}>×</button>
                      )}
                    </div>
                    <input
                      className="manual-input manual-title"
                      value={entry.title}
                      onChange={(e) => updateEntry(i, 'title', e.target.value)}
                      placeholder="Paper title (required)"
                    />
                    <div className="manual-row">
                      <div className="manual-field">
                        <label className="manual-label-sm">Venue</label>
                        <input className="manual-input-sm" value={entry.venue}
                          onChange={(e) => updateEntry(i, 'venue', e.target.value)}
                          placeholder="e.g., ICSE 2025" />
                      </div>
                      <div className="manual-field">
                        <label className="manual-label-sm">DOI</label>
                        <input className="manual-input-sm" value={entry.doi}
                          onChange={(e) => updateEntry(i, 'doi', e.target.value)}
                          placeholder="10.1145/xxxxx" />
                      </div>
                      <div className="manual-field">
                        <label className="manual-label-sm">arXiv ID</label>
                        <input className="manual-input-sm" value={entry.arxiv_id}
                          onChange={(e) => updateEntry(i, 'arxiv_id', e.target.value)}
                          placeholder="2404.11671" />
                      </div>
                    </div>
                    {entry.author && (
                      <div className="manual-authors-display">
                        <span className="manual-label-sm">Authors:</span> {entry.author}
                      </div>
                    )}
                    <textarea
                      className="manual-abstract"
                      value={entry.abstract}
                      onChange={(e) => updateEntry(i, 'abstract', e.target.value)}
                      placeholder="Abstract (optional — if empty, Google Scholar link will be available during screening)"
                      rows={2}
                    />
                  </div>
                ))}
              </div>

              <button className="manual-add-btn" onClick={() => setManualEntries(prev => [...prev, emptyEntry()])}>
                + Add Another Paper
              </button>

              {manualFetching && (
                <div className="title-progress" style={{ marginTop: 16 }}>
                  <div className="title-progress-bar">
                    <div className="title-progress-fill" style={{ width: `${(manualProgress.done / manualProgress.total) * 100}%` }} />
                  </div>
                  <span className="title-progress-text">Fetching {manualProgress.done}/{manualProgress.total}...</span>
                </div>
              )}

              <div className="setup-actions" style={{ marginTop: 16 }}>
                <button className="save-btn manual-fetch-btn" onClick={fetchMissingInfo}
                  disabled={manualFetching || !manualEntries.some(e => e.title.trim() && !e.fetched)}>
                  {manualFetching ? `Fetching ${manualProgress.done}/${manualProgress.total}...` : 'Fetch Missing Info'}
                </button>
                <button className="save-btn" onClick={() => {
                  const valid = manualEntries.filter(e => e.title.trim());
                  if (valid.length === 0) { alert('Add at least one paper with a title.'); return; }
                  const papers = valid.map(e => normalizePaper({
                    title: e.title, author: e.author, abstract: e.abstract,
                    conf: e.venue, doi: e.doi, arxiv_id: e.arxiv_id,
                  }));
                  handleImport(papers, manualProjectName.trim() || undefined);
                }}>
                  Start Screening ({manualEntries.filter(e => e.title.trim()).length} papers)
                </button>
              </div>
              <p className="setup-hint" style={{ marginTop: 8, fontSize: 11 }}>
                "Fetch Missing Info" uses Semantic Scholar to find abstracts, authors, and DOIs. Requires the proxy server (node server.js). Rate limited to ~1 req/sec.
              </p>
            </div>
          )}

          {/* === PDF Workflow === */}
          {activeMethod === 'pdf' && (
            <div className="setup-panel">
              <h2>Upload PDFs</h2>
              <p className="setup-hint">Upload one or multiple PDF files. We'll extract title, authors, and abstract from the first 2 pages of each paper using AI.</p>

              {/* Drop zone — always visible until processing starts */}
              {pdfResults.length === 0 && (
                <div className="upload-zone" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}
                  onClick={() => document.getElementById('pdf-input').click()}>
                  <input id="pdf-input" type="file" accept=".pdf" multiple style={{ display: 'none' }}
                    onChange={(e) => { const files = Array.from(e.target.files); setPdfFiles(files); handlePdfFiles(files, apiKey); }} />
                  <span className="upload-zone-icon">📄</span>
                  <span className="upload-zone-text">{pdfProcessing ? 'Processing...' : 'Click or drag PDF files here'}</span>
                  <span className="upload-zone-hint">Multiple files supported</span>
                </div>
              )}

              {/* Config fields — below drop zone */}
              {pdfResults.length === 0 && (
                <div className="pdf-config">
                  <div className="pdf-config-row">
                    <div className="pdf-config-field">
                      <label className="manual-label">Project Name</label>
                      <input className="manual-input" placeholder="e.g., My Literature Review"
                        value={pdfProjectName} onChange={(e) => setPdfProjectName(e.target.value)} />
                    </div>
                    <div className="pdf-config-field">
                      <label className="manual-label">Default Venue <span style={{ fontWeight: 400, color: '#b2bec3' }}>(optional)</span></label>
                      <input className="manual-input" placeholder="e.g., ICSE 2025"
                        value={pdfDefaultVenue} onChange={(e) => setPdfDefaultVenue(e.target.value)} />
                      <span className="pdf-config-note">If left empty, all papers will appear under "All" with no venue filter.</span>
                    </div>
                  </div>
                  <div className="pdf-config-field" style={{ marginTop: 12 }}>
                    <label className="manual-label">Claude API Key</label>
                    {apiKey ? (
                      <div className="pdf-key-saved">Using saved key &#10003;</div>
                    ) : (
                      <>
                        <input className="manual-input" type="password" placeholder="sk-ant-..."
                          onKeyDown={(e) => { if (e.key === 'Enter' && e.target.value.trim()) setApiKey(e.target.value.trim()); }}
                          onBlur={(e) => { if (e.target.value.trim()) setApiKey(e.target.value.trim()); }} />
                        <span className="pdf-config-note">Without API key, only raw text extraction is available. With API key, we intelligently extract title, authors, and abstract.</span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Results — file list with editable fields */}
              {pdfResults.length > 0 && (
                <>
                  <div className="setup-file-info">
                    {pdfResults.filter(r => r.status === 'done').length} / {pdfResults.length} PDF(s) processed
                    {pdfProcessing && <span className="pdf-processing-badge">Processing...</span>}
                  </div>

                  <div className="pdf-results">
                    {pdfResults.map((r, i) => (
                      <div key={i} className={`pdf-result-card ${r.status}`}>
                        <div className="pdf-result-header">
                          <span className="pdf-result-filename">{r.name}</span>
                          <span className={`pdf-result-status ${r.status}`}>
                            {r.status === 'processing' && 'Processing...'}
                            {r.status === 'done' && (r.extracted ? 'AI Extracted' : 'Text Only')}
                            {r.status === 'failed' && 'Failed'}
                          </span>
                        </div>

                        {r.status === 'failed' && (
                          <div className="pdf-result-error">Error: {r.error}</div>
                        )}

                        {r.status === 'processing' && (
                          <div className="pdf-result-loading">
                            <div className="pdf-loading-bar"><div className="pdf-loading-fill" /></div>
                          </div>
                        )}

                        {r.status === 'done' && (
                          <div className="pdf-result-fields">
                            <div className="pdf-result-field">
                              <label className="manual-label-sm">Title</label>
                              <input className="manual-input" value={r.title}
                                onChange={(e) => updatePdfResult(i, 'title', e.target.value)} />
                            </div>
                            <div className="pdf-result-field">
                              <label className="manual-label-sm">Authors</label>
                              <input className="manual-input" value={r.author}
                                onChange={(e) => updatePdfResult(i, 'author', e.target.value)} />
                            </div>
                            <div className="pdf-result-field">
                              <label className="manual-label-sm">Abstract</label>
                              <textarea className="manual-abstract" value={r.abstract}
                                onChange={(e) => updatePdfResult(i, 'abstract', e.target.value)} rows={3} />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="setup-actions" style={{ marginTop: 16 }}>
                    <button className="save-btn" onClick={importPdfs}
                      disabled={pdfProcessing || pdfResults.filter(r => r.status === 'done' && r.title.trim()).length === 0}>
                      Start Screening ({pdfResults.filter(r => r.status === 'done' && r.title.trim()).length} papers)
                    </button>
                    <button className="cancel-btn" onClick={() => { setPdfResults([]); setPdfFiles([]); }}>Start Over</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function VerificationPage() {
  const { currentUser, resendVerification, reloadUser, logout, googleSignIn } = useAuth();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const countdownRef = useRef(null);
  const pollRef = useRef(null);

  // Start countdown on mount (initial email already sent at signup)
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(countdownRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(countdownRef.current);
  }, []);

  // Auto-poll every 5s to check if email has been verified
  useEffect(() => {
    pollRef.current = setInterval(async () => {
      try {
        await reloadUser();
      } catch { /* ignore polling errors */ }
    }, 5000);
    return () => clearInterval(pollRef.current);
  }, [reloadUser]);

  async function handleResend() {
    setMessage('');
    setError('');
    setSending(true);
    try {
      await resendVerification();
      setMessage('Verification email sent! Check your inbox.');
      setCountdown(60);
      clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) { clearInterval(countdownRef.current); return 0; }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      if (err.code === 'auth/too-many-requests') {
        setError('Too many requests. Please wait a few minutes before trying again.');
      } else {
        setError('Failed to send verification email. Please try again.');
      }
    }
    setSending(false);
  }

  async function handleGoogle() {
    setError('');
    setMessage('');
    try {
      await googleSignIn();
    } catch (err) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setError('Google sign-in failed. Please try again.');
      }
    }
  }

  const resendDisabled = sending || countdown > 0;

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <h1><span className="logo-bold">SLR</span> <span className="logo-light">Screener</span></h1>
          <p className="login-subtitle">Check Your Email</p>
        </div>

        <div className="verify-content">
          <div className="verify-icon">✉️</div>
          <p className="verify-text">
            We sent a verification link to <strong>{currentUser.email}</strong>
          </p>
          <p className="verify-hint">Click the link in your email to verify your account. This page will update automatically once verified.</p>

          <div className="verify-poll-status">Checking verification status...</div>

          {message && <div className="login-message">{message}</div>}
          {error && <div className="login-error">{error}</div>}

          <button className="verify-resend-btn" onClick={handleResend} disabled={resendDisabled}>
            {sending ? 'Sending...' : countdown > 0 ? `Resend available in ${countdown}s` : 'Resend Verification Email'}
          </button>

          <div className="verify-divider"><span>or</span></div>

          <button className="login-google-btn" onClick={handleGoogle} type="button">
            <svg viewBox="0 0 24 24" width="18" height="18" className="login-google-icon">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Use Google sign-in instead
          </button>

          <button className="verify-signout-btn" onClick={logout}>
            Sign out and use a different account
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const { currentUser, logout, loading: authLoading } = useAuth();

  // Auth gate: show login page if not logged in
  if (authLoading) {
    return <div className="app" style={{ textAlign: 'center', paddingTop: 100 }}>Loading...</div>;
  }
  if (!currentUser) {
    return <LoginPage />;
  }

  // Email/password users must verify their email before accessing the app.
  // Google sign-in users are always verified, so skip this check for them.
  if (!currentUser.emailVerified && currentUser.providerData?.[0]?.providerId === 'password') {
    return <VerificationPage />;
  }

  return <AppMain currentUser={currentUser} logout={logout} />;
}

function AppMain({ currentUser, logout }) {
  // App view: 'setup' or 'screener'
  // Always start in screener — first-time users get the demo auto-loaded
  const [appView, setAppView] = useState('screener');

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
  const [hlSettingsOpen, setHlSettingsOpen] = useState(false);
  const [hlCategories, setHlCategories] = useState(() => {
    try { const s = localStorage.getItem(HL_CATEGORIES_KEY); return s ? JSON.parse(s) : DEFAULT_CATEGORIES; }
    catch { return DEFAULT_CATEGORIES; }
  });
  const [researchGoal, setResearchGoal] = useState(() => {
    try { return localStorage.getItem(RESEARCH_GOAL_KEY) || DEFAULT_RESEARCH_GOAL; }
    catch { return DEFAULT_RESEARCH_GOAL; }
  });
  const [hlDraft, setHlDraft] = useState(null); // editing draft of categories
  const [goalDraft, setGoalDraft] = useState('');
  const [suggestingKeywords, setSuggestingKeywords] = useState(false);

  // Build highlight data from current categories
  const hlData = useMemo(() => buildHighlightData(hlCategories), [hlCategories]);

  // Generate dynamic CSS for custom category colors
  const hlStyleTag = useMemo(() => {
    const rules = hlCategories.map((cat, i) =>
      `.hl-cat-${i} { background: ${cat.color}; color: ${cat.textColor}; border-radius: 3px; padding: 0 2px; font-weight: 500; }`
    ).join('\n');
    return <style>{rules}</style>;
  }, [hlCategories]);

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
  const [scoringModel, setScoringModel] = useState(() => {
    try { return localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL; }
    catch { return DEFAULT_MODEL; }
  });
  const [scoringProgress, setScoringProgress] = useState(null); // { done, total, errors }
  const [scoringDone, setScoringDone] = useState(false);
  const [projectSidebarOpen, setProjectSidebarOpen] = useState(false);
  const [projectName, setProjectName] = useState(() => {
    try { return localStorage.getItem('slr-screener-project-name') || 'Model Sizes in SE Research 2025'; }
    catch { return 'Model Sizes in SE Research 2025'; }
  });
  const [isDemo, setIsDemo] = useState(() => {
    try { return localStorage.getItem('slr-screener-is-demo') === '1'; }
    catch { return false; }
  });
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [renamingProject, setRenamingProject] = useState(false);
  const [appendMode, setAppendMode] = useState(null); // null or project name string
  const [appendResult, setAppendResult] = useState(null); // { added, skipped, total }
  const [sortByScore, setSortByScore] = useState(false);
  const scoringAbortRef = useRef(false);

  // ── Project Sharing ───────────────────────────────────────────
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState('annotator');
  const [collaborators, setCollaborators] = useState([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [sharedProjects, setSharedProjects] = useState([]);
  const [projectRole, setProjectRole] = useState('owner'); // 'owner' | 'annotator' | 'viewer'
  const [projectOwnerId, setProjectOwnerId] = useState(null);

  // ── Conflict Resolution ───────────────────────────────────────
  const [conflictData, setConflictData] = useState(null); // { annotatorDecisions, annotators, finalDecisions, analysis }
  const [conflictTab, setConflictTab] = useState('conflicts');
  const [conflictSearch, setConflictSearch] = useState('');
  const [conflictVenueFilter, setConflictVenueFilter] = useState('All');
  const [conflictStatusFilter, setConflictStatusFilter] = useState('all'); // 'all' | 'resolved' | 'unresolved'

  // ── Firestore sync ──────────────────────────────────────────
  // 'synced' | 'syncing' | 'error'
  const [syncStatus, setSyncStatus] = useState('synced');
  const syncTimerRef = useRef(null);
  const userId = currentUser?.uid || null;

  // Derive a stable project ID from the project name
  const projectId = useMemo(() => {
    const raw = localStorage.getItem('slr-screener-project-name') || projectName;
    return projectSlug(raw);
  }, [projectName]);

  // Helper: fire-and-forget Firestore write with sync indicator
  const firestoreSync = useCallback((promiseFn) => {
    if (!userId) return;
    setSyncStatus('syncing');
    clearTimeout(syncTimerRef.current);
    Promise.resolve().then(promiseFn).then(() => {
      setSyncStatus('synced');
    }).catch(() => {
      setSyncStatus('error');
      // Auto-clear error after 10s
      syncTimerRef.current = setTimeout(() => setSyncStatus('synced'), 10000);
    });
  }, [userId]);

  // ── Sharing helpers ─────────────────────────────────────────────
  const loadCollaborators = useCallback(async () => {
    if (!projectId) return;
    try {
      const collabs = await fsGetCollaborators(projectId);
      setCollaborators(collabs);
    } catch (err) {
      console.warn('[Sharing] Failed to load collaborators:', err.message);
    }
  }, [projectId]);

  const handleSendInvite = useCallback(async () => {
    setShareError('');
    const email = shareEmail.trim().toLowerCase();
    if (!email) { setShareError('Please enter an email address.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setShareError('Please enter a valid email.'); return; }
    if (email === currentUser?.email?.toLowerCase()) { setShareError('You cannot invite yourself.'); return; }
    if ((collaborators || []).some(c => c.email === email)) { setShareError('This person is already invited.'); return; }

    setShareLoading(true);
    try {
      // Ensure project meta exists at top-level for collaborator lookup
      await fsSaveProjectMeta(projectId, {
        ownerId: userId,
        ownerEmail: currentUser?.email,
        projectName,
      });
      await fsAddCollaborator(projectId, email, shareRole, userId);
      setShareEmail('');
      await loadCollaborators();
    } catch (err) {
      setShareError('Failed to send invite. Please try again.');
      console.warn('[Sharing] Invite failed:', err.message);
    }
    setShareLoading(false);
  }, [shareEmail, shareRole, projectId, userId, currentUser, projectName, collaborators, loadCollaborators]);

  const handleRemoveCollaborator = useCallback(async (email) => {
    try {
      await fsRemoveCollaborator(projectId, email);
      await loadCollaborators();
    } catch (err) {
      console.warn('[Sharing] Remove failed:', err.message);
    }
  }, [projectId, loadCollaborators]);

  const handleRoleChange = useCallback(async (email, newRole) => {
    try {
      await fsUpdateCollaboratorRole(projectId, email, newRole);
      await loadCollaborators();
    } catch (err) {
      console.warn('[Sharing] Role update failed:', err.message);
    }
  }, [projectId, loadCollaborators]);

  // Check if current project has collaborators (for Team badge)
  const hasCollaborators = (collaborators || []).length > 0;

  // ── Conflict Resolution helpers ──────────────────────────────
  const openConflictDashboard = useCallback(async () => {
    if (!projectId || projectRole !== 'owner') return;
    setProjectMenuOpen(false);
    setProjectSidebarOpen(false);

    try {
      // Fetch each annotator's decisions
      const collabs = await fsGetCollaborators(projectId);
      const annotators = [
        { id: userId, email: currentUser?.email, role: 'owner' },
        ...collabs.filter(c => c.role === 'annotator' && c.status === 'accepted').map(c => ({ id: null, email: c.email, role: 'annotator' })),
      ];

      // We need annotator userIds. For the owner, we have it.
      // For collaborators, we need to look them up. Since we don't store userId in collaborators,
      // we'll fetch decisions for each annotator by their userId if available.
      // For now, we use the owner's userId and look for collaborator decisions.
      // Actually, collaborators store decisions under their own userId. We need their UIDs.
      // We'll store annotator progress by email and fetch by known patterns.

      // Fetch owner's decisions
      const annotatorDecisions = {};
      const ownerDecisions = await fsGetDecisions(userId, projectId);
      annotatorDecisions[userId] = ownerDecisions;

      // For collaborators, we need their UIDs. Store them in the collaborator doc when they accept.
      // For now, fetch via project meta approach — collaborators' decisions use their own UID path.
      // We'll use a placeholder approach: fetch from the collabs' acceptedUid if stored.
      // Since we don't have collaborator UIDs yet, we only show owner's decisions in v1.
      // TODO: In a future update, store collaborator UIDs when they accept invites.

      // Fetch final decisions
      const finalDecisions = await fsGetFinalDecisions(projectId);

      // Run analysis
      const analysis = analyzeConflicts(annotatorDecisions);

      setConflictData({ annotatorDecisions, annotators, finalDecisions, analysis });
      setConflictTab('conflicts');
      setConflictSearch('');
      setConflictVenueFilter('All');
      setConflictStatusFilter('all');
      setAppView('conflicts');
    } catch (err) {
      console.warn('[Conflicts] Failed to load conflict data:', err.message);
    }
  }, [projectId, projectRole, userId, currentUser]);

  const handleFinalDecision = useCallback(async (paperId, decision, comment) => {
    if (!projectId) return;
    try {
      await fsSaveFinalDecision(projectId, paperId, {
        decision,
        resolvedBy: currentUser?.email,
        comment: comment || '',
      });
      // Update local state
      setConflictData(prev => {
        if (!prev) return prev;
        const updated = { ...prev.finalDecisions, [paperId]: { decision, resolvedBy: currentUser?.email, comment: comment || '', resolvedAt: new Date().toISOString() } };
        return { ...prev, finalDecisions: updated };
      });
    } catch (err) {
      console.warn('[Conflicts] Failed to save final decision:', err.message);
    }
  }, [projectId, currentUser]);

  const exportResolved = useCallback(() => {
    if (!conflictData || !papers.length) return;
    const { annotatorDecisions, annotators, finalDecisions } = conflictData;
    const annotatorIds = Object.keys(annotatorDecisions);

    const escapeCSV = (s) => {
      if (!s) return '';
      const str = String(s);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    // Header
    const annotatorHeaders = annotators.map((a, i) => `annotator_${i + 1}_decision`);
    const header = ['title', 'author', 'venue', 'abstract', 'doi', ...annotatorHeaders, 'final_decision', 'conflict_comment', 'resolved_by', 'resolved_at'].join(',');

    const rows = papers.map((p, idx) => {
      const paperId = String(idx);
      const annotatorCols = annotatorIds.map(aid => escapeCSV(annotatorDecisions[aid]?.[paperId] || ''));
      const fd = finalDecisions[paperId];
      return [
        escapeCSV(p.title), escapeCSV(p.author), escapeCSV(p.conf),
        escapeCSV(p.abstract), escapeCSV(p.doi),
        ...annotatorCols,
        escapeCSV(fd?.decision || ''), escapeCSV(fd?.comment || ''),
        escapeCSV(fd?.resolvedBy || ''), escapeCSV(fd?.resolvedAt || ''),
      ].join(',');
    });

    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName}_resolved.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [conflictData, papers, projectName]);

  console.log('[SLR] Restored state — index:', currentIndex, 'venue:', venueFilter, 'decisions:', Object.keys(decisions).length);

  const PAPERS_KEY = 'slr-screener-papers';

  // Load demo data from JSON file
  const loadDemoData = useCallback(() => {
    fetch(process.env.PUBLIC_URL + '/enriched_papers_2025.json?t=' + Date.now())
      .then((r) => r.json())
      .then((data) => {
        setPapers(data.papers);
        setLoading(false);
        setAppView('screener');
        setIsDemo(true);
        setProjectName('Model Sizes in SE Research 2025');
        localStorage.setItem('slr-screener-has-data', '1');
        localStorage.setItem('slr-screener-is-demo', '1');
        localStorage.setItem('slr-screener-project-name', 'Model Sizes in SE Research 2025');
        // Demo papers are not stored in localStorage (too large), re-fetched on each load
        // Sync demo project metadata to Firestore
        const demoId = projectSlug('Model Sizes in SE Research 2025');
        syncProjectToFirestore(userId, demoId, { name: 'Model Sizes in SE Research 2025', isDemo: true, createdAt: Date.now(), paperCount: data.papers.length });
        try { fsSaveProjectMeta(demoId, { ownerId: userId, ownerEmail: currentUser?.email, projectName: 'Model Sizes in SE Research 2025' })?.catch(() => {}); } catch (e) { /* ignore */ }
        setProjectRole('owner');
        setProjectOwnerId(null);
      });
  }, [userId, currentUser]);

  // Reload data: demo re-fetches JSON, imported re-reads from localStorage
  const loadData = useCallback(() => {
    if (isDemo) {
      loadDemoData();
    } else {
      try {
        const saved = localStorage.getItem(PAPERS_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setPapers(parsed);
            setLoading(false);
          }
        }
      } catch (e) { console.warn('Could not reload papers:', e.message); }
    }
  }, [isDemo, loadDemoData]);

  // Import papers from Setup page
  const importPapers = useCallback((importedPapers, customName) => {
    setPapers(importedPapers);
    setLoading(false);
    setAppView('screener');
    setIsDemo(false);
    const name = customName || 'Untitled Project';
    setProjectName(name);
    localStorage.setItem('slr-screener-has-data', '1');
    localStorage.setItem('slr-screener-is-demo', '0');
    localStorage.setItem('slr-screener-project-name', name);
    // Persist imported papers so they survive page refresh
    try { localStorage.setItem(PAPERS_KEY, JSON.stringify(importedPapers)); } catch (e) { console.warn('Could not save papers to localStorage:', e.message); }
    setCurrentIndex(0);
    setDecisions({});
    setAbstractEdits({});
    setAiScores({});
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SCORES_KEY);
    // Sync new project to Firestore + save top-level meta for sharing
    const newProjectId = projectSlug(name);
    firestoreSync(() => fsSaveProject(userId, newProjectId, { name, isDemo: false, createdAt: Date.now(), paperCount: importedPapers.length }));
    try { fsSaveProjectMeta(newProjectId, { ownerId: userId, ownerEmail: currentUser?.email, projectName: name })?.catch(() => {}); } catch (e) { /* ignore */ }
    setProjectRole('owner');
    setProjectOwnerId(null);
  }, [userId, currentUser, firestoreSync]);

  // Append papers to existing project (dedup by title)
  const appendPapers = useCallback((newPapers) => {
    if (!Array.isArray(newPapers) || newPapers.length === 0) {
      // Called with no args = cancel
      setAppendMode(null);
      setAppView('screener');
      return;
    }
    const existingTitles = new Set(papers.map(p => (p.title || '').toLowerCase().trim()));
    const unique = [];
    let skipped = 0;
    for (const p of newPapers) {
      const key = (p.title || '').toLowerCase().trim();
      if (!key || existingTitles.has(key)) {
        skipped++;
      } else {
        unique.push(p);
        existingTitles.add(key);
      }
    }
    const merged = [...papers, ...unique];
    setPapers(merged);
    setAppendMode(null);
    setAppView('screener');
    setAppendResult({ added: unique.length, skipped, total: merged.length });
    // Persist updated papers (skip for demo — too large)
    if (!isDemo) {
      try { localStorage.setItem(PAPERS_KEY, JSON.stringify(merged)); } catch (e) { console.warn('Could not save papers:', e.message); }
    }
  }, [papers, isDemo]);

  // On mount: restore saved project or auto-load demo for first-time users.
  useEffect(() => {
    const savedIsDemo = localStorage.getItem('slr-screener-is-demo');
    // If user has a non-demo project with saved papers, restore them
    if (savedIsDemo === '0') {
      try {
        const saved = localStorage.getItem(PAPERS_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setPapers(parsed);
            setLoading(false);
            setAppView('screener');
            return;
          }
        }
      } catch (e) { /* fall through to demo */ }
    }
    // First visit or demo project — load demo data
    loadDemoData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount: fetch decisions and scores from Firestore in background, merge with localStorage.
  // Firestore is source of truth — if it has data, it overwrites localStorage.
  const firestoreLoadedRef = useRef(false);
  useEffect(() => {
    if (!userId || firestoreLoadedRef.current) return;
    firestoreLoadedRef.current = true;

    (async () => {
      try {
        // Fetch project settings from Firestore
        const fsProject = await fsGetProject(userId, projectId);
        if (fsProject) {
          // Merge settings from Firestore (source of truth)
          if (fsProject.hlCategories) setHlCategories(fsProject.hlCategories);
          if (fsProject.researchGoal) setResearchGoal(fsProject.researchGoal);
          if (fsProject.scoringModel) setScoringModel(fsProject.scoringModel);
        }

        // Fetch decisions from Firestore
        const fsDecisions = await fsGetDecisions(userId, projectId);
        if (Object.keys(fsDecisions).length > 0) {
          setDecisions(prev => {
            // Merge: Firestore wins on conflicts
            const merged = { ...prev, ...fsDecisions };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
            return merged;
          });
        }

        // Fetch AI scores from Firestore (shared)
        const fsScores = await fsGetAIScores(projectId);
        if (Object.keys(fsScores).length > 0) {
          setAiScores(prev => {
            const merged = { ...prev, ...fsScores };
            localStorage.setItem(SCORES_KEY, JSON.stringify(merged));
            return merged;
          });
        }
        // Fetch collaborators for current project (for Team badge)
        const collabs = await fsGetCollaborators(projectId);
        setCollaborators(collabs);

        // Fetch shared projects (projects where this user is a collaborator)
        const shared = await fsGetSharedProjects(currentUser?.email);
        if (shared.length > 0) {
          // Enrich with project meta (owner info, project name)
          const enriched = [];
          for (const s of shared) {
            try {
              const meta = await fsGetProjectMeta(s.projectId);
              if (meta && meta.ownerId !== userId) {
                enriched.push({ ...s, projectName: meta.projectName || s.projectId, ownerEmail: meta.ownerEmail, ownerId: meta.ownerId });
                // Auto-accept pending invites
                if (s.status === 'pending') {
                  fsAcceptInvite(s.projectId, currentUser.email).catch(() => {});
                }
              }
            } catch { /* skip inaccessible projects */ }
          }
          setSharedProjects(enriched);
        }
      } catch (err) {
        console.warn('[Firestore] Initial load failed, using localStorage only:', err.message);
      }
    })();
  }, [userId, projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save decisions (localStorage + Firestore)
  const decisionsInitRef = useRef(true);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(decisions));
    // Skip Firestore sync on initial mount (already loaded from there)
    if (decisionsInitRef.current) { decisionsInitRef.current = false; return; }
    firestoreSync(() => syncDecisionsToFirestore(userId, projectId, decisions));
  }, [decisions]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Auto-save AI scores (localStorage + Firestore)
  const scoresInitRef = useRef(true);
  useEffect(() => {
    localStorage.setItem(SCORES_KEY, JSON.stringify(aiScores));
    if (scoresInitRef.current) { scoresInitRef.current = false; return; }
    firestoreSync(() => syncAIScoresToFirestore(projectId, aiScores));
  }, [aiScores]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save model selection (localStorage + Firestore project settings)
  useEffect(() => {
    localStorage.setItem(MODEL_KEY, scoringModel);
    firestoreSync(() => syncProjectToFirestore(userId, projectId, { scoringModel }));
  }, [scoringModel]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save project name (localStorage + Firestore)
  useEffect(() => {
    localStorage.setItem('slr-screener-project-name', projectName);
    firestoreSync(() => syncProjectToFirestore(userId, projectId, { name: projectName, isDemo }));
  }, [projectName]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save highlight categories (localStorage + Firestore project settings)
  const hlInitRef = useRef(true);
  useEffect(() => {
    localStorage.setItem(HL_CATEGORIES_KEY, JSON.stringify(hlCategories));
    if (hlInitRef.current) { hlInitRef.current = false; return; }
    firestoreSync(() => syncProjectToFirestore(userId, projectId, { hlCategories }));
  }, [hlCategories]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save research goal (localStorage + Firestore project settings)
  const goalInitRef = useRef(true);
  useEffect(() => {
    localStorage.setItem(RESEARCH_GOAL_KEY, researchGoal);
    if (goalInitRef.current) { goalInitRef.current = false; return; }
    firestoreSync(() => syncProjectToFirestore(userId, projectId, { researchGoal }));
  }, [researchGoal]); // eslint-disable-line react-hooks/exhaustive-deps

  // Venue-only filtering, optionally sorted by AI score
  const filteredIndices = useMemo(() => {
    const indices = papers.reduce((acc, p, i) => {
      if (venueFilter !== 'All' && p.conf !== venueFilter) return acc;
      acc.push(i);
      return acc;
    }, []);
    if (sortByScore) {
      const scored = indices.filter(i => aiScores[i] != null);
      const unscored = indices.filter(i => aiScores[i] == null);
      scored.sort((a, b) => (aiScores[b]?.score ?? 0) - (aiScores[a]?.score ?? 0));
      return [...scored, ...unscored];
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
        case 'y': if (projectRole !== 'viewer') makeDecision('Yes'); break;
        case 'n': if (projectRole !== 'viewer') makeDecision('No'); break;
        case 'm': if (projectRole !== 'viewer') makeDecision('Maybe'); break;
        case 'u': if (projectRole !== 'viewer') undoDecision(); break;
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

  // Export standardized JSON
  const exportProjectJSON = useCallback(() => {
    const data = {
      metadata: {
        project_name: projectName,
        total_papers: papers.length,
        exported_date: new Date().toISOString(),
        source: 'SLR Screener',
      },
      papers: papers.map((p, i) => {
        const abs = getAbstract(i);
        return {
          conf: p.conf || 'not_found',
          title: p.title || 'not_found',
          author: p.author || 'not_found',
          abstract: abs || 'not_found',
          doi: p.doi || 'not_found',
          doi_url: p.doi_url || 'not_found',
          openalex_id: p.openalex_id || 'not_found',
          arxiv_id: p.arxiv_id || 'not_found',
          pdf_url: p.pdf_url || 'not_found',
          pdf_source: p.pdf_source || 'not_found',
        };
      }),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = projectSlug(projectName) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [papers, projectName, getAbstract]);

  // Export CSV with screening results (uses project name for filename)
  const exportProjectCSV = useCallback(() => {
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
    a.download = projectSlug(projectName) + '_results.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [papers, decisions, getAbstract, aiScores, projectName]);

  const clearAllDecisions = useCallback(() => {
    setDecisions({});
    setUndoStack([]);
    setCurrentIndex(0);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(INDEX_KEY);
    // Clear decisions in Firestore too
    firestoreSync(() => syncDecisionsToFirestore(userId, projectId, {}));
  }, [userId, projectId, firestoreSync]);

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

    // Find papers not scored by the current model
    const unscored = [];
    for (let i = 0; i < papers.length; i++) {
      if (aiScores[i]?.model === scoringModel) continue;
      const abs = getAbstract(i);
      if (!abs || abs === 'not_found') continue;
      unscored.push(i);
    }
    if (unscored.length === 0) { alert(`All papers with abstracts have been scored by ${modelName(scoringModel)}.`); return; }

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
          const result = await scoreOneAbstract(apiKey, papers[idx].title, abs, scoringModel, researchGoal);
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
    // Show checkmark briefly then clear
    setScoringProgress(null);
    setScoringStopping(false);
    setScoringDone(true);
    setTimeout(() => setScoringDone(false), 2000);
  }, [apiKey, papers, aiScores, getAbstract, scoringModel, researchGoal]);

  const [scoringStopping, setScoringStopping] = useState(false);
  const stopScoring = useCallback(() => {
    scoringAbortRef.current = true;
    setScoringStopping(true);
  }, []);

  const [scoringOne, setScoringOne] = useState(null); // globalIndex being scored
  const scoreOnePaper = useCallback(async (gIdx) => {
    if (!apiKey) { setShowApiKeyModal(true); return; }
    try {
      const health = await fetch('http://localhost:3001/api/health');
      if (!health.ok) throw new Error();
    } catch {
      alert('Proxy server is not running.\n\nStart it in a separate terminal:\n  node server.js');
      return;
    }
    const abs = getAbstract(gIdx);
    if (!abs || abs === 'not_found') { alert('No abstract to score.'); return; }
    setScoringOne(gIdx);
    try {
      const result = await scoreOneAbstract(apiKey, papers[gIdx].title, cleanAbstractText(abs), scoringModel, researchGoal);
      setAiScores(prev => ({ ...prev, [gIdx]: result }));
    } catch (err) {
      console.error('[SLR] Single score error:', err);
      alert('Scoring failed: ' + err.message);
    }
    setScoringOne(null);
  }, [apiKey, papers, getAbstract, scoringModel, researchGoal]);

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
    if (window.confirm('This will delete all AI scores. Are you sure?')) {
      setAiScores({});
      localStorage.removeItem(SCORES_KEY);
      firestoreSync(() => syncAIScoresToFirestore(projectId, {}));
    }
  }, [projectId, firestoreSync]);

  const clearErrorScores = useCallback(() => {
    const cleaned = {};
    let removed = 0;
    for (const [idx, score] of Object.entries(aiScores)) {
      if (typeof score.score === 'number' && score.suggestion && score.reason) {
        cleaned[idx] = score;
      } else {
        removed++;
      }
    }
    if (removed === 0) { alert('No error entries found.'); return; }
    setAiScores(cleaned);
    alert(`Removed ${removed} error entries.`);
  }, [aiScores]);

  // Suggest keywords via Claude API
  const suggestKeywords = useCallback(async (goal) => {
    if (!apiKey) { alert('Set API key first (use Score Papers button).'); return; }
    try {
      const health = await fetch('http://localhost:3001/api/health');
      if (!health.ok) throw new Error();
    } catch {
      alert('Proxy server is not running.\n\nStart it in a separate terminal:\n  node server.js');
      return;
    }
    setSuggestingKeywords(true);
    try {
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          model: scoringModel,
          max_tokens: 1000,
          messages: [{
            role: 'user',
            content: `Given this research goal for a systematic literature review:\n\n"${goal}"\n\nSuggest 3-5 keyword highlight categories for screening paper abstracts. Each category should have a descriptive name and a comprehensive list of relevant keywords/phrases to highlight.\n\nRespond in JSON only:\n[{"name": "Category Name", "keywords": "keyword1, keyword2, multi-word phrase, ..."}]`
          }],
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      const text = data.content?.[0]?.text || '';
      const jsonStr = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) throw new Error('Expected array');
      const newCats = parsed.map((cat, i) => ({
        name: cat.name,
        color: PRESET_COLORS[i % PRESET_COLORS.length].bg,
        textColor: PRESET_COLORS[i % PRESET_COLORS.length].text,
        cls: `hl-cat-${i}`,
        keywords: cat.keywords,
      }));
      setHlDraft(newCats);
    } catch (err) {
      console.error('[SLR] Suggest keywords error:', err);
      alert('Failed to suggest keywords: ' + err.message);
    }
    setSuggestingKeywords(false);
  }, [apiKey, scoringModel]);

  // Open highlight settings panel
  const openHlSettings = useCallback(() => {
    setHlDraft(hlCategories.map(c => ({ ...c })));
    setGoalDraft(researchGoal);
    setHlSettingsOpen(true);
  }, [hlCategories, researchGoal]);

  const saveHlSettings = useCallback(() => {
    if (!hlDraft) return;
    const cats = hlDraft.map((c, i) => ({ ...c, cls: `hl-cat-${i}` }));
    setHlCategories(cats);
    setResearchGoal(goalDraft);
    setHlSettingsOpen(false);
    setHlDraft(null);
  }, [hlDraft, goalDraft]);

  // Sorted scored papers list for AI Insights sidebar
  const scoredPapersList = useMemo(() => {
    return Object.entries(aiScores)
      .map(([idx, score]) => ({ idx: Number(idx), ...score, paper: papers[Number(idx)] }))
      .filter(item => item.paper)
      .sort((a, b) => b.score - a.score);
  }, [aiScores, papers]);

  // Count papers not scored by the currently selected model
  const unscoredCount = useMemo(() => {
    let count = 0;
    for (let i = 0; i < papers.length; i++) {
      if (aiScores[i]?.model === scoringModel) continue;
      const abs = abstractEdits[i] || papers[i]?.abstract || '';
      if (abs && abs !== 'not_found') count++;
    }
    return count;
  }, [papers, aiScores, abstractEdits, scoringModel]);

  // Progress stats
  const totalPapers = papers.length;
  const yesCount = Object.values(decisions).filter((d) => d === 'Yes').length;
  const noCount = Object.values(decisions).filter((d) => d === 'No').length;
  const maybeCount = Object.values(decisions).filter((d) => d === 'Maybe').length;
  const decidedCount = yesCount + noCount + maybeCount;

  // ===== SETUP VIEW =====
  if (appView === 'setup') {
    return <SetupView onImport={importPapers} onLoadDemo={loadData} apiKey={apiKey} setApiKey={setApiKey}
      appendMode={appendMode} onAppend={appendPapers} />;
  }

  // ===== CONFLICT RESOLUTION VIEW =====
  if (appView === 'conflicts' && conflictData) {
    const { annotatorDecisions, annotators, finalDecisions, analysis } = conflictData;
    const annotatorIds = Object.keys(annotatorDecisions);
    const totalPapers = papers.length;

    // Compute venues for filter
    const conflictVenues = ['All', ...new Set(papers.map(p => p.conf).filter(Boolean))];

    // Get papers for current tab
    let tabPaperIds;
    if (conflictTab === 'conflicts') tabPaperIds = analysis.conflicts;
    else if (conflictTab === 'agreed') tabPaperIds = analysis.agreed;
    else tabPaperIds = analysis.screened;

    // Apply filters
    let filteredPapers = tabPaperIds.map(id => ({ paperId: id, paper: papers[parseInt(id)] })).filter(p => p.paper);
    if (conflictVenueFilter !== 'All') {
      filteredPapers = filteredPapers.filter(p => p.paper.conf === conflictVenueFilter);
    }
    if (conflictSearch) {
      const q = conflictSearch.toLowerCase();
      filteredPapers = filteredPapers.filter(p => p.paper.title?.toLowerCase().includes(q));
    }
    if (conflictTab === 'conflicts' && conflictStatusFilter !== 'all') {
      if (conflictStatusFilter === 'resolved') {
        filteredPapers = filteredPapers.filter(p => finalDecisions[p.paperId]);
      } else {
        filteredPapers = filteredPapers.filter(p => !finalDecisions[p.paperId]);
      }
    }

    const kappaInfo = interpretKappa(analysis.kappa);
    const resolvedCount = analysis.conflicts.filter(id => finalDecisions[id]).length;

    return (
      <div className="app conflict-view">
        <div className="conflict-header">
          <button className="conflict-back-btn" onClick={() => setAppView('screener')}>&larr; Back to Screener</button>
          <h2>Conflict Resolution — {projectName}</h2>
          <button className="conflict-export-btn" onClick={exportResolved}>Export Resolved</button>
        </div>

        {/* Annotator Progress */}
        <div className="conflict-section">
          <h3>Annotator Progress</h3>
          <div className="conflict-annotator-grid">
            {annotators.map((a, i) => {
              const aid = annotatorIds[i] || a.id;
              const decs = aid ? annotatorDecisions[aid] || {} : {};
              const count = Object.keys(decs).length;
              const pct = totalPapers > 0 ? Math.round((count / totalPapers) * 100) : 0;
              return (
                <div key={a.email} className="conflict-annotator-card">
                  <div className="conflict-annotator-info">
                    <span className="conflict-annotator-email">{a.email}</span>
                    <span className="conflict-annotator-role">{a.role}</span>
                  </div>
                  <div className="conflict-progress-bar">
                    <div className="conflict-progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="conflict-progress-label">{count} / {totalPapers} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Agreement Summary */}
        <div className="conflict-section">
          <h3>Agreement Summary</h3>
          <div className="conflict-stats-grid">
            <div className="conflict-stat">
              <span className="conflict-stat-value">{analysis.screened.length}</span>
              <span className="conflict-stat-label">Screened by 2+</span>
            </div>
            <div className="conflict-stat">
              <span className="conflict-stat-value">{analysis.agreementRate.toFixed(1)}%</span>
              <span className="conflict-stat-label">Agreement Rate</span>
            </div>
            {analysis.kappaType !== 'none' && (
              <div className="conflict-stat">
                <span className="conflict-stat-value">{analysis.kappa.toFixed(3)}</span>
                <span className="conflict-stat-label">{analysis.kappaType} Kappa</span>
                <span className="conflict-kappa-badge" style={{ background: kappaInfo.color }}>{kappaInfo.label}</span>
              </div>
            )}
            <div className="conflict-stat">
              <span className="conflict-stat-value conflict-stat-conflict">{analysis.conflicts.length}</span>
              <span className="conflict-stat-label">Conflicts ({resolvedCount} resolved)</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="conflict-tabs">
          <button className={`conflict-tab ${conflictTab === 'conflicts' ? 'active' : ''}`} onClick={() => setConflictTab('conflicts')}>
            Conflicts ({analysis.conflicts.length})
          </button>
          <button className={`conflict-tab ${conflictTab === 'agreed' ? 'active' : ''}`} onClick={() => setConflictTab('agreed')}>
            Agreed ({analysis.agreed.length})
          </button>
          <button className={`conflict-tab ${conflictTab === 'all' ? 'active' : ''}`} onClick={() => setConflictTab('all')}>
            All ({analysis.screened.length})
          </button>
        </div>

        {/* Filters */}
        <div className="conflict-filters">
          <input
            className="conflict-search"
            type="text"
            placeholder="Search by title..."
            value={conflictSearch}
            onChange={(e) => setConflictSearch(e.target.value)}
          />
          <select className="conflict-venue-filter" value={conflictVenueFilter} onChange={(e) => setConflictVenueFilter(e.target.value)}>
            {conflictVenues.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          {conflictTab === 'conflicts' && (
            <select className="conflict-status-filter" value={conflictStatusFilter} onChange={(e) => setConflictStatusFilter(e.target.value)}>
              <option value="all">All conflicts</option>
              <option value="unresolved">Unresolved</option>
              <option value="resolved">Resolved</option>
            </select>
          )}
        </div>

        {/* Paper List */}
        <div className="conflict-paper-list">
          {filteredPapers.length === 0 && (
            <div className="conflict-empty">No papers match the current filters.</div>
          )}
          {filteredPapers.map(({ paperId, paper }) => {
            const fd = finalDecisions[paperId];
            const isConflict = analysis.conflicts.includes(paperId);
            return (
              <div key={paperId} className={`conflict-paper-row ${fd ? 'resolved' : ''}`}>
                <div className="conflict-paper-info">
                  <span className="conflict-paper-venue">{paper.conf}</span>
                  <span className="conflict-paper-title">{paper.title?.length > 100 ? paper.title.slice(0, 100) + '...' : paper.title}</span>
                </div>
                <div className="conflict-decisions-row">
                  {annotatorIds.map((aid, i) => {
                    const d = annotatorDecisions[aid]?.[paperId];
                    return (
                      <span key={aid} className={`conflict-decision-chip ${d ? d.toLowerCase() : 'none'}`} title={annotators[i]?.email}>
                        {d || '—'}
                      </span>
                    );
                  })}
                  {isConflict && (
                    <div className="conflict-resolve-controls">
                      <select
                        className="conflict-final-select"
                        value={fd?.decision || ''}
                        onChange={(e) => {
                          const comment = fd?.comment || '';
                          handleFinalDecision(paperId, e.target.value, comment);
                        }}
                      >
                        <option value="">— Resolve —</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                        <option value="Maybe">Maybe</option>
                      </select>
                      <input
                        className="conflict-comment-input"
                        type="text"
                        placeholder="Comment..."
                        defaultValue={fd?.comment || ''}
                        onBlur={(e) => {
                          if (fd?.decision) {
                            handleFinalDecision(paperId, fd.decision, e.target.value);
                          }
                        }}
                      />
                    </div>
                  )}
                  {!isConflict && (
                    <span className={`conflict-decision-chip agreed ${(annotatorDecisions[annotatorIds[0]]?.[paperId] || '').toLowerCase()}`}>
                      Agreed
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

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
      {hlStyleTag}

      {/* Append result notification */}
      {appendResult && (
        <div className="append-result-banner">
          <span>
            Added <strong>{appendResult.added}</strong> paper{appendResult.added !== 1 ? 's' : ''}.
            {appendResult.skipped > 0 && <> <strong>{appendResult.skipped}</strong> duplicate{appendResult.skipped !== 1 ? 's' : ''} skipped.</>}
            {' '}Total now: <strong>{appendResult.total}</strong>.
          </span>
          <button onClick={() => setAppendResult(null)}>&times;</button>
        </div>
      )}

      {/* Header */}
      <div className="header">
        <button className="hamburger-btn" onClick={() => setProjectSidebarOpen(v => !v)} aria-label="Menu">☰</button>
        <h1><span className="logo-bold">SLR</span> <span className="logo-light">Screener</span></h1>
        <div className="header-actions">
          <button className="header-btn btn-reload" onClick={loadData}>Reload Data</button>
          <button
            className={`header-btn hl-tip tip-down ${scoringProgress ? 'btn-stop' : 'btn-score'}`}
            onClick={scoringProgress ? stopScoring : startScoring}
            disabled={scoringStopping}
            data-tip={scoringProgress
              ? `${Object.keys(aiScores).length + scoringProgress.done}/${totalPapers} scored with ${modelName(scoringModel)}`
              : scoringDone
                ? `${Object.keys(aiScores).length}/${totalPapers} scored with ${modelName(scoringModel)}`
                : `${unscoredCount} papers unscored. Click to score them.`}
          >
            {scoringStopping
              ? 'Stopping...'
              : scoringProgress
                ? `Stop Scoring (${scoringProgress.total - scoringProgress.done} left)`
                : scoringDone ? 'Score Papers \u2713' : 'Score Papers'}
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
          <span className={`sync-indicator sync-${syncStatus}`} title={
            syncStatus === 'synced' ? 'All changes saved to cloud' :
            syncStatus === 'syncing' ? 'Syncing to cloud...' :
            'Sync failed — changes saved locally'
          }>
            {syncStatus === 'synced' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><polyline points="8 15 11 18 16 13"/></svg>}
            {syncStatus === 'syncing' && <svg className="sync-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><path d="M12 12v3"/></svg>}
            {syncStatus === 'error' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/><line x1="15" y1="13" x2="9" y2="17"/><line x1="9" y1="13" x2="15" y2="17"/></svg>}
          </span>
          <div className="header-user">
            {currentUser.photoURL ? (
              <img src={currentUser.photoURL} alt="" className="header-avatar" referrerPolicy="no-referrer" />
            ) : (
              <span className="header-avatar-placeholder">{(currentUser.email || '?')[0].toUpperCase()}</span>
            )}
            <button className="header-btn btn-signout" onClick={logout}>Sign Out</button>
          </div>
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
          className={`highlight-toggle ${highlightsOn ? 'on' : ''} hl-tip tip-down`}
          onClick={() => setHighlightsOn(v => !v)}
          data-tip="Toggle keyword highlights (H)"
        >
          Highlights {highlightsOn ? 'On' : 'Off'}
          <span
            className="hl-gear-inline"
            onClick={(e) => {
              e.stopPropagation();
              const el = e.currentTarget;
              el.classList.remove('spinning');
              void el.offsetWidth;
              el.classList.add('spinning');
              setTimeout(() => { el.classList.remove('spinning'); openHlSettings(); }, 400);
            }}
          >⚙</span>
        </button>
        <span className="filter-label" style={{ marginLeft: 4 }}>Order:</span>
        <select
          className={`order-select ${Object.keys(aiScores).length === 0 ? 'hl-tip tip-down' : ''}`}
          value={sortByScore ? 'score' : 'default'}
          onChange={(e) => { setSortByScore(e.target.value === 'score'); setCurrentIndex(0); }}
          data-tip={Object.keys(aiScores).length === 0 ? 'Run AI scoring first' : undefined}
        >
          <option value="default">Default</option>
          <option value="score" disabled={Object.keys(aiScores).length === 0}>
            AI Score ↓
          </option>
        </select>
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
              {scoringOne === globalIndex ? (
                <span className="ai-score-badge score-mid">Scoring...</span>
              ) : aiScores[globalIndex] ? (
                <span
                  className={`ai-score-badge score-${aiScores[globalIndex].score >= 70 ? 'high' : aiScores[globalIndex].score >= 40 ? 'mid' : 'low'} clickable hl-tip`}
                  data-tip={`Click to rescore with ${modelName(scoringModel)}`}
                  onClick={() => scoreOnePaper(globalIndex)}
                >
                  AI: {aiScores[globalIndex].score}<span className="rescore-icon"> ↻</span>
                </span>
              ) : (
                <span
                  className="ai-score-badge score-unscored clickable hl-tip"
                  data-tip={apiKey ? 'Click to score this paper' : 'Set API key first (use Score Papers button)'}
                  onClick={() => scoreOnePaper(globalIndex)}
                >
                  AI: ?
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
                <div className="abstract-text">{highlightsOn ? highlightAbstract(abstract, hlData) : cleanAbstractText(abstract)}</div>
              )}
              {aiScores[globalIndex]?.reason && (
                <div className="ai-reason">
                  <strong>AI ({modelName(aiScores[globalIndex].model)}):</strong> {aiScores[globalIndex].reason}
                </div>
              )}
            </div>
          </div>

          {/* Decision buttons */}
          <div className="decision-section">
            {projectRole === 'viewer' && (
              <div className="viewer-readonly-notice">You have view-only access to this project.</div>
            )}
            {projectRole !== 'viewer' && (() => { const sug = aiScores[globalIndex]?.suggestion?.toLowerCase(); return <>
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
            {projectRole !== 'viewer' && (
              <button
                className="decision-btn btn-undo"
                onClick={undoDecision}
                disabled={undoStack.length === 0}
              >
                Undo <span className="shortcut">U</span>
              </button>
            )}
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
        {(decidedCount > 0 || apiKey) && (
          <div className="sidebar-footer">
            {decidedCount > 0 && (
              <button className="reset-btn full-width" onClick={() => { if (window.confirm(`Clear all ${decidedCount} decisions? This cannot be undone.`)) clearAllDecisions(); }}>
                Reset All Decisions
              </button>
            )}
            {apiKey && (
              <button className="reset-btn full-width" style={{ marginTop: decidedCount > 0 ? 8 : 0, borderColor: '#b2bec3', color: '#636e72' }}
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
        {/* Model selector */}
        <div className="ai-model-selector">
          <span className="ai-insight-label" style={{ marginBottom: 4 }}>Model</span>
          <select
            className="ai-model-select"
            value={scoringModel}
            onChange={(e) => setScoringModel(e.target.value)}
          >
            {AI_MODELS.map(m => (
              <option key={m.id} value={m.id}>{m.name} — {m.desc}</option>
            ))}
          </select>
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
              {aiScores[globalIndex].model && <span className="ai-via-model">via {modelName(aiScores[globalIndex].model)}</span>}
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
                {item.model && <span className="ai-via-model">via {modelName(item.model)}</span>}
              </div>
              <div className="sidebar-item-title">
                {item.paper.title.length > 80 ? item.paper.title.slice(0, 80) + '...' : item.paper.title}
              </div>
            </div>
          ))}
        </div>
        {Object.keys(aiScores).length > 0 && (
          <div className="sidebar-footer">
            <button className="reset-btn full-width" onClick={clearErrorScores}>
              Clear Errors
            </button>
            <div className="reset-link" onClick={clearScores}>Reset All Scores</div>
          </div>
        )}
      </div>
      {aiInsightsOpen && <div className="sidebar-overlay" onClick={() => setAiInsightsOpen(false)} />}

      {/* Project Sidebar (left) */}
      <div className={`project-sidebar ${projectSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>Projects</h2>
          <button className="sidebar-close" onClick={() => setProjectSidebarOpen(false)}>&times;</button>
        </div>
        <div className="project-sidebar-body">
          <div className="project-item active" onClick={() => setProjectMenuOpen(false)}>
            <span className="project-item-icon">📄</span>
            <div className="project-item-info">
              {renamingProject ? (
                <input
                  className="project-rename-input"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  onBlur={() => setRenamingProject(false)}
                  onKeyDown={(e) => { if (e.key === 'Enter') setRenamingProject(false); if (e.key === 'Escape') setRenamingProject(false); }}
                  autoFocus
                />
              ) : (
                <span className="project-item-name">
                  {projectName}
                  {isDemo && <span className="project-demo-badge">Demo</span>}
                  {projectRole === 'owner' && hasCollaborators && <span className="project-team-badge">Team</span>}
                  {projectRole !== 'owner' && <span className="project-shared-badge">Shared with me</span>}
                </span>
              )}
              <span className="project-item-meta">{totalPapers} papers · {decidedCount} screened</span>
            </div>
            <div className="project-menu-wrap">
              <button className="project-menu-btn" onClick={(e) => { e.stopPropagation(); setProjectMenuOpen(v => !v); }}>⋮</button>
              {projectMenuOpen && (
                <div className="project-menu-dropdown">
                  <button onClick={() => { setProjectMenuOpen(false); setRenamingProject(true); }}>Rename</button>
                  <button onClick={() => {
                    setProjectMenuOpen(false);
                    setProjectSidebarOpen(false);
                    setAppendMode(projectName);
                    setAppView('setup');
                  }}>Add Papers</button>
                  <div className="project-menu-sep" />
                  <button onClick={() => { setProjectMenuOpen(false); exportProjectJSON(); }}>Export JSON</button>
                  <button onClick={() => { setProjectMenuOpen(false); exportProjectCSV(); }}>Export CSV</button>
                  <div className="project-menu-sep" />
                  {projectRole === 'owner' && (
                    <button onClick={() => { setProjectMenuOpen(false); setShareModalOpen(true); loadCollaborators(); }}>Share Project</button>
                  )}
                  {projectRole === 'owner' && hasCollaborators && (
                    <button onClick={openConflictDashboard}>Resolve Conflicts</button>
                  )}
                  <button onClick={() => {
                    setProjectMenuOpen(false);
                    alert('Duplicate is not yet implemented — coming soon with multi-project support.');
                  }}>Duplicate</button>
                  {!isDemo && (
                    <button className="project-menu-danger" onClick={() => {
                      if (window.confirm(`Delete "${projectName}"? This will clear all decisions and scores.`)) {
                        setProjectMenuOpen(false);
                        setProjectSidebarOpen(false);
                        setPapers([]);
                        setDecisions({});
                        setAiScores({});
                        setAbstractEdits({});
                        localStorage.removeItem('slr-screener-has-data');
                        localStorage.removeItem(STORAGE_KEY);
                        localStorage.removeItem(SCORES_KEY);
                        localStorage.removeItem(PAPERS_KEY);
                        localStorage.removeItem('slr-screener-is-demo');
                        localStorage.removeItem('slr-screener-project-name');
                        // Delete from Firestore
                        firestoreSync(() => fsDeleteProject(userId, projectId));
                        // Load demo as fallback after delete
                        loadDemoData();
                      }
                    }}>Delete</button>
                  )}
                </div>
              )}
            </div>
          </div>
          {/* Shared projects section */}
          {sharedProjects.length > 0 && (
            <>
              <div className="shared-section-label">Shared with me</div>
              {sharedProjects.map(sp => (
                <div
                  key={sp.projectId}
                  className={`project-item ${projectRole !== 'owner' && projectId === sp.projectId ? 'active' : ''}`}
                  onClick={async () => {
                    setProjectSidebarOpen(false);
                    setProjectMenuOpen(false);
                    setProjectRole(sp.role);
                    setProjectOwnerId(sp.ownerId);
                    setProjectName(sp.projectName);
                    setIsDemo(false);
                    localStorage.setItem('slr-screener-project-name', sp.projectName);
                    localStorage.setItem('slr-screener-is-demo', '0');
                    // Load owner's project data
                    try {
                      const ownerProject = await fsGetProject(sp.ownerId, sp.projectId);
                      if (ownerProject) {
                        if (ownerProject.hlCategories) setHlCategories(ownerProject.hlCategories);
                        if (ownerProject.researchGoal) setResearchGoal(ownerProject.researchGoal);
                      }
                      // Load own decisions for this project
                      const myDecisions = await fsGetDecisions(userId, sp.projectId);
                      setDecisions(myDecisions);
                      localStorage.setItem(STORAGE_KEY, JSON.stringify(myDecisions));
                      // Load shared AI scores
                      const scores = await fsGetAIScores(sp.projectId);
                      setAiScores(scores);
                      setAppView('screener');
                    } catch (err) {
                      console.warn('[Sharing] Failed to load shared project:', err.message);
                    }
                  }}
                >
                  <span className="project-item-icon">📄</span>
                  <div className="project-item-info">
                    <span className="project-item-name">
                      {sp.projectName}
                      <span className="project-shared-badge">Shared with me</span>
                    </span>
                    <span className="project-item-meta">
                      by {sp.ownerEmail} · {sp.role}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="project-sidebar-footer">
          <button className="project-new-btn" onClick={() => {
            setProjectSidebarOpen(false);
            setAppView('setup');
            localStorage.removeItem('slr-screener-has-data');
          }}>
            + New Project
          </button>
        </div>
      </div>
      {projectSidebarOpen && <div className="sidebar-overlay" onClick={() => { setProjectSidebarOpen(false); setProjectMenuOpen(false); }} />}

      {/* Share Project Modal */}
      {shareModalOpen && (
        <>
          <div className="share-modal-overlay" onClick={() => setShareModalOpen(false)} />
          <div className="share-modal">
            <div className="share-modal-header">
              <h3>Share "{projectName}"</h3>
              <button className="sidebar-close" onClick={() => setShareModalOpen(false)}>&times;</button>
            </div>
            <div className="share-modal-body">
              <div className="share-input-row">
                <input
                  type="email"
                  className="share-email-input"
                  placeholder="Email address"
                  value={shareEmail}
                  onChange={(e) => { setShareEmail(e.target.value); setShareError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendInvite(); }}
                />
                <select
                  className="share-role-select"
                  value={shareRole}
                  onChange={(e) => setShareRole(e.target.value)}
                >
                  <option value="annotator">Annotator</option>
                  <option value="viewer">Viewer</option>
                </select>
                <button
                  className="share-invite-btn"
                  onClick={handleSendInvite}
                  disabled={shareLoading}
                >
                  {shareLoading ? 'Sending...' : 'Send Invite'}
                </button>
              </div>
              {shareError && <div className="share-error">{shareError}</div>}

              <div className="share-collaborator-list">
                {/* Owner row */}
                <div className="share-collaborator-row">
                  <span className="share-collab-email">{currentUser?.email}</span>
                  <span className="share-role-badge owner">Owner</span>
                  <span className="share-status-badge accepted">You</span>
                </div>
                {/* Collaborator rows */}
                {(collaborators || []).map(c => (
                  <div key={c.email} className="share-collaborator-row">
                    <span className="share-collab-email">{c.email}</span>
                    <select
                      className="share-role-inline"
                      value={c.role}
                      onChange={(e) => handleRoleChange(c.email, e.target.value)}
                    >
                      <option value="annotator">Annotator</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <span className={`share-status-badge ${c.status}`}>{c.status}</span>
                    <button
                      className="share-remove-btn"
                      onClick={() => handleRemoveCollaborator(c.email)}
                      title="Remove collaborator"
                    >&times;</button>
                  </div>
                ))}
                {(!collaborators || collaborators.length === 0) && (
                  <div className="share-empty">No collaborators yet. Invite someone above.</div>
                )}
              </div>

              <div className="share-info">
                Collaborators with matching email will see this project when they sign in. Annotators' decisions are stored separately to prevent bias.
              </div>
            </div>
          </div>
        </>
      )}

      {/* Highlight Settings Panel */}
      {hlSettingsOpen && (
        <>
          <div className="sidebar-overlay" onClick={() => setHlSettingsOpen(false)} />
          <div className="hl-settings-panel">
            <div className="hl-settings-header">
              <h3>Highlight Settings</h3>
              <button className="sidebar-close" onClick={() => setHlSettingsOpen(false)}>&times;</button>
            </div>

            <div className="hl-settings-body">
              <div className="hl-settings-section">
                <label className="hl-settings-label">Research Goal</label>
                <textarea
                  className="hl-goal-input"
                  value={goalDraft}
                  onChange={(e) => setGoalDraft(e.target.value)}
                  rows={3}
                />
                <button
                  className={`hl-suggest-btn ${!apiKey ? 'disabled' : ''}`}
                  onClick={() => apiKey && suggestKeywords(goalDraft)}
                  disabled={suggestingKeywords || !apiKey}
                >
                  {suggestingKeywords ? 'Suggesting...' : 'Suggest Keywords'}
                </button>
                {!apiKey && <span className="hl-hint">Set API key first (use Score Papers button)</span>}
              </div>

              <div className="hl-settings-section">
                <label className="hl-settings-label">Keyword Categories</label>
                {hlDraft && hlDraft.map((cat, i) => (
                  <div key={i} className="hl-cat-row" style={{ borderLeftColor: cat.color }}>
                    <div className="hl-cat-row-top">
                      <input
                        className="hl-cat-name"
                        value={cat.name}
                        onChange={(e) => {
                          const next = [...hlDraft];
                          next[i] = { ...next[i], name: e.target.value };
                          setHlDraft(next);
                        }}
                        placeholder="Category name"
                      />
                      <div className="hl-color-picks">
                        {PRESET_COLORS.map((pc, ci) => (
                          <span
                            key={ci}
                            className={`hl-color-dot ${cat.color === pc.bg ? 'active' : ''}`}
                            style={{ background: pc.bg, color: pc.text }}
                            onClick={() => {
                              const next = [...hlDraft];
                              next[i] = { ...next[i], color: pc.bg, textColor: pc.text };
                              setHlDraft(next);
                            }}
                          />
                        ))}
                      </div>
                      <button
                        className="hl-cat-delete"
                        onClick={() => setHlDraft(hlDraft.filter((_, j) => j !== i))}
                      >
                        &times;
                      </button>
                    </div>
                    <textarea
                      className="hl-cat-keywords"
                      value={cat.keywords}
                      onChange={(e) => {
                        const next = [...hlDraft];
                        next[i] = { ...next[i], keywords: e.target.value };
                        setHlDraft(next);
                      }}
                      rows={2}
                      placeholder="keyword1, keyword2, multi-word phrase, ..."
                    />
                  </div>
                ))}
                <button
                  className="hl-add-cat-btn"
                  onClick={() => {
                    const idx = hlDraft ? hlDraft.length : 0;
                    const pc = PRESET_COLORS[idx % PRESET_COLORS.length];
                    setHlDraft([...(hlDraft || []), { name: '', color: pc.bg, textColor: pc.text, cls: `hl-cat-${idx}`, keywords: '' }]);
                  }}
                >
                  + Add Category
                </button>
              </div>
            </div>

            <div className="hl-settings-footer">
              <button className="save-btn" onClick={saveHlSettings}>Save & Apply</button>
              <button className="cancel-btn" onClick={() => setHlSettingsOpen(false)}>Cancel</button>
            </div>
          </div>
        </>
      )}

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
