import { ValidationError } from "@/lib/errors";

/**
 * Upload validation.
 *
 * The client rasterizes PDFs in the browser and uploads page images, so the
 * server never runs a PDF parser on untrusted bytes. What arrives here still
 * gets checked on content, not on the declared type: a caller can claim any
 * MIME type it likes.
 */

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

/**
 * Identifies an image by its leading bytes. Returns null for anything that is
 * not an allowed image, including files whose declared type says otherwise.
 */
export function sniffImageType(bytes: Uint8Array): AllowedImageType | null {
  if (startsWith(bytes, PNG_MAGIC)) return "image/png";
  if (startsWith(bytes, JPEG_MAGIC)) return "image/jpeg";
  return null;
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((byte, i) => bytes[i] === byte);
}

export type PageUpload = {
  bytes: Uint8Array;
  width: number;
  height: number;
};

export type PageLimits = {
  maxPagesPerDocument: number;
  maxPageBytes: number;
  maxPagePixels: number;
};

/**
 * Validates one document's worth of pages, throwing a `ValidationError` with a
 * message safe to show the user.
 *
 * The pixel cap is a decompression-bomb guard: a small file can declare
 * enormous dimensions, and every page is later base64-encoded into a model
 * request.
 */
export function validatePages(
  documentName: string,
  pages: PageUpload[],
  limits: PageLimits,
): AllowedImageType[] {
  if (pages.length === 0) {
    throw new ValidationError(`${documentName}: no pages were uploaded`, {
      stage: "ingest",
      code: "no_pages",
    });
  }

  if (pages.length > limits.maxPagesPerDocument) {
    throw new ValidationError(
      `${documentName}: ${pages.length} pages exceeds the ${limits.maxPagesPerDocument}-page limit`,
      { stage: "ingest", code: "page_limit_exceeded" },
    );
  }

  return pages.map((page, index) => {
    const label = `${documentName} page ${index + 1}`;

    if (page.bytes.byteLength > limits.maxPageBytes) {
      throw new ValidationError(
        `${label}: exceeds the ${Math.round(limits.maxPageBytes / 1024 / 1024)}MB per-page limit`,
        { stage: "ingest", code: "page_too_large" },
      );
    }

    const type = sniffImageType(page.bytes);
    if (!type) {
      throw new ValidationError(`${label}: not a PNG or JPEG image`, {
        stage: "ingest",
        code: "unsupported_image_type",
      });
    }

    if (
      !Number.isInteger(page.width) ||
      !Number.isInteger(page.height) ||
      page.width < 1 ||
      page.height < 1
    ) {
      throw new ValidationError(`${label}: invalid page dimensions`, {
        stage: "ingest",
        code: "invalid_dimensions",
      });
    }

    if (page.width * page.height > limits.maxPagePixels) {
      throw new ValidationError(
        `${label}: ${page.width}×${page.height} exceeds the pixel limit`,
        { stage: "ingest", code: "page_too_many_pixels" },
      );
    }

    return type;
  });
}
