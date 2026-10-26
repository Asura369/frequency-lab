import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { writeToneWav } from './audio';

/** The fake microphone file must exist before Chrome launches. */
export default function globalSetup(): void {
  const dir = path.resolve('.tmp');
  mkdirSync(dir, { recursive: true });
  writeToneWav(path.join(dir, 'fake-mic-440.wav'), { seconds: 30, toneSeconds: 30 });
}
