/**
 * Gemini Live API WebSocket client.
 *
 * Handles: connection via ephemeral token, setup handshake,
 * sending audio, receiving audio + transcripts, interruption events.
 */

const GEMINI_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const MODEL = "models/gemini-3.1-flash-live-preview";

export type SessionState = "disconnected" | "connecting" | "connected" | "error";

export interface TranscriptEntry {
  role: "user" | "model";
  text: string;
  timestamp: number;
}

/** Top-level `usageMetadata` from Live WebSocket (camelCase JSON). */
export type LiveUsageSnapshot = Record<string, unknown>;

export interface GeminiLiveCallbacks {
  onAudioChunk: (pcmBase64: string) => void;
  onTranscript: (entry: TranscriptEntry) => void;
  onStateChange: (state: SessionState) => void;
  onInterrupted: () => void;
  onUsageMetadata: (usage: LiveUsageSnapshot) => void;
}

export class GeminiLiveSession {
  private ws: WebSocket | null = null;
  private callbacks: GeminiLiveCallbacks;
  private systemPrompt: string;
  /** Live API: do not send realtime audio until setupComplete (docs). */
  private setupComplete = false;
  private pendingAudio: string[] = [];

  constructor(callbacks: GeminiLiveCallbacks, systemPrompt: string) {
    this.callbacks = callbacks;
    this.systemPrompt = systemPrompt;
  }

  async connect(): Promise<void> {
    this.callbacks.onStateChange("connecting");

    // 1. Get ephemeral token from our API route (or raw key in dev fallback)
    let token: string;
    let authQuery: string;
    try {
      const res = await fetch("/api/token", { method: "POST" });
      if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`);
      const data = await res.json();
      token = data.token;
      if (!token || typeof token !== "string") {
        throw new Error("Token response missing token string");
      }
      // Ephemeral tokens use access_token=; API key fallback uses key= (per Gemini Live WS docs)
      authQuery =
        data.mode === "apikey"
          ? `key=${encodeURIComponent(token)}`
          : `access_token=${encodeURIComponent(token)}`;
    } catch (err) {
      console.error("Failed to get ephemeral token:", err);
      this.callbacks.onStateChange("error");
      return;
    }

    // 2. Open WebSocket
    const url = `${GEMINI_WS_URL}?${authQuery}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.setupComplete = false;
      this.pendingAudio = [];
      this.sendSetup();
    };

    // Gemini sends JSON; some browsers expose `data` as Blob/ArrayBuffer — normalize to text before JSON.parse
    this.ws.binaryType = "arraybuffer";
    this.ws.onmessage = (event) => {
      void this.dispatchWsText(event.data);
    };

    this.ws.onerror = (event) => {
      console.error("WebSocket error:", event);
      this.callbacks.onStateChange("error");
    };

    this.ws.onclose = (event) => {
      console.log("WebSocket closed:", event.code, event.reason);
      this.callbacks.onStateChange("disconnected");
    };
  }

  private sendSetup(): void {
    if (!this.ws) return;

    // Protobuf JSON uses camelCase (see https://ai.google.dev/api/live)
    const setupMessage = {
      setup: {
        model: MODEL,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Puck",
              },
            },
          },
        },
        systemInstruction: {
          parts: [{ text: this.systemPrompt }],
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    };

    this.ws.send(JSON.stringify(setupMessage));
  }

  /** Coerce WebSocket payload to UTF-8 text (Blob / ArrayBuffer / string). */
  private dispatchWsText(data: string | Blob | ArrayBuffer | ArrayBufferView): void {
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
      this.handleMessage(new TextDecoder().decode(data));
    }
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw);

      if (msg.usageMetadata != null && typeof msg.usageMetadata === "object") {
        this.callbacks.onUsageMetadata(
          msg.usageMetadata as Record<string, unknown>
        );
      }

      // Setup complete (may be `{}` — must wait before sending realtime audio)
      if (msg.setupComplete != null) {
        console.log("Session setup complete");
        this.setupComplete = true;
        this.callbacks.onStateChange("connected");
        for (const chunk of this.pendingAudio) {
          this.sendAudioNow(chunk);
        }
        this.pendingAudio = [];
        return;
      }

      // Server content (audio, transcripts, interruptions)
      const content = msg.serverContent;
      if (content) {
        // Interruption
        if (content.interrupted) {
          this.callbacks.onInterrupted();
          return;
        }

        // Model turn — audio chunks
        if (content.modelTurn?.parts) {
          for (const part of content.modelTurn.parts) {
            if (part.inlineData?.data) {
              this.callbacks.onAudioChunk(part.inlineData.data);
            }
          }
        }

        // Output transcription
        if (content.outputTranscription?.text) {
          this.callbacks.onTranscript({
            role: "model",
            text: content.outputTranscription.text,
            timestamp: Date.now(),
          });
        }

        // Input transcription
        if (content.inputTranscription?.text) {
          this.callbacks.onTranscript({
            role: "user",
            text: content.inputTranscription.text,
            timestamp: Date.now(),
          });
        }
      }
    } catch (err) {
      console.error("Failed to parse message:", err);
    }
  }

  /**
   * Send a chunk of PCM audio (base64 encoded, 16kHz 16-bit mono)
   */
  sendAudio(pcmBase64: string): void {
    if (!this.setupComplete) {
      this.pendingAudio.push(pcmBase64);
      return;
    }
    this.sendAudioNow(pcmBase64);
  }

  private sendAudioNow(pcmBase64: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        realtimeInput: {
          audio: {
            mimeType: "audio/pcm;rate=16000",
            data: pcmBase64,
          },
        },
      })
    );
  }

  /**
   * Send a text message (useful for initial prompt)
   */
  sendText(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    this.ws.send(
      JSON.stringify({
        clientContent: {
          turns: [
            {
              role: "user",
              parts: [{ text }],
            },
          ],
          turnComplete: true,
        },
      })
    );
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setupComplete = false;
    this.pendingAudio = [];
    this.callbacks.onStateChange("disconnected");
  }
}
