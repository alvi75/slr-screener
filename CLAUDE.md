# SLR Paper Screening Platform

## What This Is

A React-based web app for systematic literature review (SLR) paper screening. Built for a mining study investigating AI/ML model sizes used in software engineering research papers published in 2025 top venues (ICSE, FSE, ASE, TOSEM, TSE). The platform allows researchers to efficiently triage 1100+ papers with keyword-highlighted abstracts and export decisions as CSV.

Built for **Prof. Antonio Mastropaolo** at **William & Mary's AURA Lab**. The platform will eventually be deployed as a reusable module for students running SLRs.

## Tech Stack

- **React** (Create React App) — single-page app
- **Pure CSS** — no UI framework, custom styles in `App.css`
- **localStorage** — auto-save decisions and edited abstracts
- **CSV export** — client-side generation via Blob API

## Data File

`public/enriched_papers_2025.json` — source data with metadata wrapper:

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

- **Paper display**: Shows one paper at a time with title, authors, venue badge (color-coded), and abstract
- **Keyword highlighting**: Abstract text is highlighted in 4 color categories (see below)
- **HTML cleanup**: XML/HTML tags (e.g., `<tex>`, `<italic>`, `xmlns:mml=...`) are stripped from abstracts
- **Triage buttons**: Yes / No / Maybe with visual feedback (current decision highlighted)
- **Auto-advance**: Moves to next paper after a new decision; stays on current paper when changing an existing decision
- **Undo**: Press `U` or click Undo to revert the last decision (50-deep stack)
- **Venue filtering**: Filter papers by ICSE 2025, FSE 2025, ASE 2025, TOSEM 2025, TSE 2025
- **Decision Log sidebar**: Toggleable panel showing all decided papers with search, filter tabs (All/Yes/No/Maybe with counts), and click-to-jump navigation
- **Reset All Decisions**: Button in sidebar footer to clear all triage data from localStorage
- **CSV export**: Downloads `slr_triage_results.csv` with columns: conf, title, author, decision, abstract, doi, pdf_url, arxiv_id
- **Auto-save**: Decisions and edited abstracts persist in localStorage across browser sessions
- **Keyboard shortcuts**: `Y` Yes, `N` No, `M` Maybe, `U` Undo, `←` Previous, `→` Next
- **Inline abstract editing**: Edit button to paste missing abstracts manually; saved to localStorage
- **Google Scholar link**: Papers with missing/not_found abstracts show a warning with a search link
- **Paper links**: Clickable PDF, DOI, arXiv, and OpenAlex links when available
- **Progress bar**: Segmented bar showing Yes (green), Maybe (yellow), No (red) counts

## Keyword Highlight Categories

| Category | Color | Examples |
|----------|-------|---------|
| **Model names** | Orange | LLM, GPT-4, CodeLlama, CodeBERT, StarCoder, DeepSeek, Copilot, ChatGPT, transformer |
| **Model details** | Blue | parameter, billion, 7B, 13B, fine-tuning, pre-trained, quantization, LoRA, QLoRA, PEFT |
| **SE tasks** | Green | code generation, vulnerability detection, code review, program repair, test generation |
| **Methods** | Purple | training, inference, benchmark, dataset, deep learning, neural network, machine learning |

Keywords are matched case-insensitively. Longer phrases match first to avoid partial highlights.

## Project Structure

```
slr-screener/
├── public/
│   ├── enriched_papers_2025.json   # Paper data (1100 papers)
│   ├── favicon.svg                 # Document + checkmark icon
│   └── index.html
├── src/
│   ├── App.js                      # Main app component (all logic)
│   ├── App.css                     # All styles
│   ├── index.js                    # Entry point
│   └── index.css                   # Base/reset styles
└── CLAUDE.md
```

## Running

```bash
npm start        # Dev server at http://localhost:3000
npm run build    # Production build
```

## Planned Features

- Dynamic editable keyword lists (add/remove/edit highlight terms without code changes)
- Settings panel for customizing highlight colors and categories
- Multi-reviewer support with conflict resolution
- Deployment as a reusable module for other SLR projects
