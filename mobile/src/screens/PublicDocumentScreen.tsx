import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LegalDocumentType } from '../apiTypes';
import { DocumentSection, errorViewState, PublicDocumentViewState, viewStateFromDocument } from '../domain/publicDocument';
import { PublicPage, publicPageTitle } from '../domain/publicRoutes';
import { ApiError } from '../services/api';
import { legalApi } from '../services/endpoints';
import { colors, radius, spacing, typography } from '../theme';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { APPROVED_PUBLIC_DESTINATIONS } from '../domain/trustSettings';

// #26 — the account-deletion URL and support email a store reviewer follows
// must be the real production domain. Sourced from the single trust-settings
// allowlist so they can never drift from the rest of the app again.
const SUPPORT_EMAIL = APPROVED_PUBLIC_DESTINATIONS.supportEmail;
const DELETE_URL = APPROVED_PUBLIC_DESTINATIONS.deleteAccount;
const PRIVACY_URL = APPROVED_PUBLIC_DESTINATIONS.privacy;
const TERMS_URL = APPROVED_PUBLIC_DESTINATIONS.terms;

const supportSections: DocumentSection[] = [{ title: 'Need help with Chakusa?', paragraphs: [`Contact ${SUPPORT_EMAIL}.`], bullets: ['Account access.', 'Business setup.', 'Leads and customers.', 'Review requests.', 'Comeback reminders.', 'Notification issues.', 'Plan and usage questions.', 'Account deletion.', 'Technical problems.'] }, { title: 'Related information', paragraphs: [`Account deletion: ${DELETE_URL}.`, `Privacy Policy: ${PRIVACY_URL}.`, `Terms of Use: ${TERMS_URL}.`] }, { title: 'Important', paragraphs: ['When contacting support, do not send passwords, authentication tokens, payment credentials, or unnecessary customer personal information.'] }];
const deletionSections: DocumentSection[] = [{ title: 'Delete your account in the app', paragraphs: ['The existing authenticated in-app flow is the primary self-service deletion method.'], bullets: ['Open Chakusa.', 'Open Settings.', 'Go to Danger Zone.', 'Select Delete Account.', 'Complete the required identity confirmation.', 'Confirm deletion.'] }, { title: 'If you cannot access the application', paragraphs: [`Request help at ${SUPPORT_EMAIL}. Please contact us from the email address associated with your Chakusa account where possible.`, 'For security, we may need to verify that you are the account owner before processing a deletion request. Never send your password or authentication token.'] }, { title: 'What deletion affects', paragraphs: ['Deleting your Chakusa account may permanently remove your account, business information, and associated business data from the active service.', 'Some information may be retained where reasonably necessary for security, fraud prevention, transaction records, backups, dispute resolution, or legal obligations.'] }, { title: 'Important for paid subscriptions', paragraphs: ['Deleting a Chakusa account is separate from canceling a subscription billed through Apple App Store or Google Play. If you have an active store subscription, cancel it through the applicable store to prevent future renewals.'] }];

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
      {page === 'support' || page === 'delete-account' ? <Link href={`mailto:${SUPPORT_EMAIL}`} label={`Email ${SUPPORT_EMAIL}`} primary /> : null}
    </> : null}
    <Footer />
  </View></ScrollView></SafeAreaView>;
}

function Link({ href, label, primary = false, onPressOverride }: { href: string; label: string; primary?: boolean; onPressOverride?: () => void }) {
  return <Pressable accessibilityRole="link" accessibilityLabel={label} onPress={onPressOverride ?? (() => void Linking.openURL(href))} style={({ pressed }) => [styles.linkButton, primary && styles.primary, pressed && styles.pressed]}><Text style={[styles.linkText, primary && styles.primaryText]}>{label}</Text></Pressable>;
}
function Footer() { return <View style={styles.footer}><View style={styles.footerLinks}><Link href={PRIVACY_URL} label="Privacy" /><Link href={TERMS_URL} label="Terms" /><Link href={APPROVED_PUBLIC_DESTINATIONS.support} label="Support" /><Link href={DELETE_URL} label="Delete Account" /></View><Text style={styles.copyright}>© Chakusa</Text></View>; }
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: m3.surface },
  scroll: { paddingHorizontal: m3Space.md, paddingTop: m3Space.md, paddingBottom: m3Space.xxl },
  document: { width: "100%", maxWidth: 780, alignSelf: "center", gap: m3Space.xs },
  centered: { alignItems: "center", gap: m3Space.md, paddingVertical: m3Space.xxl },
  brand: { ...m3Type.labelSm, color: m3.primary, letterSpacing: 1.5, marginBottom: m3Space.xs },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  meta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },
  rule: { height: 1, backgroundColor: m3.surfaceContainerHigh, marginVertical: m3Space.lg },
  section: { gap: m3Space.xs, marginBottom: m3Space.lg },
  heading: { ...m3Type.headlineSm, color: m3.onSurface },
  body: { ...m3Type.bodyMd, color: m3.onSurfaceVariant, lineHeight: 24 },
  list: { gap: 6, marginTop: 4 },
  listRow: { flexDirection: "row", alignItems: "flex-start", gap: m3Space.xs },
  bullet: { ...m3Type.bodyMd, color: m3.primary },
  listText: { ...m3Type.bodyMd, color: m3.onSurfaceVariant, flex: 1, lineHeight: 24 },
  linkButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: m3Space.sm, borderRadius: m3Radius.sm },
  linkText: { ...m3Type.labelMd, color: m3.primary },
  primary: { backgroundColor: m3.primary, alignItems: "center", borderRadius: m3Radius.md, marginBottom: m3Space.lg },
  primaryText: { color: m3.onPrimary },
  pressed: { opacity: 0.7 },
  footer: { borderTopWidth: 1, borderTopColor: m3.surfaceContainerHigh, paddingTop: m3Space.lg, gap: m3Space.md },
  footerLinks: { flexDirection: "row", flexWrap: "wrap", gap: m3Space.xs },
  copyright: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
});
