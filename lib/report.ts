export interface ReportField {
  id: string;
  label: string;
  /** Section headers are not dictation targets. */
  header?: boolean;
  indent?: boolean;
  placeholder?: string;
  /**
   * What a radiologist dictates into this field, in plain words. Becomes the
   * `prompt` sent when the cursor lands here — context about the audio, not an
   * instruction to the model.
   */
  hint?: string;
  /**
   * Spellings this field owns, sent as `keyterms_prompt`. Worth listing where a
   * term is a homophone of one belonging to another field: nothing in the audio
   * separates "ileum" (small bowel) from "ilium" (hip bone), so the cursor is
   * the only signal that can.
   */
  keyterms?: string[];
}

/** The study under dictation. The one piece of context every section shares. */
export const STUDY_CONTEXT = "CT of the abdomen and pelvis with intravenous contrast";

/** A representative structured radiology reporting template. */
export const REPORT_TEMPLATE: ReportField[] = [
  {
    id: "examination",
    label: "EXAMINATION",
    placeholder: "[ ]",
    hint: "the modality, the body region imaged, and the contrast protocol",
    keyterms: ["intravenous contrast", "CT"],
  },
  {
    id: "clinical_history",
    label: "CLINICAL HISTORY",
    placeholder: "[ ]",
    hint: "the presenting symptoms, their duration, and relevant prior conditions",
  },
  {
    id: "comparison",
    label: "COMPARISON",
    placeholder: "[ ]",
    hint: "a reference to a prior imaging study and its date, or the word none",
    keyterms: ["prior study"],
  },
  {
    id: "technique",
    label: "TECHNIQUE",
    placeholder: "[ ]",
    hint: "the acquisition protocol, slice thickness, phase, and contrast timing",
  },
  { id: "findings", label: "FINDINGS", header: true },
  {
    id: "paranasal_sinuses",
    label: "Paranasal sinuses",
    indent: true,
    placeholder: "[Normal]",
    hint: "the paranasal sinuses, mucosal thickening, and air-fluid levels",
    keyterms: ["ethmoid", "maxillary sinus", "mucosal thickening"],
  },
  {
    id: "chest",
    label: "Chest",
    indent: true,
    placeholder: "[Normal]",
    hint: "the lungs, pleura, heart size, and mediastinum",
    keyterms: ["pleural effusion", "atelectasis", "mediastinum"],
  },
  {
    id: "abdomen",
    label: "Abdomen",
    indent: true,
    placeholder: "[Normal]",
    hint: "the liver, spleen, pancreas, adrenal glands, bowel, and the terminal ileum",
    keyterms: ["hepatic steatosis", "ileum", "terminal ileum", "adenopathy"],
  },
  {
    id: "pelvis",
    label: "Pelvis",
    indent: true,
    placeholder: "[Normal]",
    hint: "the bladder, pelvic organs, pelvic bones including the ilium, and free fluid",
    keyterms: ["ilium", "sacroiliac", "perineal"],
  },
  {
    id: "shoulder",
    label: "Shoulder",
    indent: true,
    placeholder: "[Normal]",
    hint: "the rotator cuff, glenohumeral joint, and acromion",
    keyterms: ["supraspinatus", "glenohumeral", "acromion"],
  },
  {
    id: "knee",
    label: "Knee",
    indent: true,
    placeholder: "[Normal]",
    hint: "the menisci, cruciate ligaments, and the common peroneal nerve",
    keyterms: ["peroneal", "meniscus", "cruciate"],
  },
  {
    id: "impression",
    label: "IMPRESSION",
    placeholder: "",
    hint: "the concise summary diagnosis and any recommended follow-up",
  },
];

export const DICTATABLE_FIELDS = REPORT_TEMPLATE.filter((f) => !f.header);

export function emptyReport(): Record<string, string> {
  return Object.fromEntries(DICTATABLE_FIELDS.map((f) => [f.id, ""]));
}

export interface SectionContext {
  /** Natural-language description of what is being dictated at the cursor. */
  prompt: string;
  /** Exact spellings this section owns. */
  keyterms: string[];
  /** "FINDINGS > Abdomen" — for display and logging. */
  path: string;
}

/** The nearest preceding header, so an indented field carries its parent section. */
function parentHeader(index: number): ReportField | null {
  for (let i = index - 1; i >= 0; i--) {
    if (REPORT_TEMPLATE[i].header) return REPORT_TEMPLATE[i];
  }
  return null;
}

/**
 * Builds the context to send when the cursor lands in a field.
 *
 * Composed from the template rather than hand-written per field, so adding a
 * section to `REPORT_TEMPLATE` gives it a prompt for free. The result is a
 * description of the audio — the domain, the study, and the part of the report
 * being spoken — which is what `prompt` is for. Formatting or behavioural
 * instructions do not belong here and are not supported.
 */
export function sectionContextFor(fieldId: string): SectionContext | null {
  const index = REPORT_TEMPLATE.findIndex((f) => f.id === fieldId);
  if (index < 0) return null;
  const field = REPORT_TEMPLATE[index];
  if (field.header) return null;

  const parent = field.indent ? parentHeader(index) : null;
  const path = parent ? `${parent.label} > ${field.label}` : field.label;

  const where = parent
    ? `the ${field.label.toUpperCase()} subsection of the ${parent.label} section`
    : `the ${field.label} section`;

  const prompt =
    `Radiology report dictation. ${STUDY_CONTEXT}. ` +
    `The radiologist is dictating ${where} of the report` +
    (field.hint ? `: ${field.hint}.` : ".");

  return { prompt, keyterms: field.keyterms ?? [], path };
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
