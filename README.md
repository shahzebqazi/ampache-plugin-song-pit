<!-- Song Pit — README uses artwork from Power Ampache 2 (GPL-3.0); UI theme from PowerAmpache2Theme. -->

<h1 align="center">Song Pit</h1>

<p align="center">
  <strong>Magic-link uploads for Ampache libraries</strong><br />
  <sub>Time-limited links · browser tagging · staged drops · <a href="https://github.com/icefields/PowerAmpache2Theme">PowerAmpache2Theme</a>-styled UI</sub>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-1b6b6b?style=flat-square" alt="AGPL-3.0" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-70cccc?style=flat-square&logo=node.js&logoColor=122e2e" alt="Node 20+" />
  <img src="https://img.shields.io/badge/Svelte-5-ff3e00?style=flat-square&logo=svelte&logoColor=white" alt="Svelte 5" />
</p>

---

### What it does

Maintainers mint **signed upload tokens**; recipients open a **SPA** in the browser, fix tags and **buckets**, and upload **audio only** into a **staging directory** you point at an [Ampache upload catalog](https://www.ampache.org/docs/help/upload-catalogs) (or a sync target). An **Ampache plugin** adds a home shortcut for admins and an optional **search-footer link** when a catalog search is empty or on the last page of results.

The upload UI uses **[PowerAmpache2Theme](https://github.com/icefields/PowerAmpache2Theme)** color tokens (light/dark) and **Nunito**; artwork is from **[Power Ampache 2](https://github.com/icefields/Power-Ampache-2)** — see [`web/songpit-upload/public/pa2/CREDITS.txt`](web/songpit-upload/public/pa2/CREDITS.txt). The matrix backdrop runs through a small **WebGL CRT-style shader** (scanlines, barrel curve, vignette) with a CSS fallback.

---

### Repository layout

| Path | Role |
|------|------|
| [`packages/ampache-song-pit/AmpacheSongPit.php`](packages/ampache-song-pit/AmpacheSongPit.php) | Ampache plugin — copy into `src/Plugin/` (and register in `PluginEnum` if needed). |
| [`services/songpit-api/`](services/songpit-api/) | **Node** (Fastify): JWT shares, staging writes, static SPA at `/app/`. |
| [`web/songpit-upload/`](web/songpit-upload/) | **Svelte 5** + Vite; `npm run build` outputs to `services/songpit-api/web-dist/` (generated, not committed). |

---

### Quick start (companion API)

1. Copy [`services/songpit-api/.env.example`](services/songpit-api/.env.example) → `services/songpit-api/.env` and set:

   | Variable | Purpose |
   |----------|---------|
   | `SONGPIT_JWT_SECRET` | Secret for signing upload JWTs |
   | `SONGPIT_API_KEY` | Maintainer key for `POST /v1/shares` |
   | `SONGPIT_STAGING_ROOT` | Writable absolute path for staged files (e.g. `/var/lib/songpit/staging`) |
   | `SONGPIT_SPA_PUBLIC_URL` | Public SPA URL including `/app`, e.g. `https://music.example.com/app` |

2. **Build the SPA** (required before `/app/` serves UI; re-run after frontend changes):

   ```bash
   cd web/songpit-upload
   npm install
   npm run build
   ```

3. **Run the API**:

   ```bash
   cd services/songpit-api
   npm install
   npm start
   ```

   `web-dist/` is created if missing; until the SPA is built, `/app/` is empty while `/health` and `/v1/*` still work.

4. **Create a share** (maintainer):

   ```bash
   curl -s -X POST https://your-host/v1/shares \
     -H "Authorization: Bearer $SONGPIT_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"maxBytes":500000000,"maxFiles":200,"expiresInHours":24,"password":"optional"}'
   ```

   Use `spaUrl`, or open `/#/?token=…` with the returned JWT.

---

### HTTP API (summary)

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/health` | Liveness |
| `POST` | `/v1/shares` | Bearer `SONGPIT_API_KEY` — returns JWT + `spaUrl` |
| `GET` | `/v1/session` | Bearer upload JWT — limits & usage |
| `POST` | `/v1/upload` | Multipart `file`, optional `password`, `title`, `artist`, `album`, `trackNumber`, `bucket` |

MP3s get **ID3** from those fields; other types may use a **`.songpit-meta.json`** sidecar. `bucket` becomes a sanitized subdirectory (default `Inbox`); duplicate filenames get `_1`, `_2`, …

Uploads are filtered by extension and **magic-byte** sniffing, with per-token caps and rate limits. Usage is tracked in-process (single Node worker is assumed; scale-out needs coordination). This is **not** a substitute for antivirus or legal review — see **Threat model** below.

---

### Tests & CI

```bash
cd services/songpit-api && npm test && npm run test:php
cd web/songpit-upload && npm run check
```

CI on `main` / PRs runs API tests, PHP lint, `svelte-check`, and a production SPA build. Integration tests use a small CC0 MP3 under [`services/songpit-api/test/fixtures/cc0/`](services/songpit-api/test/fixtures/cc0/).

---

### GitHub Pages (static demo)

The SPA can be built as a **UI-only** demo (`VITE_STATIC_DEMO=true`). Workflow: [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml).

1. **Settings → Pages → Source: GitHub Actions**
2. After deploy, open the Pages URL and append **`#/?demo=1`** to try the UI without a backend.

| Hosting | Notes |
|---------|--------|
| Default `github.io/<repo>/` | Workflow sets `BASE_PATH=/<repo>/` |
| Custom domain at **domain root** | Set repo variable `GITHUB_PAGES_NEST_UNDER_REPO=true` if you need the app under `https://domain/<repo>/` |
| Separate API origin | Build with `VITE_API_BASE_URL` and enable **CORS** on Fastify for your Pages origin |

Local Pages build (matches CI defaults):

```bash
cd web/songpit-upload
BASE_PATH=/ampache-plugin-song-pit/ npm run build:pages
```

Nested layout for local preview:

```bash
mkdir -p /tmp/songpit-site/ampache-plugin-song-pit
cp -r dist/. /tmp/songpit-site/ampache-plugin-song-pit/
npx serve /tmp/songpit-site
```

---

### Ampache

1. Install [`packages/ampache-song-pit/AmpacheSongPit.php`](packages/ampache-song-pit/AmpacheSongPit.php) — details in [`packages/ampache-song-pit/INSTALL.md`](packages/ampache-song-pit/INSTALL.md).
2. Enable **Song Pit** and set **Song Pit companion base URL** to the API origin (no trailing path; `/` redirects to `/app/`).
3. Point `SONGPIT_STAGING_ROOT` at your upload catalog (or synced path).
4. Run a catalog update after files land.

---

### Reverse proxy (TLS)

Proxy `/`, `/app/`, `/v1/`, `/health` to the Node process. Prefer **not** exposing `POST /v1/shares` broadly without network controls — the API key only helps over a trusted channel.

```nginx
location / {
  proxy_pass http://127.0.0.1:3030;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  client_max_body_size 500M;
}
```

---

### Threat model

- Treat share URLs and JWTs like **passwords**.
- Use **HTTPS** end-to-end.
- Rotate `SONGPIT_API_KEY` when needed; stateless JWTs are not centrally revocable in this milestone — prefer shorter-lived shares.
- Scan staging with **ClamAV** (or similar) before treating files as trusted.

---

### Roadmap (milestone 2)

**Out of scope:** Nextcloud app/plugin or workflows aimed at pushing into Nextcloud.

Possible directions: richer tagging (ffmpeg / sidecars), multi-worker usage store or JWT denylist, staging scanners & review queues, maintainer helpers, duplicate detection via AcoustID/Chromaprint, optional Soulseek CLI with a clear legal story.

---

### License

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). Compatible with Ampache’s copyleft story when distributing combined work; seek legal advice if unsure for your deployment.
