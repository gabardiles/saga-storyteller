/**
 * Lyria RealTime WebSocket client.
 *
 * Runs alongside the Gemini Live session to stream adaptive background music.
 * Lyria outputs 48kHz stereo PCM. All failures are non-fatal — the Saga voice
 * session continues normally if Lyria is unavailable.
 *
 * Auth note: Lyria uses the standard BidiGenerateContent endpoint and only
 * accepts direct API key auth. Ephemeral tokens (scoped to the constrained
 * Gemini Live endpoint) are rejected — so we use /api/lyria-key, not /api/token.
 */

const WS_LYRIA_V1ALPHA =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent";

const LYRIA_MODEL = "models/lyria-realtime-exp";

const LYRIA_DEFAULT_PROMPT =
  "warm gentle children's background music with soft acoustic guitar and light percussion";

export type LyriaStatus = "disconnected" | "connecting" | "connected" | "failed";

export interface LyriaCallbacks {
  onAudioChunk: (base64: string) => void;
  onStatusChange?: (status: LyriaStatus) => void;
}

export class LyriaSession {
  private ws: WebSocket | null = null;
  private callbacks: LyriaCallbacks;
  private setupComplete = false;
  private closingIntentionally = false;

  constructor(callbacks: LyriaCallbacks) {
    this.callbacks = callbacks;
  }

  async connect(): Promise<void> {
    this.callbacks.onStatusChange?.("connecting");

    let wsUrl: string;
    try {
      const res = await fetch("/api/lyria-key", { method: "POST" });
      let data: Record<string, unknown> = {};
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        /* non-JSON body */
      }
      if (!res.ok) {
        throw new Error(
          typeof data.error === "string" ? data.error : `HTTP ${res.status}`
        );
      }
      const key = data.key as string;
      if (!key) throw new Error("lyria-key response missing key.");
      wsUrl = `${WS_LYRIA_V1ALPHA}?key=${encodeURIComponent(key)}`;
    } catch (err) {
      console.warn("[Lyria] Failed to get API key — music disabled.", err);
      this.callbacks.onStatusChange?.("failed");
      return;
    }

    try {
      console.log("[Lyria] Opening WebSocket…");
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        console.log("[Lyria] WebSocket open — sending setup");
        this.sendSetup();
      };

      this.ws.onmessage = (event) => {
        this.dispatchWsText(event.data as string | Blob | ArrayBuffer | ArrayBufferView);
      };

      this.ws.onerror = (event) => {
        console.warn("[Lyria] WebSocket error:", event);
        this.callbacks.onStatusChange?.("failed");
      };

      this.ws.onclose = (event) => {
        if (!this.closingIntentionally) {
          console.warn(`[Lyria] WebSocket closed: code=${event.code} reason="${event.reason}"`);
          this.callbacks.onStatusChange?.("disconnected");
        }
        this.setupComplete = false;
      };
    } catch (err) {
      console.warn("[Lyria] Failed to open WebSocket — music disabled.", err);
      this.callbacks.onStatusChange?.("failed");
    }
  }

  private sendSetup(): void {
    if (!this.ws) return;
    this.ws.send(JSON.stringify({ setup: { model: LYRIA_MODEL } }));
  }

  private dispatchWsText(
    data: string | Blob | ArrayBuffer | ArrayBufferView
  ): void {
    if (typeof data === "string") {
      this.handleMessage(data);
      return;
    }
    if (data instanceof Blob) {
      void data.text().then((raw) => this.handleMessage(raw));
      return;
    }
    if (data instanceof ArrayBuffer) {
      this.handleMessage(new TextDecoder().decode(data));
      return;
    }
    if (ArrayBuffer.isView(data)) {
      this.handleMessage(new TextDecoder().decode(data as ArrayBufferView));
    }
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as Record<string, unknown>;

      // Log everything except audio (too noisy) to help with debugging
      const hasAudio =
        (msg as { serverContent?: { modelTurn?: { parts?: unknown[] } } })
          .serverContent?.modelTurn?.parts != null;
      if (!hasAudio) {
        console.log("[Lyria] message:", JSON.stringify(msg).slice(0, 300));
      }

      if (msg.setupComplete != null) {
        console.log("[Lyria] Setup complete — sending config + default prompt");
        this.setupComplete = true;
        this.callbacks.onStatusChange?.("connected");

        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(
            JSON.stringify({
              music_generation_config: {
                bpm: 90,
                temperature: 1.0,
                density: 0.5,
                brightness: 0.6,
              },
            })
          );
          // Send default prompt so Lyria starts steered from the first note.
          // MoodMapper only fires onPromptChange when mood CHANGES away from default,
          // so without this the default prompt would never reach Lyria.
          this.ws.send(
            JSON.stringify({
              weighted_prompts: [{ text: LYRIA_DEFAULT_PROMPT, weight: 1.0 }],
            })
          );
        }
        return;
      }

      const content = (msg as {
        serverContent?: {
          modelTurn?: { parts?: Array<{ inlineData?: { data?: string } }> };
        };
      }).serverContent;
      if (content?.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          if (part.inlineData?.data) {
            this.callbacks.onAudioChunk(part.inlineData.data);
          }
        }
      }
    } catch (err) {
      console.warn("[Lyria] Failed to parse message:", err);
    }
  }

  /** Steer the music to a new mood prompt. No-op until setup is complete. */
  setPrompt(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.setupComplete)
      return;
    console.log("[Lyria] setPrompt:", text.slice(0, 60));
    this.ws.send(
      JSON.stringify({ weighted_prompts: [{ text, weight: 1.0 }] })
    );
  }

  /** Adjust music generation parameters on the fly. */
  setConfig(bpm: number, density: number, brightness: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.setupComplete)
      return;
    this.ws.send(
      JSON.stringify({
        music_generation_config: { bpm, temperature: 1.0, density, brightness },
      })
    );
  }

  disconnect(): void {
    this.closingIntentionally = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setupComplete = false;
    this.callbacks.onStatusChange?.("disconnected");
  }
}
