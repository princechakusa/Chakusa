export interface ActionContext { businessId: string; executionId: string; nodeId: string; input: unknown; idempotencyKey: string; signal: AbortSignal; }
export interface ActionResult { output?: unknown; directive?: "PAUSE" | "COMPLETE"; }
export type ActionHandler = (context: ActionContext, config: Record<string, unknown>) => Promise<ActionResult | unknown>;
export class PermanentActionError extends Error { readonly permanent = true; }
const actions = new Map<string, ActionHandler>();
export function registerAction(name: string, handler: ActionHandler) { actions.set(name, handler); }
export function getAction(name: string) { return actions.get(name); }
export const ACTION_NAMES = ["UPDATE_CUSTOMER","UPDATE_LEAD","UPDATE_APPOINTMENT","CREATE_NOTIFICATION","CREATE_TASK","ESCALATE","ASSIGN_STAFF","PAUSE_WORKFLOW","RESUME_WORKFLOW","COMPLETE_WORKFLOW","INVOKE_MESSAGING","INVOKE_AI"] as const;

export function actionIdempotencyKey(executionId: string, nodeId: string) { return `workflow:${executionId}:node:${nodeId}`; }

export function validateActionConfig(name: string, config: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const text = (key: string, required = false) => { if (required && (typeof config[key] !== "string" || !String(config[key]).trim())) errors.push(`${key} is required`); else if (config[key] !== undefined && typeof config[key] !== "string") errors.push(`${key} must be a string`); };
  if (["UPDATE_CUSTOMER","UPDATE_LEAD","UPDATE_APPOINTMENT"].includes(name)) { if (!config.changes || typeof config.changes !== "object" || Array.isArray(config.changes) || !Object.keys(config.changes).length) errors.push("changes are required"); text("targetId"); }
  if (name === "ASSIGN_STAFF") { text("memberId", true); text("targetId"); }
  if (["CREATE_TASK","ESCALATE"].includes(name)) { text("title"); text("description"); text("assignedMemberId"); if (config.dueAt !== undefined && Number.isNaN(Date.parse(String(config.dueAt)))) errors.push("dueAt must be a valid date"); }
  if (name === "CREATE_NOTIFICATION") { text("title"); text("body"); text("assignedMemberId"); text("userId"); }
  if (name === "INVOKE_MESSAGING") { text("to", true); text("body", true); text("provider"); }
  if (name === "INVOKE_AI") { if (config.prompt === undefined && config.input === undefined) errors.push("prompt or input is required"); text("provider"); }
  if (name === "RESUME_WORKFLOW") text("executionId");
  if (config.timeoutSeconds !== undefined && (!Number.isFinite(Number(config.timeoutSeconds)) || Number(config.timeoutSeconds) < 1 || Number(config.timeoutSeconds) > 86_400)) errors.push("timeoutSeconds must be between 1 and 86400");
  return errors;
}
