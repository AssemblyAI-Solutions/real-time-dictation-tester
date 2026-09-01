export interface ReportField {
  id: string;
  label: string;
  /** Section headers are not dictation targets. */
  header?: boolean;
  indent?: boolean;
  placeholder?: string;
}

/** A representative structured radiology reporting template. */
export const REPORT_TEMPLATE: ReportField[] = [
  { id: "examination", label: "EXAMINATION", placeholder: "[ ]" },
  { id: "clinical_history", label: "CLINICAL HISTORY", placeholder: "[ ]" },
  { id: "comparison", label: "COMPARISON", placeholder: "[ ]" },
  { id: "technique", label: "TECHNIQUE", placeholder: "[ ]" },
  { id: "findings", label: "FINDINGS", header: true },
  { id: "paranasal_sinuses", label: "Paranasal sinuses", indent: true, placeholder: "[Normal]" },
  { id: "chest", label: "Chest", indent: true, placeholder: "[Normal]" },
  { id: "abdomen", label: "Abdomen", indent: true, placeholder: "[Normal]" },
  { id: "pelvis", label: "Pelvis", indent: true, placeholder: "[Normal]" },
  { id: "shoulder", label: "Shoulder", indent: true, placeholder: "[Normal]" },
  { id: "knee", label: "Knee", indent: true, placeholder: "[Normal]" },
  { id: "impression", label: "IMPRESSION", placeholder: "" },
];

export const DICTATABLE_FIELDS = REPORT_TEMPLATE.filter((f) => !f.header);

export function emptyReport(): Record<string, string> {
  return Object.fromEntries(DICTATABLE_FIELDS.map((f) => [f.id, ""]));
}

/**
 * Spoken navigation commands. Opt-in, since most reporting applications handle
 * field switching themselves — it exists to show the committed-text stream is
 * usable for command detection the moment a word lands, not only at end of turn.
 */
const NEXT_PATTERNS = [/^next field$/i, /^next$/i, /^tab$/i];
const PREV_PATTERNS = [/^previous field$/i, /^back$/i, /^go back$/i];

export type VoiceCommand =
  | { kind: "next" }
  | { kind: "previous" }
  | { kind: "goto"; fieldId: string }
  | null;

export function detectCommand(phrase: string): VoiceCommand {
  const clean = phrase.trim().replace(/[.,;:!?]+$/, "");
  if (NEXT_PATTERNS.some((r) => r.test(clean))) return { kind: "next" };
  if (PREV_PATTERNS.some((r) => r.test(clean))) return { kind: "previous" };

  const gotoMatch = clean.match(/^(?:go to|jump to|select)\s+(.+)$/i);
  if (gotoMatch) {
    const target = gotoMatch[1].toLowerCase();
    const field = DICTATABLE_FIELDS.find(
      (f) => f.label.toLowerCase() === target || f.label.toLowerCase().includes(target),
    );
    if (field) return { kind: "goto", fieldId: field.id };
  }
  return null;
}
