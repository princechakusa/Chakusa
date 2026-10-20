import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import type { LeafletMapProps } from './LeafletMap';
import { leafletHtml, parseMapMessage } from './leafletHtml';

// Web: the same Leaflet page as native, in an iframe. Taps come back
// through window.postMessage and are matched to this map by id.

let nextId = 0;

export function LeafletMap({ height = 240, fill = false, style, onPick, onSelect, accessibilityLabel = 'Map', selectedKey, ...options }: LeafletMapProps) {
  const id = useRef(`map-web-${++nextId}`).current;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedRef = useRef(selectedKey);
  selectedRef.current = selectedKey;
  // Rebuild the page only when what is drawn changes, not on every parent render.
  const drawKey = JSON.stringify([options.center.latitude, options.center.longitude, options.zoom, options.pickable, options.fitMarkers, options.markers ?? []]);
  const html = useMemo(() => leafletHtml({ ...options, id, selectedKey: selectedRef.current }), [id, drawKey]);

  useEffect(() => {
    const frame = frameRef.current?.contentWindow as (Window & { __chakusaSelect?: (key: string) => void }) | null | undefined;
    if (selectedKey) frame?.__chakusaSelect?.(selectedKey);
  }, [selectedKey]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow || event.origin !== window.location.origin) return;
      const message = parseMapMessage(event.data, id);
      if (message?.type === 'pick') onPickRef.current?.({ latitude: message.latitude!, longitude: message.longitude! });
      if (message?.type === 'select') onSelectRef.current?.(message.key!);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [id]);

  return (
    <View style={[styles.frame, fill ? styles.fill : { height }, style]}>
      <iframe
        ref={frameRef}
        title={accessibilityLabel}
        data-testid="leaflet-map"
        srcDoc={html}
        // allow-same-origin is required: OpenStreetMap's tile policy rejects
        // tile requests without a Referer, and an opaque-origin sandbox sends
        // none. The frame only ever holds our own generated page (escaped
        // data, SRI-pinned Leaflet), never third-party content.
        sandbox="allow-scripts allow-same-origin"
        style={{ border: 0, width: '100%', height: '100%' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 18, overflow: 'hidden', backgroundColor: '#F4F1ED' },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 0 },
});
