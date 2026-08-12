import { Ionicons } from '@expo/vector-icons';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing } from '../theme';

interface FirstEntryScreenProps {
  onGetStarted: () => void;
  onSignIn: () => void;
}

export function FirstEntryScreen({ onGetStarted, onSignIn }: FirstEntryScreenProps) {
  const { height } = useWindowDimensions();
  const compact = height < 720;

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <ScrollView
        bounces={false}
        contentContainerStyle={[styles.content, compact && styles.contentCompact, { minHeight: Math.max(height - 32, 600) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.brandBlock, compact && styles.brandBlockCompact]}>
          <Image
            accessibilityIgnoresInvertColors
            resizeMode="contain"
            source={require('../../assets/chakusa-app-icon.png')}
            style={[styles.logo, compact && styles.logoCompact]}
          />
          <Text accessibilityRole="header" style={styles.wordmark}>CHAKUSA</Text>
        </View>

        <RelationshipIllustration compact={compact} />

        <View style={styles.bottomContent}>
          <View style={styles.messageBlock}>
            <Text accessibilityRole="header" style={[styles.headline, compact && styles.headlineCompact]}>
              Keep your customers coming back.
            </Text>
            <Text style={[styles.supportingText, compact && styles.supportingTextCompact]}>
              CHAKUSA helps you follow up, recover missed opportunities, and build stronger customer relationships.
            </Text>
          </View>

          <View style={styles.actions}>
            <Pressable
              accessibilityLabel="Get Started"
              accessibilityRole="button"
              onPress={onGetStarted}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed]}
            >
              <Text style={styles.primaryButtonText}>Get Started</Text>
            </Pressable>
            <Pressable
              accessibilityHint="Opens the existing account sign-in screen"
              accessibilityLabel="Sign In"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onSignIn}
              style={({ pressed }) => [styles.signInButton, pressed && styles.signInPressed]}
            >
              <Text style={styles.signInText}>Already have an account? <Text style={styles.signInStrong}>Sign In</Text></Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function RelationshipIllustration({ compact }: { compact: boolean }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={[styles.illustration, compact && styles.illustrationCompact]}>
      <View style={[styles.connector, styles.connectorOne]} />
      <View style={[styles.connector, styles.connectorTwo]} />
      <View style={[styles.connector, styles.connectorThree]} />

      <View style={styles.growthIcon}>
        <Ionicons color={colors.primary} name="stats-chart" size={29} />
      </View>
      <View style={[styles.smallDot, styles.smallDotLeft]} />
      <View style={[styles.pulse, styles.pulseLeft]}><View style={styles.pulseCore} /></View>
      <View style={[styles.featureNode, styles.customerNode]}>
        <Ionicons color={colors.primaryPressed} name="person-outline" size={29} />
      </View>
      <View style={[styles.featureNode, styles.conversationNode]}>
        <Ionicons color={colors.primaryPressed} name="chatbubbles-outline" size={28} />
      </View>
      <View style={[styles.pulse, styles.pulseRight]}><View style={styles.pulseCore} /></View>
      <View style={styles.reputationIcon}>
        <Ionicons color={colors.surface} name="thumbs-up" size={20} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.surface },
  content: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 52, paddingBottom: spacing.md },
  contentCompact: { paddingTop: spacing.lg, paddingHorizontal: spacing.xl },
  brandBlock: { alignItems: 'center', gap: 12 },
  brandBlockCompact: { gap: spacing.xs },
  logo: { width: 72, height: 72, borderRadius: 9 },
  logoCompact: { width: 58, height: 58, borderRadius: 8 },
  wordmark: { color: colors.text, fontSize: 28, lineHeight: 34, fontWeight: '800', letterSpacing: 0 },
  illustration: { alignSelf: 'center', width: 340, maxWidth: '100%', height: 265, marginTop: 34, position: 'relative' },
  illustrationCompact: { height: 190, marginTop: spacing.sm, transform: [{ scale: 0.86 }] },
  connector: { position: 'absolute', height: 2, backgroundColor: 'rgba(233,92,98,0.28)', borderRadius: 1 },
  connectorOne: { width: 91, left: 58, top: 164, transform: [{ rotate: '-42deg' }] },
  connectorTwo: { width: 91, left: 143, top: 147, transform: [{ rotate: '45deg' }] },
  connectorThree: { width: 92, left: 220, top: 119, transform: [{ rotate: '-46deg' }] },
  growthIcon: { position: 'absolute', left: 37, top: 145, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  smallDot: { position: 'absolute', width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(255,92,92,0.14)' },
  smallDotLeft: { left: 5, top: 204 },
  pulse: { position: 'absolute', width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(255,92,92,0.12)', alignItems: 'center', justifyContent: 'center' },
  pulseLeft: { left: 83, top: 178 },
  pulseRight: { right: 18, top: 75 },
  pulseCore: { width: 23, height: 23, borderRadius: 12, backgroundColor: colors.primary, borderWidth: 6, borderColor: 'rgba(255,255,255,0.55)' },
  featureNode: {
    position: 'absolute', width: 68, height: 68, borderRadius: 34, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,92,92,0.09)',
    shadowColor: colors.primary, shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 7 }, elevation: 4,
  },
  customerNode: { left: 137, top: 67 },
  conversationNode: { left: 213, top: 145 },
  reputationIcon: {
    position: 'absolute', right: 18, top: 24, width: 50, height: 38, borderRadius: 7, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', shadowColor: colors.primary, shadowOpacity: 0.28, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 4,
  },
  bottomContent: { flex: 1, justifyContent: 'space-between', gap: 30 },
  messageBlock: { gap: 16, maxWidth: 430, alignSelf: 'center', width: '100%' },
  headline: { color: colors.text, fontSize: 36, lineHeight: 43, fontWeight: '800', letterSpacing: 0 },
  headlineCompact: { fontSize: 31, lineHeight: 37 },
  supportingText: { color: colors.text, fontSize: 18, lineHeight: 27, fontWeight: '400', letterSpacing: 0 },
  supportingTextCompact: { fontSize: 16, lineHeight: 23 },
  actions: { gap: spacing.xs, maxWidth: 430, alignSelf: 'center', width: '100%' },
  primaryButton: {
    minHeight: 58, borderRadius: 29, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.primary, shadowOpacity: 0.32, shadowRadius: 13, shadowOffset: { width: 0, height: 7 }, elevation: 7,
    ...Platform.select({ web: { boxShadow: '0 7px 18px rgba(255,92,92,0.28)' } }),
  },
  primaryButtonPressed: { backgroundColor: colors.primaryPressed, transform: [{ scale: 0.99 }] },
  primaryButtonText: { color: colors.surface, fontSize: 18, lineHeight: 24, fontWeight: '700', letterSpacing: 0 },
  signInButton: { minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xs },
  signInPressed: { opacity: 0.58 },
  signInText: { color: colors.text, fontSize: 16, lineHeight: 22, fontWeight: '400', textAlign: 'center', letterSpacing: 0 },
  signInStrong: { fontWeight: '700' },
});
