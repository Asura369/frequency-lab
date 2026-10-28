/**
 * Whole-file analysis: decode on the main thread, transform in a worker, and
 * render a report in place of the live workbench.
 */

import { FreqLabDSP as DSP } from '../dsp/core';
import { $ } from './dom';
import { CONTRAST_LUT, COLOR_LUT } from './lut';
import { state } from './state';
import type { WholeFileReport } from './offline/analyse';
import AnalysisWorker from '../workers/analyse.worker.ts?worker&inline';

const MAX_BYTES = 200 * 1024 * 1024;
const MAX_SECONDS = 600;

interface Dependencies {
  setStatus(text: string): void;
  stopSession(keepStatus?: boolean): void;
  updateButtons(): void;
}

interface FileMeta {
  name: string;
  size: number;
  durationS: number;
  sampleRate: number;
  channels: number;
}

let deps: Dependencies;
let worker: Worker | null = null;
let rejectJob: ((error: Error) => void) | null = null;
let report: WholeFileReport | null = null;
let meta: FileMeta | null = null;
let audioUrl: string | null = null;
let cancelRequested = false;

export function initOfflineUI(dependencies: Dependencies): void {
  deps = dependencies;

  const input = $<HTMLInputElement>('analyseInput');
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (file) void analyseFile(file);
  });

  $('reportClose').addEventListener('click', () => closeReport());
  $('reportCancel').addEventListener('click', () => {
    cancelRequested = true;
    if (worker) {
      worker.terminate();
      worker = null;
      rejectJob?.(new Error('cancelled'));
      rejectJob = null;
    }
    if (!state.analysing) closeReport();
  });

  $('exportReportJson').addEventListener('click', exportJson);
  $('exportReportCsv').addEventListener('click', exportCsv);
  $('exportReportPng').addEventListener('click', exportPng);
}

function cancelCleanup(): void {
  worker?.terminate();
  worker = null;
  rejectJob = null;
}

function closeReport(): void {
  cancelCleanup();
  if (audioUrl) {
    URL.revokeObjectURL(audioUrl);
    audioUrl = null;
  }
  report = null;
  meta = null;
  cancelRequested = false;
  $('reportView').hidden = true;
  $('reportBody').hidden = true;
  $('reportError').hidden = true;
  $('reportProgress').hidden = false;
  $<HTMLElement>('reportPlayer').replaceChildren();
  const workspace = document.querySelector<HTMLElement>('.workspace');
  const diagnostics = document.querySelector<HTMLElement>('.diagnostics');
  if (workspace) workspace.hidden = false;
  if (diagnostics) diagnostics.hidden = false;
  state.analysing = false;
  state.reportOpen = false;
  deps.updateButtons();
  deps.setStatus('Idle — choose a source.');
}

function showReportShell(): void {
  const workspace = document.querySelector<HTMLElement>('.workspace');
  const diagnostics = document.querySelector<HTMLElement>('.diagnostics');
  if (workspace) workspace.hidden = true;
  if (diagnostics) diagnostics.hidden = true;
  $('reportView').hidden = false;
  $('reportBody').hidden = true;
  $('reportError').hidden = true;
  $('reportProgress').hidden = false;
  $<HTMLProgressElement>('reportProgressBar').value = 0;
  state.reportOpen = true;
  state.analysing = true;
  deps.updateButtons();
}

