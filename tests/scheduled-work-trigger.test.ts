import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { config } from '../src/lib/config.js';
import { prisma } from '../src/lib/prisma.js';
import { createTestApp, resetDatabase } from './helpers.js';

// #23 — one sweep is forced to throw so we can prove the cycle isolates it.
vi.mock('../src/modules/reviews/reviewAutomation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/modules/reviews/reviewAutomation.js')>();
  return { ...actual, sendDueReviewRequests: vi.fn().mockRejectedValue(new Error('injected review-request failure')) };
});
const { runTriggeredScheduledWork } = await import('../src/worker/scheduledWorkTrigger.js');

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
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'accepted' });
    await vi.waitFor(async () => expect(await prisma.workerHeartbeat.findUnique({ where: { id: 'automation-worker' } })).not.toBeNull());
  });

  it('#23: isolates a failing step — the cycle finishes and still heartbeats', async () => {
    const result = await runTriggeredScheduledWork();
    // the injected sendDueReviewRequests throw was caught, counted, not fatal
    expect(result.failedSteps).toBeGreaterThanOrEqual(1);
    expect(result.skipped).toBe(false);
    // every later step still ran and the heartbeat was still written
    const heartbeat = await prisma.workerHeartbeat.findUnique({ where: { id: 'automation-worker' } });
    expect(heartbeat?.lastSuccessAt).not.toBeNull();
  });
});
