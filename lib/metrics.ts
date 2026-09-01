export interface LatencySample {
  /** Word text as rendered. */
  text: string;
  /** End of the word on the audio timeline, ms from stream start. */
  audioEndMs: number;
  /** Wall-clock ms from stream start at which the word was rendered. */
  renderedAtMs: number;
  /** renderedAtMs - audioEndMs: how long after it was spoken the word appeared. */
  lagMs: number;
}

export interface Metrics {
  turns: number;
  partials: number;
  finals: number;
  forcedEndpoints: number;
  /** Words that changed on screen after having been rendered. */
  revisedWords: number;
  wordsRendered: number;
  /** ms from SpeechStarted to the turn's first rendered text, per turn. */
  ttft: number[];
  /** Gaps between consecutive on-screen text updates while speech was active. */
  updateGaps: number[];
  /** Time from a word being spoken to it first appearing on screen. */
  lag: LatencySample[];
  /** Time from a word being spoken to it becoming final — i.e. safe from revision. */
  commitLag: LatencySample[];
}

export const EMPTY_METRICS: Metrics = {
  turns: 0,
  partials: 0,
  finals: 0,
  forcedEndpoints: 0,
  revisedWords: 0,
  wordsRendered: 0,
  ttft: [],
  updateGaps: [],
  lag: [],
  commitLag: [],
};

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Longest common word-wise prefix across a set of partial word arrays. */
export function commonPrefixLength(candidates: string[][]): number {
  if (!candidates.length) return 0;
  const shortest = Math.min(...candidates.map((c) => c.length));
  let i = 0;
  while (i < shortest) {
    const word = candidates[0][i];
    if (!candidates.every((c) => c[i] === word)) break;
    i++;
  }
  return i;
}

export function stripPunctuation(text: string): string {
  // Removes sentence punctuation so the caller can apply its own spoken-punctuation
  // rules. Keeps hyphens and apostrophes, which carry meaning in clinical terms.
  return text.replace(/[.,;:!?]/g, "").replace(/\s{2,}/g, " ");
}
