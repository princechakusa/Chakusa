import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { MessageTone } from '../apiTypes';
import { AuthForm } from '../components/AuthForm';
import { CountryPhoneInput } from '../components/CountryPhoneInput';
import { PrimaryButton, Screen } from '../components/ui';
import { ApiError } from '../services/api';
import { businessApi } from '../services/endpoints';
import { useAuth } from '../state/AuthContext';
import { BusinessGoal, usePreferences } from '../state/PreferencesContext';
import { colors, radius, spacing, typography } from '../theme';

const industries = [
  { title: 'Beauty', items: ['salon', 'barber', 'beauty clinic', 'spa'] },
  { title: 'Home services', items: ['plumber', 'electrician', 'cleaner', 'contractor'] },
  { title: 'Automotive', items: ['mechanic', 'car wash', 'detailing'] },
  { title: 'Professional', items: ['dentist', 'photographer', 'consultant'] },
];
const servicesList = ['Haircut', 'Hair coloring', 'Facial', 'Manicure', 'Pedicure', 'Consultation', 'Cleaning', 'Repair'];
const goalOptions: { value: BusinessGoal; title: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'missed_calls', title: 'Recover missed calls', icon: 'call-outline' },
  { value: 'reviews', title: 'Get more reviews', icon: 'star-outline' },
  { value: 'comebacks', title: 'Bring customers back', icon: 'refresh-outline' },
];

