import { FreqLabDSP as DSP } from '../dsp/core';
import { CFG, FREQ_GRID, LOG_MIN, LOG_SPAN } from './constants';
import { els } from './dom';
import { state } from './state';
import { parseUrlState, syncUrl, clearDemoParam, setupLink } from './url-state';
import { loadPrefs, savePrefs, type Palette } from './prefs';
import { copyText, summaryText } from './share';
import { APP_PRESETS } from '../site/presets';
import '../site/register-sw';

function buildColorLut() {
  const stops: Array<[number, [number, number, number]]> = [
    [0.00, [7, 10, 15]],
    [0.18, [43, 33, 120]],
    [0.40, [42, 157, 143]],
    [0.64, [184, 222, 41]],
    [0.84, [255, 196, 80]],
    [1.00, [255, 243, 176]],
  ];
  const lut: Array<[number, number, number]> = new Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let s = 0; s < stops.length - 1; s++) {
      if (t >= stops[s][0] && t <= stops[s + 1][0]) {
        a = stops[s];
        b = stops[s + 1];
        break;
      }
    }
    const f = (t - a[0]) / (b[0] - a[0] || 1);
    lut[i] = [
      Math.round(a[1][0] + (b[1][0] - a[1][0]) * f),
      Math.round(a[1][1] + (b[1][1] - a[1][1]) * f),
      Math.round(a[1][2] + (b[1][2] - a[1][2]) * f),
    ];
  }
  return lut;
}

function buildContrastLut() {
  const stops: Array<[number, [number, number, number]]> = [
    [0.00, [0, 0, 0]],
    [0.28, [16, 36, 110]],
    [0.52, [0, 150, 160]],
    [0.76, [220, 214, 40]],
    [1.00, [255, 255, 255]],
  ];
  const lut: Array<[number, number, number]> = new Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let sIndex = 0; sIndex < stops.length - 1; sIndex++) {
      if (t >= stops[sIndex][0] && t <= stops[sIndex + 1][0]) {
        a = stops[sIndex];
        b = stops[sIndex + 1];
        break;
      }
    }
    const f = (t - a[0]) / (b[0] - a[0] || 1);
    lut[i] = [
      Math.round(a[1][0] + (b[1][0] - a[1][0]) * f),
      Math.round(a[1][1] + (b[1][1] - a[1][1]) * f),
      Math.round(a[1][2] + (b[1][2] - a[1][2]) * f),
    ];
  }
  return lut;
}
const COLOR_LUT = buildColorLut();
const CONTRAST_LUT = buildContrastLut();
let activeLut = COLOR_LUT;
let currentPalette: Palette = 'studio';

let resizeTimer = 0;

const clamp = DSP.clamp;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); }
    );
  });
}

function setStatus(text) {
  els.status.textContent = text;
}

function setSignal(on) {
  state.signal = on;
  els.signalDot.classList.toggle('on', on);
}

function updateButtons() {
  const running = state.running;
  els.stopBtn.disabled = !running;
  els.micBtn.disabled = running;
  els.tabBtn.disabled = running;
  els.fileBtn.classList.toggle('is-disabled', running);
  els.fileBtn.setAttribute('aria-disabled', String(running));
  els.pauseBtn.disabled = !running;
  els.toneBtn.textContent = state.mode === 'test' && running ? 'Stop tone' : 'Start tone';
  els.pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
  els.pauseBtn.title = state.paused
    ? 'Resume the spectrogram waterfall'
    : 'Pause the spectrogram waterfall';
  els.pauseBtn.setAttribute(
    'aria-label',
    state.paused ? 'Resume the spectrogram waterfall' : 'Pause the spectrogram waterfall'
  );
  els.exportCsv.disabled = state.exportRows.length === 0;
  els.exportPng.disabled = !running;
  els.copyResult.disabled = !running;
}

function parseTarget() {
  const hz = Number.parseFloat(els.targetInput.value);
  const tol = Number.parseFloat(els.tolInput.value);
  const maxHz = state.ctx
    ? DSP.maxTargetHz(state.ctx.sampleRate)
    : CFG.MAX_HZ;
  els.targetInput.max = String(Math.floor(maxHz));
  const hzOk = Number.isFinite(hz) && hz >= CFG.MIN_HZ && hz <= maxHz;
  const tolOk = Number.isFinite(tol) && tol >= CFG.TOL_MIN && tol <= CFG.TOL_MAX;
  return { hz: hzOk ? hz : null, tol: tolOk ? tol : null, valid: hzOk && tolOk };
}

function resetEvidence() {
  state.evidenceRing = [];
  state.sessionSignal = 0;
  state.sessionPresent = 0;
  state.bucket = { signalFrames: 0, toneFrames: 0 };
  state.lastEvidence = null;
  state.toneNow = false;
}

function clearExport() {
  state.exportRows = [];
  updateButtons();
}

function resetReadout() {
  state.peaks = [];
  state.displayHz = null;
  state.topHz = null;
  state.peakHistory = [];
  state.lastEvidence = null;
  state.toneNow = false;
  state.signal = false;
  state.onCount = 0;
  state.offCount = 0;
  els.freq.textContent = '—';
  els.freq.classList.add('no-signal');
  els.noteLine.textContent = state.running ? 'No signal' : 'Idle';
  els.snr.textContent = '—';
  els.pct10.textContent = '—';
  els.pctAll.textContent = '—';
  els.snrBar.style.width = '0%';
  els.snrBar.style.background = 'var(--trace)';
  els.peakRows.replaceChildren();
  const tr = document.createElement('tr');
  const td = document.createElement('td');
  td.className = 'empty';
  td.colSpan = 5;
  td.textContent = state.running ? 'No peaks above the floor.' : 'No analysis yet.';
  tr.appendChild(td);
  els.peakRows.appendChild(tr);
  setSignal(false);
}

function commitTarget(reset = true) {
  const parsed = parseTarget();
  state.target = parsed.hz;
  state.tol = parsed.tol;
  state.targetValid = parsed.valid;
  els.targetInput.setAttribute('aria-invalid', String(parsed.hz == null));
  els.tolInput.setAttribute('aria-invalid', String(parsed.tol == null));
  for (const button of els.presets.querySelectorAll('button')) {
    button.classList.toggle(
      'active',
      state.targetValid && Number(button.dataset.hz) === state.target
    );
  }
  if (reset) resetEvidence();
  updateReadouts();
  if (!state.running) drawIdle();
  persistSoon();
}

function formatPercent(value) {
  return value == null || !Number.isFinite(value) ? '—' : `${Math.round(value)}%`;
}

