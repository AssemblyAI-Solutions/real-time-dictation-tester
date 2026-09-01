export interface ScriptStep {
  /** Field to be in before reading `say`. */
  field: string;
  say: string;
}

export interface TestScript {
  id: string;
  name: string;
  /** What this script is designed to expose. */
  purpose: string;
  /** How to read it aloud for the test to mean anything. */
  how: string;
  /** Plain prose scripts. Empty when the script is step-based. */
  text: string;
  /** Field-by-field scripts, rendered as a checklist with switch cues. */
  steps?: ScriptStep[];
}

/**
 * Plain-English dictation scripts. Deliberately light on terminology — the point
 * is to exercise latency, revision, and punctuation behaviour, not to test whether
 * the model knows anatomy.
 */
export const TEST_SCRIPTS: TestScript[] = [
  {
    id: "deadair",
    name: "1. Dead air",
    purpose:
      "Shows why finals-only integrations feel unresponsive. Read straight through and the whole passage comes back as a single turn, so nothing appears until you stop.",
    how: "Read at a normal pace and do not pause. Roughly 25 seconds.",
    text: `The chest looks clear with no sign of fluid or infection. The heart is normal in size. Both lungs are fully inflated. There is no broken bone or other injury to the ribs. The upper abdomen looks normal, with no swelling of the liver or spleen. I see no enlarged lymph nodes anywhere in the chest.`,
  },
  {
    id: "colon",
    name: "2. Spoken punctuation",
    purpose:
      "Dictated punctuation works out of the box on every sentence — the model converts it. Watch “period”, “comma” and “colon” arrive as marks. “New line” is not rendered as a break; handle layout in your own UI.",
    how: "Read it exactly as written, including the command words, at normal pace. Leave punctuation mode on “model”.",
    text: `Findings colon the lungs are clear comma the heart is normal in size period new line There is no pleural effusion period new paragraph Impression colon no acute abnormality period`,
  },
  {
    id: "colon-organ",
    name: "3. The colon problem",
    purpose:
      "“Colon” is both a mark and an organ, and both readings appear here. Compare punctuation modes: “model” lets the model decide, “assist” adds guard-word rules on top, “strip” hands you the raw tokens.",
    how: "Read straight through. The first and last “colon” are marks; the middle ones are anatomy.",
    text: `Findings colon the colon appears normal with no wall thickening period The sigmoid colon is unremarkable period Impression colon normal colon period`,
  },
  {
    id: "punct-freeform",
    name: "4. Punctuation, freeform",
    purpose:
      "Brackets, hyphens, slashes, semicolons and questions — the marks a report actually needs. Check the ones you depend on before wiring this into your own app.",
    how: "Read at a normal pace. Try each punctuation mode on the same reading and compare.",
    text: `Biopsy open paren left lobe close paren was negative period The lesion measures four hyphen five millimeters period Dose was five slash ten milligrams semicolon follow up in six months period Is that correct question mark`,
  },
  {
    id: "numbers",
    name: "5. Numbers and dates",
    purpose:
      "Measurements and dates are where entity formatting shows up — and where text is most likely to get revised as the model gathers context.",
    how: "Read at a normal pace. Watch the preview text change on “four millimeters”.",
    text: `There is a small round spot in the right lung measuring four millimeters. A second spot in the left lung measures one point two centimeters. Compared with the scan from March third, two thousand twenty four, both spots are unchanged.`,
  },
  {
    id: "fields",
    name: "6. Field switching (keyboard)",
    purpose:
      "The main event. Each ⌥↓ marker is a keystroke, not something you say. With the pause, every line should land in its own field. Read straight through instead and boundaries can land within a word either side — try both.",
    how: "Read a line, pause about half a second, press ⌥↓, then read the next. The pause is what makes the split exact — it gives the model a real turn boundary.",
    steps: [
      { field: "EXAMINATION", say: "CT of the abdomen and pelvis with contrast." },
      { field: "CLINICAL HISTORY", say: "Ongoing pain in the upper right side for three weeks." },
      { field: "COMPARISON", say: "Compared with the scan from last March." },
      { field: "TECHNIQUE", say: "Standard scan taken after contrast was given." },
      { field: "Paranasal sinuses", say: "Not included in this study." },
      { field: "Chest", say: "The lungs are clear and the heart is normal in size." },
      { field: "Abdomen", say: "The liver shows some fatty change. Everything else looks normal." },
      { field: "Pelvis", say: "No fluid and no swollen lymph nodes." },
      { field: "Shoulder", say: "Not included." },
      { field: "Knee", say: "Not included." },
      { field: "IMPRESSION", say: "Fatty liver. Nothing here needs urgent attention." },
    ],
    text: "",
  },
  {
    id: "misroute",
    name: "7. Misrouting (switch fast)",
    purpose:
      "Shows why routing has to follow the audio. Untick “route by capture time” and run this — the tail of each sentence lands in the field you just moved to. Tick it back on and the same reading lands correctly.",
    how: "Read each line and press ⌥↓ the instant you finish the last word — no pause at all.",
    steps: [
      { field: "Chest", say: "The lungs are clear." },
      { field: "Abdomen", say: "The liver looks normal." },
      { field: "Pelvis", say: "No fluid collection." },
      { field: "IMPRESSION", say: "Nothing urgent." },
    ],
    text: "",
  },
  {
    id: "stopstart",
    name: "8. Stop and start",
    purpose:
      "Short bursts with real pauses — the case the model handles well. Compare the lag numbers against script 1 to see how much the pauses were doing.",
    how: "Read one sentence, pause for a full second, then the next.",
    text: `The lungs are clear. … The heart is normal in size. … There is no fluid around the lungs. … Nothing here needs urgent attention.`,
  },
];
