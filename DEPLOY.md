# Deploying Frequency Lab

The site is static output: `npm run build` writes `dist/`. This deployment uses
**Cloudflare Workers with static assets**, built from the private GitHub
repository by Workers Builds. The repository ships `wrangler.toml`, which is
what controls routing (including the 404 page) and the asset directory.

A custom domain is optional. The `workers.dev` hostname is HTTPS-enabled, serves
the PWA and works with search engines; you can add a domain later, at the cost
of resetting installed PWAs and caches for the old origin.

## 1. Build settings (one-time)

Cloudflare dashboard → **Workers & Pages** → your Worker → **Settings → Build**.

| Setting | Value |
| --- | --- |
| Root directory | `/` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Node version | 22 (`NODE_VERSION=22` if the default differs) |

Environment variable (build time, **not** runtime):

```text
SITE_URL = https://frequency-lab.endless9.workers.dev
```

`SITE_URL` is read by `src/site/routes.ts` during the build and written into
canonical tags, Open Graph, `sitemap.xml` and `robots.txt`. Without it the build
falls back to `https://frequencylab.example`.

Do not put `SITE_URL` in `[vars]` in `wrangler.toml`; that is a runtime variable
and will not affect the build.

## 2. What `wrangler.toml` controls

```toml
name = "frequency-lab"
compatibility_date = "2026-10-26"

[assets]
directory = "./dist"
not_found_handling = "404-page"
```

- `assets.directory` tells Wrangler to upload `dist/` as static assets.
- `not_found_handling = "404-page"` serves the nearest `404.html` with status
  **404** for unknown paths. This is **not** a dashboard toggle; it lives in the
  Wrangler config file.
- `_headers` and `_redirects` in `public/` are copied into `dist/` and applied
  by Workers static assets.

If the dashboard deploy command already passes `--assets ./dist`, remove that
flag and let `wrangler.toml` provide the configuration, otherwise the 404
setting can be bypassed.

## 3. Deploy

Push to `main`; Workers Builds rebuilds and deploys the Worker.

```sh
git push
```

Manual deploy:

```sh
SITE_URL=https://frequency-lab.endless9.workers.dev npm run build
npx wrangler deploy
```

## 4. Verify production

```sh
# 404 page and status
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/nope/        # 404
curl -s https://<host>/nope/ | grep -o '<title>[^<]*</title>'

# canonical and sitemap match SITE_URL
curl -s https://<host>/ | grep -o '<link rel="canonical"[^>]*>'
curl -s https://<host>/sitemap.xml | head -4

# headers and redirects
curl -sI https://<host>/app/ | grep -iE 'content-security-policy|permissions-policy'
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://<host>/frequency-lab.html
```

In a browser: run the self-test (it is audible now), check the in-band peak line
on a request, reload with the network off, and open the downloaded
`/download/frequency-lab.html` from disk.

## 5. Custom domain (optional)

1. Buy or delegate a domain to Cloudflare.
2. Worker → **Settings → Domains & Routes** → **Add custom domain**.
3. Change `SITE_URL` to the new origin, then redeploy.
4. Keep the old `workers.dev` URL working; it is not redirected automatically.
   Add a redirect Worker/route if you want one canonical host.

Changing the origin resets service-worker caches and installed PWAs, so do it
before you promote the site widely.

## 6. Rollback

Worker → **Deployments** → choose a previous version → **Rollback**. Static
assets and the Worker version move together; there is no database or server
state to restore.

## Alternative: Cloudflare Pages

Pages also works: build `npm run build`, output `dist`, set `SITE_URL`, and add
a `404.html`. Pages reads `_headers` / `_redirects` too, but Workers Builds is
what this repository is configured for.