async function analyseFile(file: File): Promise<void> {
  if (state.analysing) return;
  if (state.running) deps.stopSession(true);
  closeReport();
  showReportShell();
  cancelRequested = false;

  const name = file.name || 'audio file';
  $('reportName').textContent = name;
  $('reportMeta').textContent = `${formatBytes(file.size)} · reading…`;
  setProgress('Reading the file…', 0);
  deps.setStatus(`Analysing ${name}…`);

  try {
    if (file.size > MAX_BYTES) {
      throw new Error(
        `This file is ${formatBytes(file.size)}. Whole-file analysis is limited to ${formatBytes(MAX_BYTES)}.`
      );
    }

    audioUrl = URL.createObjectURL(file);
    const probed = await probeDuration(audioUrl);
    if (Number.isFinite(probed) && probed > MAX_SECONDS) {
      throw new Error(
        `This file is ${formatDuration(probed)} long. Whole-file analysis is limited to ${formatDuration(MAX_SECONDS)}; use the live player for longer files.`
      );
    }
    if (cancelRequested) throw new Error('cancelled');

    setProgress('Decoding audio…', 0.02);
    const buffer = await decodeFile(file);
    if (cancelRequested) throw new Error('cancelled');
    if (buffer.duration > MAX_SECONDS) {
      throw new Error(
        `This file is ${formatDuration(buffer.duration)} long. Whole-file analysis is limited to ${formatDuration(MAX_SECONDS)}.`
      );
    }

    $('reportMeta').textContent = `${formatBytes(file.size)} · ${formatDuration(buffer.duration)} · ${(buffer.sampleRate / 1000).toFixed(1)} kHz · ${buffer.numberOfChannels} ch`;
    setProgress('Mixing to mono…', 0.04);

    const samples = downmix(buffer);
    if (cancelRequested) throw new Error('cancelled');

    const result = await runAnalysis(samples, buffer.sampleRate);
    if (cancelRequested) throw new Error('cancelled');

    report = result;
    meta = {
      name,
      size: file.size,
      durationS: buffer.duration,
      sampleRate: buffer.sampleRate,
      channels: buffer.numberOfChannels,
    };

    $('reportProgress').hidden = true;
    $('reportBody').hidden = false;
    renderReport(result, meta);
    state.analysing = false;
    deps.updateButtons();
    deps.setStatus(`Analysed ${name} in ${(result.elapsedMs / 1000).toFixed(1)} s.`);
  } catch (error) {
    if (cancelRequested) {
      closeReport();
      return;
    }
    showError(error instanceof Error ? error.message : String(error));
  }
}

async function decodeFile(file: File): Promise<AudioBuffer> {
  const array = await file.arrayBuffer();
  const context = new AudioContext({ latencyHint: 'playback' });
  try {
    return await context.decodeAudioData(array);
  } finally {
    try {
      await context.close();
    } catch {
      /* already closed */
    }
  }
}

function downmix(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const output = new Float32Array(buffer.length);
  for (let channel = 0; channel < channels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) output[i] += data[i];
  }
  if (channels > 1) {
    for (let i = 0; i < output.length; i++) output[i] /= channels;
  }
  return output;
}

function probeDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    const media = document.createElement('audio');
    let settled = false;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      media.removeAttribute('src');
      media.load();
      resolve(value);
    };
    media.preload = 'metadata';
    media.onloadedmetadata = () => finish(media.duration);
    media.onerror = () => finish(Number.NaN);
    media.src = url;
    window.setTimeout(() => finish(Number.NaN), 8000);
  });
}

function runAnalysis(samples: Float32Array, sampleRate: number): Promise<WholeFileReport> {
  return new Promise((resolve, reject) => {
    const analysisWorker = new AnalysisWorker();
    worker = analysisWorker;
    rejectJob = reject;

    analysisWorker.onmessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'progress') {
        const ratio = message.total ? message.done / message.total : 0;
        setProgress(`Analysing ${Math.round(ratio * 100)}% of the file…`, 0.05 + ratio * 0.95);
        return;
      }
      if (message.type === 'done') {
        worker = null;
        rejectJob = null;
        analysisWorker.terminate();
        resolve(message.report as WholeFileReport);
        return;
      }
      if (message.type === 'cancelled') {
        worker = null;
        rejectJob = null;
        analysisWorker.terminate();
        reject(new Error('cancelled'));
        return;
      }
      if (message.type === 'error') {
        worker = null;
        rejectJob = null;
        analysisWorker.terminate();
        reject(new Error(message.message || 'Analysis failed.'));
      }
    };

    analysisWorker.onerror = (event) => {
      worker = null;
      rejectJob = null;
      analysisWorker.terminate();
      reject(new Error(event.message || 'The analysis worker failed.'));
    };

    analysisWorker.postMessage(
      {
        type: 'analyse',
        samples,
        sampleRate,
        targetHz: state.targetValid ? state.target : null,
        tolHz: state.tol,
        maxFrames: 4000,
      },
      [samples.buffer]
    );
  });
}

function setProgress(text: string, ratio: number): void {
  $('reportProgressText').textContent = text;
  $<HTMLProgressElement>('reportProgressBar').value = Math.max(0, Math.min(1, ratio));
}

