import { jsonResponse } from "@/lib/cosmic/server/http";
import { nmdbService } from "@/lib/cosmic/server/services";

/** NMDB neutron monitors (Jungfraujoch first), hourly, pressure- and efficiency-corrected. */
export async function GET() {
  const payload = await nmdbService();
  return jsonResponse(payload, 300, payload.stations.some((station) => station.ok) ? 200 : 503);
}
