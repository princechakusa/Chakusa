/**
 * Provider-agnostic push-sending contract. A concrete implementation (e.g.
 * ExpoPushProvider) is the only place that knows about a specific push
 * service's HTTP API, token format, or error codes — business logic should
 * only ever depend on this interface.
 */

export interface PushMessage {
  title?: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushSendResult {
  /** The device token this result corresponds to. */
  token: string;
  /** True if the provider accepted the message for delivery. */
  accepted: boolean;
  /**
   * True if the provider indicated the token is permanently invalid (e.g.
   * the app was uninstalled) and should be deactivated. False for
   * transient failures that should not deactivate the token.
   */
  invalidToken: boolean;
  /** Provider-reported error message, if any, for logging/debugging. */
  error?: string;
}

export interface PushProvider {
  /** Returns true if the given string is a token this provider can send to. */
  isValidToken(token: string): boolean;

  sendToDevice(token: string, message: PushMessage): Promise<PushSendResult>;

  sendToDevices(tokens: string[], message: PushMessage): Promise<PushSendResult[]>;
}
