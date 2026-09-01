// Streams a WAV to /v3/ws in real time and reports the actual Turn cadence.
const KEY = process.env.ASSEMBLYAI_API_KEY;
if (!KEY) {
  console.error("Set ASSEMBLYAI_API_KEY. Example:\n  ASSEMBLYAI_API_KEY=$(grep -h ASSEMBLYAI .env.local | cut -d= -f2) \\\n    node scripts/probe.mjs 'baseline' mode=balanced");
  process.exit(1);
}
const [, , label, ...rest] = process.argv;
const extra = Object.fromEntries(rest.map((a) => a.split("=")));
const forceMs = Number(extra.force ?? 0);
const forceSil = Number(extra.forceSilence ?? 0);
const rmsGate = Number(extra.rms ?? 0.01);
delete extra.force; delete extra.forceSilence; delete extra.rms;

const fs = await import("node:fs");
const buf = fs.readFileSync(process.env.WAV ?? "fixtures/continuous.wav");
const pcm = buf.subarray(44); // skip WAV header
const RATE = 16000, CHUNK_MS = 80;
const bytesPerChunk = (RATE * 2 * CHUNK_MS) / 1000;

const tr = await fetch(`https://streaming.assemblyai.com/v3/token?expires_in_seconds=120`, {
  headers: { Authorization: KEY },
});
const { token } = await tr.json();

const q = new URLSearchParams({
  token, encoding: "pcm_s16le", sample_rate: "16000",
  speech_model: "universal-3-5-pro", ...extra,
});
const ws = new WebSocket(`wss://streaming.assemblyai.com/v3/ws?${q}`);

let t0 = 0, lastUpdate = 0, lastForce = 0, lastVoice = 0, spoke = false;
const events = [], gaps = [], forces = [], dump = [];

ws.addEventListener("open", async () => {
  t0 = Date.now();
  const now = () => Date.now() - t0;
  for (let off = 0; off < pcm.length; off += bytesPerChunk) {
    if (ws.readyState !== 1) break;
    const slice = pcm.subarray(off, off + bytesPerChunk);
    ws.send(slice);

    // Local RMS, so silence-gated forcing cuts at word gaps instead of mid-word.
    let sq = 0;
    for (let i = 0; i + 1 < slice.length; i += 2) {
      const v = slice.readInt16LE(i) / 32768;
      sq += v * v;
    }
    const rms = Math.sqrt(sq / (slice.length / 2));
    if (rms > rmsGate) { lastVoice = now(); spoke = true; }

    const sinceForce = now() - lastForce;
    const cadenceHit = forceMs && sinceForce >= forceMs;
    const silenceHit = forceSil && spoke && now() - lastVoice >= forceSil && sinceForce > 200;
    if (cadenceHit || silenceHit) {
      lastForce = now();
      if (silenceHit) spoke = false;
      forces.push({ at: now(), why: cadenceHit ? "cadence" : "silence" });
      ws.send(JSON.stringify({ type: "ForceEndpoint" }));
    }
    await new Promise((r) => setTimeout(r, CHUNK_MS));
  }
  ws.send(JSON.stringify({ type: "Terminate" }));
});

ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  const at = Date.now() - t0;
  if (m.type === "Turn" && process.env.DUMP) {
    dump.push({ at, final: m.end_of_turn, order: m.turn_order, transcript: m.transcript, words: m.words || null });
  }
  if (m.type === "Turn") {
    if (lastUpdate) gaps.push(at - lastUpdate);
    lastUpdate = at;
    events.push({ at, final: m.end_of_turn, order: m.turn_order,
      fmt: m.turn_is_formatted, n: (m.transcript || "").split(/\s+/).filter(Boolean).length,
      text: m.transcript });
  }
});

ws.addEventListener("close", () => {
  const finals = events.filter((e) => e.final);
  const partials = events.filter((e) => !e.final);
  const pct = (a, p) => a.length ? [...a].sort((x, y) => x - y)[Math.ceil(p/100*a.length)-1] : null;
  console.log(`\n===== ${label} =====`);
  console.log(`params: ${JSON.stringify(extra)}${forceMs ? ` force=${forceMs}ms` : ""}`);
  console.log(`turns=${finals.length} partials=${partials.length} forced=${forces.length} (${forces.filter(f=>f.why==="silence").length} silence / ${forces.filter(f=>f.why==="cadence").length} cadence)`);
  console.log(`gap between ANY Turn msg:   p50=${pct(gaps,50)}ms p95=${pct(gaps,95)}ms max=${Math.max(...gaps)}ms`);
  const fg = []; let prev = 0;
  for (const f of finals) { if (prev) fg.push(f.at - prev); prev = f.at; }
  if (fg.length) console.log(`gap between FINALS only:   p50=${pct(fg,50)}ms p95=${pct(fg,95)}ms max=${Math.max(...fg)}ms`);
  console.log(`words per final: ${finals.map((f) => f.n).join(", ")}`);
  console.log("\ntimeline:");
  for (const e of events.slice(0, 40))
    console.log(`  ${String(e.at).padStart(6)}ms ${e.final ? "FINAL  " : "partial"} #${e.order} ${e.fmt ? "fmt" : "raw"} ${e.n}w  ${e.text.slice(-70)}`);
  console.log(`\nfull text: ${finals.map((f) => f.text).join(" ")}`);
  if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify(dump, null, 1));
});
