import { jsonResponse } from "@/lib/cosmic/server/http";
import { noaaService } from "@/lib/cosmic/server/services";

/** NOAA SWPC: planetary Kp, GOES X-ray flux, GOES protons, flares and alerts. */
export async function GET() {
  const payload = await noaaService();
  const anyOk = [payload.kp, payload.xray, payload.protons, payload.flares, payload.alerts].some((feed) => feed.status.ok);
  return jsonResponse(payload, 60, anyOk ? 200 : 503);
}
