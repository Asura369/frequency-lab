import { test, expect } from 'vitest';
import { parseUrlState } from '../src/app/url-state';

test('parses target, tolerance and demo', () => {
  const state = parseUrlState('?t=528&tol=2.5&demo=432');
  expect(state).toEqual({ targetHz: 528, tolHz: 2.5, demoHz: 432, embed: false });
});

test('ignores missing and malformed values', () => {
  expect(parseUrlState('?t=abc&tol=xyz&demo=nan')).toEqual({
    targetHz: null,
    tolHz: null,
    demoHz: null,
    embed: false,
  });
});

test('rejects out-of-range targets and tolerances', () => {
  expect(parseUrlState('?t=25000&tol=100').targetHz).toBeNull();
  expect(parseUrlState('?t=19.9').targetHz).toBeNull();
  expect(parseUrlState('?t=19.9').tolHz).toBeNull();
  expect(parseUrlState('?tol=0.05').tolHz).toBeNull();
});

test('accepts the documented boundaries', () => {
  expect(parseUrlState('?t=20&tol=0.1').targetHz).toBe(20);
  expect(parseUrlState('?t=20000&tol=50').targetHz).toBe(20000);
});

test('embed flag is explicit', () => {
  expect(parseUrlState('?embed=1').embed).toBe(true);
  expect(parseUrlState('?embed=true').embed).toBe(false);
});
