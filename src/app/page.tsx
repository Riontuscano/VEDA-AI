import { AppHeader } from "@/components/AppHeader";
import { UploadForm } from "@/components/UploadForm";
import { FieldLabel } from "@/components/ui/primitives";

/**
 * Upload screen.
 *
 * Asymmetric two-column at desktop: the form is the primary column, and the
 * secondary column states what the mapper actually handles. Those four cases
 * are the hard part of the problem, so they belong on screen rather than in a
 * README.
 */
export default function HomePage() {
  return (
    <>
      <AppHeader />

      <main className="mx-auto grid w-full max-w-5xl flex-1 grid-cols-1 gap-x-16 gap-y-10 px-6 py-12 lg:grid-cols-[minmax(0,1fr)_20rem] lg:py-16">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">
            Map handwritten answers to their questions
          </h1>
          <p className="mt-2 max-w-[60ch] text-[14px] leading-relaxed text-[var(--text-secondary)]">
            Upload a question paper and a scanned answer sheet. Every question
            is extracted in printed order, every answer is read and matched, and
            selecting a question highlights it on the sheet.
          </p>

          <div className="mt-8">
            <UploadForm />
          </div>
        </div>

        <aside className="min-w-0 lg:pt-1.5">
          <FieldLabel>Handles</FieldLabel>
          <dl className="mt-3 flex flex-col gap-4">
            {CAPABILITIES.map((item) => (
              <div key={item.title}>
                <dt className="text-[13px] font-medium">{item.title}</dt>
                <dd className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
                  {item.detail}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-8 border-t border-[var(--border-subtle)] pt-4 text-[12px] leading-relaxed text-[var(--text-tertiary)]">
            Pages are rendered in your browser before upload. Nothing is stored
            permanently; sessions are held in memory and expire after an hour.
          </p>
        </aside>
      </main>
    </>
  );
}

const CAPABILITIES = [
  {
    title: "Answers out of order",
    detail:
      "Matching reads the label the student wrote, not the order they wrote in.",
  },
  {
    title: "Questions left unanswered",
    detail: "Shown as unanswered rather than quietly filled with a near miss.",
  },
  {
    title: "Answers with no question",
    detail:
      "Kept and listed separately instead of forced onto the closest gap.",
  },
  {
    title: "Answers across two pages",
    detail:
      "Joined back together, and the highlight spans both pages at once.",
  },
] as const;
