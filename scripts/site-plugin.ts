/**
 * Build-time glue: injects shared chrome and page metadata, writes the
 * sitemap/robots, and inlines the workbench markup into both the app page and
 * the standalone build.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { ROUTES, type RouteMeta } from '../src/site/routes.ts';
import {
  renderFooter,
  renderGuideCards,
  renderHead,
  renderNav,
  renderPresetTable,
  robots,
  sitemap,
} from '../src/site/chrome.ts';

const VIEW_PATH = path.resolve('src/app/view.html');

function routeFor(filename: string | undefined, urlPath: string): RouteMeta | undefined {
  if (filename) {
    const relative = path.relative(process.cwd(), filename).split(path.sep).join('/');
    const match = ROUTES.find((route) => route.file === relative);
    if (match) return match;
  }
  const trailing = urlPath.endsWith('/') ? urlPath : `${urlPath}/`;
  return (
    ROUTES.find((route) => route.path === urlPath || route.path === trailing) ||
    ROUTES.find((route) => route.path === '/404.html' && urlPath.includes('404'))
  );
}

export function appView(): Plugin {
  return {
    name: 'freqlab-app-view',
    transformIndexHtml(html) {
      if (!html.includes('<!-- APP:VIEW -->')) return html;
      const view = readFileSync(VIEW_PATH, 'utf8');
      return html.replace('<!-- APP:VIEW -->', view);
    },
  };
}

export function siteLayout(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'freqlab-site-layout',
    configResolved(resolved) {
      config = resolved;
    },
    transformIndexHtml(html, ctx) {
      const route = routeFor(ctx.filename, ctx.path);
      if (!route) return html;
      return html
        .replace('<!-- SITE:HEAD -->', renderHead(route))
        .replace('<!-- SITE:NAV -->', renderNav(route.nav))
        .replace('<!-- SITE:FOOTER -->', renderFooter())
        .replace('<!-- PRESETS:TABLE -->', renderPresetTable())
        .replace('<!-- GUIDES:LIST -->', renderGuideCards());
    },
    closeBundle() {
      const outDir = path.resolve(config.root, config.build.outDir);
      writeFileSync(path.join(outDir, 'sitemap.xml'), sitemap());
      writeFileSync(path.join(outDir, 'robots.txt'), robots());
    },
  };
}

export function pageInputs(): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const route of ROUTES) {
    const key =
      route.path === '/'
        ? 'home'
        : route.path.replace(/^\//, '').replace(/\/$/, '').replace(/[./]/g, '-') || 'home';
    inputs[key] = route.file;
  }
  return inputs;
}


export function serviceWorker(): Plugin {
  return {
    name: 'freqlab-service-worker',
    apply: 'build',
    closeBundle() {
      const template = readFileSync(path.resolve('src/sw-template.js'), 'utf8');
      const assetsDir = path.resolve('dist/assets');
      const assets = readdirSync(assetsDir).map((file) => `/assets/${file}`);
      const shell = [
        ...assets,
        '/',
        '/app/',
        '/guides/',
        '/presets/',
        '/how-it-works/',
        '/offline/',
        '/privacy/',
        '/manifest.webmanifest',
        '/favicon.svg',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
      ];
      const version = Date.now().toString(36);
      const source = template
        .replace('__VERSION__', version)
        .replace('__SHELL__', JSON.stringify(shell));
      writeFileSync(path.resolve('dist/sw.js'), source);
    },
  };
}