function showError(message: string): void {
  state.analysing = false;
  deps.updateButtons();
  $('reportProgress').hidden = true;
  $('reportBody').hidden = true;
  const error = $('reportError');
  error.textContent = message;
  error.hidden = false;
  deps.setStatus('Whole-file analysis failed.');
}

function renderReport(result: WholeFileReport, file: FileMeta): void {
  const target = result.target;
  const percent = target.valid && target.percent != null ? target.percent : null;

  $<HTMLProgressElement>('reportProgressBar').value = 1;
  $('reportPercent').textContent = percent == null ? '—' : Math.round(percent).toString();
  $('reportWindow').textContent = `${formatDuration(result.durationS)} · ${result.spectrogram.width} columns`;

  const verdict = verdictLabel(target);
  const chip = $('reportVerdict');
  chip.textContent = verdict.text;
  chip.className = `verdict ${verdict.className}`.trim();

  if (!target.valid) {
    $('reportTargetText').textContent =
      'The chosen target is outside the measurable range for this file; the spectral report is still shown.';
  } else if (percent == null) {
    $('reportTargetText').textContent =
      'No signal above the gate was found, so no target percentage can be reported.';
  } else {
    const presentSeconds = (target.presentFrames * result.config.hopSeconds);
    $('reportTargetText').textContent = `A tone-like peak sits in ${target.hz?.toFixed(1)} Hz ±${target.tol} Hz for ${percent.toFixed(0)}% of signal time (${formatDuration(presentSeconds)} of ${formatDuration(result.summary.signalSeconds)}).`;
  }

  const dominant = result.summary.dominantHz;
  const dominantNote = dominant ? DSP.noteFor(dominant) : null;
  const stats = $('reportStats');
  stats.replaceChildren(
    stat('Signal', formatDuration(result.summary.signalSeconds)),
    stat('Duration', formatDuration(result.durationS)),
    stat(
      'Most frequent peak',
      dominant
        ? `${dominant.toFixed(1)} Hz${dominantNote ? ` · ${dominantNote.name}` : ''}`
        : '—'
    ),
    stat('Floor', `${result.summary.floorDb.toFixed(0)} dB`),
    stat('Frames', `${result.summary.frames} × ${(result.config.fftSize / 1000).toFixed(0)}k FFT`),
    stat('Analysed in', `${(result.elapsedMs / 1000).toFixed(1)} s`)
  );

  renderBands(result);
  drawSpectrogram(result);
  drawTimeline(result);
  renderSections(result);
  renderPeaks(result);
  renderPlayer(file, result);
}

function stat(label: string, value: string): HTMLElement {
  const wrap = document.createElement('div');
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = value;
  wrap.append(dt, dd);
  return wrap;
}

function verdictLabel(target: WholeFileReport['target']): { text: string; className: string } {
  if (!target.valid) return { text: 'no target', className: 'warn' };
  if (target.verdict === 'consistent') return { text: 'tone present', className: 'pass' };
  if (target.verdict === 'intermittent') return { text: 'intermittent', className: 'warn' };
  if (target.verdict === 'collecting') return { text: 'short', className: 'warn' };
  if (target.verdict === 'no-signal') return { text: 'no signal', className: 'fail' };
  return { text: 'not detected', className: 'fail' };
}

function renderBands(result: WholeFileReport): void {
  const container = $('reportBands');
  container.replaceChildren();
  for (const band of result.bands) {
    const row = document.createElement('div');
    row.className = 'band-row';
    const label = document.createElement('span');
    label.textContent = `${band.label} ${band.from}–${band.to >= 1000 ? `${band.to / 1000}k` : band.to}`;
    const bar = document.createElement('span');
    bar.className = 'band-bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.min(100, band.percent)}%`;
    bar.appendChild(fill);
    const value = document.createElement('span');
    value.className = 'band-value';
    value.textContent = `${band.percent.toFixed(0)}%`;
    row.append(label, bar, value);
    container.appendChild(row);
  }
}

