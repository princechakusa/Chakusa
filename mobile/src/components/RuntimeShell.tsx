import Constants from 'expo-constants';
import type { ReactNode } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { updateRequired } from '../domain/runtimeConfig';
import { useRuntimeConfig } from '../services/runtimeConfig';

// Admin-controlled app chrome from runtime config (no build needed):
// - "Update required" when this install is older than the minimum version,
// - a slim notice banner (admin message, or maintenance mode).
export function RuntimeShell({ children }: { children: ReactNode }) {
  const config = useRuntimeConfig();
  const installed = Constants.expoConfig?.version ?? null;

  if (Platform.OS !== 'web' && updateRequired(installed, config.minSupportedVersion)) {
    const storeUrl = Platform.OS === 'ios' ? config.iosStoreUrl : config.androidStoreUrl;
    return (
      <SafeAreaView style={styles.gate}>
        <Text style={styles.gateTitle}>Update Chakusa to continue</Text>
        <Text style={styles.gateBody}>
          This version ({installed}) is no longer supported. Install the latest version from the {Platform.OS === 'ios' ? 'App Store' : 'Google Play'} to keep using Chakusa.
        </Text>
        {storeUrl ? (
          <Pressable accessibilityRole="button" style={styles.gateButton} onPress={() => void Linking.openURL(storeUrl)}>
            <Text style={styles.gateButtonText}>Update now</Text>
          </Pressable>
        ) : null}
      </SafeAreaView>
    );
  }

  const message = config.maintenance
    ? config.notice ?? 'Chakusa is undergoing maintenance. Some features may be briefly unavailable.'
    : config.notice;

  return (
    <View style={styles.fill}>
      {message ? (
        <SafeAreaView edges={['top']} style={[styles.banner, config.maintenance && styles.bannerWarn]}>
          <Text accessibilityRole="alert" style={styles.bannerText}>{message}</Text>
        </SafeAreaView>
      ) : null}
      <View style={styles.fill}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  banner: { backgroundColor: '#131B2E', paddingHorizontal: 16, paddingBottom: 8 },
  bannerWarn: { backgroundColor: '#8D1704' },
  bannerText: { color: '#FFFFFF', fontSize: 13, lineHeight: 18, paddingTop: 8, textAlign: 'center' },
  gate: { flex: 1, backgroundColor: '#FAF8FF', padding: 24, justifyContent: 'center' },
  gateTitle: { fontSize: 26, fontWeight: '800', color: '#131B2E', marginBottom: 12 },
  gateBody: { fontSize: 16, lineHeight: 24, color: '#59413C', marginBottom: 24 },
  gateButton: { backgroundColor: '#AB2D19', borderRadius: 999, paddingVertical: 14, alignItems: 'center' },
  gateButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
