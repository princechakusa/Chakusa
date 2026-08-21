import {
  getCallScreeningRoleStatus,
  hasContactsPermission as hasContactsPermissionNative,
  hasPhoneStatePermission,
  requestCallScreeningRole,
  requestContactsPermission,
  requestPhoneStatePermission,
} from 'chakusa-call-detection';
import { callDetectionAvailability, type CallDetectionAvailability } from '../domain/callDetection';
import { syncPendingMissedCalls } from './callDetectionSync';

export async function getCallDetectionAvailability(): Promise<CallDetectionAvailability> {
  const [roleStatus, hasPermission] = await Promise.all([getCallScreeningRoleStatus(), hasPhoneStatePermission()]);
  return callDetectionAvailability(roleStatus, hasPermission);
}

export async function getContactsPermissionStatus(): Promise<boolean> {
  return hasContactsPermissionNative();
}

/**
 * Requests whichever of the role/permission pair is still missing, in
 * sequence (role first — it drives the OS's own explanatory role-picker
 * UI), then triggers an immediate sync so a call missed before either grant
 * was in place doesn't wait for the next app foreground. Must only be
 * called from a user-initiated action with its own explanation already
 * shown — never automatically. This is the entry point the Recovery Engine
 * activation card's "Turn on" action calls.
 *
 * Once base detection is ready, this also requests READ_CONTACTS in the
 * same flow — not to read the address book, but because Android's Telecom
 * framework silently skips our CallScreeningService for calls from numbers
 * already saved as contacts unless this permission is held (see
 * domain/recoveryEngineStatus.ts). Bundling it here means turning on the
 * engine covers both cases in one user-initiated action rather than a
 * second, easy-to-miss step. It's requested best-effort — a decline here
 * does not affect base detection, only contact coverage, and the engine
 * status card exposes that gap separately with its own "Turn on" action.
 */
export async function enableCallDetection(): Promise<CallDetectionAvailability> {
  const roleStatus = await requestCallScreeningRole();
  const hasPermission = roleStatus === 'granted' ? await requestPhoneStatePermission() : await hasPhoneStatePermission();
  const availability = callDetectionAvailability(roleStatus, hasPermission);
  if (availability === 'ready') {
    void syncPendingMissedCalls();
    if (!(await hasContactsPermissionNative())) await requestContactsPermission();
  }
  return availability;
}

/** Separate entry point for the "Coverage for saved customers" card action, for when a business owner turns on base detection first and grants contacts access later. */
export async function enableContactCoverage(): Promise<boolean> {
  return requestContactsPermission();
}
