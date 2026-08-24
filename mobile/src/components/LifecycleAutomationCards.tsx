import { StyleSheet, Switch, Text, View } from 'react-native';
import { AutomationRuleDto } from '../apiTypes';
import { AutomationAvailability, automationStatusCopy, lifecycleAutomationDefinitions, lifecycleRule } from '../domain/automation';
import { automationApi } from '../services/endpoints';
import { colors, radius, spacing, typography } from '../theme';
import { InfoRow, PrimaryButton, StatusBadge } from './ui';

interface Props {
  rules: AutomationRuleDto[];
  availability: AutomationAvailability;
  reminderDays?: number;
  working: string | null;
  onWork: (key: string, operation: () => Promise<unknown>) => void;
}

export function LifecycleAutomationCards({ rules, availability, reminderDays = 42, working, onWork }: Props) {
  const available = availability === 'available';
  return <View style={styles.section}>
    <View style={styles.intro}><Text style={styles.sectionTitle}>Lifecycle automation</Text><Text style={styles.body}>These automations work from Chakusa customer and lead activity on both iPhone and Android.</Text></View>
    {lifecycleAutomationDefinitions(reminderDays).map(definition => {
      const rule = lifecycleRule(rules, definition.triggerType);
      const key = definition.triggerType;
      const busy = working === key;
      return <View key={key} style={styles.card}>
        <View style={styles.top}><View style={styles.copy}><Text style={styles.heading}>{definition.title}</Text><StatusBadge label={rule ? automationStatusCopy(rule.enabled) : 'Not set up'} /></View>{rule ? <Switch accessibilityLabel={definition.title} accessibilityHint="Turns this automatic SMS workflow on or off" accessibilityState={{ disabled: !available || Boolean(working) }} disabled={!available || Boolean(working)} value={rule.enabled} onValueChange={enabled => onWork(key, () => enabled ? automationApi.enableRule(rule.id) : automationApi.disableRule(rule.id))} trackColor={{ false: colors.border, true: colors.success }} thumbColor={colors.surface} /> : null}</View>
        <Text style={styles.body}>{definition.description}</Text>
        <InfoRow label="When" value={definition.when} />
        <InfoRow label="Channel" value="SMS" />
        {!rule && available ? <PrimaryButton fullWidth disabled={Boolean(working)} label={busy ? 'Setting up…' : 'Set up automation'} onPress={() => onWork(key, () => automationApi.createRule({ name: definition.name, enabled: false, triggerType: definition.triggerType, channel: 'SMS', delaySeconds: definition.delaySeconds, config: definition.config }))} /> : null}
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({ section: { gap: spacing.md }, intro: { gap: spacing.xs }, sectionTitle: { ...typography.subheading, color: colors.text }, card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md }, top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }, copy: { flex: 1, gap: spacing.xs }, heading: { ...typography.subheading, color: colors.text }, body: { ...typography.body, color: colors.textSecondary } });
