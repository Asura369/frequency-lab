import { writeFileSync } from 'node:fs';

export interface WavOptions {
  frequency?: number;
  seconds?: number;
  toneSeconds?: number;
  sampleRate?: number;
}

/** Minimal 16-bit mono PCM WAV writer, enough for deterministic test fixtures. */
export function writeToneWav(filePath: string, options: WavOptions = {}): string {
  const frequency = options.frequency ?? 440;
  const seconds = options.seconds ?? 3;
  const toneSeconds = options.toneSeconds ?? seconds;
  const sampleRate = options.sampleRate ?? 48000;

  const sampleCount = Math.floor(seconds * sampleRate);
  const toneSamples = Math.min(sampleCount, Math.floor(toneSeconds * sampleRate));
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < sampleCount; i++) {
    const value =
      i < toneSamples
        ? Math.round(Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.4 * 32767)
        : 0;
    buffer.writeInt16LE(value, 44 + i * 2);
  }

  writeFileSync(filePath, buffer);
  return filePath;
}
