"use client";

import { useId, useRef, useState } from "react";

export type FilePickerProps = {
  label: string;
  hint: string;
  files: File[];
  onChange: (files: File[]) => void;
  disabled: boolean;
};

/**
 * File input for one of the two documents.
 *
 * Accepts a PDF or a set of images — a phone photo per page is the common case
 * for answer sheets, and a PDF for the printed paper.
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

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    onChange(Array.from(event.dataTransfer.files));
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-900">
        {label}
      </label>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          isDragging
            ? "border-blue-500 bg-blue-50"
            : "border-slate-300 bg-white"
        } ${disabled ? "opacity-60" : ""}`}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept="application/pdf,image/png,image/jpeg"
          disabled={disabled}
          onChange={(event) =>
            onChange(Array.from(event.target.files ?? []))
          }
          className="sr-only"
        />

        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed"
        >
          Choose files
        </button>

        <p className="mt-2 text-xs text-slate-500">{hint}</p>

        {files.length > 0 && (
          <ul className="mt-3 space-y-1 text-left text-xs text-slate-700">
            {files.map((file) => (
              <li key={`${file.name}-${file.size}`} className="truncate">
                {file.name}{" "}
                <span className="text-slate-400">
                  ({Math.round(file.size / 1024)} KB)
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
