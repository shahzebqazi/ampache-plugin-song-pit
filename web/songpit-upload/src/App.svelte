<script lang="ts">
  import { parseBlob } from 'music-metadata';
  import { onMount } from 'svelte';

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

  let token = $state('');
  let session = $state<Session | null>(null);
  let sessionError = $state<string | null>(null);
  let password = $state('');
  let tracks = $state<TrackRow[]>([]);
  let busy = $state(false);
  let uploadLog = $state<string[]>([]);

  function readTokenFromUrl(): string {
    const h = window.location.hash.replace(/^#/, '');
    const q = new URLSearchParams(h.startsWith('?') ? h.slice(1) : h);
    return q.get('token') ?? '';
  }

  onMount(() => {
    token = readTokenFromUrl();
    if (token) {
      void refreshSession();
    }
  });

  async function refreshSession() {
    sessionError = null;
    try {
      const r = await fetch('/v1/session', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) {
        throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
      }
      session = (await r.json()) as Session;
    } catch (e) {
      session = null;
      sessionError = e instanceof Error ? e.message : 'Session failed';
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
        trackNo =
          c.track.no != null ? String(c.track.no) : c.track.of != null ? String(c.track.of) : '';
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
    if (!token || !session) {
      return;
    }
    uploadLog = [];
    busy = true;
    for (const t of tracks) {
      const fd = new FormData();
      fd.append('file', t.file, t.file.name);
      if (password) {
        fd.append('password', password);
      }
      try {
        const r = await fetch('/v1/upload', {
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

<div class="shell">
  <header class="hero">
    <h1>Song Pit</h1>
    <p class="tagline">Sort, tag, then drop tracks into the collection.</p>
  </header>

  {#if !token}
    <section class="card warn">
      <h2>Missing link</h2>
      <p>Open this app from a valid Song Pit share URL (it includes a token in the hash).</p>
    </section>
  {:else if sessionError}
    <section class="card warn">
      <h2>Session</h2>
      <p>{sessionError}</p>
      <button type="button" class="btn primary" onclick={() => refreshSession()}>Retry</button>
    </section>
  {:else if !session}
    <p class="muted">Loading…</p>
  {:else}
    <section class="card stats">
      <div class="stat">
        <span class="label">Room left</span>
        <strong>{(bytesLeft / (1024 * 1024)).toFixed(1)} MB</strong>
      </div>
      <div class="stat">
        <span class="label">Files</span>
        <strong>{session.uploadedFiles} / {session.maxFiles}</strong>
      </div>
      <div class="stat">
        <span class="label">Drop folder</span>
        <strong class="mono">{session.sub}</strong>
      </div>
    </section>

    {#if session.passwordRequired}
      <label class="field">
        <span>Password</span>
        <input type="password" bind:value={password} autocomplete="off" />
      </label>
    {/if}

    <section class="card">
      <h2>1. Add audio files</h2>
      <input
        type="file"
        accept="audio/*,.mp3,.flac,.m4a,.aac,.ogg,.opus,.wav"
        multiple
        onchange={onPickFiles}
        disabled={busy}
      />
      <p class="hint">Tags are read in your browser — nothing is uploaded until you confirm.</p>
    </section>

    {#if tracks.length}
      <section class="card">
        <h2>2. Tidy metadata & buckets</h2>
        <p class="hint">
          Drag ideas: group by vibe (“Live”, “Remasters”). Buckets are labels only — files keep
          their names on disk.
        </p>
        <div class="table-wrap">
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
                      class="narrow"
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
                    <button type="button" class="btn ghost" onclick={() => removeTrack(t.id)}>
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

      <section class="card actions">
        <h2>3. Upload</h2>
        <button type="button" class="btn primary" disabled={busy} onclick={uploadAll}>
          {busy ? 'Uploading…' : 'Upload all'}
        </button>
        {#if uploadLog.length}
          <ul class="log">
            {#each uploadLog as line}
              <li>{line}</li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  {/if}

  <footer class="footer">
    <small>Song Pit — stage for your Ampache library. Treat share links like passwords.</small>
  </footer>
</div>

<style>
  .shell {
    max-width: 960px;
    margin: 0 auto;
    padding: 2rem 1.25rem 4rem;
  }

  .hero {
    margin-bottom: 1.5rem;
  }

  .hero h1 {
    font-size: 2.25rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    margin: 0 0 0.25rem;
    background: linear-gradient(120deg, #4f378b, #9a82db, #7d5260);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }

  .tagline {
    margin: 0;
    font-size: 1.1rem;
    color: #49454f;
  }

  .card {
    background: var(--md-sys-color-surface);
    border-radius: var(--md-shape-corner-large);
    padding: 1.25rem 1.5rem;
    margin-bottom: 1rem;
    box-shadow:
      0 1px 3px rgba(60, 40, 90, 0.08),
      0 8px 24px rgba(60, 40, 90, 0.06);
    border: 1px solid rgba(103, 80, 164, 0.12);
  }

  .card.warn {
    border-color: rgba(179, 38, 30, 0.35);
    background: #fff8f7;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 1rem;
  }

  .stat .label {
    display: block;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--md-sys-color-outline);
  }

  .stat strong {
    font-size: 1.15rem;
  }

  .mono {
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    word-break: break-all;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-bottom: 1rem;
  }

  .field input {
    padding: 0.65rem 0.85rem;
    border-radius: var(--md-shape-corner-small);
    border: 1px solid #cac4d0;
    max-width: 320px;
  }

  .hint {
    color: #49454f;
    font-size: 0.9rem;
  }

  .muted {
    color: #49454f;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }

  th {
    text-align: left;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--md-sys-color-outline);
    padding: 0.35rem;
  }

  td {
    padding: 0.35rem;
    vertical-align: middle;
  }

  td input {
    width: 100%;
    min-width: 0;
    padding: 0.4rem 0.5rem;
    border-radius: 8px;
    border: 1px solid #cac4d0;
    background: #fff;
  }

  .narrow {
    max-width: 4rem;
  }

  .btn {
    border: none;
    border-radius: 999px;
    padding: 0.55rem 1.25rem;
    font-weight: 600;
  }

  .btn.primary {
    background: var(--md-sys-color-primary);
    color: var(--md-sys-color-on-primary);
  }

  .btn.primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn.ghost {
    background: transparent;
    color: var(--md-sys-color-primary);
  }

  .table-wrap {
    overflow-x: auto;
    margin-top: 0.75rem;
  }

  .log {
    margin: 0.75rem 0 0;
    padding-left: 1.2rem;
    font-size: 0.9rem;
  }

  .footer {
    margin-top: 2rem;
    color: #49454f;
    text-align: center;
  }
</style>
