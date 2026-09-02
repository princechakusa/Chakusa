import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppHeader, PrimaryButton, Screen, SecondaryButton } from '../../components/ui';
import { legalDocumentLabel } from '../../domain/legalAcceptance';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { useCustomerAuth } from '../CustomerAuthContext';

// PROGRAM 2 LOOP 7: the legal-acceptance gate. Shown after sign-in while
// `/customer/legal/status` still reports pending documents. Nothing else
// in the customer app is reachable until every pending document is
// accepted — the navigator swaps this out once the list is empty.

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
    <Screen>
      <AppHeader eyebrow="ONE MORE THING" title="Review & accept" subtitle="We’ve updated the terms that apply to your Chakusa account. Please review each one to continue." />
      {auth.pendingLegalDocuments.map((doc) => (
        <View key={doc.type} style={styles.card}>
          <Text style={styles.docTitle}>{legalDocumentLabel(doc.type)}</Text>
          <Text style={styles.docMeta}>Version {doc.currentVersion}</Text>
          <View style={styles.actions}>
            <SecondaryButton compact label="Read" onPress={() => onViewDocument(doc.type)} />
            <PrimaryButton compact label={busyType === doc.type ? 'Saving…' : 'Accept'} disabled={busyType != null} onPress={() => void accept(doc.type)} />
          </View>
        </View>
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <SecondaryButton fullWidth label="Sign out" onPress={() => void auth.logout()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  docTitle: { ...typography.bodyStrong, color: colors.text },
  docMeta: { ...typography.caption, color: colors.textSecondary },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  error: { ...typography.caption, color: colors.negative },
});
