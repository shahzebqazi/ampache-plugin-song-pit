/**
 * API origin for Song Pit (empty = same origin as the SPA, e.g. behind the Fastify service).
 * Set `VITE_API_BASE_URL` when the SPA is hosted separately (e.g. GitHub Pages) and the API
 * elsewhere — the API must allow CORS for that origin.
 */
export function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  if (!base) {
    return p;
  }
  return `${base}${p}`;
}
