# SLR Screener

A general-purpose Systematic Literature Review (SLR) paper screening platform. Built for **Prof. Antonio Mastropaolo** at **William & Mary's AURA Lab**. Designed as a reusable, deployable tool for any researcher conducting SLRs.

**GitHub:** https://github.com/alvi75/slr-screener.git

## Tech Stack

- **React** (Create React App) + **React Router v6** — SPA with URL-based routing, all logic in `src/App.js`
- **Pure CSS** — no UI framework, custom styles in `src/App.css`
- **Firebase Auth** — Google sign-in and email/password authentication
- **Cloud Firestore** — cloud persistence for projects, decisions, AI scores, and settings
- **localStorage** — local cache layer, dual-write with Firestore for instant reads
- **Vercel Serverless Functions** — API proxy (`api/claude-proxy.js`, `api/semantic-scholar.js`, `api/semantic-scholar-batch.js`, `api/health.js`) for Claude API and Semantic Scholar calls. Works both locally (`vercel dev`) and deployed.
- **Express** — legacy local proxy server (`server.js` on port 3001), kept for reference
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

- **Google sign-in** — one-click OAuth, bypasses email verification. Uses `signInWithPopup` on all devices (desktop and mobile). No redirect flow — popup is simpler and avoids race conditions with `onAuthStateChanged`.
- **Email/password** — sign-up with password strength validation (8+ chars, uppercase, lowercase, number, special character), real-time strength indicator (Weak/Medium/Strong), show/hide password toggle
- **Email verification flow** — after sign-up, shows "Check Your Email" screen with:
  - Auto-polling every 5 seconds (calls `reloadUser()` to check verification status)
  - Countdown timer (60s) before resend is available
  - "Use Google sign-in instead" button
  - "Sign out and use a different account" link
- **Display name** — on first sign-in, a one-time modal prompts users to enter a display name (pre-filled from Google `displayName` if available). Stored in Firestore at `users/{userId}/profile/main`. Shown in team dashboard, share modal, conflict resolution tooltips, and header avatar. Falls back to email if not set. Service functions: `getUserProfile()`, `saveUserProfile()`.
- **Auth gating** — login required to access the app; unauthenticated users see LoginPage
- **Header integration** — left side (hamburger + logo + Dashboard button), right side (Reload Data, Score Papers, Export CSV, Decision Log, AI Insights + sync icon + notifications + user avatar + Sign Out). Dashboard button always visible for all projects (solo and shared). App container max-width 1170px.
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
- **Hosting**: Vercel (migrated from Firebase Hosting)
- **Firebase config**: `firebase.json` (Firestore rules only), `.firebaserc` (project alias)
- **Vercel config**: `vercel.json` (SPA rewrites, API routes)

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
- **React Router** — URL-based navigation with `react-router-dom` v6:
  - `/` — Redirects to `/home` (authenticated) or `/login` (unauthenticated)
  - `/home` — Home dashboard (project list, create new project)
  - `/setup` — Setup/import view for creating a new project
  - `/project/:projectId` — Screening view, defaults to paper 0
  - `/project/:projectId/:paperIndex` — Screening view at specific paper (supports `?venue=` query param)
  - `/project/:projectId/dashboard` — Team dashboard
  - `/project/:projectId/conflicts` — Conflict resolution (resolution phase)
  - `/login` — Login page (redirects to `/home` if authenticated)
  - `/setup` — New project setup
  - Browser back/forward, trackpad gestures, and shareable URLs all work
  - **Access control** — project URLs check ownership or accepted collaborator status via Firestore before granting access. Denied users see an `AccessDenied` component. Unauthenticated users redirect to `/login` with return-to-original-URL after login via `location.state.from`.
  - `AuthGate` component redirects unauthenticated users to `/login`

### Multi-Format Data Import (Setup Page)

Four import methods, each with project name field:

- **Upload CSV/Excel** — auto-detects columns, field-centric mapping UI (title, author, abstract, venue, DOI, arXiv ID), preview table of first 5 rows, info note about optional fields
- **Upload JSON** — accepts array or `{ "papers": [...] }` format, venue detection with default venue prompt, format examples shown
- **Add Papers Manually** — form-based entry with repeatable paper cards (title, venue, DOI, arXiv ID, abstract), "Fetch Missing Info" via Semantic Scholar API, rate-limited 1 req/sec
- **Upload PDFs** — drag-and-drop, extracts text from first 2 pages, auto AI extraction with Claude Haiku (title, authors, abstract), default venue field, editable results with status cards (processing/done/failed), API key field

All imports normalize to standardized JSON format via `normalizePaper()`.

### Project Management

