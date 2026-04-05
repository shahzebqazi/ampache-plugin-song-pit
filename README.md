# Song Pit (`ampache-plugin-song-pit`)

Song Pit is a **magic-link upload pipeline** for music libraries: contributors open a **time-limited URL**, **review and bucket tags in the browser**, then upload **only audio** into a **staging directory** you point at your **Ampache upload catalog** (or a sync path). An **Ampache plugin** adds a maintainer shortcut on the home page when you are an admin.

Design cues follow **Material You** (rounded surfaces, expressive color) inspired by [Power Ampache 2](https://github.com/icefields/Power-Ampache-2) — without copying third-party assets.

## Components

| Path | Role |
|------|------|
| [`packages/ampache-song-pit/AmpacheSongPit.php`](packages/ampache-song-pit/AmpacheSongPit.php) | Ampache plugin (copy into `src/Plugin/`). |
| [`services/songpit-api/`](services/songpit-api/) | Node **Fastify** API: signed upload tokens, staging writes, static SPA under `/app/`. |
| [`web/songpit-upload/`](web/songpit-upload/) | **Svelte 5** + Vite SPA; build output goes to `services/songpit-api/web-dist/`. |

## Quick start (companion API)

1. Copy [`services/songpit-api/.env.example`](services/songpit-api/.env.example) to `services/songpit-api/.env` and set:

   - **`SONGPIT_JWT_SECRET`** — long random string (used to sign upload tokens).
   - **`SONGPIT_API_KEY`** — secret for `POST /v1/shares` (maintainers only).
   - **`SONGPIT_STAGING_ROOT`** — absolute path where drops are written (e.g. `/var/lib/songpit/staging`). The process must be able to create directories and files here.
   - **`SONGPIT_SPA_PUBLIC_URL`** — public base URL of the SPA **including `/app`**, e.g. `https://music.example.com/app`.

2. Install and run:

   ```bash
   cd services/songpit-api
   npm install
   npm start
   ```

3. Build the SPA (after UI changes):

   ```bash
   cd web/songpit-upload
   npm install
   npm run build
   ```

4. **Create a share** (maintainer):

   ```bash
   curl -s -X POST https://your-host/v1/shares \
     -H "Authorization: Bearer $SONGPIT_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"maxBytes":500000000,"maxFiles":200,"expiresInHours":24,"password":"optional"}'
   ```

   Use the returned **`spaUrl`** (or pass `token` into `/#/?token=...`).

5. **API surface**

   - `GET /health` — liveness.
   - `POST /v1/shares` — Bearer **`SONGPIT_API_KEY`**; returns JWT + `spaUrl`.
   - `GET /v1/session` — Bearer **upload JWT**; returns limits and usage.
   - `POST /v1/upload` — `multipart/form-data` with **`file`** (required), optional **`password`**, and optional metadata fields **`title`**, **`artist`**, **`album`**, **`trackNumber`**, **`bucket`**. **MP3** files get **ID3v2** tags embedded from those fields (via `node-id3`). Other extensions keep raw bytes; a **`.songpit-meta.json` sidecar** (same basename as the audio file) is written when any metadata or bucket is present. **`bucket`** is sanitized and becomes a **subdirectory** under the share’s drop folder (default `Inbox`). Duplicate filenames in the same bucket get `_1`, `_2`, … before the extension (no silent overwrite).

Uploads are restricted by **extension**, **magic-byte sniffing** (including ADTS-style **AAC** when the file is named `.aac`), **per-token byte/file caps**, a **global** rate limit, and a **stricter** limit on `POST /v1/upload`. Usage totals are updated under an **in-process mutex** (safe for one Node worker; use a single process or external coordination if you scale horizontally). This is **not** a substitute for antivirus or legal review — see **Threat model** below.

6. **Tests** (API + PHP syntax):

   ```bash
   cd services/songpit-api
   npm test
   npm run test:php
   ```

## Ampache integration

1. Install the plugin file into your Ampache tree as **`src/Plugin/AmpacheSongPit.php`** (see [`packages/ampache-song-pit/INSTALL.md`](packages/ampache-song-pit/INSTALL.md)).
2. Enable **Song Pit** in Ampache and set **Song Pit companion base URL** to the API origin (e.g. `https://music.example.com` — no trailing path required; the plugin links to the root which redirects to `/app/`).
3. Configure an **[upload catalog](https://www.ampache.org/docs/help/upload-catalogs)** and align **`SONGPIT_STAGING_ROOT`** with that catalog’s filesystem (or use a bind mount / sync so staged files land under the catalog path).
4. After files appear on disk, run a **catalog update** the way you usually do (web admin **Update catalog**, or Ampache **CLI** on the server). Exact commands depend on your Ampache version; see your installation’s `bin/cli` or docs.

## Reverse proxy (TLS)

Terminate HTTPS at nginx or Caddy and proxy to the Node process:

- Proxy `/`, `/app/`, `/v1/`, `/health` to the same upstream.
- **Do not** expose `POST /v1/shares` without network restrictions or additional auth if possible (API key in `Authorization` only helps if the channel is trusted).

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

- Treat **share URLs and upload JWTs like passwords**. Anyone with the link can upload within the token’s limits until expiry.
- **HTTPS everywhere** for links and API.
- **Rotate** `SONGPIT_API_KEY` and **revoke** old links by shortening `expiresInHours` on new shares only (tokens are stateless JWTs — there is no server-side revocation list in Milestone 1).
- Add **ClamAV** (or another AV scanner on the staging path) in a later milestone before promoting staged files to a trusted library path.

## ROADMAP (Milestone 2)

**Out of scope (explicit):** There will be **no Nextcloud app**, **no Nextcloud plugin**, and **no workflow to add or sync tracks to a Nextcloud server**. Song Pit stays centered on **Ampache + the companion API**, not Nextcloud as a destination.

Planned work:

- **Tagging beyond MP3**: Optional **ffmpeg**-based embedding for FLAC/M4A/OGG, or richer **non-MP3** tag libraries (today: sidecar JSON + ID3 for `.mp3`).
- **Robustness**: **Multi-instance** usage accounting (e.g. SQLite/Redis) if you run **multiple Node workers**; optional **JWT denylist** for leaked tokens.
- **Malware / review**: **ClamAV** (or similar) integration on the staging directory and a **human review queue** concept — implemented **without** Nextcloud; e.g. filesystem + maintainer tooling or a small standalone queue UI if needed.
- **Agents**: **OpenClaw** + **Ollama** for maintainer workflows (tag cleanup suggestions, import summaries, duplicate hints).
- **Duplicate detection**: **AcoustID / Chromaprint**-style fingerprints against your Ampache library via API/DB — **not** P2P tooling by default.
- Optional **Soulseek CLI** only with an explicit legal/ops story; not shipped as a core dependency.

## License

Specify your license when publishing (e.g. AGPL-3.0 to align with Ampache if you distribute linked derivatives — consult a lawyer for your scenario).
