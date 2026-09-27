import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { CustomerBookingDto, MarketplaceCardDto } from '../../apiTypes';
import { bookingStatusLabel } from '../../domain/booking';
import { distanceLabel } from '../../domain/places';
import { initials, photoSource } from '../../components/ProfilePhoto';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { formatDateTime } from '../../utils/format';
import { marketplaceLoyaltyBadges } from '../domain/customerLoyalty';

// PROGRAM 2 LOOP 7: small presentational pieces for the customer app,
// built from the shared theme tokens and `ui.tsx` primitives just like
// the business screens.

// A photo-forward cover for a business card: the real photo when the
// business has one, otherwise an initials tile in the same footprint - no
// fabricated imagery, just a richer fallback than a small round avatar.
export function BusinessCover({ uri, name, testID }: { uri?: string | null; name: string; testID?: string }) {
  const source = photoSource(uri);
  return source ? (
    <Image testID={testID} accessibilityLabel={`${name} photo`} source={{ uri: source }} style={styles.cover} resizeMode="cover" />
  ) : (
    <View testID={testID} accessibilityLabel={`${name} initials`} style={[styles.cover, styles.coverFallback]}>
      <Text style={styles.coverInitials}>{initials(name)}</Text>
    </View>
  );
}

export function BusinessCard({ card, onPress }: { card: MarketplaceCardDto; onPress: () => void }) {
  const distance = distanceLabel(card.distanceKm);
  const location = distance ?? [...new Set([card.city, card.region].filter(Boolean))].join(', ');
  const badges = marketplaceLoyaltyBadges(card);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.name}. ${card.category}. ${card.rating != null ? `Rated ${card.rating} from ${card.reviewCount} reviews.` : 'No reviews yet.'}`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.coverWrap}>
        <BusinessCover uri={card.photoUrl} name={card.name} />
        {card.verified ? (
          <View style={styles.verifiedChip}>
            <Ionicons name="shield-checkmark" size={12} color={colors.surface} />
            <Text style={styles.verifiedChipText}>Verified</Text>
          </View>
        ) : null}
        {card.rating != null ? (
          <View style={styles.ratingChip}>
            <Text style={styles.ratingChipText}>★ {card.rating.toFixed(1)}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <View style={styles.cardTop}>
          <View style={styles.cardCopy}>
            <Text style={styles.cardName} numberOfLines={1}>{card.name}</Text>
            <Text style={styles.cardMeta} numberOfLines={1}>{card.category}{location ? ` · ${location}` : ''}</Text>
          </View>
        </View>
        {card.tagline ? <Text style={styles.tagline} numberOfLines={2}>{card.tagline}</Text> : null}
        {badges.length ? (
          <View style={styles.badgeRow}>
            {badges.map((badge) => (
              <View key={badge} style={styles.loyaltyBadge}><Text style={styles.loyaltyBadgeText}>{badge}</Text></View>
            ))}
          </View>
        ) : null}
        <View style={styles.cardFooter}>
          <Text style={styles.rating}>
            {card.rating != null ? `${card.reviewCount} review${card.reviewCount === 1 ? '' : 's'}` : 'New to Chakusa'}
          </Text>
          <Text style={styles.cardAction}>View <Ionicons name="chevron-forward" size={13} /></Text>
        </View>
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
  const startsAt = new Date(booking.startsAt);
  const day = Number.isNaN(startsAt.getTime()) ? '–' : String(startsAt.getDate());
  const month = Number.isNaN(startsAt.getTime()) ? '' : startsAt.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${booking.serviceName} with ${booking.business.name}. ${formatDateTime(booking.startsAt)}. ${bookingStatusLabel(booking.status)}.`}
      onPress={onPress}
      style={({ pressed }) => [styles.bookingCard, pressed && styles.pressed]}
    >
      <View style={styles.dateBadge}>
        <Text style={styles.dateBadgeDay}>{day}</Text>
        <Text style={styles.dateBadgeMonth}>{month}</Text>
      </View>
      <View style={styles.cardCopy}>
        <Text style={styles.cardName} numberOfLines={1}>{booking.serviceName}</Text>
        <Text style={styles.cardMeta} numberOfLines={1}>{booking.business.name}</Text>
        <Text style={styles.when}>{formatDateTime(booking.startsAt)}{booking.staffName ? ` · ${booking.staffName}` : ''}</Text>
      </View>
      <View style={[styles.statusChip, statusTone(booking.status)]}>
        <Text style={styles.statusText}>{bookingStatusLabel(booking.status)}</Text>
      </View>
    </Pressable>
  );
}

function statusTone(status: CustomerBookingDto['status']) {
  if (status === 'CONFIRMED' || status === 'COMPLETED') return { borderColor: colors.success };
  if (status === 'CANCELED' || status === 'NO_SHOW') return { borderColor: colors.negative };
  return { borderColor: colors.attention };
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, ...shadows.card },
  pressed: { opacity: 0.9 },
  coverWrap: { width: '100%', aspectRatio: 16 / 10, backgroundColor: colors.border },
  cover: { width: '100%', height: '100%' },
  coverFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  coverInitials: { ...typography.heading, color: colors.primary },
  verifiedChip: { position: 'absolute', top: spacing.xs, left: spacing.xs, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.round, backgroundColor: 'rgba(19,27,46,0.65)' },
  verifiedChipText: { ...typography.micro, color: colors.surface },
  ratingChip: { position: 'absolute', top: spacing.xs, right: spacing.xs, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.round, backgroundColor: colors.surface },
  ratingChipText: { ...typography.micro, color: colors.text, fontWeight: '700' },
  body: { padding: spacing.md, gap: spacing.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardCopy: { flex: 1, minWidth: 0 },
  logo: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  logoText: { ...typography.subheading, color: colors.primary },
  cardName: { ...typography.bodyStrong, color: colors.text },
  cardMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  tagline: { ...typography.caption, color: colors.text },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xxs },
  loyaltyBadge: { borderRadius: radius.round, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
  loyaltyBadgeText: { ...typography.micro, color: colors.primary },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm },
  rating: { ...typography.caption, color: colors.textSecondary },
  cardAction: { ...typography.caption, color: colors.primary },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  serviceRowSelected: { borderColor: colors.primary },
  bookingCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadows.card },
  dateBadge: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  dateBadgeDay: { ...typography.subheading, color: colors.primary, lineHeight: 20 },
  dateBadgeMonth: { ...typography.micro, color: colors.primary },
  statusChip: { borderRadius: radius.round, paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, backgroundColor: colors.background },
  statusText: { ...typography.micro, color: colors.text },
  when: { ...typography.caption, color: colors.text, marginTop: 2 },
});
