import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

/**
 * POST /api/token
 *
 * Creates a short-lived Live API token via Gemini **v1alpha** `authTokens.create`
 * (see https://ai.google.dev/gemini-api/docs/ephemeral-tokens).
 *
 * The old v1beta `models/...:generateEphemeralToken` route often returns 404;
 * that path is not used here.
 */
export async function POST() {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "GEMINI_API_KEY not configured on the server." },
      { status: 500 }
    );
  }

  try {
    const client = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "v1alpha" },
    });

    const now = Date.now();
    const expireTime = new Date(now + 30 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(now + 3 * 60 * 1000).toISOString();

    const authToken = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
      },
    });

    const token =
      typeof authToken.name === "string" ? authToken.name : undefined;
    if (!token) {
      console.error("authTokens.create: missing name on response", authToken);
      return NextResponse.json(
        { error: "Invalid auth token response from Gemini (no token name)." },
        { status: 502 }
      );
    }

    return NextResponse.json({ token, mode: "ephemeral" });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Token creation failed.";
    console.error("authTokens.create failed:", err);

    const vercelEnv = process.env.VERCEL_ENV;
    const allowKeyFallback =
      process.env.ALLOW_CLIENT_API_KEY_FALLBACK === "true";
    if (
      (vercelEnv === "production" || vercelEnv === "preview") &&
      !allowKeyFallback
    ) {
      return NextResponse.json(
        {
          error: `Could not create session token: ${message}. Add GEMINI_API_KEY in Vercel env vars. If it still fails, check API access for Live / v1alpha.`,
        },
        { status: 503 }
      );
    }

    console.warn(
      "Falling back to API key in response (local or ALLOW_CLIENT_API_KEY_FALLBACK)"
    );
    return NextResponse.json({ token: apiKey, mode: "apikey" });
  }
}
