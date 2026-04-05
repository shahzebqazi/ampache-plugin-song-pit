<script lang="ts">
  import { parseBlob } from 'music-metadata';
  import { onMount } from 'svelte';
  import { apiUrl } from './lib/api';

  type Session = {
    sub: string;
    maxBytes: number;
    maxFiles: number;
    usedBytes: number;
    uploadedFiles: number;
    passwordRequired: boolean;
  };

  type TrackRow = {
    id: string;
    file: File;
    title: string;
    artist: string;
    album: string;
    trackNo: string;
    bucket: string;
  };

  const staticDemo = import.meta.env.VITE_STATIC_DEMO === 'true';
  const assetBase = import.meta.env.BASE_URL;

  const DEMO_SESSION: Session = {
    sub: 'demo-drop',
    maxBytes: 500 * 1024 * 1024,
    maxFiles: 200,
    usedBytes: 0,
    uploadedFiles: 0,
    passwordRequired: false,
  };

  let demoMode = $state(false);
  let token = $state('');
  let session = $state<Session | null>(null);
  let sessionError = $state<string | null>(null);
  let sessionLoading = $state(false);
  let password = $state('');
  let tracks = $state<TrackRow[]>([]);
  let busy = $state(false);
  let uploadLog = $state<string[]>([]);

  /** Hash may be `#/?demo=1` or `#?demo=1` — `new URLSearchParams('/?demo=1')` wrongly maps `/?demo`→`1`, so strip to the query segment first. */
  function readHashParams(): URLSearchParams {
    const h = window.location.hash.replace(/^#/, '');
    if (h.includes('?')) {
      return new URLSearchParams(h.slice(h.indexOf('?') + 1));
    }
    const tail = h.startsWith('/') ? h.slice(1) : h;
    return new URLSearchParams(tail);
  }

  function applyRoute() {
    const params = readHashParams();
    demoMode = staticDemo && params.get('demo') === '1';
    token = params.get('token') ?? '';

    if (demoMode) {
      session = DEMO_SESSION;
      sessionError = null;
      sessionLoading = false;
      return;
    }

    session = null;
    sessionError = null;
    if (token) {
      void refreshSession();
    } else {
      sessionLoading = false;
    }
  }

  const showGate = $derived(!demoMode && !token);

  onMount(() => {
    applyRoute();
    window.addEventListener('hashchange', applyRoute);
    return () => window.removeEventListener('hashchange', applyRoute);
  });

  async function refreshSession() {
    if (demoMode) {
      session = DEMO_SESSION;
      return;
    }
    sessionError = null;
    sessionLoading = true;
    try {
      const r = await fetch(apiUrl('/v1/session'), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
      }
      session = (await r.json()) as Session;
    } catch (e) {
      session = null;
      sessionError = e instanceof Error ? e.message : 'Session failed';
    } finally {
      sessionLoading = false;
    }
  }

  async function onPickFiles(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const files = input.files;
    if (!files?.length) {
      return;
    }
    busy = true;
    const next: TrackRow[] = [];
    for (const file of Array.from(files)) {
      let title = file.name.replace(/\.[^.]+$/, '');
      let artist = '';
      let album = '';
      let trackNo = '';
      try {
        const meta = await parseBlob(file);
        const c = meta.common;
        title = c.title ?? title;
        artist = c.artist ?? c.artists?.[0] ?? '';
        album = c.album ?? '';
        trackNo = c.track.no != null ? String(c.track.no) : '';
      } catch {
        /* keep filename defaults */
      }
      next.push({
        id: crypto.randomUUID(),
        file,
        title,
        artist,
        album,
        trackNo,
        bucket: 'Inbox',
      });
    }
    tracks = [...tracks, ...next];
    busy = false;
    input.value = '';
  }

  function setBucket(id: string, bucket: string) {
    tracks = tracks.map((t) => (t.id === id ? { ...t, bucket } : t));
  }

  function removeTrack(id: string) {
    tracks = tracks.filter((t) => t.id !== id);
  }

  function patchTrack(id: string, patch: Partial<TrackRow>) {
    tracks = tracks.map((t) => (t.id === id ? { ...t, ...patch } : t));
  }

  const buckets = $derived([...new Set(tracks.map((t) => t.bucket))].sort());

  async function uploadAll() {
    if (demoMode) {
      uploadLog = ['Static demo: deploy the Song Pit API to upload files.'];
      return;
    }
    if (!token || !session) {
      return;
    }
    uploadLog = [];
    busy = true;
    for (const t of tracks) {
      const fd = new FormData();
      fd.append('file', t.file, t.file.name);
      fd.append('title', t.title);
      fd.append('artist', t.artist);
      fd.append('album', t.album);
      fd.append('trackNumber', t.trackNo);
      fd.append('bucket', t.bucket);
      if (password) {
        fd.append('password', password);
      }
      try {
        const r = await fetch(apiUrl('/v1/upload'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          uploadLog = [...uploadLog, `${t.file.name}: ${j.error ?? r.status}`];
          continue;
        }
        uploadLog = [...uploadLog, `${t.file.name}: ok`];
        await refreshSession();
      } catch (e) {
        uploadLog = [
          ...uploadLog,
          `${t.file.name}: ${e instanceof Error ? e.message : 'error'}`,
        ];
      }
    }
    busy = false;
  }

  const bytesLeft = $derived(
    session ? Math.max(0, session.maxBytes - session.usedBytes) : 0
  );
</script>

<div class="pa2-shell">
  <div
    class="pa2-matrix-bg"
    aria-hidden="true"
    style={`background-image: url('${assetBase}pa2/pa2-logo-matrix.jpg')`}
  ></div>

  <div class="pa2-shell-inner">
    {#if staticDemo}
      <div class="pa2-banner-demo">
        <strong>Demo</strong> — UI only on GitHub Pages. Uploads require a self-hosted Song Pit API;
        open a real share link against your deployment for end-to-end uploads.
      </div>
    {/if}

    <header class="pa2-hero">
      <img
        class="pa2-brand-mark"
        src={`${assetBase}pa2/pa2-logo-blackbg.png`}
        alt="Power Ampache 2"
      />
      <div class="pa2-hero-text">
        <h1>Song Pit</h1>
        <p class="pa2-tagline">Sort, tag, then drop tracks into the collection.</p>
      </div>
    </header>

    {#if showGate}
      <section class="pa2-card pa2-warn">
        <h2>Missing link</h2>
        <p>Open this app from a valid Song Pit share URL (it includes a token in the hash).</p>
        {#if staticDemo}
          <p class="pa2-hint">
            <a href="#/?demo=1">Try the static demo</a> (browse tagging UI locally; uploads stay disabled).
          </p>
        {/if}
      </section>
    {:else if sessionError}
      <section class="pa2-card pa2-warn">
        <h2>Session</h2>
        <p>{sessionError}</p>
        <button type="button" class="pa2-btn pa2-btn-primary" onclick={() => refreshSession()}>Retry</button>
      </section>
    {:else if token && !session && sessionLoading}
      <p class="pa2-muted">Loading…</p>
    {:else if session}
      <section class="pa2-card pa2-stats">
        <div class="pa2-stat">
          <span class="pa2-label">Room left</span>
          <strong>{(bytesLeft / (1024 * 1024)).toFixed(1)} MB</strong>
        </div>
        <div class="pa2-stat">
          <span class="pa2-label">Files</span>
          <strong>{session.uploadedFiles} / {session.maxFiles}</strong>
        </div>
        <div class="pa2-stat">
          <span class="pa2-label">Drop folder</span>
          <strong class="pa2-mono">{session.sub}</strong>
        </div>
      </section>

      {#if session.passwordRequired}
        <label class="pa2-field">
          <span>Password</span>
          <input type="password" bind:value={password} autocomplete="off" />
        </label>
      {/if}

      <section class="pa2-card">
        <h2>1. Add audio files</h2>
        <input
          type="file"
          accept="audio/*,.mp3,.flac,.m4a,.aac,.ogg,.opus,.wav"
          multiple
          onchange={onPickFiles}
          disabled={busy}
        />
        <p class="pa2-hint">
          Tags are read in your browser. On upload, MP3s get ID3 tags embedded; other formats get a
          <code>.songpit-meta.json</code> sidecar next to the file. Buckets become subfolders under your drop.
        </p>
      </section>

      {#if tracks.length}
        <section class="pa2-card">
          <h2>2. Tidy metadata & buckets</h2>
          <p class="pa2-hint">
            Buckets become directory names under your share (sanitized). Filenames stay unique if you
            upload duplicates.
          </p>
          <div class="pa2-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Artist</th>
                  <th>Album</th>
                  <th>#</th>
                  <th>Bucket</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {#each tracks as t (t.id)}
                  <tr>
                    <td>
                      <input
                        value={t.title}
                        oninput={(e) =>
                          patchTrack(t.id, { title: e.currentTarget.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={t.artist}
                        oninput={(e) =>
                          patchTrack(t.id, { artist: e.currentTarget.value })}
                      />
                    </td>
                    <td>
                      <input
                        value={t.album}
                        oninput={(e) =>
                          patchTrack(t.id, { album: e.currentTarget.value })}
                      />
                    </td>
                    <td>
                      <input
                        class="pa2-narrow"
                        value={t.trackNo}
                        oninput={(e) =>
                          patchTrack(t.id, { trackNo: e.currentTarget.value })}
                      />
                    </td>
                    <td>
                      <input
                        list="bucket-list"
                        value={t.bucket}
                        oninput={(e) => setBucket(t.id, e.currentTarget.value)}
                      />
                    </td>
                    <td>
                      <button type="button" class="pa2-btn pa2-btn-ghost" onclick={() => removeTrack(t.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
          <datalist id="bucket-list">
            {#each buckets as b}
              <option value={b}></option>
            {/each}
          </datalist>
        </section>

        <section class="pa2-card">
          <h2>3. Upload</h2>
          <button type="button" class="pa2-btn pa2-btn-primary" disabled={busy} onclick={uploadAll}>
            {busy ? 'Uploading…' : 'Upload all'}
          </button>
          {#if uploadLog.length}
            <ul class="pa2-log">
              {#each uploadLog as line}
                <li>{line}</li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}
    {/if}

    <footer class="pa2-footer">
      <small>
        Song Pit — stage for your Ampache library. Treat share links like passwords.
        <br />
        Theme colors &amp; typography from
        <a href="https://github.com/icefields/PowerAmpache2Theme" target="_blank" rel="noopener noreferrer">PowerAmpache2Theme</a>;
        artwork from
        <a href="https://github.com/icefields/Power-Ampache-2" target="_blank" rel="noopener noreferrer">Power Ampache 2</a>
        (GPL-3.0).
      </small>
    </footer>
  </div>
</div>
