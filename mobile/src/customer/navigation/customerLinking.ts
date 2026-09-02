import type { LinkingOptions } from '@react-navigation/native';
import { parseCustomerDeepLink } from '../domain/customerNav';
import type { CustomerRootStackParamList } from './types';

// PROGRAM 2 LOOP 7: deep-link configuration for the customer app.
//
// The static `config` covers the simple, direct paths. `getStateFromPath`
// is overridden so every incoming URL is first run through
// `parseCustomerDeepLink`, which refuses to resolve business-owner links
// — a crafted `chakusa://dashboard` produces no navigation rather than
// leaking into a business screen.

export const customerLinking: LinkingOptions<CustomerRootStackParamList> = {
  prefixes: ['chakusa://'],
  config: {
    screens: {
      CustomerTabs: {
        screens: {
          CustomerHome: 'home',
          CustomerExplore: 'explore',
          CustomerBookings: 'bookings',
          CustomerAccount: 'account',
        },
      },
      BusinessProfile: 'business/:slug',
      BookingFlow: 'book/:slug',
      BookingDetail: 'booking/:bookingId',
      CustomerNotifications: 'notifications',
      CustomerAssistant: 'assistant',
      CustomerRewards: 'my-rewards',
    },
  },
  getStateFromPath: (path) => {
    const parsed = parseCustomerDeepLink(path);
    if (!parsed) return undefined;
    switch (parsed.route) {
      case 'BusinessProfile':
        return { routes: [{ name: 'BusinessProfile', params: parsed.params }] };
      case 'BookingFlow':
        return { routes: [{ name: 'BookingFlow', params: parsed.params }] };
      case 'BookingDetail':
        return { routes: [{ name: 'BookingDetail', params: parsed.params }] };
      case 'CustomerAssistant':
        return { routes: [{ name: 'CustomerAssistant', params: parsed.params }] };
      case 'CustomerNotifications':
        return { routes: [{ name: 'CustomerNotifications' }] };
      case 'CustomerRewards':
        return { routes: [{ name: 'CustomerRewards' }] };
      case 'CustomerHome':
        return { routes: [{ name: 'CustomerTabs', state: { routes: [{ name: 'CustomerHome' }] } }] };
      default:
        return undefined;
    }
  },
};
