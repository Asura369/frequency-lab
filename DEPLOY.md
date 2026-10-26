# Deploying Frequency Lab

The site is plain static output: `npm run build` writes `dist/`. Any static host
works; the instructions below use Cloudflare Pages because it can build from a
private repository, gives preview URLs per pull request, and honours the
`_headers` / `_redirects` files in `public/`.

## 1. Push the repository

The repository can stay private. Create it on GitHub and push `main`:

```sh
git remote add origin git@github.com:<you>/frequency-lab.git
git push -u origin main
```

## 2. Create the Cloudflare Pages project

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Install the Cloudflare GitHub app for the repository.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Node version:** 22 (set `NODE_VERSION=22` as an environment variable if the default differs)
4. Environment variable: `SITE_URL` = `https://<your-domain>` (no trailing slash).
   This is used for canonical URLs, Open Graph tags, the sitemap and `robots.txt`.
   Without it the build falls back to `https://frequencylab.example`.
5. Deploy. Every branch and pull request gets a preview URL.

## 3. Attach the domain

1. Pages project → **Custom domains** → add the apex and/or `www`.
2. Follow the DNS instructions. Cloudflare terminates TLS; enable **Always Use HTTPS**.
3. Re-deploy after adding the domain so `SITE_URL` matches the canonical host.

## 4. What is deployed

- `/` landing page, `/app/` workbench, `/guides/` and six articles, `/presets/`,
  `/how-it-works/`, `/offline/`, `/privacy/`, `/404.html`.
- `sitemap.xml` and `robots.txt` are generated at build time from the route
  manifest (`src/site/routes.ts`).
- `_headers` sets CSP, Permissions-Policy, cross-origin policy and cache rules.
- `_redirects` keeps old links (`/frequency-lab.html` → `/app/`) working.
- `sw.js` and `manifest.webmanifest` make the workbench installable and offline.
- `/download/frequency-lab.html` is the single-file offline edition.

## 5. Post-deploy checks

```sh
curl -sI https://<domain>/app/ | grep -i content-security-policy
curl -s https://<domain>/sitemap.xml | head
```

Then in a browser:

1. Run the self-test on `/app/`.
2. Reload once, stop the network, reload again: the workbench should still load.
3. Open `/offline/`, download the file, open it from disk with no network.
4. Check the console for CSP violations; there should be none.

## Rollback

Pages keeps every deployment. Use **Deployments → … → Rollback** to return to a
previous build; no database or server state is involved.
