import type { AppState } from '../src/app/state';
import type { NoteInfo } from '../src/dsp/core';

declare global {
  interface Window {
    __freqLab: {
      state: AppState;
      runSelfTest: (auto?: boolean) => Promise<{ ok: boolean }>;
      noteFor: (hz: number) => NoteInfo | null;
    };
    __selfTestResult?: unknown;
    launchQueue?: {
      setConsumer: (consumer: (params: { files?: Array<{ getFile: () => Promise<File> }> }) => void) => void;
    };
  }
}

export {};
