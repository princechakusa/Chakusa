import type { BusinessRole } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { ApiError } from "../../lib/errors.js";

export const AUTOMATION_PERMISSIONS = ["workflow.view","workflow.edit","workflow.publish","workflow.pause","workflow.resume","workflow.delete","conversation.view","conversation.reply","conversation.assign","conversation.takeover","provider.manage","ai.manage","automation.analytics"] as const;
export type AutomationPermission = typeof AUTOMATION_PERMISSIONS[number];
const OWNER = new Set<AutomationPermission>(AUTOMATION_PERMISSIONS);
const ADMIN = new Set<AutomationPermission>(AUTOMATION_PERMISSIONS.filter((permission) => !["workflow.delete","provider.manage","ai.manage"].includes(permission)));
const STAFF = new Set<AutomationPermission>(["workflow.view","conversation.view","conversation.reply","automation.analytics"]);
const ROLE_PERMISSIONS: Record<BusinessRole, ReadonlySet<AutomationPermission>> = { OWNER, ADMIN, STAFF };

export function requireAutomationPermission(request: FastifyRequest, permission: AutomationPermission) {
  if (!request.role || !ROLE_PERMISSIONS[request.role].has(permission)) throw ApiError.forbidden("You do not have permission to perform this automation action");
}
