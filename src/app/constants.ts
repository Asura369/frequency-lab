/** Measurement configuration and axis constants shared by the workbench. */

export const CFG = Object.freeze({
  FFT_FINE: 32768,
  FFT_SPEC: 8192,
  MIN_HZ: 20,
  MAX_HZ: 20000,
  DB_VIEW_MIN: -100,
  DB_VIEW_MAX: -20,
  DB_COLOR_MIN: -100,
  DB_COLOR_MAX: -30,
  SIGNAL_ON_DB: -70,
  SIGNAL_OFF_DB: -75,
  SIGNAL_ON_FRAMES: 3,
  SIGNAL_OFF_FRAMES: 8,
  SMOOTH_FRAMES: 5,
  EVIDENCE_MS: 100,
  EVIDENCE_BUCKETS: 100,
  SPEC_COL_MS: 40,
  SPEC_ROWS: 240,
  SPEC_MAX_WIDTH: 960,
  EXPORT_MAX: 6000,
  TOL_MIN: 0.1,
  TOL_MAX: 50,
});

export const FREQ_GRID = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
export const LOG_MIN = Math.log10(CFG.MIN_HZ);
export const LOG_SPAN = Math.log10(CFG.MAX_HZ) - LOG_MIN;
