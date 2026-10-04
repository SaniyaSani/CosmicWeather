"use client";

import type { Station, ThresholdPoint } from "@/lib/signal/types";

export function NetworkMap({ stations, localStationId }: { stations: Station[]; localStationId: string }) {
  const project = (station: Station) => ({ x: 5 + ((station.longitude - 5.8) / 4.2) * 90, y: 88 - ((station.latitude - 45.7) / 2.1) * 76 });
  return (
    <div className="network-map" role="img" aria-label="Map of connected cosmic-ray detector stations in Switzerland">
      <svg className="swiss-outline" viewBox="0 0 900 360" aria-hidden="true">
        <path d="M79 180L130 131L202 126L241 83L320 97L356 65L438 87L488 62L548 104L631 95L689 134L754 146L811 198L780 239L706 250L671 294L582 281L533 316L447 287L383 299L324 263L235 274L191 235L116 233Z" />
        <path className="contour" d="M160 184C250 135 334 169 418 133S594 141 739 194" />
        <path className="contour" d="M203 229C306 200 378 238 474 197S624 200 705 236" />
      </svg>
      <div className="map-grid" aria-hidden="true" />
      {stations.map((station) => {
        const point = project(station);
        return <div className={`station-marker ${station.id === localStationId ? "is-local" : ""}`} key={station.id} style={{ left: `${point.x}%`, top: `${point.y}%` }}>
          <span className="station-pulse" /><span className="station-dot" />
          <span className="station-label">{station.name}<small>{station.sample ? "sample" : "live"}</small></span>
        </div>;
      })}
      <span className="map-caption">46–48° N · Swiss open detector network</span>
    </div>
  );
}

export function ThresholdSweep({ points, chosen }: { points: ThresholdPoint[]; chosen: number }) {
  if (!points.length) return <div className="threshold-sweep empty"><span>Run automatic calibration to map the noise-trigger curve.</span></div>;
  const shown = points.filter((_, index) => index % 2 === 0);
  const maximum = Math.max(...shown.map((point) => point.rate), .001);
  return <div className="threshold-sweep" role="img" aria-label={`Noise trigger rate by threshold; ${chosen.toFixed(1)} sigma selected`}>
    {shown.map((point) => <span key={point.sigma} className={Math.abs(point.sigma - chosen) < .26 ? "chosen" : ""} style={{ height: `${Math.max(5, (point.rate / maximum) * 100)}%` }} title={`${point.sigma.toFixed(0)}σ · ${point.rate.toFixed(3)} Hz`} />)}
  </div>;
}
