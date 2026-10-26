/**
 * Shared site chrome, rendered at build time. No client-side JavaScript: the
 * markup ends up in every static page, so navigation works without hydration.
 */

import { GUIDES, ROUTES, SITE_URL, type RouteMeta } from './routes.ts';
import { PRESETS, type PresetGroup } from './presets.ts';

const esc = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const LOGO = `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
<rect width="32" height="32" rx="7" fill="#0b1016"></rect>
<path d="M3 17h6l3-8 4 15 3-7h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
</svg>`;

const NAV_LINKS: Array<{ id: RouteMeta['nav']; href: string; label: string }> = [
  { id: 'lab', href: '/app/', label: 'Workbench' },
  { id: 'guides', href: '/guides/', label: 'Guides' },
  { id: 'presets', href: '/presets/', label: 'Presets' },
  { id: 'how', href: '/how-it-works/', label: 'How it works' },
];

function links(active: RouteMeta['nav']): string {
  return NAV_LINKS.map(
    (link) =>
      `<a href="${link.href}"${link.id === active ? ' aria-current="page"' : ''}>${link.label}</a>`
  ).join('\n        ');
}

export function renderNav(active: RouteMeta['nav']): string {
  return `<a class="skip-link" href="#main">Skip to content</a>
<header class="site-nav">
  <div class="nav-inner">
    <a class="brand" href="/" aria-label="Frequency Lab home">
      ${LOGO}
      <span>Frequency Lab</span>
    </a>
    <nav class="nav-links" aria-label="Primary">
        ${links(active)}
    </nav>
    <a class="nav-cta" href="/app/">Open the lab</a>
    <details class="nav-more">
      <summary>Menu</summary>
      <div class="nav-more-panel">
        ${links(active)}
        <a href="/offline/">Offline edition</a>
        <a href="/privacy/">Privacy</a>
      </div>
    </details>
  </div>
</header>`;
}

export function renderFooter(): string {
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <a class="brand" href="/">${LOGO}<span>Frequency Lab</span></a>
      <p>Local-first frequency verification for tones, tracks and tab audio.</p>
      <p class="footer-privacy">Audio is analysed in your browser and never uploaded. No account, no cookies, no third-party scripts.</p>
    </div>
    <nav class="footer-links" aria-label="Footer">
      <a href="/app/">Workbench</a>
      <a href="/guides/">Guides</a>
      <a href="/presets/">Presets</a>
      <a href="/how-it-works/">How it works</a>
      <a href="/offline/">Offline edition</a>
      <a href="/privacy/">Privacy</a>
    </nav>
  </div>
  <p class="footer-small">© ${year} Frequency Lab · Dominant peaks are not musical pitch; a target verdict is evidence over time, not proof of intent.</p>
</footer>`;
}

function jsonLd(route: RouteMeta): string {
  if (route.jsonLd === 'home') {
    return JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Frequency Lab',
      applicationCategory: 'MultimediaApplication',
      operatingSystem: 'Any modern web browser',
      url: `${SITE_URL}/`,
      description:
        'Local-first spectrum and target-frequency verification for microphone, tab audio and local audio or video files.',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      featureList: [
        'Dominant peak readout with note and cents',
        'Scrolling spectrogram, 20 Hz to 20 kHz',
        'Target-frequency evidence over time',
        'No uploads; analysis runs in the browser',
      ],
    });
  }
  if (route.jsonLd === 'article') {
    return JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: route.title.replace(/ — Frequency Lab$/, ''),
      description: route.description,
      mainEntityOfPage: `${SITE_URL}${route.path}`,
      author: { '@type': 'Organization', name: 'Frequency Lab' },
      publisher: { '@type': 'Organization', name: 'Frequency Lab' },
      dateModified: '2026-10-26',
    });
  }
  return '';
}

export function renderHead(route: RouteMeta): string {
  const url = `${SITE_URL}${route.path}`;
  const image = `${SITE_URL}/og.png`;
  const ld = jsonLd(route);
  return `<title>${esc(route.title)}</title>
<meta name="description" content="${esc(route.description)}">
<link rel="canonical" href="${url}">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#080a0e">
<meta property="og:site_name" content="Frequency Lab">
<meta property="og:type" content="${route.ogType || 'website'}">
<meta property="og:title" content="${esc(route.title)}">
<meta property="og:description" content="${esc(route.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${image}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(route.title)}">
<meta name="twitter:description" content="${esc(route.description)}">
<meta name="twitter:image" content="${image}">
${ld ? `<script type="application/ld+json">${ld}</script>` : ''}`;
}

export function sitemap(): string {
  const today = new Date().toISOString().slice(0, 10);
  const urls = ROUTES.filter((route) => route.sitemap)
    .map(
      (route) =>
        `  <url><loc>${SITE_URL}${route.path}</loc><lastmod>${today}</lastmod></url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function robots(): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`;
}


const GROUP_LABEL: Record<PresetGroup, string> = {
  reference: 'Tuning references',
  solfeggio: 'Solfeggio claims',
  other: 'Other common numbers',
};

export function renderPresetTable(): string {
  const groups: PresetGroup[] = ['reference', 'solfeggio', 'other'];
  const body = groups
    .map((group) => {
      const rows = PRESETS.filter((preset) => preset.group === group)
        .sort((a, b) => a.hz - b.hz)
        .map((preset) => {
          const action = preset.inApp
            ? `<a class="chip" href="/app/?t=${preset.hz}&amp;tol=3">Open at ${preset.hz} Hz</a>`
            : '<span class="tag no">not measurable here</span>';
          return `<tr>
        <td>${preset.hz} Hz<br><span class="guide-meta">${preset.label}</span></td>
        <td>${preset.claim}</td>
        <td>${preset.measurable}</td>
        <td>${preset.caveat}<div class="preset-action">${action}</div></td>
      </tr>`;
        })
        .join('\n');
      return `<tr class="group"><th colspan="4" scope="colgroup">${GROUP_LABEL[group]}</th></tr>\n${rows}`;
    })
    .join('\n');
  return `<table class="claims">
    <thead><tr><th>Frequency</th><th>Common claim</th><th>What can be shown</th><th>Caveat and next step</th></tr></thead>
    <tbody>
${body}
    </tbody>
  </table>`;
}

export function renderGuideCards(): string {
  return GUIDES.map(
    (guide) => `<a class="guide-card" href="/guides/${guide.slug}/">
        <h3>${esc(guide.title)}</h3>
        <p>${esc(guide.description)}</p>
        <span class="guide-meta">${guide.minutes} MIN READ</span>
      </a>`
  ).join('\n');
}
