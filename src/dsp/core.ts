/**
 * Pure spectral measurement core shared by the app, the landing demo and the
 * tests. No DOM, no timers, no browser globals: every function is deterministic
 * for a given dB spectrum and configuration.
 *
 * Extracted verbatim from the original single-file build; behaviour is frozen
 * by test/dsp.test.ts.
 */


export interface NoteInfo {
  name: string;
  midi: number;
  nearest: number;
  cents: number;
  pitchClass: number;
  octave: number;
}

export interface Peak {
  bin: number;
  hz: number;
  db: number;
  salience: number;
}

export interface TargetEvidence {
  valid: boolean;
  tonePresent: boolean;
  bandDb?: number;
  snrDb?: number;
  peakDb?: number;
  peakHz?: number;
  prominenceDb?: number;
  bins?: [number, number];
}

export interface Bucket {
  signal: boolean;
  present: boolean;
}

export interface LogRow {
  hz: number;
  bin: number;
}

export interface BucketSummary {
  signalBuckets: number;
  presentBuckets: number;
  percent: number | null;
}

export type Verdict = 'no-signal' | 'collecting' | 'consistent' | 'intermittent' | 'not-detected';

export interface PickPeaksOptions {
  sampleRate?: number;
  fftSize?: number;
  minHz?: number;
  maxHz?: number;
  floorDb?: number;
  maxPeaks?: number;
  maxCandidates?: number;
  minSalienceDb?: number;
  minLevelAboveFloorDb?: number;
  minLevelDb?: number;
  sideInner?: number;
  sideOuter?: number;
  minSeparationBins?: number;
}

export interface EvidenceOptions {
  sampleRate?: number;
  fftSize?: number;
  targetHz?: number;
  tolHz?: number;
  floorDb?: number;
  sideOuter?: number;
}

export interface FreqLabDSPApi {
  clamp(value: number, min: number, max: number): number;
  noteFor(hz: number): NoteInfo | null;
  parabolicOffset(left: number, center: number, right: number): number;
  median(values: ArrayLike<number>): number;
  noiseFloor(db: ArrayLike<number>, startBin: number, endBin: number, stride?: number): number;
  maxTargetHz(sampleRate: number): number;
  pickPeaks(db: ArrayLike<number>, options?: PickPeaksOptions): Peak[];
  bandPowerDb(db: ArrayLike<number>, startBin: number, endBin: number): number;
  targetEvidence(db: ArrayLike<number>, options?: EvidenceOptions): TargetEvidence;
  buildLogRows(count: number, minHz: number, maxHz: number, sampleRate: number, fftSize: number, binCount: number): LogRow[];
  finalizeBucket(signalFrames: number, toneFrames: number): Bucket;
  summarizeBuckets(buckets: readonly (Bucket | null | undefined)[]): BucketSummary;
  verdictFor(percent: number | null | undefined, signalBuckets: number): Verdict;
  formatCents(cents: number | null | undefined): string;
}

