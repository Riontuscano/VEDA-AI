"use client";

import type * as PdfJs from "pdfjs-dist";

/**
 * Turns PDFs, photos, or a mix into a uniform array of page images.
 *
 * In the browser on purpose: server-side rasterizing needs native canvas or
 * poppler bindings, a common deployment failure, and the browser already has a
 * rendering engine. It also makes the bytes the model reads identical to the
 * ones the viewer shows, so boxes line up by construction.
 */

let pdfjsPromise: Promise<typeof PdfJs> | null = null;

/**
 * Loaded on first use, not at module scope: pdf.js touches `DOMMatrix` while
 * evaluating, which doesn't exist in Node, and a static import crashes the
 * server prerender of any page reaching this file.
 */
function loadPdfJs(): Promise<typeof PdfJs> {
  pdfjsPromise ??= import("pdfjs-dist").then((module) => {
    module.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return module;
  });
  return pdfjsPromise;
}

/**
 * Longest side of a rendered page. Handwriting stays legible, and the model
 * downsamples anyway, so more pixels cost time and quota for nothing.
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
    // Without this a large PDF stays in memory for the life of the tab.
    await loadingTask.destroy();
  }
}

async function renderPdfPage(
  pdf: PdfJs.PDFDocumentProxy,
  pageNumber: number,
): Promise<RasterizedPage> {
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });

  // Vector content, so rendering above 1x gives real detail, unlike the photo
  // path below which must never upscale. Capped so a tiny page can't ask for
  // an enormous canvas.
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

  // PDF pages are transparent, and transparent-on-black is unreadable.
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
