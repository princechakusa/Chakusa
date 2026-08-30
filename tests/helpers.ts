import type { FastifyInstance } from "fastify";
import type { Plan, SubscriptionStatus } from "@prisma/client";
import { buildApp, type BuildAppOptions } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { assertDestructiveTestDatabaseAccessAllowed } from "./dbSafetyGuard.js";

export async function createTestApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = await buildApp(options);
  await app.ready();
  return app;
}

/**
 * Production Safety Phase 2.1: guarded before the first destructive
 * statement — see dbSafetyGuard.ts. This call must remain the very first
 * line of this function; nothing destructive may run before it.
 */
export async function resetDatabase() {
  assertDestructiveTestDatabaseAccessAllowed();
  // The admin audit ledger is protected by database triggers that reject
  // row-level UPDATE/DELETE. TRUNCATE is used only inside the independently
  // guarded local-test reset path; production application code has no such
  // operation.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "admin_audit_logs"');
  await prisma.$transaction([
    prisma.workflowExecutionEvent.deleteMany(),
    prisma.workflowExecution.deleteMany(),
    prisma.workflowVersion.deleteMany(),
    prisma.workflow.deleteMany(),
    prisma.workflowTemplate.deleteMany(),
    prisma.automationTask.deleteMany(),
    prisma.eventDelivery.deleteMany(),
    prisma.eventSubscription.deleteMany(),
    prisma.outboxEvent.deleteMany(),
    prisma.featureFlag.deleteMany(),
    prisma.workerHeartbeat.deleteMany(),
    prisma.weeklyOwnerReport.deleteMany(),
    prisma.publicBookingAccess.deleteMany(),
    prisma.bookingBlock.deleteMany(),
    prisma.appointmentPaymentTransaction.deleteMany(),
    prisma.appointment.deleteMany(),
    prisma.serviceMemberAssignment.deleteMany(),
    prisma.serviceOffering.deleteMany(),
    prisma.billingEvent.deleteMany(),
    prisma.teamInvitation.deleteMany(),
    prisma.activityEvent.deleteMany(),
    prisma.feedback.deleteMany(),
    prisma.reviewRequest.deleteMany(),
    prisma.reminder.deleteMany(),
    prisma.messageAttribution.deleteMany(),
    prisma.messagingCostEvent.deleteMany(),
    prisma.messageReceipt.deleteMany(),
    prisma.messageDispatchAttempt.deleteMany(),
    prisma.messageDispatch.deleteMany(),
    prisma.messageAttachment.deleteMany(),
    prisma.messageContent.deleteMany(),
    prisma.internalConversationNote.deleteMany(),
    prisma.conversationSLA.deleteMany(),
    prisma.conversationLifecycleEvent.deleteMany(),
    prisma.conversationAssignment.deleteMany(),
    prisma.conversationParticipant.deleteMany(),
    prisma.message.deleteMany(),
    prisma.conversation.deleteMany(),
    prisma.templateApprovalEvent.deleteMany(),
    prisma.providerTemplate.deleteMany(),
    prisma.messagingTemplateVersion.deleteMany(),
    prisma.messagingTemplate.deleteMany(),
    prisma.providerCredential.deleteMany(),
    prisma.messagingSender.deleteMany(),
    prisma.messagingChannelAccount.deleteMany(),
    prisma.suppression.deleteMany(),
    prisma.customerConsentEvent.deleteMany(),
    prisma.customerCommunicationPreference.deleteMany(),
    prisma.automationRun.deleteMany(),
    prisma.automationRule.deleteMany(),
    prisma.lead.deleteMany(),
    prisma.messageTemplate.deleteMany(),
    prisma.customerOptOut.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.businessMember.deleteMany(),
    prisma.deviceToken.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.authSession.deleteMany(),
    prisma.authChallenge.deleteMany(),
    prisma.authIdentity.deleteMany(),
    prisma.adminMembership.deleteMany(),
    prisma.platformSetting.deleteMany(),
    prisma.subscription.deleteMany(),
    prisma.business.deleteMany(),
    prisma.user.deleteMany(),
  ]);
}

interface RegisteredAccount {
  token: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  businessId: string;
}

export async function registerAccount(
  app: FastifyInstance,
  overrides: Partial<{ email: string; password: string; fullName: string; businessName: string }> = {},
): Promise<RegisteredAccount> {
  const email = overrides.email ?? `user-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

  const response = await app.inject({
    method: "POST",
    url: "/auth/register",
    payload: {
      email,
      password: overrides.password ?? "password123",
      fullName: overrides.fullName ?? "Test User",
      businessName: overrides.businessName ?? "Test Business",
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`Registration failed: ${response.body}`);
  }

  const body = response.json();
  return {
    token: body.token,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    userId: body.user.id,
    businessId: body.business.id,
  };
}

export function authHeader(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** Test-only: sets a business's plan directly in the database — there is no purchase endpoint. */
export async function setPlan(businessId: string, plan: Plan) {
  await prisma.subscription.update({ where: { businessId }, data: { plan } });
}

/** Test-only: sets a business's subscription status directly, bypassing real Apple/Google verification. */
export async function setSubscriptionStatus(businessId: string, status: SubscriptionStatus) {
  await prisma.subscription.update({ where: { businessId }, data: { status } });
}
