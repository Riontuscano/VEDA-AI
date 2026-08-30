import { NextResponse } from "next/server";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { getFileStore, getSessionStore } from "@/lib/store";

import { errorResponse } from "../../../../../_lib/respond";

/**
 * Looks the page up through the session's own `PageRef` list rather than
 * building a path from the URL, so a caller can't reach another session's file.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; kind: string; index: string }> },
): Promise<NextResponse> {
  const { id, kind, index } = await params;
  try {
    if (kind !== "question" && kind !== "answer") {
      throw new ValidationError("Unknown page kind");
    }

    const pageIndex = Number(index);
    if (!Number.isInteger(pageIndex) || pageIndex < 0) {
      throw new ValidationError("Invalid page index");
    }

    const session = await getSessionStore().get(id);
    if (!session) {
      throw new NotFoundError("Session not found or expired");
    }

    const refs =
      kind === "question" ? session.questionPages : session.answerPages;
    const ref = refs.find((candidate) => candidate.index === pageIndex);
    if (!ref) {
      throw new NotFoundError("Page not found");
    }

    const stored = await getFileStore().read(ref.storageKey);
    if (!stored) {
      throw new NotFoundError("Page image is no longer available");
    }

    return new NextResponse(stored.bytes as unknown as BodyInit, {
      headers: {
        "content-type": stored.contentType,
        "content-length": String(stored.bytes.byteLength),
        // Immutable within a session, and the session id is unguessable.
        "cache-control": "private, max-age=3600, immutable",
      },
    });
  } catch (error) {
    return errorResponse(error, "GET /api/sessions/:id/pages/:kind/:index");
  }
}
