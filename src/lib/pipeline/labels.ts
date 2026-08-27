/**
 * Question-label parsing.
 *
 * Both sides of label matching go through `parseLabel`: the printed label on
 * the question paper and whatever the student scrawled on the answer sheet.
 * Matching then compares normalized paths, so "11(a)(ii)", "Q11 a ii" and
 * "11.a.ii" all resolve to the same question.
 *
 * Pure and dependency-free — this is the cheapest place in the codebase to be
 * thorough, and label mismatches are the most common cause of a wrongly
 * unmatched answer.
 */

/**
 * Leading words students and papers put before the actual label. Stripped
 * repeatedly, so "Ans. Q3" reduces to "3".
 */
const PREFIX_PATTERN =
  /^\s*(?:#|q(?:ues|uestion)?|ans(?:wer)?|sol(?:ution)?|no|number|part)\b\s*[.:)-]?\s*/i;

/**
 * A bare "q" glued to a number, as in "Q11". Handled separately from
 * `PREFIX_PATTERN` because there is no word boundary to anchor on.
 */
const GLUED_PREFIX_PATTERN = /^\s*[#qa](?=\d)/i;

const TOKEN_PATTERN = /[0-9]+|[a-z]+/gi;

/**
 * Parses a raw label into a normalized hierarchical path.
 *
 * Returns null when nothing label-like is present, which is the signal to fall
 * back to content-based matching rather than to guess.
 */
export function parseLabel(raw: string): string[] | null {
  let working = raw.trim().toLowerCase();
  if (!working) return null;

  // Strip prefixes until stable; "answer no. 4" needs two passes.
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
  // happened to be captured as a label, and matching it would be a false
  // positive.
  const path = tokens.filter((token) => token.length <= 4);
  if (path.length === 0 || path.length > 4) return null;

  return path;
}

/** Display form: first level plain, deeper levels parenthesized. */
export function formatLabel(path: readonly string[]): string {
  const [first, ...rest] = path;
  if (!first) return "";
  return first + rest.map((part) => `(${part})`).join("");
}

/** Stable, URL-safe id derived from a label path. */
export function labelToId(path: readonly string[]): string {
  return `q-${path.join("-")}`;
}

/** True when two parsed label paths refer to the same question. */
export function labelPathsEqual(
  a: readonly string[],
  b: readonly string[],
): boolean {
  return a.length === b.length && a.every((part, i) => part === b[i]);
}
