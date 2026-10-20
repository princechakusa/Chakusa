import { useState } from 'react';
import { Image, NativeScrollEvent, NativeSyntheticEvent, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { initials, photoSource } from '../../components/ProfilePhoto';
import { premium, premiumSerif } from '../premiumTheme';

// Swipeable photos with page dots. Shows the business's real photos only;
// with none, a calm monogram tile in the same footprint (no stock imagery).

export function PhotoCarousel({ photos, name, width, height, radius = 0, style, testID }: { photos: string[]; name: string; width: number; height: number; radius?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
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
      </View>
    );
  }
  return (
    <View testID={testID} style={[styles.frame, frame, style]}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={32} nestedScrollEnabled>
        {sources.map((uri, i) => (
          <Image key={uri} accessibilityLabel={`${name} photo ${i + 1} of ${sources.length}`} source={{ uri }} style={{ width, height }} resizeMode="cover" />
        ))}
      </ScrollView>
      {sources.length > 1 ? (
        <View pointerEvents="none" style={styles.dots}>
          {sources.map((uri, i) => <View key={uri} style={[styles.dot, i === index && styles.dotActive]} />)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: premium.sage },
  fallback: { alignItems: 'center', justifyContent: 'center', backgroundColor: premium.deep, overflow: 'hidden' },
  monogram: { fontFamily: premiumSerif, fontStyle: 'italic', fontSize: 44, color: premium.onDeepSoft },
  dots: { position: 'absolute', bottom: 10, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotActive: { width: 16, backgroundColor: '#FFFFFF' },
});
