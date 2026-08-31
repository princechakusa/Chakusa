import type { MessagingProvider } from "./messagingProvider.js";
import type { CredentialVerifier, ProviderTemplateSynchronizer } from "./messagingOperations.js";

const providers = new Map<string, MessagingProvider>();
const credentialVerifiers = new Map<string, CredentialVerifier>();
const templateSynchronizers = new Map<string, ProviderTemplateSynchronizer>();

export function registerMessagingProvider(provider: MessagingProvider) {
  providers.set(provider.id, provider);
}

export function getMessagingProvider(id: string) {
  return providers.get(id);
}
/** Provider adapters opt in to secret verification and template synchronization.
 * The core never invents a successful remote result when an adapter is absent. */
export function registerProviderOperations(id: string, operations: { credentialVerifier?: CredentialVerifier; templateSynchronizer?: ProviderTemplateSynchronizer }) { if (operations.credentialVerifier) credentialVerifiers.set(id, operations.credentialVerifier); if (operations.templateSynchronizer) templateSynchronizers.set(id, operations.templateSynchronizer); }
export function getProviderCredentialVerifier(id: string) { return credentialVerifiers.get(id); }
export function getProviderTemplateSynchronizer(id: string) { return templateSynchronizers.get(id); }

export function clearMessagingProviders() {
  providers.clear();
  credentialVerifiers.clear();
  templateSynchronizers.clear();
}
