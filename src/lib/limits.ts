/**
 * Upload limits shared by client and server.
 *
 * Kept in their own module — free of `process.env` and of the config schema —
 * so importing them into a client component cannot pull the server
 * configuration into the browser bundle.
 *
 * These are the defaults. The server reads its effective values from the
 * environment and is the real enforcement point; these exist so the UI can
 * describe the limits and fail fast before a pointless upload.
 */
export const PUBLIC_LIMITS = {
  maxPagesPerDocument: 20,
  maxPageBytes: 8 * 1024 * 1024,
} as const;
