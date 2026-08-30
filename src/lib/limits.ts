// Separate from config.ts so client components can import these without
// pulling server config into the browser bundle. The server enforces the real
// values from env; these just drive UI copy and a fail-fast check.
export const PUBLIC_LIMITS = {
  maxPagesPerDocument: 20,
  maxPageBytes: 8 * 1024 * 1024,
} as const;
