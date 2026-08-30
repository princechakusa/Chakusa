import type { MessagingProvider } from "./messagingProvider.js";

const providers = new Map<string, MessagingProvider>();

export function registerMessagingProvider(provider: MessagingProvider) {
  providers.set(provider.id, provider);
}

export function getMessagingProvider(id: string) {
  return providers.get(id);
}

export function clearMessagingProviders() {
  providers.clear();
}
