/**
 * Question-label parsing.
 *
 * Both the printed label and whatever the student scrawled go through
 * `parseLabel`, so "11(a)(ii)", "Q11 a ii" and "11.a.ii" all match.
 */

/** Leading words that appear before the real label. Stripped repeatedly. */
const PREFIX_PATTERN =
  /^\s*(?:#|q(?:ues|uestion)?|ans(?:wer)?|sol(?:ution)?|no|number|part)\b\s*[.:)-]?\s*/i;

/** "Q11" has no word boundary to anchor on, so it needs its own pattern. */
const GLUED_PREFIX_PATTERN = /^\s*[#qa](?=\d)/i;

const TOKEN_PATTERN = /[0-9]+|[a-z]+/gi;

/** Returns null when nothing label-like is present, so callers can fall back. */
export function parseLabel(raw: string): string[] | null {
  let working = raw.trim().toLowerCase();
  if (!working) return null;

  // "answer no. 4" needs two passes.
  for (;;) {
    const stripped = working
      .replace(PREFIX_PATTERN, "")
      .replace(GLUED_PREFIX_PATTERN, "");
    if (stripped === working) break;
    working = stripped;
  }

  const tokens = working.match(TOKEN_PATTERN);
  if (!tokens) return null;

  // A label is a short run of identifiers. Anything longer is a sentence that
  // got captured as a label, and matching it would be a false positive.
  const path = tokens.filter((token) => token.length <= 4);
  if (path.length === 0 || path.length > 4) return null;

  return path;
}

/** "11(a)(ii)" from ["11","a","ii"]. */
export function formatLabel(path: readonly string[]): string {
  const [first, ...rest] = path;
  if (!first) return "";
  return first + rest.map((part) => `(${part})`).join("");
}

export function labelToId(path: readonly string[]): string {
  return `q-${path.join("-")}`;
}

export function labelPathsEqual(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return a.length === b.length && a.every((part, i) => part === b[i]);
}
