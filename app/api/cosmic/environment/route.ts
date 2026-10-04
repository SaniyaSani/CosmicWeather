import { env } from "cloudflare:workers";
import { and, asc, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { environmentReadings } from "@/db/schema";
import { DEFAULT_LOCATION } from "@/lib/cosmic/config";
import { errorText, jsonResponse } from "@/lib/cosmic/server/http";
import { weatherService } from "@/lib/cosmic/server/services";
import type { EnvironmentPayload, EnvironmentalState } from "@/lib/cosmic/types";

/** A local sensor overrides API pressure while its newest reading is younger than this. */
const SENSOR_FRESH_MS = 20 * 60_000;

function coordinate(value: string | null, fallback: number, limit: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : fallback;
}

async function sensorSeries(stationId: string): Promise<EnvironmentalState[]> {
  if (!/^station-[a-z0-9-]{4,40}$/i.test(stationId)) return [];
  try {
    const rows = await getDb().select().from(environmentReadings)
      .where(and(eq(environmentReadings.stationId, stationId), gte(environmentReadings.measuredAt, new Date(Date.now() - 8 * 86_400_000))))
      .orderBy(asc(environmentReadings.measuredAt)).limit(5000);
    return rows.map((row) => ({ timestamp: row.measuredAt.getTime(), pressureHpa: row.pressureHpa, temperatureC: row.temperatureC, humidityPct: row.humidityPct, source: "sensor" as const, sensorId: row.sensorId }));
  } catch { return []; } // table not migrated yet or DB unavailable → API pressure only
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const latitude = coordinate(params.get("lat"), DEFAULT_LOCATION.latitude, 90);
  const longitude = coordinate(params.get("lon"), DEFAULT_LOCATION.longitude, 180);
  const station = params.get("station") ?? "";
  const [api, sensor] = await Promise.all([
    weatherService(latitude, longitude).catch((error): EnvironmentPayload => ({ fetchedAt: Date.now(), latitude, longitude, elevationM: null, series: [], current: null, sensor: null, sensorSeries: [], source: "open-meteo", error: errorText(error) })),
    station ? sensorSeries(station) : Promise.resolve([]),
  ]);
  const latestSensor = sensor.at(-1) ?? null;
  const sensorFresh = latestSensor !== null && Date.now() - latestSensor.timestamp < SENSOR_FRESH_MS;
  const payload: EnvironmentPayload = {
    ...api,
    sensor: latestSensor,
    sensorSeries: sensor,
    source: sensorFresh ? "sensor" : "open-meteo",
    current: sensorFresh ? latestSensor : api.current,
  };
  const failed = !api.series.length && !sensorFresh;
  return jsonResponse(payload, 300, failed ? 503 : 200);
}

/**
 * Ingest endpoint for a physical barometer (BMP390, BME280 …).
 *
 *   POST /api/cosmic/environment
 *   Authorization: Bearer <SENSOR_INGEST_TOKEN>
 *   { "stationId": "station-xxxx", "sensorId": "bmp390-1", "pressureHpa": 964.7,
 *     "temperatureC": 21.3, "humidityPct": 41, "measuredAt": 1791100000000 }
 *
 * The token lives only in the Worker environment and is never sent to browsers.
 */
export async function POST(request: Request) {
  const token = env.SENSOR_INGEST_TOKEN;
  if (!token) return Response.json({ error: "Sensor ingest is not configured (SENSOR_INGEST_TOKEN missing)." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${token}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const stationId = String(body.stationId ?? "");
    const sensorId = String(body.sensorId ?? "sensor").slice(0, 40);
    const pressureHpa = Number(body.pressureHpa);
    const measuredAt = Number(body.measuredAt) || Date.now();
    const optional = (value: unknown, min: number, max: number) => { const n = Number(value); return value === undefined || value === null || !Number.isFinite(n) || n < min || n > max ? null : n; };
    if (!/^station-[a-z0-9-]{4,40}$/i.test(stationId)) return Response.json({ error: "Invalid stationId" }, { status: 400 });
    if (!Number.isFinite(pressureHpa) || pressureHpa < 300 || pressureHpa > 1100) return Response.json({ error: "pressureHpa must be 300–1100" }, { status: 400 });
    if (Math.abs(measuredAt - Date.now()) > 24 * 3_600_000) return Response.json({ error: "measuredAt outside ±24 h" }, { status: 400 });
    await getDb().insert(environmentReadings).values({
      stationId, sensorId, pressureHpa,
      temperatureC: optional(body.temperatureC, -60, 70), humidityPct: optional(body.humidityPct, 0, 100),
      measuredAt: new Date(measuredAt), receivedAt: new Date(),
    });
    return Response.json({ accepted: true }, { status: 201 });
  } catch (error) {
    return Response.json({ error: errorText(error) }, { status: 503 });
  }
}
