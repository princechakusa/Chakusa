import type { FastifyRequest } from "fastify";

// A customer's "near me" search carries their position as ?lat=&lng= query
// parameters. Request logs are retained, so logging those URLs verbatim
// would quietly build a location history - which Chakusa never keeps (see
// the roadmap non-negotiables). Coordinates are redacted before any URL
// reaches the log; everything else about the request stays useful.

const LOCATION_PARAMS = new Set(["lat", "lng", "lon", "latitude", "longitude"]);

export function redactLocationFromUrl(url: string): string {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;
  const path = url.slice(0, queryStart);
  const query = url.slice(queryStart + 1);
  const redacted = query
    .split("&")
    .map((pair) => {
      const name = decodeURIComponentSafe(pair.split("=")[0] ?? "").toLowerCase();
      return LOCATION_PARAMS.has(name) ? `${pair.split("=")[0]}=[redacted]` : pair;
    })
    .join("&");
  return `${path}?${redacted}`;
}

function decodeURIComponentSafe(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

/** Pino request serializer: the default fields, with coordinates redacted from the URL. */
export function serializeRequestForLog(request: FastifyRequest) {
  return {
    method: request.method,
    url: redactLocationFromUrl(request.url),
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}