function formatSnr(db) {
  if (!Number.isFinite(db)) return '—';
  return db >= 60 ? '>60 dB' : `${db.toFixed(1)} dB`;
}

function setVerdict(text, className) {
  els.verdict.textContent = text;
  els.verdict.className = `verdict ${className || ''}`.trim();
}

function updateReadouts() {
  const running = state.running;

  if (state.displayHz) {
    els.freq.textContent = state.displayHz.toFixed(2);
    els.freq.classList.remove('no-signal');
    const note = DSP.noteFor(state.displayHz);
    els.noteLine.textContent = note
      ? `${note.name} · ${DSP.formatCents(note.cents)} cents · dominant peak`
      : 'Dominant peak';
  } else {
    els.freq.textContent = '—';
    els.freq.classList.add('no-signal');
    els.noteLine.textContent = running ? 'No signal' : 'Idle';
  }

  const evidence = state.lastEvidence;
  els.snr.textContent = evidence ? formatSnr(evidence.snrDb) : '—';
  const snrWidth = evidence ? clamp((evidence.snrDb / 60) * 100, 0, 100) : 0;
  els.snrBar.style.width = `${snrWidth}%`;
  els.snrBar.style.background = state.toneNow ? 'var(--green)' : 'var(--trace)';

  const windowSummary = DSP.summarizeBuckets(state.evidenceRing);
  const sessionPercent = state.sessionSignal
    ? (state.sessionPresent / state.sessionSignal) * 100
    : null;
  els.pct10.textContent = formatPercent(windowSummary.percent);
  els.pctAll.textContent = formatPercent(sessionPercent);

  if (!state.targetValid) {
    setVerdict('set target', 'warn');
    const maxTarget = state.ctx
      ? DSP.maxTargetHz(state.ctx.sampleRate)
      : CFG.MAX_HZ;
    els.verdictText.textContent = `Enter a target between 20 Hz and ${Math.floor(maxTarget)} Hz with a tolerance from 0.1 to 50 Hz.`;
    return;
  }
  if (!running) {
    setVerdict('idle', '');
    els.verdictText.textContent = 'Start a source, then check whether its energy actually sits at the target frequency.';
    return;
  }
  if (!state.signal) {
    setVerdict('no signal', '');
    els.verdictText.textContent = 'Waiting for audio above the signal gate. Raise the level or press play.';
    return;
  }

  const verdict = DSP.verdictFor(windowSummary.percent, windowSummary.signalBuckets);
  const targetLabel = `${state.target.toFixed(1)} Hz ±${state.tol} Hz`;
  if (verdict === 'collecting') {
    setVerdict('collecting', '');
    els.verdictText.textContent = `Collecting evidence for ${targetLabel} — about a second of signal is needed.`;
  } else if (verdict === 'consistent') {
    setVerdict('consistent', 'pass');
    els.verdictText.textContent = `${targetLabel} is present in ${formatPercent(windowSummary.percent)} of signal time in the last 10 seconds.`;
  } else if (verdict === 'intermittent') {
    setVerdict('intermittent', 'warn');
    els.verdictText.textContent = `${targetLabel} appears intermittently: ${formatPercent(windowSummary.percent)} of signal time in the last 10 seconds.`;
  } else {
    setVerdict('not detected', 'fail');
    const snrText = evidence ? ` Band energy is ${formatSnr(evidence.snrDb)} over the floor.` : '';
    els.verdictText.textContent = `${targetLabel} is not present in the last 10 seconds.${snrText}`;
  }
}

function renderPeaks() {
  els.peakRows.replaceChildren();
  if (!state.peaks.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.className = 'empty';
    td.colSpan = 5;
    td.textContent = state.running ? 'No peaks above the floor.' : 'No analysis yet.';
    tr.appendChild(td);
    els.peakRows.appendChild(tr);
    return;
  }
  state.peaks.forEach((peak, index) => {
    const note = DSP.noteFor(peak.hz);
    const tr = document.createElement('tr');
    const values = [
      String(index + 1),
      peak.hz.toFixed(1),
      note ? note.name : '—',
      peak.db.toFixed(1),
      peak.salience.toFixed(1),
    ];
    values.forEach((value, column) => {
      const td = document.createElement('td');
      td.textContent = value;
      if (column === 1) td.className = 'hz-cell';
      tr.appendChild(td);
    });
    els.peakRows.appendChild(tr);
  });
}

function updateText() {
  updateReadouts();
  renderPeaks();
  updateButtons();
}

function readRmsDb(data) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 2) {
    const value = data[i];
    sum += value * value;
    count++;
  }
  if (!count) return -Infinity;
  const rms = Math.sqrt(sum / count);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

function updateSignalFromRms(rmsDb) {
  if (rmsDb >= CFG.SIGNAL_ON_DB) {
    state.onCount++;
    state.offCount = 0;
  } else {
    state.onCount = 0;
    state.offCount = rmsDb < CFG.SIGNAL_OFF_DB ? state.offCount + 1 : 0;
  }
  if (!state.signal && state.onCount >= CFG.SIGNAL_ON_FRAMES) {
    state.signal = true;
    setSignal(true);
  }
  if (state.signal && state.offCount >= CFG.SIGNAL_OFF_FRAMES) {
    state.signal = false;
    setSignal(false);
    state.displayHz = null;
    state.topHz = null;
    state.peakHistory = [];
    state.peaks = [];
    state.lastEvidence = null;
    state.toneNow = false;
  }
}

function flushBucket(now) {
  const bucket = DSP.finalizeBucket(
    state.bucket.signalFrames,
    state.bucket.toneFrames
  );
  state.evidenceRing.push(bucket);
  if (state.evidenceRing.length > CFG.EVIDENCE_BUCKETS) state.evidenceRing.shift();
  if (bucket.signal) {
    state.sessionSignal++;
    if (bucket.present) state.sessionPresent++;
  }
  state.bucket.signalFrames = 0;
  state.bucket.toneFrames = 0;
  pushExportRow(now);
}

