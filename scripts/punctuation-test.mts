/**
 * Unit tests for the punctuation layer. No API calls, so it runs in a second.
 *
 * Note the model itself converts spoken punctuation on Universal-3.5 Pro, which
 * is why "model" is the default mode. These cases cover the client-side layer
 * for the situations where it is needed — a different speech model, an unusual
 * command phrasing that survives as literal text, or a downstream system that
 * wants unpunctuated tokens.
 */
import { appendDictated, convertSpokenPunctuation } from "../lib/punctuation.ts";

const render = (text: string, mode: "spoken" | "assist" | "strip" = "spoken", preceding?: string) =>
  appendDictated("", convertSpokenPunctuation(text, { mode, precedingWord: preceding }));

const cases: [string, string, ("spoken" | "assist" | "strip")?][] = [
  ["Findings colon the colon appears normal with no thickening of the wall period",
   "Findings: the colon appears normal with no thickening of the wall."],
  ["impression colon fatty liver period nothing urgent period",
   "Impression: fatty liver. Nothing urgent."],
  ["the lungs are clear comma the heart is normal in size period",
   "The lungs are clear, the heart is normal in size."],
  ["sigmoid colon is unremarkable period", "Sigmoid colon is unremarkable."],
  ["transverse colon normal period descending colon normal period",
   "Transverse colon normal. Descending colon normal."],
  ["findings new line the chest is clear period new paragraph impression colon normal period",
   "Findings\nThe chest is clear.\n\nImpression: normal."],
  ["biopsy open paren left lobe close paren was negative period",
   "Biopsy (left lobe) was negative."],
  ["measures four hyphen five millimeters period", "Measures four-five millimeters."],
  ["is this correct question mark yes period", "Is this correct? Yes."],
  ["dose was five slash ten milligrams period", "Dose was five/ten milligrams."],
  ["no acute findings semicolon follow up in six months period",
   "No acute findings; follow up in six months."],
  // `assist` must never discard punctuation the model already produced.
  ["Findings: the colon appears normal.", "Findings: the colon appears normal.", "assist"],
  ["The lungs are clear, the heart is normal.", "The lungs are clear, the heart is normal.", "assist"],
  // The mixed case a real voice produces: the model converted some marks itself
  // but heard the rest as literal asides and fenced them with commas. `assist`
  // must clear the superseded commas without touching the marks it got right.
  ["Biopsy, open paren, left lobe, close paren, was negative, period. The lesion 5/10 mg; follow-up in 6 months. Is that correct?",
   "Biopsy (left lobe) was negative. The lesion 5/10 mg; follow-up in 6 months. Is that correct?", "assist"],
  ["Findings, colon, the chest is clear, period.", "Findings: the chest is clear.", "assist"],
  // `strip` hands back bare tokens.
  ["Findings: the colon appears normal.", "Findings the colon appears normal", "strip"],
];

let failures = 0;
for (const [input, want, mode] of cases) {
  const got = render(input, mode ?? "spoken");
  if (got !== want) {
    failures++;
    console.log(`FAIL [${mode ?? "spoken"}] ${input}`);
    console.log(`  got  ${JSON.stringify(got)}`);
    console.log(`  want ${JSON.stringify(want)}`);
  }
}

// A guard word can arrive in an earlier run than the command it guards.
const guarded = appendDictated(
  "The sigmoid",
  convertSpokenPunctuation("colon is unremarkable period", { mode: "spoken", precedingWord: "sigmoid" }),
);
if (guarded !== "The sigmoid colon is unremarkable.") {
  failures++;
  console.log(`FAIL cross-run guard\n  got ${JSON.stringify(guarded)}`);
}

// Runs arriving separately must join without double spaces or lost capitals.
let field = "";
for (const run of ["impression colon", "fatty liver period", "the colon is normal period"]) {
  field = appendDictated(field, convertSpokenPunctuation(run, { mode: "spoken", precedingWord: field.split(/\s+/).pop() }));
}
if (field !== "Impression: fatty liver. The colon is normal.") {
  failures++;
  console.log(`FAIL incremental append\n  got ${JSON.stringify(field)}`);
}

console.log(failures ? `\n${failures} failing case(s)` : `\nAll ${cases.length + 2} punctuation cases pass`);
process.exit(failures ? 1 : 0);
