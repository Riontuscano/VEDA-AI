/**
 * Copies the pdf.js worker into `public/` so it can be loaded from a stable
 * URL.
 *
 * The alternative — letting the bundler resolve the worker via
 * `new URL(..., import.meta.url)` — behaves differently under Webpack and
 * Turbopack. A plain file copy works identically in dev, in build, and on the
 * deployed server.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const source = path.join(
  path.dirname(require.resolve("pdfjs-dist/package.json")),
  "build",
  "pdf.worker.min.mjs",
);
const destination = path.resolve("public", "pdf.worker.min.mjs");

await mkdir(path.dirname(destination), { recursive: true });
await copyFile(source, destination);

console.log(`Copied pdf.js worker to ${path.relative(process.cwd(), destination)}`);