function tick(now) {
  if (!state.running) return;
  state.raf = requestAnimationFrame(tick);

  const fine = state.analyserFine;
  if (!fine) return;
  fine.getFloatFrequencyData(state.fineData);
  fine.getFloatTimeDomainData(state.timeData);

  updateSignalFromRms(readRmsDb(state.timeData));

  if (now - state.lastFloor > 120) {
    state.lastFloor = now;
    const startBin = Math.max(1, Math.ceil(CFG.MIN_HZ / state.binHzFine));
    const endBin = Math.min(
      state.fineData.length - 2,
      Math.floor(
        Math.min(CFG.MAX_HZ, state.ctx.sampleRate / 2 - state.binHzFine) / state.binHzFine
      )
    );
    state.floorDb = DSP.noiseFloor(state.fineData, startBin, endBin, 8);
  }

  let peaks = [];
  if (state.signal) {
    peaks = DSP.pickPeaks(state.fineData, {
      sampleRate: state.ctx.sampleRate,
      fftSize: CFG.FFT_FINE,
      floorDb: state.floorDb,
      minHz: CFG.MIN_HZ,
      maxHz: CFG.MAX_HZ,
      maxPeaks: 6,
    });
  }
  state.peaks = peaks;

  if (state.signal && peaks.length) {
    state.peakHistory.push(peaks[0].hz);
    if (state.peakHistory.length > CFG.SMOOTH_FRAMES) state.peakHistory.shift();
    state.displayHz = DSP.median(state.peakHistory);
    state.topHz = peaks[0].hz;
  } else {
    state.peakHistory = [];
    state.displayHz = null;
    state.topHz = null;
  }

  if (state.signal && state.targetValid) {
    const evidence = DSP.targetEvidence(state.fineData, {
      sampleRate: state.ctx.sampleRate,
      fftSize: CFG.FFT_FINE,
      targetHz: state.target,
      tolHz: state.tol,
      floorDb: state.floorDb,
    });
    state.lastEvidence = evidence.valid ? evidence : null;
    state.toneNow = !!(evidence.valid && evidence.tonePresent);
  } else {
    state.lastEvidence = null;
    state.toneNow = false;
  }

  if (state.signal) state.bucket.signalFrames++;
  if (state.signal && state.toneNow) state.bucket.toneFrames++;

  if (now - state.lastBucket >= CFG.EVIDENCE_MS) {
    state.lastBucket = now;
    flushBucket(now);
  }

  if (!state.paused) {
    if (!state.lastColumn) state.lastColumn = now;
    let guard = 0;
    while (now - state.lastColumn >= CFG.SPEC_COL_MS && guard < 4) {
      writeSpectrogramColumn();
      state.lastColumn += CFG.SPEC_COL_MS;
      guard++;
    }
    if (guard === 4 && now - state.lastColumn >= CFG.SPEC_COL_MS) {
      state.lastColumn = now;
    }
  }

  if (now - state.lastSpectrum >= 33) {
    state.lastSpectrum = now;
    drawSpectrum();
    drawSpectrogram();
  }

  if (now - state.lastText >= 100) {
    state.lastText = now;
    updateText();
  }
}

function fitCanvas(canvas) {
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.floor(canvas.clientWidth || canvas.parentElement?.clientWidth || 640));
  const h = Math.max(1, Math.floor(canvas.clientHeight || 150));
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h, dpr };
}

function xForHz(hz, width) {
  return ((Math.log10(hz) - LOG_MIN) / LOG_SPAN) * width;
}

function yForHz(hz, height) {
  return (1 - (Math.log10(hz) - LOG_MIN) / LOG_SPAN) * height;
}

function yForDb(db, height) {
  const t = (db - CFG.DB_VIEW_MIN) / (CFG.DB_VIEW_MAX - CFG.DB_VIEW_MIN);
  return (1 - clamp(t, 0, 1)) * height;
}

function formatFreqLabel(hz) {
  if (hz >= 1000) return `${hz / 1000}k`;
  return `${hz}`;
}

function overlayText(ctx, width, height, text) {
  ctx.save();
  ctx.fillStyle = 'rgba(232, 237, 243, 0.42)';
  ctx.font = '12px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2);
  ctx.restore();
}

