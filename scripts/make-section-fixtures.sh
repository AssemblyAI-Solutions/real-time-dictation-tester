#!/usr/bin/env bash
# Builds the audio fixture for the section-context benchmark. macOS only (uses `say`).
#
# The script is built around pairs that sound alike and are spelled differently
# depending on which part of the report the radiologist is in:
#
#   ileum / ilium        bowel (small intestine) vs pelvis (hip bone) — same sound
#   peroneal / perineal  knee (nerve) vs pelvis (region)
#   steatosis / stenosis liver (fatty change) vs vessel (narrowing)
#
# Nothing in the audio distinguishes them. Only the cursor position does, which
# is exactly the signal `UpdateConfiguration` carries.
set -euo pipefail
OUT="${1:-fixtures}"
mkdir -p "$OUT"

# One line per section, in report order. Kept short so each is a clean turn.
i=0
while IFS= read -r line; do
  say -v Samantha -r 185 -o "$OUT/_x$i.aiff" "$line"
  afconvert -f WAVE -d LEI16@16000 -c 1 "$OUT/_x$i.aiff" "$OUT/_x$i.wav"
  i=$((i+1))
done <<'LINES'
C T of the abdomen and pelvis with intravenous contrast.
Compared with the prior study dated March fourth.
The liver demonstrates diffuse steatosis without focal lesion.
The celiac axis shows moderate stenosis at its origin.
The terminal ileum is normal in caliber.
There is a lytic lesion within the left ilium.
The peroneal nerve is intact without displacement.
Hepatic steatosis with an indeterminate lesion of the ilium.
LINES

python3 - "$OUT" "$i" <<'PY'
import wave, json, sys
out_dir, n = sys.argv[1], int(sys.argv[2])
RATE = 16000

def build(name, gap_ms):
    gap = b"\x00\x00" * int(RATE * gap_ms / 1000)
    w = wave.open(f"{out_dir}/{name}.wav", "wb")
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
    t = 0.0; marks = []
    for k in range(n):
        src = wave.open(f"{out_dir}/_x{k}.wav")
        d = src.readframes(src.getnframes()); src.close()
        dur = len(d) / 2 / RATE * 1000
        # switchAtMs is when the cursor lands in THIS section: the midpoint of the
        # gap before it, which is where a radiologist's keystroke actually falls.
        marks.append({
            "i": k,
            "switchAtMs": round(max(0, t - gap_ms / 2)),
            "startMs": round(t),
            "endMs": round(t + dur),
        })
        w.writeframes(d); t += dur
        w.writeframes(gap); t += gap_ms
    w.close()
    json.dump(marks, open(f"{out_dir}/{name}.json", "w"), indent=1)
    print(f"wrote {out_dir}/{name}.wav ({t/1000:.2f}s, {n} sections, {gap_ms}ms gaps)")

# PAUSED: a real pause at each switch, so section boundaries are also turn
# boundaries. NONSTOP: read straight through, so the switch lands mid-turn.
build("sections-paused", 700)
build("sections-nonstop", 120)
PY
rm -f "$OUT"/_x*.aiff "$OUT"/_x*.wav
