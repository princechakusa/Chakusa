import { prisma } from '../../lib/prisma.js';

/** Owner-requested portability export. Authentication, billing-provider, push-token,
 * and encrypted messaging-credential records are deliberately outside this boundary. */
export async function exportBusinessData(businessId: string) {
  const [business, members, customers, appointments, leads, messages, reviewRequests, feedback, reminders, templates, automationRules, automationRuns] = await Promise.all([
    prisma.business.findUniqueOrThrow({ where: { id: businessId }, select: { id: true, name: true, industry: true, phone: true, country: true, timezone: true, currency: true, googleReviewLink: true, description: true, workingHours: true, defaultServices: true, reminderDays: true, preferredTone: true, publicSlug: true, onboardingCompletedAt: true, createdAt: true, updatedAt: true } }),
    prisma.businessMember.findMany({ where: { businessId }, select: { id: true, role: true, status: true, createdAt: true, user: { select: { id: true, fullName: true, email: true } } }, orderBy: { createdAt: 'asc' } }),
    prisma.customer.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } }),
    prisma.appointment.findMany({ where: { businessId }, orderBy: { startsAt: 'asc' } }),
    prisma.lead.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } }),
    prisma.message.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } }),
    prisma.reviewRequest.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } }),
    prisma.feedback.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } }),
    prisma.reminder.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } }),
    prisma.messageTemplate.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } }),
    prisma.automationRule.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } }),
    prisma.automationRun.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } }),
  ]);
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), business, members, customers, appointments, leads, messages, reviewRequests, feedback, reminders, messageTemplates: templates, automationRules, automationRuns };
}
