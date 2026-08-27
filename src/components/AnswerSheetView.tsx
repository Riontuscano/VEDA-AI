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
 */
export function AnswerSheetView({
  pages,
  highlights,
  selectionKey,
}: AnswerSheetViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
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
    <div ref={scrollRef} className="h-full overflow-y-auto bg-slate-100 p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        {pages.map((page) => {
          const pageHighlights = highlights.filter(
            (box) => box.page === page.index,
          );

          return (
            <div
              key={page.index}
              ref={(element) => {
                if (element) pageRefs.current.set(page.index, element);
                else pageRefs.current.delete(page.index);
              }}
              className="relative scroll-mt-4 overflow-hidden rounded-md bg-white shadow-sm ring-1 ring-slate-200"
              style={{ aspectRatio: `${page.width} / ${page.height}` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- page
                  images are per-session and served from an API route; next/image
                  optimization adds nothing and would need remote-pattern config. */}
              <img
                src={page.url}
                alt={`Answer sheet page ${page.index + 1}`}
                className="block h-full w-full object-contain"
              />

              {pageHighlights.map((box, index) => (
                <div
                  key={index}
                  aria-hidden
                  className={`pointer-events-none absolute rounded-sm ring-2 transition-all ${
                    box.source === "model"
                      ? "bg-blue-400/20 ring-blue-500"
                      : "bg-amber-300/15 ring-2 ring-dashed ring-amber-500"
                  }`}
                  style={{
                    left: `${box.x * 100}%`,
                    top: `${box.y * 100}%`,
                    width: `${box.w * 100}%`,
                    height: `${box.h * 100}%`,
                  }}
                />
              ))}

              <span className="absolute bottom-1 right-2 rounded bg-slate-900/60 px-1.5 text-[11px] text-white">
                Page {page.index + 1}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
