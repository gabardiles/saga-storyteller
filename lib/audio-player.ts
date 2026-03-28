/**
 * Audio player for Gemini Live API output.
 *
 * Receives base64-encoded PCM chunks (24kHz, 16-bit, mono),
 * decodes them, queues into AudioBuffers, and plays sequentially.
 */

const OUTPUT_SAMPLE_RATE = 24000;

export class AudioPlayer {
  private audioContext: AudioContext | null = null;
  private queue: AudioBuffer[] = [];
  private isPlaying = false;
  private nextStartTime = 0;

  start(): void {
    this.audioContext = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    this.queue = [];
    this.isPlaying = false;
    this.nextStartTime = 0;
  }

  /**
   * Enqueue a base64-encoded PCM chunk for playback.
   */
  enqueue(base64Pcm: string): void {
    if (!this.audioContext) return;

    const pcmData = this.base64ToInt16(base64Pcm);
    const floatData = this.int16ToFloat32(pcmData);

    const buffer = this.audioContext.createBuffer(
      1,
      floatData.length,
      OUTPUT_SAMPLE_RATE
    );
    buffer.getChannelData(0).set(floatData);

    this.queue.push(buffer);
    this.playNext();
  }

  /**
   * Stop playback and clear queue (used on interruption).
   */
  flush(): void {
    this.queue = [];
    this.isPlaying = false;
    this.nextStartTime = 0;
    // Create a new context to kill any playing sources
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    }
  }

  stop(): void {
    this.queue = [];
    this.isPlaying = false;
    this.audioContext?.close();
    this.audioContext = null;
  }

  /**
   * Returns true while scheduled audio has not yet finished playing.
   * Uses AudioContext.currentTime vs nextStartTime so it stays accurate
   * even when all chunks were received up-front in a burst.
   */
  isCurrentlyPlaying(): boolean {
    if (!this.audioContext) return false;
    return this.audioContext.currentTime < this.nextStartTime;
  }

  private playNext(): void {
    if (!this.audioContext || this.queue.length === 0) return;

    const buffer = this.queue.shift()!;
    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.audioContext.destination);

    const currentTime = this.audioContext.currentTime;
    const startTime = Math.max(currentTime, this.nextStartTime);

    source.start(startTime);
    this.nextStartTime = startTime + buffer.duration;

    source.onended = () => {
      if (this.queue.length > 0) {
        this.playNext();
      } else {
        this.isPlaying = false;
      }
    };

    this.isPlaying = true;
  }

  private base64ToInt16(base64: string): Int16Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Int16Array(bytes.buffer);
  }

  private int16ToFloat32(int16: Int16Array): Float32Array {
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
    }
    return float32;
  }
}
