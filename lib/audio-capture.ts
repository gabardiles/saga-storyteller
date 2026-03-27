/**
 * Mic capture and PCM encoding for Gemini Live API.
 *
 * Uses ScriptProcessorNode (simpler than AudioWorklet for a POC).
 * Captures mic, downsamples to 16kHz, converts to Int16 PCM,
 * base64 encodes, and calls back with chunks.
 */

const TARGET_SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;

export class AudioCapture {
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private onChunk: ((base64Pcm: string) => void) | null = null;

  async start(onChunk: (base64Pcm: string) => void): Promise<void> {
    this.onChunk = onChunk;

    // Request mic with echo cancellation (critical for speaker feedback)
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: { ideal: TARGET_SAMPLE_RATE },
      },
    });

    this.audioContext = new AudioContext({ sampleRate: 48000 });
    this.source = this.audioContext.createMediaStreamSource(this.stream);

    // ScriptProcessorNode for simplicity in POC
    // (AudioWorklet is better for production but more setup)
    this.processor = this.audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    this.processor.onaudioprocess = (event) => {
      const inputData = event.inputBuffer.getChannelData(0);
      const pcm16k = this.downsample(inputData, this.audioContext!.sampleRate);
      const int16 = this.float32ToInt16(pcm16k);
      const bytes = new Uint8Array(
        int16.buffer,
        int16.byteOffset,
        int16.byteLength
      );
      const base64 = this.uint8ToBase64(bytes);
      this.onChunk?.(base64);
    };

    // Keep the graph alive without routing mic to speakers (avoids feedback with Saga audio)
    const silent = this.audioContext.createGain();
    silent.gain.value = 0;
    this.source.connect(this.processor);
    this.processor.connect(silent);
    silent.connect(this.audioContext.destination);
  }

  stop(): void {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.audioContext?.close();
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.audioContext = null;
    this.onChunk = null;
  }

  private downsample(buffer: Float32Array, fromRate: number): Float32Array {
    if (fromRate === TARGET_SAMPLE_RATE) return buffer;
    const ratio = fromRate / TARGET_SAMPLE_RATE;
    const newLength = Math.round(buffer.length / ratio);
    const result = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
      const index = Math.round(i * ratio);
      result[i] = buffer[Math.min(index, buffer.length - 1)];
    }
    return result;
  }

  private float32ToInt16(buffer: Float32Array): Int16Array {
    const result = new Int16Array(buffer.length);
    for (let i = 0; i < buffer.length; i++) {
      const s = Math.max(-1, Math.min(1, buffer[i]));
      result[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return result;
  }

  private uint8ToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
  }
}
