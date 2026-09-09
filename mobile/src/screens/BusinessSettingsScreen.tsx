import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useEffect, useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { MessageTone } from '../apiTypes';
import { PrimaryButton } from '../components/ui';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { M3Header, M3Screen } from '../experience/businessKit';
import { m3, m3Space, m3Type } from '../experience/businessTheme';
import { RootStackParamList } from '../types';
import { CountryPhoneInput } from '../components/CountryPhoneInput';
import { BusinessHoursEditor } from '../components/BusinessHoursEditor';
import { QrCode } from '../components/QrCode';
import { publicBusinessProfileUrl } from '../domain/publicBusinessProfile';
import { parseWeeklyHours, serializeWeeklyHours } from '../domain/businessSetup';
import { ApiError } from '../services/api';
import { businessApi, paymentsApi } from '../services/endpoints';
import { useAuth } from '../state/AuthContext';
import { colors, radius, spacing, typography } from '../theme';
import { titleCase } from '../utils/format';

export function BusinessSettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { business, refreshBusiness } = useAuth(); const [name, setName] = useState(business?.name ?? ''); const [industry, setIndustry] = useState(business?.industry ?? ''); const [country, setCountry] = useState(business?.country ?? 'ZW'); const [timezone, setTimezone] = useState(business?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone); const [currency, setCurrency] = useState(business?.currency ?? 'USD'); const [phone, setPhone] = useState(business?.phone ?? ''); const [description, setDescription] = useState(business?.description ?? ''); const [reviewLink, setReviewLink] = useState(business?.googleReviewLink ?? ''); const [hours, setHours] = useState(() => parseWeeklyHours(business?.workingHours)); const [days, setDays] = useState(String(business?.reminderDays ?? 42)); const [minNotice, setMinNotice] = useState(String(business?.bookingMinNoticeMinutes ?? 60)); const [bookingWindow, setBookingWindow] = useState(String(business?.bookingWindowDays ?? 90)); const [slotInterval, setSlotInterval] = useState(String(business?.slotIntervalMinutes ?? 15)); const [cancelNotice, setCancelNotice] = useState(String(business?.cancellationNoticeMinutes ?? 1440)); const [appointmentReminder, setAppointmentReminder] = useState(String(business?.defaultAppointmentReminderMinutes ?? 1440)); const [tone, setTone] = useState<MessageTone>(business?.preferredTone ?? 'friendly'); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null); const [showQr, setShowQr] = useState(false);
  const [messagingConsent, setMessagingConsent] = useState(Boolean(business?.messagingConsentConfirmedAt)); const [paymentReminders, setPaymentReminders] = useState(Boolean(business?.paymentRemindersEnabled)); const [noShowFollowUp, setNoShowFollowUp] = useState(Boolean(business?.noShowFollowUpEnabled)); const [stripeStatus, setStripeStatus] = useState<{ connected: boolean; chargesEnabled: boolean; payoutsEnabled: boolean } | null>(null); const [connectingStripe, setConnectingStripe] = useState(false);
  const [logo, setLogo] = useState<string | null>(business?.logoDataUrl ?? null); const [logoBusy, setLogoBusy] = useState(false); const [logoError, setLogoError] = useState<string | null>(null);
  const pickLogo = async () => {
    if (logoBusy) return;
    setLogoBusy(true); setLogoError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ['image/png', 'image/jpeg', 'image/webp'], copyToCacheDirectory: true });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset) return;
      const mime = asset.mimeType && /^image\/(png|jpe?g|webp)$/.test(asset.mimeType) ? asset.mimeType : 'image/jpeg';
      const base64 = await new File(asset.uri).base64();
      const dataUrl = `data:${mime};base64,${base64}`;
      if (dataUrl.length > 400_000) { setLogoError('That image is too large. Choose one under about 250 KB, or crop it first.'); return; }
      setLogo(dataUrl);
    } catch {
      setLogoError('Could not read that image. Try another one.');
    } finally {
      setLogoBusy(false);
    }
  };
  useEffect(() => { void paymentsApi.connectStatus().then(setStripeStatus).catch(() => setStripeStatus(null)); }, []);
  const save = async () => { if (saving) return; setSaving(true); setError(null); try { await businessApi.patch({ name: name.trim(), industry: industry.trim().toLowerCase() || undefined, country, timezone: timezone.trim(), currency: currency.trim().toUpperCase(), phone: phone.trim() || undefined, description: description.trim(), logoDataUrl: logo, googleReviewLink: reviewLink.trim() || undefined, workingHours: serializeWeeklyHours(hours), reminderDays: Number(days), bookingMinNoticeMinutes: Number(minNotice), bookingWindowDays: Number(bookingWindow), slotIntervalMinutes: Number(slotInterval), cancellationNoticeMinutes: Number(cancelNotice), defaultAppointmentReminderMinutes: Number(appointmentReminder), preferredTone: tone, messagingConsentConfirmed: messagingConsent, paymentRemindersEnabled: messagingConsent && paymentReminders, noShowFollowUpEnabled: messagingConsent && noShowFollowUp }); await refreshBusiness(); Alert.alert('Settings saved', 'Your business setup and booking rules are ready across Chakusa.'); } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Unable to save business settings.'); } finally { setSaving(false); } };
  const connectStripe = async () => { if (connectingStripe) return; setConnectingStripe(true); setError(null); try { const { url } = await paymentsApi.connectLink(); await Linking.openURL(url); } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Unable to open Stripe setup.'); } finally { setConnectingStripe(false); } };
  const profileUrl = business?.publicSlug ? publicBusinessProfileUrl(business.publicSlug) : null;
  const copyProfileUrl = async () => { if (!profileUrl) return; await Clipboard.setStringAsync(profileUrl); Alert.alert('Copied', 'Your business page link was copied.'); };
  const shareProfileUrl = async () => { if (!profileUrl) return; try { await Share.share({ message: `Check out ${name || business?.name || 'my business'} on Chakusa: ${profileUrl}` }); } catch { /* user dismissed the share sheet */ } };
  return <M3Screen header={<M3Header businessName="More" onBack={() => navigation.goBack()} onNotificationsPress={() => navigation.navigate("AttentionCenter")} hasNotifications={false} />}>
    <View style={m3Head.block}><Text style={m3Head.eyebrow}>BUSINESS</Text><Text style={m3Head.title}>Business profile</Text><Text style={m3Head.subtitle}>Settings used across customer recovery, your public page and booking.</Text></View>

    <View style={logoStyles.card}>
      <View style={logoStyles.preview}>
        {logo ? <Image source={{ uri: logo }} style={logoStyles.image} resizeMode="cover" /> : <Text style={logoStyles.initials}>{(name || business?.name || 'C').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}</Text>}
      </View>
      <View style={logoStyles.copy}>
        <Text style={logoStyles.title}>Business photo</Text>
        <Text style={logoStyles.detail}>Shown in the app header and on your public page. PNG, JPEG or WebP, about 250 KB.</Text>
        <View style={logoStyles.actions}>
          <Pressable accessibilityRole="button" disabled={logoBusy} onPress={() => void pickLogo()} style={logoStyles.btn}>
            <Text style={logoStyles.btnText}>{logoBusy ? 'Opening…' : logo ? 'Change photo' : 'Add photo'}</Text>
          </Pressable>
          {logo ? <Pressable accessibilityRole="button" onPress={() => setLogo(null)} style={logoStyles.btn}><Text style={logoStyles.btnText}>Remove</Text></Pressable> : null}
        </View>
        {logoError ? <Text style={logoStyles.error}>{logoError}</Text> : null}
        {logo !== (business?.logoDataUrl ?? null) ? <Text style={logoStyles.hint}>Tap Save business setup to keep this photo.</Text> : null}
      </View>
    </View>
    {profileUrl ? <View style={styles.shareCard}>
      <Text style={styles.shareLabel}>Your public business page</Text>
      <Text numberOfLines={1} style={styles.shareUrl}>{profileUrl}</Text>
      <View style={styles.shareActions}>
        <Pressable accessibilityRole="button" onPress={() => void copyProfileUrl()} style={styles.shareButton}><Text style={styles.shareButtonText}>Copy link</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => void shareProfileUrl()} style={[styles.shareButton, styles.shareButtonPrimary]}><Text style={[styles.shareButtonText, styles.shareButtonTextPrimary]}>Share</Text></Pressable>
      </View>
      <Pressable accessibilityRole="button" onPress={() => setShowQr(current => !current)} style={styles.qrToggle}><Text style={styles.qrToggleText}>{showQr ? 'Hide QR code' : 'Show QR code'}</Text></Pressable>
      {showQr ? <View style={styles.qrWrap}><QrCode value={profileUrl} /><Text style={styles.qrHint}>Screenshot this to print on a flyer, storefront window, or receipt.</Text></View> : null}
    </View> : null}
    <Field label="Business name" value={name} onChangeText={setName} /><IndustryField value={industry} onChange={setIndustry} /><CountryPhoneInput value={phone} onChange={setPhone} onCountryChange={setCountry} defaultCountryCode={country} label="Business phone" /><View style={{ flexDirection: 'row', gap: spacing.sm }}><View style={{ flex: 1 }}><Field label="Currency" value={currency} onChangeText={setCurrency} /></View><View style={{ flex: 1 }}><Field label="Timezone" value={timezone} onChangeText={setTimezone} /></View></View><Field label="Description (shown on your public page)" value={description} onChangeText={setDescription} multiline /><Field label="Google review link" value={reviewLink} onChangeText={setReviewLink} /><BusinessHoursEditor value={hours} onChange={setHours} />
    <Text style={styles.label}>Online booking rules</Text><View style={styles.choices}><View style={{ flexGrow: 1, width: '46%' }}><Field label="Minimum notice (minutes)" value={minNotice} onChangeText={setMinNotice} /></View><View style={{ flexGrow: 1, width: '46%' }}><Field label="Booking window (days)" value={bookingWindow} onChangeText={setBookingWindow} /></View><View style={{ flexGrow: 1, width: '46%' }}><Field label="Slot interval (minutes)" value={slotInterval} onChangeText={setSlotInterval} /></View><View style={{ flexGrow: 1, width: '46%' }}><Field label="Cancellation notice (minutes)" value={cancelNotice} onChangeText={setCancelNotice} /></View><View style={{ flexGrow: 1, width: '46%' }}><Field label="Appointment reminder (minutes)" value={appointmentReminder} onChangeText={setAppointmentReminder} /></View></View>
    <Text style={styles.label}>Payments and customer messaging</Text><View style={styles.setupCard}><View style={styles.toggleRow}><View style={styles.toggleCopy}><Text style={styles.toggleTitle}>Customer messaging responsibility</Text><Text style={styles.toggleDetail}>I confirm that my business has the permission required to message customers and will honor opt-outs.</Text></View><Switch accessibilityLabel="Confirm customer messaging responsibility" value={messagingConsent} onValueChange={value => { setMessagingConsent(value); if (!value) setPaymentReminders(false); }} /></View><View style={styles.toggleRow}><View style={styles.toggleCopy}><Text style={styles.toggleTitle}>Automatic payment reminders</Text><Text style={styles.toggleDetail}>Send one balance reminder using an existing secure Stripe Checkout link.</Text></View><Switch accessibilityLabel="Automatic payment reminders" disabled={!messagingConsent} value={messagingConsent && paymentReminders} onValueChange={setPaymentReminders} /></View><View style={styles.toggleRow}><View style={styles.toggleCopy}><Text style={styles.toggleTitle}>No-show follow-up</Text><Text style={styles.toggleDetail}>When you mark an appointment as no-show, send the customer one polite reschedule message. No fee, no penalty.</Text></View><Switch accessibilityLabel="No-show follow-up" disabled={!messagingConsent} value={messagingConsent && noShowFollowUp} onValueChange={setNoShowFollowUp} /></View><Text style={styles.toggleTitle}>Stripe payments</Text><Text style={styles.toggleDetail}>{stripeStatus?.chargesEnabled && stripeStatus.payoutsEnabled ? 'Connected and ready to accept payments.' : stripeStatus?.connected ? 'Finish Stripe verification to accept payments.' : 'Connect your business to accept deposits and balances.'}</Text><Pressable accessibilityRole="button" disabled={connectingStripe} onPress={() => void connectStripe()} style={styles.shareButton}><Text style={styles.shareButtonText}>{connectingStripe ? 'Opening Stripe…' : stripeStatus?.connected ? 'Continue Stripe setup' : 'Connect Stripe'}</Text></Pressable></View>
    <Field label="Comeback reminder after (days)" value={days} onChangeText={setDays} /><Text style={styles.label}>Preferred message tone</Text><View style={styles.choices}>{(['friendly','professional','casual'] as const).map(value => <Pressable key={value} onPress={() => setTone(value)} style={[styles.choice, tone === value && styles.choiceActive]}><Text style={[styles.choiceText, tone === value && styles.choiceTextActive]}>{titleCase(value)}</Text></Pressable>)}</View>{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<PrimaryButton disabled={saving || !name.trim()} fullWidth label={saving ? 'Saving…' : 'Save business setup'} onPress={() => void save()} /></M3Screen>;
}
function Field({ label, multiline, ...props }: { label: string; value: string; onChangeText: (value: string) => void; multiline?: boolean }) { return <View><Text style={styles.label}>{label}</Text><TextInput {...props} multiline={multiline} style={[styles.input, multiline && styles.inputMultiline]} /></View>; }

const INDUSTRIES = [
  'Barbershop', 'Hair salon', 'Beauty salon', 'Nail salon', 'Spa', 'Massage therapy',
  'Skincare and aesthetics', 'Tattoo and piercing', 'Lashes and brows', 'Makeup artistry',
  'Car wash', 'Auto detailing', 'Auto repair', 'Cleaning service', 'Landscaping and gardening',
  'Plumbing', 'Electrical', 'HVAC', 'Handyman', 'Pest control', 'Moving and hauling',
  'Photography', 'Personal training', 'Yoga and pilates', 'Pet grooming', 'Dog walking',
  'Tutoring', 'Music lessons', 'Dental practice', 'Medical clinic', 'Chiropractic',
  'Physiotherapy', 'Optometry', 'Veterinary', 'Catering', 'Event planning', 'Other',
];

function IndustryField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = INDUSTRIES.find((item) => item.toLowerCase() === value.trim().toLowerCase());
  return (
    <View>
      <Text style={styles.label}>Industry</Text>
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={[styles.input, styles.selectRow]}>
        <Text style={current ? styles.selectValue : styles.selectPlaceholder}>{current ?? (value || 'Choose an industry')}</Text>
        <Text style={styles.selectChevron}>{'▾'}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.sheetOverlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>Choose an industry</Text>
            <ScrollView style={styles.sheetList} keyboardShouldPersistTaps="handled">
              {INDUSTRIES.map((item) => {
                const selected = current === item;
                return (
                  <Pressable
                    key={item}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => { onChange(item); setOpen(false); }}
                    style={[styles.sheetRow, selected && styles.sheetRowSelected]}
                  >
                    <Text style={[styles.sheetRowText, selected && styles.sheetRowTextSelected]}>{item}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
const m3Head = StyleSheet.create({ block: { gap: 2, marginBottom: m3Space.sm }, eyebrow: { ...m3Type.labelSm, color: m3.secondary, letterSpacing: 0.6 }, title: { ...m3Type.headlineMd, color: m3.onSurface, marginTop: 2 }, subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 } });
const logoStyles = StyleSheet.create({
  card: { flexDirection: 'row', gap: m3Space.sm, backgroundColor: m3.surfaceContainerLowest, borderRadius: 16, padding: m3Space.md, marginBottom: m3Space.md },
  preview: { width: 64, height: 64, borderRadius: 16, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  initials: { ...m3Type.headlineSm, color: m3.primary },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { ...m3Type.titleMd, color: m3.onSurface },
  detail: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  actions: { flexDirection: 'row', gap: m3Space.xs, marginTop: 4 },
  btn: { height: 34, paddingHorizontal: 12, borderRadius: 8, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  btnText: { ...m3Type.labelMd, color: m3.onSurface },
  error: { ...m3Type.bodySm, color: m3.error, marginTop: 2 },
  hint: { ...m3Type.bodySm, color: m3.secondary, marginTop: 2 },
});
const styles = StyleSheet.create({ shareCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.md }, shareLabel: { ...typography.caption, color: colors.text }, shareUrl: { ...typography.body, color: colors.primary }, shareActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }, shareButton: { minHeight: 40, flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.round }, shareButtonPrimary: { backgroundColor: colors.primary, borderColor: colors.primary }, shareButtonText: { ...typography.caption, color: colors.text, fontWeight: '700' }, shareButtonTextPrimary: { color: colors.surface }, qrToggle: { minHeight: 36, justifyContent: 'center', marginTop: spacing.xs }, qrToggleText: { ...typography.caption, color: colors.primary, fontWeight: '700' }, qrWrap: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm }, qrHint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' }, label: { ...typography.caption, color: colors.text, marginBottom: spacing.xs }, input: { minHeight: 48, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, ...typography.body, color: colors.text }, inputMultiline: { minHeight: 88, paddingTop: spacing.sm, textAlignVertical: 'top' }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, choice: { minHeight: 42, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radius.round, borderWidth: 1, borderColor: colors.border }, choiceActive: { borderColor: colors.primary }, choiceText: { ...typography.caption, color: colors.textSecondary }, choiceTextActive: { color: colors.primary, fontWeight: '700' }, setupCard: { padding: spacing.md, gap: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface }, toggleRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }, toggleCopy: { flex: 1 }, toggleTitle: { ...typography.bodyStrong, color: colors.text }, toggleDetail: { ...typography.caption, color: colors.textSecondary }, error: { ...typography.caption, color: colors.negative },
  selectRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm },
  selectValue: { ...typography.body, color: colors.text },
  selectPlaceholder: { ...typography.body, color: colors.textSecondary },
  selectChevron: { ...typography.body, color: colors.textSecondary },
  sheetOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: { maxHeight: "75%", backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 32, gap: spacing.sm },
  sheetTitle: { ...typography.heading, color: colors.text },
  sheetList: { maxHeight: 420 },
  sheetRow: { minHeight: 48, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radius.md },
  sheetRowSelected: { backgroundColor: colors.primarySoft },
  sheetRowText: { ...typography.body, color: colors.text },
  sheetRowTextSelected: { color: colors.primary, fontWeight: "700" } });
