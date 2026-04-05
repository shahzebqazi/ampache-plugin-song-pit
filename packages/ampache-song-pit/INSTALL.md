# Installing Song Pit (Ampache plugin)

1. Copy `AmpacheSongPit.php` into your Ampache tree next to other plugins:
   - `src/Plugin/AmpacheSongPit.php`

2. In Ampache, enable the **Song Pit** plugin (admin → plugins).

3. Set **Song Pit companion base URL** to the public URL of your Song Pit API (including scheme), e.g. `https://songpit.example.com`.

4. Deploy the companion service from `services/songpit-api/` and the upload SPA from `web/songpit-upload/` (see root `README.md`).

5. Configure an [Ampache upload catalog](https://www.ampache.org/docs/help/upload-catalogs) and point the companion staging directory at the same filesystem path or sync into it.

Ampache version compatibility is declared in `AmpacheSongPit.php` as `min_ampache` / `max_ampache`; adjust after testing on your instance.
