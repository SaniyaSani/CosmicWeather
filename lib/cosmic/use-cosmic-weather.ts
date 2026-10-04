"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { POLL_MS, SOURCE_LINKS, STALE_AFTER_MS } from "./config";
import type { EnvironmentPayload, EventsPayload, ReferencePayload, SourceState, SourceStatus, SpacePayload } from "./types";

type Feeds = {
  environment: EnvironmentPayload | null;
  space: SpacePayload | null;
  reference: ReferencePayload | null;
  events: EventsPayload | null;
};
type FeedKey = keyof Feeds;
type FeedMeta = { receivedAt: number | null; error: string | null; loading: boolean };

const CACHE_KEY = "iw-cosmic-feeds-v1";
const ENDPOINTS: Record<FeedKey, { path: string; every: number }> = {
  environment: { path: "/api/cosmic/environment", every: POLL_MS.environment },
  space: { path: "/api/cosmic/space", every: POLL_MS.space },
  reference: { path: "/api/cosmic/reference", every: POLL_MS.reference },
  events: { path: "/api/cosmic/events", every: POLL_MS.events },
};

function readCache(): { feeds: Feeds; meta: Record<FeedKey, number | null> } {
  const empty = { feeds: { environment: null, space: null, reference: null, events: null }, meta: { environment: null, space: null, reference: null, events: null } };
  if (typeof window === "undefined") return empty;
  try { return { ...empty, ...JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "{}") }; } catch { return empty; }
}

/** Development-only switches: ?cw-fixtures=1 and ?cw-fail=space,reference. Ignored in production builds. */
function devFlags() {
  if (!import.meta.env.DEV || typeof window === "undefined") return { fixtures: false, fail: new Set<string>() };
  const params = new URLSearchParams(window.location.search);
  return { fixtures: params.get("cw-fixtures") === "1", fail: new Set((params.get("cw-fail") ?? "").split(",").filter(Boolean)) };
}

export function useCosmicWeather(location: { latitude: number; longitude: number; stationId?: string }) {
  const [feeds, setFeeds] = useState<Feeds>(() => readCache().feeds);
  const [meta, setMeta] = useState<Record<FeedKey, FeedMeta>>(() => {
    const cached = readCache().meta;
    return Object.fromEntries((Object.keys(ENDPOINTS) as FeedKey[]).map((key) => [key, { receivedAt: cached[key], error: null, loading: true }])) as Record<FeedKey, FeedMeta>;
  });
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const feedsRef = useRef(feeds);
  const metaRef = useRef(meta);
  useEffect(() => { feedsRef.current = feeds; metaRef.current = meta; }, [feeds, meta]);
  const lastRequest = useRef<Record<FeedKey, number>>({ environment: 0, space: 0, reference: 0, events: 0 });

  const persist = useCallback(() => {
    try {
      window.localStorage.setItem(CACHE_KEY, JSON.stringify({
        feeds: feedsRef.current,
        meta: Object.fromEntries(Object.entries(metaRef.current).map(([key, value]) => [key, value.receivedAt])),
      }));
    } catch { /* quota or private mode: in-memory only */ }
  }, []);

  useEffect(() => { if (Object.values(meta).some((item) => item.receivedAt)) persist(); }, [feeds, meta, persist]);

  const load = useCallback(async (key: FeedKey, signal?: AbortSignal) => {
    lastRequest.current[key] = Date.now();
    const flags = devFlags();
    try {
      let data: unknown;
      if (flags.fail.has(key)) throw new Error("Simulated failure (development flag)");
      if (flags.fixtures) {
        const fixtures = await import("./dev-fixtures");
        data = fixtures.devFixture(key, Date.now());
      } else {
        const url = new URL(ENDPOINTS[key].path, window.location.origin);
        if (key === "environment") {
          url.searchParams.set("lat", location.latitude.toFixed(2));
          url.searchParams.set("lon", location.longitude.toFixed(2));
          if (location.stationId) url.searchParams.set("station", location.stationId);
        }
        const response = await fetch(url, { signal });
        const body = await response.json().catch(() => null) as Record<string, unknown> | null;
        if (!response.ok && !body) throw new Error(`HTTP ${response.status}`);
        data = body;
        if (!response.ok) {
          // Keep partially useful bodies (e.g. some NOAA feeds OK) but record the error.
          setMeta((current) => ({ ...current, [key]: { ...current[key], error: `HTTP ${response.status}`, loading: false } }));
        }
      }
      setFeeds((current) => ({ ...current, [key]: data as Feeds[FeedKey] }));
      setMeta((current) => ({ ...current, [key]: { receivedAt: Date.now(), error: current[key].error && !flags.fixtures ? current[key].error : null, loading: false } }));
    } catch (error) {
      if (signal?.aborted) return;
      setMeta((current) => ({ ...current, [key]: { ...current[key], error: error instanceof Error ? error.message : "Unavailable", loading: false } }));
    }
  }, [location.latitude, location.longitude, location.stationId]);

  useEffect(() => {
    const controller = new AbortController();
    const due = (force = false) => {
      if (typeof document !== "undefined" && document.hidden && !force) return;
      (Object.keys(ENDPOINTS) as FeedKey[]).forEach((key) => {
        if (force || Date.now() - lastRequest.current[key] >= ENDPOINTS[key].every) void load(key, controller.signal);
      });
    };
    due(true);
    const timer = window.setInterval(() => { setNow(Date.now()); due(); }, 30_000);
    const wake = () => { setNow(Date.now()); due(); };
    const goOnline = () => { setOnline(true); due(true); };
    const goOffline = () => setOnline(false);
    setOnline(navigator.onLine !== false);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      controller.abort(); window.clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline);
    };
  }, [load]);

  const refresh = useCallback(() => { (Object.keys(ENDPOINTS) as FeedKey[]).forEach((key) => void load(key)); }, [load]);

  return { feeds, meta, online, now, refresh };
}

