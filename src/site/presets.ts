/**
 * Frequency claims, in one place: the workbench chips and the presets page are
 * generated from this list, so the two can never drift apart.
 */

export type PresetGroup = 'reference' | 'solfeggio' | 'other';

export interface Preset {
  hz: number;
  label: string;
  claim: string;
  /** What the workbench can actually show for this number. */
  measurable: string;
  caveat: string;
  group: PresetGroup;
  inApp: boolean;
}

export const PRESETS: Preset[] = [
  {
    hz: 440,
    label: 'Standard pitch',
    claim: 'The ISO concert pitch for A4 since the 20th century.',
    measurable: 'Whether a reference tone or tuned track sits at 440 Hz (A4, 0 cents).',
    caveat: 'Music tuned to 440 can still contain any other frequency; this checks the reference, not the whole mix.',
    group: 'reference',
    inApp: true,
  },
  {
    hz: 432,
    label: '432 tuning',
    claim: 'Often called “Verdi tuning” or “natural tuning”; claimed to sound calmer than 440.',
    measurable: 'The fundamental of a steady tone, and whether it is 31.8 cents below A4 = 440.',
    caveat: 'Whether a track is “in 432” is a tuning decision, not a measurable health effect. Retuned files can also shift artefacts.',
    group: 'reference',
    inApp: true,
  },
  {
    hz: 174,
    label: 'Solfeggio',
    claim: 'Associated with pain relief and “foundation” in solfeggio literature.',
    measurable: 'Whether a tone at 174 Hz is present and how consistently.',
    caveat: 'No controlled evidence links this frequency to a physiological effect; the measurement only proves the tone.',
    group: 'solfeggio',
    inApp: true,
  },
  {
    hz: 285,
    label: 'Solfeggio',
    claim: 'Claimed to support tissue repair and “quantum cognition”.',
    measurable: 'Presence, level and stability of a 285 Hz component.',
    caveat: 'The biological claims are not supported by controlled studies. A spectrum cannot test them.',
    group: 'solfeggio',
    inApp: true,
  },
  {
    hz: 396,
    label: 'Solfeggio',
    claim: '“Liberating guilt and fear” in popular solfeggio writing.',
    measurable: 'A 396 Hz tone, its harmonics and its share of signal time.',
    caveat: 'Emotional claims are untestable here and unproven clinically.',
    group: 'solfeggio',
    inApp: true,
  },
  {
    hz: 417,
    label: 'Solfeggio',
    claim: 'Claimed to “undo situations” and facilitate change.',
    measurable: 'A 417 Hz tone and its prominence above the noise floor.',
    caveat: 'The claim is symbolic; the tool can only confirm the tone exists.',
    group: 'solfeggio',
    inApp: true,
  },
  {
    hz: 528,
    label: 'Solfeggio',
    claim: 'The “miracle tone”, widely claimed to repair DNA and restore harmony.',
    measurable: 'Whether 528 Hz is actually present, at what level, and for what share of a track.',
    caveat: 'DNA repair claims are not supported by evidence. A high percentage means a tone-like peak, not a biological effect.',
    group: 'solfeggio',
    inApp: true,
  },
  {
    hz: 639,
    label: 'Solfeggio',
    claim: 'Associated with relationships and “connecting”.',
    measurable: 'A 639 Hz component and its consistency over time.',
    caveat: 'Interpersonal claims are not measurable with a spectrum.',
    group: 'solfeggio',
    inApp: true,
  },
  {
    hz: 741,
    label: 'Solfeggio',
    claim: 'Claimed to “cleanse” and support expression.',
    measurable: 'A 741 Hz component, its harmonics and stability.',
    caveat: 'The claimed effects are not established; only the acoustic presence is testable.',
    group: 'solfeggio',
    inApp: true,
  },
  {
    hz: 852,
    label: 'Solfeggio',
    claim: 'Linked to intuition and spiritual order.',
    measurable: 'An 852 Hz component and its share of signal time.',
    caveat: 'No controlled evidence for the claimed effects; the number is measurable, the meaning is not.',
    group: 'solfeggio',
    inApp: true,
  },
  {
    hz: 963,
    label: 'Solfeggio',
    claim: 'The highest common solfeggio tone, linked to “oneness”.',
    measurable: 'A 963 Hz tone and whether it dominates the spectrum.',
    caveat: 'A real tone at 963 Hz proves nothing beyond the tone itself.',
    group: 'solfeggio',
    inApp: true,
  },
  {
    hz: 40,
    label: 'Gamma carrier',
    claim: 'Used as a carrier for 40 Hz binaural and amplitude-modulated protocols.',
    measurable: 'The 40 Hz carrier and its sidebands, if the modulation is deep enough.',
    caveat: 'A carrier at 40 Hz is not the same as a 40 Hz beat; the beat needs two tones about 40 Hz apart.',
    group: 'other',
    inApp: false,
  },
  {
    hz: 60,
    label: 'Mains hum (US)',
    claim: 'Not a wellness frequency — the power-grid fundamental in North America.',
    measurable: 'A 60 Hz peak and its harmonics, a common sign of ground loops or cable pickup.',
    caveat: 'Hum can enter before or after the recording; the spectrum shows it is there, not where it came from.',
    group: 'other',
    inApp: false,
  },
  {
    hz: 50,
    label: 'Mains hum (EU)',
    claim: 'The power-grid fundamental in most of the world outside North America.',
    measurable: 'A 50 Hz peak and harmonics at 100, 150, 200 Hz.',
    caveat: 'Airplane and ship power can differ; check the local grid before blaming the file.',
    group: 'other',
    inApp: false,
  },
  {
    hz: 7.83,
    label: 'Schumann resonance',
    claim: 'The Earth-ionosphere cavity’s fundamental, popular in meditation content.',
    measurable: 'Not measurable here: the workbench floor is 20 Hz and consumer microphones roll off far above 8 Hz.',
    caveat: 'The number is real in geophysics; it is not a frequency a laptop can reliably capture from speakers or air.',
    group: 'other',
    inApp: false,
  },
];

export const APP_PRESETS = PRESETS.filter((preset) => preset.inApp);