function drawSpectrum() {
  const { ctx, w, h } = fitCanvas(els.spectrum);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#06090c';
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.strokeStyle = 'rgba(110, 126, 145, 0.16)';
  ctx.lineWidth = 1;
  ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
  for (const freq of FREQ_GRID) {
    const x = Math.round(xForHz(freq, w)) + 0.5;
    if (x < 0 || x > w) continue;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (const db of [-20, -40, -60, -80, -100]) {
    const y = Math.round(yForDb(db, h)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();

  if (state.targetValid) {
    const x1 = xForHz(Math.max(CFG.MIN_HZ, state.target - state.tol), w);
    const x2 = xForHz(Math.min(CFG.MAX_HZ, state.target + state.tol), w);
    const x = xForHz(state.target, w);
    ctx.fillStyle = 'rgba(255, 180, 84, 0.09)';
    ctx.fillRect(x1, 0, Math.max(1, x2 - x1), h);
    ctx.strokeStyle = 'rgba(255, 180, 84, 0.85)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffb454';
    ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
    const label = `${state.target.toFixed(1)} ±${state.tol}`;
    const textWidth = ctx.measureText(label).width;
    const labelX = clamp(x + 7, 4, w - textWidth - 8);
    const labelY = h - 22;
    ctx.fillStyle = 'rgba(6, 9, 12, 0.82)';
    ctx.fillRect(labelX - 4, labelY - 7, textWidth + 8, 14);
    ctx.fillStyle = '#ffb454';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, labelX, labelY);
  }

  if (state.running && state.fineData && state.binHzFine > 0) {
    const steps = Math.min(900, Math.max(200, Math.floor(w)));
    const n = state.fineData.length;
    ctx.beginPath();
    for (let s = 0; s <= steps; s++) {
      const freq = CFG.MIN_HZ * Math.pow(CFG.MAX_HZ / CFG.MIN_HZ, s / steps);
      const bin = clamp(Math.round(freq / state.binHzFine), 1, n - 2);
      const raw = state.fineData[bin];
      const db = Number.isFinite(raw) ? raw : CFG.DB_VIEW_MIN;
      const x = (s / steps) * w;
      const y = clamp(yForDb(db, h), 0, h);
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(91, 201, 255, 0.18)';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.strokeStyle = '#5bc9ff';
    ctx.lineWidth = 1.3;
    ctx.stroke();
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(91, 201, 255, 0.15)');
    gradient.addColorStop(1, 'rgba(91, 201, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fill();
  }

  if (state.signal && state.peaks.length) {
    ctx.save();
    ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const peak of state.peaks.slice(0, 3)) {
      const x = clamp(xForHz(peak.hz, w), 8, w - 8);
      const y = clamp(yForDb(peak.db, h), 2, h - 2);
      ctx.fillStyle = '#ffd18a';
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
      const label = peak.hz >= 1000 ? `${(peak.hz / 1000).toFixed(2)}k` : peak.hz.toFixed(1);
      const labelX = clamp(x, 22, w - 22);
      const nearTop = y < 26;
      const labelWidth = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(6, 9, 12, 0.72)';
      ctx.fillRect(labelX - labelWidth / 2 - 2, nearTop ? y + 10 : y - 19, labelWidth + 4, 11);
      ctx.fillStyle = 'rgba(232, 237, 243, 0.85)';
      ctx.textBaseline = nearTop ? 'top' : 'bottom';
      ctx.fillText(label, labelX, nearTop ? y + 12 : y - 7);
    }
    ctx.restore();
  }

  ctx.save();
  ctx.fillStyle = '#5b6775';
  ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  for (const db of [-20, -60, -100]) {
    if (db === -100 && w < 480) continue;
    const y = yForDb(db, h);
    const labelY = clamp(y, 9, h - 9);
    ctx.fillStyle = 'rgba(6, 9, 12, 0.68)';
    ctx.fillRect(w - 32, labelY - 8, 28, 12);
    ctx.fillStyle = '#5b6775';
    ctx.fillText(`${db}`, w - 5, labelY);
  }
  ctx.textAlign = 'left';
  for (const freq of [20, 100, 1000, 10000]) {
    const x = xForHz(freq, w);
    ctx.textAlign = freq === 20 ? 'left' : 'center';
    ctx.fillText(formatFreqLabel(freq), clamp(x, 4, w - 4), h - 5);
  }
  ctx.restore();

  if (!state.running) overlayText(ctx, w, h, 'Start a source');
  else if (!state.signal) overlayText(ctx, w, h, 'No signal');
}

function initSpectrogram() {
  if (!state.analyserSpec || !state.ctx) {
    state.fall = null;
    return;
  }
  const canvas = els.spectrogram;
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const colPx = Math.max(1, Math.round(dpr));
  const cssHeight = Math.max(120, Math.round(canvas.clientHeight || CFG.SPEC_ROWS));
  const cssWidth = clamp(
    Math.round(canvas.clientWidth || 640),
    240,
    CFG.SPEC_MAX_WIDTH
  );
  const width = cssWidth * colPx;
  const height = Math.max(1, Math.round(cssHeight * dpr));
  const tex = document.createElement('canvas');
  tex.width = width;
  tex.height = height;
  const texCtx = tex.getContext('2d');
  texCtx.fillStyle = '#070a0e';
  texCtx.fillRect(0, 0, width, height);
  state.fall = {
    tex,
    ctx: texCtx,
    width,
    height,
    dpr,
    colPx,
    ticks: new Uint8Array(width),
    columns: 0,
    rows: DSP.buildLogRows(
      height,
      CFG.MIN_HZ,
      CFG.MAX_HZ,
      state.ctx.sampleRate,
      CFG.FFT_SPEC,
      state.analyserSpec.frequencyBinCount
    ),
    image: texCtx.createImageData(colPx, height),
  };
  state.lastColumn = performance.now();
  els.specWindow.textContent = `≈${Math.round(cssWidth * CFG.SPEC_COL_MS / 1000)} s window`;
}

function clearSpectrogram() {
  const fall = state.fall;
  if (!fall) return;
  fall.ctx.fillStyle = '#070a0e';
  fall.ctx.fillRect(0, 0, fall.width, fall.height);
  fall.ticks.fill(0);
  fall.columns = 0;
  state.lastColumn = performance.now();
  drawSpectrogram();
}

function writeSpectrogramColumn() {
  const fall = state.fall;
  const spec = state.analyserSpec;
  if (!fall || !spec) return;
  const colPx = fall.colPx;
  spec.getFloatFrequencyData(state.specData);

  fall.ticks.copyWithin(0, colPx);
  const mark = fall.columns % 125 === 0 ? 1 : 0;
  for (let x = fall.width - colPx; x < fall.width; x++) fall.ticks[x] = mark;

  fall.ctx.drawImage(fall.tex, -colPx, 0);

  const image = fall.image;
  const data = image.data;
  for (let y = 0; y < fall.height; y++) {
    const row = fall.rows[y];
    const raw = state.specData[row.bin];
    const db = Number.isFinite(raw) ? raw : CFG.DB_COLOR_MIN;
    const t = clamp(
      (db - CFG.DB_COLOR_MIN) / (CFG.DB_COLOR_MAX - CFG.DB_COLOR_MIN),
      0,
      1
    );
    const color = activeLut[Math.round(t * 255)];
    const offset = y * 4;
    data[offset] = color[0];
    data[offset + 1] = color[1];
    data[offset + 2] = color[2];
    data[offset + 3] = 255;
  }
  fall.ctx.putImageData(image, fall.width - colPx, 0);
  fall.columns++;
}

function drawSpectrogram() {
  const { ctx, w, h } = fitCanvas(els.spectrogram);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#06090c';
  ctx.fillRect(0, 0, w, h);

  const fall = state.fall;
  if (fall) ctx.drawImage(fall.tex, 0, 0, w, h);

  if (state.targetValid) {
    const y1 = yForHz(Math.min(CFG.MAX_HZ, state.target + state.tol), h);
    const y2 = yForHz(Math.max(CFG.MIN_HZ, state.target - state.tol), h);
    ctx.fillStyle = 'rgba(255, 180, 84, 0.07)';
    ctx.fillRect(0, y1, w, Math.max(1, y2 - y1));
  }

  ctx.save();
  ctx.strokeStyle = 'rgba(110, 126, 145, 0.16)';
  ctx.lineWidth = 1;
  ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
  for (const freq of FREQ_GRID) {
    const rawY = yForHz(freq, h);
    const lineY = Math.round(rawY) + 0.5;
    if (lineY >= 0 && lineY <= h) {
      ctx.beginPath();
      ctx.moveTo(0, lineY);
      ctx.lineTo(w, lineY);
      ctx.stroke();
    }
    if (!(freq === 20000 && h < 220)) {
      const labelY = clamp(rawY, 12, h - 4);
      ctx.fillStyle = 'rgba(6, 9, 12, 0.78)';
      ctx.fillRect(0, labelY - 11, 36, 12);
      ctx.fillStyle = '#5b6775';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(formatFreqLabel(freq), 4, labelY - 1);
    }
  }
  ctx.restore();

  if (fall && fall.ticks) {
    const scale = w / fall.width;
    ctx.save();
    ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (let x = 0; x < fall.width; x++) {
      if (!fall.ticks[x]) continue;
      const px = x * scale;
      ctx.strokeStyle = 'rgba(110, 126, 145, 0.17)';
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();
      const seconds = (((fall.width - 1 - x) / fall.colPx) * CFG.SPEC_COL_MS) / 1000;
      if (seconds >= 2 && px > 26 && px < w - 26) {
        ctx.fillStyle = '#5b6775';
        ctx.fillText(`-${Math.round(seconds)}s`, px, h - 6);
      }
    }
    ctx.restore();
  }

  if (state.targetValid) {
    const y = yForHz(state.target, h);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 180, 84, 0.8)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffb454';
    ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('target', w - 7, Math.max(10, y - 3));
    ctx.restore();
  }

  if (!state.running) overlayText(ctx, w, h, 'Start a source');
  else if (!state.signal) overlayText(ctx, w, h, 'No signal');
  if (state.paused) {
    ctx.save();
    ctx.fillStyle = '#ffb454';
    ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('PAUSED', w - 7, 7);
    ctx.restore();
  }
}

function drawIdle() {
  drawSpectrum();
  drawSpectrogram();
}

async function boot(seq, config) {
  const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtor) throw new Error('Web Audio is not available in this browser.');
  const ctx = new AudioCtor({ latencyHint: 'interactive' });
  let source = null;
  try {
    await withTimeout(ctx.resume(), 5000, 'The audio engine did not start. Try again.');
    if (seq !== state.seq) {
      await ctx.close();
      return false;
    }

    const analyserFine = ctx.createAnalyser();
    analyserFine.fftSize = CFG.FFT_FINE;
    analyserFine.smoothingTimeConstant = 0;

    const analyserSpec = ctx.createAnalyser();
    analyserSpec.fftSize = CFG.FFT_SPEC;
    analyserSpec.smoothingTimeConstant = 0.4;

    const outGain = ctx.createGain();
    outGain.gain.value = Number(config.gain) || 0;

    let osc = null;
    if (config.stream) {
      source = ctx.createMediaStreamSource(config.stream);
    } else if (config.mediaEl) {
      source = ctx.createMediaElementSource(config.mediaEl);
    } else if (Number.isFinite(config.toneFreq)) {
      osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = config.toneFreq;
      const toneGain = ctx.createGain();
      toneGain.gain.value = 0.25;
      osc.connect(toneGain);
      osc.start();
      source = toneGain;
    } else {
      throw new Error('No audio source was supplied.');
    }

    source.connect(analyserFine);
    analyserFine.connect(analyserSpec);
    analyserSpec.connect(outGain);
    outGain.connect(ctx.destination);

    if (seq !== state.seq) {
      try { source.disconnect(); } catch (error) { /* already gone */ }
      try { analyserFine.disconnect(); } catch (error) { /* already gone */ }
      try { analyserSpec.disconnect(); } catch (error) { /* already gone */ }
      try { outGain.disconnect(); } catch (error) { /* already gone */ }
      try { osc?.stop(); } catch (error) { /* already stopped */ }
      await ctx.close();
      return false;
    }

    state.ctx = ctx;
    state.sourceNode = source;
    state.analyserFine = analyserFine;
    state.analyserSpec = analyserSpec;
    state.outGain = outGain;
    state.osc = osc;
    state.stream = config.stream || null;
    state.mediaEl = config.mediaEl || null;
    state.mediaUrl = config.mediaUrl || null;
    state.mode = config.mode || 'unknown';
    state.fineData = new Float32Array(analyserFine.frequencyBinCount);
    state.specData = new Float32Array(analyserSpec.frequencyBinCount);
    state.timeData = new Float32Array(analyserFine.fftSize);
    state.binHzFine = ctx.sampleRate / CFG.FFT_FINE;
    state.binHzSpec = ctx.sampleRate / CFG.FFT_SPEC;
    state.floorDb = -100;
    state.running = true;
    state.paused = false;
    commitTarget(false);
    state.sessionStart = performance.now();
    state.lastColumn = state.sessionStart;
    state.lastBucket = state.sessionStart;
    state.lastText = 0;
    state.lastSpectrum = 0;
    state.lastFloor = 0;

    resetReadout();
    resetEvidence();
    clearExport();
    initSpectrogram();
    updateButtons();

    els.engineMeta.textContent =
      `${(ctx.sampleRate / 1000).toFixed(1)} kHz · Δf ${state.binHzFine.toFixed(2)} Hz · ${analyserFine.frequencyBinCount} bins`;
    els.diagMeta.textContent =
      `Sample rate ${ctx.sampleRate} Hz · fine FFT ${CFG.FFT_FINE} · spectrogram FFT ${CFG.FFT_SPEC} · ${analyserFine.frequencyBinCount} bins`;

    state.raf = requestAnimationFrame(tick);
    return true;
  } catch (error) {
    try { source?.disconnect(); } catch (err) { /* ignore */ }
    try { await ctx.close(); } catch (err) { /* ignore */ }
    throw error;
  }
}

function stopSession(keepStatus = false) {
  state.seq++;
  if (state.raf) cancelAnimationFrame(state.raf);
  state.raf = 0;
  state.running = false;
  state.paused = false;

  try { state.sourceNode?.disconnect(); } catch (error) { /* ignore */ }
  try { state.analyserFine?.disconnect(); } catch (error) { /* ignore */ }
  try { state.analyserSpec?.disconnect(); } catch (error) { /* ignore */ }
  try { state.outGain?.disconnect(); } catch (error) { /* ignore */ }
  try { state.osc?.stop(); } catch (error) { /* ignore */ }

  const ctx = state.ctx;
  state.ctx = null;
  if (ctx) ctx.close().catch(() => {});

  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      try { track.stop(); } catch (error) { /* ignore */ }
    }
  }
  state.stream = null;

  if (state.mediaEl) {
    try { state.mediaEl.pause(); } catch (error) { /* ignore */ }
    state.mediaEl.remove();
  }
  state.mediaEl = null;
  if (state.mediaUrl) {
    URL.revokeObjectURL(state.mediaUrl);
    state.mediaUrl = null;
  }
  els.playerWrap.hidden = true;
  els.playerHost.replaceChildren();

  state.sourceNode = null;
  state.analyserFine = null;
  state.analyserSpec = null;
  state.outGain = null;
  state.osc = null;
  state.fineData = null;
  state.specData = null;
  state.timeData = null;
  state.binHzFine = 0;
  state.binHzSpec = 0;
  state.mode = null;
  state.fall = null;

  resetEvidence();
  resetReadout();
  updateButtons();
  els.engineMeta.textContent = 'Idle';
  els.specWindow.textContent = '—';
  els.pauseBtn.textContent = 'Pause';
  els.freq.classList.add('no-signal');
  drawIdle();
  if (!keepStatus) setStatus('Idle — choose a source.');
}