const DSP = (() => {
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
  const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

  function noteFor(hz: number): NoteInfo | null {
    if (!isNum(hz) || hz <= 0) return null;
    const midi = 69 + 12 * Math.log2(hz / 440);
    const nearest = Math.round(midi);
    const cents = (midi - nearest) * 100;
    const pitchClass = ((nearest % 12) + 12) % 12;
    const octave = Math.floor(nearest / 12) - 1;
    return { name: NOTE_NAMES[pitchClass] + octave, midi, nearest, cents, pitchClass, octave };
  }

  function parabolicOffset(left: number, center: number, right: number): number {
    if (!Number.isFinite(left) || !Number.isFinite(center) || !Number.isFinite(right)) return 0;
    const den = left - 2 * center + right;
    if (Math.abs(den) < 1e-9) return 0;
    return clamp(0.5 * (left - right) / den, -0.5, 0.5);
  }

  function median(values: ArrayLike<number>): number {
    if (!values || values.length === 0) return NaN;
    const sorted = Array.from(values).sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
  }

  function noiseFloor(db: ArrayLike<number>, startBin: number, endBin: number, stride = 8): number {
    const values: number[] = [];
    const step = Math.max(1, stride | 0);
    const lo = Math.max(0, startBin | 0);
    const hi = Math.min(db.length - 1, endBin | 0);
    for (let i = lo; i <= hi; i += step) {
      if (Number.isFinite(db[i])) values.push(db[i]);
    }
    return values.length ? median(values) : -100;
  }

  function insertTop(list: number[], bin: number, db: ArrayLike<number>, max: number): void {
    if (list.length >= max && db[bin] <= db[list[list.length - 1]]) return;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (db[list[mid]] >= db[bin]) lo = mid + 1;
      else hi = mid;
    }
    list.splice(lo, 0, bin);
    if (list.length > max) list.pop();
  }

  function pickPeaks(db: ArrayLike<number>, options: PickPeaksOptions = {}): Peak[] {
    const o = Object.assign({
      sampleRate: 48000,
      fftSize: 32768,
      minHz: 20,
      maxHz: 20000,
      floorDb: NaN,
      maxPeaks: 6,
      maxCandidates: 40,
      minSalienceDb: 6,
      minLevelAboveFloorDb: 6,
      minLevelDb: -100,
      sideInner: 4,
      sideOuter: 32,
      minSeparationBins: 8,
    }, options);

    const binHz = o.sampleRate / o.fftSize;
    const nyquist = o.sampleRate / 2;
    const start = Math.max(1, Math.ceil(o.minHz / binHz));
    const end = Math.min(
      db.length - 2,
      Math.floor(Math.min(o.maxHz, nyquist - binHz) / binHz)
    );
    if (end <= start) return [];

    const floorDb = isNum(o.floorDb) ? o.floorDb : noiseFloor(db, start, end, 8);
    const candidates: number[] = [];
    for (let i = start; i <= end; i++) {
      const value = db[i];
      if (!Number.isFinite(value)) continue;
      if (value < o.minLevelDb) continue;
      if (value < floorDb + o.minLevelAboveFloorDb) continue;
      if (!(value >= db[i - 1] && value > db[i + 1])) continue;
      insertTop(candidates, i, db, o.maxCandidates);
    }

    const peaks: Peak[] = [];
    for (const bin of candidates) {
      const side: number[] = [];
      const from = Math.max(start, bin - o.sideOuter);
      const to = Math.min(end, bin + o.sideOuter);
      for (let j = from; j <= to; j++) {
        if (Math.abs(j - bin) <= o.sideInner) continue;
        if (Number.isFinite(db[j])) side.push(db[j]);
      }
      const sideDb = side.length >= 4 ? median(side) : floorDb;
      const salience = db[bin] - sideDb;
      if (salience < o.minSalienceDb) continue;
      const offset = parabolicOffset(db[bin - 1], db[bin], db[bin + 1]);
      peaks.push({ bin, hz: (bin + offset) * binHz, db: db[bin], salience });
    }

    peaks.sort((a, b) => b.db - a.db);
    const picked: Peak[] = [];
    for (const peak of peaks) {
      let separated = true;
      for (const other of picked) {
        if (Math.abs(other.bin - peak.bin) < o.minSeparationBins) {
          separated = false;
          break;
        }
      }
      if (separated) picked.push(peak);
      if (picked.length >= o.maxPeaks) break;
    }
    return picked;
  }

  function bandPowerDb(db: ArrayLike<number>, startBin: number, endBin: number): number {
    const lo = Math.max(0, startBin | 0);
    const hi = Math.min(db.length - 1, endBin | 0);
    if (hi < lo) return -Infinity;
    let sum = 0;
    let count = 0;
    for (let i = lo; i <= hi; i++) {
      if (!Number.isFinite(db[i])) continue;
      sum += Math.pow(10, db[i] / 10);
      count++;
    }
    return count ? 10 * Math.log10(sum / count) : -Infinity;
  }

  function maxTargetHz(sampleRate) {
    return Math.min(20000, Math.max(0, sampleRate / 2));
  }

  function targetEvidence(db: ArrayLike<number>, options: EvidenceOptions = {}): TargetEvidence {
    const o = Object.assign({
      sampleRate: 48000,
      fftSize: 32768,
      targetHz: 440,
      tolHz: 3,
      floorDb: -100,
      sideOuter: 32,
    }, options);

    const binHz = o.sampleRate / o.fftSize;
    const maxAllowed = maxTargetHz(o.sampleRate);
    if (!isNum(o.targetHz) || o.targetHz < 20 || o.targetHz > maxAllowed) {
      return { valid: false, tonePresent: false };
    }
    const tol = clamp(isNum(o.tolHz) ? o.tolHz : 3, 0.05, 100);
    const minBin = Math.max(1, Math.ceil(20 / binHz));
    const b0 = clamp(Math.round((o.targetHz - tol) / binHz), minBin, db.length - 2);
    const b1 = clamp(Math.round((o.targetHz + tol) / binHz), b0, db.length - 2);
    if (b1 < b0) return { valid: false, tonePresent: false };

    const bandDb = bandPowerDb(db, b0, b1);
    const snrDb = bandDb - o.floorDb;

    let peakBin = b0;
    let peakDb = db[b0];
    for (let i = b0 + 1; i <= b1; i++) {
      if (db[i] > peakDb) {
        peakDb = db[i];
        peakBin = i;
      }
    }

    const side: number[] = [];
    const from = Math.max(1, peakBin - o.sideOuter);
    const to = Math.min(db.length - 2, peakBin + o.sideOuter);
    for (let j = from; j <= to; j++) {
      if (j >= b0 && j <= b1) continue;
      if (Number.isFinite(db[j])) side.push(db[j]);
    }
    const sideDb = side.length >= 4 ? median(side) : o.floorDb;
    const prominenceDb = peakDb - sideDb;
    const offset = parabolicOffset(db[peakBin - 1], db[peakBin], db[peakBin + 1]);

    return {
      valid: true,
      bandDb,
      snrDb,
      peakDb,
      peakHz: (peakBin + offset) * binHz,
      prominenceDb,
      tonePresent: snrDb >= 6 && prominenceDb >= 6,
      bins: [b0, b1],
    };
  }

  function buildLogRows(count: number, minHz: number, maxHz: number, sampleRate: number, fftSize: number, binCount: number): LogRow[] {
    const binHz = sampleRate / fftSize;
    const ratio = maxHz / minHz;
    const rows: LogRow[] = new Array(count);
    for (let i = 0; i < count; i++) {
      const hz = maxHz / Math.pow(ratio, i / (count - 1));
      rows[i] = { hz, bin: clamp(Math.round(hz / binHz), 1, binCount - 2) };
    }
    return rows;
  }

  function finalizeBucket(signalFrames: number, toneFrames: number): Bucket {
    const signal = signalFrames > 0;
    return { signal, present: signal && toneFrames * 2 >= signalFrames };
  }

  function summarizeBuckets(buckets: readonly (Bucket | null | undefined)[]): BucketSummary {
    let signalBuckets = 0;
    let presentBuckets = 0;
    for (const bucket of buckets) {
      if (!bucket || !bucket.signal) continue;
      signalBuckets++;
      if (bucket.present) presentBuckets++;
    }
    return {
      signalBuckets,
      presentBuckets,
      percent: signalBuckets ? (presentBuckets / signalBuckets) * 100 : null,
    };
  }

  function verdictFor(percent: number | null | undefined, signalBuckets: number): Verdict {
    if (percent == null || signalBuckets === 0) return 'no-signal';
    if (signalBuckets < 10) return 'collecting';
    if (percent >= 80) return 'consistent';
    if (percent >= 20) return 'intermittent';
    return 'not-detected';
  }

  function formatCents(cents: number | null | undefined): string {
    if (!isNum(cents)) return '—';
    return `${cents >= 0 ? '+' : ''}${cents.toFixed(1)}`;
  }

  return {
    clamp,
    noteFor,
    parabolicOffset,
    median,
    noiseFloor,
    maxTargetHz,
    pickPeaks,
    bandPowerDb,
    targetEvidence,
    buildLogRows,
    finalizeBucket,
    summarizeBuckets,
    verdictFor,
    formatCents,
  };
})() as FreqLabDSPApi;

export { DSP as FreqLabDSP };
export type FreqLab = typeof DSP;
