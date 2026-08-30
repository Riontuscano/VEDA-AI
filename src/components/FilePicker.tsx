"use client";

import { FilePdf, FileImage, Plus, X } from "@phosphor-icons/react";
import { useId, useRef, useState } from "react";

import { FieldLabel } from "./ui/primitives";

export type FilePickerProps = {
  label: string;
  hint: string;
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
};

/**
 * Accepts a PDF or a set of images. Once files are chosen the drop target
 * collapses into a list, so the form isn't two big empty rectangles.
 */
export function FilePicker({
  label,
  hint,
  files,
  onChange,
  disabled,
}: FilePickerProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const openPicker = () => inputRef.current?.click();

  const removeAt = (index: number) =>
    onChange(files.filter((_, i) => i !== index));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <label htmlFor={inputId} className="text-[13px] font-medium">
          {label}
        </label>
        <FieldLabel>{hint}</FieldLabel>
      </div>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        multiple
        accept="application/pdf,image/png,image/jpeg"
        disabled={disabled}
        onChange={(event) => onChange(Array.from(event.target.files ?? []))}
        className="sr-only"
      />

      {files.length === 0 ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            if (!disabled) onChange(Array.from(event.dataTransfer.files));
          }}
          className={`rounded-[var(--radius)] border border-dashed transition-colors duration-150 ${
            isDragging
              ? "border-[var(--accent)] bg-[var(--accent-wash)]"
              : "border-[var(--border-strong)] bg-[var(--surface-raised)]"
          } ${disabled ? "opacity-50" : ""}`}
        >
          <button
            type="button"
            disabled={disabled}
            onClick={openPicker}
            className="flex w-full cursor-pointer flex-col items-center gap-1.5 px-4 py-7 disabled:cursor-not-allowed"
          >
            <Plus
              size={16}
              weight="bold"
              className="text-[var(--text-tertiary)]"
            />
            <span className="text-[13px] text-[var(--text-secondary)]">
              Drop a PDF or images, or{" "}
              <span className="text-[var(--accent)]">browse</span>
            </span>
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--radius)] border border-[var(--border-subtle)] bg-[var(--surface-raised)]">
          <ul className="divide-y divide-[var(--border-subtle)]">
            {files.map((file, index) => (
              <li
                key={`${file.name}-${file.size}-${index}`}
                className="flex items-center gap-2.5 px-3 py-2"
              >
                {file.type === "application/pdf" ? (
                  <FilePdf
                    size={15}
                    className="shrink-0 text-[var(--text-tertiary)]"
                  />
                ) : (
                  <FileImage
                    size={15}
                    className="shrink-0 text-[var(--text-tertiary)]"
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {file.name}
                </span>
                <span className="font-mono text-[11px] text-[var(--text-tertiary)]">
                  {formatSize(file.size)}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeAt(index)}
                  aria-label={`Remove ${file.name}`}
                  className="cursor-pointer rounded p-0.5 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-not-allowed"
                >
                  <X size={13} weight="bold" />
                </button>
              </li>
            ))}
          </ul>

          <button
            type="button"
            disabled={disabled}
            onClick={openPicker}
            className="w-full cursor-pointer border-t border-[var(--border-subtle)] px-3 py-1.5 text-left text-[12px] text-[var(--accent)] transition-colors hover:bg-[var(--accent-wash)] disabled:cursor-not-allowed"
          >
            Replace files
          </button>
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
