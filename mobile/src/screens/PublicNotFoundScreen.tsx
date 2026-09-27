import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PUBLIC_WEB_ORIGIN } from '../domain/trustSettings';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';

export function PublicNotFoundScreen() {
  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.shell}>
        <Text style={styles.brand}>CHAKUSA</Text>
        <Text accessibilityRole="header" style={styles.title}>Page not found</Text>
        <Text style={styles.body}>This link doesn't lead anywhere. Check that you typed or pasted it correctly.</Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel="Go to chakusarecovery.com"
          onPress={() => void Linking.openURL(PUBLIC_WEB_ORIGIN)}
          style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        >
          <Text style={styles.linkText}>Go to chakusarecovery.com</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: m3.surface },
  shell: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: m3Space.md, paddingHorizontal: m3Space.lg },
  brand: { ...m3Type.labelSm, color: m3.primary, letterSpacing: 1.5 },
  title: { ...m3Type.headlineMd, color: m3.onSurface, textAlign: 'center' },
  body: { ...m3Type.bodyMd, color: m3.onSurfaceVariant, textAlign: 'center', maxWidth: 420 },
  link: { minHeight: 44, justifyContent: 'center', paddingHorizontal: m3Space.md, borderRadius: m3Radius.md, backgroundColor: m3.primary, marginTop: m3Space.sm },
  linkText: { ...m3Type.labelMd, color: m3.onPrimary },
  pressed: { opacity: 0.7 },
});
