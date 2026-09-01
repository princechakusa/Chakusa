import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LegalDocumentType } from '../apiTypes';
import { DocumentSection, errorViewState, PublicDocumentViewState, viewStateFromDocument } from '../domain/publicDocument';
import { PublicPage, publicPageTitle } from '../domain/publicRoutes';
import { ApiError } from '../services/api';
import { legalApi } from '../services/endpoints';
import { colors, radius, spacing, typography } from '../theme';

const supportSections: DocumentSection[] = [{ title: 'Need help with Chakusa?', paragraphs: ['Contact support@chakusa.com.'], bullets: ['Account access.', 'Business setup.', 'Leads and customers.', 'Review requests.', 'Comeback reminders.', 'Notification issues.', 'Plan and usage questions.', 'Account deletion.', 'Technical problems.'] }, { title: 'Related information', paragraphs: ['Account deletion: https://chakusa.com/delete-account.', 'Privacy Policy: https://chakusa.com/privacy.', 'Terms of Use: https://chakusa.com/terms.'] }, { title: 'Important', paragraphs: ['When contacting support, do not send passwords, authentication tokens, payment credentials, or unnecessary customer personal information.'] }];
const deletionSections: DocumentSection[] = [{ title: 'Delete your account in the app', paragraphs: ['The existing authenticated in-app flow is the primary self-service deletion method.'], bullets: ['Open Chakusa.', 'Open Settings.', 'Go to Danger Zone.', 'Select Delete Account.', 'Complete the required identity confirmation.', 'Confirm deletion.'] }, { title: 'If you cannot access the application', paragraphs: ['Request help at support@chakusa.com. Please contact us from the email address associated with your Chakusa account where possible.', 'For security, we may need to verify that you are the account owner before processing a deletion request. Never send your password or authentication token.'] }, { title: 'What deletion affects', paragraphs: ['Deleting your Chakusa account may permanently remove your account, business information, and associated business data from the active service.', 'Some information may be retained where reasonably necessary for security, fraud prevention, transaction records, backups, dispute resolution, or legal obligations.'] }, { title: 'Important for paid subscriptions', paragraphs: ['Deleting a Chakusa account is separate from canceling a subscription billed through Apple App Store or Google Play. If you have an active store subscription, cancel it through the applicable store to prevent future renewals.'] }];

const staticConfigs: Partial<Record<PublicPage, { heading: string; meta: string; sections: DocumentSection[] }>> = {
  support: { heading: 'CHAKUSA SUPPORT', meta: 'Public support information', sections: supportSections },
  'delete-account': { heading: 'DELETE YOUR CHAKUSA ACCOUNT', meta: 'Public account-deletion instructions', sections: deletionSections },
};

// PROGRAM 2 LOOP 4: privacy and terms are the two publicly-viewable Legal
// Platform document types, so they load the live published version from
// GET /legal/documents/:type instead of the hardcoded copy this screen used
// to carry. Support and account-deletion aren't Legal Platform document
// types (see LegalDocumentType in ../apiTypes) and stay as static content.
const documentTypeForPage: Partial<Record<PublicPage, LegalDocumentType>> = {
  privacy: 'PRIVACY_POLICY',
  terms: 'TERMS_OF_SERVICE',
};

