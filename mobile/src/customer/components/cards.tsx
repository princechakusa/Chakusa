import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { CustomerBookingDto, MarketplaceCardDto } from '../../apiTypes';
import { bookingStatusLabel } from '../../domain/booking';
import { distanceLabel } from '../../domain/places';
import { initials, photoSource } from '../../components/ProfilePhoto';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { formatDateTime } from '../../utils/format';
import { marketplaceLoyaltyBadges } from '../domain/customerLoyalty';

// PROGRAM 2 LOOP 7: small presentational pieces for the customer app,
// restyled onto experience/authTheme.ts tokens (warm cream, coral, pill
// shapes) to match the Stitch mockups.

const attention = '#B7791F';
const attentionSoft = '#FDF3E4';

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
            <Ionicons name="shield-checkmark" size={12} color={authColors.onCoral} />
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
        color={selected ? authColors.coral : authColors.inkFaint}
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
        <Text style={[styles.statusText, statusTextTone(booking.status)]}>{bookingStatusLabel(booking.status)}</Text>
      </View>
    </Pressable>
  );
}

function statusTone(status: CustomerBookingDto['status']) {
  if (status === 'CONFIRMED' || status === 'COMPLETED') return { backgroundColor: '#EAF9F1' };
  if (status === 'CANCELED' || status === 'NO_SHOW') return { backgroundColor: '#FDECEC' };
  return { backgroundColor: attentionSoft };
}

function statusTextTone(status: CustomerBookingDto['status']) {
  if (status === 'CONFIRMED' || status === 'COMPLETED') return { color: authColors.positive };
  if (status === 'CANCELED' || status === 'NO_SHOW') return { color: authColors.danger };
  return { color: attention };
}

const styles = StyleSheet.create({
  card: { backgroundColor: authColors.surface, borderRadius: authRadius.lg, overflow: 'hidden', borderWidth: 1, borderColor: authColors.line, ...authShadow.card },
  pressed: { opacity: 0.9 },
  coverWrap: { width: '100%', aspectRatio: 16 / 10, backgroundColor: authColors.line },
  cover: { width: '100%', height: '100%' },
  coverFallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: authColors.coralSoft },
  coverInitials: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 24, color: authColors.coral },
  verifiedChip: { position: 'absolute', top: authSpace.xs, left: authSpace.xs, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: authRadius.pill, backgroundColor: authColors.coral },
  verifiedChipText: { ...authType.micro, textTransform: 'none', letterSpacing: 0, fontSize: 10, color: authColors.onCoral },
  ratingChip: { position: 'absolute', top: authSpace.xs, right: authSpace.xs, paddingHorizontal: 8, paddingVertical: 4, borderRadius: authRadius.pill, backgroundColor: authColors.surface },
  ratingChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: authColors.ink },
  body: { padding: authSpace.md, gap: authSpace.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm },
  cardCopy: { flex: 1, minWidth: 0 },
  logo: { width: 40, height: 40, borderRadius: authRadius.sm, backgroundColor: authColors.coralSoft, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.coral },
  cardName: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  cardMeta: { ...authType.body, fontSize: 12, marginTop: 2 },
  tagline: { ...authType.body, fontSize: 13, color: authColors.ink },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: authSpace.xxs },
  loyaltyBadge: { borderRadius: authRadius.pill, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: authColors.coralSoft, borderWidth: 1, borderColor: authColors.coral },
  loyaltyBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, color: authColors.coral },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: authColors.lineSoft, paddingTop: authSpace.sm },
  rating: { ...authType.body, fontSize: 12 },
  cardAction: { ...authType.link },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm, padding: authSpace.md, backgroundColor: authColors.surface, borderRadius: authRadius.md, borderWidth: 1, borderColor: authColors.line },
  serviceRowSelected: { borderColor: authColors.coral },
  bookingCard: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm, backgroundColor: authColors.surface, borderRadius: authRadius.lg, padding: authSpace.md, borderWidth: 1, borderColor: authColors.line, ...authShadow.card },
  dateBadge: { width: 44, height: 44, borderRadius: authRadius.md, backgroundColor: authColors.coralSoft, alignItems: 'center', justifyContent: 'center' },
  dateBadgeDay: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: authColors.coral, lineHeight: 20 },
  dateBadgeMonth: { fontFamily: 'Inter_600SemiBold', fontSize: 10, color: authColors.coral },
  statusChip: { borderRadius: authRadius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  statusText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  when: { ...authType.body, fontSize: 12, color: authColors.ink, marginTop: 2 },
});