export function OnboardingScreen() {
  const { status, business, refreshBusiness } = useAuth();
  const preferences = usePreferences();
  const step = preferences.onboardingStep;
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [name, setName] = useState(business?.name ?? '');
  const [phone, setPhone] = useState(business?.phone ?? '');
  const [services, setServices] = useState<string[]>(business?.defaultServices ?? []);
  const [reviewLink, setReviewLink] = useState(business?.googleReviewLink ?? '');
  const [hours, setHours] = useState(typeof business?.workingHours?.summary === 'string' ? business.workingHours.summary : 'Mon-Sat, 9:00 AM-6:00 PM');
  const [days, setDays] = useState(String(business?.reminderDays ?? 42));
  const [tone, setTone] = useState<MessageTone>(business?.preferredTone ?? 'friendly');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'authenticated' && step === 3) preferences.setOnboardingStep(4);
    if (status === 'anonymous' && step > 3) preferences.setOnboardingStep(3);
  }, [preferences, status, step]);
  useEffect(() => {
    if (!business) return;
    setName(business.name); setPhone(business.phone ?? ''); setServices(business.defaultServices ?? []); setReviewLink(business.googleReviewLink ?? '');
  }, [business]);

  const next = () => preferences.setOnboardingStep(Math.min(10, step + 1));
  const back = () => preferences.setOnboardingStep(Math.max(0, step - 1));
  const toggleGoal = (goal: BusinessGoal) => preferences.setGoals(preferences.goals.includes(goal) ? preferences.goals.filter(item => item !== goal) : [...preferences.goals, goal]);
  const saveBusiness = async (body: Parameters<typeof businessApi.patch>[0]) => {
    if (saving) return;
    setSaving(true); setError(null);
    try {
      if (!business && body.name) await businessApi.create({ name: body.name, industry: body.industry ?? undefined, phone: body.phone ?? undefined });
      else await businessApi.patch(body);
      await refreshBusiness(); next();
    }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Unable to save this step.'); }
    finally { setSaving(false); }
  };
  const complete = async () => { await refreshBusiness(); preferences.completeOnboarding(); };

  return <Screen style={[styles.screen, step === 0 && styles.welcomeScreen]}>
    {step > 0 ? <View style={styles.top}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} style={styles.back}><Ionicons name="chevron-back" size={24} color={colors.text} /></Pressable>
      {step < 10 ? <Text style={styles.progressLabel}>{step} of 9</Text> : null}
    </View> : null}
    {step > 0 && step < 10 ? <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${Math.min(100, step * (100 / 9))}%` }]} /></View> : null}

    {step === 0 ? <Welcome onNext={() => { setAuthMode('register'); next(); }} onSignIn={() => { setAuthMode('login'); preferences.setOnboardingStep(3); }} /> : null}
    {step === 1 ? <Step title="What do you want Chakusa to help you with?"><View style={styles.stack}>{goalOptions.map(goal => <SelectCard key={goal.value} icon={goal.icon} title={goal.title} selected={preferences.goals.includes(goal.value)} onPress={() => toggleGoal(goal.value)} />)}</View><PrimaryButton disabled={!preferences.goals.length} fullWidth label="Continue" onPress={next} /></Step> : null}
    {step === 2 ? <Step title="What type of business do you run?">{industries.map(group => <View key={group.title}><Text style={styles.groupTitle}>{group.title}</Text><View style={styles.industryGrid}>{group.items.map(item => <Pressable key={item} onPress={() => preferences.setIndustry(item)} style={[styles.industry, preferences.industry === item && styles.selected]}><Text style={[styles.industryText, preferences.industry === item && styles.selectedText]}>{titleCase(item)}</Text></Pressable>)}</View></View>)}<PrimaryButton disabled={!preferences.industry} fullWidth label="Continue" onPress={next} /></Step> : null}
    {step === 3 ? <Step title="Your CHAKUSA account" copy="Create an account or sign in to continue."><AuthForm defaultMode={authMode} defaultIndustry={preferences.industry || undefined} onSuccess={() => preferences.setOnboardingStep(4)} /></Step> : null}
    {step === 4 ? <Step title="Business details" copy="Confirm the name customers know."><Field label="Business name" value={name} onChangeText={setName} />{error ? <ErrorText text={error} /> : null}<PrimaryButton disabled={saving || !name.trim()} fullWidth label={saving ? 'Saving...' : 'Continue'} onPress={() => void saveBusiness({ name: name.trim(), industry: preferences.industry || undefined })} /></Step> : null}
    {step === 5 ? <Step title="Business phone" copy="Customers will use this number when they call or reply."><CountryPhoneInput value={phone} onChange={setPhone} label="Phone number" />{error ? <ErrorText text={error} /> : null}<PrimaryButton disabled={saving || phone.length < 7} fullWidth label={saving ? 'Saving...' : 'Continue'} onPress={() => void saveBusiness({ phone })} /></Step> : null}
    {step === 6 ? <Step title="Your services" copy="Select the services you want to recover and track."><View style={styles.serviceList}>{servicesList.map(service => { const active = services.includes(service); return <Pressable key={service} onPress={() => setServices(current => active ? current.filter(item => item !== service) : [...current, service])} style={styles.serviceRow}><Text style={styles.serviceText}>{service}</Text><Ionicons name={active ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={active ? colors.success : colors.textSecondary} /></Pressable>; })}</View>{error ? <ErrorText text={error} /> : null}<PrimaryButton disabled={saving || !services.length} fullWidth label={saving ? 'Saving...' : 'Continue'} onPress={() => void saveBusiness({ defaultServices: services })} /></Step> : null}
    {step === 7 ? <Step title="Google review link" copy="Add the direct link customers use to leave an honest review."><Field label="Review link" value={reviewLink} onChangeText={setReviewLink} autoCapitalize="none" placeholder="Paste review link" />{error ? <ErrorText text={error} /> : null}<PrimaryButton disabled={saving} fullWidth label={saving ? 'Saving...' : 'Continue'} onPress={() => void saveBusiness({ googleReviewLink: reviewLink.trim() || undefined })} /></Step> : null}
    {step === 8 ? <Step title="Follow-up preferences" copy="Set a calm default for customer recovery."><Field label="Working hours" value={hours} onChangeText={setHours} /><Field label="Return reminder (days)" value={days} onChangeText={setDays} keyboardType="number-pad" /><Text style={styles.label}>Message tone</Text><View style={styles.choiceRow}>{(['friendly', 'professional', 'casual'] as const).map(value => <Pressable key={value} onPress={() => setTone(value)} style={[styles.choice, tone === value && styles.selected]}><Text style={[styles.choiceText, tone === value && styles.selectedText]}>{titleCase(value)}</Text></Pressable>)}</View>{error ? <ErrorText text={error} /> : null}<PrimaryButton disabled={saving || Number(days) < 1} fullWidth label={saving ? 'Saving...' : 'Continue'} onPress={() => void saveBusiness({ workingHours: { summary: hours.trim() }, reminderDays: Number(days), preferredTone: tone })} /></Step> : null}
    {step === 9 ? <Step title="Notification preferences" copy="Choose what CHAKUSA should prioritize in your Attention Center."><Toggle label="Missed calls" value={preferences.attention.missedCalls} onChange={value => preferences.setAttention({ ...preferences.attention, missedCalls: value })} /><Toggle label="Customers due back" value={preferences.attention.comebacks} onChange={value => preferences.setAttention({ ...preferences.attention, comebacks: value })} /><Toggle label="Review requests" value={preferences.attention.reviews} onChange={value => preferences.setAttention({ ...preferences.attention, reviews: value })} /><Toggle label="Important business activity" value={preferences.attention.businessActivity} onChange={value => preferences.setAttention({ ...preferences.attention, businessActivity: value })} /><PrimaryButton fullWidth label="Continue" onPress={next} /></Step> : null}
    {step === 10 ? <View style={styles.complete}><View style={styles.completeIcon}><Ionicons name="checkmark" size={38} color={colors.surface} /></View><Text style={styles.completeTitle}>You're ready.</Text><Text style={styles.completeCopy}>CHAKUSA will keep your next customer recovery action clear.</Text><PrimaryButton fullWidth label="Open dashboard" onPress={() => void complete()} /></View> : null}
  </Screen>;
}

function Welcome({ onNext, onSignIn }: { onNext: () => void; onSignIn: () => void }) { return <View style={styles.welcome}><View style={styles.welcomeBrand}><Image source={require('../../assets/chakusa-app-icon.png')} resizeMode="contain" style={styles.brandMark} /><Text style={styles.brand}>CHAKUSA</Text></View><View style={styles.welcomeMessage}><View pointerEvents="none" style={styles.coralShape}><View style={styles.coralOuter} /><View style={styles.coralMiddle} /><View style={styles.coralInner} /></View><Text style={styles.hero}>Recover customers.{`\n`}Build your reputation.{`\n`}Bring them back.</Text><Text style={styles.welcomeCopy}>One simple place to follow up with missed calls, request reviews, and bring customers back.</Text></View><View style={styles.welcomeActions}><Pressable accessibilityRole="button" onPress={onNext} style={({ pressed }) => [styles.getStarted, pressed && styles.getStartedPressed]}><Text style={styles.getStartedText}>Get started</Text></Pressable><Pressable accessibilityRole="button" onPress={onSignIn} style={styles.signIn}><Text style={styles.signInText}>Already have an account? <Text style={styles.signInStrong}>Sign in</Text></Text></Pressable></View></View>; }
function Step({ title, copy, children }: { title: string; copy?: string; children: React.ReactNode }) { return <View style={styles.step}><View><Text style={styles.title}>{title}</Text>{copy ? <Text style={styles.copy}>{copy}</Text> : null}</View>{children}</View>; }
function SelectCard({ icon, title, selected, onPress }: { icon: keyof typeof Ionicons.glyphMap; title: string; selected: boolean; onPress: () => void }) { return <Pressable onPress={onPress} style={[styles.selectCard, selected && styles.selected]}><View style={styles.featureIcon}><Ionicons name={icon} size={22} color={colors.primary} /></View><Text style={styles.selectTitle}>{title}</Text><Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={selected ? colors.success : colors.textSecondary} /></Pressable>; }
function Field({ label, ...props }: { label: string; value: string; onChangeText: (value: string) => void; autoCapitalize?: 'none'; keyboardType?: 'number-pad'; placeholder?: string }) { return <View><Text style={styles.label}>{label}</Text><TextInput {...props} placeholderTextColor={colors.textSecondary} style={styles.input} /></View>; }
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) { return <View style={styles.toggle}><Text style={styles.toggleText}>{label}</Text><Switch value={value} onValueChange={onChange} trackColor={{ false: colors.border, true: colors.success }} /></View>; }
function ErrorText({ text }: { text: string }) { return <Text accessibilityRole="alert" style={styles.error}>{text}</Text>; }
const titleCase = (value: string) => value.replace(/(^|\s)\S/g, letter => letter.toUpperCase());

const styles = StyleSheet.create({
  screen: { minHeight: '100%' }, welcomeScreen: { paddingBottom: spacing.lg }, top: { minHeight: 44, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, back: { width: 44, height: 44, justifyContent: 'center' }, progressLabel: { ...typography.caption, color: colors.textSecondary }, progressTrack: { height: 4, borderRadius: 2, backgroundColor: colors.border }, progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary },
  welcome: { flex: 1, minHeight: 690, alignItems: 'center', justifyContent: 'space-between', paddingTop: spacing.xs }, welcomeBrand: { alignItems: 'center', gap: spacing.xs }, brandMark: { width: 64, height: 64, borderRadius: radius.md }, brand: { fontSize: 28, lineHeight: 34, fontWeight: '800', color: colors.text }, welcomeMessage: { width: '100%', minHeight: 390, alignItems: 'center', justifyContent: 'center', gap: spacing.md, paddingHorizontal: spacing.xs }, coralShape: { position: 'absolute', width: 330, height: 330, alignItems: 'center', justifyContent: 'center' }, coralOuter: { position: 'absolute', width: 310, height: 310, borderRadius: 155, backgroundColor: 'rgba(255,92,92,0.20)', transform: [{ translateX: 22 }, { translateY: 18 }] }, coralMiddle: { position: 'absolute', width: 260, height: 260, borderRadius: 130, backgroundColor: 'rgba(255,92,92,0.42)', transform: [{ translateX: -20 }, { translateY: 24 }] }, coralInner: { position: 'absolute', width: 190, height: 190, borderRadius: 95, backgroundColor: 'rgba(248,249,251,0.64)', transform: [{ translateX: 8 }, { translateY: -8 }] }, hero: { ...typography.title, fontSize: 31, lineHeight: 39, color: colors.text, textAlign: 'center', zIndex: 1 }, welcomeCopy: { ...typography.body, fontSize: 17, lineHeight: 24, color: colors.text, textAlign: 'center', maxWidth: 320, zIndex: 1 }, welcomeActions: { width: '100%', gap: spacing.xs }, getStarted: { minHeight: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, shadowOpacity: 0.34, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 5 }, getStartedPressed: { backgroundColor: colors.primaryPressed, transform: [{ scale: 0.99 }] }, getStartedText: { ...typography.bodyStrong, color: colors.surface }, signIn: { minHeight: 48, alignItems: 'center', justifyContent: 'center' }, signInText: { ...typography.body, color: colors.text }, signInStrong: { color: colors.primary, fontWeight: '600', textDecorationLine: 'underline' },
  step: { gap: spacing.lg }, title: { ...typography.title, color: colors.text }, copy: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs }, stack: { gap: spacing.sm }, featureIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }, selectCard: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }, selectTitle: { ...typography.bodyStrong, color: colors.text, flex: 1 }, selected: { borderColor: colors.primary },
  groupTitle: { ...typography.caption, color: colors.textSecondary, marginBottom: spacing.xs }, industryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md }, industry: { width: '48%', minHeight: 48, justifyContent: 'center', paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }, industryText: { ...typography.body, color: colors.text }, selectedText: { color: colors.primary, fontWeight: '600' },
  label: { ...typography.caption, color: colors.text, marginBottom: spacing.xs }, input: { minHeight: 50, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, ...typography.body, color: colors.text }, serviceList: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md }, serviceRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.divider }, serviceText: { ...typography.body, color: colors.text }, choiceRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }, choice: { minHeight: 42, paddingHorizontal: spacing.md, justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.round }, choiceText: { ...typography.caption, color: colors.textSecondary }, toggle: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.divider }, toggleText: { ...typography.body, color: colors.text },
  complete: { minHeight: 620, justifyContent: 'center', alignItems: 'center', gap: spacing.lg }, completeIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' }, completeTitle: { ...typography.title, color: colors.text }, completeCopy: { ...typography.body, color: colors.textSecondary, textAlign: 'center' }, error: { ...typography.caption, color: colors.negative },
});
