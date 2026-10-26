/** Clipboard helpers and the plain-text result summary. */

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the textarea method */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

export interface SummaryInput {
  displayHz: number | null;
  note: { name: string; cents: number } | null;
  target: number | null;
  tol: number | null;
  verdict: string;
  pct10: string;
  pctAll: string;
  url: string;
}

export function summaryText(input: SummaryInput): string {
  if (input.displayHz == null) {
    return `Frequency Lab · no signal detected${input.target != null ? ` at ${input.target} Hz` : ''}.`;
  }
  const note = input.note
    ? ` (${input.note.name}, ${input.note.cents >= 0 ? '+' : ''}${input.note.cents.toFixed(1)} cents)`
    : '';
  const target =
    input.target != null
      ? ` Target ${input.target} Hz ±${input.tol} Hz: ${input.verdict}, ${input.pct10} of the last 10 s, ${input.pctAll} of the session.`
      : '';
  return `Frequency Lab · ${input.displayHz.toFixed(2)} Hz${note}.${target} ${input.url}`;
}
