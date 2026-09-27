import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ErrorState, LoadingState, Screen } from '../../components/ui';
import type { LegalDocumentDto } from '../../apiTypes';
import { authColors, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { legalApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerLegalDocument'>;

// PROGRAM 2 LOOP 7: read-only legal document viewer. Uses the public
// `/legal/documents/:type` route - no account required - so it works from
// the acceptance gate before anything else is unlocked.
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

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

  if (loading) return <Screen backgroundColor={authColors.bg}><LoadingState label="Loading…" /></Screen>;
  if (error || !doc) return <Screen backgroundColor={authColors.bg}><ErrorState message={error ?? 'Not found.'} onRetry={load} /></Screen>;

  return (
    <Screen backgroundColor={authColors.bg}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>LEGAL</Text>
        <Text style={styles.title}>{doc.title}</Text>
        {doc.effectiveAt ? <Text style={styles.subtitle}>Effective {new Date(doc.effectiveAt).toLocaleDateString()}</Text> : null}
      </View>
      {doc.summary ? <Text style={styles.summary}>{doc.summary}</Text> : null}
      <Text style={styles.body}>{doc.content}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: authSpace.sm },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  summary: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  body: { ...authType.body },
});
