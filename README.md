# Song Pit (`ampache-plugin-song-pit`)

Song Pit is a magic-link upload path for music libraries. Someone with a maintainer-issued link opens a time-limited URL, reviews tags and buckets in the browser, and uploads audio only into a staging directory you align with your Ampache upload catalog (or a sync target). An Ampache plugin adds a home-page shortcut for admins.

The UI follows Material You–style cues (rounded surfaces, expressive color), inspired by [Power Ampache 2](https://github.com/icefields/Power-Ampache-2), without reusing third-party assets.

## Components

| Path | Role |
|------|------|
| [`packages/ampache-song-pit/AmpacheSongPit.php`](packages/ampache-song-pit/AmpacheSongPit.php) | Ampache plugin (copy into `src/Plugin/`). |
| [`services/songpit-api/`](services/songpit-api/) | Node Fastify API: signed upload tokens, staging writes, static SPA under `/app/`. |
| [`web/songpit-upload/`](web/songpit-upload/) | Svelte 5 + Vite SPA; `npm run build` writes to `services/songpit-api/web-dist/` (generated — not committed). |

## Quick start (companion API)

1. Copy [`services/songpit-api/.env.example`](services/songpit-api/.env.example) to `services/songpit-api/.env` and set:

   - `SONGPIT_JWT_SECRET` — long random string used to sign upload tokens.
   - `SONGPIT_API_KEY` — secret for `POST /v1/shares` (maintainers only).
   - `SONGPIT_STAGING_ROOT` — absolute path where drops are written (for example `/var/lib/songpit/staging`). The process must be able to create directories and files here.
   - `SONGPIT_SPA_PUBLIC_URL` — public base URL of the SPA including `/app`, for example `https://music.example.com/app`.

2. Build the upload UI (required before `/app/` serves anything; re-run after SPA changes):

   ```bash
   cd web/songpit-upload
   npm install
   npm run build
   ```

3. Install and start the API:

   ```bash
   cd services/songpit-api
   npm install
   npm start
   ```

   The API creates `services/songpit-api/web-dist/` if needed; until step 2 has produced files there, `/app/` will be empty (health and upload endpoints still work).

4. Create a share (maintainer):

   ```bash
   curl -s -X POST https://your-host/v1/shares \
     -H "Authorization: Bearer $SONGPIT_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"maxBytes":500000000,"maxFiles":200,"expiresInHours":24,"password":"optional"}'
   ```

   Use the returned `spaUrl`, or pass `token` in the hash: `/#/?token=...`.

5. **API surface**

   - `GET /health` — liveness.
   - `POST /v1/shares` — Bearer `SONGPIT_API_KEY`; returns a JWT and `spaUrl`.
   - `GET /v1/session` — Bearer upload JWT; returns limits and usage so far.
   - `POST /v1/upload` — `multipart/form-data` with `file` (required), optional `password`, and optional fields `title`, `artist`, `album`, `trackNumber`, `bucket`. For MP3, ID3v2 tags are embedded from those fields (`node-id3`). Other extensions are stored as-is; when there is metadata or a bucket, a `.songpit-meta.json` sidecar sits next to the audio file (same basename). `bucket` is sanitized and becomes a subdirectory under the share’s drop folder (default `Inbox`). If the same filename is uploaded twice in one bucket, the API adds `_1`, `_2`, … before the extension instead of overwriting.

Uploads are gated by extension, magic-byte sniffing (including ADTS-style AAC when the file is named `.aac`), per-token byte and file caps, a global rate limit, and a stricter limit on `POST /v1/upload`. Usage totals are updated under an in-process mutex (fine for a single Node worker; use one process or external coordination if you scale horizontally). This does not replace antivirus or legal review — see **Threat model** below.

6. **Tests** (API + PHP syntax):

   ```bash
   cd services/songpit-api
   npm test
   npm run test:php
   ```

   Integration tests use a small CC0 MP3 in [`services/songpit-api/test/fixtures/cc0/`](services/songpit-api/test/fixtures/cc0/) (Freesound preview surfaced via Openverse; see the README there for attribution). They cover multipart upload, ID3 embedding, `.songpit-meta.json` sidecars, bucket directories, duplicate-safe filenames, and byte counts on disk.

## GitHub Pages (static UI demo)

The upload SPA can be published as a **static demo** (tagging UI only; uploads need your API). On push to `main`, [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) builds with `PAGES_BUILD=1`, `VITE_STATIC_DEMO=true`, and `BASE_PATH=/<repository-name>/`, then deploys to GitHub Pages.

1. In the repo **Settings → Pages**, set **Source** to **GitHub Actions** (first-time setup).
2. After the workflow runs, open `https://<user>.github.io/<repo>/` and use **Try the static demo** (`#/?demo=1`) to browse the UI without a backend.

To build locally (replace the path if your fork uses a different repo name):

```bash
cd web/songpit-upload
BASE_PATH=/ampache-plugin-song-pit/ npm run build:pages
```

Serving `dist/` locally: `npx serve dist` (or any static server) at the same `BASE_PATH` prefix.

If you host the SPA separately from the API, set **`VITE_API_BASE_URL`** at build time to your API origin (for example `https://music.example.com`) and enable **CORS** on the Fastify service for your Pages origin.

## Ampache integration

1. Install the plugin as `src/Plugin/AmpacheSongPit.php` (see [`packages/ampache-song-pit/INSTALL.md`](packages/ampache-song-pit/INSTALL.md)).
2. Enable Song Pit in Ampache and set **Song Pit companion base URL** to the API origin (for example `https://music.example.com` — no trailing path; the plugin links to `/`, which redirects to `/app/`).
3. Configure an [upload catalog](https://www.ampache.org/docs/help/upload-catalogs) and point `SONGPIT_STAGING_ROOT` at that catalog’s filesystem (or sync into it).
4. After files land on disk, run a catalog update the way you usually do (web admin or Ampache CLI). Exact steps depend on your Ampache version.

## Reverse proxy (TLS)

Terminate HTTPS at nginx or Caddy and proxy to the Node process:

- Proxy `/`, `/app/`, `/v1/`, `/health` to the same upstream.
- Avoid exposing `POST /v1/shares` to the open internet without extra network controls if you can help it — the API key in `Authorization` only protects you if the channel is trusted.

Example (nginx sketch):

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

## Threat model

- Treat share URLs and upload JWTs like passwords: anyone with the link can upload within the token’s limits until it expires.
- Use HTTPS for links and API traffic.
- Rotate `SONGPIT_API_KEY` when needed. Old tokens cannot be centrally revoked in this milestone (stateless JWTs); issuing shorter-lived shares is the practical mitigation.
- Plan ClamAV or another scanner on the staging path before you treat that tree as fully trusted.

## ROADMAP (Milestone 2)

**Explicitly out of scope:** no Nextcloud app, no Nextcloud plugin, and no workflow whose goal is to push tracks into Nextcloud. Song Pit stays focused on Ampache plus this companion API.

Planned directions:

- Tagging beyond MP3: optional ffmpeg-based embedding for FLAC/M4A/OGG, or richer non-MP3 tag handling (today: sidecar JSON plus ID3 for `.mp3`).
- Stronger multi-instance usage accounting (for example SQLite or Redis) if you run multiple Node workers; optional JWT denylist for leaked tokens.
- Malware and review: ClamAV (or similar) on the staging directory and a human review queue without tying that to Nextcloud — filesystem workflows or a small standalone UI if needed.
- Agents: OpenClaw + Ollama for maintainer helpers (tag cleanup, import summaries, duplicate hints).
- Duplicate detection: AcoustID / Chromaprint-style checks against your library via Ampache’s API or DB — not P2P tooling by default.
- Optional Soulseek CLI only with a clear legal and ops story; not a core dependency.

## License

Pick a license when you publish (for example AGPL-3.0 if you need to align with Ampache for linked derivatives — get legal advice for your situation).
