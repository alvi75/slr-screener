import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
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
function SetupView({ onImport, onLoadDemo, apiKey, setApiKey }) {
  const [activeMethod, setActiveMethod] = useState(null); // 'csv' | 'json' | 'titles' | 'pdf'

  // CSV/Excel state
  const [csvRows, setCsvRows] = useState(null);
  const [csvHeaders, setCsvHeaders] = useState([]);
  const [csvMapping, setCsvMapping] = useState({});
  const [csvFileName, setCsvFileName] = useState('');

  // JSON state
  const [jsonPapers, setJsonPapers] = useState(null);
  const [jsonFileName, setJsonFileName] = useState('');
  const [jsonNoVenue, setJsonNoVenue] = useState(false);
  const [jsonDefaultVenue, setJsonDefaultVenue] = useState('');

  // Paste titles state
  const [titleText, setTitleText] = useState('');
  const [titleResults, setTitleResults] = useState(null);
  const [titleFetching, setTitleFetching] = useState(false);
  const [titleProgress, setTitleProgress] = useState({ done: 0, total: 0 });

  // PDF state
  const [pdfFiles, setPdfFiles] = useState([]);
  const [pdfResults, setPdfResults] = useState([]);
  const [pdfProcessing, setPdfProcessing] = useState(false);

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
    onImport(papers);
  }, [csvRows, csvMapping, onImport]);

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
  const fetchTitles = useCallback(async () => {
    const lines = titleText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) { alert('Paste at least one title.'); return; }
    setTitleFetching(true);
    setTitleProgress({ done: 0, total: lines.length });
    const results = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        const res = await fetch(S2_PROXY + '/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: lines[i] }),
        });
        const data = await res.json();
        results.push({ ...data, originalTitle: lines[i] });
      } catch (err) {
        results.push({ found: false, originalTitle: lines[i], error: err.message });
      }
      setTitleProgress({ done: i + 1, total: lines.length });
      if (i < lines.length - 1) await new Promise(r => setTimeout(r, 200)); // small delay for UI
    }
    setTitleResults(results);
    setTitleFetching(false);
  }, [titleText]);

  const importTitles = useCallback(() => {
    if (!titleResults) return;
    const papers = titleResults.filter(r => r.found).map(r => normalizePaper({
      title: r.title, author: r.author, abstract: r.abstract,
      conf: r.venue ? `${r.venue} ${r.year || ''}`.trim() : '',
      doi: r.doi, arxiv_id: r.arxiv_id,
    }));
    if (papers.length === 0) { alert('No papers were found.'); return; }
    onImport(papers);
  }, [titleResults, onImport]);

  // === PDF handler ===
  const handlePdfFiles = useCallback(async (files) => {
    setPdfProcessing(true);
    const results = [];
    for (const file of files) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdfjsLib = await import('pdfjs-dist/build/pdf');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '';
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;
        let fullText = '';
        for (let p = 1; p <= Math.min(pdf.numPages, 5); p++) { // first 5 pages
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          fullText += content.items.map(i => i.str).join(' ') + '\n';
        }
        results.push({ name: file.name, text: fullText.trim(), title: file.name.replace(/\.pdf$/i, ''), extracted: false });
      } catch (err) {
        results.push({ name: file.name, text: '', title: file.name.replace(/\.pdf$/i, ''), error: err.message, extracted: false });
      }
    }
    setPdfResults(results);
    setPdfProcessing(false);
  }, []);

  const extractWithAI = useCallback(async (idx) => {
    if (!apiKey) { alert('Set your API key first.'); return; }
    const item = pdfResults[idx];
    try {
      const res = await fetch('http://localhost:3001/api/score', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          messages: [{
            role: 'user',
            content: `Extract the paper metadata from this text. Return JSON only:\n{"title": "...", "authors": "...", "abstract": "..."}\n\nText:\n${item.text.slice(0, 3000)}`
          }],
        }),
      });
      const data = await res.json();
      const text = data.content?.[0]?.text || '';
      const jsonStr = text.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
      const parsed = JSON.parse(jsonStr);
      const updated = [...pdfResults];
      updated[idx] = { ...updated[idx], title: parsed.title || item.title, author: parsed.authors || '', abstract: parsed.abstract || '', extracted: true };
      setPdfResults(updated);
    } catch (err) {
      alert('AI extraction failed: ' + err.message);
    }
  }, [apiKey, pdfResults]);

  const importPdfs = useCallback(() => {
    const papers = pdfResults.map(r => normalizePaper({
      title: r.title, author: r.author || '', abstract: r.abstract || r.text.slice(0, 1000),
    })).filter(p => p.title);
    if (papers.length === 0) { alert('No papers to import.'); return; }
    onImport(papers);
  }, [pdfResults, onImport]);

  // Drag-and-drop
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const files = Array.from(e.dataTransfer.files);
    if (activeMethod === 'pdf') {
      const pdfs = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
      if (pdfs.length > 0) { setPdfFiles(pdfs); handlePdfFiles(pdfs); }
    }
  }, [activeMethod, handlePdfFiles]);

  const methods = [
    { id: 'csv', icon: '📊', title: 'Upload CSV / Excel', desc: 'Import a spreadsheet with paper titles, authors, abstracts. We\'ll auto-detect your columns.', primary: true },
    { id: 'json', icon: '{ }', title: 'Upload JSON', desc: 'Already have structured data? Drop your JSON file here.' },
    { id: 'titles', icon: '📝', title: 'Paste Titles', desc: 'Paste paper titles and we\'ll fetch abstracts, authors, and DOIs from Semantic Scholar.' },
    { id: 'pdf', icon: '📄', title: 'Upload PDFs', desc: 'Drop PDF files and extract metadata. Works best with an API key for AI extraction.' },
  ];

  return (
    <div className="setup-view">
      <div className="setup-header">
        <h1><span className="logo-bold">SLR</span> <span className="logo-light">Screener</span></h1>
        <p className="setup-subtitle">Import your papers to begin screening</p>
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
          <div className="setup-footer">
            <button className="setup-demo-link" onClick={onLoadDemo}>
              or use the built-in demo dataset (1,100 SE papers)
            </button>
          </div>
        </>
      ) : (
        <div className="setup-workflow">
          <button className="setup-back" onClick={() => setActiveMethod(null)}>&larr; Back to options</button>

          {/* === CSV/Excel Workflow === */}
          {activeMethod === 'csv' && (
            <div className="setup-panel">
              <h2>📊 Upload CSV / Excel</h2>
              {!csvRows ? (
                <div className="upload-zone" onClick={() => document.getElementById('csv-input').click()}>
                  <input id="csv-input" type="file" accept=".csv,.xlsx,.xls,.tsv" style={{ display: 'none' }}
                    onChange={(e) => e.target.files[0] && handleCsvFile(e.target.files[0])} />
                  <span className="upload-zone-icon">📁</span>
                  <span className="upload-zone-text">Click to select or drag a CSV/Excel file</span>
                  <span className="upload-zone-hint">Supports .csv, .xlsx, .xls, .tsv</span>
                </div>
              ) : (
                <>
                  <div className="setup-file-info">
                    <strong>{csvFileName}</strong> — {csvRows.length} rows, {csvHeaders.length} columns
                  </div>
                  <h3>Column Mapping</h3>
                  <p className="setup-hint">We auto-detected some columns. Verify and adjust the mapping below.</p>
                  <div className="column-mapping">
                    {csvHeaders.map((h) => (
                      <div key={h} className="column-mapping-row">
                        <span className="column-header">{h}</span>
                        <span className="column-arrow">→</span>
                        <select className="column-select" value={csvMapping[h] || '(skip)'}
                          onChange={(e) => setCsvMapping(prev => ({ ...prev, [h]: e.target.value }))}>
                          {SCHEMA_FIELDS.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                        <span className="column-preview">{String(csvRows[0]?.[h] || '').slice(0, 50)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="setup-actions">
                    <button className="save-btn" onClick={importCsv}>Import {csvRows.length} Papers</button>
                    <button className="cancel-btn" onClick={() => { setCsvRows(null); setCsvHeaders([]); setCsvMapping({}); }}>Choose Different File</button>
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
                      onImport(toImport);
                    }}>Import {jsonPapers.length} Papers</button>
                    <button className="cancel-btn" onClick={() => { setJsonPapers(null); setJsonNoVenue(false); }}>Choose Different File</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* === Paste Titles Workflow === */}
          {activeMethod === 'titles' && (
            <div className="setup-panel">
              <h2>📝 Paste Titles</h2>
              <p className="setup-hint">Paste paper titles (one per line). We'll look up each title on Semantic Scholar to fetch abstracts, authors, and DOIs.</p>
              {!titleResults ? (
                <>
                  <textarea className="paste-area" value={titleText} onChange={(e) => setTitleText(e.target.value)}
                    placeholder={"Attention Is All You Need\nBERT: Pre-training of Deep Bidirectional Transformers\nCodeBERT: A Pre-Trained Model for Programming"} rows={10} />
                  <div className="setup-hint" style={{ marginBottom: 12 }}>
                    {titleText.split('\n').filter(l => l.trim()).length} title(s) entered
                  </div>
                  {titleFetching && (
                    <div className="title-progress">
                      <div className="title-progress-bar">
                        <div className="title-progress-fill" style={{ width: `${(titleProgress.done / titleProgress.total) * 100}%` }} />
                      </div>
                      <span className="title-progress-text">Fetching {titleProgress.done}/{titleProgress.total}...</span>
                    </div>
                  )}
                  <div className="setup-actions">
                    <button className="save-btn" onClick={fetchTitles} disabled={titleFetching || !titleText.trim()}>
                      {titleFetching ? `Fetching ${titleProgress.done}/${titleProgress.total}...` : 'Fetch Metadata'}
                    </button>
                  </div>
                  <p className="setup-hint" style={{ marginTop: 8, fontSize: 11 }}>
                    Note: Requires the proxy server (node server.js) to be running. Rate limited to ~1 req/sec.
                  </p>
                </>
              ) : (
                <>
                  <div className="setup-file-info">
                    Found {titleResults.filter(r => r.found).length} of {titleResults.length} titles
                  </div>
                  <div className="preview-table">
                    <div className="preview-header">
                      <span>Title</span><span>Status</span><span>Authors</span>
                    </div>
                    {titleResults.map((r, i) => (
                      <div key={i} className={`preview-row ${r.found ? '' : 'not-found'}`}>
                        <span>{(r.found ? r.title : r.originalTitle).slice(0, 50)}...</span>
                        <span>{r.found ? '✓ Found' : '✗ Not found'}</span>
                        <span>{r.found ? (r.author || '').slice(0, 30) : '—'}</span>
                      </div>
                    ))}
                  </div>
                  <div className="setup-actions">
                    <button className="save-btn" onClick={importTitles}>
                      Import {titleResults.filter(r => r.found).length} Papers
                    </button>
                    <button className="cancel-btn" onClick={() => setTitleResults(null)}>Edit Titles</button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* === PDF Workflow === */}
          {activeMethod === 'pdf' && (
            <div className="setup-panel">
              <h2>📄 Upload PDFs</h2>
              {pdfResults.length === 0 ? (
                <div className="upload-zone" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}
                  onClick={() => document.getElementById('pdf-input').click()}>
                  <input id="pdf-input" type="file" accept=".pdf" multiple style={{ display: 'none' }}
                    onChange={(e) => { const files = Array.from(e.target.files); setPdfFiles(files); handlePdfFiles(files); }} />
                  <span className="upload-zone-icon">📄</span>
                  <span className="upload-zone-text">{pdfProcessing ? 'Processing...' : 'Click or drag PDF files here'}</span>
                  <span className="upload-zone-hint">Multiple files supported. Text extracted from first 5 pages.</span>
                </div>
              ) : (
                <>
                  <div className="setup-file-info">
                    {pdfResults.length} PDF(s) processed
                  </div>
                  <div className="preview-table">
                    <div className="preview-header">
                      <span>File</span><span>Title</span><span>Abstract</span><span>AI</span>
                    </div>
                    {pdfResults.map((r, i) => (
                      <div key={i} className="preview-row">
                        <span>{r.name.slice(0, 20)}</span>
                        <span>{r.title.slice(0, 30)}</span>
                        <span>{(r.abstract || r.text || '').slice(0, 30)}...</span>
                        <span>
                          {r.extracted ? '✓' : (
                            <button className="setup-mini-btn" onClick={() => extractWithAI(i)}
                              disabled={!apiKey}>Extract</button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                  {!apiKey && (
                    <div className="setup-hint" style={{ marginTop: 8 }}>
                      <strong>Tip:</strong> Set an API key to use AI extraction for better results.
                      <input type="password" placeholder="sk-ant-..." className="setup-inline-key"
                        onKeyDown={(e) => { if (e.key === 'Enter') setApiKey(e.target.value.trim()); }} />
                    </div>
                  )}
                  <div className="setup-actions">
                    <button className="save-btn" onClick={importPdfs}>Import {pdfResults.length} Papers</button>
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

function App() {
  // App view: 'setup' or 'screener'
  const [appView, setAppView] = useState(() => {
    try { return localStorage.getItem('slr-screener-has-data') ? 'screener' : 'setup'; }
    catch { return 'setup'; }
  });

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
  const [sortByScore, setSortByScore] = useState(false);
  const scoringAbortRef = useRef(false);

  console.log('[SLR] Restored state — index:', currentIndex, 'venue:', venueFilter, 'decisions:', Object.keys(decisions).length);

  // Load data from default JSON (used by "Use demo data" and "Reload Data")
  const loadData = useCallback(() => {
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
      });
  }, []);

  // Import papers from Setup page
  const importPapers = useCallback((importedPapers) => {
    setPapers(importedPapers);
    setLoading(false);
    setAppView('screener');
    setIsDemo(false);
    const name = 'Untitled Project';
    setProjectName(name);
    localStorage.setItem('slr-screener-has-data', '1');
    localStorage.setItem('slr-screener-is-demo', '0');
    localStorage.setItem('slr-screener-project-name', name);
    setCurrentIndex(0);
    setDecisions({});
    setAbstractEdits({});
    setAiScores({});
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(SCORES_KEY);
  }, []);

  // On mount: if screener mode, load default data; otherwise stay on setup
  useEffect(() => {
    if (appView === 'screener') loadData();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Save model selection
  useEffect(() => {
    localStorage.setItem(MODEL_KEY, scoringModel);
  }, [scoringModel]);

  // Save project name
  useEffect(() => {
    localStorage.setItem('slr-screener-project-name', projectName);
  }, [projectName]);

  // Save highlight categories
  useEffect(() => {
    localStorage.setItem(HL_CATEGORIES_KEY, JSON.stringify(hlCategories));
  }, [hlCategories]);

  // Save research goal
  useEffect(() => {
    localStorage.setItem(RESEARCH_GOAL_KEY, researchGoal);
  }, [researchGoal]);

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
    }
  }, []);

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
    return <SetupView onImport={importPapers} onLoadDemo={loadData} apiKey={apiKey} setApiKey={setApiKey} />;
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
                </span>
              )}
              <span className="project-item-meta">{totalPapers} papers · {decidedCount} screened</span>
            </div>
            <div className="project-menu-wrap">
              <button className="project-menu-btn" onClick={(e) => { e.stopPropagation(); setProjectMenuOpen(v => !v); }}>⋮</button>
              {projectMenuOpen && (
                <div className="project-menu-dropdown">
                  <button onClick={() => { setProjectMenuOpen(false); setRenamingProject(true); }}>Rename</button>
                  <div className="project-menu-sep" />
                  <button onClick={() => { setProjectMenuOpen(false); exportProjectJSON(); }}>Export JSON</button>
                  <button onClick={() => { setProjectMenuOpen(false); exportProjectCSV(); }}>Export CSV</button>
                  <div className="project-menu-sep" />
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
                        setAppView('setup');
                      }
                    }}>Delete</button>
                  )}
                </div>
              )}
            </div>
          </div>
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
