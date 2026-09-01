import { NextResponse } from "next/server";

const DICTATION_ENDPOINT = "https://dictation.assemblyai.com/transcribe";

/**
 * Proxies one clip to the Dictation API. Keeps the API key server-side and
 * sidesteps browser CORS. `config` is forwarded verbatim, so any config field
 * the service gains works without a change here.
 */
export async function POST(request: Request) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ASSEMBLYAI_API_KEY is not set. Add it to .env.local and restart." },
      { status: 500 },
    );
  }

  const incoming = await request.formData();
  const audio = incoming.get("audio");
  if (!(audio instanceof Blob)) {
    return NextResponse.json({ error: "Missing `audio` part" }, { status: 400 });
  }

  const outgoing = new FormData();
  outgoing.append("audio", audio, "clip.wav");

  const config = incoming.get("config");
  if (typeof config === "string" && config.trim() && config.trim() !== "{}") {
    outgoing.append("config", new Blob([config], { type: "application/json" }));
  }

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(DICTATION_ENDPOINT, {
      method: "POST",
      headers: { Authorization: apiKey },
      body: outgoing,
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upstream request failed" },
      { status: 502 },
    );
  }

  const roundTripMs = Date.now() - startedAt;
  const text = await response.text();

  if (!response.ok) {
    // The service answers an invalid key with 404, not 401 — surface that clearly.
    const hint = response.status === 404 ? "Invalid API key (Dictation returns 404 for auth failures)" : undefined;
    return NextResponse.json(
      { error: hint ?? `Dictation failed (${response.status})`, detail: text.slice(0, 500), roundTripMs },
      { status: response.status },
    );
  }

  return NextResponse.json({ ...JSON.parse(text), roundTripMs });
}