function fitCanvas(canvas: HTMLCanvasElement): {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
} {
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const w = Math.max(1, canvas.clientWidth);
  const h = Math.max(1, canvas.clientHeight);
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function drawSpectrogram(result: WholeFileReport): void {
  const canvas = $<HTMLCanvasElement>('reportSpectrogram');
  const { ctx, w, h } = fitCanvas(canvas);
  const { data, width, height, maxHz } = result.spectrogram;
  const lut = document.body.classList.contains('contrast') ? CONTRAST_LUT : COLOR_LUT;

  const off = document.createElement('canvas');
  off.width = width;
  off.height = height;
  const offCtx = off.getContext('2d');
  if (!offCtx) return;
  const image = offCtx.createImageData(width, height);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const color = lut[data[x * height + y]];
      const offset = (y * width + x) * 4;
      image.data[offset] = color[0];
      image.data[offset + 1] = color[1];
      image.data[offset + 2] = color[2];
      image.data[offset + 3] = 255;
    }
  }
  offCtx.putImageData(image, 0, 0);
  ctx.drawImage(off, 0, 0, w, h);

  const logMin = Math.log10(20);
  const logSpan = Math.log10(maxHz) - logMin;
  const yForHz = (hz: number) => (1 - (Math.log10(hz) - logMin) / logSpan) * h;

  ctx.save();
  ctx.strokeStyle = 'rgba(110, 126, 145, 0.18)';
  ctx.fillStyle = '#78838f';
  ctx.font = '9px ui-monospace, Menlo, monospace';
  ctx.lineWidth = 1;
  for (const hz of [20, 100, 1000, 10000, 20000]) {
    if (hz > maxHz) continue;
    const y = yForHz(hz);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillText(`${hz >= 1000 ? `${hz / 1000}k` : hz}`, 4, Math.min(h - 3, Math.max(10, y - 3)));
  }
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const x = (i / 4) * (w - 1);
    ctx.fillText(formatDuration((i / 4) * result.durationS), x, h - 4);
  }
  if (result.target.valid && result.target.hz != null) {
    const y = yForHz(result.target.hz);
    ctx.strokeStyle = 'rgba(255, 180, 84, 0.85)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffb454';
    ctx.textAlign = 'right';
    ctx.fillText(`target ${result.target.hz} Hz`, w - 6, Math.max(10, y - 4));
  }
  ctx.restore();
}

function drawTimeline(result: WholeFileReport): void {
  const canvas = $<HTMLCanvasElement>('reportTimeline');
  const { ctx, w, h } = fitCanvas(canvas);
  const frames = result.frames;
  const count = frames.t.length;
  ctx.fillStyle = '#06090c';
  ctx.fillRect(0, 0, w, h);

  const strip = 10;
  const plotTop = strip + 6;
  const plotHeight = h - plotTop - 14;

  for (let x = 0; x < w; x++) {
    const index = Math.min(count - 1, Math.floor((x / w) * count));
    ctx.fillStyle = frames.present[index]
      ? '#58e2a2'
      : frames.signal[index]
        ? '#22303d'
        : '#0b1117';
    ctx.fillRect(x, 0, 1, strip);
  }

  ctx.beginPath();
  ctx.moveTo(0, plotTop + plotHeight);
  for (let x = 0; x < w; x++) {
    const index = Math.min(count - 1, Math.floor((x / w) * count));
    const db = frames.signal[index] ? frames.rms[index] : -80;
    const t = Math.min(1, Math.max(0, (db + 80) / 80));
    const y = plotTop + (1 - t) * plotHeight;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, plotTop + plotHeight);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(0, plotTop, 0, plotTop + plotHeight);
  gradient.addColorStop(0, 'rgba(91, 201, 255, 0.26)');
  gradient.addColorStop(1, 'rgba(91, 201, 255, 0.02)');
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.strokeStyle = 'rgba(91, 201, 255, 0.9)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  ctx.fillStyle = '#78838f';
  ctx.font = '9px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText('-80 to 0 dBFS', w / 2, h - 3);
  ctx.textAlign = 'right';
  ctx.fillText(formatDuration(result.durationS), w - 4, h - 3);
}

function renderSections(result: WholeFileReport): void {
  const body = $('reportSections');
  body.replaceChildren();
  for (const section of result.sections) {
    const row = document.createElement('tr');
    row.append(
      cell(`${formatClock(section.startS)}–${formatClock(section.endS)}`, true),
      cell(section.percent == null ? '—' : `${section.percent.toFixed(0)}%`),
      cell(section.dominantHz == null ? '—' : `${section.dominantHz.toFixed(0)} Hz`),
      cell(section.topBand || '—')
    );
    body.appendChild(row);
  }
}

