import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LegalDocumentType } from '../apiTypes';
import { legalDocumentLabel } from '../domain/legalAcceptance';
import { sectionsFromMarkdown } from '../domain/publicDocument';
import { PrimaryButton, Screen } from '../components/ui';
import { ApiError } from '../services/api';
import { legalApi } from '../services/endpoints';
import { useAuth } from '../state/AuthContext';
import { colors, radius, spacing, typography } from '../theme';

// PROGRAM 2 LOOP 4: gates Main (see authenticationFlow.ts's legalAcceptance
// route) the same single-screen/step-counter way PremiumFtueScreen gates
// onboarding — one document at a time, in whatever order the backend
// listed them in pendingLegalDocuments, no way to skip ahead. Reuses
// publicDocument.ts's Markdown-ish renderer rather than duplicating it,
// since the stored content is identical to what the public document
// viewer already renders.
export function LegalAcceptanceScreen() {
  const { pendingLegalDocuments, acceptLegalDocument } = useAuth();
  const current = pendingLegalDocuments[0];
  const [content, setContent] = useState<{ title: string; sections: ReturnType<typeof sectionsFromMarkdown> } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [accepting, setAccepting] = useState(false);

  const load = useCallback(async (type: LegalDocumentType) => {
    setContent(null); setLoadError(false);
    try {
      const doc = await legalApi.document(type);
      setContent({ title: doc.title, sections: sectionsFromMarkdown(doc.content) });
    } catch { setLoadError(true); }
  }, []);
  useEffect(() => { if (current) void load(current.type); }, [current, load]);

  if (!current) return null; // AppNavigator switches away as soon as the list empties.

  const accept = async () => {
    if (accepting) return;
    setAccepting(true);
    try { await acceptLegalDocument(current.type); }
    catch (error) { if (!(error instanceof ApiError)) throw error; }
    finally { setAccepting(false); }
  };

  return <Screen>
    <Text style={styles.kicker}>{pendingLegalDocuments.length > 1 ? `UPDATE REQUIRED · 1 OF ${pendingLegalDocuments.length}` : 'UPDATE REQUIRED'}</Text>
    <View style={styles.hero}><Ionicons name="document-text-outline" size={42} color={colors.primary} /></View>
    <Text style={styles.title}>{legalDocumentLabel(current.type)} has changed</Text>
    <Text style={styles.copy}>Please review the updated {legalDocumentLabel(current.type).toLowerCase()} before continuing.</Text>
    {!content && !loadError ? <View style={styles.centered}><ActivityIndicator color={colors.primary} accessibilityLabel="Loading document" /></View> : null}
    {loadError ? <View style={styles.centered}><Text style={styles.copy}>We couldn't load this document. Check your connection and try again.</Text><PrimaryButton fullWidth label="Try again" onPress={() => void load(current.type)} /></View> : null}
    {content ? <View style={styles.document}><ScrollView nestedScrollEnabled showsVerticalScrollIndicator>
      {content.sections.map((section, index) => <View key={`${section.title}-${index}`} style={styles.section}>
        {section.title ? <Text accessibilityRole="header" style={styles.heading}>{section.title}</Text> : null}
        {section.paragraphs?.map((paragraph, i) => <Text key={i} style={styles.body}>{paragraph}</Text>)}
        {section.bullets ? <View style={styles.list}>{section.bullets.map((item, i) => <View key={i} style={styles.listRow}><Text style={styles.bullet}>•</Text><Text style={styles.listText}>{item}</Text></View>)}</View> : null}
      </View>)}
    </ScrollView></View> : null}
    {content ? <PrimaryButton fullWidth disabled={accepting} label={accepting ? 'Saving…' : 'I have read and agree'} onPress={() => void accept()} /> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  kicker: { ...typography.micro, color: colors.primary, letterSpacing: 1 },
  hero: { height: 120, borderRadius: radius.xl, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg },
  title: { ...typography.title, color: colors.text, marginTop: spacing.lg },
  copy: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  centered: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl },
  document: { marginTop: spacing.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, padding: spacing.lg, backgroundColor: colors.surface, maxHeight: 420 },
  section: { gap: spacing.sm, marginBottom: spacing.lg },
  heading: { ...typography.bodyStrong, color: colors.text },
  body: { ...typography.body, color: colors.textSecondary },
  list: { gap: spacing.sm },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  bullet: { ...typography.body, color: colors.primary },
  listText: { ...typography.body, color: colors.textSecondary, flex: 1 },
});
