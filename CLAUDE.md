# SLR Screener

A general-purpose Systematic Literature Review (SLR) paper screening platform. Built for **Prof. Antonio Mastropaolo** at **William & Mary's AURA Lab**. Designed as a reusable, deployable tool for any researcher conducting SLRs.

**GitHub:** https://github.com/alvi75/slr-screener.git

## Tech Stack

- **React** (Create React App) — single-page app, all logic in `src/App.js`
- **Pure CSS** — no UI framework, custom styles in `src/App.css`
- **localStorage** — persistence for decisions, scores, edits, API key, highlights, filters, project state
- **Express** — lightweight proxy server (`server.js` on port 3001) for Claude API and Semantic Scholar API calls
- **SheetJS (`xlsx`)** — CSV/Excel parsing for spreadsheet imports
- **pdfjs-dist** — client-side PDF text extraction

## Data

Default demo dataset: `public/enriched_papers_2025.json` — 1100 papers, 1092 abstracts from 5 SE venues (ICSE, FSE, ASE, TOSEM, TSE 2025). Collected via OpenAlex, CrossRef, Semantic Scholar, arXiv, and DBLP APIs.

```json
{
  "metadata": { "total_papers": 1100, "source": "...", "enriched_date": "..." },
  "papers": [
    {
      "conf": "ICSE 2025",
      "title": "Paper Title",
      "author": "Author Names",
      "abstract": "Abstract text",
      "doi": "10.1109/...",
      "doi_url": "https://doi.org/...",
      "openalex_id": "https://openalex.org/W...",
      "arxiv_id": "2404.10362",
      "pdf_url": "https://arxiv.org/pdf/...",
      "pdf_source": "arxiv"
    }
  ]
}
```

All fields except `title` are optional. Missing fields are normalized to `"not_found"` by `normalizePaper()`.

## Features

### Multi-Format Data Import (Setup Page)

Four import methods, each with project name field:

- **Upload CSV/Excel** — auto-detects columns, field-centric mapping UI (title, author, abstract, venue, DOI, arXiv ID), preview table of first 5 rows, info note about optional fields
- **Upload JSON** — accepts array or `{ "papers": [...] }` format, venue detection with default venue prompt, format examples shown
- **Add Papers Manually** — form-based entry with repeatable paper cards (title, venue, DOI, arXiv ID, abstract), "Fetch Missing Info" via Semantic Scholar API, rate-limited 1 req/sec
- **Upload PDFs** — drag-and-drop, extracts text from first 2 pages, auto AI extraction with Claude Haiku (title, authors, abstract), default venue field, editable results with status cards (processing/done/failed), API key field

All imports normalize to standardized JSON format via `normalizePaper()`.

### Project Management

- **Project sidebar** — hamburger menu (☰), lists current project with paper/screened counts
- **Three-dot menu (⋮)** — Rename, Add Papers, Export JSON, Export CSV, Duplicate, Delete
- **Add Papers** — opens import page in append mode with banner "Adding papers to: [Project Name]", deduplicates by title (case-insensitive), shows result notification with counts
- **Export JSON** — standardized format matching `enriched_papers_2025.json` schema
- **Export CSV** — includes all triage data (decisions, AI scores, suggestions, reasons)
- **Demo badge** — shown for built-in dataset, demo projects cannot be deleted

### Paper Screening

- **Paper card** — one paper at a time with title, authors, venue badge (color-coded), and abstract
- **Triage buttons** — Yes / No / Maybe with visual feedback (current decision highlighted)
- **Auto-advance** — moves to next paper after new decision; stays when changing existing decision
- **Undo** — `U` key or button, 50-deep stack with position restore
- **Keyboard shortcuts** — `Y` Yes, `N` No, `M` Maybe, `U` Undo, `H` Toggle highlights, `←` Previous, `→` Next

### Venue Filtering

- Pill-style tabs for each venue (e.g., ICSE 2025, FSE 2025, ASE 2025, TOSEM 2025, TSE 2025)
- "All" tab shows every paper
- Dynamic venues derived from imported data

### Keyword Highlighting

Three merged categories, toggleable via "Highlights" button or `H` key:

