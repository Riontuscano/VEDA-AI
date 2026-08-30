"use client";

import { ArrowRight, CircleNotch } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { createSession, type UploadStage } from "@/lib/client/api";
import { PUBLIC_LIMITS } from "@/lib/limits";
import { FilePicker } from "./FilePicker";
import { Button } from "./ui/primitives";

/**
 * Rasterizing happens in the browser, so the busy state covers real work and
 * not just a network wait. Once the session exists the user is sent to its
 * page, which keeps the URL shareable while processing runs.
 */
export function UploadForm() {
  const router = useRouter();
  const [questionFiles, setQuestionFiles] = useState<File[]>([]);
  const [answerFiles, setAnswerFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<UploadStage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = stage !== null;
  const canSubmit = questionFiles.length > 0 && answerFiles.length > 0 && !busy;

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
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <FilePicker
        label="Question paper"
        hint={`PDF or images, max ${PUBLIC_LIMITS.maxPagesPerDocument} pages`}
        files={questionFiles}
        onChange={setQuestionFiles}
        disabled={busy}
      />

      <FilePicker
        label="Handwritten answer sheet"
        hint="Phone photos are fine"
        files={answerFiles}
        onChange={setAnswerFiles}
        disabled={busy}
      />

      {error && (
        <p
          role="alert"
          className="rounded-[var(--radius)] border border-[var(--danger)]/30 bg-[var(--danger-wash)] px-3 py-2 text-[13px] text-[var(--danger)]"
        >
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 border-t border-[var(--border-subtle)] pt-4">
        <Button type="submit" disabled={!canSubmit}>
          {busy ? (
            <>
              <CircleNotch size={14} weight="bold" className="animate-spin" />
              Preparing
            </>
          ) : (
            <>
              Extract and map
              <ArrowRight size={14} weight="bold" />
            </>
          )}
        </Button>

        {stage && (
          <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
            {describe(stage)}
          </span>
        )}
      </div>
    </form>
  );
}

function describe(stage: UploadStage): string {
  if (stage.kind === "uploading") return "Uploading pages";
  return `Rendering ${stage.label} ${stage.completed}/${stage.total}`;
}
