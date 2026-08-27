import { Expo, type ExpoPushMessage, type ExpoPushTicket } from "expo-server-sdk";
import { config } from "../config.js";
import type { PushMessage, PushProvider, PushSendResult } from "./pushProvider.js";

const expo = new Expo({ accessToken: config.EXPO_ACCESS_TOKEN });

function ticketToResult(token: string, ticket: ExpoPushTicket): PushSendResult {
  if (ticket.status === "ok") {
    return { token, accepted: true, invalidToken: false };
  }
  return {
    token,
    accepted: false,
    invalidToken: ticket.details?.error === "DeviceNotRegistered",
    error: ticket.message,
  };
}

export class ExpoPushProvider implements PushProvider {
  isValidToken(token: string): boolean {
    return Expo.isExpoPushToken(token);
  }

  async sendToDevice(token: string, message: PushMessage): Promise<PushSendResult> {
    const [result] = await this.sendToDevices([token], message);
    return result!;
  }

  async sendToDevices(tokens: string[], message: PushMessage): Promise<PushSendResult[]> {
    const validTokens = tokens.filter((token) => this.isValidToken(token));
    const invalidResults: PushSendResult[] = tokens
      .filter((token) => !this.isValidToken(token))
      .map((token) => ({ token, accepted: false, invalidToken: true, error: "Not a valid Expo push token" }));

    if (validTokens.length === 0) {
      return invalidResults;
    }

    const messages: ExpoPushMessage[] = validTokens.map((token) => ({
      to: token,
      title: message.title,
      body: message.body,
      data: message.data,
      sound: "default",
      priority: "high",
      channelId: "default",
    }));

    const chunks = expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];
    for (const chunk of chunks) {
      const chunkTickets = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...chunkTickets);
    }

    const results = validTokens.map((token, index) => ticketToResult(token, tickets[index]!));
    return [...results, ...invalidResults];
  }
}
