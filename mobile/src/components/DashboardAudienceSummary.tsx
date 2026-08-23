import { Pressable, StyleSheet, View } from 'react-native';
import type { AudienceCenterDto, AudienceSummaryDto, SmartAudienceKey } from '../apiTypes';
import { dashboardAudienceMetrics, dashboardAudiences } from '../domain/dashboardAudiences';
import { spacing } from '../theme';
import { formatMoney } from '../utils/format';
import { MetricCard, SectionHeader } from './ui';

function audienceDetail(audience: AudienceSummaryDto): string {
  const audienceMetrics = dashboardAudienceMetrics(audience);
  if (audienceMetrics.kind === 'outstanding') return `${formatMoney(audienceMetrics.outstandingPayments)} outstanding`;
  const metrics = audienceMetrics.averageValue > 0 ? [`Avg. ${formatMoney(audienceMetrics.averageValue)}`] : [];
  if (audienceMetrics.repeatRate != null) metrics.push(`${Math.round(audienceMetrics.repeatRate * 100)}% repeat`);
  return metrics.join(' · ');
}

export function DashboardAudienceSummary({ data, onSelect, onViewAll }: {
  data: AudienceCenterDto;
  onSelect: (key: SmartAudienceKey) => void;
  onViewAll: () => void;
}) {
  const audiences = dashboardAudiences(data.audiences);
  if (audiences.length === 0) return null;

  return <View>
    <SectionHeader title="Customer audiences" action="View all" onAction={onViewAll} />
    <View style={styles.grid}>{audiences.map(audience =>
      <Pressable key={audience.key} accessibilityRole="button" accessibilityLabel={`View ${audience.label}`} onPress={() => onSelect(audience.key)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <MetricCard label={audience.label} value={`${audience.totalCustomers} customer${audience.totalCustomers === 1 ? '' : 's'}`} detail={audienceDetail(audience) || undefined} />
      </Pressable>)}</View>
  </View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  card: { minWidth: 128, flex: 1 },
  pressed: { opacity: 0.72 },
});
