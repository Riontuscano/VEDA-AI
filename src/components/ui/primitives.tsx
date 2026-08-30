import type { ReactNode } from "react";

type ChipTone = "neutral" | "positive" | "highlight" | "danger" | "accent";

const CHIP_TONES: Record<ChipTone, string> = {
  neutral:
    "text-[var(--text-tertiary)] border-[var(--border-strong)] bg-transparent",
  positive:
    "text-[var(--positive)] border-transparent bg-[var(--positive-wash)]",
  highlight:
    "text-[var(--highlight)] border-transparent bg-[var(--highlight-wash)]",
  danger: "text-[var(--danger)] border-transparent bg-[var(--danger-wash)]",
  accent: "text-[var(--accent)] border-transparent bg-[var(--accent-wash)]",
};

export function Chip({
  tone = "neutral",
  children,
}: {
  tone?: ChipTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[3px] border px-1.5 py-px font-mono text-[10.5px] font-medium uppercase tracking-[0.04em] ${CHIP_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function Button({
  variant = "primary",
  type = "button",
  disabled,
  onClick,
  children,
}: {
  variant?: "primary" | "ghost";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  const base =
    "inline-flex h-9 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] px-4 text-[13px] font-medium transition-[background-color,transform,border-color] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0";

  const styles =
    variant === "primary"
      ? "bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)] disabled:bg-[var(--border-strong)] disabled:text-[var(--text-tertiary)]"
      : "border border-[var(--border-strong)] text-[var(--text-secondary)] hover:border-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-50";

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`${base} ${styles}`}
    >
      {children}
    </button>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-[var(--text-tertiary)]">
      {children}
    </span>
  );
}
