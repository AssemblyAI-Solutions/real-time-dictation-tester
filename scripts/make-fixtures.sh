#!/usr/bin/env bash
# Builds the audio fixtures the benchmarks run against. macOS only (uses `say`).
set -euo pipefail
OUT="${1:-fixtures}"
mkdir -p "$OUT"

say -v Samantha -r 190 -o "$OUT/_c.aiff" "Examination. C T of the abdomen and pelvis with \
intravenous contrast. Findings. The liver demonstrates diffuse hepatic steatosis without focal \
lesion. There is no intrahepatic biliary ductal dilatation. The spleen pancreas and adrenal \
glands are unremarkable. No retroperitoneal adenopathy. The appendix is normal in caliber \
measuring six millimeters. Impression. Hepatic steatosis. No acute intra-abdominal abnormality."
afconvert -f WAVE -d LEI16@16000 -c 1 "$OUT/_c.aiff" "$OUT/continuous.wav"

# Script 4 from the in-app read-aloud panel: eleven lines of very uneven length,
# which is what a real report looks like and what exposes drift across a long turn.
j=0
while IFS= read -r line; do
  say -v Samantha -r 185 -o "$OUT/_s$j.aiff" "$line"
  afconvert -f WAVE -d LEI16@16000 -c 1 "$OUT/_s$j.aiff" "$OUT/_s$j.wav"
  j=$((j+1))
done <<'LINES'
CT of the abdomen and pelvis with contrast.
Ongoing pain in the upper right side for three weeks.
Compared with the scan from last March.
Standard scan taken after contrast was given.
Not included in this study.
The lungs are clear and the heart is normal in size.
The liver shows some fatty change. Everything else looks normal.
No fluid and no swollen lymph nodes.
Not included.
Not included.
Fatty liver. Nothing here needs urgent attention.
LINES

i=0
for phrase in "The lungs are clear." "The liver looks normal." "No fluid collection." "Nothing urgent here."; do
  say -v Samantha -r 185 -o "$OUT/_p$i.aiff" "$phrase"
  afconvert -f WAVE -d LEI16@16000 -c 1 "$OUT/_p$i.aiff" "$OUT/_p$i.wav"
  i=$((i+1))
done

python3 - "$OUT" <<'PY'
import wave, json, sys
out_dir = sys.argv[1]; GAP_MS = 800; RATE = 16000

# Gapless variant: the four phrases run together as one unbroken utterance, so a
# field switch has to land mid-turn. This is the case that matters — a radiologist
# reading straight through never gives the model a turn boundary to route on.
cont = wave.open(f"{out_dir}/fields-continuous.wav", "wb")
cont.setnchannels(1); cont.setsampwidth(2); cont.setframerate(RATE)
ct = 0.0; cmarks = []
for i in range(4):
    w = wave.open(f"{out_dir}/_p{i}.wav"); d = w.readframes(w.getnframes()); w.close()
    dur = len(d) / 2 / RATE * 1000
    cont.writeframes(d)
    cmarks.append({"i": i, "startMs": round(ct), "endMs": round(ct + dur), "pressAtMs": round(ct + dur)})
    ct += dur
cont.close()
json.dump(cmarks, open(f"{out_dir}/fields-continuous.json", "w"), indent=1)
print(f"wrote {out_dir}/fields-continuous.wav ({ct/1000:.2f}s, no gaps)")

# Natural variant: ~200ms between phrases, which is what reading continuously
# actually sounds like. Zero-gap audio is physically unrealistic and leaves no
# pause for a boundary to snap to; 800ms means the reader deliberately paused.
NAT_MS = 200
nat_gap = b"\x00\x00" * int(RATE * NAT_MS / 1000)
nat = wave.open(f"{out_dir}/fields-natural.wav", "wb")
nat.setnchannels(1); nat.setsampwidth(2); nat.setframerate(RATE)
nt = 0.0; nmarks = []
for i in range(4):
    w = wave.open(f"{out_dir}/_p{i}.wav"); d = w.readframes(w.getnframes()); w.close()
    dur = len(d) / 2 / RATE * 1000
    nat.writeframes(d)
    nmarks.append({"i": i, "startMs": round(nt), "endMs": round(nt + dur), "pressAtMs": round(nt + dur)})
    nt += dur
    nat.writeframes(nat_gap); nt += NAT_MS
