import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { AppHeader, ErrorState, LoadingState, Screen } from '../../components/ui';
import type { LegalDocumentDto } from '../../apiTypes';
import { ApiError } from '../../services/api';
import { colors, spacing, typography } from '../../theme';
import { legalApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerLegalDocument'>;

// PROGRAM 2 LOOP 7: read-only legal document viewer. Uses the public
// `/legal/documents/:type` route — no account required — so it works from
// the acceptance gate before anything else is unlocked.

export function CustomerLegalDocumentScreen({ route }: Props) {
  const { type } = route.params;
  const [doc, setDoc] = useState<LegalDocumentDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError(null);
    legalApi.document(type)
      .then(setDoc)
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : 'Could not load this document.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [type]);

  if (loading) return <Screen><LoadingState label="Loading…" /></Screen>;
  if (error || !doc) return <Screen><ErrorState message={error ?? 'Not found.'} onRetry={load} /></Screen>;

  return (
    <Screen>
      <AppHeader eyebrow="LEGAL" title={doc.title} subtitle={doc.effectiveAt ? `Effective ${new Date(doc.effectiveAt).toLocaleDateString()}` : undefined} />
      {doc.summary ? <Text style={styles.summary}>{doc.summary}</Text> : null}
      <Text style={styles.body}>{doc.content}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { ...typography.bodyStrong, color: colors.text },
  body: { ...typography.body, color: colors.textSecondary },
});
