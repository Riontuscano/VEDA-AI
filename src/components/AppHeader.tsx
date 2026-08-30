import Link from "next/link";
import type { ReactNode } from "react";

/** Single line, 52px, on every screen so the tool has one frame. */
export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-4 border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] px-4">
      <Link
        href="/"
        className="flex items-center gap-2.5 text-[var(--text-primary)]"
      >
        <Mark />
        <span className="text-[13px] font-semibold tracking-tight">
          VEDA AI
        </span>
      </Link>

      {children && (
        <div className="ml-auto flex min-w-0 items-center gap-4">
          {children}
        </div>
      )}
    </header>
  );
}

/** A page with a highlighted band. Drawn here because it's a mark, not an icon. */
function Mark() {
  return (
    <span
      aria-hidden
      className="grid h-6 w-6 place-items-center rounded-[5px] bg-[var(--text-primary)]"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <rect
          x="2.5"
          y="1.5"
          width="9"
          height="11"
          rx="1.5"
          stroke="var(--surface-raised)"
          strokeWidth="1.3"
        />
        <rect
          x="4.4"
          y="6.1"
          width="5.2"
          height="2.6"
          rx="0.6"
          fill="#f0b03c"
        />
      </svg>
    </span>
  );
}
