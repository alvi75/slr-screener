# SLR Screener

A general-purpose Systematic Literature Review (SLR) paper screening platform. Built for **Prof. Antonio Mastropaolo** at **William & Mary's AURA Lab**. Designed as a reusable, deployable tool for any researcher conducting SLRs.

**GitHub:** https://github.com/alvi75/slr-screener.git

## Tech Stack

- **React** (Create React App) — single-page app, all logic in `src/App.js`
- **Pure CSS** — no UI framework, custom styles in `src/App.css`
- **Firebase Auth** — Google sign-in and email/password authentication
- **Cloud Firestore** — cloud persistence for projects, decisions, AI scores, and settings
- **localStorage** — local cache layer, dual-write with Firestore for instant reads
- **Express** — lightweight proxy server (`server.js` on port 3001) for Claude API and Semantic Scholar API calls
- **SheetJS (`xlsx`)** — CSV/Excel parsing for spreadsheet imports
- **pdfjs-dist** — client-side PDF text extraction (worker served from `public/pdf.worker.min.js`)
- **Recharts** — pie charts, bar charts, and stacked bars for the team dashboard

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

## Authentication

Firebase Auth with two sign-in methods:

- **Google sign-in** — one-click OAuth, bypasses email verification
- **Email/password** — sign-up with password strength validation (8+ chars, uppercase, lowercase, number, special character), real-time strength indicator (Weak/Medium/Strong), show/hide password toggle
- **Email verification flow** — after sign-up, shows "Check Your Email" screen with:
  - Auto-polling every 5 seconds (calls `reloadUser()` to check verification status)
  - Countdown timer (60s) before resend is available
  - "Use Google sign-in instead" button
  - "Sign out and use a different account" link
- **Auth gating** — login required to access the app; unauthenticated users see LoginPage
- **Header integration** — left side (hamburger + logo + Dashboard button), right side (Reload Data, Score Papers, Export CSV, Decision Log, AI Insights + sync icon + notifications + user avatar + Sign Out). All buttons visible individually. App container max-width 1170px.
- **Forgot password** — "Forgot Password?" link on sign-in form, shows email input + "Send Reset Link" button, uses Firebase `sendPasswordResetEmail()`, success/error messages, "Back to Sign In" link
- **Auth context** (`src/contexts/AuthContext.js`) — provides `currentUser`, `signup`, `login`, `logout`, `googleSignIn`, `resendVerification`, `reloadUser`, `resetPassword`, `loading`

## Database

Dual-write architecture: localStorage (instant cache) + Cloud Firestore (source of truth).

### Firestore Structure

```
users/{userId}/
  projects/{projectId}           # Project metadata and settings
    decisions/{paperId}          # Triage decisions (Yes/No)
    aiDisagreements/{paperId}    # Human-AI disagreement logs

projects/{projectId}/
  meta                           # Owner info for sharing lookup (ownerId, ownerEmail, projectName)
  aiScores/{paperId}             # Shared AI scores (not per-user)
  collaborators/{email}          # Sharing: role, status, invitedBy, invitedAt
  finalDecisions/{paperId}       # Conflict resolution: decision, resolvedBy, resolvedAt, comment
```

### Sync Behavior

- **On app load** — fetches projects, decisions, and AI scores from Firestore; merges with localStorage (Firestore wins on conflicts)
- **On triage decision** — writes to both localStorage and Firestore
- **On settings change** — syncs scoring model, project name, highlight categories, research goal to Firestore
- **Background sync** — fire-and-forget pattern, never blocks the UI
- **Sync indicator in header** — cloud icon: ✓ synced (green), ↻ syncing (blue), ✗ error (red, auto-clears after 10s)
- **Graceful fallback** — if Firestore is unavailable, app continues with localStorage only

### Service Layer (`src/services/firestore.js`)