function renderPeaks(result: WholeFileReport): void {
  const body = $('reportPeaks');
  body.replaceChildren();
  if (!result.peaks.length) {
    const row = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'empty';
    td.textContent = 'No recurring peaks.';
    row.appendChild(td);
    body.appendChild(row);
    return;
  }
  for (const peak of result.peaks) {
    const row = document.createElement('tr');
    row.append(
      cell(peak.hz.toFixed(1), true),
      cell(peak.note || '—'),
      cell(`${peak.db.toFixed(0)}`),
      cell(`${peak.count}`)
    );
    body.appendChild(row);
  }
}

function cell(text: string, first = false): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  if (first) td.className = 'report-first';
  return td;
}

function renderPlayer(file: FileMeta, result: WholeFileReport): void {
  const host = $('reportPlayer');
  host.replaceChildren();
  if (!audioUrl) return;
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = 'metadata';
  audio.src = audioUrl;
  audio.className = 'report-audio';
  host.appendChild(audio);
  host.title = `${file.name} · ${formatDuration(result.durationS)}`;
}

function exportJson(): void {
  if (!report || !meta) return;
  const payload = {
    schema: 'freqlab/report@1',
    createdAt: new Date().toISOString(),
    file: meta,
    config: report.config,
    target: report.target,
    summary: report.summary,
    bands: report.bands,
    sections: report.sections,
    peaks: report.peaks,
    timeline: {
      t: Array.from(report.frames.t),
      hz: Array.from(report.frames.hz),
      rms: Array.from(report.frames.rms),
      present: Array.from(report.frames.present),
    },
  };
  const json = JSON.stringify(
    payload,
    (_key, value) => (typeof value === 'number' && !Number.isFinite(value) ? null : value),
    2
  );
  download(new Blob([json], { type: 'application/json' }), `frequency-lab-report-${stamp()}.json`);
}

function exportCsv(): void {
  if (!report) return;
  const lines = ['t_s,dominant_hz,dominant_db,rms_db,target_snr_db,signal,tone_present'];
  const frames = report.frames;
  for (let i = 0; i < frames.t.length; i++) {
    lines.push(
      [
        frames.t[i].toFixed(3),
        frames.hz[i] ? frames.hz[i].toFixed(2) : '',
        frames.db[i] ? frames.db[i].toFixed(1) : '',
        frames.rms[i].toFixed(1),
        Number.isFinite(frames.snr[i]) ? frames.snr[i].toFixed(1) : '',
        frames.signal[i],
        frames.present[i],
      ].join(',')
    );
  }
  download(
    new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }),
    `frequency-lab-report-${stamp()}.csv`
  );
}

function exportPng(): void {
  if (!report || !meta) return;
  const spectrogram = $<HTMLCanvasElement>('reportSpectrogram');
  const timeline = $<HTMLCanvasElement>('reportTimeline');
  const pad = 24;
  const width = Math.max(spectrogram.width, timeline.width, 900) + pad * 2;
  const height = 84 + spectrogram.height + 16 + timeline.height + pad * 2;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#080a0e';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#e8edf3';
  ctx.font = '600 22px "Iowan Old Style", Georgia, serif';
  ctx.fillText('Frequency Lab — whole-file report', pad, 38);
  ctx.fillStyle = '#8b96a5';
  ctx.font = '12px ui-monospace, Menlo, monospace';
  const targetText = report.target.valid
    ? `target ${report.target.hz} Hz ±${report.target.tol} Hz · ${report.target.percent?.toFixed(0)}% of signal time`
    : 'no valid target';
  ctx.fillText(
    `${meta.name} · ${formatDuration(meta.durationS)} · ${targetText}`,
    pad,
    60
  );
  ctx.drawImage(spectrogram, pad, 84);
  ctx.drawImage(timeline, pad, 84 + spectrogram.height + 16);
  out.toBlob((blob) => {
    if (blob) download(blob, `frequency-lab-report-${stamp()}.png`);
  }, 'image/png');
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes ? `${minutes}:${String(rest).padStart(2, '0')}` : `${rest}s`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
