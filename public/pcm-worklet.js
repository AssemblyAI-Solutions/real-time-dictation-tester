// Captures mic audio, converts to 16-bit PCM little-endian, and posts fixed-size
// chunks to the main thread. Chunk size is set so each message carries ~80ms of
// audio at 16 kHz, inside the API's 50–1000ms per-message window.
class PcmWorklet extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunkSamples = (options && options.processorOptions && options.processorOptions.chunkSamples) || 1280;
    this.buf = new Float32Array(this.chunkSamples);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];

    for (let i = 0; i < ch.length; i++) {
      this.buf[this.filled++] = ch[i];
      if (this.filled === this.chunkSamples) {
        this.flush();
      }
    }
    return true;
  }

  flush() {
    const pcm = new Int16Array(this.filled);
    let sumSquares = 0;
    let peak = 0;
    for (let i = 0; i < this.filled; i++) {
      const s = Math.max(-1, Math.min(1, this.buf[i]));
      sumSquares += s * s;
      const a = s < 0 ? -s : s;
      if (a > peak) peak = a;
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    const rms = Math.sqrt(sumSquares / this.filled);
    this.port.postMessage({ pcm: pcm.buffer, rms, peak, samples: this.filled }, [pcm.buffer]);
    this.filled = 0;
  }
}

registerProcessor("pcm-worklet", PcmWorklet);
