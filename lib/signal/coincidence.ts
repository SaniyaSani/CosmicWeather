/**
 * Network coincidence search on event timestamps.
 *
 * Browser timestamps come from unsynchronised computer clocks, so realistic
 * windows are hundreds of milliseconds, not the ~100 ns used by physics
 * experiments with GPS-disciplined clocks. The UI always shows the expected
 * accidental-coincidence rate next to any candidate.
 */
export type StationEvents = { stationId: string; name: string; times: number[]; local?: boolean };

export type CoincidenceCluster = { at: number; spanMs: number; stations: string[]; times: Record<string, number> };

export function findCoincidences(stations: StationEvents[], windowMs: number, minStations = 2): CoincidenceCluster[] {
  const all = stations.flatMap((station) => station.times.map((time) => ({ time, stationId: station.stationId }))).sort((a, b) => a.time - b.time);
  const clusters: CoincidenceCluster[] = [];
  let index = 0;
  while (index < all.length) {
    const start = all[index].time;
    const members = new Map<string, number>();
    let cursor = index;
    while (cursor < all.length && all[cursor].time - start <= windowMs) {
      if (!members.has(all[cursor].stationId)) members.set(all[cursor].stationId, all[cursor].time);
      cursor += 1;
    }
    if (members.size >= minStations) {
      const times = Object.fromEntries(members);
      const values = [...members.values()];
      clusters.push({ at: start, spanMs: Math.max(...values) - Math.min(...values), stations: [...members.keys()], times });
      index = cursor;
    } else index += 1;
  }
  return clusters;
}

/**
 * Expected accidental rate for an n-fold coincidence of independent Poisson
 * streams with rates r_i (Hz) and resolving window τ (s): n · τ^(n−1) · Π r_i.
 */
export function accidentalRateHz(ratesHz: number[], windowS: number) {
  if (ratesHz.length < 2) return 0;
  return ratesHz.length * Math.pow(windowS, ratesHz.length - 1) * ratesHz.reduce((product, rate) => product * rate, 1);
}

export function ratesFromTimes(times: number[], spanMs: number) {
  return spanMs > 0 ? times.length / (spanMs / 1000) : 0;
}