async function startMic() {
  if (state.running) return;
  if (window.location.protocol === 'file:') {
    setStatus('Microphone capture needs http://localhost or https. Serve the folder locally, or use Open file.');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('Microphone capture is not available in this browser.');
    return;
  }
  stopSession(true);
  const seq = state.seq;
  setStatus('Requesting microphone…');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (error) {
    if (seq === state.seq) setStatus(`Microphone error: ${error.message}`);
    return;
  }
  if (seq !== state.seq) {
    for (const track of stream.getTracks()) track.stop();
    return;
  }
  try {
    const ok = await boot(seq, { mode: 'mic', stream, gain: 0 });
    if (!ok) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    if (seq === state.seq) {
      stopSession(true);
      setStatus(`Could not start audio analysis: ${error.message}`);
    }
    return;
  }
  const watch = () => {
    if (seq === state.seq) {
      stopSession(true);
      setStatus('Microphone disconnected.');
    }
  };
  for (const track of stream.getAudioTracks()) {
    if (track.readyState === 'ended') watch();
    else track.addEventListener('ended', watch, { once: true });
  }
  setStatus('Microphone live. Play a steady tone to verify it.');
}

async function startTab() {
  if (state.running) return;
  if (window.location.protocol === 'file:') {
    setStatus('Tab audio capture needs http://localhost or https. Serve the folder locally, or use Open file.');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    setStatus('Tab audio capture is not available in this browser. Chrome or Edge on desktop is required.');
    return;
  }
  stopSession(true);
  const seq = state.seq;
  setStatus('Choose a tab and tick “Share tab audio”.');
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (error) {
    if (seq === state.seq) setStatus(`Capture cancelled or failed: ${error.message}`);
    return;
  }
  if (seq !== state.seq) {
    for (const track of stream.getTracks()) track.stop();
    return;
  }
  if (stream.getAudioTracks().length === 0) {
    for (const track of stream.getTracks()) track.stop();
    setStatus('No audio was shared. Try again and tick “Share tab audio”.');
    return;
  }
  try {
    const ok = await boot(seq, { mode: 'tab', stream, gain: 0 });
    if (!ok) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    if (seq === state.seq) {
      stopSession(true);
      setStatus(`Could not start tab analysis: ${error.message}`);
    }
    return;
  }
  const watch = () => {
    if (seq === state.seq) {
      stopSession(true);
      setStatus('Tab audio ended. Start again to capture another tab.');
    }
  };
  for (const track of [...stream.getAudioTracks(), ...stream.getVideoTracks()]) {
    if (track.readyState === 'ended') watch();
    else track.addEventListener('ended', watch, { once: true });
  }
  setStatus('Analysing tab audio. Keep the tab playing.');
}

function stamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function openFile(file) {
  if (!file) return;
  if (state.running) {
    setStatus('Stop the current source before opening a file.');
    return;
  }
  stopSession(true);
  const seq = state.seq;
  const name = file.name || 'audio';
  const looksVideo = (file.type && file.type.startsWith('video/'))
    || /\.(mp4|m4v|webm|mov|ogv|mkv)$/i.test(name);
  const url = URL.createObjectURL(file);
  const media = document.createElement(looksVideo ? 'video' : 'audio');
  media.controls = true;
  media.setAttribute('playsinline', '');
  media.preload = 'auto';
  media.src = url;
  media.className = 'media';
  els.playerHost.replaceChildren(media);
  els.fileName.textContent = name;
  els.fileKind.textContent = `${file.type || 'media'} · ${(file.size / 1048576).toFixed(1)} MB`;
  els.playerWrap.hidden = false;
  setStatus('Loading file…');

  const failDecode = () => {
    if (seq !== state.seq) return;
    stopSession(true);
    setStatus('This file could not be decoded by the browser.');
  };
  media.addEventListener('error', failDecode);
  media.addEventListener('ended', () => {
    if (seq !== state.seq) return;
    resetEvidence();
    resetReadout();
    clearSpectrogram();
    setStatus('Playback ended. Replay the file or open another.');
  });
  media.addEventListener('seeked', () => {
    if (seq !== state.seq) return;
    resetEvidence();
    resetReadout();
    clearSpectrogram();
  });

  try {
    const ok = await boot(seq, { mode: 'file', mediaEl: media, mediaUrl: url, gain: 0.9 });
    if (!ok) {
      URL.revokeObjectURL(url);
      media.remove();
      els.playerWrap.hidden = true;
      return;
    }
  } catch (error) {
    URL.revokeObjectURL(url);
    media.remove();
    els.playerWrap.hidden = true;
    if (seq === state.seq) {
      stopSession(true);
      setStatus(`Could not open that file: ${error.message}`);
    }
    return;
  }

  if (media.error) {
    failDecode();
    return;
  }

  try {
    await media.play();
    if (seq === state.seq) setStatus(`Playing ${name}. Audio is analysed in real time.`);
  } catch (error) {
    if (seq !== state.seq) return;
    if (media.error || error.name === 'NotSupportedError') {
      failDecode();
      return;
    }
    setStatus('File ready. Press play on the player to start analysis.');
  }
}

async function startTone(frequency) {
  const tone = clamp(Number.parseFloat(frequency) || 440, CFG.MIN_HZ, CFG.MAX_HZ);
  stopSession(true);
  const seq = state.seq;
  setStatus(`Starting ${tone.toFixed(1)} Hz test tone…`);
  try {
    const ok = await boot(seq, { mode: 'test', toneFreq: tone, gain: 0 });
    if (!ok) return false;
  } catch (error) {
    if (seq === state.seq) {
      stopSession(true);
      setStatus(`Could not start the test tone: ${error.message}`);
    }
    return false;
  }
  setStatus(`Test tone ${tone.toFixed(2)} Hz (silent).`);
  return true;
}

