import { test } from "node:test";
import assert from "node:assert/strict";
import { tick } from "./worker.mjs";

test("posts to the tick endpoint with the bearer secret", async () => {
  let seen;
  const result = await tick({ API_BASE_URL: "https://api.example", WORKER_TRIGGER_SECRET: "s".repeat(40) }, async (url, init) => { seen = { url, init }; return { status: 202 }; });
  assert.equal(seen.url, "https://api.example/internal/worker/tick");
  assert.equal(seen.init.method, "POST");
  assert.equal(seen.init.headers.authorization, `Bearer ${"s".repeat(40)}`);
  assert.deepEqual(result, { ok: true, status: 202 });
});

test("does nothing without a secret", async () => {
  const result = await tick({ API_BASE_URL: "https://api.example" }, async () => { throw new Error("should not call"); });
  assert.equal(result.ok, false);
});

test("reports a refused tick", async () => {
  const result = await tick({ API_BASE_URL: "https://api.example", WORKER_TRIGGER_SECRET: "x".repeat(40) }, async () => ({ status: 401 }));
  assert.deepEqual(result, { ok: false, status: 401 });
});
