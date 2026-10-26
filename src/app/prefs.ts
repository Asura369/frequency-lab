/** Small, versioned preferences. Never stores audio or personal data. */

export type Palette = 'studio' | 'contrast';

export interface Prefs {
  targetHz: number | null;
  tolHz: number | null;
  palette: Palette;
}

const KEY = 'freqlab.settings.v1';

export const DEFAULT_PREFS: Prefs = {
  targetHz: null,
  tolHz: null,
  palette: 'studio',
};

export function loadPrefs(): Prefs {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const target =
      typeof parsed.targetHz === 'number' && Number.isFinite(parsed.targetHz)
        ? parsed.targetHz
        : null;
    const tol =
      typeof parsed.tolHz === 'number' && Number.isFinite(parsed.tolHz) ? parsed.tolHz : null;
    const palette: Palette = parsed.palette === 'contrast' ? 'contrast' : 'studio';
    return { targetHz: target, tolHz: tol, palette };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage can be disabled; preferences simply do not persist */
  }
}