export function PublicDocumentScreen({ page }: { page: PublicPage }) {
  const documentType = documentTypeForPage[page];
  const staticConfig = staticConfigs[page];
  const [view, setView] = useState<PublicDocumentViewState>({ kind: 'loading' });

  const load = useCallback(async () => {
    if (!documentType) return;
    setView({ kind: 'loading' });
    try {
      setView(viewStateFromDocument(await legalApi.document(documentType)));
    } catch (error) {
      setView(errorViewState(error instanceof ApiError ? error.kind : 'network'));
    }
  }, [documentType]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (typeof document !== 'undefined') document.title = publicPageTitle(page); }, [page]);

  const loaded = view.kind === 'loaded' ? view : null;
  const heading = staticConfig?.heading ?? loaded?.heading ?? '';
  const meta = staticConfig?.meta ?? loaded?.meta ?? '';
  const sections = staticConfig?.sections ?? loaded?.sections ?? [];

  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.scroll}><View style={styles.document}>
    <Text style={styles.brand}>CHAKUSA</Text>
    {!staticConfig && view.kind === 'loading' ? <View style={styles.centered}><ActivityIndicator color={colors.primary} accessibilityLabel="Loading document" /></View> : null}
    {!staticConfig && view.kind === 'not-found' ? <View style={styles.centered}><Text style={styles.body}>This document hasn't been published yet.</Text></View> : null}
    {!staticConfig && view.kind === 'network-error' ? <View style={styles.centered}><Text style={styles.body}>We couldn't load this page. Check your connection and try again.</Text><Link href="#" label="Try again" onPressOverride={() => void load()} primary /></View> : null}
    {staticConfig || loaded ? <>
      <Text accessibilityRole="header" style={styles.title}>{heading}</Text>
      <Text style={styles.meta}>{meta}</Text>
      <View style={styles.rule} />
      {sections.map((section, index) => <View key={`${section.title}-${index}`} style={styles.section}>
        {section.title ? <Text accessibilityRole="header" style={styles.heading}>{section.title}</Text> : null}
        {section.paragraphs?.map((paragraph, i) => <Text key={i} style={styles.body}>{paragraph}</Text>)}
        {section.bullets ? <View style={styles.list}>{section.bullets.map((item, i) => <View key={i} style={styles.listRow}><Text style={styles.bullet}>•</Text><Text style={styles.listText}>{item}</Text></View>)}</View> : null}
      </View>)}
      {page === 'support' || page === 'delete-account' ? <Link href="mailto:support@chakusa.com" label="Email support@chakusa.com" primary /> : null}
    </> : null}
    <Footer />
  </View></ScrollView></SafeAreaView>;
}

function Link({ href, label, primary = false, onPressOverride }: { href: string; label: string; primary?: boolean; onPressOverride?: () => void }) {
  return <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={onPressOverride ?? (() => void Linking.openURL(href))} style={({ pressed }) => [styles.linkButton, primary && styles.primary, pressed && styles.pressed]}><Text style={[styles.linkText, primary && styles.primaryText]}>{label}</Text></Pressable>;
}
function Footer() { return <View style={styles.footer}><View style={styles.footerLinks}><Link href="https://chakusa.com/privacy" label="Privacy" /><Link href="https://chakusa.com/terms" label="Terms" /><Link href="https://chakusa.com/support" label="Support" /><Link href="https://chakusa.com/delete-account" label="Delete Account" /></View><Text style={styles.copyright}>© Chakusa</Text></View>; }
const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: colors.background }, scroll: { padding: spacing.lg }, document: { width: '100%', maxWidth: 780, alignSelf: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.xl, padding: spacing.xxl }, centered: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl }, brand: { ...typography.micro, color: colors.primary, letterSpacing: 2, marginBottom: spacing.md }, title: { ...typography.title, color: colors.text }, meta: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs }, rule: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.xl }, section: { gap: spacing.sm, marginBottom: spacing.xl }, heading: { ...typography.heading, color: colors.text }, body: { ...typography.body, color: colors.textSecondary }, list: { gap: spacing.sm }, listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, bullet: { ...typography.body, color: colors.primary }, listText: { ...typography.body, color: colors.textSecondary, flex: 1 }, linkButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.sm }, linkText: { ...typography.bodyStrong, color: colors.primary }, primary: { backgroundColor: colors.primary, alignItems: 'center', marginBottom: spacing.xl }, primaryText: { color: colors.surface }, pressed: { opacity: 0.7 }, footer: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.xl, gap: spacing.lg }, footerLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, copyright: { ...typography.caption, color: colors.textSecondary } });
