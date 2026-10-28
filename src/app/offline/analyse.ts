/**
 * Whole-file analysis: fixed-size FFT frames, peak picking, target evidence,
 * band energy and a downsampled spectrogram. Pure DSP; runs in a worker or in
 * a test, never touches the DOM.
 */

import { FreqLabDSP as DSP } from '../../dsp/core';
import { createFft, hannWindow, magnitudeDb } from './fft';

export const FFT_SIZE = 16384;
export const SPEC_ROWS = 240;
export const MAX_FRAMES = 4000;
export const SECTIONS = 10;
export const SIGNAL_DB = -80;

export interface BandDefinition {
  id: string;
  label: string;
  from: number;
  to: number;
}

export const BANDS: BandDefinition[] = [
  { id: 'sub', label: 'Sub', from: 20, to: 60 },
  { id: 'bass', label: 'Bass', from: 60, to: 250 },
  { id: 'lowmid', label: 'Low mid', from: 250, to: 500 },
  { id: 'mid', label: 'Mid', from: 500, to: 2000 },
  { id: 'highmid', label: 'High mid', from: 2000, to: 6000 },
  { id: 'high', label: 'High', from: 6000, to: 20000 },
];

export interface BandShare extends BandDefinition {
  percent: number;
}

export interface SectionReport {
  startS: number;
  endS: number;
  percent: number | null;
  dominantHz: number | null;
  topBand: string | null;
}

export interface RecurringPeak {
  hz: number;
  db: number;
  count: number;
  note: string | null;
}

export interface FrameSeries {
  t: Float32Array;
  hz: Float32Array;
  db: Float32Array;
  rms: Float32Array;
  snr: Float32Array;
  signal: Uint8Array;
  present: Uint8Array;
}

export interface SpectrogramData {
  width: number;
  height: number;
  minHz: number;
  maxHz: number;
  data: Uint8Array;
}

export interface TargetReport {
  valid: boolean;
  hz: number | null;
  tol: number;
  signalFrames: number;
  presentFrames: number;
  percent: number | null;
  verdict: 'no-signal' | 'collecting' | 'consistent' | 'intermittent' | 'not-detected';
  firstPresentS: number | null;
  lastPresentS: number | null;
}

export interface WholeFileReport {
  version: 1;
  durationS: number;
  sampleRate: number;
  config: {
    fftSize: number;
    hopSamples: number;
    hopSeconds: number;
    window: 'hann';
    targetHz: number | null;
    tolHz: number;
  };
  target: TargetReport;
  summary: {
    frames: number;
    signalFrames: number;
    signalSeconds: number;
    floorDb: number;
    dominantHz: number | null;
    dominantDb: number | null;
  };
  bands: BandShare[];
  sections: SectionReport[];
  peaks: RecurringPeak[];
  frames: FrameSeries;
  spectrogram: SpectrogramData;
  elapsedMs: number;
}

export interface AnalysisOptions {
  samples: Float32Array;
  sampleRate: number;
  targetHz: number | null;
  tolHz: number;
  maxFrames?: number;
  signal?: { cancelled: boolean };
  onProgress?: (done: number, total: number) => void;
}

