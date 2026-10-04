declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** Optional shared secret for POST /api/cosmic/environment (local barometer ingest). Server-only. */
    SENSOR_INGEST_TOKEN?: string;
  }
}
