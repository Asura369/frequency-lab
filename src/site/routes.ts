/**
 * Route manifest: single source for page metadata, navigation state, the
 * sitemap and (later) the report renderer. Imported by the build only.
 */

export interface GuideMeta {
  slug: string;
  title: string;
  description: string;
  minutes: number;
  presetHz?: number;
}

export const GUIDES: GuideMeta[] = [
  {
    slug: 'why-loudest-peak-isnt-pitch',
    title: 'Why the loudest frequency is not the pitch',
    description:
      'Harmonics, chords and the 0.68 s analysis window: what a spectrum peak actually tells you about a note, and when it misleads you.',
    minutes: 7,
  },
  {
    slug: 'verify-432-vs-440',
    title: 'How to verify 432 Hz vs 440 Hz',
    description:
      'Cents, A4 reference and resampling artefacts. A practical check for a track that claims to be tuned to 432 Hz.',
    minutes: 6,
    presetHz: 432,
  },
  {
    slug: 'check-a-song-or-video-at-528-hz',
    title: 'How to check a song or video at 528 Hz',
    description:
      'A step-by-step verification: load the file, set the target, read the evidence percentage, and understand what the number does not prove.',
    minutes: 7,
    presetHz: 528,
  },
  {
    slug: 'solfeggio-frequencies-what-can-be-measured',
    title: 'Solfeggio frequencies: what can actually be measured',
    description:
      '174, 285, 396, 417, 528, 639, 741, 852, 963 Hz — which claims are testable with a spectrum, which are not, and why the tool stays quiet about the rest.',
    minutes: 8,
  },
  {
    slug: 'find-mains-hum-50-60-hz',
    title: 'Finding 50/60 Hz mains hum in a recording',
    description:
      'Hum, its harmonics, and the difference between a recording problem and a room problem. How to spot mains interference on a spectrogram.',
    minutes: 5,
  },
  {
    slug: 'binaural-beats-what-you-can-measure',
    title: 'Binaural beats: what you can and cannot measure',
    description:
      'Carrier versus beat frequency, why 1.46 Hz resolution matters, and what a spectrum can honestly show about a binaural track.',
    minutes: 6,
  },
];

export interface RouteMeta {
  path: string;
  file: string;
  title: string;
  description: string;
  nav?: 'lab' | 'guides' | 'presets' | 'how';
  sitemap?: boolean;
  jsonLd?: 'home' | 'article';
  ogType?: 'website' | 'article';
}

const SITE_NAME = 'Frequency Lab';
const HOME_DESCRIPTION =
  'Verify whether a track, video or room is really at the frequency it claims. Local-first spectrum, spectrogram and target evidence — nothing is uploaded.';

export const ROUTES: RouteMeta[] = [
  {
    path: '/',
    file: 'index.html',
    title: `${SITE_NAME} — is it really at that frequency?`,
    description: HOME_DESCRIPTION,
    sitemap: true,
    jsonLd: 'home',
    ogType: 'website',
  },
  {
    path: '/app/',
    file: 'app/index.html',
    title: `Workbench — ${SITE_NAME}`,
    description:
      'Microphone, tab audio or a local file. Measure dominant peaks, a note and cents value, a scrolling spectrogram, and the share of time a target frequency is present.',
    nav: 'lab',
    sitemap: true,
    ogType: 'website',
  },
  {
    path: '/how-it-works/',
    file: 'how-it-works/index.html',
    title: `How the measurement works — ${SITE_NAME}`,
    description:
      'FFT size, window length, noise floor, prominence thresholds and the definition of target evidence — including the limits of what a spectrum can prove.',
    nav: 'how',
    sitemap: true,
    ogType: 'article',
  },
  {
    path: '/presets/',
    file: 'presets/index.html',
    title: `Frequency claims and presets — ${SITE_NAME}`,
    description:
      'A measured look at 432, 440, 528 and the other common frequency claims, with a one-click target for each that the tool can actually test.',
    nav: 'presets',
    sitemap: true,
    ogType: 'article',
  },
  {
    path: '/guides/',
    file: 'guides/index.html',
    title: `Guides — ${SITE_NAME}`,
    description:
      'Practical explanations of spectra, tuning, hum and binaural beats, written to match what the tool can and cannot measure.',
    nav: 'guides',
    sitemap: true,
    ogType: 'website',
  },
  ...GUIDES.map<RouteMeta>((guide) => ({
    path: `/guides/${guide.slug}/`,
    file: `guides/${guide.slug}/index.html`,
    title: `${guide.title} — ${SITE_NAME}`,
    description: guide.description,
    nav: 'guides',
    sitemap: true,
    jsonLd: 'article',
    ogType: 'article',
  })),
  {
    path: '/offline/',
    file: 'offline/index.html',
    title: `Offline edition — ${SITE_NAME}`,
    description:
      'Download Frequency Lab as one self-contained HTML file. It works with no network, no install and no account.',
    sitemap: true,
    ogType: 'website',
  },
  {
    path: '/privacy/',
    file: 'privacy/index.html',
    title: `Privacy — ${SITE_NAME}`,
    description:
      'Audio is analysed in your browser and never uploaded. No accounts, no cookies, no third-party scripts.',
    sitemap: true,
    ogType: 'article',
  },
  {
    path: '/404.html',
    file: '404.html',
    title: `Page not found — ${SITE_NAME}`,
    description: 'That page does not exist. Open the workbench or browse the guides.',
  },
];

export const SITE_URL = (process.env.SITE_URL || 'https://frequencylab.example').replace(
  /\/+$/,
  ''
);