- **Project CRUD**: `saveProject`, `getProjects`, `getProject`, `deleteProject`
- **Decisions**: `saveDecision`, `deleteDecision`, `getDecisions`, `saveAllDecisions`
- **AI Scores**: `saveAIScore`, `saveAllAIScores`, `getAIScores`
- **Sharing**: `saveProjectMeta`, `getProjectMeta`, `addCollaborator`, `removeCollaborator`, `updateCollaboratorRole`, `getCollaborators`, `acceptInvite`, `declineInvite`, `getSharedProjects`
- **Final Decisions**: `saveFinalDecision`, `getFinalDecisions`, `deleteFinalDecision`
- **AI Disagreements**: `saveAIDisagreement`, `getAIDisagreements`, `deleteAIDisagreement`
- **Sync helpers**: `syncDecisionsToFirestore`, `syncAIScoresToFirestore`, `syncProjectToFirestore` — fire-and-forget wrappers that log warnings but never throw
- Batch writes chunked at 500 (Firestore limit); all writes include `serverTimestamp()`

## Firebase Config

- **Project**: slr-screener
- **Plan**: Spark (free tier)
- **Firestore location**: nam5 (US)
- **Auth providers**: Google + Email/Password
- **Config file**: `src/firebase.js`
- **Hosting**: Firebase Hosting at https://slr-screener.web.app
- **Hosting config**: `firebase.json` (build dir, SPA rewrites), `.firebaserc` (project alias)

## Features

### Home Dashboard

Modern landing page shown on first login (returning users go directly to screener):

- **Branding** — centered "SLR Screener" title with subtitle "What would you like to screen today?"
- **User avatar + Sign Out** — top-right corner
- **Quick action cards**:
  - **New Project** — navigates to the import/setup page
  - **Continue Screening** — shown when active project has unscreened papers, with project name, progress bar, and screened count
- **Recent Projects** — grid of project cards from Firestore, showing name, paper count, date, and badges (Demo, Shared)
- **Navigation** — clicking the "SLR Screener" title in the screening header returns to the dashboard; setup page has "Back to Home" link
- **View state** — `appView` can be `'home'`, `'setup'`, `'screener'`, or `'conflicts'`; initialized from localStorage (`has-data` flag)

### Multi-Format Data Import (Setup Page)

Four import methods, each with project name field:

- **Upload CSV/Excel** — auto-detects columns, field-centric mapping UI (title, author, abstract, venue, DOI, arXiv ID), preview table of first 5 rows, info note about optional fields
- **Upload JSON** — accepts array or `{ "papers": [...] }` format, venue detection with default venue prompt, format examples shown
- **Add Papers Manually** — form-based entry with repeatable paper cards (title, venue, DOI, arXiv ID, abstract), "Fetch Missing Info" via Semantic Scholar API, rate-limited 1 req/sec
- **Upload PDFs** — drag-and-drop, extracts text from first 2 pages, auto AI extraction with Claude Haiku (title, authors, abstract), default venue field, editable results with status cards (processing/done/failed), API key field

All imports normalize to standardized JSON format via `normalizePaper()`.

### Project Management

- **Project sidebar** — hamburger menu (☰), lists current project with paper/screened counts
- **Three-dot menu (⋮)** — Rename, Add Papers, Export JSON, Export CSV, Share Project (owner), Resolve Conflicts (owner, shared), Duplicate, Delete
- **Add Papers** — opens import page in append mode with banner "Adding papers to: [Project Name]", deduplicates by title (case-insensitive), shows result notification with counts
- **Export JSON** — standardized format matching `enriched_papers_2025.json` schema
- **Export CSV** — includes all triage data (decisions, AI scores, suggestions, reasons)
- **Demo badge** — shown for built-in dataset, demo projects cannot be deleted

### Paper Screening

- **Paper card** — one paper at a time with title, authors, venue badge (color-coded), and abstract. Fixed viewport-height layout: title, buttons, and navigation always visible; long abstracts scroll inside the abstract area only
- **Triage buttons** — Two big buttons: Yes (green) / No (red) with visual feedback (current decision highlighted)
- **Auto-advance** — moves to next paper after new decision; stays when changing existing decision
- **Keyboard shortcuts** — `Y` Yes, `N` No, `H` Toggle highlights, `←` Previous, `→` Next

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

