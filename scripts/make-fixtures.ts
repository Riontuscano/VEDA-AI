/**
 * Generates test fixtures: a question paper and an answer sheet, as PDFs and
 * as rasterized PNG pages.
 *
 *   npm run fixtures
 *
 * The answer sheet is *typed*, not handwritten, so it exercises the pipeline's
 * structure — ordering, page continuation, unanswered questions, orphan answers
 * — without depending on a scan. It deliberately does NOT test handwriting
 * legibility; that needs a real photographed sheet.
 *
 * The generated question paper is also meant to be printed and answered by hand
 * to produce that real fixture.
 *
 * Rasterization here uses a native canvas binding. That is a test-tooling
 * dependency only — the application rasterizes in the browser and never runs
 * this code path.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createCanvas,
  DOMMatrix,
  ImageData,
  Path2D,
} from "@napi-rs/canvas";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

// pdf.js expects these as globals when rendering outside a browser.
const globalRef = globalThis as Record<string, unknown>;
globalRef.DOMMatrix ??= DOMMatrix;
globalRef.ImageData ??= ImageData;
globalRef.Path2D ??= Path2D;

const OUT_DIR = path.resolve("fixtures");
const PAGE_WIDTH = 595; // A4 at 72dpi
const PAGE_HEIGHT = 842;
const MARGIN = 56;

type Line = { text: string; size: number; bold?: boolean; gap?: number };

async function buildPdf(pages: Line[][]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  for (const lines of pages) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - MARGIN;

    for (const line of lines) {
      y -= line.size + (line.gap ?? 6);
      page.drawText(line.text, {
        x: MARGIN,
        y,
        size: line.size,
        font: line.bold ? bold : regular,
        color: rgb(0.05, 0.05, 0.05),
      });
    }
  }

  return pdf.save();
}

/** Six questions, two of them sub-parts of the same parent. */
function questionPaper(): Line[][] {
  return [
    [
      { text: "PHYSICS AND BIOLOGY — TERM TEST", size: 15, bold: true, gap: 4 },
      { text: "Time: 1 hour", size: 10, gap: 24 },

      { text: "1. Define photosynthesis and name the pigment", size: 12, gap: 14 },
      { text: "    responsible for it.", size: 12, gap: 26 },

      { text: "2. State Newton's second law of motion.", size: 12, gap: 26 },

      { text: "3. Answer both parts:", size: 12, gap: 14 },
      { text: "    (a) What is the SI unit of force?", size: 12, gap: 14 },
      { text: "    (b) Define one newton.", size: 12, gap: 26 },

      { text: "4. Explain the function of the mitochondria.", size: 12, gap: 26 },

      { text: "5. What is the chemical formula for water?", size: 12, gap: 26 },
    ],
  ];
}

/**
 * A student's answers, arranged to hit every edge case at once:
 * answered out of order, an answer continuing onto page 2 with no label,
 * three questions never answered, and an answer to a question not on the paper.
 */
function answerSheet(): Line[][] {
  return [
    [
      { text: "Q3 (a)", size: 13, bold: true, gap: 10 },
      { text: "The SI unit of force is the newton, written as N.", size: 12, gap: 30 },

      { text: "Q1", size: 13, bold: true, gap: 10 },
      { text: "Photosynthesis is the process by which green plants", size: 12, gap: 8 },
      { text: "convert light energy from the sun into chemical energy", size: 12, gap: 8 },
      { text: "stored as glucose. It takes in carbon dioxide and water", size: 12, gap: 8 },
      { text: "and releases oxygen as a by-product. The pigment", size: 12, gap: 8 },
    ],
    [
      // Continues question 1 with no label of its own — the common real case.
      { text: "responsible for capturing the light is chlorophyll, which", size: 12, gap: 8 },
      { text: "is found in the chloroplasts of the leaf cells.", size: 12, gap: 30 },

      { text: "Q5", size: 13, bold: true, gap: 10 },
      { text: "The chemical formula for water is H2O.", size: 12, gap: 30 },

      // No question 9 exists on the paper.
      { text: "Q9", size: 13, bold: true, gap: 10 },
      { text: "The capital city of France is Paris, which lies on", size: 12, gap: 8 },
      { text: "the river Seine.", size: 12, gap: 8 },
    ],
  ];
}

async function rasterize(pdfBytes: Uint8Array): Promise<
  { png: Buffer; width: number; height: number }[]
> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: pdfBytes,
    // No worker process in Node; render on the main thread.
    disableWorker: true,
    isEvalSupported: false,
  } as Parameters<typeof pdfjs.getDocument>[0]);

  const pdf = await loadingTask.promise;
  try {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(1600 / Math.max(base.width, base.height), 4);
      const viewport = page.getViewport({ scale });

      const canvas = createCanvas(
        Math.round(viewport.width),
        Math.round(viewport.height),
      );
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: context as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise;

      pages.push({
        png: canvas.toBuffer("image/png"),
        width: canvas.width,
        height: canvas.height,
      });
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

async function emit(name: string, pages: Line[][]): Promise<void> {
  const pdfBytes = await buildPdf(pages);
  await writeFile(path.join(OUT_DIR, `${name}.pdf`), pdfBytes);

  const rasterized = await rasterize(pdfBytes);
  for (const [index, page] of rasterized.entries()) {
    const file = `${name}-page-${index + 1}.png`;
    await writeFile(path.join(OUT_DIR, file), page.png);
    console.log(`  ${file}  (${page.width}x${page.height})`);
  }
  console.log(`  ${name}.pdf  (${rasterized.length} page(s))`);
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  console.log("Writing fixtures to fixtures/");
  await emit("question-paper", questionPaper());
  await emit("answer-sheet", answerSheet());
  console.log("\nDone. Print question-paper.pdf and answer it by hand to");
  console.log("produce a real handwritten fixture.\n");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