- **Project sidebar** — hamburger menu (☰), lists ALL user projects from Firestore (refreshed on open). Active project highlighted with three-dot menu. Click any project to switch. Current project always shown even if not yet synced to Firestore.
- **Three-dot menu (⋮)** — Rename, Add Papers, Export JSON, Export CSV, Share Project (owner), Resolve Conflicts (owner, shared), Duplicate, Delete
- **Add Papers** — opens import page in append mode with banner "Adding papers to: [Project Name]", deduplicates by title (case-insensitive), shows result notification with counts
- **Export JSON** — standardized format matching `enriched_papers_2025.json` schema
- **Export CSV** — includes all triage data (decisions, AI scores, suggestions, reasons)
- **Demo badge** — shown for built-in dataset, demo projects cannot be deleted

### Paper Screening

- **Paper card** — one paper at a time with title, authors, venue badge (color-coded), and abstract. Layout: `.app.screening-view` is `height: 100vh; overflow: hidden`. Paper card uses `display: flex; flex-direction: column; overflow: hidden; height: calc(100vh - 300px); min-height: 300px; max-height: 700px` — capped to fit viewport with header/filters/buttons/nav accounted for (280px). If content is shorter, card shrinks to fit. `.abstract-section` inside uses `flex: 1; min-height: 0; overflow-y: auto` so only the abstract scrolls. All other card elements (meta, title, authors, links, label) have `flex-shrink: 0`. Decision section and navigation sit directly below with `flex-shrink: 0`.
- **Triage buttons** — Two big buttons: Yes (green) / No (red) with visual feedback (current decision highlighted)
- **Auto-advance** — moves to next paper after new decision; stays when changing existing decision
- **Keyboard shortcuts** — `Y` Yes, `N` No, `H` Toggle highlights, `←` Previous, `→` Next
- **Swipe navigation** — on touch devices, swipe left for next paper, swipe right for previous (60px threshold, horizontal-dominant)

### Venue Filtering

- Pill-style tabs computed dynamically from `papers.map(p => p.conf)` — only shows venues present in the current dataset
- "All" tab always shown; no hardcoded venue list

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

- **Claude API integration** — evaluates each abstract on three fixed metrics (Topical Alignment, Methodological Relevance, Specificity) scored 1–5 each, computes overall average, suggests Yes (≥3.5) or No with one-sentence explanation. Returns `{ criteria, overall, suggestion, reason, model }`. Metrics defined in `SCORING_CRITERIA` constant.
- **Score helpers** — `isValidScore()`, `getScoreValue()`, `scoreColorClass()`, `formatScoreDisplay()`, `scoreCriteriaLines()`. Old 0–100 format scores (no `.criteria`) are treated as non-existent and shown as "AI: ?"
- **Model selector** — Claude Haiku 4.5, Sonnet 4.6, Opus 4.6 (configurable in AI Insights sidebar)
- **Research goal** — customizable prompt that drives scoring relevance
- **Batch scoring** — batched in groups of 5 with `Promise.allSettled`, stoppable mid-run
- **Per-paper rescoring** — separate ↻ button next to AI badge to rescore individual papers
- **AI score badge** — color-coded (green ≥4.0, yellow/orange 2.5–3.9, red <2.5); click to toggle popover with per-criterion scores and reason
- **AI suggestion glow** — decision buttons get subtle purple glow when matching AI suggestion
- **Sort by Score** — toggle to sort papers by relevance score instead of default order
- **API key management** — stored in localStorage. Clicking "Score Papers" with no key shows a modal with input field, "Save & Start Scoring" button, and link to console.anthropic.com. Scoring starts immediately once key is saved. "AI: ?" badge on every unscored paper — click to score individually (or opens API key modal if no key). Proxy down shows inline amber banner (auto-clears after 8s).
- **AI Disagreement Detection** — when the current paper has a decision that disagrees with the AI suggestion, a computed inline banner shows below the Yes/No buttons: "AI suggested [Yes/No] (score [X]) — you chose [No/Yes]". No state variable — derived from `decisions[globalIndex]` vs `aiScores[globalIndex].suggestion`. Appears/disappears automatically as you navigate. Disagreement is logged to Firestore on decision.
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

- **CSV export** — downloads with columns: conf, title, author, decision, ai_overall, ai_suggestion, ai_reason, [per-criterion columns], abstract, doi, pdf_url, arxiv_id
- **Progress bar** — segmented bar showing Yes (green), No (red) counts with remaining
- **Auto-save** — all state persists in localStorage

### Project Sharing

