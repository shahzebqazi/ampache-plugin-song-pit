# Installing Song Pit (Ampache plugin)

1. Copy `AmpacheSongPit.php` into your Ampache tree with the other plugins, usually:

   `src/Plugin/AmpacheSongPit.php`

2. In Ampache, open the plugins area (admin → plugins) and enable **Song Pit**.

3. Set **Song Pit companion base URL** to where the Song Pit API is reachable on the web, including `https://`, for example `https://songpit.example.com`.

4. If your Ampache tree does not already list this plugin, register it in `src/Plugin/PluginEnum.php` (add `'songpit' => AmpacheSongPit::class` to the `LIST` array) so Ampache can load the class.

5. **Search footer (optional):** After you run an advanced search for **songs**, **albums**, or **artists** (`search.php?action=search`), a short line of text with a hyperlink to Song Pit can appear **below the result list** (just above the site footer) when the search returns **no rows** or when you are on the **last page** of a multi-page result set. Admins can turn this off under plugin preferences (**Show Song Pit link on music search results (footer)**).

6. Build the upload UI (`web/songpit-upload/`, `npm run build`), then deploy the companion API from `services/songpit-api/` (see the repo root `README.md` for env vars and run order).

7. Point Ampache at an [upload catalog](https://www.ampache.org/docs/help/upload-catalogs) and make sure the companion’s staging directory matches that catalog on disk (or syncs into it).

`AmpacheSongPit.php` sets `min_ampache` / `max_ampache` to the same **database schema version** bounds as bundled Ampache plugins (for example `AmpacheHomeDashboard` in upstream Ampache uses `370021` / `999999`). Ampache compares these to the `db_version` row in the `update_info` table — not to the human-readable release tag (for example 7.9.x).

To confirm on your install:

```sql
SELECT `value` FROM `update_info` WHERE `key` = 'db_version';
```

That value must be ≥ `min_ampache` and ≤ `max_ampache`. As of Ampache `develop`, the latest migration reaches `790001`, which falls inside this range. Bump `min_ampache` / `max_ampache` only if Ampache’s plugin contract or this plugin’s requirements change.
