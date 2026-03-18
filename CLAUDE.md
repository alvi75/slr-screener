# SLR Paper Screening Platform

## What This Is

A React-based web app for systematic literature review (SLR) paper screening. Built for a mining study investigating AI/ML model sizes used in software engineering research papers published in 2025 top venues (ICSE, FSE, ASE, TOSEM, TSE). The platform allows researchers to efficiently triage 1100+ papers with keyword-highlighted abstracts and export decisions as CSV.

Built for **Prof. Antonio Mastropaolo** at **William & Mary's AURA Lab**. The platform will eventually be deployed as a reusable module for students running SLRs.

## Tech Stack

- **React** (Create React App) — single-page app
- **Express** — lightweight proxy server for Claude API calls (`server.js` on port 3001)
- **Pure CSS** — no UI framework, custom styles in `App.css`
- **localStorage** — auto-save decisions, edited abstracts, AI scores, API key, highlight toggle
- **CSV export** — client-side generation via Blob API

## Data File

`public/enriched_papers_2025.json` — 1100 papers with 1086 abstracts collected via OpenAlex + CrossRef + Semantic Scholar + arXiv pipeline. Metadata wrapper:

```json
{
  "metadata": { "total_papers": 1100, "source": "...", "enriched_date": "..." },
  "papers": [
    {
      "conf": "ICSE 2025",
      "title": "Paper Title",
      "author": "Author Names",
      "abstract": "Abstract text (may contain HTML/XML tags, stripped at display)",
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

Fields `abstract`, `doi`, `doi_url`, `openalex_id`, `arxiv_id`, `pdf_url`, `pdf_source` are optional — not all papers have them.

## Current Features

### Paper Display & Navigation
- **Paper card**: Shows one paper at a time with title, authors, venue badge (color-coded by conference), and abstract
- **Paper links**: Clickable PDF, Publisher (DOI), Google Scholar, and arXiv buttons when available
- **Venue filtering**: Filter papers by ICSE 2025, FSE 2025, ASE 2025, TOSEM 2025, TSE 2025
- **Runtime JSON loading**: Papers loaded at runtime with cache-busting (`?t=Date.now()`). "Reload Data" button to refresh without page reload
- **Position persistence**: Current paper index, venue filter, and all settings restored from localStorage on refresh

### Abstract Display
- **Keyword highlighting**: Toggleable via "Highlights" button (or `H` key). Uses 3 color categories with hover tooltips showing match type and matched term (see below)
- **Pattern-based highlighting**: Second-pass regex rules detect model sizes (7B, 13B), model variants (Llama-instruct), version patterns (GPT-3.5), numeric context (100 tokens), and action phrases (fine-tuned on)
- **HTML/LaTeX cleanup**: Strips XML/HTML tags, converts LaTeX math delimiters, Greek letters to Unicode, formatting commands, superscripts/subscripts, and cleans up artifacts
- **Inline abstract editing**: Edit button to paste missing abstracts manually; saved to localStorage. Edited abstracts are used for AI scoring
- **Google Scholar link**: Papers with missing/not_found abstracts show a warning with a search link

### Triage & Decisions
- **Triage buttons**: Yes / No / Maybe with visual feedback (current decision highlighted)
- **Auto-advance**: Moves to next paper after a new decision; stays on current paper when changing an existing decision
- **Undo**: Press `U` or click Undo to revert the last decision (50-deep stack with position restore)
- **Keyboard shortcuts**: `Y` Yes, `N` No, `M` Maybe, `U` Undo, `H` Toggle highlights, `←` Previous, `→` Next
- **Decision Log sidebar**: Toggleable panel showing all decided papers with search, filter tabs (All/Yes/No/Maybe with counts), and click-to-jump navigation
- **Reset All Decisions**: Button in Decision Log sidebar footer to clear all triage data

### AI Scoring (Optional)
- **Claude API integration**: Scores each abstract 0–100 for relevance with a Yes/No/Maybe suggestion and one-sentence explanation. Uses Claude Sonnet via Express proxy server. Batched in groups of 5 with `Promise.allSettled`
- **AI score badge**: Shown on paper card meta row, color-coded (green ≥70, yellow ≥40, red <40) with hover tooltip showing suggestion
- **AI suggestion glow**: Decision buttons get a subtle purple glow when they match the AI suggestion
- **AI Insights sidebar**: Toggleable panel showing the current paper's score, suggestion, and reason, plus a sorted list of all scored papers (highest first) with click-to-jump
- **Sort by Score toggle**: When AI scores exist, papers can be sorted by relevance score instead of default order
- **API key management**: Stored in localStorage, configurable via modal. Proxy health check before scoring starts

### Export & Progress
- **CSV export**: Downloads `slr_triage_results.csv` with columns: conf, title, author, decision, ai_score, ai_suggestion, ai_reason, abstract, doi, pdf_url, arxiv_id
- **Progress bar**: Segmented bar showing Yes (green), Maybe (yellow), No (red) counts with remaining count
- **Auto-save**: Decisions, edited abstracts, AI scores, highlight toggle, and venue filter persist in localStorage

## Keyword Highlight Categories (3-color system)

Highlights are toggled on/off via the "Highlights" button or `H` key. Hovering any highlighted word shows a tooltip with category and matched term.

| Category | Color | Includes |
|----------|-------|----------|
| **Model info** | Blue (`hl-model`) | Model names (LLM, GPT-4, CodeLlama, ChatGPT, transformer), model details (parameter, fine-tuning, LoRA, quantization), size patterns (7B, 70B), model variants, version patterns, numeric context |
| **SE tasks** | Green (`hl-task`) | code generation, vulnerability detection, code review, program repair, test generation, code completion, defect prediction |
| **Methods** | Purple (`hl-method`) | training, inference, benchmark, dataset, deep learning, neural network, machine learning, action phrases (fine-tuned on, trained on, evaluated on) |

Keywords use `\b` word boundaries to prevent partial-word matches. Longer phrases match first.

## Project Structure

```
slr-screener/
├── public/
│   ├── enriched_papers_2025.json   # Paper data (1100 papers, 1086 abstracts)
│   ├── favicon.svg                 # Document + checkmark icon
│   └── index.html
├── src/
│   ├── App.js                      # Main app component (all logic)
│   ├── App.css                     # All styles
│   ├── index.js                    # Entry point
│   └── index.css                   # Base/reset styles
├── server.js                       # Express proxy for Claude API (port 3001)
└── CLAUDE.md
```

## Running

```bash
npm start        # React dev server at http://localhost:3000
npm run proxy    # Claude API proxy at http://localhost:3001 (run in separate terminal)
npm run build    # Production build
```

The proxy server (`server.js`) must be running for AI scoring to work. It forwards requests to `api.anthropic.com` with the user's API key.

## Planned Features

- Dynamic editable keyword lists (add/remove/edit highlight terms without code changes)
- Settings panel for customizing highlight colors and categories
- Multi-reviewer support with conflict resolution
- Deployment as a reusable module for other SLR projects
