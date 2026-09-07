import { MaterialIcons } from '@expo/vector-icons';
import { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { m3, m3Radius, m3Shadow, m3Space, m3Type } from './businessTheme';

// Shared Material 3 primitives for the business primary tabs. Every screen
// composes these so the rust/teal token set and Plus Jakarta / Inter type
// scale stay in one place.

// Material Symbols (mockups) -> MaterialIcons glyph names. Underscores in
// the mockups become hyphens; only genuine gaps are remapped here.
const ICON_ALIAS: Record<string, keyof typeof MaterialIcons.glyphMap> = {
  markdown_copy: 'description',
  passkey: 'vpn-key',
  local_atm: 'local-atm',
  space_dashboard: 'space-dashboard',
  more_horiz: 'more-horiz',
};

export type IconName = string;

export function Icon({
  name,
  size = 20,
  color = m3.onSurfaceVariant,
  style,
}: {
  name: IconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const key = ICON_ALIAS[name] ?? (name.replace(/_/g, '-') as keyof typeof MaterialIcons.glyphMap);
  return <MaterialIcons name={key} size={size} color={color} style={style} />;
}

export function M3Screen({
  children,
  header,
  scroll = true,
  contentStyle,
  refreshControl,
}: PropsWithChildren<{
  header?: ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  refreshControl?: ReactNode;
}>) {
  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      {header}
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollBody, contentStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl as never}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, styles.scrollBody, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function M3Header({
  businessName,
  location,
  verified,
  onBack,
  onLocationPress,
  onNotificationsPress,
  onAvatarPress,
  hasNotifications = true,
}: {
  businessName: string;
  location?: string | null;
  verified?: boolean;
  /** When set, the header is a secondary-screen bar: back chevron + title, no brand logo. */
  onBack?: () => void;
  onLocationPress?: () => void;
  onNotificationsPress?: () => void;
  onAvatarPress?: () => void;
  hasNotifications?: boolean;
}) {
  if (onBack) {
    return (
      <View style={styles.headerBack}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.headerBackBtn}>
          <Icon name="arrow_back" size={22} color={m3.onSurface} />
        </Pressable>
        <Text numberOfLines={1} style={styles.headerBackLabel}>
          {businessName}
        </Text>
        <View style={styles.flexSpacer} />
        {onNotificationsPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            onPress={onNotificationsPress}
            style={styles.headerIconButton}
          >
            <Icon name="notifications" size={22} color={m3.onSurfaceVariant} />
            {hasNotifications ? <View style={styles.headerDot} /> : null}
          </Pressable>
        ) : null}
      </View>
    );
  }
  return (
    <View style={styles.header}>
      <View style={styles.headerBrand}>
        <View style={styles.headerLogo}>
          <Icon name="content_cut" size={22} color={m3.primary} />
        </View>
        <View style={styles.headerText}>
          <View style={styles.headerTitleRow}>
            <Text numberOfLines={1} style={styles.headerTitle}>
              {businessName}
            </Text>
            {verified ? <Icon name="verified" size={15} color={m3.secondary} /> : null}
          </View>
          {location ? (
            <Pressable
              accessibilityRole={onLocationPress ? 'button' : undefined}
              onPress={onLocationPress}
              style={styles.headerLocationRow}
            >
              <Text numberOfLines={1} style={styles.headerLocation}>
                {location}
              </Text>
              {onLocationPress ? <Icon name="expand_more" size={13} color={m3.onSurfaceVariant} /> : null}
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={styles.headerActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          onPress={onNotificationsPress}
          style={styles.headerIconButton}
        >
          <Icon name="notifications" size={22} color={m3.onSurfaceVariant} />
          {hasNotifications ? <View style={styles.headerDot} /> : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Account"
          onPress={onAvatarPress}
          style={styles.headerAvatar}
        >
          <Icon name="person" size={18} color={m3.onPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

export function M3Card({
  children,
  style,
  onPress,
  padded = true,
  raised = false,
}: PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  padded?: boolean;
  raised?: boolean;
}>) {
  const body = (
    <View
      style={[
        styles.card,
        raised ? m3Shadow.raised : m3Shadow.card,
        padded && styles.cardPadded,
        style,
      ]}
    >
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      {body}
    </Pressable>
  );
}

type ChipTone = 'neutral' | 'primary' | 'secondary' | 'error' | 'primaryFixed' | 'outline';

const CHIP_TONES: Record<ChipTone, { bg: string; fg: string; border?: string }> = {
  neutral: { bg: m3.surfaceContainer, fg: m3.onSurfaceVariant },
  primary: { bg: m3.primary, fg: m3.onPrimary },
  secondary: { bg: m3.secondaryContainer, fg: m3.onSecondaryContainer },
  error: { bg: m3.errorContainer, fg: m3.onErrorContainer },
  primaryFixed: { bg: m3.primaryFixed, fg: m3.onPrimaryFixedVariant },
  outline: { bg: 'transparent', fg: m3.onSurfaceVariant, border: m3.outlineVariant },
};

export function Chip({
  label,
  tone = 'neutral',
  icon,
  onPress,
  selected,
  count,
  style,
}: {
  label: string;
  tone?: ChipTone;
  icon?: IconName;
  onPress?: () => void;
  selected?: boolean;
  count?: number | string;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = selected ? CHIP_TONES.primary : CHIP_TONES[tone];
  const body = (
    <View
      style={[
        styles.chip,
        { backgroundColor: palette.bg },
        palette.border ? { borderWidth: 1, borderColor: palette.border } : null,
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={15} color={palette.fg} /> : null}
      <Text style={[styles.chipLabel, { color: palette.fg }]}>{label}</Text>
      {count != null ? (
        <View style={[styles.chipCount, { backgroundColor: selected ? 'rgba(255,255,255,0.22)' : m3.surfaceContainerHigh }]}>
          <Text style={[styles.chipCountText, { color: selected ? m3.onPrimary : palette.fg }]}>{count}</Text>
        </View>
      ) : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}>
      {body}
    </Pressable>
  );
}

export function SectionTitle({
  title,
  actionLabel,
  onAction,
  dot,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  dot?: string;
}) {
  return (
    <View style={styles.sectionRow}>
      <View style={styles.sectionTitleWrap}>
        {dot ? <View style={[styles.sectionDot, { backgroundColor: dot }]} /> : null}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {actionLabel ? (
        <Pressable accessibilityRole="button" onPress={onAction} style={styles.sectionAction}>
          <Text style={styles.sectionActionText}>{actionLabel}</Text>
          <Icon name="arrow_forward" size={14} color={m3.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function M3Loading({ label }: { label?: string }) {
  return (
    <View style={styles.centered}>
      <ActivityIndicator color={m3.primary} />
      {label ? <Text style={styles.centeredText}>{label}</Text> : null}
    </View>
  );
}

export function M3Error({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.centered}>
      <Icon name="error_outline" size={30} color={m3.error} />
      <Text style={styles.centeredText}>{message}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function M3Empty({ icon = 'inbox', title, message }: { icon?: IconName; title: string; message?: string }) {
  return (
    <View style={styles.centered}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={26} color={m3.onSurfaceVariant} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.centeredText}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: m3.surface },
  scrollBody: { paddingHorizontal: m3Space.md, paddingTop: m3Space.sm, paddingBottom: m3Space.xxl, gap: m3Space.md },

  header: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: m3Space.xs,
    paddingHorizontal: m3Space.md,
    backgroundColor: m3.surfaceContainerLowest,
    borderBottomWidth: 1,
    borderBottomColor: m3.surfaceContainerHigh,
  },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: m3Space.xs, flex: 1, minWidth: 0 },
  headerLogo: {
    width: 40,
    height: 40,
    borderRadius: m3Radius.sm,
    backgroundColor: m3.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, minWidth: 0 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerTitle: { ...m3Type.headlineSm, fontSize: 17, lineHeight: 22, color: m3.onSurface, flexShrink: 1 },
  headerBack: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: m3Space.sm,
    backgroundColor: m3.surfaceContainerLowest,
  },
  headerBackBtn: { width: 40, height: 40, borderRadius: m3Radius.sm, alignItems: 'center', justifyContent: 'center' },
  headerBackLabel: { ...m3Type.labelMd, color: m3.primary },
  flexSpacer: { flex: 1 },
  headerLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 1 },
  headerLocation: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: m3Space.xs },
  headerIconButton: { width: 40, height: 40, borderRadius: m3Radius.sm, alignItems: 'center', justifyContent: 'center' },
  headerDot: { position: 'absolute', top: 9, right: 9, width: 8, height: 8, borderRadius: 4, backgroundColor: m3.primary },
  headerAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center' },

  card: { backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.lg },
  cardPadded: { padding: m3Space.md },
  pressed: { opacity: 0.85 },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 32,
    borderRadius: m3Radius.full,
  },
  chipLabel: { ...m3Type.labelMd },
  chipCount: { minWidth: 18, height: 16, borderRadius: 8, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center' },
  chipCountText: { ...m3Type.labelXs, fontSize: 10 },

  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { ...m3Type.headlineSm, color: m3.onSurface },
  sectionAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  sectionActionText: { ...m3Type.labelMd, color: m3.primary },

  centered: { alignItems: 'center', justifyContent: 'center', gap: m3Space.sm, paddingVertical: m3Space.xl },
  centeredText: { ...m3Type.bodySm, color: m3.onSurfaceVariant, textAlign: 'center', maxWidth: 280 },
  retryButton: { marginTop: 4, paddingHorizontal: 18, height: 40, borderRadius: m3Radius.full, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center' },
  retryText: { ...m3Type.labelMd, color: m3.onPrimary },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { ...m3Type.titleMd, color: m3.onSurface },
});
