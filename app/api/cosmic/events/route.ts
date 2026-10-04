import { jsonResponse } from "@/lib/cosmic/server/http";
import { nasaDonkiService } from "@/lib/cosmic/server/services";

/** NASA CCMC DONKI: CMEs (with modelled arrivals), flares, SEPs, interplanetary shocks, geomagnetic storms. */
export async function GET() {
  const payload = await nasaDonkiService();
  return jsonResponse(payload, 900, payload.status.ok ? 200 : 503);
}
