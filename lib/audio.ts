export interface AudioChunk {
  pcm: ArrayBuffer;
  rms: number;
  peak: number;
  samples: number;
}

export interface MicSession {
  context: AudioContext;
  stream: MediaStream;
  sampleRate: number;
  /**
   * Best available estimate of how long audio takes to reach the worklet, in ms.
   * Used to align the audio timeline with wall clock. The web platform exposes no
   * input latency directly, so this combines the render-quantum latency the
   * context reports with any latency the track reports.
   */
  inputLatencyMs: number;
  stop: () => Promise<void>;
}

/**
 * Opens the mic and streams 16-bit PCM chunks to `onChunk`.
 * Browsers honour the requested AudioContext sample rate on Chrome/Edge/Safari,
 * so no resampling is needed; the actual rate is returned for the caller to
 * pass to the API as `sample_rate`.
 */
export async function startMic(
  requestedSampleRate: number,
  onChunk: (chunk: AudioChunk) => void,
): Promise<MicSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
    },
  });

  const context = new AudioContext({ sampleRate: requestedSampleRate });
  await context.audioWorklet.addModule("/pcm-worklet.js");

  const source = context.createMediaStreamSource(stream);
  const chunkSamples = Math.max(400, Math.round(context.sampleRate * 0.08));
  const node = new AudioWorkletNode(context, "pcm-worklet", {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    processorOptions: { chunkSamples },
  });

  node.port.onmessage = (event) => onChunk(event.data as AudioChunk);
  source.connect(node);

  const trackLatency =
    (stream.getAudioTracks()[0]?.getSettings() as { latency?: number } | undefined)?.latency ?? 0;

  return {
    context,
    stream,
    sampleRate: context.sampleRate,
    inputLatencyMs: (context.baseLatency + trackLatency) * 1000,
    stop: async () => {
      node.port.onmessage = null;
      try {
        source.disconnect();
        node.disconnect();
      } catch {
        // already torn down
      }
      stream.getTracks().forEach((t) => t.stop());
      await context.close();
    },
  };
}

/** Wraps raw 16-bit PCM in a WAV container for the Dictation API's `audio` part. */
export function pcmToWav(chunks: ArrayBuffer[], sampleRate: number): Blob {
  const dataBytes = chunks.reduce((n, c) => n + c.byteLength, 0);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  return new Blob([header, ...chunks], { type: "audio/wav" });
}
