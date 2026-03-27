# Saga — AI Storyteller for Kids

POC: A child speaks into their phone, Gemini 3.1 Flash Live narrates a story back in real-time audio.

## Stack
- Next.js 15 (App Router)
- Tailwind CSS v4
- Gemini 3.1 Flash Live API (WebSocket, audio-to-audio)
- Vercel deployment

## Architecture

```
Kid's phone mic
  → AudioCapture (lib/audio-capture.ts) — getUserMedia, downsample to 16kHz PCM, base64
  → GeminiLiveSession (lib/gemini-live.ts) — WebSocket to Gemini Live API
  → Gemini 3.1 Flash Live — native audio model with storyteller system prompt
  → PCM audio chunks stream back (24kHz)
  → AudioPlayer (lib/audio-player.ts) — decode, buffer, play through speaker
  → Transcript displayed in real-time (both input + output transcription)
```

**Token endpoint:** `app/api/token/route.ts` exchanges server-side API key for ephemeral token. If ephemeral tokens aren't available for the model yet, falls back to passing the API key directly (dev only).

**System prompt:** `lib/storyteller-prompt.ts` — defines the "Saga" storyteller persona for kids aged 5-7.

## Setup

```bash
npm install
```

Create `.env.local`:
```
GEMINI_API_KEY=your_api_key_here
```

Get your API key from https://aistudio.google.com/apikey

```bash
npm run dev
```

Open on your phone (use ngrok or Vercel deploy — mic requires HTTPS).

## Key files

| File | Purpose |
|------|---------|
| `lib/gemini-live.ts` | WebSocket connection, setup handshake, send/receive audio, handle interruptions |
| `lib/audio-capture.ts` | Mic capture, downsample to 16kHz, Float32→Int16 PCM, base64 encode |
| `lib/audio-player.ts` | Decode base64 PCM at 24kHz, queue AudioBuffers, sequential playback |
| `lib/storyteller-prompt.ts` | System prompt for the storyteller persona |
| `app/api/token/route.ts` | Ephemeral token endpoint (only server-side code) |
| `app/page.tsx` | Main UI — start/stop button, status, transcript |

## WebSocket setup config

```json
{
  "model": "models/gemini-3.1-flash-live-preview",
  "response_modalities": ["AUDIO"],
  "voice": "Puck",
  "automatic_activity_detection": { "disabled": false },
  "input_audio_transcription": {},
  "output_audio_transcription": {}
}
```

## Important notes

- **Mic requires HTTPS** — `localhost` works, but testing on phone needs ngrok/Vercel
- **Echo cancellation** — `echoCancellation: true` is set on getUserMedia to prevent the model hearing its own output
- **ScriptProcessorNode** — used instead of AudioWorklet for POC simplicity. Swap to AudioWorklet for production.
- **Model name** — `gemini-3.1-flash-live-preview` just launched March 26, 2026. If it errors, try `gemini-2.5-flash-native-audio-latest` as fallback.
- **Ephemeral tokens** — the token route tries ephemeral tokens first, falls back to raw API key for dev. For production, ephemeral tokens are mandatory.

## POC scope

This is a proof of concept. The child says "tell me a story about X" and Saga narrates a ~2 minute story. No turn-taking, no interruption handling beyond basic VAD, no fancy UI. Just prove the voice loop works on mobile.
