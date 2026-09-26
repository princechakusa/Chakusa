import { useMemo, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

import { leafletHtml, parseMapMessage, type LeafletPageOptions } from './leafletHtml';

// iOS / Android: the Leaflet page runs inside a WebView. The web build uses
// LeafletMap.web.tsx (an iframe) instead.

export interface LeafletMapProps extends Omit<LeafletPageOptions, 'id'> {
  height?: number;
  style?: StyleProp<ViewStyle>;
  onPick?: (point: { latitude: number; longitude: number }) => void;
  accessibilityLabel?: string;
}

let nextId = 0;

export function LeafletMap({ height = 240, style, onPick, accessibilityLabel = 'Map', ...options }: LeafletMapProps) {
  const id = useRef(`map-${++nextId}`).current;
  // Rebuild the page only when what is drawn changes, not on every parent render.
  const drawKey = JSON.stringify([options.center.latitude, options.center.longitude, options.zoom, options.pickable, options.fitMarkers, options.markers ?? []]);
  const html = useMemo(() => leafletHtml({ ...options, id }), [id, drawKey]);
  return (
    <View accessibilityLabel={accessibilityLabel} style={[styles.frame, { height }, style]}>
      <WebView
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://chakusarecovery.com/' }}
        onMessage={(event) => {
          const message = parseMapMessage(event.nativeEvent.data, id);
          if (message?.type === 'pick' && onPick) onPick({ latitude: message.latitude!, longitude: message.longitude! });
        }}
        scrollEnabled={false}
        nestedScrollEnabled
        setSupportMultipleWindows={false}
        javaScriptEnabled
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#F4F1ED' },
  web: { flex: 1, backgroundColor: 'transparent' },
});
