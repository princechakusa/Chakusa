/**
 * Prominent in-app disclosure shown before Android's phone / contacts
 * permission prompts (Google Play User Data policy). Must say what is
 * accessed, why, and what leaves the device - and match callDetectionSync,
 * which sends only the caller's number and the time of the missed call.
 */
export type PermissionDisclosureKey = 'detection' | 'contactCoverage';

export interface PermissionDisclosure {
  title: string;
  body: string;
  accept: string;
  decline: string;
}

export function permissionDisclosure(key: PermissionDisclosureKey): PermissionDisclosure {
  if (key === 'detection') {
    return {
      title: 'Catch missed calls',
      body: 'To text customers back after a missed call, Chakusa needs to be your call screening app and read your phone state. '
        + 'When a call to this phone goes unanswered, Chakusa sends that caller\'s number and the time of the call to your Chakusa business account. '
        + 'Chakusa does not record calls, read call contents, or block or change any call.\n\n'
        + 'Android will also ask for contacts access so calls from customers already saved in your contacts are caught too. '
        + 'Chakusa never uploads, copies or reads your address book.',
      accept: 'Continue',
      decline: 'Not now',
    };
  }
  return {
    title: 'Include saved customers',
    body: 'Android only lets Chakusa notice missed calls from numbers saved in your contacts if contacts access is turned on. '
      + 'Chakusa never uploads, copies or reads your address book; it only receives the number of a missed call.',
    accept: 'Continue',
    decline: 'Not now',
  };
}