function pushExportRow(now) {
  const peak = state.peaks;
  const evidence = state.lastEvidence;
  const note = state.displayHz ? DSP.noteFor(state.displayHz) : null;
  const row = [
    ((now - state.sessionStart) / 1000).toFixed(2),
    state.displayHz ? state.displayHz.toFixed(2) : '',
    note ? note.name : '',
    note ? note.cents.toFixed(2) : '',
    peak[0] ? peak[0].db.toFixed(1) : '',
    Number.isFinite(state.floorDb) ? state.floorDb.toFixed(1) : '',
    state.signal ? 1 : 0,
    state.targetValid ? state.target : '',
    evidence ? evidence.snrDb.toFixed(1) : '',
    evidence ? evidence.peakHz.toFixed(2) : '',
    evidence ? evidence.prominenceDb.toFixed(1) : '',
    state.toneNow ? 1 : 0,
    peak[0] ? peak[0].hz.toFixed(2) : '',
    peak[0] ? peak[0].db.toFixed(1) : '',
    peak[1] ? peak[1].hz.toFixed(2) : '',
    peak[1] ? peak[1].db.toFixed(1) : '',
    peak[2] ? peak[2].hz.toFixed(2) : '',
    peak[2] ? peak[2].db.toFixed(1) : '',
  ];
  state.exportRows.push(row);
  if (state.exportRows.length > CFG.EXPORT_MAX) state.exportRows.shift();
  if (state.exportRows.length === 1) updateButtons();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportCsv() {
  const header = [
    't_s', 'dominant_hz', 'dominant_note', 'dominant_cents', 'dominant_db',
    'floor_db', 'signal', 'target_hz', 'band_snr_db', 'peak_in_band_hz',
    'prominence_db', 'tone_present', 'p1_hz', 'p1_db', 'p2_hz', 'p2_db', 'p3_hz', 'p3_db',
  ];
  const lines = [header.join(',')];
  for (const row of state.exportRows) lines.push(row.join(','));
  downloadBlob(
    new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }),
    `frequency-lab-${stamp()}.csv`
  );
}

