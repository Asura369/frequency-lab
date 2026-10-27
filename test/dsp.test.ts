import { expect, test } from 'vitest';
import { FreqLabDSP as DSP } from '../src/dsp/core';

let passes = 0;
let failures = 0;

function near(actual: number, expected: number, tolerance: number, label = 'value') {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label}: expected ${expected} ±${tolerance}, got ${actual}`);
  }
}

function equal(actual: unknown, expected: unknown, label = 'value') {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

test('noteFor(440) is A4 with zero cents', () => {
  const note = DSP.noteFor(440);
  equal(note.name, 'A4', 'note');
  near(note.cents, 0, 1e-6, 'cents');
});

test('noteFor(432) is A4, 31.77 cents flat', () => {
  const note = DSP.noteFor(432);
  equal(note.name, 'A4', 'note');
  near(note.cents, -31.766, 0.05, 'cents');
});

test('noteFor(261.625565) is C4', () => {
  const note = DSP.noteFor(261.625565);
  equal(note.name, 'C4', 'note');
});

test('noteFor(3520) is A7', () => {
  equal(DSP.noteFor(3520).name, 'A7');
});

test('noteFor rejects invalid input', () => {
  equal(DSP.noteFor(0), null);
  equal(DSP.noteFor(-440), null);
  equal(DSP.noteFor(NaN), null);
});

test('parabolicOffset recovers a +0.2 bin peak', () => {
  near(DSP.parabolicOffset(-1.44, -0.04, -0.64), 0.2, 1e-9);
});

test('parabolicOffset is zero for a symmetric peak', () => {
  near(DSP.parabolicOffset(-1, 0, -1), 0, 1e-12);
});

test('parabolicOffset ignores non-finite neighbours', () => {
  equal(DSP.parabolicOffset(-Infinity, -20, -Infinity), 0);
  equal(DSP.parabolicOffset(NaN, -20, -30), 0);
});

test('parabolicOffset clamps to half a bin', () => {
  near(DSP.parabolicOffset(-100, 0, 0), 0.5, 1e-12);
  near(DSP.parabolicOffset(0, 0, -100), -0.5, 1e-12);
});

test('median handles odd and even lengths', () => {
  near(DSP.median([3, 1, 2]), 2, 1e-12);
  near(DSP.median([4, 1, 3, 2]), 2.5, 1e-12);
});

test('noiseFloor ignores a loud tone', () => {
  const db = new Float32Array(1000).fill(-90);
  for (let i = 100; i <= 110; i++) db[i] = -20;
  near(DSP.noiseFloor(db, 20, 900, 8), -90, 1e-9);
});

test('pickPeaks finds a tone with sub-bin interpolation', () => {
  const sr = 48000;
  const fft = 32768;
  const binHz = sr / fft;
  const db = new Float32Array(fft / 2).fill(-100);
  const bin = Math.round(440 / binHz);
  db[bin - 1] = -30;
  db[bin] = -20;
  db[bin + 1] = -30;
  const peaks = DSP.pickPeaks(db, { sampleRate: sr, fftSize: fft, floorDb: -100 });
  equal(peaks.length, 1, 'peak count');
  near(peaks[0].hz, bin * binHz, 0.01, 'peak hz');
  near(peaks[0].db, -20, 1e-6, 'peak db');
});

test('pickPeaks includes the 20 Hz boundary', () => {
  const sr = 48000;
  const fft = 32768;
  const binHz = sr / fft;
  const db = new Float32Array(fft / 2).fill(-100);
  const bin = Math.ceil(20 / binHz);
  db[bin - 1] = -40;
  db[bin] = -30;
  db[bin + 1] = -40;
  const peaks = DSP.pickPeaks(db, { sampleRate: sr, fftSize: fft, floorDb: -100 });
  if (!peaks.some((peak) => peak.hz >= 20 && peak.hz <= 22)) {
    throw new Error(`expected a peak at the 20 Hz edge, got ${JSON.stringify(peaks)}`);
  }
});

test('pickPeaks includes the 20 kHz boundary', () => {
  const sr = 48000;
  const fft = 32768;
  const binHz = sr / fft;
  const db = new Float32Array(fft / 2).fill(-100);
  const bin = Math.floor(20000 / binHz);
  db[bin - 1] = -40;
  db[bin] = -30;
  db[bin + 1] = -40;
  const peaks = DSP.pickPeaks(db, { sampleRate: sr, fftSize: fft, floorDb: -100 });
  if (!peaks.some((peak) => peak.hz >= 19990 && peak.hz <= 20000)) {
    throw new Error(`expected a peak at the 20 kHz edge, got ${JSON.stringify(peaks)}`);
  }
});

test('pickPeaks excludes sub-20 Hz and above-20 kHz peaks', () => {
  const sr = 48000;
  const fft = 32768;
  const db = new Float32Array(fft / 2).fill(-100);
  db[2] = -5; // 2.9 Hz
  db[14000] = -5; // 20.5 kHz
  const peaks = DSP.pickPeaks(db, { sampleRate: sr, fftSize: fft, floorDb: -100 });
  equal(peaks.length, 0, 'peak count');
});

test('pickPeaks ignores levels below the absolute floor', () => {
  const sr = 48000;
  const fft = 32768;
  const db = new Float32Array(fft / 2).fill(-160);
  const bin = Math.round(440 / (sr / fft));
  db[bin - 1] = -155;
  db[bin] = -150;
  db[bin + 1] = -155;
  const peaks = DSP.pickPeaks(db, {
    sampleRate: sr,
    fftSize: fft,
    floorDb: -160,
    minLevelDb: -100,
  });
  equal(peaks.length, 0, 'peak count');
});

test('pickPeaks returns at most six peaks, strongest first', () => {
  const sr = 48000;
  const fft = 32768;
  const binHz = sr / fft;
  const db = new Float32Array(fft / 2).fill(-100);
  const freqs = [100, 200, 400, 800, 1600, 3200, 6400, 9000];
  freqs.forEach((hz, index) => {
    const bin = Math.round(hz / binHz);
    db[bin - 1] = -50 - index * 2;
    db[bin] = -30 - index;
    db[bin + 1] = -50 - index * 2;
  });
  const peaks = DSP.pickPeaks(db, { sampleRate: sr, fftSize: fft, floorDb: -100 });
  equal(peaks.length, 6, 'peak count');
  for (let i = 1; i < peaks.length; i++) {
    if (!(peaks[i - 1].db >= peaks[i].db)) throw new Error('peaks are not sorted by level');
  }
});

test('bandPowerDb averages power rather than dB', () => {
  const flat = new Float32Array(10).fill(-60);
  near(DSP.bandPowerDb(flat, 0, 9), -60, 1e-9);
  const mixed = new Float32Array(4);
  mixed[0] = -60;
  mixed[1] = -60;
  mixed[2] = -50;
  mixed[3] = -50;
  near(DSP.bandPowerDb(mixed, 0, 3), 10 * Math.log10((2e-6 + 2e-5) / 4), 1e-9);
});

test('targetEvidence detects a tone inside the band', () => {
  const sr = 48000;
  const fft = 32768;
  const binHz = sr / fft;
  const db = new Float32Array(fft / 2).fill(-100);
  const bin = Math.round(440 / binHz);
  db[bin - 2] = -50;
  db[bin - 1] = -30;
  db[bin] = -20;
  db[bin + 1] = -30;
  db[bin + 2] = -50;
  const ev = DSP.targetEvidence(db, {
    sampleRate: sr,
    fftSize: fft,
    targetHz: 440,
    tolHz: 3,
    floorDb: -100,
  });
  equal(ev.valid, true, 'valid');
  equal(ev.tonePresent, true, 'tonePresent');
  near(ev.peakHz, bin * binHz, 0.01, 'peakHz');
  if (!(ev.snrDb > 50)) throw new Error(`expected high band SNR, got ${ev.snrDb}`);
  if (!(ev.prominenceDb > 50)) throw new Error(`expected high prominence, got ${ev.prominenceDb}`);
});

test('targetEvidence clamps a wide tolerance to the 20 Hz edge', () => {
  const sr = 48000;
  const fft = 32768;
  const binHz = sr / fft;
  const db = new Float32Array(fft / 2).fill(-100);
  const lowBin = Math.round(7 / binHz);
  db[lowBin - 1] = -50;
  db[lowBin] = -20;
  db[lowBin + 1] = -50;
  const ev = DSP.targetEvidence(db, {
    sampleRate: sr,
    fftSize: fft,
    targetHz: 20,
    tolHz: 50,
    floorDb: -100,
  });
  equal(ev.valid, true, 'valid');
  equal(ev.tonePresent, false, 'tonePresent');
});

test('maxTargetHz follows Nyquist', () => {
  equal(DSP.maxTargetHz(48000), 20000);
  equal(DSP.maxTargetHz(32000), 16000);
  equal(DSP.maxTargetHz(96000), 20000);
});

test('targetEvidence accepts a 20 kHz target at 48 kHz', () => {
  const sr = 48000;
  const fft = 32768;
  const binHz = sr / fft;
  const db = new Float32Array(fft / 2).fill(-100);
  const bin = Math.round(20000 / binHz);
  db[bin - 1] = -40;
  db[bin] = -30;
  const ev = DSP.targetEvidence(db, {
    sampleRate: sr,
    fftSize: fft,
    targetHz: 20000,
    tolHz: 3,
    floorDb: -100,
  });
  equal(ev.valid, true, 'valid');
  equal(ev.tonePresent, true, 'tonePresent');
});

test('targetEvidence rejects an empty band', () => {
  const sr = 48000;
  const fft = 32768;
  const db = new Float32Array(fft / 2).fill(-100);
  const ev = DSP.targetEvidence(db, {
    sampleRate: sr,
    fftSize: fft,
    targetHz: 440,
    tolHz: 3,
    floorDb: -100,
  });
  equal(ev.valid, true, 'valid');
  equal(ev.tonePresent, false, 'tonePresent');
});

test('buildLogRows maps top to high frequency, bottom to low', () => {
  const rows = DSP.buildLogRows(256, 20, 20000, 48000, 8192, 4096);
  equal(rows.length, 256, 'row count');
  near(rows[0].hz, 20000, 1e-6, 'first hz');
  near(rows[255].hz, 20, 1e-6, 'last hz');
  for (let i = 1; i < rows.length; i++) {
    if (!(rows[i].hz < rows[i - 1].hz)) throw new Error('rows are not descending in frequency');
  }
  if (!(rows[0].bin > rows[255].bin)) throw new Error('row bins are not descending');
});

test('finalizeBucket marks presence only for a tone majority', () => {
  equal(DSP.finalizeBucket(10, 6).present, true);
  equal(DSP.finalizeBucket(10, 4).present, false);
  equal(DSP.finalizeBucket(0, 0).signal, false);
});

test('summarizeBuckets counts signal buckets only', () => {
  const summary = DSP.summarizeBuckets([
    { signal: true, present: true },
    { signal: true, present: false },
    { signal: false, present: false },
    { signal: true, present: true },
  ]);
  equal(summary.signalBuckets, 3, 'signalBuckets');
  equal(summary.presentBuckets, 2, 'presentBuckets');
  near(summary.percent, 66.6667, 0.001, 'percent');
  equal(DSP.summarizeBuckets([]).percent, null, 'empty percent');
});

test('verdictFor thresholds', () => {
  equal(DSP.verdictFor(90, 40), 'consistent');
  equal(DSP.verdictFor(50, 40), 'intermittent');
  equal(DSP.verdictFor(5, 40), 'not-detected');
  equal(DSP.verdictFor(null, 0), 'no-signal');
  equal(DSP.verdictFor(100, 4), 'collecting');
});

test('a quiet target is present while another peak dominates', () => {
  const sr = 48000;
  const fft = 32768;
  const binHz = sr / fft;
  const db = new Float32Array(fft / 2).fill(-100);
  const paint = (hz: number, level: number) => {
    const bin = Math.round(hz / binHz);
    db[bin - 1] = level - 12;
    db[bin] = level;
    db[bin + 1] = level - 12;
  };
  paint(963.5, -30);
  paint(639.9, -50);
  paint(396.3, -70);

  const peaks = DSP.pickPeaks(db, { sampleRate: sr, fftSize: fft, floorDb: -100 });
  expect(peaks[0].hz).toBeCloseTo(963.5, 0);

  const evidence = DSP.targetEvidence(db, {
    sampleRate: sr,
    fftSize: fft,
    targetHz: 396,
    tolHz: 3,
    floorDb: -100,
  });
  expect(evidence.valid).toBe(true);
  expect(evidence.tonePresent).toBe(true);
  expect(peaks[0].db - (evidence.peakDb ?? 0)).toBeGreaterThan(30);
});