| Category | Color | Examples |
|----------|-------|---------|
| **Model info** | Blue | LLM, GPT-4, CodeLlama, ChatGPT, transformer, parameter, fine-tuning, LoRA, quantization, 7B, 70B |
| **SE tasks** | Green | code generation, vulnerability detection, code review, program repair, test generation, defect prediction |
| **Methods** | Purple | training, inference, benchmark, dataset, deep learning, neural network, machine learning |

- **Highlight Settings** — inline gear icon (⚙) opens panel for dynamic keyword configuration (add/remove/edit categories, change colors, edit keyword lists)
- **Pattern-based highlighting** — second-pass regex for model sizes (7B, 13B), model variants (Llama-instruct), version patterns (GPT-3.5), numeric context (100 tokens), action phrases (fine-tuned on)
- **Hover tooltips** — each highlighted word shows category and matched term via `data-tip` attribute
- Keywords use `\b` word boundaries; longer phrases match first

### AI Scoring (Optional)

- **Claude API integration** — scores each abstract 0–100 for relevance with Yes/No/Maybe suggestion and one-sentence explanation
- **Model selector** — Claude Haiku 4.5, Sonnet 4.6, Opus 4.6 (configurable in AI Insights sidebar)
- **Research goal** — customizable prompt that drives scoring relevance
- **Batch scoring** — batched in groups of 5 with `Promise.allSettled`, stoppable mid-run
- **Per-paper rescoring** — clickable AI badge to rescore individual papers
- **AI score badge** — color-coded (green ≥70, yellow ≥40, red <40) with hover tooltip
- **AI suggestion glow** — decision buttons get subtle purple glow when matching AI suggestion
- **Sort by Score** — toggle to sort papers by relevance score instead of default order
- **API key management** — stored in localStorage, configurable via modal, proxy health check before scoring

### AI Insights Sidebar

- Model selector dropdown
- Current paper's score, suggestion, and reason
- Suggested Yes/Maybe/No tabs with paper lists
- Clear errors and reset scores buttons
- Click-to-jump navigation

### Decision Log Sidebar

- Searchable by title
- Filterable by decision (All/Yes/No/Maybe with counts)
- Click-to-jump navigation
- Reset All Decisions button in footer

### Paper Links

- **PDF** (green) — direct PDF link when available
- **Publisher/DOI** (blue) — links to DOI URL
- **Google Scholar** (orange) — search by title
- **arXiv** (red) — links to arXiv page when arXiv ID available

### Abstract Display

- **Inline editing** — edit button to paste missing abstracts, saved to localStorage
- **Google Scholar link** — shown for papers with missing/not_found abstracts
- **LaTeX/HTML cleanup** — strips XML/HTML tags, converts LaTeX math delimiters, Greek letters to Unicode, formatting commands, superscripts/subscripts

### Export & Progress

- **CSV export** — downloads with columns: conf, title, author, decision, ai_score, ai_suggestion, ai_reason, abstract, doi, pdf_url, arxiv_id
- **Progress bar** — segmented bar showing Yes (green), Maybe (yellow), No (red) counts with remaining
- **Auto-save** — all state persists in localStorage

## Project Structure

```
slr-screener/
├── public/
│   ├── enriched_papers_2025.json   # Demo data (1100 papers, 1092 abstracts)
│   ├── favicon.svg                 # Blue "SLR" + green checkmark badge
│   └── index.html
├── src/
│   ├── App.js                      # All application logic (single component)
│   ├── App.css                     # All styles (~1600 lines)
│   ├── index.js                    # Entry point
│   └── index.css                   # Base/reset styles
├── server.js                       # Express proxy (Claude API + Semantic Scholar)
├── package.json
└── CLAUDE.md
```

## Running

```bash
npm start        # React dev server at http://localhost:3000
npm run proxy    # Proxy server at http://localhost:3001 (separate terminal)
npm run build    # Production build
```

The proxy server (`server.js`) must be running for AI scoring and Semantic Scholar lookups. It proxies:
- `POST /api/score` — Claude API (`api.anthropic.com/v1/messages`)
- `POST /api/semantic-scholar/search` — single title lookup
- `POST /api/semantic-scholar/batch` — batch title lookup with 1s rate limiting
- `GET /api/health` — health check

## Planned Features

- Multi-reviewer support with conflict resolution
- Deployment as a reusable module for other SLR projects
