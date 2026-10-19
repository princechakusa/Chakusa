import { Linking, Pressable, Text, View } from 'react-native';
import { BrandMark } from '../components/BrandMark';

const PLAY_LISTING = 'https://play.google.com/store/apps/details?id=com.chakusa.mobile';

/** Shown instead of the app when the installed APK is not signed by Chakusa. */
export function NotGenuineAppScreen() {
  return (
    <View accessibilityRole="alert" style={{ flex: 1, backgroundColor: '#FBFAF8', alignItems: 'center', justifyContent: 'center', padding: 28, gap: 16 }}>
      <BrandMark size={48} />
      <Text style={{ fontSize: 22, fontWeight: '800', color: '#0E1116', textAlign: 'center' }}>This copy of Chakusa isn't genuine</Text>
      <Text style={{ fontSize: 15, lineHeight: 22, color: '#4B5563', textAlign: 'center' }}>
        It was modified or installed from an unofficial source, so it can't be used to protect your account. Please uninstall it and get Chakusa from Google Play.
      </Text>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(PLAY_LISTING)} style={{ marginTop: 8, backgroundColor: '#F05A44', paddingHorizontal: 22, paddingVertical: 14, borderRadius: 999 }}>
        <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 15 }}>Get Chakusa on Google Play</Text>
      </Pressable>
    </View>
  );
}
