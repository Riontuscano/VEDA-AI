"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createSession, type UploadStage } from "@/lib/client/api";
import { PUBLIC_LIMITS } from "@/lib/limits";
import { FilePicker } from "./FilePicker";

/**
 * Upload screen.
 *
 * Rasterizing happens here in the browser, so the busy state covers real work
 * and not just a network wait. Once the session exists the user is sent to its
 * page, which owns the pipeline progress — that keeps the session URL
 * shareable and reloadable while processing runs.
 */
export function UploadForm() {
  const router = useRouter();
  const [questionFiles, setQuestionFiles] = useState<File[]>([]);
  const [answerFiles, setAnswerFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = stage !== null;
  const canSubmit =
    questionFiles.length > 0 && answerFiles.length > 0 && !busy;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;

    setError(null);
    setStage({ kind: "uploading" });

    try {
      const sessionId = await createSession(
        questionFiles,
        answerFiles,
        setStage,
      );
      router.push(`/sessions/${sessionId}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Something went wrong preparing those files.",
      );
      setStage(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <FilePicker
        label="Question paper"
        hint={`PDF or images, up to ${PUBLIC_LIMITS.maxPagesPerDocument} pages`}
        files={questionFiles}
        onChange={setQuestionFiles}
        disabled={busy}
      />

      <FilePicker
        label="Handwritten answer sheet"
        hint="PDF or one image per page — phone photos are fine"
        files={answerFiles}
        onChange={setAnswerFiles}
        disabled={busy}
      />

      {error && (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? "Preparing…" : "Extract and map"}
        </button>

        {stage && (
          <span className="text-sm text-slate-600">{describe(stage)}</span>
        )}
      </div>
    </form>
  );
}

function describe(stage: UploadStage): string {
  if (stage.kind === "uploading") return "Uploading pages…";
  return `Rendering ${stage.label} (${stage.completed}/${stage.total})…`;
}
