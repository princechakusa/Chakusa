import { createContext, PropsWithChildren, useCallback, useContext, useMemo, useState } from 'react';

// Guest browsing (Apple 5.1.1(v)): people can search and open businesses before
// creating an account. While it is on, the marketplace discovery calls use the
// public /public/marketplace routes (no token); every action that needs an
// account (book, favourite, follow, report, message, assistant) asks the person
// to sign in instead.

let guestMode = false;

/** The marketplace route prefix and auth mode for discovery reads. */
export function marketplaceRoute(): { prefix: string; auth: 'required' | 'none' } {
  return guestMode ? { prefix: '/public/marketplace', auth: 'none' } : { prefix: '/customer/marketplace', auth: 'required' };
}

interface GuestBrowsingValue { guest: boolean; startGuest: () => void; endGuest: () => void }
const GuestBrowsingContext = createContext<GuestBrowsingValue>({ guest: false, startGuest: () => undefined, endGuest: () => undefined });

export function GuestBrowsingProvider({ children }: PropsWithChildren) {
  const [guest, setGuest] = useState(false);
  const startGuest = useCallback(() => { guestMode = true; setGuest(true); }, []);
  const endGuest = useCallback(() => { guestMode = false; setGuest(false); }, []);
  const value = useMemo(() => ({ guest, startGuest, endGuest }), [endGuest, guest, startGuest]);
  return <GuestBrowsingContext.Provider value={value}>{children}</GuestBrowsingContext.Provider>;
}

export const useGuestBrowsing = () => useContext(GuestBrowsingContext);
