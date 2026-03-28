"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  GeminiLiveSession,
  type LiveUsageSnapshot,
  type SessionState,
  type TranscriptEntry,
} from "@/lib/gemini-live";
import { AudioCapture } from "@/lib/audio-capture";
import { AudioPlayer } from "@/lib/audio-player";
import { LyriaSession, type LyriaStatus } from "@/lib/lyria-session";
import { LyriaPlayer } from "@/lib/lyria-player";
import { MoodMapper } from "@/lib/mood-mapper";
import {
  SAGA_RULE_BLOCKS,
  STORYTELLER_PROMPT,
  STORYTELLER_PROMPT_SOURCE_FILE,
} from "@/lib/storyteller-prompt";
import StorytellerFrog from "@/components/StorytellerFrog";

type UsageEvent = { id: number; at: number; payload: LiveUsageSnapshot };

function usageHeadline(u: LiveUsageSnapshot): string {
  const n = (k: string) => {
    const v = u[k];
    return typeof v === "number" ? v : null;
  };
  const parts: string[] = [];
  const p = n("promptTokenCount");
  const r = n("responseTokenCount");
  const t = n("totalTokenCount");
  const c = n("cachedContentTokenCount");
  const thoughts = n("thoughtsTokenCount");
  if (p != null) parts.push(`prompt ${p}`);
  if (r != null) parts.push(`response ${r}`);
  if (t != null) parts.push(`total ${t}`);
  if (c != null && c > 0) parts.push(`cached ${c}`);
  if (thoughts != null && thoughts > 0) parts.push(`thoughts ${thoughts}`);
  return parts.length > 0 ? parts.join(" · ") : "counts in JSON below";
}

