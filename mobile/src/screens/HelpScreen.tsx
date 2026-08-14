import { StyleSheet, Text, View } from 'react-native';
import { AppHeader, Screen } from '../components/ui';
import { colors, radius, spacing, typography } from '../theme';

const faqs = [
  ['What is Chakusa?', 'Chakusa helps small businesses organize missed-call leads, customer follow-up, review requests, and comeback reminders.'],
  ['How does missed-call recovery work?', 'Create a missed-call lead, prepare a message, then send it through your chosen phone messaging app.'],
  ['How do leads work?', 'Leads move from New to Contacted and Booked, then to Won or Lost. Won and Lost are final states.'],
  ['How do customer reminders work?', 'Comeback reminders identify customers due for follow-up. You prepare and send messages manually from the app.'],
  ['How do review requests work?', 'Prepare a review request and share its secure feedback link. Customers can leave private feedback or independently open the Google review option.'],
  ['What is the difference between Free and Pro?', 'Free includes the core workflow with usage limits. Pro is positioned at $29/month with expanded limits and features, but in-app purchasing is not available yet.'],
  ['Why do I see usage limits?', 'Your current plan determines monthly or resource limits. Settings and the Pro screen show the authoritative usage returned by Chakusa.'],
  ['How do I update business information?', 'Open Settings, then Business details to update supported business fields. Account name and email are separate and currently read-only.'],
  ['How do notifications work?', 'Notification settings currently control how activity is presented on this device. Server-side delivery preferences are not available yet.'],
  ['How do I log out?', 'Settings offers Log out for this device and Log out all devices to revoke every active session.'],
  ['How do I delete my account?', 'Open Settings, then Delete Account. Chakusa requires password or linked-provider confirmation before deletion.'],
] as const;

export function HelpScreen() { return <Screen><AppHeader eyebrow="HELP" title="Help & FAQ" subtitle="Quick answers about using Chakusa." />{faqs.map(([question, answer]) => <View key={question} style={styles.card}><Text style={styles.question}>{question}</Text><Text style={styles.answer}>{answer}</Text></View>)}</Screen>; }
const styles = StyleSheet.create({ card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs }, question: { ...typography.bodyStrong, color: colors.text }, answer: { ...typography.body, color: colors.textSecondary } });