- **Share modal** — invite collaborators by email with role selection (Annotator or Viewer). Project meta stores `ownerDisplayName` and `ownerPhotoURL` alongside `ownerId`/`ownerEmail`. Always fetches fresh collaborator status from Firestore server (bypasses cache via `getDocsFromServer`) when opened (with loading indicator). Status badges: pending (yellow), accepted (green), declined (red).
- **Roles** — Annotator: can screen papers (decisions stored independently under own userId); Viewer: read-only access
- **Collaborator list** — shows email, role (editable), status badge (pending yellow, accepted green, declined red), remove button
- **Auto-discovery** — on every app load, collectionGroup query finds all projects where user's email is a collaborator (case-insensitive). All collaborator emails normalized to lowercase in Firestore.
- **Invitation flow** — pending invites shown via notification bell in header (not auto-accepted); collaborator explicitly accepts or declines
- **Notification bell** — header icon with red badge showing pending invite count; clicking opens dropdown with invite cards showing owner's profile photo (or initial avatar), display name, project name, role, and Accept/Decline buttons. Accepting navigates to `/home`.
- **Accept** — moves project to "Shared with me" sidebar, updates Firestore status to `accepted`, stores collaborator's `userId` on the collaborator record for dashboard decision fetching
- **Decline** — removes invite from notifications, updates Firestore status to `declined`; owner sees "declined" in share modal
- **Badges** — "Team" badge on owner's projects with collaborators; "Shared with me" badge on collaborator's view
- **Bias prevention** — each annotator's decisions stored separately under their own userId; annotators cannot see each other's decisions during screening

### Dashboard (`appView='dashboard'`)

Two-phase dashboard accessible to ALL annotators (not just owner). Works for both solo and shared projects. Opens automatically when clicking a shared project. Also accessible via "Dashboard" button in the screening header (always visible). For solo projects: heading shows "My Progress", conflict resolution shows "Collaboration Required" prompt with Share button, and the Resolution phase button is disabled.

**Phase 1 — Screening:**
- **My Progress** — Recharts pie chart (screened vs remaining), bar chart (Yes/No counts), stacked venue breakdown
- **Team Progress** — progress bars showing each annotator's screened count (e.g., "120/1100"). NO decisions shown — bias protection
- **Team Progress** — visible to all collaborators (not just owner). Shows each annotator's email, role, progress bar, screened count, Yes count, and No count. Owner's progress visible to collaborators. Only aggregate counts shown (no per-paper decisions) for bias protection.
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

### Responsive Design

Fully responsive layout across all screen sizes. No external CSS framework — pure media queries in `src/App.css`.

- **Desktop/laptop** — `.app.screening-view` uses `min-height: 100vh; overflow-y: auto` (not fixed height). Paper card wraps content naturally, no forced stretching.
- **Tablet/mobile (≤768px)** — header stacks vertically (logo row + scrollable action buttons row), filters scroll horizontally, paper card/title/authors/abstract use smaller fonts, decision buttons stack full-width, sidebars expand to 85vw, abstract section capped at `max-height: 300px`
- **Small phone (≤480px)** — header buttons show emoji icons only (hide text), smaller title (14px) and abstract (13px) fonts, compact decision buttons
- **Mobile bottom nav bar** — fixed bottom navigation with Home, Score, Log, Insights icons. Only visible on screens ≤768px. Content has `padding-bottom: 70px` to avoid overlap.
- **Touch-friendly** — all buttons `min-height: 44px` on mobile (Apple guideline), filter buttons padded for touch, swipe left/right on paper card for navigation
- **Swipe support** — `touchstart`/`touchend` listeners with 60px horizontal threshold and dominant-axis check

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
├── api/
│   ├── claude-proxy.js             # Vercel serverless: Anthropic API proxy
│   ├── semantic-scholar.js         # Vercel serverless: single paper lookup
│   ├── semantic-scholar-batch.js   # Vercel serverless: batch paper lookup
│   └── health.js                   # Vercel serverless: health check
├── vercel.json                     # Vercel config (SPA rewrites, API routes)
├── firebase.json                   # Firebase config (Firestore rules only)
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
npm run proxy    # Legacy local proxy server at http://localhost:3001
npm run build    # Production build
npm test         # Run test suite (115 tests)
npm run deploy   # Deploy to Vercel (vercel --prod)
```

**Hosting**: Vercel (API routes served as serverless functions):
- `POST /api/claude-proxy` — Anthropic API proxy (`api.anthropic.com/v1/messages`)
- `POST /api/semantic-scholar` — single title lookup
- `POST /api/semantic-scholar-batch` — batch title lookup with 1s rate limiting
- `GET /api/health` — health check

For local dev, use `vercel dev` (serves both React app and API routes) or `npm start` + `npm run proxy` (legacy Express server — note: app now calls `/api/*` paths, not `localhost:3001`).
