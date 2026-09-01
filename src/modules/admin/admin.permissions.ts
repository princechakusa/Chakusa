import type { AdminRole } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";

export const ADMIN_PERMISSIONS = [
  "platform.read",
  "business.read",
  "business.verify",
  "business.suspend",
  "business.onboarding.reset",
  "business.cohort.manage",
  "business.delete",
  "user.read",
  "user.disable",
  "user.session.revoke",
  "customer.read",
  "customer.manage",
  "marketplace.read",
  "marketplace.manage",
  "booking.read",
  "booking.manage",
  "loyalty.read",
  "loyalty.manage",
  "subscription.read",
  "subscription.manage",
  "automation.read",
  "automation.retry",
  "workflow.view",
  "workflow.edit",
  "workflow.publish",
  "workflow.pause",
  "workflow.resume",
  "workflow.delete",
  "conversation.view",
  "conversation.reply",
  "conversation.assign",
  "conversation.takeover",
  "provider.manage",
  "ai.manage",
  "automation.analytics",
  "communication.read",
  "communication.retry",
  "support.read",
  "support.manage",
  "feedback.read",
  "feedback.manage",
  "support.impersonate.read",
  "audit.read",
  "settings.read",
  "settings.manage",
  "admin.manage",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

const ALL = new Set<AdminPermission>(ADMIN_PERMISSIONS);

const READ_ONLY = new Set<AdminPermission>([
  "platform.read",
  "business.read",
  "user.read",
  "customer.read",
  "marketplace.read",
  "booking.read",
  "loyalty.read",
  "subscription.read",
  "automation.read",
  "workflow.view",
  "conversation.view",
  "automation.analytics",
  "communication.read",
  "support.read",
  "feedback.read",
  "audit.read",
  "settings.read",
]);

const ROLE_PERMISSIONS: Record<AdminRole, ReadonlySet<AdminPermission>> = {
  SUPER_ADMIN: ALL,
  PLATFORM_ADMIN: new Set([...ALL].filter((permission) => permission !== "admin.manage")),
  SUPPORT_AGENT: new Set([
    "platform.read",
    "business.read",
    "user.read",
    "customer.read",
    "marketplace.read",
    "booking.read",
    "loyalty.read",
    "customer.manage",
    "user.session.revoke",
    "subscription.read",
    "automation.read",
    "communication.read",
    "support.read",
    "support.manage",
    "feedback.read",
    "feedback.manage",
    "support.impersonate.read",
    "audit.read",
  ]),
  FINANCE: new Set([
    "platform.read",
    "business.read",
    "user.read",
    "subscription.read",
    "subscription.manage",
    "audit.read",
  ]),
  OPERATIONS: new Set([
    "platform.read",
    "business.read",
    "business.verify",
    "business.suspend",
    "business.onboarding.reset",
    "business.cohort.manage",
    "user.read",
    "customer.read",
    "marketplace.read",
    "marketplace.manage",
    "booking.read",
    "booking.manage",
    "loyalty.read",
    "loyalty.manage",
    "automation.read",
    "automation.retry",
    "workflow.view",
    "workflow.edit",
    "workflow.publish",
    "workflow.pause",
    "workflow.resume",
    "workflow.delete",
    "conversation.view",
    "conversation.reply",
    "conversation.assign",
    "conversation.takeover",
    "provider.manage",
    "ai.manage",
    "automation.analytics",
    "communication.read",
    "communication.retry",
    "support.read",
    "support.manage",
    "feedback.read",
    "feedback.manage",
    "audit.read",
    "settings.read",
  ]),
  READ_ONLY,
};

export function permissionsForAdminRole(role: AdminRole): readonly AdminPermission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function adminRoleHasPermission(role: AdminRole, permission: AdminPermission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function requireAdminPermission(role: AdminRole, permission: AdminPermission): void {
  if (!adminRoleHasPermission(role, permission)) {
    throw ApiError.forbidden("You do not have permission to perform this admin action");
  }
}
