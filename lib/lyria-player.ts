/**
 * Audio player for Lyria RealTime music output.
 *
 * Lyria outputs 48kHz stereo interleaved PCM (L, R, L, R …).
 * Plays through its own AudioContext at 15% volume so it never competes
 * with Saga's voice (which runs in a separate 24kHz mono AudioContext).
 */

const LYRIA_SAMPLE_RATE = 48000;
const LYRIA_CHANNELS = 2;
const DEFAULT_VOLUME = 0.15;

export class LyriaPlayer {
  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private nextStartTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  start(): void {
    this.audioContext = new AudioContext({ sampleRate: LYRIA_SAMPLE_RATE });
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = DEFAULT_VOLUME;
    this.gainNode.connect(this.audioContext.destination);
    this.nextStartTime = 0;
    this.activeSources = [];
  }

  setVolume(v: number): void {
    if (this.gainNode) this.gainNode.gain.value = Math.max(0, Math.min(1, v));
  }

  /**
   * Enqueue a base64-encoded interleaved stereo PCM chunk for playback.
   */
  enqueue(base64Pcm: string): void {
    if (!this.audioContext || !this.gainNode) return;

    const int16 = this.base64ToInt16(base64Pcm);
    // Lyria sends interleaved stereo: [L0, R0, L1, R1, ...]
    const frameCount = Math.floor(int16.length / LYRIA_CHANNELS);
    const left = new Float32Array(frameCount);
    const right = new Float32Array(frameCount);

    for (let i = 0; i < frameCount; i++) {
      const l = int16[i * 2];
      const r = int16[i * 2 + 1];
      left[i] = l / (l < 0 ? 0x8000 : 0x7fff);
      right[i] = r / (r < 0 ? 0x8000 : 0x7fff);
    }

    const buffer = this.audioContext.createBuffer(
      LYRIA_CHANNELS,
      frameCount,
      LYRIA_SAMPLE_RATE
    );
    buffer.getChannelData(0).set(left);
    buffer.getChannelData(1).set(right);

    // Schedule immediately at enqueue time — gapless pattern.
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);

    const currentTime = this.audioContext.currentTime;
    const startTime = Math.max(currentTime, this.nextStartTime);
    source.start(startTime);
    this.nextStartTime = startTime + buffer.duration;

    // Track so we can hard-stop immediately on stop().
    this.activeSources.push(source);
    source.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== source);
    };
  }

  stop(): void {
    // Silence immediately: stop all pre-scheduled source nodes.
    for (const src of this.activeSources) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    this.activeSources = [];
    this.nextStartTime = 0;
    this.audioContext?.close();
    this.audioContext = null;
    this.gainNode = null;
  }

  private base64ToInt16(base64: string): Int16Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Int16Array(bytes.buffer);
  }
}
