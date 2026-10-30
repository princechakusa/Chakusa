// Keeps scheduled work flowing on a sleeping (free) API host: every 5 minutes
// it calls POST /internal/worker/tick, which wakes the API and runs one
// bounded cycle (missed-call follow-ups, reminders, review requests, queued
// replies). The secret lives only in Cloudflare (wrangler secret) and Render.

export async function tick(env, fetchImpl = fetch) {
  if (!env.WORKER_TRIGGER_SECRET) return { ok: false, status: 0, reason: "missing secret" };
  const response = await fetchImpl(`${env.API_BASE_URL}/internal/worker/tick`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.WORKER_TRIGGER_SECRET}` },
  });
  return { ok: response.status === 202, status: response.status };
}

export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(tick(env).then((result) => { if (!result.ok) console.error("worker tick failed", result); }));
  },
};
