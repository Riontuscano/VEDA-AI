# Answer Sheet Mapper

Upload a question paper and a handwritten answer sheet. Every question is
extracted in printed order, every answer block is transcribed and matched to the
question it answers, and selecting a question highlights that answer's region on
the sheet.

## Running locally

```bash
npm install
cp .env.example .env.local   # add a Gemini API key
npm run dev
```

A free API key comes from <https://aistudio.google.com/apikey>.

```bash
npm run typecheck   # tsc, strict
npm run lint
npm test            # unit + pipeline integration, no API key needed
npm run build
```

## Architecture

```
Browser                          Server
───────                          ──────
rasterize PDFs/photos ──POST──▶  /api/sessions ──▶ FileStore + SessionStore
to page images                                            │
                                                          ▼
poll status  ◀──────────────────  /status         JobRunner (in-process)
                                                          │
                                    ┌─────────────────────┴──────────────┐
                                    │  1. extract questions              │
                                    │  2. extract answers → merge pages  │
                                    │  3. map answers to questions       │
                                    └─────────────────────┬──────────────┘
                                                          ▼
fetch result ◀──────────────────  /result          AiProvider (Gemini)
render highlights
```

Every external dependency sits behind an interface: `AiProvider`
(`src/lib/ai/provider.ts`), `SessionStore` / `FileStore`
(`src/lib/store/types.ts`), `JobRunner` (`src/lib/pipeline/job-runner.ts`). The
shipped implementations are the simplest ones that are correct for this
deployment — in-memory map, local disk, in-process jobs. Swapping in Redis, S3
or a real queue means editing the wiring modules, not the pipeline.

### Layout

| Path | What lives there |
| --- | --- |
| `src/lib/types.ts` | Domain contracts every layer is written against |
| `src/lib/ai/` | Gemini adapter, schemas, geometry, cache, limiter |
| `src/lib/pipeline/` | Orchestrator, label parsing, page merging, matching |
| `src/lib/store/` | Session and file storage behind interfaces |
| `src/lib/client/` | Browser rasterization and the typed API client |
| `src/app/api/` | Route handlers |
| `src/components/` | Upload, progress, question list, answer viewer |
| `scripts/spike-bbox.ts` | Renders model boxes over real pages for eyeballing |

## Decisions worth explaining

**Rasterization happens in the browser.** Server-side PDF rendering needs native
canvas or poppler bindings and is a common deployment failure. The browser
already has a rendering engine. The useful side effect: the page images the
model reads are byte-identical to the ones the viewer displays, so returned
bounding boxes line up with what the user sees by construction, with no
coordinate translation anywhere.

**Why not Vercel.** The brief says no database is needed, which is true — but
"in-memory state" and "serverless" do not compose. Each request may hit a
different instance, so a session written on one is missing on the next; and
background work stops when the response returns, so the pipeline would die
mid-run. Deployed as a single long-lived Node process, the in-memory store and
in-process job runner are genuinely correct rather than a compromise. That is
the one architectural constraint this project actually has.

**Upload returns immediately.** The pipeline takes tens of seconds on a
multi-page paper. The client gets a session id and polls per-stage status, so
progress is real information ("Reading the handwriting…") rather than a spinner.
Polling over SSE: the payload is tiny and polling needs no reconnect handling.

**Reading order is computed, never trusted.** Questions are extracted one page
per call, so the model has no shared view of the document and its own ordering
is not consistent across calls. Display order is derived from `(page, box.y)`,
with boxes on the same visual line ordered left-to-right so two-column layouts
do not interleave.

**Labels are parsed, not compared.** `11(a)(ii)`, `Q11 a ii` and `11.a.ii` all
normalize to `["11","a","ii"]`, and both the printed label and the student's
handwriting go through the same parser. Anything longer than four tokens is
rejected as prose, so a sentence is never matched as a label.

**Matching degrades in explicit steps.** Label match, then a deliberately
high-precision positional pass that only fills a single-question gap between two
anchored answers, then model content inference for whatever is left. Unanswered
questions and unmatched answers are first-class results shown in the UI. Nothing
is forced into a guess.

**Everything the model returns is validated.** Responses are requested against a
JSON schema and then parsed with Zod at the adapter boundary; a schema failure
retries once with a corrective prompt before failing the stage. Model output is
the least reliable input in the system and is treated that way.

**Bounding boxes have a fallback.** Boxes are clamped, transposed corners are
repaired, and degenerate boxes are rejected and replaced with a whole-page
highlight marked "approximate location" in the UI and logged. A bad box degrades
to a visibly approximate highlight rather than to nothing or a crash.

## Operational notes

- **Logs** are one JSON object per line, tagged with `sessionId`, so a failed
  extraction is reconstructable from logs instead of by re-running it.
- **Model responses are cached** on disk by model + prompt + page bytes. This is
  a development necessity, not an optimization: free-tier daily quota does not
  survive re-processing the same fixtures while tuning prompts.
- **Concurrency is capped** (`AI_CONCURRENCY`, default 2). Firing one call per
  page in parallel is the quickest way to get rate-limited on a free tier.
- **Uploads are validated on content**, not on the declared MIME type: magic
  bytes, per-page size, page count, and a total-pixel cap as a
  decompression-bomb guard. Storage paths are generated, never derived from
  uploaded names.

## Known limitations

- Sessions live in memory and expire after an hour. A restart loses them, and on
  Render's free tier the instance spins down when idle.
- One answer sheet per session, as specified.
- Grading and feedback are not implemented — scope was cut to the required
  extraction, mapping and highlighting.
- Bounding-box quality depends on the vision model. `npm run spike:bbox -- <page
  images>` renders the returned boxes over real pages as HTML so the quality can
  be judged directly rather than assumed.

## If this had to scale

Swap `MemorySessionStore` for Redis and `DiskFileStore` for object storage;
replace `InProcessJobRunner` with a real queue; add auth and per-teacher session
ownership. All three are interface implementations, not rewrites.
