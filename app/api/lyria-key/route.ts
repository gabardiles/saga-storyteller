import { NextResponse } from "next/server";

/**
 * POST /api/lyria-key
 *
 * Returns the raw Gemini API key for Lyria RealTime connections.
 * Lyria uses the standard BidiGenerateContent endpoint and only supports
 * direct API key auth — ephemeral tokens (from authTokens.create) are
 * scoped to the constrained Gemini Live endpoint and are rejected by Lyria.
 *
 * Security note: This exposes the API key to the browser. Acceptable for
 * this POC; add IP allowlisting or usage limits if hardening is needed.
 */
export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured on the server." },
      { status: 500 }
    );
  }

  return NextResponse.json({ key: apiKey });
}
