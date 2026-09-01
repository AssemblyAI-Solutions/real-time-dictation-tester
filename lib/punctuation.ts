/**
 * Spoken punctuation: turning dictated command words ("period", "new line")
 * into the marks they stand for.
 *
 * Speech models punctuate for you, which is right for prose but wrong for
 * dictation, where the speaker expects to control the marks themselves. The
 * three modes below cover the usual choices, and the command table is data so
 * an application can extend it without touching the matching logic.
 */

/**
 * Universal-3.5 Pro converts spoken punctuation itself — "period" becomes ".",
 * "open paren" becomes "(", and it renders "four hyphen five millimeters" as
 * "4-5 mm". It consumes the command words in the process, so an application
 * rarely needs to convert anything. These modes exist for the cases where it
 * does: a different speech model, an unusual command phrasing that survives as
 * literal text, or a downstream system that wants unpunctuated tokens.
 */
export type PunctuationMode =
  /** Keep the model's punctuation exactly as returned. The usual choice. */
  | "model"
  /**
   * Keep the model's punctuation, and additionally convert any command words it
   * left as literal text. A safety net that cannot lose correct punctuation.
   */
  | "assist"
  /** Remove sentence punctuation and apply nothing — the raw token stream. */
  | "strip"
  /**
   * Remove the model's punctuation, then apply the speaker's commands. Only
   * sensible if you have verified the command words survive transcription;
   * on U-3.5 Pro they usually do not, leaving the text unpunctuated.
   */
  | "spoken";

export interface SpokenRule {
  /** Phrases that trigger the rule, lower case, longest matched first. */
  say: string[];
  /** What to emit. */
  emit: string;
  /**
   * `attach` joins to the previous word with no space (`.`, `,`).
   * `space` stands alone (`(`, `"`).
   * `break` is a line break.
   */
  spacing: "attach" | "space" | "break";
  /** Whether the following word joins with no space too (`-`, `/`, `(`). */
  attachesNext?: boolean;
  /** Whether the next word starts a new sentence. */
  capitalisesNext?: boolean;
  label: string;
}

export const SPOKEN_RULES: SpokenRule[] = [
  { say: ["period", "full stop"], emit: ".", spacing: "attach", capitalisesNext: true, label: "period" },
  { say: ["comma"], emit: ",", spacing: "attach", label: "comma" },
  { say: ["colon"], emit: ":", spacing: "attach", label: "colon" },
  { say: ["semicolon", "semi colon"], emit: ";", spacing: "attach", label: "semicolon" },
  { say: ["question mark"], emit: "?", spacing: "attach", capitalisesNext: true, label: "question mark" },
  { say: ["exclamation mark", "exclamation point"], emit: "!", spacing: "attach", capitalisesNext: true, label: "exclamation" },
  { say: ["new paragraph"], emit: "\n\n", spacing: "break", capitalisesNext: true, label: "new paragraph" },
  { say: ["new line", "next line"], emit: "\n", spacing: "break", capitalisesNext: true, label: "new line" },
  { say: ["open parenthesis", "open paren", "left parenthesis"], emit: "(", spacing: "space", attachesNext: true, label: "open paren" },
  { say: ["close parenthesis", "close paren", "right parenthesis"], emit: ")", spacing: "attach", label: "close paren" },
  { say: ["open quote", "quote unquote"], emit: '"', spacing: "space", attachesNext: true, label: "open quote" },
  { say: ["close quote", "end quote", "unquote"], emit: '"', spacing: "attach", label: "close quote" },
  { say: ["hyphen", "dash"], emit: "-", spacing: "attach", attachesNext: true, label: "hyphen" },
  { say: ["forward slash", "slash"], emit: "/", spacing: "attach", attachesNext: true, label: "slash" },
  { say: ["ellipsis", "dot dot dot"], emit: "…", spacing: "attach", label: "ellipsis" },
];

/**
 * Words that keep their literal meaning when they follow one of these.
 *
 * "Colon" is the awkward one: it is a mark and an organ. "The colon appears
 * normal" must survive, while "impression colon" must become "Impression:".
 * Looking at the preceding word settles almost every real case, and the list is
 * editable so a deployment can tune it for its own vocabulary.
 */
export const DEFAULT_GUARD_WORDS = [
  "the", "a", "an", "his", "her", "their",
  "sigmoid", "transverse", "ascending", "descending",
  "proximal", "distal", "entire", "whole", "redundant",
];

const SENTENCE_PUNCTUATION = /[.,;:!?]/g;

/** Longest-first so "new paragraph" wins over "new line", "semi colon" over "colon". */
const MATCHERS = SPOKEN_RULES.flatMap((rule) =>
  rule.say.map((phrase) => ({ phrase, words: phrase.split(" "), rule })),
).sort((a, b) => b.words.length - a.words.length);

const normalise = (word: string) => word.toLowerCase().replace(/[.,;:!?]+$/, "");