// --- Source status ---------------------------------------------------------------

export function sourceState(dataTime: number | null, receivedAt: number | null, error: string | null, staleAfter: number, now: number, online: boolean, ok = true): SourceState {
  if (!receivedAt && error) return "unavailable";
  if (!receivedAt) return "loading";
  if (!ok && !dataTime) return "unavailable";
  if (!online) return "offline";
  if (dataTime !== null && now - dataTime > staleAfter) return "stale";
  if (error) return "stale";
  return "live";
}

export function buildSourceStatuses(feeds: Feeds, meta: Record<FeedKey, FeedMeta>, now: number, online: boolean, detector: { state: SourceState; dataTime: number | null; message?: string }): SourceStatus[] {
  const env = feeds.environment; const space = feeds.space; const ref = feeds.reference; const events = feeds.events;
  const last = <T extends { t: number }>(series: T[] | undefined) => (series?.length ? series[series.length - 1].t : null);
  const jung = ref?.stations.find((station) => station.code === "JUNG");
  const envTime = env?.current?.timestamp ?? (env?.series.length ? env.series[env.series.length - 1].timestamp : null);
  const statuses: SourceStatus[] = [
    { id: "detector", label: "Local detector", state: detector.state, dataTime: detector.dataTime, fetchedAt: detector.dataTime, message: detector.message, href: "#signal", attribution: "Invisible Weather" },
    { id: "pressure", label: env?.source === "sensor" ? "Atmospheric pressure · local sensor" : "Atmospheric pressure", state: sourceState(envTime, meta.environment.receivedAt, meta.environment.error ?? env?.error ?? null, STALE_AFTER_MS.pressure, now, online, Boolean(env?.series.length || env?.current)), dataTime: envTime, fetchedAt: meta.environment.receivedAt, message: meta.environment.error ?? env?.error, href: SOURCE_LINKS.pressure.href, attribution: env?.source === "sensor" ? `Local sensor ${env.sensor?.sensorId ?? ""}` : SOURCE_LINKS.pressure.attribution },
    { id: "noaa-xray", label: "NOAA GOES X-rays", state: sourceState(last(space?.xray.series), meta.space.receivedAt, space?.xray.status.ok === false ? space.xray.status.error ?? "unavailable" : meta.space.error, STALE_AFTER_MS["noaa-xray"], now, online, space?.xray.status.ok !== false), dataTime: last(space?.xray.series), fetchedAt: space?.xray.status.fetchedAt ?? null, message: space?.xray.status.error, href: "https://www.swpc.noaa.gov/products/goes-x-ray-flux", attribution: "NOAA SWPC / GOES" },
    { id: "noaa-protons", label: "NOAA GOES protons", state: sourceState(last(space?.protons.series10), meta.space.receivedAt, space?.protons.status.ok === false ? space.protons.status.error ?? "unavailable" : meta.space.error, STALE_AFTER_MS["noaa-protons"], now, online, space?.protons.status.ok !== false), dataTime: last(space?.protons.series10), fetchedAt: space?.protons.status.fetchedAt ?? null, message: space?.protons.status.error, href: "https://www.swpc.noaa.gov/products/goes-proton-flux", attribution: "NOAA SWPC / GOES" },
    { id: "noaa-kp", label: "NOAA planetary Kp", state: sourceState(last(space?.kp.series), meta.space.receivedAt, space?.kp.status.ok === false ? space.kp.status.error ?? "unavailable" : meta.space.error, STALE_AFTER_MS["noaa-kp"], now, online, space?.kp.status.ok !== false), dataTime: last(space?.kp.series), fetchedAt: space?.kp.status.fetchedAt ?? null, message: space?.kp.status.error, href: "https://www.swpc.noaa.gov/products/planetary-k-index", attribution: "NOAA SWPC" },
    { id: "nmdb", label: "Jungfraujoch · NMDB", state: sourceState(last(jung?.series), meta.reference.receivedAt, jung && !jung.ok ? jung.error ?? "unavailable" : meta.reference.error, STALE_AFTER_MS.nmdb, now, online, jung?.ok !== false), dataTime: last(jung?.series), fetchedAt: ref?.fetchedAt ?? null, message: jung?.error ?? meta.reference.error ?? undefined, href: "https://www.nmdb.eu/nest/", attribution: SOURCE_LINKS.nmdb.attribution },
    { id: "donki", label: "NASA DONKI", state: (() => { const s = sourceState(meta.events.receivedAt, meta.events.receivedAt, events?.status.ok === false ? events.status.error ?? "unavailable" : meta.events.error, STALE_AFTER_MS.donki, now, online, events?.status.ok !== false); return s === "live" ? "updated" : s; })(), dataTime: events?.status.fetchedAt ?? null, fetchedAt: meta.events.receivedAt, message: events?.status.error ?? meta.events.error ?? undefined, href: SOURCE_LINKS.donki.href, attribution: SOURCE_LINKS.donki.attribution },
  ];
  return statuses;
}
