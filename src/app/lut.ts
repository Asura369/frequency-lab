/** Spectrogram colour maps shared by the live and whole-file renderers. */

type Stop = [number, [number, number, number]];

const STUDIO: Stop[] = [
  [0.00, [7, 10, 15]],
  [0.18, [43, 33, 120]],
  [0.40, [42, 157, 143]],
  [0.64, [184, 222, 41]],
  [0.84, [255, 196, 80]],
  [1.00, [255, 243, 176]],
];

const CONTRAST: Stop[] = [
  [0.00, [0, 0, 0]],
  [0.28, [16, 36, 110]],
  [0.52, [0, 150, 160]],
  [0.76, [220, 214, 40]],
  [1.00, [255, 255, 255]],
];

function build(stops: Stop[]): Array<[number, number, number]> {
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

export const COLOR_LUT = build(STUDIO);
export const CONTRAST_LUT = build(CONTRAST);