export default function Home() {
  const [state, setState] = useState<SessionState>("disconnected");
  const [lyriaStatus, setLyriaStatus] = useState<LyriaStatus>("disconnected");
  const [lyriaCloseDetail, setLyriaCloseDetail] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [usageEvents, setUsageEvents] = useState<UsageEvent[]>([]);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [frogWidth, setFrogWidth] = useState(512);
  const usageIdRef = useRef(0);
  const frogContainerRef = useRef<HTMLDivElement>(null);

  // Poll AudioPlayer to keep mouth animation in sync with actual playback
  useEffect(() => {
    const id = setInterval(() => {
      setIsAudioPlaying(playerRef.current?.isCurrentlyPlaying() ?? false);
    }, 80);
    return () => clearInterval(id);
  }, []);

  // Measure available width for the frog
  useEffect(() => {
    const update = () => {
      if (frogContainerRef.current) {
        setFrogWidth(frogContainerRef.current.offsetWidth);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    if (frogContainerRef.current) ro.observe(frogContainerRef.current);
    return () => ro.disconnect();
  }, []);

  const sessionRef = useRef<GeminiLiveSession | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const lyriaSessionRef = useRef<LyriaSession | null>(null);
  const lyriaPlayerRef = useRef<LyriaPlayer | null>(null);
  const moodMapperRef = useRef<MoodMapper | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  /** Prevents handleStart from being invoked a second time while already starting. */
  const isStartingRef = useRef(false);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript]);

  const handleStart = useCallback(async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;

    // Tear down any orphaned session first (handles state desync where UI shows
    // "Ready" but refs still hold live objects from a previous run).
    captureRef.current?.stop(); captureRef.current = null;
    playerRef.current?.stop(); playerRef.current = null;
    sessionRef.current?.disconnect(); sessionRef.current = null;
    moodMapperRef.current?.reset(); moodMapperRef.current = null;
    lyriaSessionRef.current?.disconnect(); lyriaSessionRef.current = null;
    lyriaPlayerRef.current?.stop(); lyriaPlayerRef.current = null;

    setError(null);
    setTranscript([]);
    setUsageEvents([]);
    usageIdRef.current = 0;

    const player = new AudioPlayer();
    player.start();
    playerRef.current = player;

    // Lyria background music — non-blocking, failures are non-fatal
    setLyriaStatus("disconnected");
    setLyriaCloseDetail(null);
    const lyriaPlayer = new LyriaPlayer();
    lyriaPlayer.start();
    lyriaPlayerRef.current = lyriaPlayer;

    const lyriaSession = new LyriaSession({
      onAudioChunk: (base64) => lyriaPlayer.enqueue(base64),
      onStatusChange: (status) => setLyriaStatus(status),
      onCloseDetail: (detail) => setLyriaCloseDetail(detail),
    });
    lyriaSessionRef.current = lyriaSession;

    const moodMapper = new MoodMapper((prompt) => {
      lyriaSession.setPrompt(prompt);
    });
    moodMapperRef.current = moodMapper;

    // Connect Lyria in parallel — don't await, don't block Saga
    void lyriaSession.connect();

    const session = new GeminiLiveSession(
      {
        onAudioChunk: (base64) => {
          player.enqueue(base64);
        },
        onTranscript: (entry) => {
          // Feed model output to mood mapper for adaptive music
          if (entry.role === "model") {
            moodMapperRef.current?.feed(entry.text);
          }
          setTranscript((prev) => {
            // Append to last entry if same role (streaming transcript)
            const last = prev[prev.length - 1];
            if (last && last.role === entry.role) {
              return [
                ...prev.slice(0, -1),
                { ...last, text: last.text + entry.text },
              ];
            }
            return [...prev, entry];
          });
        },
        onStateChange: (s) => {
          setState(s);
          if (s === "error") {
            setError(
              (prev) =>
                prev ??
                "WebSocket error or disconnect. Check the browser console."
            );
          }
        },
        onTokenFetchFailed: (msg) => {
          setError(msg);
        },
        onHandshakeFailed: (msg) => {
          setError(msg);
        },
        onInterrupted: () => {
          player.flush();
        },
        onUsageMetadata: (payload) => {
          usageIdRef.current += 1;
          const id = usageIdRef.current;
          const at = Date.now();
          setUsageEvents((prev) => {
            const next: UsageEvent[] = [...prev, { id, at, payload }];
            return next.slice(-24);
          });
        },
      },
      STORYTELLER_PROMPT
    );

    sessionRef.current = session;
    await session.connect();

    // Start mic capture
    try {
      const capture = new AudioCapture();
      await capture.start((base64Pcm) => {
        session.sendAudio(base64Pcm);
      });
      captureRef.current = capture;
    } catch (err) {
      console.error("Mic access denied:", err);
      setError("Microphone access is required. Please allow mic access and try again.");
      session.disconnect();
    } finally {
      isStartingRef.current = false;
    }
  }, []);

  const handleStop = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    playerRef.current?.stop();
    playerRef.current = null;
    sessionRef.current?.disconnect();
    sessionRef.current = null;
    moodMapperRef.current?.reset();
    moodMapperRef.current = null;
    lyriaSessionRef.current?.disconnect();
    lyriaSessionRef.current = null;
    lyriaPlayerRef.current?.stop();
    lyriaPlayerRef.current = null;
    setLyriaStatus("disconnected");
    setLyriaCloseDetail(null);
    setUsageEvents([]);
  }, []);

  const isActive = state === "connected";

  return (
    <main className="relative isolate flex flex-col items-center min-h-dvh px-4 pb-8 max-w-lg mx-auto">
      {/* Saga the Frog */}
      <div ref={frogContainerRef} className="w-full">
        <StorytellerFrog
          isSpeaking={isAudioPlaying}
          width={frogWidth}
          height={Math.round(frogWidth * (320 / 512))}
        />
      </div>

      {/* Header */}
      <h1 className="text-2xl font-medium tracking-tight mt-5 mb-1">Saga</h1>
      <p className="text-stone-400 text-sm mb-8">storyteller for kids</p>

      {/* Status */}
      <div className="flex items-center gap-3 mb-8">
        {/* Voice status */}
        <div
          className={`w-2 h-2 rounded-full ${
            state === "connected"
              ? "bg-emerald-400"
              : state === "connecting"
              ? "bg-amber-400 animate-pulse"
              : state === "error"
              ? "bg-red-400"
              : "bg-stone-600"
          }`}
        />
        <span className="text-xs text-stone-400 uppercase tracking-wider">
          {state === "connected"
            ? "Listening"
            : state === "connecting"
            ? "Connecting..."
            : state === "error"
            ? "Error"
            : "Ready"}
        </span>

        {/* Music status — only shown when a session is active */}
        {state !== "disconnected" && (
          <>
            <span className="text-stone-700 text-xs">·</span>
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                lyriaStatus === "connected"
                  ? "bg-purple-400"
                  : lyriaStatus === "connecting"
                  ? "bg-purple-400 animate-pulse"
                  : lyriaStatus === "failed"
                  ? "bg-stone-600"
                  : "bg-stone-700"
              }`}
            />
            <span className="text-xs text-stone-600 uppercase tracking-wider" title={lyriaCloseDetail ?? undefined}>
              {lyriaStatus === "connected"
                ? "Music"
                : lyriaStatus === "connecting"
                ? "Music…"
                : lyriaStatus === "failed"
                ? `No music${lyriaCloseDetail ? ` (${lyriaCloseDetail})` : ""}`
                : ""}
            </span>
          </>
        )}
      </div>

      {/* Big button */}
      <button
        type="button"
        onClick={isActive ? handleStop : handleStart}
        disabled={state === "connecting"}
        className={`
          relative z-20 min-h-[8.5rem] min-w-[8.5rem] touch-manipulation select-none
          w-32 h-32 rounded-full border-2 transition-all duration-300
          flex items-center justify-center text-lg font-medium
          disabled:opacity-50 disabled:cursor-not-allowed
          active:opacity-90
          ${
            isActive
              ? "border-red-400/60 bg-red-400/10 text-red-300 hover:bg-red-400/20"
              : "border-emerald-400/60 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
          }
        `}
      >
        {isActive ? "Stop" : state === "connecting" ? "..." : "Start"}
      </button>

      <p className="text-stone-500 text-xs mt-4 text-center">
        {isActive
          ? 'Say "Tell me a story about..." and Saga will narrate'
          : "Tap to begin a storytelling session"}
      </p>

      {/* Error */}
      {error && (
        <div className="mt-4 px-4 py-2 bg-red-900/30 border border-red-800/50 rounded-lg text-red-300 text-sm text-center">
          {error}
        </div>
      )}

      {/* How storytelling is controlled: system prompt (no separate rule files in POC) */}
      <details
        className="mt-8 w-full rounded-lg border border-emerald-900/35 bg-stone-950/50 text-left"
      >
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium uppercase tracking-wider text-stone-500 hover:text-stone-400">
          Story rules (prompt)
        </summary>
        <div className="border-t border-stone-800 px-3 py-3 space-y-4 text-xs text-stone-400">
          <p className="leading-relaxed">
            <span className="text-stone-300 font-medium">How this works: </span>
            Gemini Live gets one{" "}
            <code className="text-emerald-300/90">systemInstruction</code> when
            the socket connects (
            <code className="text-stone-400">sendSetup()</code> in{" "}
            <code className="text-stone-400">lib/gemini-live.ts</code>). This POC
            does not load external rule files; behavior is defined in{" "}
            <code className="text-emerald-300/90">{STORYTELLER_PROMPT_SOURCE_FILE}</code>{" "}
            and assembled into{" "}
            <code className="text-stone-400">STORYTELLER_PROMPT</code>.
          </p>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-stone-600 mb-2">
              Rule blocks (order = order sent)
            </p>
            <ul className="space-y-2">
              {SAGA_RULE_BLOCKS.map((block) => (
                <li
                  key={block.id}
                  className="rounded border border-stone-800 bg-stone-950/80 overflow-hidden"
                >
                  <details className="group">
                    <summary className="cursor-pointer px-2 py-2 text-stone-300 hover:bg-stone-900/80 list-none [&::-webkit-details-marker]:hidden flex flex-wrap gap-x-1">
                      <span className="font-medium text-stone-200">
                        {block.title}
                      </span>
                      <span className="text-stone-500">— {block.summary}</span>
                    </summary>
                    <pre className="border-t border-stone-800 px-2 py-2 text-[11px] leading-snug text-stone-400 whitespace-pre-wrap break-words font-mono max-h-36 overflow-y-auto">
                      {block.body}
                    </pre>
                  </details>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-wider text-stone-600 mb-2">
              Full system prompt (exact string sent)
            </p>
            <div className="max-h-48 overflow-y-auto rounded border border-stone-800 bg-stone-950 p-2">
              <pre className="text-[11px] leading-snug text-stone-300 whitespace-pre-wrap break-words font-mono">
                {STORYTELLER_PROMPT}
              </pre>
            </div>
          </div>
        </div>
      </details>

      {/* Usage decoder — Live API usageMetadata */}
      <details
        className="mt-8 w-full rounded-lg border border-stone-700/80 bg-stone-950/50 text-left"
      >
        <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium uppercase tracking-wider text-stone-500 hover:text-stone-400">
          Usage decoder
        </summary>
        <div className="border-t border-stone-800 px-3 py-3 space-y-3">
          {usageEvents.length === 0 ? (
            <p className="text-xs text-stone-500">
              Token counts from Gemini appear here when the server sends{" "}
              <code className="text-stone-400">usageMetadata</code> on the
              socket (often near turn boundaries).
            </p>
          ) : (
            <>
              <div className="text-xs text-amber-200/90 font-mono">
                Latest:{" "}
                {usageHeadline(usageEvents[usageEvents.length - 1]!.payload)}
              </div>
              <div className="max-h-52 overflow-y-auto rounded border border-stone-800 bg-stone-950 p-2">
                <pre className="text-[11px] leading-snug text-stone-300 whitespace-pre-wrap break-words font-mono">
                  {JSON.stringify(
                    usageEvents[usageEvents.length - 1]!.payload,
                    null,
                    2
                  )}
                </pre>
              </div>
              {usageEvents.length > 1 && (
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider text-stone-600">
                    Recent ({usageEvents.length})
                  </p>
                  <ul className="max-h-32 overflow-y-auto space-y-2 text-[10px] text-stone-500 font-mono">
                    {usageEvents
                      .slice()
                      .reverse()
                      .map((ev) => (
                        <li
                          key={ev.id}
                          className="border-l-2 border-stone-700 pl-2"
                        >
                          <span className="text-stone-600">
                            {new Date(ev.at).toLocaleTimeString()}
                          </span>{" "}
                          — {usageHeadline(ev.payload)}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </details>

      {/* Transcript */}
      {transcript.length > 0 && (
        <div className="mt-8 w-full flex-1">
          <h2 className="text-xs text-stone-500 uppercase tracking-wider mb-3">
            Transcript
          </h2>
          <div className="space-y-3 max-h-[40vh] overflow-y-auto pr-2">
            {transcript.map((entry, i) => (
              <div
                key={i}
                className={`text-sm leading-relaxed ${
                  entry.role === "user"
                    ? "text-stone-400 italic"
                    : "text-stone-200"
                }`}
              >
                <span className="text-xs text-stone-600 mr-2">
                  {entry.role === "user" ? "You" : "Saga"}
                </span>
                {entry.text}
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        </div>
      )}
    </main>
  );
}
