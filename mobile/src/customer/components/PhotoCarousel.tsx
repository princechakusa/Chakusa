import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Image, NativeScrollEvent, Pressable, NativeSyntheticEvent, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { initials, photoSource } from '../../components/ProfilePhoto';
import { premium, premiumSerif } from '../premiumTheme';

// Swipeable photos with page dots. Shows the business's real photos only;
// with none, a calm monogram tile in the same footprint (no stock imagery).

/** `chromeBottom` lifts the dots/counter above anything overlapping the bottom (e.g. a rounded sheet); `onPress` opens a full-screen viewer at the tapped photo. */
export function PhotoCarousel({ photos, name, width, height, radius = 0, style, testID, chromeBottom = 10, onPress }: { photos: string[]; name: string; width: number; height: number; radius?: number; style?: StyleProp<ViewStyle>; testID?: string; chromeBottom?: number; onPress?: (index: number) => void }) {
  const sources = photos.map(photoSource).filter((uri): uri is string => Boolean(uri));
  const [index, setIndex] = useState(0);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / width);
    if (next !== index) setIndex(next);
  };
  const frame = { width, height, borderRadius: radius };
  if (!sources.length) {
    return (
      <View testID={testID} accessibilityLabel={`${name}, no photos yet`} style={[styles.fallback, frame, style]}>
        <Text style={styles.monogram}>{initials(name)}</Text>
        {width >= 240 ? <View style={[styles.soonPill, { bottom: chromeBottom + 6 }]}>
          <Ionicons name="images-outline" size={13} color={premium.onDeepSoft} />
          <Text style={styles.soonText}>Photos coming soon</Text>
        </View> : null}
      </View>
    );
  }
  return (
    <View testID={testID} style={[styles.frame, frame, style]}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={32} nestedScrollEnabled>
        {sources.map((uri, i) => (
          <Pressable key={uri} disabled={!onPress} accessibilityRole={onPress ? 'imagebutton' : undefined} accessibilityLabel={`${name} photo ${i + 1} of ${sources.length}${onPress ? ', open full screen' : ''}`} onPress={() => onPress?.(i)}>
            <Image source={{ uri }} style={{ width, height }} resizeMode="cover" />
          </Pressable>
        ))}
      </ScrollView>
      {sources.length > 1 ? (
        <>
          <View pointerEvents="none" style={[styles.dots, { bottom: chromeBottom }]}>
            {sources.map((uri, i) => <View key={uri} style={[styles.dot, i === index && styles.dotActive]} />)}
          </View>
          <View pointerEvents="none" style={[styles.counter, { bottom: chromeBottom - 6 }]}>
            <Ionicons name="images-outline" size={13} color="#FFFFFF" />
            <Text style={styles.counterText}>{index + 1} / {sources.length}</Text>
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: premium.sage },
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: premium.deep, overflow: 'hidden' },
  monogram: { fontFamily: premiumSerif, fontStyle: 'italic', fontSize: 44, color: premium.onDeepSoft },
  dots: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  counter: { position: 'absolute', right: 14, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(14,24,22,0.55)' },
  counterText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: '#FFFFFF' },
  soonPill: { position: 'absolute', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(246,244,233,0.08)' },
  soonText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: premium.onDeepSoft },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive: { width: 16, backgroundColor: '#FFFFFF' },
});
