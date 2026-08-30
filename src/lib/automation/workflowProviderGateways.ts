import type { IdempotentActionGateway } from "./defaultActions.js";
import { PermanentActionError } from "./actionRegistry.js";

/**
 * Fail-closed adapter used until a remotely idempotent provider is configured.
 * It deliberately performs no network operation: a provider that cannot
 * deduplicate the supplied key cannot safely participate in workflow retries.
 */
export class UnavailableWorkflowGateway implements IdempotentActionGateway {
  constructor(private readonly capability: "messaging" | "ai") {}
  async execute({ signal }: Parameters<IdempotentActionGateway["execute"]>[0]): Promise<never> {
    signal.throwIfAborted();
    throw new PermanentActionError(`${this.capability}_idempotent_provider_not_configured`);
  }
}

export function unavailableWorkflowGateways() {
  return { messaging: new UnavailableWorkflowGateway("messaging"), ai: new UnavailableWorkflowGateway("ai") };
}