function exportPng() {
  if (!state.running) return;
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const spectrum = els.spectrum;
  const spectrogram = els.spectrogram;
  const width = Math.max(spectrum.width, spectrogram.width);
  const pad = Math.round(22 * dpr);
  const headerHeight = Math.round(66 * dpr);
  const gap = Math.round(16 * dpr);
  const height = headerHeight + spectrum.height + gap + spectrogram.height + pad;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#080a0e';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#e8edf3';
  ctx.font = `600 ${Math.round(18 * dpr)}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.fillText('Frequency Lab', pad, Math.round(34 * dpr));
  ctx.fillStyle = '#8b96a5';
  ctx.font = `${Math.round(11 * dpr)}px ui-monospace, Menlo, monospace`;
  const targetText = state.targetValid ? `target ${state.target} Hz ±${state.tol} Hz` : 'no target';
  ctx.fillText(`${targetText} · ${new Date().toLocaleString()}`, pad, Math.round(52 * dpr));
  ctx.drawImage(spectrum, 0, headerHeight);
  ctx.drawImage(spectrogram, 0, headerHeight + spectrum.height + gap);
  out.toBlob((blob) => {
    if (blob) downloadBlob(blob, `frequency-lab-${stamp()}.png`);
  }, 'image/png');
}

function renderSelfTest(result) {
  const lines = result.checks.map((check) => {
    if (check.error) return `FAIL  ${check.error}`;
    const measured = Number.isFinite(check.measured) ? `${check.measured.toFixed(2)} Hz` : 'no reading';
    const note = check.note ? `  ${check.note}` : '';
    const cents = Number.isFinite(check.cents) ? `  ${DSP.formatCents(check.cents)} cents` : '';
    return `${check.ok ? 'PASS' : 'FAIL'}  ${check.target} Hz target  →  ${measured}${note}${cents}`;
  });
  lines.push(result.ok ? 'Self-test passed.' : 'Self-test failed.');
  els.selfTestOut.textContent = lines.join('\n');
}

async function runSelfTest(auto = false) {
  els.selfTestBtn.disabled = true;
  els.selfTestBtn.setAttribute('aria-busy', 'true');
  els.selfTestOut.textContent = 'Running self-test…';
  setStatus('Self-test running: 440, 432, 528 Hz.');
  const checks = [];
  try {
    const started = await startTone(440);
    if (!started || !state.osc || !state.ctx) throw new Error('test tone did not start');
    const plan = [440, 432, 528];
    for (const frequency of plan) {
      state.osc.frequency.setValueAtTime(frequency, state.ctx.currentTime);
      await sleep(frequency === 440 ? 1400 : 950);
      const measured = state.displayHz;
      const note = measured ? DSP.noteFor(measured) : null;
      const ok = Number.isFinite(measured) && Math.abs(measured - frequency) <= 0.2;
      checks.push({
        target: frequency,
        measured: Number.isFinite(measured) ? measured : null,
        note: note ? note.name : null,
        cents: note ? note.cents : null,
        ok,
      });
    }
  } catch (error) {
    checks.push({ target: null, measured: null, note: null, cents: null, ok: false, error: error.message });
  }

  const ok = checks.length === 3 && checks.every((check) => check.ok);
  const result = {
    ok,
    checks,
    mode: auto ? 'auto' : 'manual',
    when: new Date().toISOString(),
  };
  stopSession(true);
  (window as any).__selfTestResult = result;
  renderSelfTest(result);
  setStatus(ok ? 'Self-test passed: 440 / 432 / 528 Hz within 0.2 Hz.' : 'Self-test failed — see Diagnostics.');
  els.selfTestBtn.disabled = false;
  els.selfTestBtn.removeAttribute('aria-busy');
}

function scheduleResize() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    if (state.running) {
      initSpectrogram();
      state.lastColumn = performance.now();
    }
    drawIdle();
  }, 120);
}

function bindEvents() {
  els.micBtn.addEventListener('click', startMic);
  els.tabBtn.addEventListener('click', startTab);
  els.stopBtn.addEventListener('click', () => {
    stopSession();
    setStatus('Stopped.');
  });

  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files && els.fileInput.files[0];
    els.fileInput.value = '';
    if (file) openFile(file);
  });

  els.pauseBtn.addEventListener('click', () => {
    if (!state.running) return;
    state.paused = !state.paused;
    els.pauseBtn.textContent = state.paused ? 'Resume' : 'Pause';
    if (!state.paused) state.lastColumn = performance.now();
    drawSpectrogram();
  });

  els.targetInput.addEventListener('input', () => commitTarget(true));
  els.tolInput.addEventListener('input', () => commitTarget(true));
  els.presets.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button[data-hz]') as HTMLButtonElement | null;
    if (!button) return;
    els.targetInput.value = button.dataset.hz;
    commitTarget(true);
  });

  els.toneFreq.addEventListener('input', () => {
    if (state.mode === 'test' && state.osc && state.ctx) {
      const value = clamp(Number.parseFloat(els.toneFreq.value) || 440, CFG.MIN_HZ, CFG.MAX_HZ);
      state.osc.frequency.setValueAtTime(value, state.ctx.currentTime);
    }
  });

  els.toneBtn.addEventListener('click', () => {
    if (state.mode === 'test' && state.running) {
      stopSession();
      setStatus('Test tone stopped.');
    } else {
      startTone(els.toneFreq.value);
    }
  });

  els.selfTestBtn.addEventListener('click', () => runSelfTest(false));
  els.exportCsv.addEventListener('click', exportCsv);
  els.exportPng.addEventListener('click', exportPng);

  window.addEventListener('resize', scheduleResize);
  if ('ResizeObserver' in window) {
    new ResizeObserver(scheduleResize).observe(document.querySelector('.scope'));
  }

  for (const type of ['dragenter', 'dragover']) {
    document.addEventListener(type, (event) => {
      event.preventDefault();
      document.body.classList.add('dragging');
    });
  }
  for (const type of ['dragleave', 'drop']) {
    document.addEventListener(type, (event) => {
      event.preventDefault();
      document.body.classList.remove('dragging');
    });
  }
  document.addEventListener('drop', (event) => {
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) openFile(file);
  });

  els.paletteBtn.addEventListener('click', () => {
    applyPalette(currentPalette === 'studio' ? 'contrast' : 'studio');
    savePrefs({
      targetHz: state.targetValid ? state.target : null,
      tolHz: state.tol,
      palette: currentPalette,
    });
  });

  els.copyLink.addEventListener('click', () => {
    const link = setupLink(state.targetValid ? state.target : null, state.tol);
    copyWithFeedback(els.copyLink, link, 'Setup link copied — it reopens this target and tolerance.');
  });

  els.copyResult.addEventListener('click', () => {
    const note = state.displayHz != null ? DSP.noteFor(state.displayHz) : null;
    const text = summaryText({
      displayHz: state.displayHz,
      note,
      target: state.targetValid ? state.target : null,
      tol: state.tol,
      verdict: els.verdict.textContent || '',
      pct10: els.pct10.textContent || '—',
      pctAll: els.pctAll.textContent || '—',
      url: window.location.href,
    });
    copyWithFeedback(els.copyResult, text, 'Result summary copied.');
  });

  document.addEventListener('keydown', onKeydown);

  document.addEventListener('visibilitychange', () => {
    if (!state.running) return;
    if (document.hidden) {
      state.bucket = { signalFrames: 0, toneFrames: 0 };
    } else {
      state.lastColumn = performance.now();
      state.lastBucket = performance.now();
    }
  });
}


function renderPresets(): void {
  const buttons = APP_PRESETS.map((preset) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.hz = String(preset.hz);
    button.textContent = String(preset.hz);
    button.title = `${preset.label}: ${preset.claim}`;
    return button;
  });
  els.presets.replaceChildren(...buttons);
}

function applyPalette(palette: Palette): void {
  currentPalette = palette;
  document.body.classList.toggle('contrast', palette === 'contrast');
  activeLut = palette === 'contrast' ? CONTRAST_LUT : COLOR_LUT;
  els.paletteBtn.setAttribute('aria-pressed', String(palette === 'contrast'));
  els.paletteBtn.textContent = palette === 'contrast' ? 'Studio plots' : 'High contrast';
  for (const legend of document.querySelectorAll<HTMLElement>('.legend .grad')) {
    legend.classList.toggle('contrast-grad', palette === 'contrast');
  }
  if (state.running) drawSpectrogram();
}

let persistTimer = 0;
function persistSoon(): void {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    syncUrl(state.targetValid ? state.target : null, state.tol);
    savePrefs({
      targetHz: state.targetValid ? state.target : null,
      tolHz: state.tol,
      palette: currentPalette,
    });
  }, 220);
}

async function copyWithFeedback(
  button: HTMLButtonElement,
  text: string,
  okMessage: string
): Promise<void> {
  const original = button.textContent || 'Copy';
  const ok = await copyText(text);
  button.textContent = ok ? 'Copied' : 'Copy blocked';
  button.classList.toggle('copy-state', ok);
  setStatus(ok ? okMessage : 'The clipboard is blocked in this browser.');
  window.setTimeout(() => {
    button.textContent = original;
    button.classList.remove('copy-state');
  }, 1600);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  if (target && target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (event.key === 'p' || event.key === 'P') {
    if (els.pauseBtn.disabled) return;
    event.preventDefault();
    els.pauseBtn.click();
  } else if (event.key === 's' || event.key === 'S') {
    if (els.stopBtn.disabled) return;
    event.preventDefault();
    els.stopBtn.click();
  } else if (event.key === 'e' || event.key === 'E') {
    if (els.exportCsv.disabled) return;
    event.preventDefault();
    els.exportCsv.click();
  }
}

function init() {
  const prefs = loadPrefs();
  const urlState = parseUrlState(window.location.search);

  if (urlState.embed) document.body.classList.add('page--embed');
  applyPalette(prefs.palette);
  renderPresets();

  if (urlState.targetHz != null) els.targetInput.value = String(urlState.targetHz);
  else if (prefs.targetHz != null) els.targetInput.value = String(prefs.targetHz);
  if (urlState.tolHz != null) els.tolInput.value = String(urlState.tolHz);
  else if (prefs.tolHz != null) els.tolInput.value = String(prefs.tolHz);

  commitTarget(false);
  updateButtons();
  resetReadout();
  els.freq.classList.add('no-signal');
  els.specWindow.textContent = '—';
  els.protocolNotice.hidden = window.location.protocol !== 'file:';
  drawIdle();
  bindEvents();

  if ('launchQueue' in window) {
    (window as any).launchQueue.setConsumer(async (params: any) => {
      const handle = params && params.files && params.files[0];
      if (!handle) return;
      try {
        const file = await handle.getFile();
        openFile(file);
      } catch {
        /* the file handle can be revoked between launch and read */
      }
    });
  }

  const params = new URLSearchParams(window.location.search);
  if (params.has('selftest')) {
    window.setTimeout(() => runSelfTest(true), 300);
  } else if (urlState.demoHz != null) {
    const frequency = urlState.demoHz;
    clearDemoParam();
    window.setTimeout(async () => {
      const ok = await startTone(frequency);
      if (!ok) {
        els.toneFreq.value = String(frequency);
        setStatus(`Press “Start tone” to play ${frequency} Hz (autoplay was blocked).`);
      }
    }, 300);
  }
}

(window as any).__freqLab = {
  state,
  runSelfTest,
  noteFor: DSP.noteFor,
};

init();
