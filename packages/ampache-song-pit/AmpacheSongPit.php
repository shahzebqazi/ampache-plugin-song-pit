<?php

declare(strict_types=1);

/**
 * Song Pit — Ampache plugin
 *
 * Copy this file into your Ampache installation:
 *   src/Plugin/AmpacheSongPit.php
 *
 * Enable the plugin in Ampache admin, then set the Song Pit companion base URL.
 *
 * Search pages: when a catalog search returns no matches, or on the last page of results,
 * a footer link points users to Song Pit to stage uploads (optional; preference).
 */

namespace Ampache\Plugin;

use Ampache\Module\Authorization\AccessLevelEnum;
use Ampache\Module\System\Core;
use Ampache\Module\System\Dba;
use Ampache\Repository\Model\Browse;
use Ampache\Repository\Model\ModelFactoryInterface;
use Ampache\Repository\Model\Plugin;
use Ampache\Repository\Model\Preference;
use Ampache\Repository\Model\User;
use Ampache\Module\Util\Ui;
use Psr\Container\ContainerInterface;

class AmpacheSongPit extends AmpachePlugin implements PluginDisplayHomeInterface, PluginDisplayOnFooterInterface
{
    public string $name = 'Song Pit';

    public string $categories = 'home';

    public string $description = 'Magic-link uploads via Song Pit companion';

    public string $url = '';

    public string $version = '000002';

    /** Ampache DB schema version from `update_info.db_version` (same range as core home plugins). */
    public string $min_ampache = '370021';

    public string $max_ampache = '999999';

    private string $companion_url = '';

    private int $order = 0;

    private bool $search_cta_enabled = true;

    public function __construct()
    {
        $this->description = T_('Magic-link uploads via Song Pit companion');
    }

    public function install(): bool
    {
        if (!Preference::insert(
            'songpit_companion_url',
            T_('Song Pit companion base URL (https://songpit.example.com)'),
            '',
            AccessLevelEnum::ADMIN->value,
            'string',
            'plugins',
            'songpit'
        )) {
            return false;
        }

        if (!Preference::insert(
            'songpit_home_order',
            T_('Song Pit home box order (CSS)'),
            0,
            AccessLevelEnum::ADMIN->value,
            'integer',
            'plugins',
            'songpit'
        )) {
            return false;
        }

        return Preference::insert(
            'songpit_search_cta',
            T_('Show Song Pit link on music search results (footer)'),
            '1',
            AccessLevelEnum::ADMIN->value,
            'boolean',
            'plugins',
            'songpit'
        );
    }

    public function uninstall(): bool
    {
        return Preference::delete('songpit_companion_url')
            && Preference::delete('songpit_home_order')
            && Preference::delete('songpit_search_cta');
    }

    public function upgrade(): bool
    {
        $from_version = Plugin::get_plugin_version($this->name);
        if ($from_version === 0) {
            return false;
        }

        if ($from_version < (int) $this->version) {
            Preference::insert(
                'songpit_search_cta',
                T_('Show Song Pit link on music search results (footer)'),
                '1',
                AccessLevelEnum::ADMIN->value,
                'boolean',
                'plugins',
                'songpit'
            );
        }

        return true;
    }

    public function display_home(): void
    {
        $user = Core::get_global('user');
        if ($user === null || !$user->has_access(AccessLevelEnum::ADMIN)) {
            return;
        }

        Ui::show_box_top(T_('Song Pit'));
        $orderAttr = ($this->order > 0) ? ' style="order: ' . (int) $this->order . ';"' : '';
        echo '<div class="songpit-home"' . $orderAttr . '>';
        if ($this->companion_url === '') {
            echo '<p class="information">' . T_('Set the Song Pit companion base URL in plugin preferences.') . '</p>';
        } else {
            $url = scrub_out($this->companion_url);
            echo '<p><a class="button" href="' . $url . '" target="_blank" rel="noopener noreferrer">';
            echo T_('Open Song Pit console');
            echo '</a></p>';
            echo '<p class="information">' . T_('Share time-limited upload links and stage files for your catalog.') . '</p>';
        }
        echo '</div>';
        Ui::show_box_bottom();
    }

    public function display_on_footer(): void
    {
        if (!$this->search_cta_enabled || $this->companion_url === '') {
            return;
        }

        $script = basename((string) ($_SERVER['SCRIPT_NAME'] ?? ''));
        if ($script !== 'search.php') {
            return;
        }

        $action = (string) ($_REQUEST['action'] ?? '');
        if ($action !== 'search') {
            return;
        }

        if (($_REQUEST['rule_1'] ?? '') === 'missing_artist') {
            return;
        }

        $type = (string) ($_REQUEST['type'] ?? 'song');
        $allowed = ['song', 'album', 'album_disk', 'artist'];
        if (!in_array($type, $allowed, true)) {
            return;
        }

        global $dic;
        if (!$dic instanceof ContainerInterface) {
            return;
        }

        $sid = session_id();
        if ($sid === '') {
            return;
        }

        $db_results = Dba::read(
            'SELECT MAX(`id`) AS `bid` FROM `tmp_browse` WHERE `sid` = ?',
            [$sid]
        );
        $row        = Dba::fetch_assoc($db_results);
        $browseId   = (int) ($row['bid'] ?? 0);
        if ($browseId <= 0) {
            return;
        }

        $factory = $dic->get(ModelFactoryInterface::class);
        $browse  = $factory->createBrowse($browseId);
        if (!$browse instanceof Browse || $browse->get_type() !== $type) {
            return;
        }

        $total  = $browse->get_total();
        $start  = $browse->get_start();
        $offset = $browse->get_offset();

        $onLastPage = $this->isLastBrowsePage($total, $start, $offset);
        if (!$onLastPage) {
            return;
        }

        $url = scrub_out($this->companion_url);

        echo '<p class="information songpit-search-cta" style="clear:both;margin:1em 0;">';
        echo T_("Can't find what you're looking for? ");
        echo '<a href="' . $url . '" target="_blank" rel="noopener noreferrer">';
        echo T_('Click here to add music');
        echo '</a>';
        echo '</p>';
    }

    /**
     * @param int $total Object count for this browse (search result size).
     * @param int $start Pagination offset into the result list.
     * @param int $offset Page size (0 = show full result set in one view).
     */
    private function isLastBrowsePage(int $total, int $start, int $offset): bool
    {
        if ($total <= 0) {
            return true;
        }

        if ($offset <= 0) {
            return true;
        }

        return ($start + $offset) >= $total;
    }

    public function load(User $user): bool
    {
        $user->set_preferences();
        $data = $user->prefs;

        $url = trim((string) ($data['songpit_companion_url'] ?? ''));
        if ($url === '') {
            $url = trim((string) Preference::get_by_user(-1, 'songpit_companion_url'));
        }
        $this->companion_url = $url;

        $this->order = (int) ($data['songpit_home_order'] ?? Preference::get_by_user(-1, 'songpit_home_order') ?? 0);

        $cta = $data['songpit_search_cta'] ?? Preference::get_by_user(-1, 'songpit_search_cta');
        $this->search_cta_enabled = ($cta === null || $cta === '' || $cta === '1');

        if ($this->companion_url === '') {
            debug_event('songpit.plugin', 'Song Pit companion URL not configured', 4);
        }

        return true;
    }
}