- **Claude API integration** — scores each abstract 0–100 for relevance with Yes/No suggestion and one-sentence explanation
- **Model selector** — Claude Haiku 4.5, Sonnet 4.6, Opus 4.6 (configurable in AI Insights sidebar)
- **Research goal** — customizable prompt that drives scoring relevance
- **Batch scoring** — batched in groups of 5 with `Promise.allSettled`, stoppable mid-run
- **Per-paper rescoring** — clickable AI badge to rescore individual papers
- **AI score badge** — color-coded (green ≥70, yellow ≥40, red <40) with hover tooltip
- **AI suggestion glow** — decision buttons get subtle purple glow when matching AI suggestion
- **Sort by Score** — toggle to sort papers by relevance score instead of default order
- **API key management** — stored in localStorage, configurable via modal, proxy health check before scoring
- **AI Disagreement Detection** — when user's triage decision disagrees with AI suggestion, a confirmation popup appears: "AI suggested [Yes/No] with score [X]. You chose [No/Yes]. Confirm your decision?" with "Keep my decision" / "Change to AI suggestion" buttons
- **Disagreement Logging** — confirmed disagreements stored in localStorage (`slr-screener-disagreements`) and Firestore (`users/{userId}/projects/{projectId}/aiDisagreements/{paperId}`) with title, venue, AI score, AI suggestion, AI rationale, user decision, and timestamp
- **Disagreement Export** — "Export AI Disagreements" button in AI Insights sidebar exports CSV with all human-AI disagreements

### AI Insights Sidebar

- Model selector dropdown
- Current paper's score, suggestion, and reason
- Suggested Yes/No tabs with paper lists
- Export AI Disagreements button (when disagreements exist)
- Clear errors and reset scores buttons
- Click-to-jump navigation

### Decision Log Sidebar

- Searchable by title
- Filterable by decision (All/Yes/No with counts)
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
- **Progress bar** — segmented bar showing Yes (green), No (red) counts with remaining
- **Auto-save** — all state persists in localStorage

### Project Sharing

- **Share modal** — invite collaborators by email with role selection (Annotator or Viewer). Always fetches fresh collaborator status from Firestore when opened (with loading indicator). Status badges: pending (yellow), accepted (green), declined (red).
- **Roles** — Annotator: can screen papers (decisions stored independently under own userId); Viewer: read-only access
- **Collaborator list** — shows email, role (editable), status badge (pending yellow, accepted green, declined red), remove button
- **Auto-discovery** — on login, collectionGroup query finds all projects where user's email is a collaborator
- **Invitation flow** — pending invites shown via notification bell in header (not auto-accepted); collaborator explicitly accepts or declines
- **Notification bell** — header icon with red badge showing pending invite count; clicking opens dropdown with invite cards (owner email, project name, role, Accept/Decline buttons)
- **Accept** — moves project to "Shared with me" sidebar, updates Firestore status to `accepted`
- **Decline** — removes invite from notifications, updates Firestore status to `declined`; owner sees "declined" in share modal
- **Badges** — "Team" badge on owner's projects with collaborators; "Shared with me" badge on collaborator's view
- **Bias prevention** — each annotator's decisions stored separately under their own userId; annotators cannot see each other's decisions during screening

### Team Dashboard (`appView='dashboard'`)

Two-phase dashboard accessible to ALL annotators (not just owner). Opens automatically when clicking a shared project. Also accessible via "Dashboard" button in the screening header for team projects.

**Phase 1 — Screening:**
- **My Progress** — Recharts pie chart (screened vs remaining), bar chart (Yes/No counts), stacked venue breakdown
- **Team Progress** — progress bars showing each annotator's screened count (e.g., "120/1100"). NO decisions shown — bias protection
- **My AI Disagreements** — summary count with export button
- **Phase indicator** — "Screening (In Progress)" or "Screening (Complete)" toggle

**Phase 2 — Conflict Resolution:**
- **Phase trigger** — activates when owner clicks "Start Resolution" or all annotators finish. Non-owners can only view resolution phase when owner starts it or all are done.
- **Agreement Summary** — total screened by 2+, agreement rate %, Kappa score with interpretation badge, conflict count
  - **Cohen's Kappa** — for exactly 2 annotators
  - **Fleiss' Kappa** — for 3+ annotators
  - **Interpretation labels**: Poor (<0.2), Fair (0.2–0.4), Moderate (0.4–0.6), Substantial (0.6–0.8), Almost Perfect (>0.8)
- **Three tabs** — Conflicts (disagreements), Agreed (unanimous), All (every screened paper)
- **Filters** — search by title, filter by venue, filter by resolution status (resolved/unresolved)
- **Conflict rows** — venue badge, truncated title, color-coded decision chips per annotator
  - **Owner**: final decision dropdown + comment input
  - **Non-owner**: read-only view of conflicts and resolutions
