import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/scene-mood
 *
 * Takes a story excerpt and classifies the mood/setting
 * into one of the predefined ambient sound categories.
 */

const VALID_MOODS = [
  "forest",
  "ocean",
  "space",
  "castle",
  "cave",
  "rain",
  "meadow",
  "night",
  "celebration",
  "mystery",
  "town",
  "mountain",
] as const;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "No API key" }, { status: 500 });
  }

  const { excerpt } = await req.json();
  if (!excerpt) {
    return NextResponse.json({ error: "No excerpt" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Classify the mood/setting of this children's story excerpt into exactly ONE of these categories: ${VALID_MOODS.join(", ")}

Reply with ONLY the category word, nothing else.

Excerpt: "${excerpt}"`,
                },
              ],
            },
          ],
          generationConfig: {
            maxOutputTokens: 10,
            temperature: 0.1,
          },
        }),
      }
    );

    if (!res.ok) {
      console.error("Mood classification failed:", await res.text());
      return NextResponse.json({ error: "Classification failed" }, { status: 502 });
    }

    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase() || "";

    // Validate against known moods
    const mood = VALID_MOODS.find((m) => raw.includes(m)) || "meadow";

    return NextResponse.json({ mood });
  } catch (err) {
    console.error("Mood classification error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
