import { NativeStackScreenProps } from '@react-navigation/native-stack';

import { AppHeader, Screen, SecondaryButton } from '../../components/ui';
import { redemptionCodeDisplay } from '../../domain/loyalty';
import { RedemptionCodeCard } from '../components/loyalty';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerRedemptionDetail'>;

// PROGRAM 2 LOOP 8: the redemption code, shown large for the business to
// read. The customer app does not mark it redeemed — Loop 6's business app
// consumes it.

export function CustomerRedemptionDetailScreen({ route, navigation }: Props) {
  const { redemption } = route.params;
  return (
    <Screen>
      <AppHeader eyebrow="YOUR REWARD" title={redemption.reward?.name ?? 'Reward'} />
      <RedemptionCodeCard redemption={redemption} code={redemptionCodeDisplay(redemption.code)} />
      <SecondaryButton fullWidth label="Done" onPress={() => navigation.goBack()} />
    </Screen>
  );
}
