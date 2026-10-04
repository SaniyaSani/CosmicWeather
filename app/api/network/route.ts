import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { detectorEvents } from "@/db/schema";

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected network error";
  return message.includes("no such table") ? "The detector network is being prepared. Try again shortly." : message;
}

export async function GET(request: Request) {
  const wantsEvents = new URL(request.url).searchParams.get("events") === "1";
  if (wantsEvents) return recentEventTimes();
  try {
    const rows = await getDb().select().from(detectorEvents)
      .where(gte(detectorEvents.occurredAt, new Date(Date.now() - 15 * 60_000)))
      .orderBy(desc(detectorEvents.occurredAt)).limit(250);
    const stations = new Map<string, { id: string; name: string; latitude: number; longitude: number; events: number; lastSeen: number }>();
    for (const row of rows) {
      const current = stations.get(row.stationId);
      if (current) current.events += 1;
      else stations.set(row.stationId, { id: row.stationId, name: row.stationName, latitude: row.latitude, longitude: row.longitude, events: 1, lastSeen: row.occurredAt.getTime() });
    }
    return Response.json({ stations: [...stations.values()] });
  } catch (error) {
    return Response.json({ stations: [], error: errorMessage(error) }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    const stationId = String(payload.stationId ?? "").trim();
    const stationName = String(payload.stationName ?? "My detector").trim().slice(0, 48);
    const latitude = Number(payload.latitude); const longitude = Number(payload.longitude); const signal = Number(payload.signal);
    // Real detector pulses arrive as "audio"; anything else is stored as demo.
    const source = payload.source === "audio" ? "audio" : payload.source === "serial" ? "serial" : "demo";
    const occurredAt = new Date(Number(payload.occurredAt) || Date.now());
    if (!/^station-[a-z0-9-]{4,40}$/i.test(stationId)) return Response.json({ error: "Invalid station identifier" }, { status: 400 });
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return Response.json({ error: "Invalid station coordinates" }, { status: 400 });
    if (!Number.isFinite(signal) || signal < 0 || signal > 100) return Response.json({ error: "Signal must be between 0 and 100" }, { status: 400 });
    if (Math.abs(occurredAt.getTime() - Date.now()) > 10 * 60_000) return Response.json({ error: "Event time is outside the accepted window" }, { status: 400 });
    const [event] = await getDb().insert(detectorEvents).values({
      stationId, stationName: stationName || "My detector", latitude: Math.round(latitude * 100) / 100,
      longitude: Math.round(longitude * 100) / 100, signal, source, occurredAt,
    }).returning({ id: detectorEvents.id });
    return Response.json({ accepted: true, eventId: event.id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 503 });
  }
}

/**
 * Event timestamps of real (audio) detector pulses from the last 10 minutes,
 * grouped by station, for the coincidence viewer. Demo events are excluded.
 */
async function recentEventTimes() {
  try {
    const rows = await getDb().select({ stationId: detectorEvents.stationId, stationName: detectorEvents.stationName, occurredAt: detectorEvents.occurredAt })
      .from(detectorEvents)
      .where(and(gte(detectorEvents.occurredAt, new Date(Date.now() - 10 * 60_000)), eq(detectorEvents.source, "audio")))
      .orderBy(desc(detectorEvents.occurredAt)).limit(2000);
    const stations = new Map<string, { stationId: string; name: string; times: number[] }>();
    for (const row of rows) {
      const entry = stations.get(row.stationId) ?? { stationId: row.stationId, name: row.stationName, times: [] as number[] };
      entry.times.push(row.occurredAt.getTime());
      stations.set(row.stationId, entry);
    }
    return Response.json({ stations: [...stations.values()], windowMs: 10 * 60_000 });
  } catch (error) {
    return Response.json({ stations: [], error: errorMessage(error) }, { status: 503 });
  }
}
