/**
 * Bounding-box spike.
 *
 * The single highest-risk assumption in this project is that the vision model
 * returns usable coordinates for handwritten answer regions. This script tests
 * that against real pages before any UI depends on it.
 *
 *   npm run spike:bbox -- fixtures/answer-1.png fixtures/answer-2.png
 *   npm run spike:bbox -- --questions fixtures/paper-1.png
 *
 * Writes `spike-output/index.html`: each page image with the returned boxes
 * drawn over it. Open it and look. If the boxes track the writing, the
 * highlighting feature is viable as designed; if they do not, highlighting
 * degrades to page level and that goes in the README as a known limitation.
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getAiProvider } from "@/lib/ai";
import type { PageImage } from "@/lib/ai/provider";
import { sniffImageType } from "@/lib/ingest/validate";
import { logger } from "@/lib/logger";
import type { BoundingBox, BoxSource } from "@/lib/types";

type Overlay = {
  box: BoundingBox & { source: BoxSource };
  label: string;
  detail: string;
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const questionMode = argv.includes("--questions");
  const files = argv.filter((arg) => !arg.startsWith("--"));

  if (files.length === 0) {
    console.error(
      "Usage: npm run spike:bbox -- [--questions] <page-image> [more-pages...]",
    );
    process.exitCode = 1;
    return;
  }

  const pages: PageImage[] = [];
  for (const [index, file] of files.entries()) {
    const bytes = new Uint8Array(await readFile(file));
    const mimeType = sniffImageType(bytes);
    if (!mimeType) {
      console.error(`${file} is not a PNG or JPEG`);
      process.exitCode = 1;
      return;
    }
    pages.push({ index, bytes, mimeType });
  }

  const provider = getAiProvider();
  const log = logger.child({ spike: questionMode ? "questions" : "answers" });

  const overlays: Overlay[] = questionMode
    ? (await provider.extractQuestions(pages, log)).map((question) => ({
        box: question.box,
        label: question.label,
        detail: question.text,
      }))
    : (await provider.extractAnswers(pages, log)).flatMap((answer) =>
        answer.boxes.map((box) => ({
          box,
          label: answer.rawLabel ?? "(unlabelled)",
          detail: `${answer.text} — confidence ${answer.confidence.toFixed(2)}`,
        })),
      );

  const fallbacks = overlays.filter(
    (overlay) => overlay.box.source === "page_fallback",
  ).length;

  const outputDir = path.resolve("spike-output");
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    path.join(outputDir, "index.html"),
    renderHtml(files, overlays),
    "utf8",
  );

  console.log(
    [
      "",
      `Regions returned : ${overlays.length}`,
      `Page fallbacks   : ${fallbacks}${fallbacks ? "  <-- model gave unusable boxes for these" : ""}`,
      `Open             : spike-output/index.html`,
      "",
    ].join("\n"),
  );
}

/** Self-contained HTML — the images are referenced, not copied. */
function renderHtml(files: string[], overlays: Overlay[]): string {
  const sections = files
    .map((file, index) => {
      const pageOverlays = overlays.filter(
        (overlay) => overlay.box.page === index,
      );
      const boxes = pageOverlays
        .map((overlay, i) => {
          const { x, y, w, h, source } = overlay.box;
          const color = source === "model" ? "#2563eb" : "#dc2626";
          return `<div class="box" style="left:${pct(x)};top:${pct(y)};width:${pct(w)};height:${pct(h)};border-color:${color}">
        <span class="tag" style="background:${color}">${i + 1}. ${escapeHtml(overlay.label)}</span>
      </div>`;
        })
        .join("\n");

      const list = pageOverlays
        .map(
          (overlay, i) =>
            `<li><b>${i + 1}. ${escapeHtml(overlay.label)}</b> — ${escapeHtml(
              overlay.detail.slice(0, 300),
            )}</li>`,
        )
        .join("\n");

      return `<section>
    <h2>Page ${index + 1} — ${escapeHtml(path.basename(file))}</h2>
    <div class="page">
      <img src="${escapeHtml(path.relative("spike-output", path.resolve(file)))}" alt="page ${index + 1}">
      ${boxes}
    </div>
    <ol>${list}</ol>
  </section>`;
    })
    .join("\n");

  return `<!doctype html>
<meta charset="utf-8">
<title>Bounding box spike</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 2rem; background: #f8fafc; color: #0f172a; }
  .page { position: relative; display: inline-block; max-width: 100%; }
  .page img { display: block; max-width: 100%; height: auto; }
  .box { position: absolute; border: 2px solid; background: rgba(37,99,235,.12); }
  .tag { position: absolute; top: -1.4em; left: -2px; color: #fff; font-size: 11px; padding: 0 4px; white-space: nowrap; }
  ol { max-width: 60ch; }
  section { margin-bottom: 3rem; }
  legend, .key { color: #475569; }
</style>
<h1>Bounding box spike</h1>
<p class="key">Blue = box returned by the model. Red = model box was unusable and fell back to the whole page.</p>
${sections}
`;
}

const pct = (value: number): string => `${(value * 100).toFixed(2)}%`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
