import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { ErrorState, LoadingState, Screen } from '../../components/ui';
import type { LegalDocumentDto, LegalDocumentType } from '../../apiTypes';
import { APPROVED_PUBLIC_DESTINATIONS } from '../../domain/trustSettings';
import { authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { legalApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';
import { premium } from '../premiumTheme';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerLegalDocument'>;

const WEBSITE_LEGAL_URLS: Partial<Record<LegalDocumentType, string>> = {
  TERMS_OF_SERVICE: APPROVED_PUBLIC_DESTINATIONS.terms,
  PRIVACY_POLICY: APPROVED_PUBLIC_DESTINATIONS.privacy,
  COOKIE_POLICY: APPROVED_PUBLIC_DESTINATIONS.cookies,
  AI_DISCLOSURE: APPROVED_PUBLIC_DESTINATIONS.aiDisclosure,
};

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
  const [notFound, setNotFound] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    legalApi.document(type)
      .then(setDoc)
      .catch((caught) => {
        if (caught instanceof ApiError && caught.status === 404) setNotFound(true);
        setError(caught instanceof ApiError ? caught.message : 'Could not load this document.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(load, [type]);

  if (loading) return <Screen backgroundColor={premium.bg}><LoadingState label="Loading…" /></Screen>;
  // Not published through the Legal Platform yet: the same document is public on the website.
  const websiteUrl = WEBSITE_LEGAL_URLS[type];
  if (notFound && websiteUrl) {
    return (
      <Screen backgroundColor={premium.bg}>
        <Text style={styles.body}>This document is published on the Chakusa website.</Text>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(websiteUrl)} style={styles.link}>
          <Text style={styles.linkText}>Open on chakusarecovery.com</Text>
        </Pressable>
      </Screen>
    );
  }
  if (error || !doc) return <Screen backgroundColor={premium.bg}><ErrorState message={error ?? 'Not found.'} onRetry={load} /></Screen>;

  return (
    <Screen backgroundColor={premium.bg}>
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
  eyebrow: { ...authType.micro, color: premium.deep },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  summary: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: premium.ink },
  body: { ...authType.body },
  link: { marginTop: authSpace.md, paddingVertical: authSpace.sm, paddingHorizontal: authSpace.md, borderRadius: 999, backgroundColor: premium.deep, alignSelf: 'flex-start' },
  linkText: { color: premium.onDeep, fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
