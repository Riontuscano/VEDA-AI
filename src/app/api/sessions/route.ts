import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getAiProvider } from "@/lib/ai";
import { getConfig } from "@/lib/config";
import { ValidationError } from "@/lib/errors";
import { validatePages, type PageUpload } from "@/lib/ingest/validate";
import { logger } from "@/lib/logger";
import { getJobRunner } from "@/lib/pipeline/job-runner";
import { runPipeline } from "@/lib/pipeline/run";
import { getFileStore, getSessionStore } from "@/lib/store";
import type { DocumentKind, PageRef, SessionResult } from "@/lib/types";

import { errorResponse } from "../_lib/respond";

/**
 * Creates a session from rasterized page images and starts the pipeline.
 *
 * PDFs are rasterized in the browser, so this endpoint only ever handles
 * images — the server runs no PDF parser on untrusted input, and the page
 * images the model reads are byte-identical to the ones the viewer displays,
 * which is what makes bounding boxes line up.
 *
 * Returns as soon as the files are stored; the pipeline runs behind the
 * returned session id.
 */

const PageMetaSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const MetaSchema = z.object({
  questionPages: z.array(PageMetaSchema),
  answerPages: z.array(PageMetaSchema),
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const config = getConfig();
    const form = await request.formData();

    const meta = parseMeta(form.get("meta"));
    const questionPages = await readPages(
      form.getAll("questionPages"),
      meta.questionPages,
      "Question paper",
    );
    const answerPages = await readPages(
      form.getAll("answerPages"),
      meta.answerPages,
      "Answer sheet",
    );

    const limits = {
      maxPagesPerDocument: config.maxPagesPerDocument,
      maxPageBytes: config.maxPageBytes,
      maxPagePixels: config.maxPagePixels,
    };
    const questionTypes = validatePages("Question paper", questionPages, limits);
    const answerTypes = validatePages("Answer sheet", answerPages, limits);

    const sessionId = randomUUID();
    const log = logger.child({ sessionId });
    const files = getFileStore();

    const [questionRefs, answerRefs] = await Promise.all([
      storePages(sessionId, "question_paper", questionPages, questionTypes),
      storePages(sessionId, "answer_sheet", answerPages, answerTypes),
    ]);

    const session: SessionResult = {
      sessionId,
      status: "uploading",
      createdAt: Date.now(),
      questionPages: questionRefs,
      answerPages: answerRefs,
      questions: [],
      answers: [],
      mappings: [],
      errors: [],
    };

    await getSessionStore().create(session);
    log.info("Session created", {
      questionPages: questionRefs.length,
      answerPages: answerRefs.length,
    });

    getJobRunner().enqueue(`pipeline:${sessionId}`, () =>
      runPipeline(sessionId, {
        provider: getAiProvider(),
        sessions: getSessionStore(),
        files,
      }),
    );

    return NextResponse.json({ sessionId }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "POST /api/sessions");
  }
}

function parseMeta(raw: FormDataEntryValue | null) {
  if (typeof raw !== "string") {
    throw new ValidationError("Missing page metadata", {
      stage: "ingest",
      code: "missing_meta",
    });
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ValidationError("Page metadata is not valid JSON", {
      stage: "ingest",
      code: "malformed_meta",
    });
  }

  const parsed = MetaSchema.safeParse(json);
  if (!parsed.success) {
    throw new ValidationError("Page metadata has the wrong shape", {
      stage: "ingest",
      code: "malformed_meta",
    });
  }
  return parsed.data;
}

async function readPages(
  entries: FormDataEntryValue[],
  meta: { width: number; height: number }[],
  documentName: string,
): Promise<PageUpload[]> {
  if (entries.length !== meta.length) {
    throw new ValidationError(
      `${documentName}: page count does not match its metadata`,
      { stage: "ingest", code: "meta_count_mismatch" },
    );
  }

  return Promise.all(
    entries.map(async (entry, index) => {
      if (typeof entry === "string") {
        throw new ValidationError(
          `${documentName} page ${index + 1}: expected a file`,
          { stage: "ingest", code: "not_a_file" },
        );
      }
      const dimensions = meta[index];
      if (!dimensions) {
        throw new ValidationError(
          `${documentName} page ${index + 1}: missing dimensions`,
          { stage: "ingest", code: "missing_dimensions" },
        );
      }
      return {
        bytes: new Uint8Array(await entry.arrayBuffer()),
        width: dimensions.width,
        height: dimensions.height,
      };
    }),
  );
}

async function storePages(
  sessionId: string,
  kind: DocumentKind,
  pages: PageUpload[],
  types: string[],
): Promise<PageRef[]> {
  const files = getFileStore();

  return Promise.all(
    pages.map(async (page, index) => {
      const contentType = types[index] ?? "image/png";
      // The name is generated, never taken from the upload, so there is nothing
      // user-controlled anywhere near a filesystem path.
      const storageKey = await files.save(sessionId, `${kind}-${index}`, {
        bytes: page.bytes,
        contentType,
      });
      return {
        index,
        width: page.width,
        height: page.height,
        storageKey,
      } satisfies PageRef;
    }),
  );
}
