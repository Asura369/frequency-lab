import { test, expect } from 'vitest';
import { APP_PRESETS, PRESETS } from '../src/site/presets';

test('app presets are unique, measurable and sorted for display', () => {
  const values = APP_PRESETS.map((preset) => preset.hz);
  expect(new Set(values).size).toBe(values.length);
  expect(values.every((hz) => hz >= 20 && hz <= 20000)).toBe(true);
  expect(APP_PRESETS.every((preset) => preset.inApp)).toBe(true);
  expect(values).toContain(432);
  expect(values).toContain(528);
});

test('claims table covers the common set and marks the unmeasurable ones', () => {
  const values = PRESETS.map((preset) => preset.hz);
  for (const hz of [174, 285, 396, 417, 432, 440, 528, 639, 741, 852, 963, 7.83]) {
    expect(values).toContain(hz);
  }
  expect(PRESETS.find((preset) => preset.hz === 7.83)?.inApp).toBe(false);
  expect(PRESETS.find((preset) => preset.hz === 528)?.inApp).toBe(true);
});

test('every preset has a claim and an explicit caveat', () => {
  for (const preset of PRESETS) {
    expect(preset.claim.length).toBeGreaterThan(10);
    expect(preset.caveat.length).toBeGreaterThan(10);
    expect(preset.measurable.length).toBeGreaterThan(10);
  }
});
