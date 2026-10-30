/**
 * Disclosure shown before any personal data goes to a third-party AI model
 * (App Store Review Guideline 5.1.2(i); Google Play User Data policy). Must
 * name what is sent, to whom and why, and match the server: the AI Platform
 * sends the conversation plus the account data a tool reads to the configured
 * model provider (OpenAI, Anthropic or Google), and nothing is sent until the
 * person agrees.
 */
export type AiDataSharingKey = 'customerAssistant' | 'businessReceptionist';

export interface AiDataSharingDisclosure {
  title: string;
  body: string;
  accept: string;
  decline: string;
}

export const AI_PROVIDER_NAMES = 'OpenAI, Anthropic or Google';

export function aiDataSharingDisclosure(key: AiDataSharingKey): AiDataSharingDisclosure {
  if (key === 'customerAssistant') {
    return {
      title: 'Before you chat with the assistant',
      body: `The Chakusa assistant is powered by a third-party AI provider (${AI_PROVIDER_NAMES}). `
        + 'To answer you, Chakusa sends that provider what you type, plus the details it needs from your account, such as your bookings, '
        + 'favourite places and the businesses you ask about. The provider uses it to generate the reply. '
        + 'Don\'t share passwords or card numbers in the chat. You can keep using Chakusa without the assistant.',
      accept: 'I agree',
      decline: 'Not now',
    };
  }
  return {
    title: 'Turn on the AI receptionist?',
    body: `The AI receptionist is powered by a third-party AI provider (${AI_PROVIDER_NAMES}). `
      + 'When it answers, Chakusa sends that provider your customer\'s message, the conversation so far, and your business details, '
      + 'services, hours and availability. The provider uses it to generate the reply. '
      + 'You are responsible for telling your customers that replies may come from AI; you can turn this off at any time.',
    accept: 'Turn on',
    decline: 'Cancel',
  };
}

/** SecureStore keys allow only [A-Za-z0-9._-]; the consent belongs to one signed-in person. */
export function aiConsentStorageKey(key: AiDataSharingKey, userId: string): string {
  return `chakusa.ai-consent.${key}.${userId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}
