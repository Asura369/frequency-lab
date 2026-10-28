/**
 * Minimal radix-2 FFT for offline analysis. The live path uses AnalyserNode;
 * a whole file has to be transformed in the worker, so it needs its own FFT.
 */

export interface Fft {
  size: number;
  forward(re: Float32Array, im: Float32Array): void;
}

export function createFft(size: number): Fft {
  if (size < 2 || (size & (size - 1)) !== 0) {
    throw new Error(`FFT size must be a power of two, got ${size}`);
  }
  const levels = Math.round(Math.log2(size));
  const reverse = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    let value = i;
    let result = 0;
    for (let bit = 0; bit < levels; bit++) {
      result = (result << 1) | (value & 1);
      value >>= 1;
    }
    reverse[i] = result;
  }

  const half = size >> 1;
  const cos = new Float32Array(half);
  const sin = new Float32Array(half);
  for (let i = 0; i < half; i++) {
    const angle = (2 * Math.PI * i) / size;
    cos[i] = Math.cos(angle);
    sin[i] = Math.sin(angle);
  }

  return {
    size,
    forward(re: Float32Array, im: Float32Array): void {
      for (let i = 0; i < size; i++) {
        const j = reverse[i];
        if (j > i) {
          const tr = re[i];
          re[i] = re[j];
          re[j] = tr;
          const ti = im[i];
          im[i] = im[j];
          im[j] = ti;
        }
      }

      for (let len = 2; len <= size; len <<= 1) {
        const halfLen = len >> 1;
        const step = size / len;
        for (let start = 0; start < size; start += len) {
          for (let j = 0; j < halfLen; j++) {
            const k = j * step;
            const other = start + j + halfLen;
            const tre = re[other] * cos[k] + im[other] * sin[k];
            const tim = -re[other] * sin[k] + im[other] * cos[k];
            re[other] = re[start + j] - tre;
            im[other] = im[start + j] - tim;
            re[start + j] += tre;
            im[start + j] += tim;
          }
        }
      }
    },
  };
}

/** Hann window; coherent gain 0.5, so amplitudes are scaled by 2/sum. */
export function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
  }
  return window;
}

export function magnitudeDb(
  re: Float32Array,
  im: Float32Array,
  bins: number,
  windowSum: number,
  out: Float32Array
): void {
  const scale = 2 / windowSum;
  for (let i = 0; i < bins; i++) {
    const magnitude = Math.hypot(re[i], im[i]) * scale;
    out[i] = 20 * Math.log10(magnitude + 1e-12);
  }
}
