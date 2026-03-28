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
import { PlaySagaIcon } from "@/components/PlaySagaIcon";

type UsageEvent = { id: number; at: number; payload: LiveUsageSnapshot };

function TranscriptLine({
  text,
  role,
  dim,
}: {
  text: string;
  role: "user" | "model";
  dim?: boolean;
}) {
  return (
    <p
      className={`text-sm leading-snug break-words transition-opacity duration-500 ${
        dim ? "opacity-35" : "opacity-90"
      } ${role === "user" ? "italic" : ""}`}
    >
      <span className="text-[11px] mr-1.5 font-medium opacity-50 not-italic">
        {role === "user" ? "You" : "Saga"}
      </span>
      <span className={role === "user" ? "text-white/70" : "text-white"}>
        {text}
      </span>
    </p>
  );
}

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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [screenSize, setScreenSize] = useState({ width: 390, height: 844 });
  /** After any user/model text or Saga audio, hide "Say hi!" for the rest of the session. */
  const [conversationStarted, setConversationStarted] = useState(false);

  const usageIdRef = useRef(0);
  const sessionRef = useRef<GeminiLiveSession | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const lyriaSessionRef = useRef<LyriaSession | null>(null);
  const lyriaPlayerRef = useRef<LyriaPlayer | null>(null);
  const moodMapperRef = useRef<MoodMapper | null>(null);
  const isStartingRef = useRef(false);

  // Track actual screen size for fullscreen frog
  useEffect(() => {
    const update = () =>
      setScreenSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Poll AudioPlayer to keep mouth animation in sync
  useEffect(() => {
    const id = setInterval(() => {
      setIsAudioPlaying(playerRef.current?.isCurrentlyPlaying() ?? false);
    }, 80);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (state !== "connected") return;
    if (
      transcript.some(
        (e) => e.role === "user" || e.role === "model"
      )
    ) {
      setConversationStarted(true);
    }
  }, [state, transcript]);

  useEffect(() => {
    if (state !== "connected" || !isAudioPlaying) return;
    setConversationStarted(true);
  }, [state, isAudioPlaying]);

  /** Tear down Lyria (music) without touching Gemini/voice state. */
  const stopLyria = useCallback(() => {
    moodMapperRef.current?.reset(); moodMapperRef.current = null;
    lyriaSessionRef.current?.disconnect(); lyriaSessionRef.current = null;
    lyriaPlayerRef.current?.stop(); lyriaPlayerRef.current = null;
    setLyriaStatus("disconnected");
    setLyriaCloseDetail(null);
  }, []);

  const handleStart = useCallback(async () => {
    if (isStartingRef.current) return;
    isStartingRef.current = true;

    try {
      captureRef.current?.stop(); captureRef.current = null;
      playerRef.current?.stop(); playerRef.current = null;
      sessionRef.current?.disconnect(); sessionRef.current = null;
      stopLyria();

      setError(null);
      setTranscript([]);
      setConversationStarted(false);
      setUsageEvents([]);
      usageIdRef.current = 0;

      const player = new AudioPlayer();
      player.start();
      playerRef.current = player;

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

      const session = new GeminiLiveSession(
        {
          onAudioChunk: (base64) => { player.enqueue(base64); },
          onTranscript: (entry) => {
            if (entry.role === "model") {
              moodMapperRef.current?.feed(entry.text);
            }
            setTranscript((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === entry.role) {
                return [...prev.slice(0, -1), { ...last, text: last.text + entry.text }];
              }
              return [...prev, entry];
            });
          },
          onStateChange: (s) => {
            setState(s);
            // When Gemini stops unexpectedly, tear down Lyria too so music
            // never outlives the session and the button always returns to Start.
            if (s === "error" || s === "disconnected") {
              stopLyria();
            }
            if (s === "error") {
              setError((prev) => prev ?? "WebSocket error or disconnect. Check the browser console.");
            }
          },
          onTokenFetchFailed: (msg) => { setError(msg); },
          onHandshakeFailed: (msg) => { setError(msg); },
          onInterrupted: () => { player.flush(); },
          onUsageMetadata: (payload) => {
            usageIdRef.current += 1;
            const id = usageIdRef.current;
            const at = Date.now();
            setUsageEvents((prev) => [...prev, { id, at, payload }].slice(-24));
          },
        },
        STORYTELLER_PROMPT
      );

      sessionRef.current = session;
      await session.connect();

      // Start Lyria AFTER Gemini is established — both use the same API key on
      // generativelanguage.googleapis.com. Opening Lyria first causes the server
      // to reject the Gemini session with 1007 when Lyria's play() fires (~2s in).
      void lyriaSession.connect();

      try {
        const capture = new AudioCapture();
        await capture.start((base64Pcm) => { session.sendAudio(base64Pcm); });
        captureRef.current = capture;
      } catch (err) {
        console.error("Mic access denied:", err);
        setError("Microphone access is required. Please allow mic access and try again.");
        session.disconnect();
      }
    } catch (err) {
      console.error("[handleStart] Unexpected error:", err);
      setError("Failed to start: " + (err instanceof Error ? err.message : String(err)));
      stopLyria();
    } finally {
      isStartingRef.current = false;
    }
  }, [stopLyria]);

  const handleStop = useCallback(() => {
    captureRef.current?.stop(); captureRef.current = null;
    playerRef.current?.stop(); playerRef.current = null;
    sessionRef.current?.disconnect(); sessionRef.current = null;
    stopLyria();
    setUsageEvents([]);
  }, [stopLyria]);

  const isActive = state === "connected";
  // Show Stop button if voice OR music is running so the user can always exit cleanly.
  const isAnythingActive = isActive || lyriaStatus === "connected" || lyriaStatus === "connecting";

  // Last 2 transcript entries for the bottom preview
  const transcriptPreview = transcript.slice(-2);

  const statusLabel =
    state === "connected" ? "Listening" :
    state === "connecting" ? "Connecting…" :
    state === "error" ? "Error" :
    "Ready";

  const statusDotClass =
    state === "connected" ? "bg-emerald-400" :
    state === "connecting" ? "bg-amber-400 animate-pulse" :
    state === "error" ? "bg-red-400" :
    "bg-stone-500";

  const musicDotClass =
    lyriaStatus === "connected" ? "bg-purple-400" :
    lyriaStatus === "connecting" ? "bg-purple-400 animate-pulse" :
    "bg-purple-900/50";

  return (
    <div className="relative w-full h-dvh overflow-hidden bg-stone-950">

      {/* ── Fullscreen frog canvas ── */}
      <div className="absolute inset-0">
        <StorytellerFrog
          isSpeaking={isAudioPlaying}
          width={screenSize.width}
          height={screenSize.height}
          fullscreen
        />
      </div>

      {/* ── Top gradient scrim ── */}
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/55 to-transparent pointer-events-none" />

      {/* ── Top bar: title + status ── */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-5 pt-12">
        <h1 className="text-xl font-semibold text-white tracking-tight drop-shadow-sm">
          Saga
        </h1>

        <div className="flex items-center gap-2">
          {/* Voice state dot */}
          <div className={`w-2 h-2 rounded-full ${statusDotClass}`} />
          <span className="text-xs text-white/80 uppercase tracking-wider font-medium">
            {statusLabel}
          </span>
          {/* Music / Lyria dot — always visible */}
          <div className={`w-2.5 h-2.5 rounded-full ${musicDotClass}`} title={lyriaCloseDetail ?? undefined} />
          {/* Drawer trigger */}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="ml-1 p-1.5 text-white/60 hover:text-white/90 active:opacity-70 touch-manipulation"
            aria-label="Open settings"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Error toast ── */}
      {error && (
        <div className="absolute top-24 inset-x-5 px-4 py-2.5 bg-red-950/90 border border-red-700/60 rounded-xl text-red-200 text-sm text-center backdrop-blur-sm z-10">
          {error}
        </div>
      )}

      {/* ── Bottom gradient scrim ── */}
      <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/75 via-black/30 to-transparent pointer-events-none" />

      {/* ── Transcript preview: last 2 turns, max 3 text lines; overflow clips top (newest stays visible) ── */}
      {transcriptPreview.length > 0 && (
        <div className="absolute inset-x-0 bottom-48 px-5 drop-shadow-lg">
          <div
            className="text-sm leading-snug max-h-[3lh] overflow-hidden flex flex-col justify-end [&_p]:m-0"
            aria-live="polite"
            aria-relevant="additions text"
          >
            <div className="space-y-1">
              {transcriptPreview.map((entry, i) => (
                <TranscriptLine
                  key={`${i}-${entry.role}`}
                  text={entry.text}
                  role={entry.role}
                  dim={i < transcriptPreview.length - 1}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── "Say hi!" nudge — once per session, before any back-and-forth ── */}
      <div
        className={`
          absolute inset-x-0 bottom-48 flex justify-center
          transition-all duration-700 ease-out pointer-events-none
          ${isActive && !isAudioPlaying && !conversationStarted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}
        `}
      >
        <p className="text-4xl font-bold text-white drop-shadow-lg tracking-tight">
          Say hi!
        </p>
      </div>

      {/* ── Start / Stop button ── */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center pb-12">
        <button
          type="button"
          onClick={isAnythingActive ? handleStop : handleStart}
          disabled={state === "connecting"}
          className={`
            w-28 h-28 rounded-full border-2 transition-all duration-300
            flex items-center justify-center text-lg font-medium
            disabled:opacity-50 disabled:cursor-not-allowed
            touch-manipulation select-none active:scale-95
            backdrop-blur-sm
            ${isAnythingActive
              ? "border-red-400/60 bg-red-400/15 text-red-200 hover:bg-red-400/25"
              : "border-emerald-400/60 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
            }
          `}
        >
          {isAnythingActive ? (
            "Stop"
          ) : state === "connecting" ? (
            "…"
          ) : (
            <PlaySagaIcon className="w-11 h-11 shrink-0" />
          )}
        </button>
      </div>

      {/* ── Drawer backdrop ── */}
      {drawerOpen && (
        <div
          className="absolute inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* ── Drawer (bottom sheet) ── */}
      <div
        className={`
          absolute inset-x-0 bottom-0 z-50
          max-h-[85dvh] bg-stone-900 rounded-t-2xl
          flex flex-col overflow-hidden
          transition-transform duration-300 ease-out
          ${drawerOpen ? "translate-y-0" : "translate-y-full"}
        `}
      >
        {/* Handle */}
        <div className="flex-none flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-stone-700" />
        </div>

        {/* Drawer header */}
        <div className="flex-none flex items-center justify-between px-5 py-3 border-b border-stone-800">
          <h2 className="text-sm font-medium text-stone-200">Details</h2>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="text-sm text-stone-400 hover:text-stone-200 touch-manipulation px-1 py-0.5"
          >
            Done
          </button>
        </div>

        {/* Drawer content */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-7 pb-10">

          {/* Full transcript */}
          {transcript.length > 0 && (
            <section>
              <h3 className="text-[10px] uppercase tracking-wider text-stone-500 mb-3">
                Transcript
              </h3>
              <div className="space-y-3">
                {transcript.map((entry, i) => (
                  <div
                    key={i}
                    className={`text-sm leading-relaxed ${
                      entry.role === "user" ? "text-stone-400 italic" : "text-stone-200"
                    }`}
                  >
                    <span className="text-xs text-stone-600 mr-2">
                      {entry.role === "user" ? "You" : "Saga"}
                    </span>
                    {entry.text}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Story rules */}
          <section>
            <h3 className="text-[10px] uppercase tracking-wider text-stone-500 mb-3">
              Story Rules (Prompt)
            </h3>
            <p className="text-xs text-stone-500 leading-relaxed mb-3">
              Gemini Live gets one{" "}
              <code className="text-emerald-300/80">systemInstruction</code> on connect,
              defined in{" "}
              <code className="text-emerald-300/80">{STORYTELLER_PROMPT_SOURCE_FILE}</code>.
            </p>
            <div className="space-y-2">
              {SAGA_RULE_BLOCKS.map((block) => (
                <details
                  key={block.id}
                  className="rounded-lg border border-stone-800 bg-stone-950/80 overflow-hidden"
                >
                  <summary className="cursor-pointer px-3 py-2.5 text-sm text-stone-300 hover:bg-stone-900/80 list-none flex gap-1 items-baseline">
                    <span className="font-medium text-stone-200">{block.title}</span>
                    <span className="text-stone-500 text-xs ml-1">— {block.summary}</span>
                  </summary>
                  <pre className="border-t border-stone-800 px-3 py-2 text-[11px] leading-snug text-stone-400 whitespace-pre-wrap break-words font-mono max-h-36 overflow-y-auto">
                    {block.body}
                  </pre>
                </details>
              ))}
            </div>
            <details className="mt-2 rounded-lg border border-stone-800 bg-stone-950/80 overflow-hidden">
              <summary className="cursor-pointer px-3 py-2.5 text-xs text-stone-500 uppercase tracking-wider">
                Full system prompt
              </summary>
              <div className="border-t border-stone-800 max-h-48 overflow-y-auto p-3">
                <pre className="text-[11px] leading-snug text-stone-300 whitespace-pre-wrap break-words font-mono">
                  {STORYTELLER_PROMPT}
                </pre>
              </div>
            </details>
          </section>

          {/* Usage decoder */}
          <section>
            <h3 className="text-[10px] uppercase tracking-wider text-stone-500 mb-3">
              Usage Decoder
            </h3>
            {usageEvents.length === 0 ? (
              <p className="text-xs text-stone-600">
                Token counts from Gemini appear here near turn boundaries (
                <code className="text-stone-500">usageMetadata</code> on the socket).
              </p>
            ) : (
              <div className="space-y-3">
                <div className="text-xs text-amber-200/90 font-mono">
                  Latest: {usageHeadline(usageEvents[usageEvents.length - 1]!.payload)}
                </div>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-stone-800 bg-stone-950 p-2.5">
                  <pre className="text-[11px] leading-snug text-stone-300 whitespace-pre-wrap break-words font-mono">
                    {JSON.stringify(usageEvents[usageEvents.length - 1]!.payload, null, 2)}
                  </pre>
                </div>
                {usageEvents.length > 1 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-stone-600 mb-2">
                      Recent ({usageEvents.length})
                    </p>
                    <ul className="max-h-28 overflow-y-auto space-y-2 text-[10px] text-stone-500 font-mono">
                      {usageEvents
                        .slice()
                        .reverse()
                        .map((ev) => (
                          <li key={ev.id} className="border-l-2 border-stone-700 pl-2">
                            <span className="text-stone-600">
                              {new Date(ev.at).toLocaleTimeString()}
                            </span>{" "}
                            — {usageHeadline(ev.payload)}
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
