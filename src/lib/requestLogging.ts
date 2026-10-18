import type { FastifyRequest } from "fastify";

// A customer's "near me" search carries their position as ?lat=&lng= query
// parameters. Request logs are retained, so logging those URLs verbatim
// would quietly build a location history - which Chakusa never keeps (see
// the roadmap non-negotiables). Coordinates are redacted before any URL
// reaches the log; everything else about the request stays useful.

const LOCATION_PARAMS = new Set(["lat", "lng", "lon", "latitude", "longitude"]);
const SECRET_PARAMS = /token|secret|password|authorization|api[-_]?key|signature|email|phone|name|address|notes|^code$|^state$|^q$|^query$|^search$/i;
const BEARER_PATH = /^(\/public\/(?:reviews|quotes|invoices|team-invites)|\/public\/calendar)\/[^/?]+/i;

export function redactLocationFromUrl(url: string): string {
  const queryStart = url.indexOf("?");
  const path = (queryStart === -1 ? url : url.slice(0, queryStart)).replace(BEARER_PATH, "$1/[redacted]");
  if (queryStart === -1) return path;
  const query = url.slice(queryStart + 1);
  const redacted = query
    .split("&")
    .map((pair) => {
      const name = decodeURIComponentSafe(pair.split("=")[0] ?? "").toLowerCase();
      return LOCATION_PARAMS.has(name) || SECRET_PARAMS.test(name) ? `${pair.split("=")[0]}=[redacted]` : pair;
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

/** Error messages, stacks and arbitrary SDK properties can embed request data. */
export function serializeErrorForLog(error: unknown): { type: string; message: string; stack: string; code?: string; statusCode?: number } {
  try {
    if (!error || typeof error !== "object") return { type: "Error", message: "[Redacted]", stack: "" };
    const candidate = error as { name?: unknown; code?: unknown; statusCode?: unknown };
    return {
      message: "[Redacted]", stack: "",
      type: typeof candidate.name === "string" && /^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(candidate.name) ? candidate.name : "Error",
      code: typeof candidate.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(candidate.code) ? candidate.code : undefined,
      statusCode: typeof candidate.statusCode === "number" && Number.isInteger(candidate.statusCode) && candidate.statusCode >= 100 && candidate.statusCode <= 599 ? candidate.statusCode : undefined,
    };
  } catch { return { type: "Error", message: "[Redacted]", stack: "" }; }
}
