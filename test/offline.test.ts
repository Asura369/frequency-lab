import { test, expect } from 'vitest';
import { createFft, hannWindow, magnitudeDb } from '../src/app/offline/fft';
import { analyseAudio } from '../src/app/offline/analyse';

function near(actual: number, expected: number, tolerance: number, label = 'value') {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected} ±${tolerance}, got ${actual}`);
  }
}

function sine(frequency: number, amplitude: number, seconds: number, sampleRate = 48000): Float32Array {
  const samples = new Float32Array(Math.floor(seconds * sampleRate));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * amplitude;
  }
  return samples;
}

function mix(parts: Array<{ hz: number; amp: number }>, seconds: number, sampleRate = 48000): Float32Array {
  const samples = new Float32Array(Math.floor(seconds * sampleRate));
  for (let i = 0; i < samples.length; i++) {
    let value = 0;
    for (const part of parts) value += Math.sin((2 * Math.PI * part.hz * i) / sampleRate) * part.amp;
    samples[i] = value;
  }
  return samples;
}

test('FFT finds a windowed sine at full amplitude', () => {
  const size = 16384;
  const sampleRate = 48000;
  const binHz = sampleRate / size;
  const bin = 341;
  const frequency = bin * binHz;
  const window = hannWindow(size);
  const input = sine(frequency, 0.5, size / sampleRate, sampleRate);
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    re[i] = input[i] * window[i];
    sum += window[i];
  }
  const fft = createFft(size);
  fft.forward(re, im);
  const db = new Float32Array(size / 2);
  magnitudeDb(re, im, db.length, sum, db);

  let maxBin = 0;
  for (let i = 1; i < db.length; i++) if (db[i] > db[maxBin]) maxBin = i;
  expect(maxBin).toBe(bin);
  near(db[maxBin], 20 * Math.log10(0.5), 0.3, 'amplitude');
});

test('whole-file analysis detects a target under a louder peak', async () => {
  const samples = mix(
    [
      { hz: 963.5, amp: 0.34 },
      { hz: 639.9, amp: 0.17 },
      { hz: 396.3, amp: 0.05 },
    ],
    3,
    48000
  );

  const report = await analyseAudio({
    samples,
    sampleRate: 48000,
    targetHz: 396,
    tolHz: 3,
    maxFrames: 400,
  });

  expect(report.durationS).toBeCloseTo(3, 5);
  expect(report.target.valid).toBe(true);
  expect(report.target.percent).not.toBeNull();
  expect(report.target.percent as number).toBeGreaterThan(80);
  expect(report.summary.dominantHz).not.toBeNull();
  expect(Math.abs((report.summary.dominantHz as number) - 963.5)).toBeLessThan(3);
  expect(report.peaks[0].hz).toBeGreaterThan(900);
  expect(report.bands).toHaveLength(6);
  expect(report.sections).toHaveLength(10);
  expect(report.spectrogram.data).toHaveLength(report.spectrogram.width * 240);
  expect(report.frames.t.length).toBe(report.summary.frames);
  expect(report.frames.present.some((value) => value === 1)).toBe(true);
});

test('the strongest band share follows the loudest tones', async () => {
  const samples = sine(100, 0.4, 2);
  const report = await analyseAudio({
    samples,
    sampleRate: 48000,
    targetHz: 100,
    tolHz: 3,
    maxFrames: 200,
  });
  const bass = report.bands.find((band) => band.id === 'bass');
  expect(bass).toBeDefined();
  expect(bass?.percent as number).toBeGreaterThan(70);
  expect(report.target.percent as number).toBeGreaterThan(80);
});

test('an invalid target still produces a spectral report', async () => {
  const samples = sine(440, 0.3, 1);
  const report = await analyseAudio({
    samples,
    sampleRate: 48000,
    targetHz: 25000,
    tolHz: 3,
    maxFrames: 100,
  });
  expect(report.target.valid).toBe(false);
  expect(report.target.percent).toBeNull();
  expect(report.bands.length).toBe(6);
});

test('silence is reported without a target percentage', async () => {
  const samples = new Float32Array(48000);
  const report = await analyseAudio({
    samples,
    sampleRate: 48000,
    targetHz: 440,
    tolHz: 3,
    maxFrames: 100,
  });
  expect(report.summary.signalFrames).toBe(0);
  expect(report.target.percent).toBeNull();
  expect(report.target.verdict).toBe('no-signal');
});
