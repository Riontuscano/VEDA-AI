"use client";

import type * as PdfJs from "pdfjs-dist";

/**
 * Turns whatever the user picked — PDFs, photos, or a mix — into a uniform
 * array of page images.
 *
 * Runs in the browser on purpose. Rasterizing server-side needs native canvas
 * or poppler bindings, which are the most common deployment failure in this
 * kind of app; the browser already has a rendering engine. It also means the
 * bytes the model reads are exactly the bytes the viewer displays, so returned
 * bounding boxes line up with what the user sees by construction.
 */

let pdfjsPromise: Promise<typeof PdfJs> | null = null;

/**
 * Loads pdf.js on first use rather than at module scope.
 *
 * Its canvas module touches `DOMMatrix` while evaluating, which does not exist
 * in Node — a static import crashes the server prerender of any page that
 * reaches this file, even though the code only ever runs in the browser.
 */
function loadPdfJs(): Promise<typeof PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((module) => {
    module.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return module;
  });
  return pdfjsPromise;
}

/**
 * Longest side of a rendered page, in pixels.
 *
 * Handwriting stays comfortably legible at this size, while keeping uploads and
 * model requests small — the model downsamples large images anyway, so sending
 * more pixels costs time and quota without improving transcription.
 */
const MAX_EDGE = 1600;

export type RasterizedPage = {
  blob: Blob;
  width: number;
  height: number;
};

export type RasterizeProgress = {
  completed: number;
  total: number;
};

export class RasterizeError extends Error {}

export async function rasterizeFiles(
  files: File[],
  onProgress?: (progress: RasterizeProgress) => void,
): Promise<RasterizedPage[]> {
  const pages: RasterizedPage[] = [];
  let completed = 0;

  for (const file of files) {
    const filePages = isPdf(file)
      ? await rasterizePdf(file)
      : [await rasterizeImage(file)];
    pages.push(...filePages);
    completed += 1;
    onProgress?.({ completed, total: files.length });
  }

  if (pages.length === 0) {
    throw new RasterizeError("No readable pages were found in those files.");
  }

  return pages;
}

const isPdf = (file: File): boolean =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name);

async function rasterizePdf(file: File): Promise<RasterizedPage[]> {
  const data = new Uint8Array(await file.arrayBuffer());

  const pdfjs = await loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data });

  let pdf: PdfJs.PDFDocumentProxy;
  try {
    pdf = await loadingTask.promise;
  } catch (error) {
    await loadingTask.destroy();
    throw new RasterizeError(
      `Could not read "${file.name}" as a PDF: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  try {
    const pages: RasterizedPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      pages.push(await renderPdfPage(pdf, pageNumber));
    }
    return pages;
  } finally {
    // Tears down the worker's copy of the document; without this a large PDF
    // stays in memory for the life of the tab.
    await loadingTask.destroy();
  }
}

async function renderPdfPage(
  pdf: PdfJs.PDFDocumentProxy,
  pageNumber: number,
): Promise<RasterizedPage> {
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });

  // PDF pages are vector content, so rendering above 1x yields real detail
  // rather than interpolation — unlike the photo path below, which must never
  // upscale. Capped so a tiny page cannot request an enormous canvas.
  const scale = Math.min(
    MAX_EDGE / Math.max(baseViewport.width, baseViewport.height),
    4,
  );
  const viewport = page.getViewport({ scale });

  const canvas = createCanvas(
    Math.round(viewport.width),
    Math.round(viewport.height),
  );
  const context = canvas.getContext("2d");
  if (!context) {
    throw new RasterizeError("Could not get a 2D canvas context.");
  }

  // White background: PDF pages are transparent, and transparent-on-black is
  // unreadable for both the model and the viewer.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvas, canvasContext: context, viewport }).promise;
  page.cleanup();

  return {
    blob: await toPngBlob(canvas),
    width: canvas.width,
    height: canvas.height,
  };
}

async function rasterizeImage(file: File): Promise<RasterizedPage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new RasterizeError(
      `"${file.name}" is not a PDF or a readable image.`,
    );
  }

  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      throw new RasterizeError("Could not get a 2D canvas context.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    return { blob: await toPngBlob(canvas), width, height };
  } finally {
    bitmap.close();
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new RasterizeError("Could not encode a page image."));
    }, "image/png");
  });
}
