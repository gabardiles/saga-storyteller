/**
 * Ambient sound manager.
 *
 * Plays background audio loops that match the story mood.
 * Crossfades between moods for smooth transitions.
 *
 * Sound files should be placed in /public/sounds/{mood}.mp3
 * These should be seamless loops, ~30-60 seconds each.
 */

import type { SceneMood } from "./scene-analyzer";

const CROSSFADE_DURATION = 2000; // ms
const AMBIENT_VOLUME = 0.15; // low enough to not compete with Saga's voice

export class AmbientSoundManager {
  private currentMood: SceneMood | null = null;
  private currentAudio: HTMLAudioElement | null = null;
  private nextAudio: HTMLAudioElement | null = null;
  private fadeInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Transition to a new mood. If same mood, does nothing.
   */
  setMood(mood: SceneMood): void {
    if (mood === this.currentMood) return;

    const audioPath = `/sounds/${mood}.mp3`;
    const audio = new Audio(audioPath);
    audio.loop = true;
    audio.volume = 0;

    // Check if file exists before playing
    audio.addEventListener("canplaythrough", () => {
      this.crossfadeTo(audio, mood);
    }, { once: true });

    audio.addEventListener("error", () => {
      console.warn(`No ambient sound found for mood: ${mood}`);
    }, { once: true });

    audio.load();
  }

  private crossfadeTo(newAudio: HTMLAudioElement, mood: SceneMood): void {
    // Clear any existing crossfade
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
    }

    const oldAudio = this.currentAudio;
    this.nextAudio = newAudio;

    // Start new audio at 0 volume
    newAudio.volume = 0;
    newAudio.play().catch(() => {
      console.warn("Ambient audio play blocked — needs user interaction first");
    });

    const steps = CROSSFADE_DURATION / 50;
    const volumeStep = AMBIENT_VOLUME / steps;
    let step = 0;

    this.fadeInterval = setInterval(() => {
      step++;

      // Fade in new
      newAudio.volume = Math.min(AMBIENT_VOLUME, volumeStep * step);

      // Fade out old
      if (oldAudio) {
        oldAudio.volume = Math.max(0, AMBIENT_VOLUME - volumeStep * step);
      }

      if (step >= steps) {
        if (this.fadeInterval) clearInterval(this.fadeInterval);
        this.fadeInterval = null;

        // Clean up old audio
        if (oldAudio) {
          oldAudio.pause();
          oldAudio.src = "";
        }

        this.currentAudio = newAudio;
        this.currentMood = mood;
        this.nextAudio = null;
      }
    }, 50);
  }

  stop(): void {
    if (this.fadeInterval) {
      clearInterval(this.fadeInterval);
      this.fadeInterval = null;
    }
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.src = "";
      this.currentAudio = null;
    }
    if (this.nextAudio) {
      this.nextAudio.pause();
      this.nextAudio.src = "";
      this.nextAudio = null;
    }
    this.currentMood = null;
  }
}
