import type { AdminRole } from "@prisma/client";
import { ApiError } from "../../lib/errors.js";

export const ADMIN_PERMISSIONS = [
  "platform.read",
  "business.read",
  "business.verify",
  "business.suspend",
  "business.onboarding.reset",
  "business.delete",
  "user.read",
  "user.disable",
  "user.session.revoke",
  "subscription.read",
  "subscription.manage",
  "automation.read",
  "automation.retry",
  "communication.read",
  "communication.retry",
  "support.read",
  "support.manage",
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
  "subscription.read",
  "automation.read",
  "communication.read",
  "support.read",
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
    "user.session.revoke",
    "subscription.read",
    "automation.read",
    "communication.read",
    "support.read",
    "support.manage",
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
    "user.read",
    "automation.read",
    "automation.retry",
    "communication.read",
    "communication.retry",
    "support.read",
    "support.manage",
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
