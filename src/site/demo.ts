/**
 * Landing-page demo: a short synthesised sine, measured with the same DSP core
 * as the workbench. It exists to show the idea without asking for microphone
 * permission or loading the full app.
 */

import { FreqLabDSP as DSP } from '../dsp/core';
import './register-sw';

const root = document.querySelector<HTMLElement>('[data-demo]');
if (root) start(root);

function start(root: HTMLElement): void {
  const canvas = root.querySelector<HTMLCanvasElement>('[data-demo-canvas]');
  const hzEl = root.querySelector<HTMLElement>('[data-demo-hz]');
  const noteEl = root.querySelector<HTMLElement>('[data-demo-note]');
  const chips = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-demo-tone]'));
  if (!canvas || !hzEl || !noteEl) return;

  const context = canvas.getContext('2d');
  if (!context) return;

  const FFT = 16384;
  const MIN_HZ = 20;
  const MAX_HZ = 20000;
  const DB_MIN = -100;
  const DB_MAX = -20;
  const LOG_MIN = Math.log10(MIN_HZ);
  const LOG_SPAN = Math.log10(MAX_HZ) - LOG_MIN;

  let audio: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let osc: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  let data: Float32Array<ArrayBuffer> | null = null;
  let raf = 0;
  let playing = 0;
  let history: number[] = [];
  let lastText = 0;
  let stopTimer = 0;

  function ensureAudio(): AudioContext {
    if (!audio) {
      audio = new AudioContext({ latencyHint: 'interactive' });
      analyser = audio.createAnalyser();
      analyser.fftSize = FFT;
      analyser.smoothingTimeConstant = 0.3;
      gain = audio.createGain();
      gain.gain.value = 0;
      gain.connect(analyser);
      analyser.connect(audio.destination);
      data = new Float32Array(analyser.frequencyBinCount);
    }
    return audio;
  }

  function play(hz: number): void {
    const ctx = ensureAudio();
    ctx.resume();
    if (!analyser || !gain) return;

    if (osc && audio) {
      try { osc.stop(); } catch { /* already stopped */ }
      osc.disconnect();
      osc = null;
    }

    osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = hz;
    osc.connect(gain);
    osc.start();

    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.07, now + 0.06);

    playing = hz;
    history = [];
    for (const chip of chips) {
      chip.setAttribute('aria-pressed', String(Number(chip.dataset.demoTone) === hz));
    }
    noteEl.textContent = 'Measuring…';

    window.clearTimeout(stopTimer);
    stopTimer = window.setTimeout(() => stopSound(), 12000);
    if (!raf) loop();
  }

  function stopSound(): void {
    playing = 0;
    history = [];
    if (raf) {
      window.cancelAnimationFrame(raf);
      raf = 0;
    }
    if (gain && audio) {
      const now = audio.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.15);
    }
    if (osc && audio) {
      const node = osc;
      osc = null;
      window.setTimeout(() => {
        try { node.stop(); } catch { /* already stopped */ }
        node.disconnect();
      }, 200);
    }
    for (const chip of chips) chip.setAttribute('aria-pressed', 'false');
    hzEl.textContent = '—';
    hzEl.classList.add('idle');
    noteEl.textContent = 'Press a tone to hear it and measure it here.';
    draw();
  }

  function loop(): void {
    raf = window.requestAnimationFrame(loop);
    if (!analyser || !data || !audio) return;
    if (audio.state === 'suspended') audio.resume();

    analyser.getFloatFrequencyData(data);

    if (playing) {
      const binHz = audio.sampleRate / FFT;
      const startBin = Math.max(1, Math.ceil(MIN_HZ / binHz));
      const endBin = Math.min(
        data.length - 2,
        Math.floor(Math.min(MAX_HZ, audio.sampleRate / 2 - binHz) / binHz)
      );
      const floor = DSP.noiseFloor(data, startBin, endBin, 8);
      const peaks = DSP.pickPeaks(data, {
        sampleRate: audio.sampleRate,
        fftSize: FFT,
        floorDb: floor,
        maxPeaks: 3,
      });
      if (peaks.length) {
        history.push(peaks[0].hz);
        if (history.length > 5) history.shift();
        const hz = DSP.median(history);
        hzEl.textContent = hz.toFixed(2);
        hzEl.classList.remove('idle');
        const note = DSP.noteFor(hz);
        if (note && performance.now() - lastText > 120) {
          lastText = performance.now();
          const cents = `${note.cents >= 0 ? '+' : ''}${note.cents.toFixed(1)}`;
          noteEl.textContent = `${peaks[0].hz.toFixed(2)} Hz peak · ${note.name} · ${cents} cents`;
        }
      }
    }

    draw();
  }

  function fit(): { ctx: CanvasRenderingContext2D; w: number; h: number; dpr: number } {
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const w = Math.max(1, canvas!.clientWidth);
    const h = Math.max(1, canvas!.clientHeight);
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas!.width !== bw || canvas!.height !== bh) {
      canvas!.width = bw;
      canvas!.height = bh;
    }
    const ctx = context!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h, dpr };
  }

  function xForHz(hz: number, width: number): number {
    return ((Math.log10(hz) - LOG_MIN) / LOG_SPAN) * width;
  }

  function yForDb(db: number, height: number): number {
    const t = (db - DB_MIN) / (DB_MAX - DB_MIN);
    return (1 - Math.min(1, Math.max(0, t))) * height;
  }

  function draw(): void {
    if (!context) return;
    const { ctx, w, h } = fit();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#06090c';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(110, 126, 145, 0.14)';
    ctx.lineWidth = 1;
    ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#3f4a56';
    ctx.textAlign = 'center';
    for (const freq of [100, 1000, 10000]) {
      const x = Math.round(xForHz(freq, w)) + 0.5;
      if (x < 8 || x > w - 8) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : `${freq}`, x, h - 4);
    }

    if (!analyser || !data || !audio) {
      ctx.fillStyle = '#3f4a56';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Press a tone to begin', w / 2, h / 2 - 6);
      return;
    }

    const binHz = audio.sampleRate / FFT;
    const steps = Math.min(360, Math.max(120, Math.floor(w)));
    ctx.beginPath();
    for (let s = 0; s <= steps; s++) {
      const freq = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, s / steps);
      const bin = Math.min(data.length - 2, Math.max(1, Math.round(freq / binHz)));
      const db = Number.isFinite(data[bin]) ? data[bin] : DB_MIN;
      const x = (s / steps) * w;
      const y = yForDb(db, h);
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(91, 201, 255, 0.22)');
    gradient.addColorStop(1, 'rgba(91, 201, 255, 0)');
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    for (let s = 0; s <= steps; s++) {
      const freq = MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, s / steps);
      const bin = Math.min(data.length - 2, Math.max(1, Math.round(freq / binHz)));
      const db = Number.isFinite(data[bin]) ? data[bin] : DB_MIN;
      const x = (s / steps) * w;
      const y = yForDb(db, h);
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#5bc9ff';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    if (playing) {
      const x = xForHz(playing, w);
      ctx.strokeStyle = 'rgba(255, 180, 84, 0.75)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffb454';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${playing} Hz`, Math.min(w - 5, x - 6), h - 14);
    }
  }

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      const hz = Number(chip.dataset.demoTone);
      if (!Number.isFinite(hz)) return;
      if (playing === hz) stopSound();
      else play(hz);
    });
  }

  const observer = new ResizeObserver(() => draw());
  observer.observe(canvas);
  draw();
}
