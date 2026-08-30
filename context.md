# Context: VEDA AI (Answer Sheet Mapper)

## Overview

**VEDA AI (Answer Sheet Mapper)** is a web application that automates the process of mapping handwritten answer sheets to printed question papers.

Users upload:
1. A **Question Paper** (PDF or image files)
2. A handwritten **Answer Sheet** (PDF or image files)

The application processes these inputs through an AI-powered pipeline using Google Gemini 2.5 Flash / Vision to:
- Extract all questions in printed reading order.
- Transcribe handwritten answer blocks across answer sheet pages.
- Map handwritten answers to their corresponding question paper items.
- Provide an interactive UI where selecting a question highlights the corresponding handwritten answer's bounding boxes on the answer sheet.

---

## Tech Stack & Dependencies

- **Framework**: [Next.js 16](https://nextjs.org/) (App Router, React 19, TypeScript)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) with PostCSS
- **AI / LLM Integration**: `@google/genai` (Google Gemini API - default model `gemini-2.5-flash`), with Zod schema validation
- **PDF Processing**: `pdfjs-dist` (client-side PDF rasterization to canvas/PNG)
- **Storage**: In-memory session store (`MemorySessionStore`) and local disk storage (`DiskFileStore`)
- **Testing & Tooling**: [Vitest](https://vitest.dev/) for unit and integration testing; `tsx` for running diagnostic/spike scripts (`scripts/spike-bbox.ts`, `scripts/smoke-gemini.ts`, `scripts/make-fixtures.ts`).

---

## Architecture & System Design

```
Browser Client                                Next.js Server
──────────────                                ──────────────
Rasterize PDF/Photos to PNG ──POST /api/sessions──▶ Store images in DiskFileStore
                                                     Create session in MemorySessionStore
                                                     Launch background JobRunner
                                                                 │
Poll /api/sessions/[id]/status ◀─────────────────────────────────┤
                                                     1. Extract questions (Gemini Vision)
                                                     2. Extract handwritten answers (Gemini)
                                                     3. Multi-pass matching & alignment
                                                                 │
Fetch /api/sessions/[id]/result ◀────────────────────────────────┘
Render interactive split view & highlight bounding boxes
```

### Key Architectural Decisions

1. **Client-Side PDF Rasterization**: PDFs and photos are converted to page images in the browser before upload (`src/lib/client/pdf-rasterizer.ts`). This ensures zero server-side native dependencies (like native canvas bindings) and guarantees that the image coordinates seen by the Gemini vision model match the rendering view 1:1.
2. **Single Long-Lived Node Process**: Designed for stateful Node.js environments (e.g. Render). In-memory session tracking and in-process job queueing prevent state drift without needing an external database for transient sessions.
3. **Asynchronous Non-Blocking Processing**: The `/api/sessions` upload endpoint returns immediately with a `sessionId`. Processing runs in background `JobRunner`, and the browser polls `/api/sessions/[id]/status` for stage updates.
4. **Abstract Interface Pattern**: Storage (`SessionStore`, `FileStore`), AI providers (`AiProvider`), and job runners (`JobRunner`) sit behind TypeScript interfaces in `src/lib/` to allow swapping backends (e.g., Redis, S3, BullMQ) without modifying business logic.
5. **Strict Schema & Bounding Box Validation**: Model output is validated via Zod schemas. Bounding box coordinates are clamped and normalized to `0..1` (`x, y, w, h`). Degenerate boxes fall back to whole-page approximate highlights rather than crashing.

---

## Directory Structure

```
├── README.md                      # Project documentation and setup guide
├── context.md                     # Comprehensive technical context (this file)
├── package.json                   # Project dependencies and npm scripts
├── next.config.ts                 # Next.js configuration
├── postcss.config.mjs             # PostCSS setup with Tailwind CSS v4
├── render.yaml                    # Render deployment blueprint
├── scripts/
│   ├── copy-pdf-worker.mjs        # Copies PDF.js worker assets for client build
│   ├── make-fixtures.ts           # Generates test fixtures
│   ├── smoke-gemini.ts            # Diagnostic script to test Gemini API connection
│   └── spike-bbox.ts              # Diagnostic script to overlay model bounding boxes on images
├── src/
│   ├── app/                       # Next.js App Router routes & layouts
│   │   ├── api/                   # Server API endpoints
│   │   │   └── sessions/          # Session creation, status, results & image routes
│   │   ├── sessions/[id]/         # Session result view page
│   │   ├── layout.tsx             # Root layout component
│   │   └── page.tsx               # Main landing / upload page
│   ├── components/                # React UI Components
│   │   ├── AnswerSheetView.tsx    # Answer sheet viewer with SVG bounding-box overlays
│   │   ├── FilePicker.tsx         # Drag-and-drop file uploader component
│   │   ├── ProgressPanel.tsx      # Real-time status / progress bar indicator
│   │   ├── QuestionList.tsx       # Extracted question list with match status badges
│   │   ├── SessionView.tsx        # Split-pane workspace view component
│   │   └── UploadForm.tsx         # Document upload form handler
│   └── lib/                       # Domain logic & pipeline modules
│       ├── types.ts               # Core domain contracts (Question, AnswerBlock, BoundingBox, etc.)
│       ├── config.ts              # App configuration & environment variables
│       ├── errors.ts              # Domain error handling
│       ├── limits.ts              # File upload limit validations
│       ├── logger.ts              # Structured JSON logger
│       ├── ai/                    # Gemini API provider, schemas, geometry, caching & rate-limiting
│       ├── client/                # Client-side API wrapper & PDF rasterizer
│       ├── ingest/                # Page ingestion logic
│       ├── pipeline/              # Question/answer extraction, label parsing, matching engine
│       └── store/                 # Session and file storage abstractions (Memory / Disk)
```

---

## Core Domain Models (`src/lib/types.ts`)

- **`Question`**: Extracted question with hierarchical `labelPath` (e.g. `["11", "a", "ii"]`), display `label` ("11(a)(ii)"), prompt `text`, visual `order`, and normalized `box` location.
- **`AnswerBlock`**: Transcribed student handwriting block with `rawLabel` (e.g. "Q11 a"), transcribed `text`, visual `boxes` (can span multiple pages/columns), and transcription `confidence`.
- **`Mapping`**: Links a `questionId` to `answerBlockIds` with a `matchType` (`labelled` | `inferred` | `positional` | `unmatched`) and `confidence`.
- **`BoundingBox`**: Normalized coordinates `{ page: number, x: number, y: number, w: number, h: number }` (0..1 range).

---

## Matching & Degraded Pipeline Logic

The pipeline resolves student answer blocks to question paper items in three distinct fallback stages (`src/lib/pipeline/matcher.ts`):

1. **Label Matching**: Normalizes both printed labels and student handwriting labels into structured token arrays (e.g. `11(a)(ii)` and `Q11 a ii` both convert to `["11", "a", "ii"]`). Matches exact matches.
2. **Positional Matching**: High-precision gap-filling pass for unlabelled answers positioned between two known anchored answers.
3. **Model Content Inference**: Uses Gemini to semantically infer question-answer pairs for remaining unlabelled or ambiguous handwriting blocks.

---

## API Routes

- `POST /api/sessions`: Accepts rasterized page images for question paper and answer sheet. Creates a session ID and triggers background processing.
- `GET /api/sessions/[id]/status`: Returns the current processing stage (`uploading`, `extracting_questions`, `extracting_answers`, `mapping`, `done`, `failed`).
- `GET /api/sessions/[id]/result`: Returns complete questions, answer blocks, mappings, and page image URLs.
- `GET /api/sessions/[id]/files/[...path]`: Serves cached page images for rendering in the viewer.

---

## Environment Variables & Configuration

Configuration is loaded in `src/lib/config.ts`:
- `GEMINI_API_KEY`: Google AI Studio API key required for running extraction.
- `AI_CONCURRENCY`: Max concurrent requests sent to Gemini (default: `2`).
- `SESSION_TTL_MS`: In-memory session expiration time (default: 1 hour).
- `CACHE_DIR`: Directory for model response caching (default: `.cache`).
- `UPLOADS_DIR`: Directory for uploaded page images (default: `.data/uploads`).

---

## How to Run

```bash
# Install dependencies
npm install

# Setup environment variables
cp .env.example .env.local   # Set GEMINI_API_KEY in .env.local

# Run development server
npm run dev

# Run tests
npm test

# Run type check and linter
npm run typecheck
npm run lint
```
