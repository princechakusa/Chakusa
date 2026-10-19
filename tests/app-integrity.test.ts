import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { config } from "../src/lib/config.js";
import { integrityRejections, type IntegrityPayload } from "../src/modules/appIntegrity/appIntegrity.service.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

const GOOD_CERT = "sNHWo3dVYdWQnzrzjF6DUjGwjXQqGcOa2DZ4Uh0J1Yo";
let nextPayload: (nonce: string) => IntegrityPayload;
const genuine = (nonce: string): IntegrityPayload => ({
  requestDetails: { requestPackageName: "com.chakusa.mobile", nonce, timestampMillis: String(Date.now()) },
  appIntegrity: { appRecognitionVerdict: "PLAY_RECOGNIZED", packageName: "com.chakusa.mobile", certificateSha256Digest: [GOOD_CERT] },
  deviceIntegrity: { deviceRecognitionVerdict: ["MEETS_DEVICE_INTEGRITY"] },
});

// The fake decoder plays Google: the "integrity token" the test sends is the
// nonce the app was given, and the decoder returns whatever verdict the test chose.
const integrityDecoder = async (token: string) => nextPayload(token);

const android = { "x-chakusa-client": "android" };

describe("Play Integrity attestation", () => {
  let app: FastifyInstance;
  const original = { mode: config.PLAY_INTEGRITY_MODE, certs: config.PLAY_INTEGRITY_CERT_SHA256 };

  beforeAll(async () => {
    app = await createTestApp({ integrityDecoder });
  });
  afterEach(async () => {
    config.PLAY_INTEGRITY_MODE = original.mode;
    config.PLAY_INTEGRITY_CERT_SHA256 = original.certs;
    nextPayload = genuine;
    await resetDatabase();
  });
  afterAll(async () => { await app.close(); });

  const setMode = (mode: "off" | "report" | "enforce") => { config.PLAY_INTEGRITY_MODE = mode; config.PLAY_INTEGRITY_CERT_SHA256 = GOOD_CERT; };
  const challenge = async () => (await app.inject({ method: "POST", url: "/app-integrity/challenge" })).json() as { challenge: string; nonce: string };
  const attest = async (body: { challenge: string; integrityToken: string }) => app.inject({ method: "POST", url: "/app-integrity/attest", payload: body });
  const login = (headers: Record<string, string>, email: string) => app.inject({ method: "POST", url: "/auth/login", headers, payload: { email, password: "password123" } });

  it("is invisible while off: no endpoints, and Android sign-in is not gated", async () => {
    setMode("off");
    expect((await app.inject({ method: "POST", url: "/app-integrity/challenge" })).statusCode).toBe(404);
    const account = await registerAccount(app, { email: "off@example.com" });
    expect(account.userId).toBeTruthy();
    expect((await login(android, "off@example.com")).statusCode).toBe(200);
  });

  it("issues an attestation only for a genuine Play-recognized build on a real device", async () => {
    setMode("enforce");
    nextPayload = genuine;
    const { challenge: c, nonce } = await challenge();
    const response = await attest({ challenge: c, integrityToken: nonce });
    expect(response.statusCode).toBe(200);
    expect(response.json().attestation).toEqual(expect.any(String));
  });

  it.each([
    ["re-signed clone", (n: string) => ({ ...genuine(n), appIntegrity: { ...genuine(n).appIntegrity, certificateSha256Digest: ["attackerCertDigest"] } })],
    ["sideloaded or modified build", (n: string) => ({ ...genuine(n), appIntegrity: { ...genuine(n).appIntegrity, appRecognitionVerdict: "UNRECOGNIZED_VERSION" } })],
    ["emulator or rooted device", (n: string) => ({ ...genuine(n), deviceIntegrity: { deviceRecognitionVerdict: [] } })],
    ["token bound to another nonce", (n: string) => genuine(`${n}-replayed`)],
    ["different package", (n: string) => ({ ...genuine(n), requestDetails: { ...genuine(n).requestDetails, requestPackageName: "com.clone.app" } })],
  ])("refuses an attestation for a %s", async (_label, payload) => {
    setMode("enforce");
    nextPayload = payload;
    const { challenge: c, nonce } = await challenge();
    const response = await attest({ challenge: c, integrityToken: nonce });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("APP_NOT_GENUINE");
  });

  it("refuses a forged or tampered challenge", async () => {
    setMode("enforce");
    const { challenge: c, nonce } = await challenge();
    const tampered = `${c.slice(0, -4)}AAAA`;
    expect((await attest({ challenge: tampered, integrityToken: nonce })).statusCode).toBe(403);
  });

  it("enforce: Android sign-in needs an attestation; web sign-in is not gated", async () => {
    setMode("enforce");
    await registerAccount(app, { email: "enforce@example.com" });
    const refused = await login(android, "enforce@example.com");
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe("APP_NOT_GENUINE");
    // Dropping the header doesn't help: an OkHttp user agent is treated as Android.
    expect((await login({ "user-agent": "okhttp/4.12.0" }, "enforce@example.com")).statusCode).toBe(403);
    expect((await login({ "x-chakusa-attestation": "not-a-real-attestation", ...android }, "enforce@example.com")).statusCode).toBe(403);

    const { challenge: c, nonce } = await challenge();
    const { attestation } = (await attest({ challenge: c, integrityToken: nonce })).json();
    expect((await login({ ...android, "x-chakusa-attestation": attestation }, "enforce@example.com")).statusCode).toBe(200);
    expect((await login({ "user-agent": "Mozilla/5.0" }, "enforce@example.com")).statusCode).toBe(200);
  });

  it("report: logs but never blocks", async () => {
    setMode("report");
    await registerAccount(app, { email: "report@example.com" });
    expect((await login(android, "report@example.com")).statusCode).toBe(200);
  });

  it("names every reason a verdict fails", () => {
    config.PLAY_INTEGRITY_CERT_SHA256 = GOOD_CERT;
    expect(integrityRejections(genuine("n1"), "n1")).toEqual([]);
    expect(integrityRejections({}, "n1")).toEqual(expect.arrayContaining([
      "package_mismatch", "nonce_mismatch", "stale_token", "app_not_play_recognized", "app_package_mismatch", "signing_certificate_mismatch", "device_integrity_failed",
    ]));
    const old = { ...genuine("n1"), requestDetails: { ...genuine("n1").requestDetails, timestampMillis: String(Date.now() - 60 * 60 * 1000) } };
    expect(integrityRejections(old, "n1")).toEqual(["stale_token"]);
  });
});
