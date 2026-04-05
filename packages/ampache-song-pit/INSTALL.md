# Installing Song Pit (Ampache plugin)

1. Copy `AmpacheSongPit.php` into your Ampache tree with the other plugins, usually:

   `src/Plugin/AmpacheSongPit.php`

2. In Ampache, open the plugins area (admin → plugins) and enable **Song Pit**.

3. Set **Song Pit companion base URL** to where the Song Pit API is reachable on the web, including `https://`, for example `https://songpit.example.com`.

4. Deploy the companion API from `services/songpit-api/` and build the upload UI from `web/songpit-upload/` (see the repo root `README.md` for env vars and build steps).

5. Point Ampache at an [upload catalog](https://www.ampache.org/docs/help/upload-catalogs) and make sure the companion’s staging directory matches that catalog on disk (or syncs into it).

`AmpacheSongPit.php` lists `min_ampache` / `max_ampache`; bump those after you have tested on your actual Ampache version.
