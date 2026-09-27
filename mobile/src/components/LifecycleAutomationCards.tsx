import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { AutomationChannel, AutomationRuleDto } from '../apiTypes';
import { AutomationAvailability, automationStatusCopy, channelLabel, lifecycleAutomationDefinitions, lifecycleRule } from '../domain/automation';
import { automationApi } from '../services/endpoints';
import { colors, radius, spacing, typography } from '../theme';
import { ChannelPicker, InfoRow, PrimaryButton, StatusBadge } from './ui';

interface Props {
  rules: AutomationRuleDto[];
  availability: AutomationAvailability;
  reminderDays?: number;
  working: string | null;
  onWork: (key: string, operation: () => Promise<unknown>) => void;
}

export function LifecycleAutomationCards({ rules, availability, reminderDays = 42, working, onWork }: Props) {
  const available = availability === 'available';
  // Only relevant before a rule exists - once created, the rule's own
  // channel (set at creation time) is shown instead, same as AutomationScreen.
  const [pendingChannel, setPendingChannel] = useState<Record<string, AutomationChannel>>({});
  return <View style={styles.section}>
    <View style={styles.intro}><Text style={styles.sectionTitle}>Lifecycle automation</Text><Text style={styles.body}>These automations work from Chakusa customer and lead activity on both iPhone and Android.</Text></View>
    {lifecycleAutomationDefinitions(reminderDays).map(definition => {
      const rule = lifecycleRule(rules, definition.triggerType);
      const key = definition.triggerType;
      const busy = working === key;
      const channel = rule?.channel ?? pendingChannel[key] ?? 'SMS';
      return <View key={key} style={styles.card}>
        <View style={styles.top}><View style={styles.copy}><Text style={styles.heading}>{definition.title}</Text><StatusBadge label={rule ? automationStatusCopy(rule.enabled) : 'Not set up'} /></View>{rule ? <Switch accessibilityLabel={definition.title} accessibilityHint="Turns this automatic workflow on or off" accessibilityState={{ disabled: !available || Boolean(working) }} disabled={!available || Boolean(working)} value={rule.enabled} onValueChange={enabled => onWork(key, () => enabled ? automationApi.enableRule(rule.id) : automationApi.disableRule(rule.id))} trackColor={{ false: colors.border, true: colors.success }} thumbColor={colors.surface} /> : null}</View>
        <Text style={styles.body}>{definition.description}</Text>
        <InfoRow label="When" value={definition.when} />
        <InfoRow label="Channel" value={channelLabel(channel)} />
        {!rule && available ? <>
          <ChannelPicker value={channel} disabled={Boolean(working)} onChange={next => setPendingChannel(current => ({ ...current, [key]: next }))} />
          <PrimaryButton fullWidth disabled={Boolean(working)} label={busy ? 'Setting up…' : 'Set up automation'} onPress={() => onWork(key, () => automationApi.createRule({ name: definition.name, enabled: false, triggerType: definition.triggerType, channel, delaySeconds: definition.delaySeconds, config: definition.config }))} />
        </> : null}
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({ section: { gap: spacing.md }, intro: { gap: spacing.xs }, sectionTitle: { ...typography.subheading, color: colors.text }, card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md }, top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }, copy: { flex: 1, gap: spacing.xs }, heading: { ...typography.subheading, color: colors.text }, body: { ...typography.body, color: colors.textSecondary } });
