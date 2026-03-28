/**
 * Scene analyzer agent.
 *
 * Watches the transcript stream, buffers text, and periodically
 * triggers two parallel tasks:
 * 1. Generate a scene illustration (via Gemini image gen)
 * 2. Classify the mood for ambient sound selection
 *
 * Runs entirely client-side — calls our API routes which proxy to Gemini.
 */

const SCENE_BUFFER_THRESHOLD = 80; // words before triggering analysis
const MIN_INTERVAL_MS = 15_000; // minimum time between triggers

export type SceneMood =
  | "forest"
  | "ocean"
  | "space"
  | "castle"
  | "cave"
  | "rain"
  | "meadow"
  | "night"
  | "celebration"
  | "mystery"
  | "town"
  | "mountain";

export interface SceneUpdate {
  imageUrl?: string;
  mood?: SceneMood;
  sceneDescription?: string;
}

export class SceneAnalyzer {
  private buffer = "";
  private wordCount = 0;
  private lastTrigger = 0;
  private isProcessing = false;
  private onUpdate: (update: SceneUpdate) => void;

  constructor(onUpdate: (update: SceneUpdate) => void) {
    this.onUpdate = onUpdate;
  }

  /**
   * Feed transcript text from Saga's narration.
   * Call this every time you get outputTranscription.text from the WebSocket.
   */
  feed(text: string): void {
    this.buffer += text + " ";
    this.wordCount = this.buffer.trim().split(/\s+/).length;

    const now = Date.now();
    const timeSinceLastTrigger = now - this.lastTrigger;

    if (
      this.wordCount >= SCENE_BUFFER_THRESHOLD &&
      timeSinceLastTrigger >= MIN_INTERVAL_MS &&
      !this.isProcessing
    ) {
      this.trigger();
    }
  }

  /**
   * Force a trigger (e.g. when the story first starts).
   */
  forceTrigger(): void {
    if (this.buffer.trim().length > 0 && !this.isProcessing) {
      this.trigger();
    }
  }

  private async trigger(): Promise<void> {
    this.isProcessing = true;
    this.lastTrigger = Date.now();
    const excerpt = this.buffer.trim();
    this.buffer = "";
    this.wordCount = 0;

    // Run both agents in parallel
    const [imageResult, moodResult] = await Promise.allSettled([
      this.generateImage(excerpt),
      this.classifyMood(excerpt),
    ]);

    const update: SceneUpdate = {};

    if (imageResult.status === "fulfilled" && imageResult.value) {
      update.imageUrl = imageResult.value.url;
      update.sceneDescription = imageResult.value.description;
    }

    if (moodResult.status === "fulfilled" && moodResult.value) {
      update.mood = moodResult.value;
    }

    if (update.imageUrl || update.mood) {
      this.onUpdate(update);
    }

    this.isProcessing = false;
  }

  private async generateImage(
    excerpt: string
  ): Promise<{ url: string; description: string } | null> {
    try {
      const res = await fetch("/api/scene-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excerpt }),
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data;
    } catch (err) {
      console.error("Image generation failed:", err);
      return null;
    }
  }

  private async classifyMood(excerpt: string): Promise<SceneMood | null> {
    try {
      const res = await fetch("/api/scene-mood", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ excerpt }),
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data.mood;
    } catch (err) {
      console.error("Mood classification failed:", err);
      return null;
    }
  }

  reset(): void {
    this.buffer = "";
    this.wordCount = 0;
    this.lastTrigger = 0;
    this.isProcessing = false;
  }
}