export class AnalysisCancelled extends Error {
  constructor() {
    super('Analysis cancelled');
    this.name = 'AnalysisCancelled';
  }
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export async function analyseAudio(options: AnalysisOptions): Promise<WholeFileReport> {
  const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const { samples, sampleRate } = options;
  if (!samples || samples.length === 0) throw new Error('The file contains no audio samples.');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Invalid sample rate.');

  const durationS = samples.length / sampleRate;
  const maxFrames = Math.max(32, options.maxFrames ?? MAX_FRAMES);
  const usable = Math.max(0, samples.length - FFT_SIZE);
  const hop = Math.max(2048, Math.ceil(usable / Math.max(1, maxFrames - 1)));
  const totalFrames = samples.length <= FFT_SIZE ? 1 : Math.floor(usable / hop) + 1;

  const fft = createFft(FFT_SIZE);
  const window = hannWindow(FFT_SIZE);
  let windowSum = 0;
  for (let i = 0; i < window.length; i++) windowSum += window[i];

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const db = new Float32Array(FFT_SIZE / 2);
  const binHz = sampleRate / FFT_SIZE;
  const nyquist = sampleRate / 2;
  const maxHz = Math.min(20000, nyquist);
  const startBin = Math.max(1, Math.ceil(20 / binHz));
  const endBin = Math.min(db.length - 2, Math.floor(Math.min(maxHz, nyquist - binHz) / binHz));
  const floorStart = startBin;
  const floorEnd = Math.max(startBin, endBin);

  const targetValid =
    options.targetHz != null &&
    Number.isFinite(options.targetHz) &&
    options.targetHz >= 20 &&
    options.targetHz <= DSP.maxTargetHz(sampleRate);
  const targetHz = targetValid ? (options.targetHz as number) : null;
  const tolHz = options.tolHz;

  const rows = DSP.buildLogRows(SPEC_ROWS, 20, maxHz, sampleRate, FFT_SIZE, db.length);
  const specStride = Math.max(1, Math.ceil(totalFrames / 1800));
  const specWidth = Math.max(1, Math.ceil(totalFrames / specStride));
  const specData = new Uint8Array(specWidth * SPEC_ROWS);

  const bandRanges = BANDS.map((band) => ({
    ...band,
    b0: Math.max(startBin, Math.ceil(band.from / binHz)),
    b1: Math.min(endBin, Math.floor(Math.min(band.to, maxHz) / binHz)),
  })).filter((band) => band.b1 >= band.b0);

  const bandPower = new Float64Array(bandRanges.length);
  const sectionBandPower = Array.from({ length: SECTIONS }, () => new Float64Array(bandRanges.length));
  const sectionSignal = new Uint32Array(SECTIONS);
  const sectionPresent = new Uint32Array(SECTIONS);
  const sectionHzSum = new Float64Array(SECTIONS);
  const sectionHzCount = new Uint32Array(SECTIONS);

  const frameTimes = new Float32Array(totalFrames);
  const frameHz = new Float32Array(totalFrames);
  const frameDb = new Float32Array(totalFrames);
  const frameRms = new Float32Array(totalFrames);
  const frameSnr = new Float32Array(totalFrames);
  const frameSignal = new Uint8Array(totalFrames);
  const framePresent = new Uint8Array(totalFrames);

  const peakBuckets = new Map<number, { count: number; maxDb: number; sumDb: number }>();

  let signalFrames = 0;
  let presentFrames = 0;
  let firstPresent: number | null = null;
  let lastPresent: number | null = null;
  let floorSum = 0;
  let dominantHz: number | null = null;
  let dominantDb: number | null = null;

  const peakOptions = {
    sampleRate,
    fftSize: FFT_SIZE,
    minHz: 20,
    maxHz,
    maxPeaks: 3,
  };

  for (let frame = 0; frame < totalFrames; frame++) {
    const start = frame * hop;
    for (let i = 0; i < FFT_SIZE; i++) {
      const index = start + i;
      re[i] = index < samples.length ? samples[index] * window[i] : 0;
      im[i] = 0;
    }
    fft.forward(re, im);
    magnitudeDb(re, im, db.length, windowSum, db);

    let sumSquares = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const index = start + i;
      const value = index < samples.length ? samples[index] : 0;
      sumSquares += value * value;
    }
    const rmsDb = 20 * Math.log10(Math.sqrt(sumSquares / FFT_SIZE) + 1e-12);
    const signal = rmsDb > SIGNAL_DB;
    const floorDb = DSP.noiseFloor(db, floorStart, floorEnd, 8);
    const peaks = signal
      ? DSP.pickPeaks(db, { ...peakOptions, floorDb, maxPeaks: 3 })
      : [];

    let snr = Number.NaN;
    let present = false;
    if (signal && targetValid) {
      const evidence = DSP.targetEvidence(db, {
        sampleRate,
        fftSize: FFT_SIZE,
        targetHz: targetHz as number,
        tolHz,
        floorDb,
      });
      if (evidence.valid) {
        snr = evidence.snrDb ?? Number.NaN;
        present = evidence.tonePresent;
      }
    }

    const time = (start + FFT_SIZE / 2) / sampleRate;
    frameTimes[frame] = time;
    frameRms[frame] = rmsDb;
    frameSignal[frame] = signal ? 1 : 0;
    framePresent[frame] = present ? 1 : 0;
    frameSnr[frame] = snr;
    if (peaks.length) {
      frameHz[frame] = peaks[0].hz;
      frameDb[frame] = peaks[0].db;
    }

    const section = Math.min(SECTIONS - 1, Math.floor((frame / totalFrames) * SECTIONS));
    if (signal) {
      signalFrames++;
      floorSum += floorDb;
      if (peaks.length) {
        sectionHzSum[section] += peaks[0].hz;
        sectionHzCount[section]++;
      }
      if (present) {
        presentFrames++;
        if (firstPresent === null) firstPresent = time;
        lastPresent = time;
      }
      sectionSignal[section]++;
      if (present) sectionPresent[section]++;

      for (let b = 0; b < bandRanges.length; b++) {
        const band = bandRanges[b];
        const power = Math.pow(10, DSP.bandPowerDb(db, band.b0, band.b1) / 10);
        if (Number.isFinite(power)) {
          bandPower[b] += power;
          sectionBandPower[section][b] += power;
        }
      }

      for (const peak of peaks) {
        const key = peak.hz < 1000 ? Math.round(peak.hz) : Math.round(peak.hz / 2) * 2;
        const bucket = peakBuckets.get(key) ?? { count: 0, maxDb: -Infinity, sumDb: 0 };
        bucket.count++;
        bucket.maxDb = Math.max(bucket.maxDb, peak.db);
        bucket.sumDb += peak.db;
        peakBuckets.set(key, bucket);
      }
    }

    if (frame % specStride === 0) {
      const column = Math.floor(frame / specStride);
      if (column < specWidth) {
        for (let row = 0; row < SPEC_ROWS; row++) {
          const value = db[rows[row].bin];
          const t = Math.min(1, Math.max(0, (value + 100) / 70));
          specData[column * SPEC_ROWS + row] = Math.round(t * 255);
        }
      }
    }

    if (frame % 24 === 0) {
      options.onProgress?.(frame + 1, totalFrames);
      await tick();
      if (options.signal?.cancelled) throw new AnalysisCancelled();
    }
  }

