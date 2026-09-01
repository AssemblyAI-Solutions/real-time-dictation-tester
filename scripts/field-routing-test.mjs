import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

// Drives the real UI in Chrome with a WAV standing in for the microphone, presses
// the field-switch keystroke at known points in the audio, and asserts each
// phrase landed in the field that was active when it was spoken.
const DIR = process.env.FIXTURES ?? "fixtures";
const BASE = process.env.BASE_URL ?? "http://localhost:3000/";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// getUserMedia plus AudioContext start-up means audio time 0 lands after the
// RECORD click. Without this the harness presses early and words spill forward.
const PRESS_OFFSET_MS = Number(process.env.PRESS_OFFSET_MS ?? 250);
const GAPPED = { wav: "fields.wav", marks: "fields.json", tail: 9000 };
// The hard case: one unbroken utterance, so every switch lands mid-turn.
const CONTINUOUS = { wav: "fields-continuous.wav", marks: "fields-continuous.json", tail: 11000 };
// What reading continuously actually sounds like: a short pause at each line end.
const NATURAL = { wav: "fields-natural.wav", marks: "fields-natural.json", tail: 11000 };
const EXPECT = [
  { field: "Chest", must: "lungs", exact: "the lungs are clear" },
  { field: "Abdomen", must: "liver", exact: "the liver looks normal" },
  { field: "Pelvis", must: "fluid", exact: "no fluid collection" },
  { field: "Shoulder", must: "urgent", exact: "nothing urgent here" },
];

const norm = (t) => t.toLowerCase().replace(/[.,;:!?]/g, "").replace(/\s+/g, " ").trim();

async function run({ engine, routeByCapture, preset, fixture = GAPPED, lagMs = 0, forceEndpoint }) {
  const marks = JSON.parse(fs.readFileSync(`${DIR}/${fixture.marks}`));
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${DIR}/${fixture.wav}%noloop`],
  });
  const page = await (await browser.newContext({ permissions: ["microphone"], viewport: { width: 1500, height: 950 } })).newPage();
  page.on("pageerror", (e) => console.log(`  [PAGEERROR] ${e.message}`));
  await page.goto(BASE, { waitUntil: "networkidle" });

  if (engine === "dictation") await page.getByRole("button", { name: "Dictation API" }).click();
  if (preset) await page.getByRole("button", { name: new RegExp(preset) }).first().click();
  if (!routeByCapture) await page.getByText("route by capture time").click();
  // Off by default; clicking turns it on.
  if (forceEndpoint) await page.getByText("endpointOnFieldChange").click();

  // Start on Chest.
  await page.getByText("Chest:", { exact: true }).click();

  const t0 = Date.now();
  await page.getByRole("button", { name: /RECORD/ }).click();
  for (const m of marks.slice(0, 3)) {
    // lagMs models a human pressing after they finish the line, which is what
    // happens when reading continuously rather than pausing at each boundary.
    const wait = m.pressAtMs + PRESS_OFFSET_MS + lagMs - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.keyboard.press("Alt+ArrowDown");
  }
  await page.waitForTimeout(fixture.tail);
  await page.getByRole("button", { name: /STOP/ }).click();
  await page.waitForTimeout(3500);

  const got = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll("div.rounded-md.border-2 div.group")].map((d) => {
      const label = d.querySelector("span")?.textContent?.replace(/:$/, "") ?? "";
      const ta = d.querySelector("textarea");
      const val = ta ? ta.value : (d.querySelectorAll("span")[1]?.textContent ?? "");
      return [label, val.trim()];
    })));
  await browser.close();
  return got;
}

// Next compiles routes on first request. Without warming them, the first timed
// run absorbs several hundred ms of compile latency, which shifts the keypress
// timing enough to move a field boundary.
async function warmup() {
  try {
    await fetch(BASE);
    await fetch(new URL("/api/token", BASE));
    process.stdout.write("warmed dev server\n");
  } catch {
    console.error(`Could not reach ${BASE} — is \`npm run dev\` running?`);
    process.exit(2);
  }
}
await warmup();

const FOCUS = process.env.FOCUS;
const REPEAT = Number(process.env.REPEAT ?? 1);

