import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';

import { leafletHtml, parseMapMessage, selectMarkerScript, type LeafletPageOptions } from './leafletHtml';

// iOS / Android: the Leaflet page runs inside a WebView. The web build uses
// LeafletMap.web.tsx (an iframe) instead.

export interface LeafletMapProps extends Omit<LeafletPageOptions, 'id'> {
  height?: number;
  /** Fill the parent edge to edge (no fixed height, no rounded frame). */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
  onPick?: (point: { latitude: number; longitude: number }) => void;
  /** A business marker (one with a `key`) was tapped. */
  onSelect?: (key: string) => void;
  accessibilityLabel?: string;
}

let nextId = 0;

export function LeafletMap({ height = 240, fill = false, style, onPick, onSelect, accessibilityLabel = 'Map', selectedKey, ...options }: LeafletMapProps) {
  const id = useRef(`map-${++nextId}`).current;
  const webRef = useRef<WebView>(null);
  const selectedRef = useRef(selectedKey);
  selectedRef.current = selectedKey;
  // Rebuild the page only when what is drawn changes, not on every parent
  // render. Selection is pushed into the live page instead (no tile reload).
  const drawKey = JSON.stringify([options.center.latitude, options.center.longitude, options.zoom, options.pickable, options.fitMarkers, options.markers ?? []]);
  const html = useMemo(() => leafletHtml({ ...options, id, selectedKey: selectedRef.current }), [id, drawKey]);
  useEffect(() => { if (selectedKey) webRef.current?.injectJavaScript(selectMarkerScript(selectedKey)); }, [selectedKey]);
  return (
    <View accessibilityLabel={accessibilityLabel} style={[styles.frame, fill ? styles.fill : { height }, style]}>
      <WebView
        ref={webRef}
        originWhitelist={['https://chakusarecovery.com']}
        source={{ html, baseUrl: 'https://chakusarecovery.com/' }}
        onShouldStartLoadWithRequest={(request) => request.url === 'about:blank' || request.url === 'https://chakusarecovery.com/'}
        webviewDebuggingEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        javaScriptCanOpenWindowsAutomatically={false}
        onMessage={(event) => {
          const message = parseMapMessage(event.nativeEvent.data, id);
          if (message?.type === 'pick' && onPick) onPick({ latitude: message.latitude!, longitude: message.longitude! });
          if (message?.type === 'select' && onSelect) onSelect(message.key!);
        }}
        scrollEnabled={Boolean(onSelect)}
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
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 0 },
  web: { flex: 1, backgroundColor: 'transparent' },
});
