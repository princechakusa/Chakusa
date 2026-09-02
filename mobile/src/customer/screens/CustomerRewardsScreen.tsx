import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { AppHeader, EmptyState, Screen } from '../../components/ui';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerRewards'>;

// PROGRAM 2 LOOP 7: intentional placeholder. Loop 7 establishes the "My
// Rewards" navigation location but does NOT build the customer loyalty UI
// — that is Loop 8. This screen states that plainly rather than showing
// fabricated points/tier data.

export function CustomerRewardsScreen(_: Props) {
  return (
    <Screen>
      <AppHeader eyebrow="REWARDS" title="My Rewards" />
      <EmptyState
        icon="gift-outline"
        title="Rewards are on the way"
        message="Your points, tiers, memberships and referrals will live here. This part of Chakusa is being finished now."
      />
    </Screen>
  );
}
