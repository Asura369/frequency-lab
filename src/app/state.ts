/** Mutable workbench state for one analysis session. */
import type { Bucket, LogRow, Peak, TargetEvidence } from '../dsp/core';

export interface SpectrogramState {
  tex: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  colPx: number;
  ticks: Uint8Array;
  columns: number;
  rows: LogRow[];
  image: ImageData;
}

export interface AppState {
  seq: number;
  running: boolean;
  paused: boolean;
  analysing: boolean;
  reportOpen: boolean;
  mode: 'mic' | 'tab' | 'file' | 'test' | null;
  ctx: AudioContext | null;
  stream: MediaStream | null;
  mediaEl: HTMLMediaElement | null;
  mediaUrl: string | null;
  sourceNode: AudioNode | null;
  analyserFine: AnalyserNode | null;
  analyserSpec: AnalyserNode | null;
  outGain: GainNode | null;
  osc: OscillatorNode | null;
  fineData: Float32Array<ArrayBuffer> | null;
  specData: Float32Array<ArrayBuffer> | null;
  timeData: Float32Array<ArrayBuffer> | null;
  binHzFine: number;
  binHzSpec: number;
  raf: number;
  lastText: number;
  lastSpectrum: number;
  lastColumn: number;
  lastFloor: number;
  lastBucket: number;
  floorDb: number;
  peaks: Peak[];
  displayHz: number | null;
  topHz: number | null;
  peakHistory: number[];
  signal: boolean;
  onCount: number;
  offCount: number;
  toneNow: boolean;
  lastEvidence: TargetEvidence | null;
  target: number | null;
  tol: number | null;
  targetValid: boolean;
  evidenceRing: Bucket[];
  sessionSignal: number;
  sessionPresent: number;
  bucket: { signalFrames: number; toneFrames: number };
  exportRows: (string | number)[][];
  sessionStart: number;
  fall: SpectrogramState | null;
}

export const state: AppState = {
  seq: 0,
  running: false,
  paused: false,
  analysing: false,
  reportOpen: false,
  mode: null,
  ctx: null,
  stream: null,
  mediaEl: null,
  mediaUrl: null,
  sourceNode: null,
  analyserFine: null,
  analyserSpec: null,
  outGain: null,
  osc: null,
  fineData: null,
  specData: null,
  timeData: null,
  binHzFine: 0,
  binHzSpec: 0,
  raf: 0,
  lastText: 0,
  lastSpectrum: 0,
  lastColumn: 0,
  lastFloor: 0,
  lastBucket: 0,
  floorDb: -100,
  peaks: [],
  displayHz: null,
  topHz: null,
  peakHistory: [],
  signal: false,
  onCount: 0,
  offCount: 0,
  toneNow: false,
  lastEvidence: null,
  target: 440,
  tol: 3,
  targetValid: true,
  evidenceRing: [],
  sessionSignal: 0,
  sessionPresent: 0,
  bucket: { signalFrames: 0, toneFrames: 0 },
  exportRows: [],
  sessionStart: 0,
  fall: null,
};
