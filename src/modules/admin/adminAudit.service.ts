import { Prisma, type AdminRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

type DatabaseClient = typeof prisma | Prisma.TransactionClient;

const SENSITIVE_KEY = /password|token|secret|hash|credential|authorization|cookie/i;

function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (depth >= 8) return "[MAX_DEPTH]";
  if (typeof value === "string") return value.length > 4_000 ? `${value.slice(0, 4_000)}[TRUNCATED]` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeAuditValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[REDACTED]" : sanitizeAuditValue(item, depth + 1)]),
    );
  }
  return String(value);
}

function auditJson(value: unknown): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  if (value === null || value === undefined) return Prisma.JsonNull;
  return sanitizeAuditValue(value) as Prisma.InputJsonValue;
}

export interface AdminAuditActor {
  membershipId: string;
  userId: string;
  email: string;
  role: AdminRole;
}

export interface AdminAuditContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

export interface RecordAdminAuditInput {
  actor: AdminAuditActor;
  action: string;
  targetType: string;
  targetId?: string;
  oldValue?: unknown;
  newValue?: unknown;
  context?: AdminAuditContext;
}

export function recordAdminAudit(input: RecordAdminAuditInput, db: DatabaseClient = prisma) {
  return db.adminAuditLog.create({
    data: {
      adminMembershipId: input.actor.membershipId,
      adminUserId: input.actor.userId,
      adminEmail: input.actor.email,
      adminRole: input.actor.role,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      oldValue: input.oldValue === undefined ? undefined : auditJson(input.oldValue),
      newValue: input.newValue === undefined ? undefined : auditJson(input.newValue),
      ipAddress: input.context?.ipAddress,
      userAgent: input.context?.userAgent,
      requestId: input.context?.requestId,
    },
  });
}