  options.onProgress?.(totalFrames, totalFrames);

  const percent = targetValid && signalFrames ? (presentFrames / signalFrames) * 100 : null;
  const verdict = DSP.verdictFor(percent, signalFrames);
  const signalSeconds = (signalFrames * hop) / sampleRate;

  let totalBandPower = 0;
  for (let b = 0; b < bandRanges.length; b++) totalBandPower += bandPower[b];
  const bands: BandShare[] = bandRanges.map((band, index) => ({
    id: band.id,
    label: band.label,
    from: band.from,
    to: band.to,
    percent: totalBandPower > 0 ? (bandPower[index] / totalBandPower) * 100 : 0,
  }));

  const sections: SectionReport[] = Array.from({ length: SECTIONS }, (_, index) => {
    const startS = (index / SECTIONS) * durationS;
    const endS = ((index + 1) / SECTIONS) * durationS;
    const signalCount = sectionSignal[index];
    const sectionPercent = signalCount ? (sectionPresent[index] / signalCount) * 100 : null;
    let topBand: string | null = null;
    let topPower = 0;
    for (let b = 0; b < bandRanges.length; b++) {
      const power = sectionBandPower[index][b];
      if (power > topPower) {
        topPower = power;
        topBand = bandRanges[b].label;
      }
    }
    return {
      startS,
      endS,
      percent: sectionPercent,
      dominantHz: sectionHzCount[index]
        ? sectionHzSum[index] / sectionHzCount[index]
        : null,
      topBand,
    };
  });

  const recurring: RecurringPeak[] = [...peakBuckets.entries()]
    .map(([hz, bucket]) => ({
      hz,
      db: bucket.maxDb,
      count: bucket.count,
      note: DSP.noteFor(hz)?.name ?? null,
    }))
    .sort((a, b) => b.count - a.count || b.db - a.db)
    .slice(0, 8);

  if (recurring.length) {
    dominantHz = recurring[0].hz;
    dominantDb = recurring[0].db;
  }

  const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;

  return {
    version: 1,
    durationS,
    sampleRate,
    config: {
      fftSize: FFT_SIZE,
      hopSamples: hop,
      hopSeconds: hop / sampleRate,
      window: 'hann',
      targetHz,
      tolHz,
    },
    target: {
      valid: targetValid,
      hz: targetHz,
      tol: tolHz,
      signalFrames,
      presentFrames,
      percent,
      verdict,
      firstPresentS: firstPresent,
      lastPresentS: lastPresent,
    },
    summary: {
      frames: totalFrames,
      signalFrames,
      signalSeconds,
      floorDb: signalFrames ? floorSum / signalFrames : -100,
      dominantHz,
      dominantDb,
    },
    bands,
    sections,
    peaks: recurring,
    frames: {
      t: frameTimes,
      hz: frameHz,
      db: frameDb,
      rms: frameRms,
      snr: frameSnr,
      signal: frameSignal,
      present: framePresent,
    },
    spectrogram: {
      width: specWidth,
      height: SPEC_ROWS,
      minHz: 20,
      maxHz,
      data: specData,
    },
    elapsedMs,
  };
}