let failures = 0;
for (const cfg of [
  // --- phrases separated by 800ms of silence: each becomes its own turn ---
  { engine: "streaming", routeByCapture: true, preset: "Stable-commit", expect: 4,
    label: "GAPPED  · streaming stable-commit · per-word routing" },
  { engine: "dictation", routeByCapture: true, expect: 4,
    label: "GAPPED  · dictation · capture-time routing" },
  { engine: "streaming", routeByCapture: false, preset: "Finals only",
    label: "GAPPED  · streaming finals-only · delivery-time (naive)" },

  // --- one unbroken utterance: switches land mid-turn, nothing to route on ---
  // Exact boundaries are not asserted on gapless audio: with no pause between
  // phrases a keystroke lands inside a word, and the midpoint rule resolves it to
  // within one word either way. Routing of each phrase's content is what matters.
  { engine: "streaming", routeByCapture: true, preset: "Stable-commit", expect: 4, fixture: CONTINUOUS,
    label: "MIDTURN · streaming stable-commit · per-word routing" },
  // Pressed 300ms late, as happens when reading continuously. Snapping should pull
  // the boundary back to the pause the reader actually meant.
  // Reading continuously with a short pause at each line end, pressing on time.
  { engine: "streaming", routeByCapture: true, preset: "Stable-commit", expect: 4, fixture: NATURAL,
    label: "NATURAL · stable-commit · per-word routing" },
  // ForceEndpoint on the switch, for comparison: the cut can land mid-word and
  // duplicate the fragment. No expectation asserted.
  { engine: "streaming", routeByCapture: true, preset: "Stable-commit", fixture: NATURAL,
    forceEndpoint: true, label: "NATURAL · stable-commit · ForceEndpoint on switch (worse)" },
  // Pressed 300ms late. The words spoken in that window belong to the old field —
  // that is the human's timing, not a routing error, and it is bounded by it.
  { engine: "streaming", routeByCapture: true, preset: "Stable-commit", expect: 4, fixture: NATURAL,
    lagMs: 300, label: "LATEPRESS · stable-commit · pressed 300ms late" },
  { engine: "streaming", routeByCapture: true, preset: "Finals only", expect: 4, fixture: CONTINUOUS,
    label: "MIDTURN · streaming finals-only · per-word routing" },
  { engine: "streaming", routeByCapture: false, preset: "Stable-commit", fixture: CONTINUOUS,
    label: "MIDTURN · streaming stable-commit · delivery-time (naive)" },
  { engine: "dictation", routeByCapture: true, expect: 4, fixture: CONTINUOUS,
    label: "MIDTURN · dictation · clip cut on field change" },
]) {
  if (FOCUS && !cfg.label.toLowerCase().includes(FOCUS.toLowerCase())) continue;
  for (let attempt = 0; attempt < REPEAT; attempt++) {
  const got = await run(cfg);
  let pass = 0;
  let exact = 0;
  const lines = EXPECT.map((e) => {
    const text = got[e.field] ?? "";
    const ok = text.toLowerCase().includes(e.must);
    const isExact = norm(text) === e.exact;
    if (ok) pass++;
    if (isExact) exact++;
    return `    ${ok ? (isExact ? "EXACT" : "pass ") : "FAIL "} ${e.field.padEnd(10)} "${text}"`;
  });
  const stray = Object.entries(got).filter(([f, t]) => t && !EXPECT.some((e) => e.field === f));
  console.log(`\n${cfg.label}  →  ${pass}/4 routed, ${exact}/4 exact boundaries`);
  console.log(lines.join("\n"));
  if (stray.length) console.log(`    stray text: ${stray.map(([f, t]) => `${f}="${t}"`).join(", ")}`);
  if (cfg.expect != null && pass < cfg.expect) {
    failures++;
    console.log(`    !! expected at least ${cfg.expect}/4 for this configuration, got ${pass}/4`);
  }
  }
}

console.log(
  failures
    ? `\n${failures} configuration(s) did not match expectations.`
    : "\nAll configurations matched expectations.",
);
process.exit(failures ? 1 : 0);
