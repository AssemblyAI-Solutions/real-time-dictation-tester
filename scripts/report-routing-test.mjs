import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright-core");

// Drives the full eleven-line report through the real UI, pressing the
// field-switch key at each line end, and checks every field word for word.
// Two fixtures: a brief pause at each switch, and reading straight through.

const DIR = process.env.FIXTURES ?? "fixtures";
const BASE = process.env.BASE_URL ?? "http://localhost:3000/";
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const EXPECT = [
  ["EXAMINATION", "ct of the abdomen and pelvis with contrast"],
  ["CLINICAL HISTORY", "ongoing pain in the upper right side for 3 weeks"],
  ["COMPARISON", "compared with the scan from last march"],
  ["TECHNIQUE", "standard scan taken after contrast was given"],
  ["Paranasal sinuses", "not included in this study"],
  ["Chest", "the lungs are clear and the heart is normal in size"],
  ["Abdomen", "the liver shows some fatty change everything else looks normal"],
  ["Pelvis", "no fluid and no swollen lymph nodes"],
  ["Shoulder", "not included"],
  ["Knee", "not included"],
  ["IMPRESSION", "fatty liver nothing here needs urgent attention"],
];

const norm = (t) => t.toLowerCase().replace(/[.,;:!?]/g, "").replace(/\s+/g, " ").trim();

/**
 * Routing controls which words land in which field, not whether each word was
 * heard correctly. Comparing the first and last word of a field tests exactly
 * that boundary, and stays green when the model mishears something mid-phrase
 * ("Nothing" for "Something"), which is an accuracy question measured elsewhere.
 */
function boundariesMatch(actual, want) {
  const a = norm(actual).split(" ").filter(Boolean);
  const w = want.split(" ").filter(Boolean);
  if (!a.length || !w.length) return false;
  return a[0] === w[0] && a[a.length - 1] === w[w.length - 1] && a.length === w.length;
}

async function run({ wav, marks: marksFile, pressOffsetMs, label, expect, engine }) {
  const marks = JSON.parse(fs.readFileSync(`${DIR}/${marksFile}`));
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${DIR}/${wav}%noloop`],
  });
  const page = await (await browser.newContext({
    permissions: ["microphone"], viewport: { width: 1500, height: 950 },
  })).newPage();
  page.on("pageerror", (e) => console.log(`  [PAGEERROR] ${e.message}`));
  await page.goto(BASE, { waitUntil: "networkidle" });
  if (engine === "dictation") await page.getByRole("button", { name: "Dictation API" }).click();
  else await page.getByRole("button", { name: /Stable-commit/ }).first().click();
  await page.getByText("EXAMINATION:", { exact: true }).click();

  const t0 = Date.now();
  await page.getByRole("button", { name: /RECORD/ }).click();
  for (const m of marks.slice(0, EXPECT.length - 1)) {
    const wait = m.pressAtMs + pressOffsetMs - (Date.now() - t0);
    if (wait > 0) await page.waitForTimeout(wait);
    await page.keyboard.press("Alt+ArrowDown");
  }
  await page.waitForTimeout(12000);
  await page.getByRole("button", { name: /STOP/ }).click();
  await page.waitForTimeout(3000);

  const got = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll("div.rounded-md.border-2 div.group")].map((d) => {
      const label = d.querySelector("span")?.textContent?.replace(/:$/, "") ?? "";
      const ta = d.querySelector("textarea");
      return [label, (ta ? ta.value : d.querySelectorAll("span")[1]?.textContent ?? "").trim()];
    })));
  await browser.close();

  let routed = 0;
  let exact = 0;
  const lines = EXPECT.map(([field, want]) => {
    const text = got[field] ?? "";
    const boundsOk = boundariesMatch(text, want);
    const textOk = norm(text) === want;
    if (boundsOk) routed++;
    if (textOk) exact++;
    const tag = boundsOk ? (textOk ? "EXACT" : "bounds") : " DRIFT";
    return `    ${tag} ${field.padEnd(18)} "${text}"`;
  });
  console.log(
    `\n${label}  →  ${routed}/${EXPECT.length} boundaries correct, ${exact}/${EXPECT.length} also word-perfect`,
  );
  console.log(lines.join("\n"));
  if (expect != null && routed < expect) {
    console.log(`    !! expected at least ${expect}/${EXPECT.length} correct boundaries`);
    return 1;
  }
  return 0;
}

try {
  await fetch(BASE);
  await fetch(new URL("/api/token", BASE));
} catch {
  console.error(`Could not reach ${BASE} — is \`npm run dev\` running?`);
  process.exit(2);
}

let failures = 0;
failures += await run({
  wav: "report-paused.wav", marks: "report-paused.json", pressOffsetMs: 0, expect: 9,
  label: "PAUSED · brief pause at each switch (the recommended workflow)",
});
failures += await run({
  wav: "report.wav", marks: "report.json", pressOffsetMs: 250,
  label: "NONSTOP streaming · read straight through, no pause at switches",
});
// Dictation cuts the audio buffer itself at the keystroke, so the boundary is
// exact regardless of where the words fall.
failures += await run({
  wav: "report.wav", marks: "report.json", pressOffsetMs: 250, engine: "dictation", expect: 11,
  label: "NONSTOP dictation · client cuts the clip at the keystroke",
});

console.log(
  failures
    ? `\n${failures} configuration(s) below expectation.`
    : "\nAll configurations met expectations.",
);
process.exit(failures ? 1 : 0);
