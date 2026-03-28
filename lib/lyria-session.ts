/**
 * Lyria RealTime WebSocket client.
 *
 * Runs alongside the Gemini Live session to stream adaptive background music.
 * Lyria outputs 48kHz stereo PCM. All failures are non-fatal — the Saga voice
 * session continues normally if Lyria is unavailable.
 */

const WS_LYRIA_V1ALPHA =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent";

const LYRIA_MODEL = "models/lyria-realtime-exp";

const LYRIA_DEFAULT_PROMPT =
  "warm gentle children's background music with soft acoustic guitar and light percussion";

export class LyriaSession {
  private ws: WebSocket | null = null;
  private onAudioChunk: (base64: string) => void;
  private setupComplete = false;
  private closingIntentionally = false;

  constructor(onAudioChunk: (base64: string) => void) {
    this.onAudioChunk = onAudioChunk;
  }

  async connect(): Promise<void> {
    let wsUrl: string;
    try {
      const res = await fetch("/api/token", { method: "POST" });
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
      const token = data.token as string;
      if (!token) throw new Error("Token response missing token.");

      // Lyria uses standard BidiGenerateContent (v1alpha), not the constrained variant.
      // Both API-key and ephemeral access_token paths go through the same URL.
      const useApiKey = data.mode === "apikey";
      wsUrl = useApiKey
        ? `${WS_LYRIA_V1ALPHA}?key=${encodeURIComponent(token)}`
        : `${WS_LYRIA_V1ALPHA}?access_token=${encodeURIComponent(token)}`;
    } catch (err) {
      console.warn("Lyria: failed to get auth token — music disabled.", err);
      return;
    }

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.sendSetup();
      };

      this.ws.onmessage = (event) => {
        this.dispatchWsText(event.data as string | Blob | ArrayBuffer | ArrayBufferView);
      };

      this.ws.onerror = (event) => {
        console.warn("Lyria WebSocket error:", event);
      };

      this.ws.onclose = (event) => {
        if (!this.closingIntentionally) {
          console.warn("Lyria WebSocket closed:", event.code, event.reason);
        }
        this.setupComplete = false;
      };
    } catch (err) {
      console.warn("Lyria: failed to open WebSocket — music disabled.", err);
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

      if (msg.setupComplete != null) {
        console.log("Lyria setup complete — sending initial config + default prompt");
        this.setupComplete = true;

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
          // Send default prompt immediately so Lyria starts steered, not free-form.
          // MoodMapper only fires onPromptChange when mood CHANGES away from default,
          // so without this the default prompt would never be sent.
          this.ws.send(
            JSON.stringify({
              weighted_prompts: [{ text: LYRIA_DEFAULT_PROMPT, weight: 1.0 }],
            })
          );
        }
        return;
      }

      const content = (msg as { serverContent?: { modelTurn?: { parts?: Array<{ inlineData?: { data?: string } }> } } }).serverContent;
      if (content?.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          if (part.inlineData?.data) {
            this.onAudioChunk(part.inlineData.data);
          }
        }
      }
    } catch (err) {
      console.warn("Lyria: failed to parse message:", err);
    }
  }

  /** Steer the music to a new mood prompt. No-op until setup is complete. */
  setPrompt(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.setupComplete)
      return;
    this.ws.send(
      JSON.stringify({ weighted_prompts: [{ text, weight: 1.0 }] })
    );
  }

  /** Adjust music generation parameters on the fly. */
  setConfig(bpm: number, density: number, brightness: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
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
  }
}
