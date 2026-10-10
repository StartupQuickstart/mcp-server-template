/** Hard cap on the size of any one tool result, in characters. */
export const MAX_RESULT_CHARS = 30_000;

const TRUNCATION_NOTICE = '\n\n[Result shortened to fit the size limit. Narrow the request to see the rest.]';

/** Collapses runs of whitespace (including newlines) so a value fits on one line. */
export function toSingleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Applies the size cap to a finished result. It is applied to every tool, so a
 * handler cannot return an unbounded result by accident. Treat it as a safety
 * net, not as paging: give each tool its own smaller budget.
 *
 * @param text - The result text.
 * @param maxChars - The cap; defaults to `MAX_RESULT_CHARS`.
 * @returns The text unchanged, or cut with a notice when over the cap.
 */
export function capResult(text: string, maxChars: number = MAX_RESULT_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - TRUNCATION_NOTICE.length))}${TRUNCATION_NOTICE}`;
}

/**
 * Quotes text that came from stored data line by line, so that a line inside
 * it reads as a quotation and never as the tool's own words.
 *
 * @param text - Untrusted text from the API.
 * @returns The text as a Markdown block quote.
 */
export function quoteUntrusted(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');
}
