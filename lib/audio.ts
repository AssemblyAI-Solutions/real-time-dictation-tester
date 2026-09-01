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
