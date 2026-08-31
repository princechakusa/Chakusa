import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/prisma.js';
import { WORKER_HEARTBEAT_ID, workerHeartbeatHealthy } from '../src/worker/workerHeartbeat.js';
import { createTestApp, resetDatabase } from './helpers.js';

describe('worker production health', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('uses a bounded freshness window', () => {
    const now = new Date('2026-08-24T12:00:00.000Z');
    expect(workerHeartbeatHealthy(new Date('2026-08-24T11:59:00.000Z'), now)).toBe(true);
    expect(workerHeartbeatHealthy(new Date('2026-08-24T11:58:00.000Z'), now)).toBe(false);
    expect(workerHeartbeatHealthy(null, now)).toBe(false);
  });

  it('returns unavailable without a live worker and ok for a fresh heartbeat', async () => {
    const missing = await app.inject({ method: 'GET', url: '/health/worker' });
    expect(missing.statusCode).toBe(503);
    expect(missing.json()).toMatchObject({ status: 'unavailable', lastSuccessAt: null });

    const now = new Date();
    await prisma.workerHeartbeat.create({ data: { id: WORKER_HEARTBEAT_ID, startedAt: now, lastSuccessAt: now } });
    const healthy = await app.inject({ method: 'GET', url: '/health/worker' });
    expect(healthy.statusCode).toBe(200);
    expect(healthy.json().status).toBe('ok');
  });

  it('reports AI Platform health: ok with no providers, and the kill-switch state', async () => {
    const base = await app.inject({ method: 'GET', url: '/health/ai' });
    expect(base.statusCode).toBe(200);
    expect(base.json()).toMatchObject({ status: 'ok', aiKillSwitchEngaged: false });
    expect(Array.isArray(base.json().providers)).toBe(true);

    await prisma.platformSetting.create({ data: { key: 'ai_enabled', value: false } });
    const killed = await app.inject({ method: 'GET', url: '/health/ai' });
    expect(killed.statusCode).toBe(200);
    expect(killed.json().aiKillSwitchEngaged).toBe(true);
  });
});