export interface ConvertOptions {
  mode: PunctuationMode;
  guardWords?: string[];
  /** Rule labels to leave switched off. */
  disabled?: string[];
  /**
   * Last word already in the field. Text arrives in runs, so a command can be
   * separated from the word that guards it — "sigmoid" in one run and "colon" in
   * the next. Without this the guard cannot fire.
   */
  precedingWord?: string;
}

interface Token {
  text: string;
  rule?: SpokenRule;
}

/**
 * Converts one span of dictated text. Pure and context-free, so it can run on a
 * partial as safely as on a final; spacing against preceding text is applied
 * separately by `appendDictated`.
 */
export function convertSpokenPunctuation(text: string, options: ConvertOptions): string {
  if (options.mode === "model") return text;

  // `assist` keeps whatever the model already punctuated and only fills gaps.
  const source = options.mode === "assist" ? text : text.replace(SENTENCE_PUNCTUATION, "");
  const words = source.split(/\s+/).filter(Boolean);
  if (options.mode === "strip") return words.join(" ");

  const guards = new Set((options.guardWords ?? DEFAULT_GUARD_WORDS).map((w) => w.toLowerCase()));
  const disabled = new Set(options.disabled ?? []);
  const tokens: Token[] = [];

  for (let i = 0; i < words.length; i++) {
    const match = MATCHERS.find((candidate) => {
      if (disabled.has(candidate.rule.label)) return false;
      if (i + candidate.words.length > words.length) return false;
      return candidate.words.every((w, k) => normalise(words[i + k]) === w);
    });

    // A command word keeps its literal sense when the previous word marks it as
    // one — "the colon" is an organ, "impression colon" is a mark. The previous
    // word may live in an earlier run, hence `precedingWord`.
    const previous = tokens.length
      ? normalise(tokens[tokens.length - 1].text)
      : options.precedingWord
        ? normalise(options.precedingWord)
        : null;
    if (match && !(previous && guards.has(previous))) {
      tokens.push({ text: match.rule.emit, rule: match.rule });
      i += match.words.length - 1;
      continue;
    }
    tokens.push({ text: words[i] });
  }

  return joinTokens(tokens);
}

function joinTokens(tokens: Token[]): string {
  let out = "";
  let capitaliseNext = false;
  let attachNext = false;

  for (const token of tokens) {
    const spacing = token.rule?.spacing ?? "space";
    let piece = token.text;

    if (!token.rule && capitaliseNext) {
      piece = piece.charAt(0).toUpperCase() + piece.slice(1);
      capitaliseNext = false;
    }

    // A model that hears "open paren" as an aside fences it with commas, leaving
    // "Biopsy, (left lobe,)". Clear the mark the dictated one supersedes — but
    // only where it genuinely is superseded:
    //   attach marks (. , ; :) replace whatever preceded them;
    //   an opening bracket or quote only clears a comma, never a sentence end;
    //   a line break clears a comma but keeps the full stop before it.
    if (token.rule) {
      if (spacing === "attach") out = out.replace(/[.,;:!?]+$/, "");
      else out = out.replace(/,+$/, "");
    }

    if (!out) out = piece;
    else if (spacing === "attach" || attachNext) out += piece;
    else if (spacing === "break") out = out.replace(/\s+$/, "") + piece;
    else out += (out.endsWith("\n") ? "" : " ") + piece;

    attachNext = token.rule?.attachesNext ?? false;
    if (token.rule?.capitalisesNext) capitaliseNext = true;
  }
  return out;
}

/**
 * Appends newly dictated text to what a field already holds, getting the join
 * right: no space before an attaching mark, and a capital after a sentence end.
 */
export function appendDictated(existing: string, incoming: string): string {
  const addition = incoming.trim();
  if (!addition) return existing;
  if (!existing) return capitaliseFirst(addition);

  const attaches = /^[.,;:!?)"…]/.test(addition);
  const afterBreak = /\n\s*$/.test(existing);
  const afterSentenceEnd = /[.!?]["')\]]?\s*$/.test(existing);
  const startsWithBreak = addition.startsWith("\n");

  const body = afterSentenceEnd || afterBreak ? capitaliseFirst(addition) : addition;
  if (attaches || startsWithBreak) return existing.replace(/\s+$/, "") + body;
  if (afterBreak) return existing + body;
  return `${existing} ${body}`;
}

function capitaliseFirst(text: string): string {
  const index = text.search(/[A-Za-z]/);
  if (index < 0) return text;
  return text.slice(0, index) + text.charAt(index).toUpperCase() + text.slice(index + 1);
}

/** One-line summary of the active commands, for display. */
export function describeRules(disabled: string[] = []): string {
  return SPOKEN_RULES.filter((r) => !disabled.includes(r.label))
    .map((r) => `${r.say[0]} → ${r.emit === "\n" ? "⏎" : r.emit === "\n\n" ? "¶" : r.emit}`)
    .join("   ");
}
