import { describe, expect, it, vi } from "vitest";
import { actionIdempotencyKey, getAction, validateActionConfig } from "../src/lib/automation/actionRegistry.js";
import { registerDefaultActions } from "../src/lib/automation/defaultActions.js";
import { validateWorkflow } from "../src/lib/automation/workflowValidation.js";
import { unavailableWorkflowGateways } from "../src/lib/automation/workflowProviderGateways.js";

describe("workflow action durability contracts", () => {
  it("passes a stable idempotency key and AbortSignal to provider gateways", async () => {
    const execute = vi.fn(async ({ idempotencyKey, signal }: { idempotencyKey: string; signal: AbortSignal }) => ({ idempotencyKey, aborted: signal.aborted }));
    registerDefaultActions({ ai: { execute } });
    const action = getAction("INVOKE_AI");
    const controller = new AbortController();
    const idempotencyKey = actionIdempotencyKey("execution-1", "node-1");
    const result = await action?.({ businessId: "business-1", executionId: "execution-1", nodeId: "node-1", input: {}, idempotencyKey, signal: controller.signal }, { prompt: "Summarize" });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toMatchObject({ idempotencyKey, signal: controller.signal });
    expect(result).toEqual({ output: { idempotencyKey, aborted: false } });
  });

  it("rejects incomplete provider configs and unsafe action timeouts", () => {
    expect(validateActionConfig("INVOKE_MESSAGING", { to: "+15550000000" })).toContain("body is required");
    expect(validateActionConfig("INVOKE_AI", {})).toContain("prompt or input is required");
    expect(validateActionConfig("CREATE_TASK", { timeoutSeconds: 0 })).toContain("timeoutSeconds must be between 1 and 86400");
  });

  it("applies action configuration validation to the whole graph", () => {
    const result = validateWorkflow({ trigger: { type: "MANUAL" }, nodes: [{ id: "send", type: "action", config: { action: "INVOKE_MESSAGING", to: "+15550000000" }, next: [] }] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Invalid action send: body is required");
  });

  it("fails closed before network access when no idempotent provider is configured", async () => {
    const signal = new AbortController().signal;
    await expect(unavailableWorkflowGateways().messaging.execute({ context: { businessId: "b", executionId: "e", nodeId: "n", input: {}, idempotencyKey: "k", signal }, config: {}, idempotencyKey: "k", signal })).rejects.toThrow("messaging_idempotent_provider_not_configured");
  });
});
