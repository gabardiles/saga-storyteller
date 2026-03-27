import { NextResponse } from "next/server";

/**
 * POST /api/token
 *
 * Exchanges our server-side GEMINI_API_KEY for a short-lived
 * ephemeral token that the client can use to connect directly
 * to the Gemini Live API WebSocket.
 */
export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured" },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-live-preview:generateEphemeralToken?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error("Ephemeral token error:", response.status, text);

      // Fallback: return API key to the browser (never do this on Vercel cloud unless explicitly opted in)
      if (response.status === 404 || response.status === 400) {
        const vercelEnv = process.env.VERCEL_ENV;
        const allowKeyFallback =
          process.env.ALLOW_CLIENT_API_KEY_FALLBACK === "true";
        if (
          (vercelEnv === "production" || vercelEnv === "preview") &&
          !allowKeyFallback
        ) {
          return NextResponse.json(
            {
              error:
                "Ephemeral token endpoint unavailable. Set ALLOW_CLIENT_API_KEY_FALLBACK=true on this environment only if you accept sending the API key to the client, or use a model/API that supports generateEphemeralToken.",
            },
            { status: 503 }
          );
        }
        console.warn(
          "Ephemeral tokens not available — falling back to direct API key (dev / explicit opt-in)"
        );
        return NextResponse.json({ token: apiKey, mode: "apikey" });
      }

      return NextResponse.json(
        { error: "Failed to get ephemeral token" },
        { status: 502 }
      );
    }

    const data = await response.json();
    // REST returns AuthToken shape: the secret string is in `name` (see ephemeral tokens docs)
    const token =
      (typeof data.name === "string" && data.name) ||
      data.ephemeralToken ||
      data.token;
    if (!token || typeof token !== "string") {
      console.error("Unexpected token response keys:", Object.keys(data));
      return NextResponse.json(
        { error: "Invalid token response from Gemini" },
        { status: 502 }
      );
    }
    return NextResponse.json({ token, mode: "ephemeral" });
  } catch (err) {
    console.error("Token exchange failed:", err);
    return NextResponse.json(
      { error: "Token exchange failed" },
      { status: 500 }
    );
  }
}
