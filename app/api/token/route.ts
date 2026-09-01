import { NextResponse } from "next/server";

const REGION_HOSTS: Record<string, string> = {
  global: "streaming.assemblyai.com",
  us: "streaming.us.assemblyai.com",
  eu: "streaming.eu.assemblyai.com",
};

/**
 * Mints a short-lived streaming token so the browser never sees the API key.
 * Browsers can't set headers on a WebSocket, so the client passes this via
 * the `token` query parameter.
 */
export async function GET(request: Request) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ASSEMBLYAI_API_KEY is not set. Add it to .env.local and restart." },
      { status: 500 },
    );
  }

  const requested = new URL(request.url).searchParams.get("region") ?? "global";
  const host = REGION_HOSTS[requested] ?? REGION_HOSTS.global;

  const url = new URL(`https://${host}/v3/token`);
  url.searchParams.set("expires_in_seconds", "600");
  url.searchParams.set("max_session_duration_seconds", "10800");

  const response = await fetch(url, { headers: { Authorization: apiKey }, cache: "no-store" });
  const body = await response.text();

  if (!response.ok) {
    return NextResponse.json(
      { error: `Token request failed (${response.status})`, detail: body.slice(0, 500) },
      { status: response.status },
    );
  }

  const { token } = JSON.parse(body) as { token: string };
  return NextResponse.json({ token, host }, { headers: { "Cache-Control": "no-store" } });
}
