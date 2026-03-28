import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/scene-image
 *
 * Takes a story excerpt, generates a one-line scene description,
 * then generates a children's book illustration using Gemini image gen.
 */
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
    // Step 1: Generate scene description from excerpt
    const descriptionRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `You are a children's book illustrator deciding what to draw. Given this story excerpt, write a ONE sentence description of the single most vivid scene to illustrate. Focus on the main character, setting, and action. Style: warm, colorful, whimsical, suitable for ages 5-7. Just the description, nothing else.\n\nExcerpt: "${excerpt}"`,
                },
              ],
            },
          ],
          generationConfig: {
            maxOutputTokens: 100,
            temperature: 0.7,
          },
        }),
      }
    );

    if (!descriptionRes.ok) {
      console.error("Description gen failed:", await descriptionRes.text());
      return NextResponse.json(
        { error: "Description generation failed" },
        { status: 502 }
      );
    }

    const descData = await descriptionRes.json();
    const description =
      descData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    if (!description) {
      return NextResponse.json(
        { error: "Empty description" },
        { status: 500 }
      );
    }

    // Step 2: Generate image from description
    const imagePrompt = `Children's book illustration, soft watercolor style, warm colors, whimsical and friendly: ${description}`;

    const imageRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: imagePrompt }],
            },
          ],
          generationConfig: {
            responseModalities: ["IMAGE", "TEXT"],
            responseMimeType: "image/png",
          },
        }),
      }
    );

    if (!imageRes.ok) {
      console.error("Image gen failed:", await imageRes.text());
      return NextResponse.json(
        { error: "Image generation failed" },
        { status: 502 }
      );
    }

    const imageData = await imageRes.json();
    const imagePart = imageData.candidates?.[0]?.content?.parts?.find(
      (p: { inlineData?: { mimeType: string; data: string } }) => p.inlineData
    );

    if (!imagePart?.inlineData?.data) {
      return NextResponse.json({ error: "No image data" }, { status: 500 });
    }

    // Return as data URL
    const dataUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;

    return NextResponse.json({
      url: dataUrl,
      description,
    });
  } catch (err) {
    console.error("Scene image error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