nat.close()
json.dump(nmarks, open(f"{out_dir}/fields-natural.json", "w"), indent=1)
print(f"wrote {out_dir}/fields-natural.wav ({nt/1000:.2f}s, {NAT_MS}ms gaps)")

# The full eleven-line report, read continuously with a natural line-end pause.
rep = wave.open(f"{out_dir}/report.wav", "wb")
rep.setnchannels(1); rep.setsampwidth(2); rep.setframerate(RATE)
rt = 0.0; rmarks = []
i = 0
while True:
    try:
        w = wave.open(f"{out_dir}/_s{i}.wav")
    except FileNotFoundError:
        break
    d = w.readframes(w.getnframes()); w.close()
    dur = len(d) / 2 / RATE * 1000
    rep.writeframes(d)
    rmarks.append({"i": i, "startMs": round(rt), "endMs": round(rt + dur), "pressAtMs": round(rt + dur)})
    rt += dur
    rep.writeframes(nat_gap); rt += NAT_MS
    i += 1
rep.close()
json.dump(rmarks, open(f"{out_dir}/report.json", "w"), indent=1)
print(f"wrote {out_dir}/report.wav ({rt/1000:.2f}s, {i} lines)")

# Same eleven lines, but with a deliberate pause at each switch. That pause is a
# real turn boundary, which is the only way the split comes out word-perfect.
PAUSE_MS = 700
pause_gap = b"\x00\x00" * int(RATE * PAUSE_MS / 1000)
pau = wave.open(f"{out_dir}/report-paused.wav", "wb")
pau.setnchannels(1); pau.setsampwidth(2); pau.setframerate(RATE)
pt = 0.0; pmarks = []
for k in range(i):
    w = wave.open(f"{out_dir}/_s{k}.wav"); d = w.readframes(w.getnframes()); w.close()
    dur = len(d) / 2 / RATE * 1000
    pau.writeframes(d)
    pmarks.append({"i": k, "startMs": round(pt), "endMs": round(pt + dur), "pressAtMs": round(pt + dur + PAUSE_MS / 2)})
    pt += dur
    pau.writeframes(pause_gap); pt += PAUSE_MS
pau.close()
json.dump(pmarks, open(f"{out_dir}/report-paused.json", "w"), indent=1)
print(f"wrote {out_dir}/report-paused.wav ({pt/1000:.2f}s, {PAUSE_MS}ms pauses)")

gap = b"\x00\x00" * int(RATE * GAP_MS / 1000)
out = wave.open(f"{out_dir}/fields.wav", "wb")
out.setnchannels(1); out.setsampwidth(2); out.setframerate(RATE)
t = 0.0; marks = []
for i in range(4):
    w = wave.open(f"{out_dir}/_p{i}.wav"); d = w.readframes(w.getnframes()); w.close()
    dur = len(d) / 2 / RATE * 1000
    out.writeframes(d); start, end = t, t + dur; t = end
    out.writeframes(gap); t += GAP_MS
    marks.append({"i": i, "startMs": round(start), "endMs": round(end), "pressAtMs": round(end + GAP_MS / 2)})
out.close()
json.dump(marks, open(f"{out_dir}/fields.json", "w"), indent=1)
print(f"wrote {out_dir}/continuous.wav, {out_dir}/fields.wav (+ fields.json)")
PY
rm -f "$OUT"/_*.aiff "$OUT"/_p*.wav "$OUT"/_s*.wav