- **Final decisions** — stored at `projects/{projectId}/finalDecisions/{paperId}` with decision, resolvedBy, resolvedAt, comment
- **Export Resolved** — CSV with title, author, venue, abstract, doi, each annotator's decision columns, final_decision, conflict_comment, resolved_by, resolved_at
- **Kappa utility** (`src/utils/kappa.js`) — pure functions: `cohensKappa`, `fleissKappa`, `interpretKappa`, `analyzeConflicts`

## Project Structure

```
slr-screener/
├── public/
│   ├── enriched_papers_2025.json   # Demo data (1100 papers, 1092 abstracts)
│   ├── favicon.svg                 # Blue "SLR" + green checkmark badge
│   ├── pdf.worker.min.js           # pdfjs-dist worker (copied from node_modules)
│   └── index.html
├── src/
│   ├── App.js                      # All application logic (single component)
│   ├── App.css                     # All styles
│   ├── LoginPage.js                # Login/sign-up/forgot-password page with password validation
│   ├── firebase.js                 # Firebase configuration and initialization
│   ├── contexts/
│   │   └── AuthContext.js          # Auth context provider (Google + email/password)
│   ├── services/
│   │   └── firestore.js            # Firestore service layer (CRUD, sync, sharing, conflicts)
│   ├── utils/
│   │   └── kappa.js                # Cohen's/Fleiss' Kappa, conflict analysis
│   ├── testHelpers.js              # Shared test utilities (mock data, fetch mock)
│   ├── __tests__/
│   │   ├── dataAndNavigation.test.js  # Navigation and data loading (12 tests)
│   │   ├── triage.test.js             # Triage decisions (5 tests)
│   │   ├── highlights.test.js         # Keyword highlighting (3 tests)
│   │   ├── export.test.js             # CSV export and decision log (3 tests)
│   │   ├── project.test.js            # Project management and sharing (8 tests)
│   │   ├── auth.test.js               # Auth flow and verification (19 tests)
│   │   ├── firestore.test.js          # Firestore service layer (24 tests)
│   │   └── kappa.test.js              # Kappa calculations and conflict detection (26 tests)
│   ├── index.js                    # Entry point
│   └── index.css                   # Base/reset styles
├── server.js                       # Express proxy (Claude API + Semantic Scholar)
├── firebase.json                   # Firebase Hosting config (build dir, SPA rewrites)
├── .firebaserc                     # Firebase project alias (slr-screener)
├── package.json
└── CLAUDE.md
```

## Testing

115 tests across 8 suites:

```bash
npm test         # Run all tests
```

| Suite | Tests | Coverage |
|-------|-------|----------|
| dataAndNavigation | 12 | Paper loading, navigation, arrow keys, progress bar |
| triage | 5 | Y/N decisions, re-decision, badges, counts |
| highlights | 3 | Toggle on/off, whole-word matching, hover tooltips |
| export | 3 | CSV format, decision log, search filter |
| project | 8 | Sidebar, new project, switch back, screened count, menu, sharing modal, validation |
| auth | 23 | Login/sign-up forms, password validation, verification flow, Google sign-in, forgot password |
| firestore | 34 | CRUD, batch writes, sync helpers, sharing, decline invite, final decisions, AI disagreements |
| kappa | 27 | Cohen's Kappa, Fleiss' Kappa, interpretation, conflict detection, edge cases |

All test files mock `AuthContext`, `firestore` service, and `xlsx`. Auth tests use `jest.useFakeTimers()` for countdown/polling.

## Running

```bash
npm start        # React dev server at http://localhost:3000
npm run proxy    # Proxy server at http://localhost:3001 (separate terminal)
npm run build    # Production build
npm test         # Run test suite (115 tests)
npm run deploy   # Build + deploy to Firebase Hosting (https://slr-screener.web.app)
```

**Live deployment**: https://slr-screener.web.app

The proxy server (`server.js`) must be running for AI scoring and Semantic Scholar lookups. It proxies:
- `POST /api/score` — Claude API (`api.anthropic.com/v1/messages`)
- `POST /api/semantic-scholar/search` — single title lookup
- `POST /api/semantic-scholar/batch` — batch title lookup with 1s rate limiting
- `GET /api/health` — health check
