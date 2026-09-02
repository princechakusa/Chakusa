import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CustomerBookingDto, MarketplaceCardDto } from '../../apiTypes';
import { bookingStatusLabel } from '../../domain/booking';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { formatDateTime } from '../../utils/format';

// PROGRAM 2 LOOP 7: small presentational pieces for the customer app,
// built from the shared theme tokens and `ui.tsx` primitives just like
// the business screens.

export function BusinessCard({ card, onPress }: { card: MarketplaceCardDto; onPress: () => void }) {
  const location = [card.city, card.region].filter(Boolean).join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.name}. ${card.category}. ${card.rating != null ? `Rated ${card.rating} from ${card.reviewCount} reviews.` : 'No reviews yet.'}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.cardTop}>
        <View style={styles.logo}><Text style={styles.logoText}>{card.name.slice(0, 1).toUpperCase()}</Text></View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardName} numberOfLines={1}>{card.name}</Text>
          <Text style={styles.cardMeta} numberOfLines={1}>{card.category}{location ? ` · ${location}` : ''}</Text>
        </View>
        {card.verified ? <Ionicons name="shield-checkmark" size={16} color={colors.success} /> : null}
      </View>
      {card.tagline ? <Text style={styles.tagline} numberOfLines={2}>{card.tagline}</Text> : null}
      <View style={styles.cardFooter}>
        <Text style={styles.rating}>
          {card.rating != null ? `★ ${card.rating.toFixed(1)} (${card.reviewCount})` : 'New to Chakusa'}
        </Text>
        <Text style={styles.cardAction}>View <Ionicons name="chevron-forward" size={13} /></Text>
      </View>
    </Pressable>
  );
}

export function ServiceRow({
  name, meta, selected, onPress,
}: { name: string; meta: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={selected ? { selected: true } : {}}
      accessibilityLabel={`${name}. ${meta}`}
      onPress={onPress}
      style={({ pressed }) => [styles.serviceRow, selected && styles.serviceRowSelected, pressed && styles.pressed]}
    >
      <View style={styles.cardCopy}>
        <Text style={styles.cardName}>{name}</Text>
        <Text style={styles.cardMeta}>{meta}</Text>
      </View>
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={20}
        color={selected ? colors.primary : colors.tabInactive}
      />
    </Pressable>
  );
}

export function BookingCard({ booking, onPress }: { booking: CustomerBookingDto; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${booking.serviceName} with ${booking.business.name}. ${formatDateTime(booking.startsAt)}. ${bookingStatusLabel(booking.status)}.`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardCopy}>
          <Text style={styles.cardName} numberOfLines={1}>{booking.serviceName}</Text>
          <Text style={styles.cardMeta} numberOfLines={1}>{booking.business.name}</Text>
        </View>
        <View style={[styles.statusChip, statusTone(booking.status)]}>
          <Text style={styles.statusText}>{bookingStatusLabel(booking.status)}</Text>
        </View>
      </View>
      <Text style={styles.when}>{formatDateTime(booking.startsAt)}{booking.staffName ? ` · ${booking.staffName}` : ''}</Text>
    </Pressable>
  );
}

function statusTone(status: CustomerBookingDto['status']) {
  if (status === 'CONFIRMED' || status === 'COMPLETED') return { borderColor: colors.success };
  if (status === 'CANCELED' || status === 'NO_SHOW') return { borderColor: colors.negative };
  return { borderColor: colors.attention };
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm, ...shadows.card },
  pressed: { opacity: 0.78 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardCopy: { flex: 1, minWidth: 0 },
  logo: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  logoText: { ...typography.subheading, color: colors.primary },
  cardName: { ...typography.bodyStrong, color: colors.text },
  cardMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  tagline: { ...typography.caption, color: colors.text },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm },
  rating: { ...typography.caption, color: colors.textSecondary },
  cardAction: { ...typography.caption, color: colors.primary },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  serviceRowSelected: { borderColor: colors.primary },
  statusChip: { borderRadius: radius.round, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, backgroundColor: colors.background },
  statusText: { ...typography.micro, color: colors.text },
  when: { ...typography.caption, color: colors.text },
});
