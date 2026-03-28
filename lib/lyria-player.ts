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
  private queue: AudioBuffer[] = [];
  private isPlaying = false;
  private nextStartTime = 0;

  start(): void {
    this.audioContext = new AudioContext({ sampleRate: LYRIA_SAMPLE_RATE });
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = DEFAULT_VOLUME;
    this.gainNode.connect(this.audioContext.destination);

    this.queue = [];
    this.isPlaying = false;
    this.nextStartTime = 0;
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

    this.queue.push(buffer);
    this.playNext();
  }

  stop(): void {
    this.queue = [];
    this.isPlaying = false;
    this.audioContext?.close();
    this.audioContext = null;
    this.gainNode = null;
  }

  private playNext(): void {
    if (
      !this.audioContext ||
      !this.gainNode ||
      this.queue.length === 0 ||
      this.isPlaying
    )
      return;

    const buffer = this.queue.shift()!;
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);

    const currentTime = this.audioContext.currentTime;
    const startTime = Math.max(currentTime, this.nextStartTime);
    source.start(startTime);
    this.nextStartTime = startTime + buffer.duration;

    this.isPlaying = true;
    source.onended = () => {
      this.isPlaying = false;
      if (this.queue.length > 0) this.playNext();
    };
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
