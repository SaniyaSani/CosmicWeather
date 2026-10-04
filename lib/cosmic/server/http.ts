/**
 * Server-only helpers: bounded fetches and a two-level cache (per-isolate
 * memory + Cloudflare Cache API when available). On an upstream failure the
 * last good value is served with `stale: true` for up to `staleMax`.
 */

const USER_AGENT = "InvisibleWeather/1.0 (open citizen-science cosmic-ray observatory)";

export async function fetchText(url: string, timeoutMs = 9_000, accept = "application/json, text/plain, */*") {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: accept }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} responded ${response.status}`);
  return response.text();
}

export async function fetchJson<T = unknown>(url: string, timeoutMs = 9_000): Promise<T> {
  const text = await fetchText(url, timeoutMs);
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`${new URL(url).hostname} returned invalid JSON`); }
}

type Entry<T> = { value: T; storedAt: number };
const memory = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

function edgeCache(): Cache | null {
  try {
    const store = (globalThis as unknown as { caches?: CacheStorage & { default?: Cache } }).caches;
    return store?.default ?? null;
  } catch { return null; }
}

const cacheUrl = (key: string) => `https://invisible-weather.cache/${encodeURIComponent(key)}`;

async function readEdge<T>(key: string): Promise<Entry<T> | null> {
  const cache = edgeCache();
  if (!cache) return null;
  try {
    const hit = await cache.match(cacheUrl(key));
    return hit ? await hit.json() as Entry<T> : null;
  } catch { return null; }
}

async function writeEdge<T>(key: string, entry: Entry<T>, maxAgeS: number) {
  const cache = edgeCache();
  if (!cache) return;
  try {
    await cache.put(cacheUrl(key), new Response(JSON.stringify(entry), { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${Math.max(60, Math.round(maxAgeS))}` } }));
  } catch { /* cache is best-effort */ }
}

export type CacheResult<T> = { value: T; storedAt: number; stale: boolean; error?: string };

export async function cached<T>(key: string, ttlMs: number, staleMaxMs: number, loader: () => Promise<T>): Promise<CacheResult<T>> {
  const now = Date.now();
  let entry = memory.get(key) as Entry<T> | undefined;
  if (!entry) { const edge = await readEdge<T>(key); if (edge) { entry = edge; memory.set(key, edge); } }
  if (entry && now - entry.storedAt < ttlMs) return { value: entry.value, storedAt: entry.storedAt, stale: false };

  let pending = inflight.get(key) as Promise<T> | undefined;
  if (!pending) {
    pending = loader();
    inflight.set(key, pending);
    pending.finally(() => inflight.delete(key)).catch(() => undefined);
  }
  try {
    const value = await pending;
    const fresh = { value, storedAt: Date.now() };
    memory.set(key, fresh);
    await writeEdge(key, fresh, staleMaxMs / 1000);
    return { value, storedAt: fresh.storedAt, stale: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upstream unavailable";
    if (entry && now - entry.storedAt < staleMaxMs) return { value: entry.value, storedAt: entry.storedAt, stale: true, error: message };
    throw new Error(message);
  }
}

export function jsonResponse(body: unknown, maxAgeS: number, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": `public, max-age=${maxAgeS}, stale-while-revalidate=${maxAgeS * 4}` } });
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Upstream unavailable";
}
