import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { config } from '../src/lib/config.js';
import { prisma } from '../src/lib/prisma.js';
import { createTestApp, resetDatabase } from './helpers.js';

describe('secure scheduled-work HTTP trigger', () => {
  let app: FastifyInstance;
  const originalSecret = config.WORKER_TRIGGER_SECRET;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(async () => { config.WORKER_TRIGGER_SECRET = originalSecret; await resetDatabase(); });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('is undiscoverable when not configured', async () => {
    config.WORKER_TRIGGER_SECRET = undefined;
    const response = await app.inject({ method: 'POST', url: '/internal/worker/tick' });
    expect(response.statusCode).toBe(404);
  });

  it('rejects an incorrect bearer secret', async () => {
    config.WORKER_TRIGGER_SECRET = 'correct-secret-that-is-at-least-32-characters';
    const response = await app.inject({ method: 'POST', url: '/internal/worker/tick', headers: { authorization: 'Bearer incorrect-secret' } });
    expect(response.statusCode).toBe(401);
  });

  it('runs a bounded cycle and records a healthy heartbeat', async () => {
    const secret = 'correct-secret-that-is-at-least-32-characters';
    config.WORKER_TRIGGER_SECRET = secret;
    const response = await app.inject({ method: 'POST', url: '/internal/worker/tick', headers: { authorization: `Bearer ${secret}` } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', processed: 0, recovered: 0, remindersSent: 0 });
    expect(await prisma.workerHeartbeat.findUnique({ where: { id: 'automation-worker' } })).not.toBeNull();
  });
});
