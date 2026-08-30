import { NextResponse } from "next/server";

import { NotFoundError } from "@/lib/errors";
import { getSessionStore } from "@/lib/store";
import type {
  DocumentKind,
  PageRef,
  PageView,
  SessionResultPayload,
} from "@/lib/types";

import { errorResponse } from "../../../_lib/respond";

/** Storage keys become page URLs, so storage layout never reaches the client. */
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

    const payload: SessionResultPayload = {
      sessionId: session.sessionId,
      status: session.status,
      questionPages: toPageViews(
        session.sessionId,
        "question_paper",
        session.questionPages,
      ),
      answerPages: toPageViews(
        session.sessionId,
        "answer_sheet",
        session.answerPages,
      ),
      questions: session.questions,
      answers: session.answers,
      mappings: session.mappings,
      errors: session.errors,
    };

    return NextResponse.json(payload, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error, "GET /api/sessions/:id/result");
  }
}

function toPageViews(
  sessionId: string,
  kind: DocumentKind,
  refs: PageRef[],
): PageView[] {
  const segment = kind === "question_paper" ? "question" : "answer";
  return refs.map((ref) => ({
    index: ref.index,
    width: ref.width,
    height: ref.height,
    url: `/api/sessions/${sessionId}/pages/${segment}/${ref.index}`,
  }));
}
