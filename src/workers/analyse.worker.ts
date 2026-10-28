/** Worker entry for whole-file analysis. */

import { analyseAudio, AnalysisCancelled } from '../app/offline/analyse';

interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

interface AnalyseMessage {
  type: 'analyse';
  samples: Float32Array;
  sampleRate: number;
  targetHz: number | null;
  tolHz: number;
  maxFrames?: number;
}

scope.onmessage = (event: MessageEvent) => {
  const message = event.data as AnalyseMessage;
  if (message.type !== 'analyse') return;

  void (async () => {
    try {
      const report = await analyseAudio({
        samples: message.samples,
        sampleRate: message.sampleRate,
        targetHz: message.targetHz,
        tolHz: message.tolHz,
        maxFrames: message.maxFrames,
        onProgress: (done, total) => scope.postMessage({ type: 'progress', done, total }),
      });

      const transfer: Transferable[] = [
        report.spectrogram.data.buffer as ArrayBuffer,
        report.frames.t.buffer as ArrayBuffer,
        report.frames.hz.buffer as ArrayBuffer,
        report.frames.db.buffer as ArrayBuffer,
        report.frames.rms.buffer as ArrayBuffer,
        report.frames.snr.buffer as ArrayBuffer,
        report.frames.signal.buffer as ArrayBuffer,
        report.frames.present.buffer as ArrayBuffer,
      ];
      scope.postMessage({ type: 'done', report }, transfer);
    } catch (error) {
      if (error instanceof AnalysisCancelled) {
        scope.postMessage({ type: 'cancelled' });
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      scope.postMessage({ type: 'error', message });
    }
  })();
};
