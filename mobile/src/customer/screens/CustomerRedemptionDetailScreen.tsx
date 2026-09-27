import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/ui';
import { redemptionCodeDisplay } from '../../domain/loyalty';
import { authColors, authRadius, authSpace, authType } from '../../experience/authTheme';
import { RedemptionCodeCard } from '../components/loyalty';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerRedemptionDetail'>;

// PROGRAM 2 LOOP 8: the redemption code, shown large for the business to
// read. The customer app does not mark it redeemed - Loop 6's business app
// consumes it.
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

export function CustomerRedemptionDetailScreen({ route, navigation }: Props) {
  const { redemption } = route.params;
  return (
    <Screen backgroundColor={authColors.bg}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>YOUR REWARD</Text>
        <Text style={styles.title}>{redemption.reward?.name ?? 'Reward'}</Text>
      </View>
      <RedemptionCodeCard redemption={redemption} code={redemptionCodeDisplay(redemption.code)} />
      <Pressable accessibilityRole="button" accessibilityLabel="Done" onPress={() => navigation.goBack()} style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}>
        <Text style={styles.secondaryBtnText}>Done</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: authSpace.sm },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  secondaryBtn: { minHeight: 52, borderRadius: authRadius.pill, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.ink },
  pressed: { opacity: 0.85 },
});
