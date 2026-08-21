import { Platform } from 'react-native';
import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

export type CallScreeningRoleStatus = 'granted' | 'not_granted' | 'unsupported';

export interface PendingMissedCallEvent {
  /** Generated once, at detection time, and stable across every retry of this same event — the sync layer's idempotency key. */
  clientEventId: string;
  phone: string;
  /** ISO-8601 timestamp of the moment the call was confirmed missed (not when it started ringing). */
  occurredAt: string;
}

// requireNativeModule<ModuleType> is an unconstrained generic (ModuleType =
// any) — declaring addListener/removeListener directly here, matching
// NativeModule<TEventsMap>'s real runtime shape, avoids fighting
// expo-modules-core's exported `NativeModule` type alias (which resolves to
// the class's static side, not an extendable instance type).
interface ChakusaCallDetectionNativeModule {
  getCallScreeningRoleStatus(): Promise<CallScreeningRoleStatus>;
  requestCallScreeningRole(): Promise<CallScreeningRoleStatus>;
  hasPhoneStatePermission(): Promise<boolean>;
  requestPhoneStatePermission(): Promise<boolean>;
  hasContactsPermission(): Promise<boolean>;
  requestContactsPermission(): Promise<boolean>;
  getPendingEvents(): Promise<PendingMissedCallEvent[]>;
  clearEvents(clientEventIds: string[]): Promise<void>;
  addListener(eventName: 'onMissedCallDetected', listener: (event: PendingMissedCallEvent) => void): EventSubscription;
}

// Android-only capability (see expo-module.config.json). Every export below
// degrades to an inert, safe result on iOS/web rather than throwing —
// mirroring the platform-guard convention already used by
// services/pushNotifications.ts — so call sites never need their own
// per-platform branching.
const isSupportedPlatform = Platform.OS === 'android';
const native: ChakusaCallDetectionNativeModule | null = isSupportedPlatform
  ? requireNativeModule<ChakusaCallDetectionNativeModule>('ChakusaCallDetection')
  : null;

export async function getCallScreeningRoleStatus(): Promise<CallScreeningRoleStatus> {
  if (!native) return 'unsupported';
  return native.getCallScreeningRoleStatus();
}

/** Launches the OS role-request flow (Settings-style picker) — must be called from a user-initiated action, never automatically. */
export async function requestCallScreeningRole(): Promise<CallScreeningRoleStatus> {
  if (!native) return 'unsupported';
  return native.requestCallScreeningRole();
}

export async function hasPhoneStatePermission(): Promise<boolean> {
  if (!native) return false;
  return native.hasPhoneStatePermission();
}

/** Triggers the standard OS runtime-permission dialog for READ_PHONE_STATE. */
export async function requestPhoneStatePermission(): Promise<boolean> {
  if (!native) return false;
  return native.requestPhoneStatePermission();
}

/**
 * Not used to read the address book — Android's Telecom framework checks
 * this permission before deciding whether to exempt a contacts-matched call
 * from screening at all. Without it, missed calls from numbers already
 * saved as contacts never reach the call-screening service.
 */
export async function hasContactsPermission(): Promise<boolean> {
  if (!native) return false;
  return native.hasContactsPermission();
}

/** Triggers the standard OS runtime-permission dialog for READ_CONTACTS. */
export async function requestContactsPermission(): Promise<boolean> {
  if (!native) return false;
  return native.requestContactsPermission();
}

/** Reads (without clearing) every missed-call event the native layer has detected and persisted since the last successful `clearEvents`. */
export async function getPendingEvents(): Promise<PendingMissedCallEvent[]> {
  if (!native) return [];
  return native.getPendingEvents();
}

/** Removes events from the on-device queue once the JS layer has durably synced them to the backend — never call this before the corresponding API call actually succeeds. */
export async function clearEvents(clientEventIds: string[]): Promise<void> {
  if (!native || clientEventIds.length === 0) return;
  return native.clearEvents(clientEventIds);
}

/** Fires while the app is foregrounded and a missed call is detected in real time, in addition to (not instead of) the persisted queue — lets the sync layer react immediately rather than waiting for the next queue drain. */
export function addMissedCallListener(listener: (event: PendingMissedCallEvent) => void): EventSubscription {
  if (!native) return { remove: () => undefined };
  return native.addListener('onMissedCallDetected', listener);
}
