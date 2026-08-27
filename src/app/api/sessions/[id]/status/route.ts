import { NextResponse } from "next/server";

import { NotFoundError } from "@/lib/errors";
import { getSessionStore } from "@/lib/store";
import type { SessionStatusPayload } from "@/lib/types";

import { errorResponse } from "../../../_lib/respond";

/**
 * Polled by the upload screen while the pipeline runs.
 *
 * Deliberately small — no questions, answers or mappings — so polling every
 * second stays cheap regardless of document size.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  try {
    const session = await getSessionStore().get(id);
    if (!session) {
      throw new NotFoundError("Session not found or expired");
    }

    const payload: SessionStatusPayload = {
      sessionId: session.sessionId,
      status: session.status,
      errors: session.errors,
    };

    return NextResponse.json(payload, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, "GET /api/sessions/:id/status");
  }
}
