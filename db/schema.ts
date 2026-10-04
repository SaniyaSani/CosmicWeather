import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const detectorEvents = sqliteTable(
  "detector_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    stationId: text("station_id").notNull(),
    stationName: text("station_name").notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    signal: real("signal").notNull(),
    source: text("source", { enum: ["demo", "serial", "audio"] }).notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("idx_detector_events_occurred_at").on(table.occurredAt),
    index("idx_detector_events_station_time").on(table.stationId, table.occurredAt),
  ],
);

/**
 * Optional local environmental sensor readings (e.g. BMP390 / BME280 next to
 * the detector). When recent readings exist they override API pressure.
 */
export const environmentReadings = sqliteTable(
  "environment_readings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    stationId: text("station_id").notNull(),
    sensorId: text("sensor_id").notNull(),
    pressureHpa: real("pressure_hpa").notNull(),
    temperatureC: real("temperature_c"),
    humidityPct: real("humidity_pct"),
    measuredAt: integer("measured_at", { mode: "timestamp_ms" }).notNull(),
    receivedAt: integer("received_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("idx_environment_station_time").on(table.stationId, table.measuredAt)],
);
