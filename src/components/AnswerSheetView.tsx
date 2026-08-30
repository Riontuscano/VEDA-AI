"use client";

import { useEffect, useRef } from "react";

import type { LocatedBox, PageView } from "@/lib/types";

export type AnswerSheetViewProps = {
  pages: PageView[];
  highlights: LocatedBox[];
  /** Changes whenever the user picks a different question. */
  selectionKey: string | null;
};

/**
 * The answer sheet, with the selected answer's region highlighted.
 *
 * Overlays are positioned in percentages straight from the normalized boxes, so
 * they track the image through any resize or zoom with no measurement, no
 * resize listener, and no chance of drifting out of sync with the rendered
 * size.
 *
 * Pages stay white in dark mode: they are photographs of paper, and inverting
 * them would misrepresent the document being reviewed.
 */
export function AnswerSheetView({
  pages,
  highlights,
  selectionKey,
}: AnswerSheetViewProps) {
  const pageRefs = useRef(new Map<number, HTMLDivElement>());
  const firstHighlightPage = highlights[0]?.page ?? null;

  useEffect(() => {
    if (firstHighlightPage === null) return;
    pageRefs.current.get(firstHighlightPage)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    // `selectionKey` is in the deps so re-picking the same page for a different
    // question still scrolls back to it.
  }, [firstHighlightPage, selectionKey]);

  return (
    <div className="h-full overflow-y-auto bg-[var(--surface-sunken)] px-6 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        {pages.map((page) => {
          const pageHighlights = highlights.filter(
            (box) => box.page === page.index,
          );

          return (
            <figure key={page.index} className="scroll-mt-6">
              <div
                ref={(element) => {
                  if (element) pageRefs.current.set(page.index, element);
                  else pageRefs.current.delete(page.index);
                }}
                className="relative overflow-hidden rounded-[var(--radius)] bg-white shadow-[0_1px_2px_rgb(0_0_0/0.08),0_8px_24px_-12px_rgb(0_0_0/0.25)]"
                style={{ aspectRatio: `${page.width} / ${page.height}` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- page
                    images are per-session and served from an API route;
                    next/image optimization adds nothing and would need
                    remote-pattern config. */}
                <img
                  src={page.url}
                  alt={`Answer sheet page ${page.index + 1}`}
                  className="block h-full w-full object-contain"
                />

                {pageHighlights.map((box, index) => (
                  <div
                    key={index}
                    aria-hidden
                    className={`pointer-events-none absolute rounded-[2px] transition-[opacity] duration-200 ${
                      box.source === "model"
                        ? "bg-[var(--highlight-fill)] ring-[1.5px] ring-[var(--highlight)]"
                        : "ring-[1.5px] ring-dashed ring-[var(--highlight)]"
                    }`}
                    style={{
                      left: `${box.x * 100}%`,
                      top: `${box.y * 100}%`,
                      width: `${box.w * 100}%`,
                      height: `${box.h * 100}%`,
                    }}
                  >
                    {box.source === "page_fallback" && (
                      <span className="absolute left-1.5 top-1.5 rounded-[3px] bg-[var(--highlight)] px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.04em] text-white">
                        Approximate location
                      </span>
                    )}
                  </div>
                ))}
              </div>

              <figcaption className="mt-1.5 text-center font-mono text-[10.5px] uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
                Page {page.index + 1} of {pages.length}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}
