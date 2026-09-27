import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/ui';
import { legalDocumentLabel } from '../../domain/legalAcceptance';
import { ApiError } from '../../services/api';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { useCustomerAuth } from '../CustomerAuthContext';

// PROGRAM 2 LOOP 7: the legal-acceptance gate. Shown after sign-in while
// `/customer/legal/status` still reports pending documents. Nothing else
// in the customer app is reachable until every pending document is
// accepted - the navigator swaps this out once the list is empty.
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

function PrimaryBtn({ label, compact, disabled, onPress }: { label: string; compact?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryBtn, compact && styles.compact, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryBtn({ label, compact, fullWidth, onPress }: { label: string; compact?: boolean; fullWidth?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.secondaryBtn, compact && styles.compact, fullWidth && styles.fullWidth, pressed && styles.pressed]}>
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </Pressable>
  );
}

export function CustomerLegalGateScreen({
  onViewDocument,
}: { onViewDocument: (type: import('../../apiTypes').LegalDocumentType) => void }) {
  const auth = useCustomerAuth();
  const [busyType, setBusyType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const accept = async (type: import('../../apiTypes').LegalDocumentType) => {
    setBusyType(type);
    setError(null);
    try { await auth.acceptLegalDocument(type); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not record your acceptance.'); }
    finally { setBusyType(null); }
  };

  return (
    <Screen backgroundColor={authColors.bg}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>ONE MORE THING</Text>
        <Text style={styles.title}>Review & accept</Text>
        <Text style={styles.subtitle}>We’ve updated the terms that apply to your Chakusa account. Please review each one to continue.</Text>
      </View>
      {auth.pendingLegalDocuments.map((doc) => (
        <View key={doc.type} style={styles.card}>
          <Text style={styles.docTitle}>{legalDocumentLabel(doc.type)}</Text>
          <Text style={styles.docMeta}>Version {doc.currentVersion}</Text>
          <View style={styles.actions}>
            <SecondaryBtn compact label="Read" onPress={() => onViewDocument(doc.type)} />
            <PrimaryBtn compact label={busyType === doc.type ? 'Saving…' : 'Accept'} disabled={busyType != null} onPress={() => void accept(doc.type)} />
          </View>
        </View>
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <SecondaryBtn fullWidth label="Sign out" onPress={() => void auth.logout()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: authSpace.sm },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  card: { backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, padding: authSpace.md, gap: authSpace.xs, ...authShadow.card },
  docTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.ink },
  docMeta: { ...authType.body, fontSize: 12 },
  actions: { flexDirection: 'row', gap: authSpace.sm, marginTop: authSpace.xs },
  error: { ...authType.body, fontSize: 12, color: authColors.danger },
  primaryBtn: { minHeight: 48, paddingHorizontal: authSpace.md, borderRadius: authRadius.pill, backgroundColor: authColors.coral, alignItems: 'center', justifyContent: 'center', flex: 1, ...authShadow.cta },
  primaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.onCoral },
  secondaryBtn: { minHeight: 48, paddingHorizontal: authSpace.md, borderRadius: authRadius.pill, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, alignItems: 'center', justifyContent: 'center', flex: 1 },
  secondaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  compact: { flex: 0, minWidth: 100 },
  fullWidth: { flex: 1, width: '100%' },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
