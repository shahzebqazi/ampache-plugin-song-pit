<?php

declare(strict_types=1);

/**
 * Song Pit — Ampache plugin
 *
 * Copy this file into your Ampache installation:
 *   src/Plugin/AmpacheSongPit.php
 *
 * Enable the plugin in Ampache admin, then set the Song Pit companion base URL.
 */

namespace Ampache\Plugin;

use Ampache\Module\Authorization\AccessLevelEnum;
use Ampache\Module\System\Core;
use Ampache\Repository\Model\Plugin;
use Ampache\Repository\Model\Preference;
use Ampache\Repository\Model\User;
use Ampache\Module\Util\Ui;

class AmpacheSongPit extends AmpachePlugin implements PluginDisplayHomeInterface
{
    public string $name = 'Song Pit';

    public string $categories = 'home';

    public string $description = 'Magic-link uploads via Song Pit companion';

    public string $url = '';

    public string $version = '000001';

    public string $min_ampache = '370021';

    public string $max_ampache = '999999';

    private string $companion_url = '';

    private int $order = 0;

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

        return Preference::insert(
            'songpit_home_order',
            T_('Song Pit home box order (CSS)'),
            0,
            AccessLevelEnum::ADMIN->value,
            'integer',
            'plugins',
            'songpit'
        );
    }

    public function uninstall(): bool
    {
        return Preference::delete('songpit_companion_url')
            && Preference::delete('songpit_home_order');
    }

    public function upgrade(): bool
    {
        $from_version = Plugin::get_plugin_version($this->name);
        if ($from_version === 0) {
            return false;
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
        echo '<div class="songpit-home">';
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

        if ($this->companion_url === '') {
            debug_event('songpit.plugin', 'Song Pit companion URL not configured', 4);
        }

        return true;
    }
}
