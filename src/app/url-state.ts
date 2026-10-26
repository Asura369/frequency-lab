/** Deep-link handling: ?t=<hz>&tol=<hz>&demo=<hz>&embed=1 */

import { CFG } from './constants';

export interface UrlState {
  targetHz: number | null;
  tolHz: number | null;
  demoHz: number | null;
  embed: boolean;
}

const validHz = (value: number): boolean =>
  Number.isFinite(value) && value >= CFG.MIN_HZ && value <= CFG.MAX_HZ;

const validTol = (value: number): boolean =>
  Number.isFinite(value) && value >= CFG.TOL_MIN && value <= CFG.TOL_MAX;

function numberParam(params: URLSearchParams, name: string): number | null {
  if (!params.has(name)) return null;
  const value = Number.parseFloat(params.get(name) || '');
  return Number.isFinite(value) ? value : null;
}

export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search);
  const target = numberParam(params, 't');
  const tol = numberParam(params, 'tol');
  const demo = numberParam(params, 'demo');
  return {
    targetHz: target != null && validHz(target) ? target : null,
    tolHz: tol != null && validTol(tol) ? tol : null,
    demoHz: demo != null && validHz(demo) ? demo : null,
    embed: params.get('embed') === '1',
  };
}

/** Keep t/tol in the URL so a copied address reproduces the setup. */
export function syncUrl(targetHz: number | null, tolHz: number | null): void {
  try {
    const url = new URL(window.location.href);
    if (targetHz != null && Number.isFinite(targetHz)) {
      url.searchParams.set('t', String(Number(targetHz.toFixed(2))));
    } else {
      url.searchParams.delete('t');
    }
    if (tolHz != null && Number.isFinite(tolHz)) {
      url.searchParams.set('tol', String(Number(tolHz.toFixed(2))));
    } else {
      url.searchParams.delete('tol');
    }
    window.history.replaceState(window.history.state, '', url);
  } catch {
    /* history is unavailable in some embedded contexts */
  }
}

export function clearDemoParam(): void {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('demo')) {
      url.searchParams.delete('demo');
      window.history.replaceState(window.history.state, '', url);
    }
  } catch {
    /* ignore */
  }
}

export function setupLink(targetHz: number | null, tolHz: number | null): string {
  const url = new URL(window.location.href);
  url.searchParams.delete('demo');
  url.searchParams.delete('embed');
  if (targetHz != null) url.searchParams.set('t', String(Number(targetHz.toFixed(2))));
  if (tolHz != null) url.searchParams.set('tol', String(Number(tolHz.toFixed(2))));
  return url.toString();
}
