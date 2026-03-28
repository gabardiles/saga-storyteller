/**
 * Lyria RealTime session — wraps @google/genai client.live.music.connect().
 *
 * Key differences from the raw-WebSocket approach we had before:
 *  - Uses the official SDK so the handshake, play(), and message format are correct
 *  - Audio comes in serverContent.audioChunks[].data  (NOT modelTurn.parts)
 *  - session.play() must be called after setWeightedPrompts + setMusicGenerationConfig
 *    before Lyria starts streaming audio — omitting this was the main bug
 *
 * All failures are non-fatal: if Lyria can't connect, Saga keeps running without music.
 */

import { GoogleGenAI, type LiveMusicServerMessage } from "@google/genai";

const LYRIA_DEFAULT_PROMPT =
  "warm gentle children's background music with soft acoustic guitar and light percussion, instrumental only";

export type LyriaStatus = "disconnected" | "connecting" | "connected" | "failed";
export type LyriaStatusDetail = { status: LyriaStatus; reason?: string };

export interface LyriaCallbacks {
  onAudioChunk: (base64: string) => void;
  onStatusChange?: (status: LyriaStatus) => void;
  /** Called on unexpected close with a human-readable reason string. */
  onCloseDetail?: (detail: string) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MusicSession = any;

export class LyriaSession {
  private session: MusicSession = null;
  private callbacks: LyriaCallbacks;
  private closingIntentionally = false;

  constructor(callbacks: LyriaCallbacks) {
    this.callbacks = callbacks;
  }

  async connect(): Promise<void> {
    this.callbacks.onStatusChange?.("connecting");

    // Get the raw API key — Lyria needs it directly (not an ephemeral token)
    let apiKey: string;
    try {
      const res = await fetch("/api/lyria-key", { method: "POST" });
      let data: Record<string, unknown> = {};
      try { data = (await res.json()) as Record<string, unknown>; } catch { /* non-JSON */ }
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : `HTTP ${res.status}`);
      apiKey = data.key as string;
      if (!apiKey) throw new Error("lyria-key response missing key.");
    } catch (err) {
      console.warn("[Lyria] Failed to get API key — music disabled.", err);
      this.callbacks.onStatusChange?.("failed");
      return;
    }

    try {
      const client = new GoogleGenAI({
        apiKey,
        httpOptions: { apiVersion: "v1alpha" },
      });

      console.log("[Lyria] Connecting via SDK…");
      const session: MusicSession = await client.live.music.connect({
        model: "models/lyria-realtime-exp",
        callbacks: {
          onmessage: (message: LiveMusicServerMessage) => {
            // Audio arrives in serverContent.audioChunks (NOT modelTurn.parts)
            const chunks = message.serverContent?.audioChunks;

            if (chunks) {
              for (const chunk of chunks) {
                if (chunk.data) this.callbacks.onAudioChunk(chunk.data);
              }
            }
          },
          onerror: (error: unknown) => {
            console.warn("[Lyria] Session error:", error);
            this.callbacks.onStatusChange?.("failed");
            this.callbacks.onCloseDetail?.(`session error: ${String(error)}`);
          },
          onclose: (event: { code?: number; reason?: string }) => {
            if (!this.closingIntentionally) {
              const detail = event.reason?.trim()
                ? `code ${event.code}: ${event.reason}`
                : `code ${event.code}`;
              console.warn(`[Lyria] Session closed — ${detail}`);
              this.callbacks.onStatusChange?.(event.code === 1000 ? "disconnected" : "failed");
              this.callbacks.onCloseDetail?.(detail);
            }
          },
        },
      });

      this.session = session;

      // Send prompts then config, then MUST call play() — without play() nothing streams
      await session.setWeightedPrompts({
        weightedPrompts: [{ text: LYRIA_DEFAULT_PROMPT, weight: 1.0 }],
      });

      await session.setMusicGenerationConfig({
        musicGenerationConfig: {
          bpm: 90,
          temperature: 1.0,
          density: 0.5,
          brightness: 0.6,
        },
      });

      await session.play();

      console.log("[Lyria] Playing ♪");
      this.callbacks.onStatusChange?.("connected");
    } catch (err) {
      console.warn("[Lyria] Failed to start session — music disabled.", err);
      this.callbacks.onStatusChange?.("failed");
      this.callbacks.onCloseDetail?.(err instanceof Error ? err.message : String(err));
    }
  }

  /** Steer the music to a new mood prompt. No-op until connected. */
  setPrompt(text: string): void {
    if (!this.session) return;
    console.log("[Lyria] setPrompt:", text.slice(0, 60));
    (this.session.setWeightedPrompts({
      weightedPrompts: [{ text, weight: 1.0 }],
    }) as Promise<void>).catch((err: unknown) =>
      console.warn("[Lyria] setPrompt error:", err)
    );
  }

  /** Adjust music generation parameters on the fly. */
  setConfig(bpm: number, density: number, brightness: number): void {
    if (!this.session) return;
    (this.session.setMusicGenerationConfig({
      musicGenerationConfig: { bpm, temperature: 1.0, density, brightness },
    }) as Promise<void>).catch((err: unknown) =>
      console.warn("[Lyria] setConfig error:", err)
    );
  }

  disconnect(): void {
    this.closingIntentionally = true;
    if (this.session) {
      try { this.session.close(); } catch { /* ignore */ }
      this.session = null;
    }
    this.callbacks.onStatusChange?.("disconnected");
  }
}
