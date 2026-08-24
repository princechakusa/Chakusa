import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/prisma.js';
import { createSession } from '../src/modules/auth/auth.service.js';
import { authHeader, createTestApp, registerAccount, resetDatabase, setPlan, setSubscriptionStatus } from './helpers.js';

describe('business ownership transfer', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('requires exact confirmation and atomically transfers authority to an active member', async () => {
    const owner = await registerAccount(app, { email: 'transfer-owner@example.com', businessName: 'Acme Studio' });
    await setPlan(owner.businessId, 'BUSINESS');
    await setSubscriptionStatus(owner.businessId, 'ACTIVE');
    const user = await prisma.user.create({ data: { email: 'next-owner@example.com', normalizedEmail: 'next-owner@example.com', fullName: 'Next Owner' } });
    const member = await prisma.businessMember.create({ data: { businessId: owner.businessId, userId: user.id, role: 'ADMIN' } });
    const { session } = await createSession(user.id, prisma);
    const targetToken = app.jwt.sign({ userId: user.id, sessionId: session.id, type: 'access' }, { expiresIn: 900 });

    const rejected = await app.inject({ method: 'POST', url: '/team/ownership-transfer', headers: authHeader(owner.token), payload: { memberId: member.id, businessName: 'Wrong name' } });
    expect(rejected.statusCode).toBe(400);

    const transferred = await app.inject({ method: 'POST', url: '/team/ownership-transfer', headers: authHeader(owner.token), payload: { memberId: member.id, businessName: 'Acme Studio' } });
    expect(transferred.statusCode).toBe(200);
    expect(transferred.json()).toMatchObject({ previousOwnerUserId: owner.userId, ownerUserId: user.id });
    expect(await prisma.business.findUniqueOrThrow({ where: { id: owner.businessId } })).toMatchObject({ ownerId: user.id });
    expect(await prisma.businessMember.findFirstOrThrow({ where: { businessId: owner.businessId, userId: owner.userId } })).toMatchObject({ role: 'ADMIN' });
    expect(await prisma.businessMember.findFirstOrThrow({ where: { id: member.id } })).toMatchObject({ role: 'OWNER' });

    const oldContext = await app.inject({ method: 'GET', url: '/auth/me', headers: authHeader(owner.token) });
    const newContext = await app.inject({ method: 'GET', url: '/auth/me', headers: authHeader(targetToken) });
    expect(oldContext.json().role).toBe('ADMIN');
    expect(newContext.json().role).toBe('OWNER');
  });
});
